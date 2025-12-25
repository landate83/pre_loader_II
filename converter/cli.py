"""Command-line interface for point cloud converter."""

import os
import sys
import subprocess
import threading
import time
import click
from pathlib import Path
from .reader import read_point_cloud
from .downsampler import downsample_to_target
from .exporter import export_glb, export_glb_with_draco, export_glb_with_meshopt, export_draco
from .filter import apply_sphere_filter
import numpy as np


def parse_center_coordinates(center_str: str) -> str | np.ndarray:
    """
    Parse center coordinates from string.
    
    Args:
        center_str: String with center specification:
                   - 'origin' or 'geometric' for predefined centers
                   - 'x,y,z' or 'x y z' for custom coordinates (three numbers)
        
    Returns:
        Either string ('origin' or 'geometric') or numpy array with coordinates [x, y, z]
        
    Raises:
        ValueError: If format is invalid
    """
    center_str = center_str.strip().lower()
    
    # Check for predefined centers
    if center_str in ['origin', 'geometric']:
        return center_str
    
    # Try to parse as coordinates
    # Support both comma-separated and space-separated formats
    if ',' in center_str:
        parts = center_str.split(',')
    else:
        parts = center_str.split()
    
    if len(parts) != 3:
        raise ValueError(
            f"Invalid center format: '{center_str}'. "
            "Expected 'origin', 'geometric', or three numbers (e.g., '1.0,2.0,3.0' or '1.0 2.0 3.0')"
        )
    
    try:
        coords = [float(p.strip()) for p in parts]
        return np.array(coords, dtype=np.float32)
    except ValueError as e:
        raise ValueError(
            f"Invalid center coordinates: '{center_str}'. "
            "All three values must be numbers."
        ) from e


def parse_size(s: str) -> int:
    """
    Parse size string with suffix (b, kb, mb, gb) to bytes.
    
    Args:
        s: Size string (e.g., "500kb", "10mb", "1gb", "500" - defaults to kb)
        
    Returns:
        Size in bytes
    """
    s = s.lower().strip()
    
    multipliers = {
        'kb': 1024,
        'mb': 1024 ** 2,
        'gb': 1024 ** 3,
        'b': 1
    }
    
    for suffix, multiplier in multipliers.items():
        if s.endswith(suffix):
            number_str = s[:-len(suffix)]
            return int(float(number_str) * multiplier)
    
    # If no suffix, assume kilobytes (kb)
    return int(float(s) * 1024)


def format_file_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"


def format_number_with_spaces(n: int) -> str:
    """Format number with space separators for thousands."""
    s = str(n)
    result = []
    for i, char in enumerate(reversed(s)):
        if i > 0 and i % 3 == 0:
            result.append(' ')
        result.append(char)
    return ''.join(reversed(result))


class Spinner:
    """Simple spinner animation for long-running operations."""
    def __init__(self, message: str = "Processing"):
        self.message = message
        self.spinner_chars = ['/', '-', '\\', '|']
        self.spinner_index = 0
        self.stop_spinner = False
        self.thread = None
    
    def _spin(self):
        """Internal spinner loop."""
        while not self.stop_spinner:
            char = self.spinner_chars[self.spinner_index % len(self.spinner_chars)]
            sys.stdout.write(f"\r{self.message} {char}")
            sys.stdout.flush()
            self.spinner_index += 1
            time.sleep(0.1)
    
    def start(self):
        """Start the spinner in a separate thread."""
        self.stop_spinner = False
        self.thread = threading.Thread(target=self._spin, daemon=True)
        self.thread.start()
    
    def stop(self):
        """Stop the spinner and clear the line."""
        self.stop_spinner = True
        if self.thread:
            self.thread.join(timeout=0.2)
        sys.stdout.write("\r" + " " * (len(self.message) + 2) + "\r")
        sys.stdout.flush()


def create_progress_bar(
    current: int, 
    total: int, 
    stage_name: str = "",
    current_points: int = None
) -> str:
    """
    Create a progress bar with fixed length (20 chars = 100%, each char = 5%).
    
    Format: Stage: [********.                ] 12 122 1212
    or:     Stage: [********.                ]
    """
    if total == 0:
        progress = 1.0
    else:
        progress = min(current / total, 1.0)
    
    filled = int(progress * 20)
    bar = '[' + '*' * filled + ' ' * (20 - filled) + ']'
    
    # Build progress line
    if stage_name:
        progress_line = f"{stage_name}: {bar}"
    else:
        progress_line = bar
    
    # Add points if provided
    if current_points is not None:
        points_str = format_number_with_spaces(current_points)
        progress_line += f" {points_str}"
    
    return progress_line


def generate_output_filename(
    input_file: str,
    points: int = None,
    size: str = None,
    percent: float = None,
    draco: bool = False,
    meshopt: bool = False,
    quant_explicit: bool = False,
    filter_sphere: bool = False,
    filter_hemisphere: bool = False,
    filter_radius: float = None,
    filter_center: str = 'origin'
) -> str:
    """
    Generate output filename based on input file and parameters.
    
    Format: <input_name>_<params>.glb
    Params: _prcnt_<value>, _size_<value>, _pnts_<value>, _draco, _meshopt, _quant
    Filter params: _sphere_<radius> or _hemisphere_<radius>, _center_<origin|geometric>
    
    For percent values:
    - Integer: _prcnt_100
    - Decimal: _prcnt_100(5) for 100.5
    
    quant_explicit: If True, quantization was explicitly requested by user (adds _quant suffix)
    """
    input_path = Path(input_file)
    input_dir = input_path.parent
    input_stem = input_path.stem.rstrip('_')  # Remove trailing underscores
    
    parts = [input_stem]
    
    # Add filter information before downsampling parameters
    if filter_sphere or filter_hemisphere:
        # Format: _filtersphere or _filterhemisphere
        filter_type = 'filtersphere' if filter_sphere else 'filterhemisphere'
        parts.append(f"_{filter_type}")
        
        # Format radius: _r[xxxx] where xxxx is the radius as percentage (4 digits)
        # Examples: 0.5 -> r0050, 0.33 -> r0033, 1.0 -> r0100, 1.5 -> r0150
        if filter_radius is not None:
            # Convert to percentage and format as 4 digits
            radius_percent = int(filter_radius * 100)
            radius_str = f"r{radius_percent:04d}"
            parts.append(f"_{radius_str}")
        
        # Add center type if not origin (to keep filenames shorter, origin is default)
        if filter_center != 'origin':
            # Try to parse center to determine if it's custom coordinates
            try:
                parsed_center = parse_center_coordinates(filter_center)
                if isinstance(parsed_center, np.ndarray):
                    # Custom coordinates: format as _center_x_y_z (rounded to 1 decimal)
                    center_str = f"{parsed_center[0]:.1f}_{parsed_center[1]:.1f}_{parsed_center[2]:.1f}"
                    parts.append(f"_center_{center_str}")
                else:
                    # Predefined center (geometric)
                    parts.append(f"_center_{parsed_center}")
            except ValueError:
                # If parsing fails, use original string (shouldn't happen in normal flow)
                parts.append(f"_center_{filter_center}")
    
    if percent is not None:
        # Format percent: integer without decimal, decimal with parentheses
        if percent == int(percent):
            parts.append(f"_prcnt_{int(percent)}")
        else:
            # Split integer and decimal parts
            int_part = int(percent)
            decimal_part = int((percent - int_part) * 10)  # First decimal digit
            parts.append(f"_prcnt_{int_part}({decimal_part})")
    elif size is not None:
        # Normalize size string for filename
        size_normalized = size.lower().replace(' ', '')
        parts.append(f"_size_{size_normalized}")
    elif points is not None:
        parts.append(f"_pnts_{points}")
    
    if draco:
        parts.append("_draco")
    elif meshopt:
        parts.append("_meshopt")
    
    # Add _quant only if explicitly requested by user (not auto-enabled for meshopt)
    if quant_explicit:
        parts.append("_quant")
    
    output_filename = ''.join(parts) + '.glb'
    return str(input_dir / output_filename)


def interactive_mode(input_file: str):
    """Interactive mode for point cloud conversion."""
    click.echo("=" * 60)
    click.echo("Point Cloud Converter - Interactive Mode")
    click.echo("=" * 60)
    
    # Read point cloud
    click.echo(f"\nReading file: {input_file}")
    try:
        pts, cols = read_point_cloud(input_file)
    except Exception as e:
        click.echo(f"Error reading file: {e}", err=True)
        return
    
    source_count = len(pts)
    source_size = os.path.getsize(input_file)
    input_path = Path(input_file)
    
    click.echo(f"\nFile Information:")
    click.echo(f"  Points: {source_count:,}")
    click.echo(f"  File size: {format_file_size(source_size)}")
    click.echo(f"\nCommands:")
    click.echo(f"  extract [<output>] [--points N | --size SIZE | --percent P] [--draco | --meshopt] [--quant] [--filter-sphere | --filter-hemisphere] [--filter-radius R] [--filter-center CENTER]")
    click.echo(f"    Extract point cloud with specified parameters")
    click.echo(f"    <output>: Output file path (optional, auto-generated if omitted)")
    click.echo(f"    --points N: Target number of points")
    click.echo(f"    --size SIZE: Target file size (e.g., 500kb, 10mb, 500 - defaults to kb)")
    click.echo(f"    --percent P: Percentage of source points (0-100)")
    click.echo(f"    --draco: Apply Draco compression (for .glb files, disables quantization, mutually exclusive with --meshopt)")
    click.echo(f"    --meshopt: Apply Meshoptimizer compression (for .glb files, requires quantization, mutually exclusive with --draco)")
    click.echo(f"    --quant: Use KHR_mesh_quantization (disabled by default, automatically disabled with --draco, required with --meshopt)")
    click.echo(f"    --filter-sphere: Filter points within a sphere (mutually exclusive with --filter-hemisphere)")
    click.echo(f"    --filter-hemisphere: Filter points within a hemisphere (mutually exclusive with --filter-sphere)")
    click.echo(f"    --filter-radius R: Filter radius in relative units (0.0-1.0 = 0%%-100%% of bounding box diagonal, can be >1.0)")
    click.echo(f"    --filter-center CENTER: Filter center - 'origin' (0,0,0), 'geometric' (centroid), or custom coordinates (x,y,z or x y z), default: origin")
    click.echo(f"  exit: Exit interactive mode")
    click.echo(f"\nExamples:")
    click.echo(f"  extract --points 10000")
    click.echo(f"    → Creates: {input_path.parent / (input_path.stem.rstrip('_') + '_pnts_10000.glb')}")
    click.echo(f"  extract output.glb --percent 10 --draco")
    click.echo(f"    → Creates: output.glb with 10% of points, Draco compressed")
    click.echo(f"  extract output.glb --percent 10 --meshopt")
    click.echo(f"    → Creates: output.glb with 10% of points, Meshoptimizer compressed (quantization auto-enabled)")
    click.echo(f"  extract --size 500kb")
    click.echo(f"    → Creates: {input_path.parent / (input_path.stem.rstrip('_') + '_size_500kb.glb')}")
    click.echo(f"  extract --size 1000")
    click.echo(f"    → Creates: {input_path.parent / (input_path.stem.rstrip('_') + '_size_1000.glb')} (1000 KB)")
    click.echo(f"  extract --percent 5.5")
    click.echo(f"    → Creates: {input_path.parent / (input_path.stem.rstrip('_') + '_prcnt_5(5).glb')}")
    click.echo(f"  extract custom_output.glb --points 5000")
    click.echo(f"    → Creates: custom_output.glb with 5000 points")
    click.echo(f"  extract --filter-sphere --filter-radius 0.5 --filter-center origin --points 10000")
    click.echo(f"    → Filters to sphere (50%% of diagonal, center at origin), then downsamples to 10000 points")
    click.echo(f"  extract --filter-hemisphere --filter-radius 0.3 --filter-center geometric --percent 10")
    click.echo(f"    → Filters to hemisphere (30%% of diagonal, geometric center), then downsamples to 10%%")
    click.echo(f"  extract --filter-sphere --filter-radius 0.4 --filter-center \"10.5,20.3,5.0\" --points 5000")
    click.echo(f"    → Filters to sphere (40%% of diagonal, center at (10.5, 20.3, 5.0)), then downsamples to 5000 points")
    click.echo("")
    
    while True:
        try:
            command = input("> ").strip()
            
            if not command:
                continue
            
            if command.lower() == 'exit':
                click.echo("Exiting interactive mode.")
                break
            
            if command.startswith('extract'):
                # Parse extract command
                parts = command[7:].strip().split() if len(command) > 7 else []
                
                # Parse arguments
                output = None
                points = None
                size = None
                percent = None
                draco = False
                meshopt = False
                quant = False  # Default: disabled
                quant_explicit = False  # Track if quant was explicitly requested
                filter_sphere = False
                filter_hemisphere = False
                filter_radius = None
                filter_center = 'origin'
                
                i = 0
                while i < len(parts):
                    if parts[i] == '--points' and i + 1 < len(parts):
                        points = int(parts[i + 1])
                        i += 2
                    elif parts[i] == '--size' and i + 1 < len(parts):
                        size = parts[i + 1]
                        i += 2
                    elif parts[i] == '--percent' and i + 1 < len(parts):
                        percent = float(parts[i + 1])
                        i += 2
                    elif parts[i] == '--draco':
                        draco = True
                        i += 1
                    elif parts[i] == '--meshopt':
                        meshopt = True
                        i += 1
                    elif parts[i] == '--quant':
                        quant = True
                        quant_explicit = True  # User explicitly requested quantization
                        i += 1
                    elif parts[i] == '--filter-sphere':
                        filter_sphere = True
                        i += 1
                    elif parts[i] == '--filter-hemisphere':
                        filter_hemisphere = True
                        i += 1
                    elif parts[i] == '--filter-radius' and i + 1 < len(parts):
                        filter_radius = float(parts[i + 1])
                        i += 2
                    elif parts[i] == '--filter-center' and i + 1 < len(parts):
                        filter_center = parts[i + 1]
                        # Validate center format
                        try:
                            parse_center_coordinates(filter_center)
                        except ValueError as e:
                            click.echo(f"Error: {e}", err=True)
                            break
                        i += 2
                    elif not parts[i].startswith('--'):
                        # This is likely the output filename
                        output = parts[i]
                        i += 1
                    else:
                        click.echo(f"Error: Unknown argument: {parts[i]}", err=True)
                        break
                
                # Validate compression options (mutually exclusive)
                if draco and meshopt:
                    click.echo("Error: Cannot use both --draco and --meshopt. Choose one compression method or none.", err=True)
                    continue
                
                # Validate filter options
                if filter_sphere and filter_hemisphere:
                    click.echo("Error: Cannot use both --filter-sphere and --filter-hemisphere. Choose one filter type or none.", err=True)
                    continue
                
                if (filter_sphere or filter_hemisphere) and filter_radius is None:
                    click.echo("Error: Filter radius (--filter-radius) is required when using --filter-sphere or --filter-hemisphere.", err=True)
                    continue
                
                if filter_radius is not None and not filter_sphere and not filter_hemisphere:
                    click.echo("Error: Filter type (--filter-sphere or --filter-hemisphere) is required when using --filter-radius.", err=True)
                    continue
                
                if filter_radius is not None and filter_radius <= 0:
                    click.echo("Error: Filter radius must be greater than 0.", err=True)
                    continue
                
                # Check for quantization + draco conflict
                if draco and quant:
                    quant = False
                    quant_explicit = False  # Reset since we disabled it
                    click.echo("Warning: Quantization and Draco compression both specified - disabling quantization as it provides no benefit with Draco compression", err=True)
                
                # Meshoptimizer requires quantization (but don't mark as explicit if auto-enabled)
                if meshopt and not quant:
                    quant = True
                    # quant_explicit remains False since it was auto-enabled
                    click.echo("Warning: Meshoptimizer compression requires quantization - enabling quantization automatically", err=True)
                
                # Generate output filename if not specified
                if not output:
                    output = generate_output_filename(
                        input_file, points, size, percent, draco, meshopt, quant_explicit,
                        filter_sphere, filter_hemisphere, filter_radius, filter_center
                    )
                    click.echo(f"Auto-generated output: {output}")
                
                # Calculate target points from percent if specified
                if percent is not None:
                    if percent < 0 or percent > 100:
                        click.echo("Error: Percent must be between 0 and 100", err=True)
                        continue
                    points = int(source_count * percent / 100.0)
                    click.echo(f"Using {points:,} points ({percent}% of {source_count:,})")
                
                # Validate parameters
                if not points and not size:
                    click.echo("Error: Specify --points, --size, or --percent", err=True)
                    continue
                
                # Process extraction
                try:
                    _process_extraction(
                        pts, cols, output, points, size, draco, meshopt, source_count, True, quant,
                        filter_sphere, filter_hemisphere, filter_radius, filter_center
                    )
                except Exception as e:
                    click.echo(f"Error: {e}", err=True)
            else:
                click.echo(f"Unknown command: {command}")
                click.echo("Available commands: extract, exit")
        
        except KeyboardInterrupt:
            click.echo("\nExiting interactive mode.")
            break
        except EOFError:
            click.echo("\nExiting interactive mode.")
            break


def _process_extraction(
    pts, cols, output: str, points: int, size: str, draco: bool, meshopt: bool, source_count: int, 
    show_progress: bool = False, quant: bool = False,
    filter_sphere: bool = False, filter_hemisphere: bool = False, 
    filter_radius: float = None, filter_center: str = 'origin'
):
    """Process point cloud extraction with given parameters."""
    if not show_progress:
        click.echo(f"\nProcessing extraction...")
    
    # Apply filtering if specified (before downsampling)
    filter_info = None
    if filter_sphere or filter_hemisphere:
        filter_type = 'sphere' if filter_sphere else 'hemisphere'
        
        # Parse center coordinates
        try:
            parsed_center = parse_center_coordinates(filter_center)
        except ValueError as e:
            raise click.ClickException(f"Invalid filter center: {e}")
        
        if not show_progress:
            center_display = filter_center if isinstance(parsed_center, str) else f"({parsed_center[0]:.2f}, {parsed_center[1]:.2f}, {parsed_center[2]:.2f})"
            click.echo(f"Applying {filter_type} filter (radius: {filter_radius}, center: {center_display})...")
        
        pts, cols, filter_info = apply_sphere_filter(
            pts, cols,
            filter_type=filter_type,
            center_type=parsed_center,
            radius_relative=filter_radius,
            up_axis='y'  # Y-up for hemisphere
        )
        
        if not show_progress:
            click.echo(f"After filtering: {filter_info['points_after']:,} points (removed {filter_info['points_before'] - filter_info['points_after']:,})")
            click.echo(f"Filter center: ({filter_info['center'][0]:.2f}, {filter_info['center'][1]:.2f}, {filter_info['center'][2]:.2f})")
            click.echo(f"Filter radius: {filter_info['radius_absolute']:.2f} (relative: {filter_info['radius_relative']:.2%})")
        
        # Update source_count to reflect filtered points
        source_count = len(pts)
    
    # Downsample if needed
    target_size_bytes = None
    if size:
        target_size_bytes = parse_size(size)
        if not show_progress:
            click.echo(f"Target size: {format_file_size(target_size_bytes)}")
    
    if points and not show_progress:
        click.echo(f"Target points: {points:,} ({points/source_count*100:.2f}% of source)")
    
    # Progress callback for downsampling with throttling
    last_update = [0]  # Use list to allow modification in nested function
    
    def progress_callback(current_voxels: int, total_voxels: int):
        if show_progress:
            # Throttle updates: update every 1% or at least every 100 voxels, or on completion
            update_interval = max(1, total_voxels // 100)
            if current_voxels == total_voxels or (current_voxels - last_update[0]) >= update_interval:
                # Show progress for downsampling stage (without points)
                progress_bar = create_progress_bar(
                    current_voxels, 
                    total_voxels, 
                    stage_name="Downsampling",
                    current_points=None
                )
                sys.stdout.write(f"\r{progress_bar}")
                sys.stdout.flush()
                last_update[0] = current_voxels
    
    # Determine output format for size estimation
    output_path = Path(output)
    output_ext = output_path.suffix.lower()
    output_format = 'drc' if output_ext == '.drc' else 'glb'
    
    try:
        spinner = None
        if show_progress:
            # Show estimated output points before spinner
            if points:
                sys.stdout.write(f"Estimated output points: {points:,}\n")
                sys.stdout.flush()
            elif target_size_bytes:
                # Estimate points from target size
                from .downsampler import calculate_target_points_for_size
                estimated_points = calculate_target_points_for_size(
                    target_size_bytes, output_format, draco
                )
                sys.stdout.write(f"Estimated output points: {estimated_points:,} (from target size)\n")
                sys.stdout.flush()
            
            # Start spinner animation for downsampling
            spinner = Spinner("Downsampling")
            spinner.start()
        
        pts_down, cols_down = downsample_to_target(
            pts, cols,
            target_count=points,
            target_size_bytes=target_size_bytes,
            output_format=output_format,
            draco=draco,
            progress_callback=None  # Disable callback, use spinner instead
        )
        
        if show_progress and spinner:
            # Stop spinner and clear the line
            spinner.stop()
    except Exception as e:
        if show_progress:
            sys.stdout.write("\r" + " " * 60 + "\r")
            sys.stdout.flush()
        raise click.ClickException(f"Downsampling error: {e}")
    
    click.echo(f"After downsampling: {len(pts_down):,} points")
    
    # Determine output format (already determined above)
    output_ext = output_path.suffix.lower()
    
    # Export based on format
    if output_ext == '.drc':
        if show_progress:
            # Show exporting stage
            export_bar = create_progress_bar(1, 1, stage_name="Exporting", current_points=len(pts_down))
            sys.stdout.write(f"\r{export_bar}\n")
            sys.stdout.flush()
        else:
            click.echo(f"Exporting to Draco format: {output}")
        try:
            output_size = export_draco(pts_down, cols_down, output)
        except FileNotFoundError:
            raise click.ClickException(
                "draco_encoder not found. Install draco-tools:\n"
                "  sudo apt install draco-tools  # Linux\n"
                "  brew install draco  # macOS"
            )
        except subprocess.CalledProcessError as e:
            raise click.ClickException(f"Draco encoding error: {e}")
        except Exception as e:
            raise click.ClickException(f"Export error: {e}")
        
        click.echo(f"\n{'='*60}")
        click.echo(f"Extraction Report:")
        click.echo(f"  Output file: {output}")
        click.echo(f"  Points: {len(pts_down):,}")
        click.echo(f"  File size: {format_file_size(output_size)}")
        click.echo(f"  Format: Draco")
        click.echo(f"{'='*60}\n")
    
    elif output_ext == '.glb':
        if draco:
            if show_progress:
                # Show exporting stage with points
                export_bar = create_progress_bar(1, 1, stage_name="Exporting (Draco)", current_points=len(pts_down))
                sys.stdout.write(f"\r{export_bar}\n")
                sys.stdout.flush()
            else:
                click.echo(f"Exporting to GLB with Draco compression: {output}")
            try:
                output_size = export_glb_with_draco(pts_down, cols_down, output)
            except FileNotFoundError as e:
                raise click.ClickException(
                    f"{str(e)}\n"
                    "To enable Draco compression for GLB files, install gltf-pipeline:\n"
                    "  npm install -g gltf-pipeline\n"
                    "Or use .drc format for pure Draco compression (already working)."
                )
            except subprocess.CalledProcessError as e:
                raise click.ClickException(f"Draco compression error: {e}")
            except Exception as e:
                raise click.ClickException(f"Export error: {e}")
            
            format_name = "GLB with Draco"
        elif meshopt:
            if show_progress:
                # Show exporting stage with points
                export_bar = create_progress_bar(1, 1, stage_name="Exporting (Meshopt)", current_points=len(pts_down))
                sys.stdout.write(f"\r{export_bar}\n")
                sys.stdout.flush()
            else:
                click.echo(f"Exporting to GLB with Meshoptimizer compression: {output}")
            try:
                output_size = export_glb_with_meshopt(pts_down, cols_down, output)
            except ImportError as e:
                raise click.ClickException(
                    f"{str(e)}\n"
                    "To enable Meshoptimizer compression, install meshoptimizer:\n"
                    "  pip install meshoptimizer"
                )
            except Exception as e:
                raise click.ClickException(f"Meshoptimizer compression error: {e}")
            
            format_name = "GLB with Meshoptimizer"
        else:
            if show_progress:
                # Show exporting stage with points
                export_bar = create_progress_bar(1, 1, stage_name="Exporting", current_points=len(pts_down))
                sys.stdout.write(f"\r{export_bar}\n")
                sys.stdout.flush()
            else:
                click.echo(f"Exporting to GLB: {output}")
            try:
                output_size = export_glb(pts_down, cols_down, output, use_quantization=quant)
            except Exception as e:
                raise click.ClickException(f"Export error: {e}")
            
            format_name = "GLB"
        
        click.echo(f"\n{'='*60}")
        click.echo(f"Extraction Report:")
        click.echo(f"  Output file: {output}")
        click.echo(f"  Points: {len(pts_down):,}")
        click.echo(f"  File size: {format_file_size(output_size)}")
        click.echo(f"  Format: {format_name}")
        click.echo(f"{'='*60}\n")
    
    else:
        raise click.ClickException(
            f"Unsupported output format: {output_ext}\n"
            "Supported formats: .glb (GLB), .drc (Draco)"
        )


@click.command()
@click.argument('input_file', type=click.Path(exists=True, path_type=str))
@click.option('-o', '--output', type=str, help='Output file path (.glb or .drc, optional - auto-generated if omitted)')
@click.option('--points', type=int, help='Target number of points')
@click.option('--size', type=str, help='Target file size (e.g., "500kb", "10mb", "500" - defaults to kb if no unit specified)')
@click.option('--percent', type=float, help='Target percentage of source points (0-100)')
@click.option('--draco', is_flag=True, help='Apply Draco compression to GLB output (only for .glb files, mutually exclusive with --meshopt)')
@click.option('--meshopt', is_flag=True, help='Apply Meshoptimizer compression to GLB output (only for .glb files, requires quantization, mutually exclusive with --draco)')
@click.option('--quant', is_flag=True, help='Use KHR_mesh_quantization for GLB (disabled by default, automatically disabled with --draco, required with --meshopt)')
@click.option('--filter-sphere', is_flag=True, help='Filter points within a sphere (mutually exclusive with --filter-hemisphere)')
@click.option('--filter-hemisphere', is_flag=True, help='Filter points within a hemisphere (mutually exclusive with --filter-sphere)')
@click.option('--filter-radius', type=float, help='Filter radius in relative units (0.0-1.0 = 0%%-100%% of bounding box diagonal, can be >1.0)')
@click.option('--filter-center', type=str, default='origin', help='Filter center: origin (0,0,0), geometric (centroid), or custom coordinates (x,y,z or x y z)')
@click.option('-v', '--verbose', is_flag=True, help='Verbose output')
def main(input_file: str, output: str, points: int, size: str, percent: float, draco: bool, meshopt: bool, quant: bool, filter_sphere: bool, filter_hemisphere: bool, filter_radius: float, filter_center: str, verbose: bool):
    """
    Convert point cloud files (.ply, .sog) to GLB or Draco format.
    
    Output formats:
    - .glb: GLB format (use --draco flag to enable compression)
    - .drc: Pure Draco format (compressed point cloud)
    
    If output file is not specified, it will be auto-generated in the same directory
    as the input file with parameters in the filename.
    
    If no parameters are specified (except input file), enters interactive mode.
    """
    # Check if we should enter interactive mode
    if not output and not points and not size and not percent:
        interactive_mode(input_file)
        return
    
    # Validate that at least one target option is provided
    if not points and not size and not percent:
        raise click.UsageError("Specify --points, --size, --percent, or omit all for interactive mode")
    
    # Validate compression options (mutually exclusive)
    if draco and meshopt:
        raise click.ClickException("Cannot use both --draco and --meshopt. Choose one compression method or none.")
    
    # Validate filter options
    if filter_sphere and filter_hemisphere:
        raise click.ClickException("Cannot use both --filter-sphere and --filter-hemisphere. Choose one filter type or none.")
    
    if (filter_sphere or filter_hemisphere) and filter_radius is None:
        raise click.ClickException("Filter radius (--filter-radius) is required when using --filter-sphere or --filter-hemisphere.")
    
    if filter_radius is not None and not filter_sphere and not filter_hemisphere:
        raise click.ClickException("Filter type (--filter-sphere or --filter-hemisphere) is required when using --filter-radius.")
    
    if filter_radius is not None and filter_radius <= 0:
        raise click.ClickException("Filter radius must be greater than 0.")
    
    # Track if quant was explicitly requested (before auto-enabling for meshopt)
    quant_explicit = quant
    
    # Check for quantization + draco conflict
    if draco and quant:
        quant = False
        quant_explicit = False  # Reset since we disabled it
        click.echo("Warning: Quantization and Draco compression both specified - disabling quantization as it provides no benefit with Draco compression", err=True)
    
    # Meshoptimizer requires quantization
    if meshopt and not quant:
        quant = True
        quant_explicit = False  # Auto-enabled, not explicit
        click.echo("Warning: Meshoptimizer compression requires quantization - enabling quantization automatically", err=True)
    
    # Generate output filename if not specified
    if not output:
        output = generate_output_filename(
            input_file, points, size, percent, draco, meshopt, quant_explicit,
            filter_sphere, filter_hemisphere, filter_radius, filter_center
        )
        if verbose:
            click.echo(f"Auto-generated output: {output}")
    
    # Read point cloud
    if verbose:
        click.echo(f"Reading file: {input_file}")
    
    try:
        pts, cols = read_point_cloud(input_file)
    except Exception as e:
        raise click.ClickException(f"Error reading file: {e}")
    
    source_count = len(pts)
    
    if verbose:
        click.echo(f"Source points: {source_count:,}")
    
    # Apply filtering if specified (before downsampling)
    filter_info = None
    if filter_sphere or filter_hemisphere:
        filter_type = 'sphere' if filter_sphere else 'hemisphere'
        
        # Parse center coordinates
        try:
            parsed_center = parse_center_coordinates(filter_center)
        except ValueError as e:
            raise click.ClickException(f"Invalid filter center: {e}")
        
        if verbose:
            center_display = filter_center if isinstance(parsed_center, str) else f"({parsed_center[0]:.2f}, {parsed_center[1]:.2f}, {parsed_center[2]:.2f})"
            click.echo(f"Applying {filter_type} filter (radius: {filter_radius}, center: {center_display})...")
        
        pts, cols, filter_info = apply_sphere_filter(
            pts, cols,
            filter_type=filter_type,
            center_type=parsed_center,
            radius_relative=filter_radius,
            up_axis='y'  # Y-up for hemisphere
        )
        
        if verbose:
            click.echo(f"After filtering: {filter_info['points_after']:,} points (removed {filter_info['points_before'] - filter_info['points_after']:,})")
            click.echo(f"Filter center: ({filter_info['center'][0]:.2f}, {filter_info['center'][1]:.2f}, {filter_info['center'][2]:.2f})")
            click.echo(f"Filter radius: {filter_info['radius_absolute']:.2f} (relative: {filter_info['radius_relative']:.2%})")
        
        # Update source_count to reflect filtered points
        source_count = len(pts)
    
    # Calculate target points from percent if specified
    if percent is not None:
        if percent < 0 or percent > 100:
            raise click.ClickException("Percent must be between 0 and 100")
        points = int(source_count * percent / 100.0)
        if verbose:
            click.echo(f"Target points ({percent}%): {points:,}")
    
    # Downsample if needed
    target_size_bytes = None
    if size:
        target_size_bytes = parse_size(size)
        if verbose:
            click.echo(f"Target size: {target_size_bytes:,} bytes")
    
    # Determine output format for size estimation
    output_path = Path(output)
    output_ext = output_path.suffix.lower()
    output_format = 'drc' if output_ext == '.drc' else 'glb'
    
    try:
        # Show estimated output points before spinner
        if points:
            sys.stdout.write(f"Estimated output points: {points:,}\n")
            sys.stdout.flush()
        elif target_size_bytes:
            # Estimate points from target size
            from .downsampler import calculate_target_points_for_size
            estimated_points = calculate_target_points_for_size(
                target_size_bytes, output_format, draco
            )
            sys.stdout.write(f"Estimated output points: {estimated_points:,} (from target size)\n")
            sys.stdout.flush()
        
        # Start spinner animation for downsampling
        spinner = Spinner("Downsampling")
        spinner.start()
        
        pts, cols = downsample_to_target(
            pts, cols,
            target_count=points,
            target_size_bytes=target_size_bytes,
            output_format=output_format,
            draco=draco,
            progress_callback=None  # Disable callback, use spinner instead
        )
        
        # Stop spinner and clear the line
        spinner.stop()
    except Exception as e:
        # Stop spinner in case of error
        if 'spinner' in locals():
            spinner.stop()
        raise click.ClickException(f"Downsampling error: {e}")
    
    if verbose:
        click.echo(f"After downsampling: {len(pts):,} points")
    
    # Determine output format from file extension
    output_path = Path(output)
    output_ext = output_path.suffix.lower()
    
    # Export based on format
    if output_ext == '.drc':
        # Pure Draco format
        # Show exporting stage with points
        export_bar = create_progress_bar(1, 1, stage_name="Exporting", current_points=len(pts))
        sys.stdout.write(f"\r{export_bar}\n")
        sys.stdout.flush()
        
        try:
            output_size = export_draco(pts, cols, output)
        except FileNotFoundError:
            raise click.ClickException(
                "draco_encoder not found. Install draco-tools:\n"
                "  sudo apt install draco-tools  # Linux\n"
                "  brew install draco  # macOS"
            )
        except subprocess.CalledProcessError as e:
            raise click.ClickException(f"Draco encoding error: {e}")
        except Exception as e:
            raise click.ClickException(f"Export error: {e}")
        
        click.echo(f"{output}: {len(pts):,} points, {output_size:,} bytes (Draco format)")
    
    elif output_ext == '.glb':
        # GLB format
        if draco:
            # GLB with Draco compression
            # Show exporting stage with points
            export_bar = create_progress_bar(1, 1, stage_name="Exporting (Draco)", current_points=len(pts))
            sys.stdout.write(f"\r{export_bar}\n")
            sys.stdout.flush()
            
            try:
                output_size = export_glb_with_draco(pts, cols, output)
            except FileNotFoundError as e:
                raise click.ClickException(
                    f"{str(e)}\n"
                    "To enable Draco compression for GLB files, install gltf-pipeline:\n"
                    "  npm install -g gltf-pipeline\n"
                    "Or use .drc format for pure Draco compression (already working)."
                )
            except subprocess.CalledProcessError as e:
                raise click.ClickException(f"Draco compression error: {e}")
            except Exception as e:
                raise click.ClickException(f"Export error: {e}")
            
            click.echo(f"{output}: {len(pts):,} points, {output_size:,} bytes (GLB with Draco)")
        elif meshopt:
            # GLB with Meshoptimizer compression
            # Show exporting stage with points
            export_bar = create_progress_bar(1, 1, stage_name="Exporting (Meshopt)", current_points=len(pts))
            sys.stdout.write(f"\r{export_bar}\n")
            sys.stdout.flush()
            
            try:
                output_size = export_glb_with_meshopt(pts, cols, output)
            except ImportError as e:
                raise click.ClickException(
                    f"{str(e)}\n"
                    "To enable Meshoptimizer compression, install meshoptimizer:\n"
                    "  pip install meshoptimizer"
                )
            except Exception as e:
                raise click.ClickException(f"Meshoptimizer compression error: {e}")
            
            click.echo(f"{output}: {len(pts):,} points, {output_size:,} bytes (GLB with Meshoptimizer)")
        else:
            # GLB without compression
            # Show exporting stage with points
            export_bar = create_progress_bar(1, 1, stage_name="Exporting", current_points=len(pts))
            sys.stdout.write(f"\r{export_bar}\n")
            sys.stdout.flush()
            
            try:
                output_size = export_glb(pts, cols, output, use_quantization=quant)
            except Exception as e:
                raise click.ClickException(f"Export error: {e}")
            
            click.echo(f"{output}: {len(pts):,} points, {output_size:,} bytes (GLB)")
    
    else:
        raise click.ClickException(
            f"Unsupported output format: {output_ext}\n"
            "Supported formats: .glb (GLB), .drc (Draco)"
        )


if __name__ == '__main__':
    main()

