#!/usr/bin/env python3
"""Script to generate multiple GLB files with different coordinate transformations."""

from converter.reader import read_point_cloud
from converter.downsampler import downsample_to_target
from converter.exporter import export_glb_with_draco

# List of transformations to test
transforms = [
    ('none', 'No transformation'),
    ('neg_y', 'Invert Y: (x,y,z) -> (x,-y,z)'),
    ('neg_z', 'Invert Z: (x,y,z) -> (x,y,-z)'),
    ('neg_x', 'Invert X: (x,y,z) -> (-x,y,z)'),
    ('swap_yz_neg_y', 'Swap Y and Z, negate new Y: (x,y,z) -> (x,-z,y)'),
    ('swap_yz_neg_z', 'Swap Y and Z, negate new Z: (x,y,z) -> (x,z,-y)'),
    ('swap_yz', 'Swap Y and Z: (x,y,z) -> (x,z,y)'),
    ('neg_all', 'Negate all axes: (x,y,z) -> (-x,-y,-z)'),
]

def main():
    input_file = 'tests/Bull_.ply'
    target_points = 5000
    
    print(f"Reading file: {input_file}")
    pts, cols = read_point_cloud(input_file)
    print(f"Source points: {len(pts):,}")
    
    print(f"\nDownsampling to {target_points:,} points...")
    pts, cols = downsample_to_target(pts, cols, target_count=target_points)
    print(f"After downsampling: {len(pts):,} points\n")
    
    print("Creating variants with different coordinate transformations:\n")
    
    for transform_name, transform_desc in transforms:
        output_file = f'tests/bull_ply_{transform_name}.glb'
        print(f"{transform_name:20s} - {transform_desc}")
        print(f"  -> {output_file}")
        
        try:
            output_size = export_glb_with_draco(pts, cols, output_file, transform=transform_name)
            print(f"  ✓ Created: {output_size:,} bytes\n")
        except Exception as e:
            print(f"  ✗ Error: {e}\n")
    
    print("\nAll variants created! Check visually which file displays correctly.")

if __name__ == '__main__':
    main()

