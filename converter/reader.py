"""Module for reading point cloud files (.ply and .sog formats)."""

import io
import json
import os
import tempfile
import zipfile
import numpy as np
from PIL import Image
from plyfile import PlyData
from pathlib import Path


def read_ply(filepath: str):
    """
    Read point cloud from .ply file.
    Handles both regular PLY files and ZIP archives containing PLY files.
    
    Args:
        filepath: Path to .ply file (or ZIP archive with .ply extension)
        
    Returns:
        Tuple of (points, colors) where:
        - points: numpy array of shape (N, 3) with float32 coordinates
        - colors: numpy array of shape (N, 3) with uint8 RGB values
    """
    # Check if file is actually a ZIP archive
    try:
        with zipfile.ZipFile(filepath, 'r') as zip_ref:
            # Find PLY file in archive
            ply_files = [f for f in zip_ref.namelist() if f.endswith('.ply')]
            if ply_files:
                # Extract first PLY file to temporary location
                with tempfile.NamedTemporaryFile(suffix='.ply', delete=False) as tmp:
                    tmp_path = tmp.name
                    tmp.write(zip_ref.read(ply_files[0]))
                
                try:
                    ply = PlyData.read(tmp_path)
                finally:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
            else:
                # Not a ZIP or no PLY inside, try reading as regular PLY
                ply = PlyData.read(filepath)
    except (zipfile.BadZipFile, zipfile.LargeZipFile):
        # Not a ZIP file, read as regular PLY
        ply = PlyData.read(filepath)
    
    v = ply['vertex']
    points = np.column_stack([v['x'], v['y'], v['z']]).astype(np.float32)
    
    # Check for RGB colors first
    if 'red' in v and 'green' in v and 'blue' in v:
        colors = np.column_stack([
            v['red'],
            v['green'],
            v['blue']
        ]).astype(np.uint8)
    # Check for Spherical Harmonics coefficients (Gaussian Splatting format)
    elif 'f_dc_0' in v and 'f_dc_1' in v and 'f_dc_2' in v:
        # Convert Spherical Harmonics DC component to RGB
        # SH_C0 is the constant for the DC (l=0, m=0) term
        SH_C0 = 0.28209479177387814
        colors = np.column_stack([
            np.clip((0.5 + SH_C0 * v['f_dc_0']) * 255, 0, 255),
            np.clip((0.5 + SH_C0 * v['f_dc_1']) * 255, 0, 255),
            np.clip((0.5 + SH_C0 * v['f_dc_2']) * 255, 0, 255)
        ]).astype(np.uint8)
    else:
        # No color data available, use white as fallback
        colors = np.full((len(points), 3), 255, dtype=np.uint8)
    
    return points, colors


def _decode_webp_indices(zip_ref, filename, mode=None):
    """
    Decode webp file from zip to numpy array with enforced mode.
    
    Args:
        zip_ref: ZipFile object
        filename: Name of the file in the zip
        mode: 'RGB' for vectors (means), 'L' for scalar indices (sh0)
              If None, uses image's native mode
    
    Returns:
        numpy array of the image data, or None if file not found
    """
    try:
        with zip_ref.open(filename) as f:
            image_data = f.read()
            image = Image.open(io.BytesIO(image_data))
            
            # Force specific mode to ensure correct array shape
            # 'RGB' ensures (H, W, 3) - drops Alpha if present
            # 'L' ensures (H, W) - flattens RGB to single channel if present
            if mode:
                image = image.convert(mode)
                
            return np.array(image)
    except KeyError:
        return None


def _decode_quantized_values(indices, codebook):
    """
    Map indices to values using the codebook.
    
    Supports broadcasting: if indices is (N, 3) and codebook is (256,),
    the result will be (N, 3) where each element is looked up from codebook.
    """
    codebook = np.array(codebook, dtype=np.float32)
    # Clip indices to stay within bounds
    indices = np.clip(indices, 0, len(codebook) - 1)
    # Numpy broadcasting handles mapping:
    # If indices is (N, 3) and codebook is (256,), result is (N, 3)
    return codebook[indices]


def _inv_log_transform_vectorized(v):
    """
    Inverse logarithmic transform for SOG coordinate decoding.
    
    Python implementation of TypeScript:
    const invLogTransform = (v: number) => {
        const a = Math.abs(v);
        const e = Math.exp(a) - 1; // |x|
        return v < 0 ? -e : e;
    };
    
    SOG files store coordinates in logarithmic space to compress large ranges.
    This function converts log-space coordinates back to linear space.
    
    Args:
        v: numpy array of coordinates in log-space
        
    Returns:
        numpy array of coordinates in linear space
    """
    # Vectorized version for numpy (works with entire arrays)
    a = np.abs(v)
    e = np.expm1(a)  # exp(x) - 1, more accurate for small numbers
    return np.sign(v) * e


def read_sog(filepath: str):
    """
    Read point cloud from .sog file (Gaussian Splatting format).
    Correctly handles texture unpacking for Geometry (RGB) and Color Indices (Grayscale).
    
    .sog files are ZIP archives containing WebP images and metadata.
    
    Args:
        filepath: Path to .sog file
        
    Returns:
        Tuple of (points, colors) where:
        - points: numpy array of shape (N, 3) with float32 coordinates
        - colors: numpy array of shape (N, 3) with uint8 RGB values
                  converted from Spherical Harmonics coefficients
    """
    with zipfile.ZipFile(filepath, 'r') as zip_ref:
        # Read metadata
        meta_data = json.loads(zip_ref.read('meta.json').decode('utf-8'))
        count = meta_data['count']
        
        # --- 1. DECODE GEOMETRY ---
        # Get filenames from metadata if available, fallback to defaults
        means_info = meta_data['means']
        f_l = means_info.get('files', ['means_l.webp'])[0] if 'files' in means_info else 'means_l.webp'
        f_u = means_info.get('files', ['means_u.webp'])[1] if 'files' in means_info and len(means_info['files']) > 1 else 'means_u.webp'
        
        # Force RGB mode to ensure we get exactly 3 channels (R,G,B) and no Alpha
        means_l_img = _decode_webp_indices(zip_ref, f_l, mode='RGB')
        means_u_img = _decode_webp_indices(zip_ref, f_u, mode='RGB')
        
        if means_l_img is None or means_u_img is None:
            # Try standard names if metadata was empty
            means_l_img = _decode_webp_indices(zip_ref, 'means_l.webp', mode='RGB')
            means_u_img = _decode_webp_indices(zip_ref, 'means_u.webp', mode='RGB')
            if means_l_img is None:
                raise ValueError("Critical: Geometry textures not found.")

        # Reshape images to lists of pixels (N, 3)
        # We flatten the image dimensions (HxW) but keep the RGB triplets
        l_flat = means_l_img.reshape(-1, 3)[:count]
        u_flat = means_u_img.reshape(-1, 3)[:count]
        
        # Convert to float and reconstruct 16-bit values
        l_vals = l_flat.astype(np.float32)
        u_vals = u_flat.astype(np.float32)
        
        # Reconstruct: Low + High * 256
        val_16bit = l_vals + u_vals * 256.0
        
        # Normalize 0..65535 -> 0.0..1.0
        means_normalized = val_16bit / 65535.0
        
        # Apply Bounding Box
        mins = np.array(means_info['mins'], dtype=np.float32)
        maxs = np.array(means_info['maxs'], dtype=np.float32)
        
        # Scale: normalized * range + min
        # At this point we have log-space coordinates
        log_points = means_normalized * (maxs - mins) + mins
        
        # CRITICAL: Inverse logarithmic transform
        # SOG stores coordinates in logarithmic space to compress large ranges.
        # We need to convert them back to linear space (real meters).
        # Without this, coordinates are compressed and models appear as tiny cubes.
        points = _inv_log_transform_vectorized(log_points)
        
        # --- 2. DECODE COLORS ---
        sh0_info = meta_data.get('sh0', {})
        colors = None
        
        if 'codebook' in sh0_info and 'files' in sh0_info:
            # Get filename from metadata, fallback to default
            sh0_filename = sh0_info['files'][0] if sh0_info['files'] else 'sh0.webp'
            
            # Read indices as RGB (3 channels = 3 separate indices)
            # Each channel (R, G, B) is a separate index for its color component
            sh0_indices_img = _decode_webp_indices(zip_ref, sh0_filename, mode='RGB')
            
            if sh0_indices_img is not None:
                # Reshape to (N, 3) - each row has 3 indices [R_index, G_index, B_index]
                sh0_indices_flat = sh0_indices_img.reshape(-1, 3)[:count]
                
                # Codebook remains 1D (256 scalar values)
                # Each index points to a single value in the codebook
                sh0_codebook = np.array(sh0_info['codebook'], dtype=np.float32)
                
                # Mapping: (N, 3) indices -> (N, 3) values
                # numpy broadcasting: codebook[indices] where indices is (N, 3) and codebook is (256,)
                # results in (N, 3) array
                sh0_values = _decode_quantized_values(sh0_indices_flat, sh0_codebook)
                
                # SH to RGB conversion
                SH_C0 = 0.28209479177387814
                colors = np.clip((0.5 + SH_C0 * sh0_values) * 255, 0, 255).astype(np.uint8)
        
        # Fallback and size validation
        if colors is None:
            colors = np.full((count, 3), 255, dtype=np.uint8)
        
        # Final safety check: ensure colors is a 2D array (N, 3)
        if colors.ndim == 1:
            colors = colors.reshape(-1, 3)
        
        # Ensure correct count
        if len(colors) < count:
            padding = np.full((count - len(colors), 3), 255, dtype=np.uint8)
            colors = np.vstack((colors, padding))
        elif len(colors) > count:
            colors = colors[:count]
    
    return points.astype(np.float32), colors


def read_point_cloud(filepath: str):
    """
    Read point cloud from file, automatically detecting format.
    
    Args:
        filepath: Path to point cloud file (.ply or .sog)
        
    Returns:
        Tuple of (points, colors)
        
    Raises:
        ValueError: If file format is not supported
    """
    ext = Path(filepath).suffix.lower()
    
    if ext == '.ply':
        return read_ply(filepath)
    elif ext == '.sog':
        return read_sog(filepath)
    else:
        raise ValueError(f"Unsupported format: {ext}")

