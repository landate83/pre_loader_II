"""Module for downsampling point clouds using Voxel Grid Nearest method."""

import numpy as np
from typing import Tuple, Optional, Callable


def downsample_voxel_grid_nearest(
    points: np.ndarray,
    colors: np.ndarray,
    voxel_size: float,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Downsample point cloud by selecting the nearest point to centroid in each voxel.
    
    This method preserves original coordinates (does not average them).
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        voxel_size: Size of voxel grid cells
        progress_callback: Optional callback function(current_count, total_voxels) for progress updates
        
    Returns:
        Tuple of (downsampled_points, downsampled_colors, selected_indices)
    """
    # Calculate voxel grid indices
    grid_indices = np.floor(points / voxel_size).astype(np.int64)
    
    # Normalize indices to start from 0
    offset = grid_indices.min(axis=0)
    grid_indices -= offset
    max_idx = grid_indices.max(axis=0) + 1
    
    # Create unique keys for each voxel
    voxel_keys = (
        grid_indices[:, 0] * (max_idx[1] * max_idx[2]) +
        grid_indices[:, 1] * max_idx[2] +
        grid_indices[:, 2]
    )
    
    # Sort points by voxel key
    sorted_indices = np.argsort(voxel_keys)
    sorted_keys = voxel_keys[sorted_indices]
    
    # Find unique voxels and their groups
    unique_keys, group_starts = np.unique(sorted_keys, return_index=True)
    group_ends = np.append(group_starts[1:], len(sorted_keys))
    
    total_voxels = len(unique_keys)
    
    # Select nearest point to centroid in each voxel
    selected_indices = np.empty(total_voxels, dtype=np.int64)
    
    for i, (start, end) in enumerate(zip(group_starts, group_ends)):
        group_point_indices = sorted_indices[start:end]
        group_points = points[group_point_indices]
        centroid = group_points.mean(axis=0)
        distances = np.linalg.norm(group_points - centroid, axis=1)
        selected_indices[i] = group_point_indices[np.argmin(distances)]
        
        # Call progress callback if provided
        if progress_callback:
            progress_callback(i + 1, total_voxels)
    
    return points[selected_indices], colors[selected_indices], selected_indices


def find_voxel_size_for_target(points: np.ndarray, target: int, tol: float = 0.05) -> float:
    """
    Find voxel size using binary search to achieve target point count.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        target: Target number of points after downsampling
        tol: Tolerance for target count (default: 0.05 = 5%)
        
    Returns:
        Optimal voxel size
    """
    bbox_diag = np.linalg.norm(points.max(0) - points.min(0))
    vmin = bbox_diag / (target ** (1/3) * 10)
    vmax = bbox_diag / 2
    
    vmid = (vmin + vmax) / 2
    
    for _ in range(50):
        vmid = (vmin + vmax) / 2
        grid_indices = np.floor(points / vmid).astype(np.int64)
        unique_indices = np.unique(grid_indices, axis=0)
        count = len(unique_indices)
        
        if abs(count - target) / target <= tol:
            return vmid
        
        if count > target:
            vmin = vmid
        else:
            vmax = vmid
    
    return vmid


def estimate_file_size(points_count: int, output_format: str = 'glb', draco: bool = False) -> int:
    """
    Estimate file size based on point count and output format.
    
    Args:
        points_count: Number of points
        output_format: Output format ('glb' or 'drc')
        draco: Whether Draco compression is used (for GLB)
        
    Returns:
        Estimated file size in bytes
    """
    # Base overhead for GLB (JSON, headers, etc.)
    glb_overhead = 3000  # ~3 KB overhead for GLB structure
    
    if output_format == 'drc':
        # Pure Draco format: ~6-7 bytes per point after compression
        bytes_per_point = 6.5
        overhead = 100  # Minimal overhead for Draco
    elif draco:
        # GLB with Draco compression: ~5.7 bytes per point + GLB overhead
        # Based on actual measurements: 90KB for 15,767 points = ~5.7 bytes/point
        bytes_per_point = 5.7
        overhead = glb_overhead
    else:
        # GLB without compression: 9 bytes per point
        # - Positions: 6 bytes (SHORT with KHR_mesh_quantization)
        # - Colors: 3 bytes (UNSIGNED_BYTE normalized)
        bytes_per_point = 9.0
        overhead = glb_overhead
    
    return int(points_count * bytes_per_point + overhead)


def calculate_target_points_for_size(
    target_size_bytes: int,
    output_format: str = 'glb',
    draco: bool = False
) -> int:
    """
    Calculate target number of points to achieve desired file size.
    
    Uses iterative approach to account for overhead and compression ratios.
    
    Args:
        target_size_bytes: Target file size in bytes
        output_format: Output format ('glb' or 'drc')
        draco: Whether Draco compression is used (for GLB)
        
    Returns:
        Target number of points
    """
    # Base overhead for GLB
    glb_overhead = 3000 if output_format == 'glb' else 100
    
    if output_format == 'drc':
        bytes_per_point = 6.5
    elif draco:
        bytes_per_point = 5.7  # Adjusted based on actual measurements
    else:
        bytes_per_point = 24.0
    
    # Initial estimate
    available_bytes = max(1, target_size_bytes - glb_overhead)
    initial_estimate = int(available_bytes / bytes_per_point)
    
    # Refine estimate iteratively
    for _ in range(5):
        estimated_size = estimate_file_size(initial_estimate, output_format, draco)
        if estimated_size == 0:
            break
        
        # Adjust based on difference
        ratio = target_size_bytes / estimated_size
        initial_estimate = int(initial_estimate * ratio)
        
        # Prevent infinite loop
        if abs(estimated_size - target_size_bytes) / target_size_bytes < 0.01:
            break
    
    return max(1, initial_estimate)


def downsample_to_target(
    points: np.ndarray,
    colors: np.ndarray,
    target_count: int = None,
    target_size_bytes: int = None,
    output_format: str = 'glb',
    draco: bool = False,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Downsample point cloud to target count or size.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        target_count: Target number of points (optional)
        target_size_bytes: Target file size in bytes (optional)
        output_format: Output format ('glb' or 'drc')
        draco: Whether Draco compression is used (for GLB)
        progress_callback: Optional callback function(current_count, total_voxels) for progress updates
        
    Returns:
        Tuple of (downsampled_points, downsampled_colors)
        
    Raises:
        ValueError: If neither target_count nor target_size_bytes is provided
    """
    if target_count is None and target_size_bytes:
        # Use improved size estimation
        target_count = calculate_target_points_for_size(
            target_size_bytes, output_format, draco
        )
    
    if target_count is None:
        raise ValueError("Specify target_count or target_size_bytes")
    
    if target_count >= len(points):
        return points, colors
    
    voxel_size = find_voxel_size_for_target(points, target_count)
    pts, cols, _ = downsample_voxel_grid_nearest(points, colors, voxel_size, progress_callback)
    return pts, cols

