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


def _decode_webp_indices(zip_ref, filename):
    """Decode WebP image and return as uint8 indices."""
    img_data = zip_ref.read(filename)
    img = Image.open(io.BytesIO(img_data))
    return np.array(img, dtype=np.uint8)


def _decode_quantized_values(indices, codebook):
    """Decode quantized values using codebook."""
    codebook = np.array(codebook, dtype=np.float32)
    return codebook[indices.flatten()].reshape(indices.shape)


def read_sog(filepath: str):
    """
    Read point cloud from .sog file (Gaussian Splatting format).
    
    .sog files are ZIP archives containing WebP images and metadata.
    
    Args:
        filepath: Path to .sog file
        
    Returns:
        Tuple of (points, colors) where:
        - points: numpy array of shape (N, 3) with float32 coordinates
        - colors: numpy array of shape (N, 3) with uint8 RGB values
                  converted from Spherical Harmonics coefficients
    """
    import io
    
    with zipfile.ZipFile(filepath, 'r') as zip_ref:
        # Read metadata
        meta_data = json.loads(zip_ref.read('meta.json').decode('utf-8'))
        count = meta_data['count']
        
        # Decode positions from means_l.webp and means_u.webp
        means_l_indices = _decode_webp_indices(zip_ref, 'means_l.webp')
        means_u_indices = _decode_webp_indices(zip_ref, 'means_u.webp')
        
        # Decode using codebook (means codebook is not in meta, so we use linear interpolation)
        # For means, we need to decode from indices using mins/maxs
        means_info = meta_data['means']
        mins = np.array(means_info['mins'], dtype=np.float32)
        maxs = np.array(means_info['maxs'], dtype=np.float32)
        
        # means_l and means_u are quantized, need to decode
        # Assuming 8-bit quantization (0-255 maps to mins-maxs)
        means_l = means_l_indices.astype(np.float32) / 255.0
        means_u = means_u_indices.astype(np.float32) / 255.0
        
        # Combine means_l and means_u to get full positions
        # means_l contains lower bits, means_u contains upper bits
        # For simplicity, we'll use means_l as base and add means_u scaled
        means_combined = means_l + means_u * 256.0
        
        # Reshape to (N, 3) and denormalize
        if means_combined.size == count * 3:
            means_flat = means_combined.flatten()[:count * 3]
        else:
            # If shape doesn't match, try to reshape
            h, w = means_l.shape[:2]
            means_flat = means_combined.flatten()[:count * 3]
        
        points = means_flat.reshape(count, 3)
        
        # Denormalize using mins and maxs
        points = points * (maxs - mins) + mins
        
        # Decode colors from sh0.webp
        sh0_info = meta_data.get('sh0', {})
        if 'codebook' in sh0_info and 'files' in sh0_info:
            sh0_indices = _decode_webp_indices(zip_ref, 'sh0.webp')
            sh0_codebook = np.array(sh0_info['codebook'], dtype=np.float32)
            
            # Decode sh0 values
            sh0_values = _decode_quantized_values(sh0_indices, sh0_codebook)
            
            # Extract first 3 components (RGB) from sh0
            # sh0 contains Spherical Harmonics DC component
            SH_C0 = 0.28209479177387814
            
            if sh0_values.size >= count * 3:
                sh0_flat = sh0_values.flatten()[:count * 3]
                sh0_rgb = sh0_flat.reshape(count, 3)
                
                # Convert SH to RGB
                colors = np.clip((0.5 + SH_C0 * sh0_rgb) * 255, 0, 255).astype(np.uint8)
            else:
                # Fallback: use white color
                colors = np.full((count, 3), 255, dtype=np.uint8)
        else:
            # No color data, use white
            colors = np.full((count, 3), 255, dtype=np.uint8)
    
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

