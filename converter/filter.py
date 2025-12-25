"""Module for filtering point clouds by sphere or hemisphere."""

import numpy as np
from typing import Tuple, Literal


def calculate_geometric_center(points: np.ndarray) -> np.ndarray:
    """
    Calculate geometric center (centroid) of point cloud.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        
    Returns:
        Array of shape (3,) with center coordinates
    """
    return points.mean(axis=0)


def calculate_bbox_diagonal(points: np.ndarray) -> float:
    """
    Calculate diagonal of bounding box.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        
    Returns:
        Diagonal length (scalar)
    """
    points_min = points.min(axis=0)
    points_max = points.max(axis=0)
    return np.linalg.norm(points_max - points_min)


def filter_sphere(
    points: np.ndarray,
    colors: np.ndarray,
    center: np.ndarray,
    radius: float
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Filter point cloud to keep only points within a sphere.
    
    Uses squared distance comparison to avoid square root calculation.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        center: Array of shape (3,) with sphere center coordinates
        radius: Sphere radius (absolute units)
        
    Returns:
        Tuple of (filtered_points, filtered_colors)
    """
    # Calculate squared distances from center
    # (x-cx)² + (y-cy)² + (z-cz)²
    diff = points - center
    squared_distances = np.sum(diff ** 2, axis=1)
    radius_squared = radius ** 2
    
    # Boolean mask: points within sphere
    mask = squared_distances <= radius_squared
    
    return points[mask], colors[mask]


def filter_hemisphere(
    points: np.ndarray,
    colors: np.ndarray,
    center: np.ndarray,
    radius: float,
    up_axis: Literal['y', 'z'] = 'y'
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Filter point cloud to keep only points within a hemisphere.
    
    Hemisphere is defined as the upper half of a sphere (points above the center
    along the specified up axis).
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        center: Array of shape (3,) with sphere center coordinates
        radius: Sphere radius (absolute units)
        up_axis: 'y' for Y-up (default) or 'z' for Z-up
        
    Returns:
        Tuple of (filtered_points, filtered_colors)
    """
    # First filter by sphere
    diff = points - center
    squared_distances = np.sum(diff ** 2, axis=1)
    radius_squared = radius ** 2
    sphere_mask = squared_distances <= radius_squared
    
    # Then filter by hemisphere (upper half)
    if up_axis == 'y':
        # Y-up: keep points where y >= center_y
        hemisphere_mask = points[:, 1] >= center[1]
    else:  # up_axis == 'z'
        # Z-up: keep points where z >= center_z
        hemisphere_mask = points[:, 2] >= center[2]
    
    # Combine both conditions
    mask = sphere_mask & hemisphere_mask
    
    return points[mask], colors[mask]


def apply_sphere_filter(
    points: np.ndarray,
    colors: np.ndarray,
    filter_type: Literal['sphere', 'hemisphere'],
    center_type: str | np.ndarray,
    radius_relative: float,
    up_axis: Literal['y', 'z'] = 'y'
) -> Tuple[np.ndarray, np.ndarray, dict]:
    """
    Apply sphere or hemisphere filtering to point cloud.
    
    This is the main entry point for filtering. It calculates the center and
    absolute radius based on the provided parameters.
    
    Args:
        points: Array of shape (N, 3) with point coordinates
        colors: Array of shape (N, 3) with point colors
        filter_type: 'sphere' or 'hemisphere'
        center_type: 'origin' for (0,0,0), 'geometric' for centroid, or array [x, y, z] for custom center
        radius_relative: Radius in relative units (0.0-1.0 = 0%-100% of bbox diagonal)
        up_axis: 'y' for Y-up or 'z' for Z-up (only for hemisphere)
        
    Returns:
        Tuple of (filtered_points, filtered_colors, info_dict)
        info_dict contains: 'center', 'radius_absolute', 'points_before', 'points_after'
    """
    points_before = len(points)
    
    # Calculate center
    if isinstance(center_type, np.ndarray):
        # Custom center coordinates provided
        center = center_type.astype(np.float32)
    elif center_type == 'origin':
        center = np.array([0.0, 0.0, 0.0], dtype=np.float32)
    else:  # center_type == 'geometric'
        center = calculate_geometric_center(points)
    
    # Calculate absolute radius from relative radius
    bbox_diagonal = calculate_bbox_diagonal(points)
    radius_absolute = radius_relative * bbox_diagonal
    
    # Apply filtering
    if filter_type == 'sphere':
        filtered_points, filtered_colors = filter_sphere(
            points, colors, center, radius_absolute
        )
    else:  # filter_type == 'hemisphere'
        filtered_points, filtered_colors = filter_hemisphere(
            points, colors, center, radius_absolute, up_axis
        )
    
    points_after = len(filtered_points)
    
    info = {
        'center': center,
        'radius_absolute': radius_absolute,
        'radius_relative': radius_relative,
        'points_before': points_before,
        'points_after': points_after
    }
    
    return filtered_points, filtered_colors, info

