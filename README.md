# Point Cloud to GLB Converter

CLI utility for converting point cloud files (.ply/.sog) to GLB format with Draco compression.

## Installation

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install Draco tools

**Linux:**
```bash
sudo apt install draco-tools
```

**macOS:**
```bash
brew install draco
```

**Windows:**
Download drivers from [Draco official repository](https://github.com/google/draco)

### 3. Install gltfpack (for Meshoptimizer compression)

**All platforms:**
```bash
npm install -g gltfpack
```

**Note:** gltfpack is required only if you want to use `--meshopt` flag for Meshoptimizer compression. For Draco compression, only draco-tools is needed.

## Usage

### Output Formats

The utility supports three output formats:

1. **GLB without compression** (default for `.glb` files)
   ```bash
   python -m converter.cli input.ply -o output.glb --points 10000
   ```

2. **GLB with Draco compression** (use `--draco` flag for `.glb` files)
   ```bash
   python -m converter.cli input.ply -o output.glb --points 10000 --draco
   ```

3. **Pure Draco format** (`.drc` files - automatically compressed)
   ```bash
   python -m converter.cli input.ply -o output.drc --points 10000
   ```

### Options

- `input_file` - Input file (.ply or .sog)
- `-o, --output` - Output file path (optional, `.glb` or `.drc`)
  - If omitted, file is auto-generated in the same directory as input file
  - Auto-generated name format: `<input_name>_<params>.glb`
  - Parameters in filename: 
    - `_prcnt_<value>` - percentage (integer `_prcnt_100` or decimal `_prcnt_100(5)` for 100.5)
    - `_size_<value>` - target file size
    - `_pnts_<value>` - target number of points
    - `_filtersphere_r[xxxx]` or `_filterhemisphere_r[xxxx]` - filter type and radius (4-digit percentage, e.g., `r0050` for 0.5)
    - `_center_<type>` - filter center (`origin`, `geometric`, or `x_y_z` for custom coordinates)
    - `_draco` - Draco compression
    - `_meshopt(xx)` - Meshoptimizer compression with quantization precision (e.g., `_meshopt(16)` for default, `_meshopt(14)` for custom)
    - `_quant` - KHR_mesh_quantization
- `--points` - Target number of points after downsampling
- `--size` - Target file size (e.g., "500kb", "10mb", "1gb", "500" - defaults to kb if no unit specified)
- `--percent` - Target percentage of source points (0-100)
- `--draco` - Apply Draco compression to GLB output (only for `.glb` files, mutually exclusive with `--meshopt`, automatically disables quantization)
- `--meshopt [PRECISION]` - Apply Meshoptimizer compression via gltfpack (only for `.glb` files, mutually exclusive with `--draco`). PRECISION is quantization precision for positions (vp), default: 16. Use 12-14 for preview, 16 for detailed scenes.
- `--quant` - Use KHR_mesh_quantization for GLB (disabled by default, automatically disabled with `--draco`)
- `--filter-sphere` - Filter points within a sphere before downsampling (mutually exclusive with `--filter-hemisphere`)
- `--filter-hemisphere` - Filter points within a hemisphere before downsampling (mutually exclusive with `--filter-sphere`)
- `--filter-radius FLOAT` - Filter radius in relative units (0.0-1.0 = 0%-100% of bounding box diagonal, can be >1.0). Required when using `--filter-sphere` or `--filter-hemisphere`
- `--filter-center CENTER` - Filter center specification:
  - `origin` - Use origin (0, 0, 0) as center (default)
  - `geometric` - Use geometric center (centroid) of the point cloud
  - `x,y,z` or `x y z` - Use custom coordinates (three numbers, comma or space separated)
- `-v, --verbose` - Verbose output

### Examples

```bash
# GLB without compression (explicit output)
python -m converter.cli model.ply -o model.glb --points 50000 -v

# GLB with auto-generated filename (creates: model_pnts_50000.glb)
python -m converter.cli model.ply --points 50000 -v

# GLB with Draco compression and auto-generated filename
python -m converter.cli model.ply --points 50000 --draco -v
# Creates: model_pnts_50000_draco.glb

# Using percentage - integer (creates: model_prcnt_10.glb)
python -m converter.cli model.ply --percent 10 -v

# Using percentage - decimal (creates: model_prcnt_5(5).glb)
python -m converter.cli model.ply --percent 5.5 -v

# Using file size (creates: model_size_500kb.glb)
python -m converter.cli model.ply --size 500kb -v

# Using file size without unit (defaults to kb, creates: model_size_500.glb)
python -m converter.cli model.ply --size 500 -v

# Pure Draco format (smallest file size)
python -m converter.cli model.ply -o model.drc --points 50000 -v

# Downsample to 2MB file size
python -m converter.cli large.sog -o compact.glb --size 2mb

# GLB with Meshoptimizer compression via gltfpack (default precision: 16)
python -m converter.cli model.ply -o model.glb --points 10000 --meshopt -v
# Creates: model_pnts_10000_meshopt(16).glb

# GLB with Meshoptimizer compression with custom precision (14 bits for preview)
python -m converter.cli model.ply -o model.glb --points 10000 --meshopt 14 -v
# Creates: model_pnts_10000_meshopt(14).glb

# Filter by sphere (50% of diagonal, center at origin) then downsample
python -m converter.cli input.ply -o output.glb --filter-sphere --filter-radius 0.5 --filter-center origin --points 10000 -v

# Filter by hemisphere (30% of diagonal, geometric center) then downsample
python -m converter.cli input.ply -o output.glb --filter-hemisphere --filter-radius 0.3 --filter-center geometric --percent 10 -v

# Filter by sphere with custom center coordinates
python -m converter.cli input.ply -o output.glb --filter-sphere --filter-radius 0.4 --filter-center "10.5,20.3,5.0" --points 5000 -v
# Creates: output_filtersphere_r0040_center_10.5_20.3_5.0_pnts_5000.glb

# Interactive mode (no parameters)
python -m converter.cli scene.ply
```

### Interactive Mode

If you run the utility without any parameters (except the input file), it enters interactive mode:

```bash
python -m converter.cli model.ply
```

In interactive mode:
- View file information (points, size)
- Use `extract` command with various options
- Output filename is optional (auto-generated if omitted)
- See command examples and progress bars
- Use `exit` to quit

**Interactive mode examples:**
```
> extract --points 10000
  → Creates: model_pnts_10000.glb

> extract output.glb --percent 10 --draco
  → Creates: output.glb with 10% of points, Draco compressed
  → Warning: Quantization automatically disabled with Draco compression

> extract --percent 5.5
  → Creates: model_prcnt_5(5).glb

> extract --size 500kb
  → Creates: model_size_500kb.glb

> extract --size 1000
  → Creates: model_size_1000.glb (1000 KB)

> extract --points 5000 --quant
  → Creates: model_pnts_5000_quant.glb with KHR_mesh_quantization

> extract output.glb --percent 10 --meshopt
  → Creates: output.glb with 10% of points, Meshoptimizer compressed via gltfpack (vp=16, default)

> extract output.glb --percent 10 --meshopt 14
  → Creates: output.glb with 10% of points, Meshoptimizer compressed via gltfpack (vp=14)

> extract --filter-sphere --filter-radius 0.5 --filter-center origin --points 10000
  → Filters to sphere (50% of diagonal, center at origin), then downsamples to 10000 points

> extract --filter-hemisphere --filter-radius 0.3 --filter-center geometric --percent 10
  → Filters to hemisphere (30% of diagonal, geometric center), then downsamples to 10%

> extract --filter-sphere --filter-radius 0.4 --filter-center "10.5,20.3,5.0" --points 5000
  → Filters to sphere (40% of diagonal, center at (10.5, 20.3, 5.0)), then downsamples to 5000 points

> exit
```

## Features

- **Downsampling algorithm**: Voxel Grid Nearest - preserves original point coordinates (does not average them)
- **Multiple output formats**: 
  - GLB (with optional Draco compression via `--draco` flag)
  - GLB with Meshoptimizer compression (via `--meshopt [PRECISION]` flag, uses gltfpack)
  - Pure Draco format (.drc) - automatically compressed using [Draco library](https://google.github.io/draco/)
- **Format support**: .ply (with RGB colors) and .sog (Gaussian Splatting with Spherical Harmonics)
- **Size optimization**: 
  - KHR_mesh_quantization available via `--quant` flag for GLB (reduces file size by ~50%)
  - Automatically disabled when using Draco compression (Draco handles its own compression)
  - Meshoptimizer compression (via gltfpack) handles quantization automatically with configurable precision
- **Point cloud filtering**: Filter points before downsampling using sphere or hemisphere:
  - `--filter-sphere` - Filter points within a sphere
  - `--filter-hemisphere` - Filter points within a hemisphere (Y-up)
  - `--filter-radius` - Radius in relative units (0.0-1.0 = 0%-100% of bounding box diagonal)
  - `--filter-center` - Center: `origin` (0,0,0), `geometric` (centroid), or custom coordinates (x,y,z)
- **Auto-generated filenames**: Output filename is optional - automatically generated based on input name and parameters
- **Progress indicators**: Visual progress bars during downsampling (both CLI and interactive modes)
- **Interactive mode**: User-friendly interactive interface for exploring and converting point clouds

## Project Structure

```
pre_loader_II/
├── converter/
│   ├── __init__.py
│   ├── cli.py          # CLI interface
│   ├── reader.py        # Read .ply and .sog files
│   ├── downsampler.py  # Point cloud downsampling
│   ├── filter.py        # Sphere/hemisphere filtering
│   └── exporter.py      # Export to GLB with Draco/Meshoptimizer
├── viewer/             # Web viewer (in development)
├── tests/              # Tests (in development)
├── requirements.txt
└── README.md
```

## Requirements

- Python 3.10+
- numpy >= 1.24.0
- plyfile >= 1.0.0
- pygltflib >= 1.16.0
- click >= 8.0.0
- draco-tools (system utility, for Draco compression)
- gltfpack (npm package, for Meshoptimizer compression via `--meshopt` flag)
