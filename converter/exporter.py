"""Module for exporting point clouds to GLB and Draco formats."""

import numpy as np
import subprocess
import tempfile
from pathlib import Path
from pygltflib import (
    GLTF2, Scene, Node, Mesh, Primitive,
    Accessor, BufferView, Buffer
)
from plyfile import PlyData, PlyElement

# Try to import meshoptimizer
try:
    import meshoptimizer
    HAS_MESHOPTIMIZER = True
except ImportError:
    HAS_MESHOPTIMIZER = False


def _transform_coordinates(points: np.ndarray, transform: str) -> np.ndarray:
    """
    Apply coordinate transformation.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        transform: Transformation name
        
    Returns:
        Transformed points array
    """
    points_fixed = points.copy()
    
    if transform == 'none':
        # No transformation
        pass
    elif transform == 'neg_y':
        # Invert Y: (x, y, z) -> (x, -y, z)
        points_fixed[:, 1] = -points_fixed[:, 1]
    elif transform == 'neg_z':
        # Invert Z: (x, y, z) -> (x, y, -z)
        points_fixed[:, 2] = -points_fixed[:, 2]
    elif transform == 'neg_x':
        # Invert X: (x, y, z) -> (-x, y, z)
        points_fixed[:, 0] = -points_fixed[:, 0]
    elif transform == 'swap_yz_neg_y':
        # Swap Y and Z, negate new Y: (x, y, z) -> (x, -z, y)
        temp_y = points_fixed[:, 1].copy()
        points_fixed[:, 1] = -points_fixed[:, 2]
        points_fixed[:, 2] = temp_y
    elif transform == 'swap_yz_neg_z':
        # Swap Y and Z, negate new Z: (x, y, z) -> (x, z, -y)
        temp_y = points_fixed[:, 1].copy()
        points_fixed[:, 1] = points_fixed[:, 2]
        points_fixed[:, 2] = -temp_y
    elif transform == 'swap_yz':
        # Swap Y and Z: (x, y, z) -> (x, z, y)
        temp_y = points_fixed[:, 1].copy()
        points_fixed[:, 1] = points_fixed[:, 2]
        points_fixed[:, 2] = temp_y
    else:
        raise ValueError(f"Unknown transform: {transform}")
    
    return points_fixed


def _quantize_positions(points: np.ndarray) -> tuple[np.ndarray, list, list]:
    """
    Quantize positions to SHORT range for KHR_mesh_quantization.
    
    Args:
        points: Array of shape (N, 3) with point coordinates (float32)
        
    Returns:
        Tuple of (quantized_points (int16), quantization_offset, quantization_scale)
    """
    points_min = points.min(axis=0)
    points_max = points.max(axis=0)
    
    SHORT_MIN = -32768
    SHORT_MAX = 32767
    SHORT_RANGE = SHORT_MAX - SHORT_MIN
    
    ranges = points_max - points_min
    ranges = np.where(ranges < 1e-6, 1.0, ranges)  # Avoid division by zero
    
    quantization_scale = ranges / SHORT_RANGE
    quantization_offset = points_min - SHORT_MIN * quantization_scale
    
    quantized_float = (points - quantization_offset) / quantization_scale
    quantized_float = np.clip(quantized_float, SHORT_MIN, SHORT_MAX)
    quantized = quantized_float.astype(np.int16)
    
    return quantized, quantization_offset.tolist(), quantization_scale.tolist()


def _create_glb(points: np.ndarray, colors: np.ndarray, path: str, transform: str = 'none', use_quantization: bool = False):
    """
    Create GLB file from point cloud data.
    
    Uses:
    - KHR_mesh_quantization with SHORT for positions (6 bytes per point) if use_quantization=True
    - UNSIGNED_BYTE normalized for colors (3 bytes per point)
    
    Args:
        points: Array of shape (N, 3) with point coordinates (float32)
        colors: Array of shape (N, 3) with point colors (uint8)
        path: Output file path
        transform: Coordinate transformation to apply
        use_quantization: Whether to use KHR_mesh_quantization (default: False)
    """
    n = len(points)
    
    # Apply coordinate transformation
    points_fixed = _transform_coordinates(points, transform)
    
    if use_quantization:
        # Quantize positions for KHR_mesh_quantization
        points_quantized, quant_offset, quant_scale = _quantize_positions(points_fixed)
        pos_bytes = points_quantized.tobytes()  # int16: 6 bytes per point
        position_component_type = 5122  # SHORT
    else:
        # Use FLOAT without quantization (for compatibility)
        pos_bytes = points_fixed.tobytes()  # float32: 12 bytes per point
        position_component_type = 5126  # FLOAT
        quant_offset = None
        quant_scale = None
    
    # Calculate bounding box (using original float coordinates)
    points_max = points_fixed.max(axis=0).tolist()
    points_min = points_fixed.min(axis=0).tolist()
    
    # Colors: use UNSIGNED_BYTE directly (normalized=True in accessor)
    # No conversion needed - store as uint8
    colors_uint8 = colors.astype(np.uint8)
    col_bytes = colors_uint8.tobytes()      # uint8: 3 bytes per point
    
    # Create GLTF2 structure
    position_accessor = Accessor(
        bufferView=0,
        componentType=position_component_type,
        count=n,
        type='VEC3',
        max=points_max,
        min=points_min
    )
    
    # Add quantization extension if using quantization
    if use_quantization:
        position_accessor.extensions = {
            'KHR_mesh_quantization': {
                'quantizedAttributes': ['POSITION'],
                'quantizationOffset': quant_offset,
                'quantizationScale': quant_scale
            }
        }
    
    gltf = GLTF2(
        scene=0,
        scenes=[Scene(nodes=[0])],
        nodes=[Node(mesh=0)],
        meshes=[Mesh(
            primitives=[Primitive(
                attributes={'POSITION': 0, 'COLOR_0': 1},
                mode=0  # POINTS
            )]
        )],
        accessors=[
            position_accessor,
            Accessor(
                bufferView=1,
                componentType=5121,  # UNSIGNED_BYTE
                normalized=True,     # Normalized to [0, 1] range
                count=n,
                type='VEC3'
            )
        ],
        bufferViews=[
            BufferView(
                buffer=0,
                byteOffset=0,
                byteLength=len(pos_bytes)
            ),
            BufferView(
                buffer=0,
                byteOffset=len(pos_bytes),
                byteLength=len(col_bytes)
            )
        ],
        buffers=[Buffer(
            byteLength=len(pos_bytes) + len(col_bytes)
        )],
        extensionsUsed=['KHR_mesh_quantization'] if use_quantization else [],
        extensionsRequired=['KHR_mesh_quantization'] if use_quantization else []
    )
    
    # Set binary data
    gltf.set_binary_blob(pos_bytes + col_bytes)
    
    # Save GLB file
    gltf.save(path)


def export_glb(points: np.ndarray, colors: np.ndarray, output: str, transform: str = 'none', use_quantization: bool = False) -> int:
    """
    Export point cloud to GLB format without Draco compression.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        output: Output file path
        transform: Coordinate transformation to apply
        use_quantization: Whether to use KHR_mesh_quantization (default: False)
        
    Returns:
        Size of output file in bytes
    """
    _create_glb(points, colors, output, transform, use_quantization)
    return Path(output).stat().st_size


def export_glb_with_draco(points: np.ndarray, colors: np.ndarray, output: str, transform: str = 'none') -> int:
    """
    Export point cloud to GLB format with Draco compression.
    
    Uses draco_encoder to compress point cloud data and embeds it into GLB
    using KHR_draco_mesh_compression extension.
    
    Note: KHR_mesh_quantization is NOT used with Draco compression as it provides
    no benefit - Draco handles its own compression and quantization would be redundant.
    
    Accessors describe DECOMPRESSED data (FLOAT for positions and colors),
    not the compressed Draco buffer.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        output: Output file path
        transform: Coordinate transformation to apply
        
    Returns:
        Size of output file in bytes
        
    Raises:
        FileNotFoundError: If draco_encoder is not found
        subprocess.CalledProcessError: If draco_encoder fails
    """
    # Apply coordinate transformation
    points_fixed = _transform_coordinates(points, transform)
    
    # Create temporary PLY file for draco_encoder
    with tempfile.NamedTemporaryFile(suffix='.ply', delete=False) as tmp_ply:
        tmp_ply_path = tmp_ply.name
    
    # Create temporary .drc file
    with tempfile.NamedTemporaryFile(suffix='.drc', delete=False) as tmp_drc:
        tmp_drc_path = tmp_drc.name
    
    try:
        # Create PLY file with points and colors
        n = len(points_fixed)
        
        # Prepare vertex data
        vertex_data = np.empty(
            n,
            dtype=[
                ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
                ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')
            ]
        )
        
        vertex_data['x'] = points_fixed[:, 0]
        vertex_data['y'] = points_fixed[:, 1]
        vertex_data['z'] = points_fixed[:, 2]
        vertex_data['red'] = colors[:, 0]
        vertex_data['green'] = colors[:, 1]
        vertex_data['blue'] = colors[:, 2]
        
        # Create PLY element
        el = PlyElement.describe(vertex_data, 'vertex')
        
        # Write PLY file
        PlyData([el], text=False).write(tmp_ply_path)
        
        # Compress to Draco format using draco_encoder
        subprocess.run([
            'draco_encoder',
            '-i', tmp_ply_path,
            '-o', tmp_drc_path,
            '-cl', '7',
            '-qp', '14',
            '-qc', '10',
            '-point_cloud'
        ], check=True, capture_output=True, text=True)
        
        # Read compressed Draco data
        with open(tmp_drc_path, 'rb') as f:
            draco_data = f.read()
        
        # Calculate bounding box
        points_max = points_fixed.max(axis=0).tolist()
        points_min = points_fixed.min(axis=0).tolist()
        
        # Create GLB with Draco extension
        # We need to create a buffer view for the Draco data
        draco_buffer_view_index = 0
        
        gltf = GLTF2(
            scene=0,
            scenes=[Scene(nodes=[0])],
            nodes=[Node(mesh=0)],
            meshes=[Mesh(
                primitives=[Primitive(
                    attributes={'POSITION': 0, 'COLOR_0': 1},
                    mode=0,  # POINTS
                    extensions={
                        'KHR_draco_mesh_compression': {
                            'bufferView': draco_buffer_view_index,
                            'attributes': {
                                'POSITION': 0,
                                'COLOR_0': 1
                            }
                        }
                    }
                )]
            )],
            accessors=[
                Accessor(
                    bufferView=draco_buffer_view_index,
                    componentType=5126,  # FLOAT (describes decompressed data)
                    count=n,
                    type='VEC3',
                    max=points_max,
                    min=points_min
                ),
                Accessor(
                    bufferView=draco_buffer_view_index,
                    componentType=5126,  # FLOAT (describes decompressed data)
                    count=n,
                    type='VEC3'
                )
            ],
            bufferViews=[
                BufferView(
                    buffer=0,
                    byteOffset=0,
                    byteLength=len(draco_data)
                )
            ],
            buffers=[Buffer(
                byteLength=len(draco_data)
            )],
            extensionsUsed=['KHR_draco_mesh_compression'],
            extensionsRequired=['KHR_draco_mesh_compression']
        )
        
        # Set binary data (Draco compressed)
        gltf.set_binary_blob(draco_data)
        
        # Save GLB file
        gltf.save(output)
        
        # Get output file size
        output_size = Path(output).stat().st_size
        
        return output_size
    
    finally:
        # Clean up temporary files
        Path(tmp_ply_path).unlink(missing_ok=True)
        Path(tmp_drc_path).unlink(missing_ok=True)


def export_glb_with_meshopt(points: np.ndarray, colors: np.ndarray, output: str, transform: str = 'none') -> int:
    """
    Export point cloud to GLB format with Meshoptimizer compression.
    
    Uses meshoptimizer to compress point cloud data and embeds it into GLB
    using EXT_meshopt_compression extension.
    
    Note: KHR_mesh_quantization is REQUIRED with Meshoptimizer compression.
    This function automatically enables quantization.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        output: Output file path
        transform: Coordinate transformation to apply
        
    Returns:
        Size of output file in bytes
        
    Raises:
        ImportError: If meshoptimizer library is not available
        RuntimeError: If compression fails
    """
    if not HAS_MESHOPTIMIZER:
        raise ImportError(
            "meshoptimizer library is required for Meshoptimizer compression.\n"
            "Install it with: pip install meshoptimizer"
        )
    
    # Apply coordinate transformation
    points_fixed = _transform_coordinates(points, transform)
    
    n = len(points_fixed)
    
    # Quantization is REQUIRED for meshoptimizer
    points_quantized, quant_offset, quant_scale = _quantize_positions(points_fixed)
    # Keep as numpy array for meshoptimizer (it expects array, not bytes)
    pos_data = points_quantized  # shape: (n, 3), dtype: int16
    
    # Colors: use UNSIGNED_BYTE directly
    colors_uint8 = colors.astype(np.uint8)  # shape: (n, 3), dtype: uint8
    
    # Calculate min/max from QUANTIZED positions (integers for SHORT componentType)
    # For componentType=5122 (SHORT), min/max must be integers
    # Use actual min/max from the data to avoid mismatches
    # Convert to Python int to ensure they are proper integers
    points_quantized_min = [int(x) for x in points_quantized.min(axis=0)]
    points_quantized_max = [int(x) for x in points_quantized.max(axis=0)]
    
    # Compress positions using meshoptimizer
    # encode_vertex_buffer expects numpy array or contiguous memory buffer
    # Parameters: vertices (array-like), vertex_count (int), vertex_size (int - bytes per vertex)
    try:
        # Try passing numpy array directly
        # Flatten the array to 1D for meshoptimizer
        pos_flat = pos_data.flatten()  # Flatten to 1D array
        pos_compressed = meshoptimizer.encodeVertexBuffer(pos_flat, vertex_count=n, vertex_size=6)  # 3 * int16 = 6 bytes per position
    except (AttributeError, TypeError, ValueError):
        # Fallback: try snake_case API
        try:
            pos_flat = pos_data.flatten()
            pos_compressed = meshoptimizer.encode_vertex_buffer(pos_flat, vertex_count=n, vertex_size=6)
        except (AttributeError, TypeError, ValueError) as e:
            # Try with bytes if array doesn't work
            try:
                pos_bytes = pos_data.tobytes()
                pos_compressed = meshoptimizer.encode_vertex_buffer(pos_bytes, vertex_count=n, vertex_size=6)
            except Exception as e2:
                raise RuntimeError(
                    f"Failed to compress positions with meshoptimizer. "
                    f"Tried array and bytes formats. Last error: {e2}. "
                    f"Please ensure you have the correct version of meshoptimizer installed."
                )
    
    # Compress colors using meshoptimizer
    try:
        # Try passing numpy array directly
        col_flat = colors_uint8.flatten()  # Flatten to 1D array
        col_compressed = meshoptimizer.encodeVertexBuffer(col_flat, vertex_count=n, vertex_size=3)  # 3 * uint8 = 3 bytes per color
    except (AttributeError, TypeError, ValueError):
        # Fallback: try snake_case API
        try:
            col_flat = colors_uint8.flatten()
            col_compressed = meshoptimizer.encode_vertex_buffer(col_flat, vertex_count=n, vertex_size=3)
        except (AttributeError, TypeError, ValueError) as e:
            # Try with bytes if array doesn't work
            try:
                col_bytes = colors_uint8.tobytes()
                col_compressed = meshoptimizer.encode_vertex_buffer(col_bytes, vertex_count=n, vertex_size=3)
            except Exception as e2:
                raise RuntimeError(
                    f"Failed to compress colors with meshoptimizer. "
                    f"Tried array and bytes formats. Last error: {e2}. "
                    f"Please ensure you have the correct version of meshoptimizer installed."
                )
    
    # Convert compressed data to bytes if it's not already
    # meshoptimizer.encodeVertexBuffer may return bytes, numpy array, or other format
    if isinstance(pos_compressed, np.ndarray):
        pos_compressed = pos_compressed.tobytes()
    elif not isinstance(pos_compressed, bytes):
        try:
            pos_compressed = bytes(pos_compressed) if hasattr(pos_compressed, '__iter__') else bytes([pos_compressed])
        except (TypeError, ValueError):
            raise RuntimeError(f"Unexpected type for compressed positions: {type(pos_compressed)}")
    
    if isinstance(col_compressed, np.ndarray):
        col_compressed = col_compressed.tobytes()
    elif not isinstance(col_compressed, bytes):
        try:
            col_compressed = bytes(col_compressed) if hasattr(col_compressed, '__iter__') else bytes([col_compressed])
        except (TypeError, ValueError):
            raise RuntimeError(f"Unexpected type for compressed colors: {type(col_compressed)}")
    
    # Calculate original sizes for comparison
    # Original size = number of points * bytes per point
    pos_bytes_original = pos_data.nbytes  # Total bytes in quantized positions: n * 3 * 2 (int16)
    col_bytes_original = colors_uint8.nbytes  # Total bytes in colors: n * 3 * 1 (uint8)
    
    # Verify sizes are reasonable
    if pos_bytes_original <= 0 or col_bytes_original <= 0:
        raise RuntimeError(f"Invalid original sizes: pos={pos_bytes_original}, col={col_bytes_original}")
    if len(pos_compressed) <= 0 or len(col_compressed) <= 0:
        raise RuntimeError(f"Invalid compressed sizes: pos={len(pos_compressed)}, col={len(col_compressed)}")
    
    # Create buffer views for compressed data
    pos_buffer_view_index = 0
    col_buffer_view_index = 1
    
    # Calculate offsets in the combined buffer with 4-byte alignment
    # Start with 4-byte aligned offset (0 is already aligned)
    pos_offset_aligned = 0
    
    # Calculate aligned offset for colors (4-byte alignment)
    # After pos_compressed, align to next 4-byte boundary
    col_offset_aligned = ((pos_offset_aligned + len(pos_compressed) + 3) // 4) * 4
    
    # Create GLTF2 structure with EXT_meshopt_compression
    position_accessor = Accessor(
        bufferView=pos_buffer_view_index,
        componentType=5122,  # SHORT (quantized)
        count=n,
        type='VEC3',
        max=points_quantized_max,  # Use quantized min/max (integers for SHORT)
        min=points_quantized_min,  # Use quantized min/max (integers for SHORT)
        extensions={
            'KHR_mesh_quantization': {
                'quantizedAttributes': ['POSITION'],
                'quantizationOffset': quant_offset,
                'quantizationScale': quant_scale
            }
        }
    )
    
    # Create buffer views with EXT_meshopt_compression extension
    # According to glTF spec, extension should only contain:
    # - byteLength: uncompressed size
    # - byteStride: stride between elements
    # - mode: 'ATTRIBUTES' or 'TRIANGLES'
    # - filter: 'NONE' or compression filter type
    # buffer and byteOffset are already in BufferView, not in extension
    # Ensure 4-byte alignment for byteOffset (required by glTF spec)
    # For EXT_meshopt_compression:
    # - bufferView.byteLength = compressed size (in buffer)
    # - extension.byteLength = uncompressed size (for decompression)
    # - accessor describes decompressed data
    pos_buffer_view = BufferView(
        buffer=0,
        byteOffset=pos_offset_aligned,  # Aligned to 4 bytes (0 is already aligned)
        byteLength=len(pos_compressed),  # Compressed size in buffer
        target=34962,  # ARRAY_BUFFER for vertex data (required by glTF spec)
        extensions={
            'EXT_meshopt_compression': {
                'byteLength': pos_bytes_original,  # Original uncompressed size (for decompression)
                'byteStride': 6,  # 3 * int16 = 6 bytes per position
                'mode': 'ATTRIBUTES',
                'filter': 'NONE'
            }
        }
    )
    
    col_buffer_view = BufferView(
        buffer=0,
        byteOffset=col_offset_aligned,  # Aligned to 4 bytes
        byteLength=len(col_compressed),  # Compressed size in buffer
        target=34962,  # ARRAY_BUFFER for vertex data (required by glTF spec)
        extensions={
            'EXT_meshopt_compression': {
                'byteLength': col_bytes_original,  # Original uncompressed size (for decompression)
                'byteStride': 3,  # 3 * uint8 = 3 bytes per color
                'mode': 'ATTRIBUTES',
                'filter': 'NONE'
            }
        }
    )
    
    gltf = GLTF2(
        scene=0,
        scenes=[Scene(nodes=[0])],
        nodes=[Node(mesh=0)],
        meshes=[Mesh(
            primitives=[Primitive(
                attributes={'POSITION': 0, 'COLOR_0': 1},
                mode=0  # POINTS
            )]
        )],
        accessors=[
            position_accessor,
            Accessor(
                bufferView=col_buffer_view_index,
                componentType=5121,  # UNSIGNED_BYTE
                normalized=True,     # Normalized to [0, 1] range
                count=n,
                type='VEC3',
                # For UNSIGNED_BYTE normalized colors, min/max are optional
                min=[0, 0, 0],
                max=[1, 1, 1]
            )
        ],
        bufferViews=[pos_buffer_view, col_buffer_view],
        buffers=[Buffer(
            byteLength=col_offset_aligned + len(col_compressed)  # Total size with alignment padding
            # For GLB files, buffer should not have uri field (it uses binary chunk)
        )],
        extensionsUsed=['KHR_mesh_quantization', 'EXT_meshopt_compression'],
        extensionsRequired=['KHR_mesh_quantization', 'EXT_meshopt_compression']
    )
    
    # Set binary data (compressed) with 4-byte alignment padding
    # Add padding between pos and col data to ensure 4-byte alignment
    padding_size = col_offset_aligned - (pos_offset_aligned + len(pos_compressed))
    padding = b'\x00' * padding_size if padding_size > 0 else b''
    
    binary_data = pos_compressed + padding + col_compressed
    total_buffer_size = col_offset_aligned + len(col_compressed)
    
    # Verify binary data size matches buffer size
    if len(binary_data) != total_buffer_size:
        raise RuntimeError(
            f"Binary data size mismatch: expected {total_buffer_size}, got {len(binary_data)}. "
            f"Pos compressed: {len(pos_compressed)}, Padding: {padding_size}, Col compressed: {len(col_compressed)}"
        )
    
    gltf.set_binary_blob(binary_data)
    
    # Save GLB file
    gltf.save(output)
    
    # Get output file size
    output_size = Path(output).stat().st_size
    
    return output_size


def export_draco(points: np.ndarray, colors: np.ndarray, output: str, transform: str = 'none') -> int:
    """
    Export point cloud to pure Draco format (.drc).
    
    Uses draco_encoder to compress point cloud data.
    Reference: https://google.github.io/draco/
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        output: Output file path (.drc)
        transform: Coordinate transformation to apply
        
    Returns:
        Size of output file in bytes
        
    Raises:
        FileNotFoundError: If draco_encoder is not found
        subprocess.CalledProcessError: If draco_encoder fails
    """
    # Apply coordinate transformation
    points_fixed = _transform_coordinates(points, transform)
    
    # Create temporary PLY file for draco_encoder
    with tempfile.NamedTemporaryFile(suffix='.ply', delete=False) as tmp:
        tmp_path = tmp.name
    
    try:
        # Create PLY file with points and colors
        n = len(points_fixed)
        
        # Prepare vertex data
        vertex_data = np.empty(
            n,
            dtype=[
                ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
                ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')
            ]
        )
        
        vertex_data['x'] = points_fixed[:, 0]
        vertex_data['y'] = points_fixed[:, 1]
        vertex_data['z'] = points_fixed[:, 2]
        vertex_data['red'] = colors[:, 0]
        vertex_data['green'] = colors[:, 1]
        vertex_data['blue'] = colors[:, 2]
        
        # Create PLY element
        el = PlyElement.describe(vertex_data, 'vertex')
        
        # Write PLY file
        PlyData([el], text=False).write(tmp_path)
        
        # Compress to Draco format using draco_encoder
        # Parameters:
        # -cl 7: compression level (0-10, 7 is good balance)
        # -qp 14: quantization bits for positions (10-30, 14 is default)
        # -qc 10: quantization bits for colors (8-12, 10 is default)
        subprocess.run([
            'draco_encoder',
            '-i', tmp_path,
            '-o', output,
            '-cl', '7',
            '-qp', '14',
            '-qc', '10',
            '-point_cloud'  # Specify point cloud mode
        ], check=True, capture_output=True, text=True)
        
        # Get output file size
        output_size = Path(output).stat().st_size
        
        return output_size
    
    finally:
        # Clean up temporary file
        Path(tmp_path).unlink(missing_ok=True)
