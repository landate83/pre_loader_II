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
  - Parameters in filename: `_prcnt_<value>`, `_size_<value>`, `_pnts_<value>`, `_draco`
  - Percent format: integer `_prcnt_100` or decimal `_prcnt_100(5)` for 100.5
- `--points` - Target number of points after downsampling
- `--size` - Target file size (e.g., "500kb", "10mb", "1gb", "500" - defaults to kb if no unit specified)
- `--percent` - Target percentage of source points (0-100)
- `--draco` - Apply Draco compression to GLB output (only for `.glb` files, automatically disables quantization)
- `--quant` - Use KHR_mesh_quantization for GLB (disabled by default, automatically disabled with `--draco`)
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
  → Creates: model_pnts_5000.glb with KHR_mesh_quantization

> exit
```

## Features

- **Downsampling algorithm**: Voxel Grid Nearest - preserves original point coordinates (does not average them)
- **Multiple output formats**: 
  - GLB (with optional Draco compression via `--draco` flag)
  - Pure Draco format (.drc) - automatically compressed using [Draco library](https://google.github.io/draco/)
- **Format support**: .ply (with RGB colors) and .sog (Gaussian Splatting with Spherical Harmonics)
- **Size optimization**: 
  - KHR_mesh_quantization available via `--quant` flag for GLB (reduces file size by ~50%)
  - Automatically disabled when using Draco compression (Draco handles its own compression)
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
│   └── exporter.py      # Export to GLB with Draco
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
- draco-tools (system utility)
