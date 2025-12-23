# AGENTS.md — Point Cloud to GLB Converter

## Проект

CLI-утилита для конвертации .ply/.sog в .glb с Draco-компрессией + веб-просмотрщик с шейдерными анимациями.

---

## Стек технологий

| Компонент | Технология | Версия |
|-----------|------------|--------|
| CLI | Python | 3.10+ |
| Point Cloud | Open3D | ≥0.17.0 |
| GLB экспорт | pygltflib | ≥1.16.0 |
| Draco | draco_encoder | 1.5.6+ |
| Viewer | Three.js | r160+ |
| Шейдеры | GLSL ES 3.0 | WebGL 2.0 |

---

## Структура проекта

```
pointcloud-converter/
├── AGENTS.md
├── requirements.txt
├── converter/
│   ├── __init__.py
│   ├── cli.py
│   ├── reader.py
│   ├── downsampler.py
│   └── exporter.py
├── viewer/
│   ├── index.html
│   ├── styles.css
│   └── js/main.js
└── tests/
```

---

## Алгоритм прореживания: Voxel Grid Nearest

Использовать ТОЛЬКО этот метод. Он сохраняет оригинальные координаты и цвета.

### downsampler.py

```python
import numpy as np
from typing import Tuple

def downsample_voxel_grid_nearest(
    points: np.ndarray,
    colors: np.ndarray,
    voxel_size: float
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Выбирает ближайшую к центроиду точку в каждом вокселе."""
    grid_indices = np.floor(points / voxel_size).astype(np.int64)
    
    offset = grid_indices.min(axis=0)
    grid_indices -= offset
    max_idx = grid_indices.max(axis=0) + 1
    
    voxel_keys = (
        grid_indices[:, 0] * (max_idx[1] * max_idx[2]) +
        grid_indices[:, 1] * max_idx[2] +
        grid_indices[:, 2]
    )
    
    sorted_indices = np.argsort(voxel_keys)
    sorted_keys = voxel_keys[sorted_indices]
    unique_keys, group_starts = np.unique(sorted_keys, return_index=True)
    group_ends = np.append(group_starts[1:], len(sorted_keys))
    
    selected_indices = np.empty(len(unique_keys), dtype=np.int64)
    
    for i, (start, end) in enumerate(zip(group_starts, group_ends)):
        group_point_indices = sorted_indices[start:end]
        group_points = points[group_point_indices]
        centroid = group_points.mean(axis=0)
        distances = np.linalg.norm(group_points - centroid, axis=1)
        selected_indices[i] = group_point_indices[np.argmin(distances)]
    
    return points[selected_indices], colors[selected_indices], selected_indices


def find_voxel_size_for_target(points: np.ndarray, target: int, tol: float = 0.05) -> float:
    """Бинарный поиск размера воксела."""
    bbox_diag = np.linalg.norm(points.max(0) - points.min(0))
    vmin, vmax = bbox_diag / (target ** (1/3) * 10), bbox_diag / 2
    
    for _ in range(50):
        vmid = (vmin + vmax) / 2
        count = len(np.unique(np.floor(points / vmid).astype(np.int64), axis=0))
        if abs(count - target) / target <= tol:
            return vmid
        if count > target:
            vmin = vmid
        else:
            vmax = vmid
    return vmid


def downsample_to_target(
    points: np.ndarray,
    colors: np.ndarray,
    target_count: int = None,
    target_size_bytes: int = None
) -> Tuple[np.ndarray, np.ndarray]:
    """Прореживание до целевого количества или размера."""
    if target_count is None and target_size_bytes:
        target_count = int(target_size_bytes / 14)  # ~14 байт/точка после Draco
    if target_count is None:
        raise ValueError("Укажите target_count или target_size_bytes")
    if target_count >= len(points):
        return points, colors
    
    voxel_size = find_voxel_size_for_target(points, target_count)
    pts, cols, _ = downsample_voxel_grid_nearest(points, colors, voxel_size)
    return pts, cols
```

---

## Чтение файлов: reader.py

```python
import numpy as np
from plyfile import PlyData
from pathlib import Path

def read_ply(filepath: str):
    ply = PlyData.read(filepath)
    v = ply['vertex']
    points = np.column_stack([v['x'], v['y'], v['z']]).astype(np.float32)
    colors = np.column_stack([v['red'], v['green'], v['blue']]).astype(np.uint8) if 'red' in v else np.full((len(points), 3), 255, np.uint8)
    return points, colors

def read_sog(filepath: str):
    ply = PlyData.read(filepath)
    v = ply['vertex']
    points = np.column_stack([v['x'], v['y'], v['z']]).astype(np.float32)
    SH_C0 = 0.28209479177387814
    if 'f_dc_0' in v:
        colors = np.column_stack([
            np.clip((0.5 + SH_C0 * v['f_dc_0']) * 255, 0, 255),
            np.clip((0.5 + SH_C0 * v['f_dc_1']) * 255, 0, 255),
            np.clip((0.5 + SH_C0 * v['f_dc_2']) * 255, 0, 255)
        ]).astype(np.uint8)
    else:
        colors = np.full((len(points), 3), 255, np.uint8)
    return points, colors

def read_point_cloud(filepath: str):
    ext = Path(filepath).suffix.lower()
    if ext == '.ply': return read_ply(filepath)
    if ext == '.sog': return read_sog(filepath)
    raise ValueError(f"Неподдерживаемый формат: {ext}")
```

---

## Экспорт GLB с Draco: exporter.py

```python
import numpy as np
import subprocess
import tempfile
from pathlib import Path
from pygltflib import GLTF2, Scene, Node, Mesh, Primitive, Accessor, BufferView, Buffer, ComponentType, AccessorType

def export_glb_with_draco(points: np.ndarray, colors: np.ndarray, output: str) -> int:
    with tempfile.NamedTemporaryFile(suffix='.glb', delete=False) as tmp:
        tmp_path = tmp.name
    
    _create_glb(points, colors, tmp_path)
    
    subprocess.run([
        'draco_transcoder', '-i', tmp_path, '-o', output,
        '-cl', '7', '-qp', '14', '-qc', '10'
    ], check=True)
    
    Path(tmp_path).unlink(missing_ok=True)
    return Path(output).stat().st_size

def _create_glb(points, colors, path):
    n = len(points)
    colors_f = colors.astype(np.float32) / 255.0
    pos_bytes = points.tobytes()
    col_bytes = colors_f.tobytes()
    
    gltf = GLTF2(
        scene=0,
        scenes=[Scene(nodes=[0])],
        nodes=[Node(mesh=0)],
        meshes=[Mesh(primitives=[Primitive(attributes={'POSITION': 0, 'COLOR_0': 1}, mode=0)])],
        accessors=[
            Accessor(bufferView=0, componentType=5126, count=n, type='VEC3', max=points.max(0).tolist(), min=points.min(0).tolist()),
            Accessor(bufferView=1, componentType=5126, count=n, type='VEC3')
        ],
        bufferViews=[
            BufferView(buffer=0, byteOffset=0, byteLength=len(pos_bytes)),
            BufferView(buffer=0, byteOffset=len(pos_bytes), byteLength=len(col_bytes))
        ],
        buffers=[Buffer(byteLength=len(pos_bytes) + len(col_bytes))]
    )
    gltf.set_binary_blob(pos_bytes + col_bytes)
    gltf.save(path)
```

---

## CLI: cli.py

```python
import click
from .reader import read_point_cloud
from .downsampler import downsample_to_target
from .exporter import export_glb_with_draco

def parse_size(s):
    s = s.lower()
    for suf, m in {'kb': 1024, 'mb': 1024**2, 'gb': 1024**3, 'b': 1}.items():
        if s.endswith(suf): return int(float(s[:-len(suf)]) * m)
    return int(s)

@click.command()
@click.argument('input_file', type=click.Path(exists=True))
@click.option('-o', '--output', required=True)
@click.option('--points', type=int)
@click.option('--size', type=str)
@click.option('-v', '--verbose', is_flag=True)
def main(input_file, output, points, size, verbose):
    if not points and not size:
        raise click.UsageError("Укажите --points или --size")
    
    pts, cols = read_point_cloud(input_file)
    if verbose: click.echo(f"Исходных: {len(pts):,}")
    
    pts, cols = downsample_to_target(pts, cols, points, parse_size(size) if size else None)
    if verbose: click.echo(f"После: {len(pts):,}")
    
    sz = export_glb_with_draco(pts, cols, output)
    click.echo(f"{output}: {len(pts):,} точек, {sz:,} байт")

if __name__ == '__main__':
    main()
```

---

## Viewer: index.html

```html
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Point Cloud Viewer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui; background: #1a1a2e; color: #eee; overflow: hidden; }
        #canvas { width: 100vw; height: 100vh; display: block; }
        .dropzone { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(26,26,46,0.95); z-index: 100; }
        .dropzone.hidden { display: none; }
        .dropzone-content { text-align: center; padding: 60px; border: 2px dashed #444; border-radius: 16px; }
        .dropzone button { background: #4ecdc4; color: #1a1a2e; border: none; padding: 12px 32px; font-size: 16px; border-radius: 8px; cursor: pointer; margin-top: 20px; }
        .panel { position: fixed; top: 20px; right: 20px; width: 280px; background: rgba(26,26,46,0.9); backdrop-filter: blur(10px); border-radius: 12px; padding: 16px; z-index: 50; }
        .panel.hidden { display: none; }
        .panel h3 { font-size: 12px; text-transform: uppercase; color: #888; margin: 0 0 12px; }
        .panel section { margin-bottom: 16px; }
        .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px; }
        label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
        input[type="range"] { flex: 1; accent-color: #4ecdc4; }
        .anim-btns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
        .anim-btns button { padding: 8px; font-size: 12px; background: #2a2a4e; color: #ccc; border: 1px solid #3a3a5e; border-radius: 6px; cursor: pointer; }
        .anim-btns button.active { background: #4ecdc4; color: #1a1a2e; }
        #btn-replay { width: 100%; padding: 10px; background: #4ecdc4; color: #1a1a2e; border: none; border-radius: 6px; cursor: pointer; }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    
    <div id="dropzone" class="dropzone">
        <div class="dropzone-content">
            <p>Перетащите .ply .sog .glb</p>
            <button id="btn-open">Открыть файл</button>
            <input type="file" id="file-input" accept=".ply,.sog,.glb" hidden>
        </div>
    </div>
    
    <div id="panel" class="panel hidden">
        <section>
            <h3>Информация</h3>
            <div class="info-grid">
                <span>Точек:</span><span id="info-points">—</span>
                <span>Размер:</span><span id="info-size">—</span>
            </div>
        </section>
        <section>
            <h3>Отображение</h3>
            <label>Размер <input type="range" id="point-size" min="1" max="20" value="3"> <span id="ps-val">3</span></label>
            <label>Прозрачность <input type="range" id="opacity" min="0" max="1" value="1" step="0.05"> <span id="op-val">1</span></label>
            <label><input type="radio" name="cm" value="file" checked> Цвет из файла</label>
            <label><input type="radio" name="cm" value="custom"> Свой цвет <input type="color" id="custom-color" value="#ff5500"></label>
        </section>
        <section>
            <h3>Анимации</h3>
            <div class="anim-btns">
                <button data-a="none" class="active">Нет</button>
                <button data-a="rain">Дождь</button>
                <button data-a="wave">Волна</button>
                <button data-a="tornado">Смерч</button>
                <button data-a="explosion">Взрыв</button>
                <button data-a="morph">Морфинг</button>
            </div>
            <label>Скорость <input type="range" id="anim-speed" min="0.1" max="3" value="1" step="0.1"> <span id="as-val">1x</span></label>
            <label>Амплитуда <input type="range" id="anim-amp" min="0" max="2" value="0.5" step="0.1"> <span id="aa-val">0.5</span></label>
            <button id="btn-replay">▶ Воспроизвести</button>
        </section>
    </div>
    
    <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
    <script type="module" src="js/main.js"></script>
</body>
</html>
```

---

## Шейдеры (встроены в main.js)

### Rain
```glsl
// vertex
float delay = fract(sin(float(gl_VertexID) * 43758.5453) * uDuration * 0.5;
float t = clamp((uTime - delay) / uDuration, 0.0, 1.0);
vec3 start = vec3(position.x, position.y + uDropHeight, position.z);
vec3 pos = mix(start, position, easeOutBounce(t));
```

### Wave
```glsl
// vertex
float dist = length(position.xz);
float t = clamp((uTime - dist * 0.3) / uDuration, 0.0, 1.0);
float wave = sin(dist * uFrequency - uTime * 2.0) * uAmplitude * t;
vec3 pos = position + vec3(0, wave, 0);
```

### Tornado
```glsl
// vertex
float progress = smoothstep(0.0, 1.0, t);
float radius = uFunnelRadius * (1.0 - progress);
float angle = uTime * uRotationSpeed + hash(gl_VertexID) * 6.28;
vec3 spiral = vec3(cos(angle) * radius, position.y, sin(angle) * radius);
vec3 pos = mix(spiral, position, progress);
```

### Explosion
```glsl
// vertex
vec3 dir = normalize(position - uCenter);
vec3 exploded = uCenter + dir * uExplosionRadius * (hash(gl_VertexID) * 0.5 + 0.5);
vec3 pos = mix(exploded, position, easeOutExpo(t));
```

### Morph
```glsl
// vertex
vec3 noise = vec3(snoise(position * uNoiseScale + uTime * 0.5), ...);
vec3 pos = mix(position + noise * uNoiseAmplitude, position, progress);
```

---

## Команды

```bash
pip install -r requirements.txt
sudo apt install draco-tools

# CLI
python -m converter.cli input.ply -o out.glb --points 10000
python -m converter.cli scene.sog -o preview.glb --size 500kb -v

# Viewer
cd viewer && python -m http.server 8000
```

---

## requirements.txt

```
numpy>=1.24.0
open3d>=0.17.0
plyfile>=1.0.0
pygltflib>=1.16.0
click>=8.0.0
```

---

## Критерии готовности

- [ ] CLI: .ply и .sog → .glb
- [ ] CLI: --points и --size
- [ ] GLB читается Three.js + DRACOLoader
- [ ] Координаты = оригинальные (не усреднённые)
- [ ] Viewer: drag&drop
- [ ] Viewer: инфо-панель (точки, размер)
- [ ] Viewer: размер/цвет/прозрачность точек
- [ ] Viewer: 5 анимаций (rain, wave, tornado, explosion, morph)
- [ ] Тесты ≥80%
