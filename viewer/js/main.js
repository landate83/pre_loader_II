import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/dist/lil-gui.esm.js';

// Load MeshoptDecoder dynamically to ensure it's ready
let MeshoptDecoder = null;
(async () => {
    try {
        const module = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js');
        MeshoptDecoder = module.MeshoptDecoder;
        console.log('MeshoptDecoder loaded successfully:', MeshoptDecoder);
    } catch (err) {
        console.error('Failed to load MeshoptDecoder:', err);
    }
})();

// ==================== Three.js Initialization ====================

const canvas = document.getElementById('canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor('#1a1a2e'); // Set initial background color

// OrbitControls for navigation
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==================== Application State ====================

let pointCloud = null;
let currentMaterial = null;
let currentAnimation = 'none';
let animationTime = 0;
let animationSpeed = 1;
let animationAmplitude = 0.5;
let fileSize = 0;
let isAnimationPlaying = false; // Track if animation is currently playing
let originalPositions = null; // Store original position data
let originalColors = null; // Store original color data
let originalPointCount = 0; // Store original point count

// Default scenes list (will be loaded dynamically from server)
let defaultScenes = [];

// Parameters object for GUI
const params = {
    // Scene
    selectedScene: defaultScenes[0], // Default scene
    loadCustomFile: () => {
        fileInput.click();
    },
    // Information (read-only)
    points: '—',
    fileSize: '—',
    maxPoints: 0, // Maximum points (filter control)
    pointPercent: 100, // Percentage of points (0-100)
    estimatedFileSize: '—', // Estimated file size for current point count
    // Display
    pointSize: 0.03,
    opacity: 1,
    colorMode: 'file', // 'file' or 'custom'
    customColor: '#ff5500',
    backgroundColor: '#1a1a2e', // Background color
    useShaderMaterial: true, // Use ShaderMaterial instead of PointsMaterial
    // Animations
    animation: 'none',
    animSpeed: 1,
    animAmplitude: 0.5,
    animRepeat: true, // Auto-repeat animation
    playAnimation: () => {
        animationTime = 0;
        isAnimationPlaying = true;
    },
    // Spherical Waves Animation
    wavesEnabled: false, // Enable/disable spherical waves
    wavesAmplitude: 3.0, // Wave width (1-10) - how many points will be affected by wave
    wavesPeriod: 1.0, // Number of simultaneous waves (1-10) - how often waves are generated
    wavesSpeed: 5.0, // Wave propagation speed (units per second) - how fast waves travel
    wavesColor: '#ffffff', // Wave color (white by default)
    wavesColorIntensity: 5.0, // Wave color intensity (0-10) - how pronounced the wave color is
    wavesDisplacementAxis: 'y', // Displacement axis: 'x', 'y', or 'z'
    wavesDisplacement: 1.0 // Displacement amount (0-10) in conditional units
};

// Initialize GUI
let gui = null;
let sceneFolder = null;
let infoFolder = null;
let displayFolder = null;
let maxPointsCtrl = null;
let pointPercentCtrl = null;
let estimatedFileSizeCtrl = null;
let selectedSceneCtrl = null;

// ==================== File Loading ====================

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const btnOpen = document.getElementById('btn-open');

// Drag & Drop
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) {
        loadFile(file);
    }
});

// File input
btnOpen.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        loadFile(file);
    }
});

// Load file from URL
async function loadFileFromURL(url, filename) {
    // Remove old point cloud immediately before loading new one
    if (pointCloud) {
        console.log('🟡 [DEBUG] Removing old point cloud before loading new file from URL...');
        scene.remove(pointCloud);
        if (pointCloud.geometry) pointCloud.geometry.dispose();
        if (pointCloud.material) pointCloud.material.dispose();
        pointCloud = null;
        currentMaterial = null;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const blob = await response.blob();
        fileSize = blob.size;
        const file = new File([blob], filename, { type: blob.type });
        
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'glb') {
            loadGLB(file);
        } else if (ext === 'ply' || ext === 'sog') {
            loadPLY(file);
        } else {
            alert('Unsupported file format');
        }
    } catch (error) {
        console.error('Error loading file from URL:', error);
        alert('Error loading file: ' + error.message);
    }
}

// Load file
function loadFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    fileSize = file.size;
    
    if (ext === 'glb') {
        loadGLB(file);
    } else if (ext === 'ply' || ext === 'sog') {
        loadPLY(file);
    } else {
        alert('Unsupported file format');
    }
}

// Load GLB
async function loadGLB(file) {
    const loader = new GLTFLoader();

    // Setup DRACO decoder
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);

    // Setup Meshoptimizer decoder (REQUIRED for EXT_meshopt_compression)
    // Must be set before loading compressed files
    // Wait for MeshoptDecoder to be loaded if not ready yet
    if (!MeshoptDecoder) {
        console.warn('MeshoptDecoder not yet loaded, waiting...');
        try {
            const module = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js');
            MeshoptDecoder = module.MeshoptDecoder;
            console.log('MeshoptDecoder loaded dynamically:', MeshoptDecoder);
        } catch (err) {
            console.error('Failed to load MeshoptDecoder:', err);
            alert('Warning: Meshoptimizer decoder not available. Files with EXT_meshopt_compression may not load correctly.');
        }
    }

    if (MeshoptDecoder) {
        try {
            // Ensure MeshoptDecoder is ready (it may need async initialization)
            if (typeof MeshoptDecoder.ready === 'function') {
                console.log('Waiting for MeshoptDecoder to be ready...');
                await MeshoptDecoder.ready();
                console.log('MeshoptDecoder is ready');
            }
            loader.setMeshoptDecoder(MeshoptDecoder);
            console.log('MeshoptDecoder set successfully on GLTFLoader');
        } catch (err) {
            console.error('Failed to set MeshoptDecoder:', err);
            console.warn('Files with EXT_meshopt_compression may not load correctly');
        }
    }

    
    const reader = new FileReader();
    reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        
        // Basic file size check
        if (arrayBuffer.byteLength < 12) {
            alert('File is too small to be a valid GLB file');
            return;
        }
        
        // Let GLTFLoader handle format validation - it's better at detecting invalid files
        // We'll catch and display errors in the error callback
        
        // Parse GLB manually to get quantization info
        const glbHeader = new DataView(arrayBuffer, 0, 12);
        const magic = glbHeader.getUint32(0, true);
        const version = glbHeader.getUint32(4, true);
        const length = glbHeader.getUint32(8, true);
        
        if (magic !== 0x46546C67) { // "glTF"
            alert('Invalid GLB file format');
            return;
        }
        
        // Parse JSON chunk
        const jsonChunkHeader = new DataView(arrayBuffer, 12, 8);
        const jsonChunkLength = jsonChunkHeader.getUint32(0, true);
        const jsonChunkType = jsonChunkHeader.getUint32(4, true);
        
        if (jsonChunkType !== 0x4E4F534A) { // "JSON"
            alert('Invalid GLB JSON chunk');
            return;
        }
        
        const jsonText = new TextDecoder().decode(arrayBuffer.slice(20, 20 + jsonChunkLength));
        const gltfJson = JSON.parse(jsonText);
        
        // Debug: Log extensions used
        console.log('=== GLB File Structure Debug ===');
        console.log('GLB extensionsUsed:', gltfJson.extensionsUsed);
        console.log('GLB extensionsRequired:', gltfJson.extensionsRequired);
        console.log('GLB buffers:', JSON.stringify(gltfJson.buffers, null, 2));
        console.log('GLB bufferViews count:', gltfJson.bufferViews?.length);
        if (gltfJson.bufferViews && gltfJson.bufferViews.length > 0) {
            console.log('GLB bufferViews[0]:', JSON.stringify(gltfJson.bufferViews[0], null, 2));
            if (gltfJson.bufferViews[0].extensions) {
                console.log('GLB bufferViews[0].extensions:', JSON.stringify(gltfJson.bufferViews[0].extensions, null, 2));
            }
        }
        
        // Check if EXT_meshopt_compression is used
        const hasMeshopt = gltfJson.extensionsUsed && gltfJson.extensionsUsed.includes('EXT_meshopt_compression');
        console.log('hasMeshopt:', hasMeshopt);
        console.log('=== End Debug ===');

        // Check for KHR_mesh_quantization extension
        // NOTE: If EXT_meshopt_compression is present, manual decode should be skipped
        // because MeshoptDecoder will decompress the data first, then Three.js should handle quantization
        let quantizationInfo = null;
        let shouldManualDecode = false;

        if (gltfJson.extensionsUsed && gltfJson.extensionsUsed.includes('KHR_mesh_quantization')) {
            if (hasMeshopt) {
                console.log('KHR_mesh_quantization + EXT_meshopt_compression detected - will let MeshoptDecoder handle decompression, then check if dequantization is needed');
            } else {
                console.log('KHR_mesh_quantization extension detected (no meshopt), will manually decode');
                shouldManualDecode = true;
            }

            // Find quantization info in accessors (needed for dequantization after meshopt decompression)
            if (gltfJson.accessors && gltfJson.accessors.length > 0) {
                const posAccessor = gltfJson.accessors[0];
                if (posAccessor.extensions && posAccessor.extensions.KHR_mesh_quantization) {
                    quantizationInfo = posAccessor.extensions.KHR_mesh_quantization;
                    console.log('Found quantization info:', quantizationInfo);
                }
            }
        }

        // CRITICAL FIX: Register custom meshopt extension handler
        // This intercepts buffer loading BEFORE Three.js processes it
        loader.register(function(parser) {
            return {
                name: 'MESHOPT_BUFFER_FIX',
                beforeRoot: function() {
                    // Patch getDependency to fix buffer index issues
                    if (parser.getDependency) {
                        const originalGetDependency = parser.getDependency.bind(parser);

                        parser.getDependency = function(type, index) {
                            // Intercept buffer dependency requests
                            if (type === 'buffer') {
                                const actualIndex = (index === undefined || index === null) ? 0 : index;
                                console.log('GLB_MESHOPT_FIX: getDependency buffer, index:', index, '-> fixed:', actualIndex);
                                return originalGetDependency.call(this, type, actualIndex);
                            }
                            return originalGetDependency.call(this, type, index);
                        };

                        console.log('GLB_MESHOPT_FIX: getDependency patched');
                    }
                    return null;
                }
            };
        });

        loader.parse(arrayBuffer, '', (gltf) => {
            console.log('GLB loaded successfully:', gltf);
            console.log('Scene children count:', gltf.scene.children.length);
            console.log('Scene children:', gltf.scene.children);
            
            const mesh = gltf.scene.children[0];
            if (!mesh) {
                console.error('No mesh found in scene!');
                alert('GLB file loaded but contains no mesh');
                return;
            }
            
            console.log('Mesh:', mesh);
            console.log('Mesh geometry:', mesh.geometry);
            
            if (mesh && mesh.geometry) {
                const geometry = mesh.geometry;
                console.log('Geometry attributes:', Object.keys(geometry.attributes));
                
                let positions = geometry.attributes.position;
                if (!positions) {
                    console.error('No position attribute found!');
                    alert('GLB file loaded but contains no position data');
                    return;
                }
                
                // Handle dequantization based on compression method
                if (quantizationInfo && positions.array) {
                    if (hasMeshopt) {
                        // With EXT_meshopt_compression: MeshoptDecoder has already decompressed the data
                        // Check if Three.js automatically dequantized or if we need to do it manually
                        console.log('Checking if dequantization is needed after meshopt decompression...');
                        console.log('Positions array type:', positions.array.constructor.name);
                        console.log('First values:', Array.from(positions.array.slice(0, 9)));
                        
                        // Check if values are still quantized (int16 range) or already dequantized (float range)
                        const firstVal = positions.array[0];
                        const isLikelyQuantized = Number.isInteger(firstVal) || 
                            (Math.abs(firstVal) < 32768 && Math.abs(firstVal) > 0.1 && Math.abs(firstVal) < 1000);
                        
                        if (isLikelyQuantized) {
                            console.log('Positions appear to be still quantized after meshopt decompression, applying dequantization...');
                            // Three.js didn't automatically dequantize, do it manually
                            const offset = quantizationInfo.quantizationOffset;
                            const scale = quantizationInfo.quantizationScale;
                            
                            const dequantized = new Float32Array(positions.array.length);
                            for (let i = 0; i < positions.array.length; i += 3) {
                                dequantized[i] = positions.array[i] * scale[0] + offset[0];
                                dequantized[i + 1] = positions.array[i + 1] * scale[1] + offset[1];
                                dequantized[i + 2] = positions.array[i + 2] * scale[2] + offset[2];
                            }
                            
                            positions = new THREE.BufferAttribute(dequantized, 3);
                            console.log('Positions dequantized after meshopt. First values:', Array.from(dequantized.slice(0, 9)));
                        } else {
                            console.log('Positions appear to be already dequantized by Three.js');
                        }
                    } else {
                        // Without EXT_meshopt_compression: manual decode as before
                        console.log('Dequantizing positions manually (no meshopt)...');
                        console.log('Original positions array type:', positions.array.constructor.name);
                        console.log('Original first values:', Array.from(positions.array.slice(0, 9)));
                        
                        // Read quantized data directly from binary buffer if needed
                        // Three.js may have incorrectly interpreted int16 as float32
                        let quantizedValues = null;
                        
                        // Check if values look like quantized integers (in SHORT range)
                        const firstVal = positions.array[0];
                        const isLikelyQuantized = Number.isInteger(firstVal) || (Math.abs(firstVal) < 32768 && Math.abs(firstVal) > 0.1);
                        
                        if (isLikelyQuantized) {
                            // Values are already in correct range, use them directly
                            quantizedValues = positions.array;
                            console.log('Using positions array directly (already quantized integers)');
                        } else {
                            // Need to read from binary buffer - find the buffer view
                            const bufferViewIndex = gltfJson.accessors[0].bufferView;
                            const bufferView = gltfJson.bufferViews[bufferViewIndex];
                            const binaryChunkOffset = 20 + jsonChunkLength + 8; // Skip JSON chunk header
                            const dataOffset = binaryChunkOffset + bufferView.byteOffset;
                            
                            // Read int16 data directly
                            const int16View = new Int16Array(arrayBuffer, dataOffset, positions.count * 3);
                            quantizedValues = new Float32Array(int16View);
                            console.log('Read int16 data from binary buffer');
                            console.log('First int16 values:', Array.from(int16View.slice(0, 9)));
                        }
                        
                        const offset = quantizationInfo.quantizationOffset;
                        const scale = quantizationInfo.quantizationScale;
                        
                        console.log('Quantization offset:', offset);
                        console.log('Quantization scale:', scale);
                        
                        // Dequantize: dequantized = quantized * scale + offset
                        const dequantized = new Float32Array(quantizedValues.length);
                        for (let i = 0; i < quantizedValues.length; i += 3) {
                            dequantized[i] = quantizedValues[i] * scale[0] + offset[0];
                            dequantized[i + 1] = quantizedValues[i + 1] * scale[1] + offset[1];
                            dequantized[i + 2] = quantizedValues[i + 2] * scale[2] + offset[2];
                        }
                        
                        // Replace positions with dequantized values
                        positions = new THREE.BufferAttribute(dequantized, 3);
                        console.log('Positions dequantized. First values:', Array.from(dequantized.slice(0, 9)));
                        console.log('Dequantized count:', dequantized.length / 3);
                    }
                }
                
                console.log('Position attribute:', {
                    count: positions.count,
                    itemSize: positions.itemSize,
                    arrayLength: positions.array ? positions.array.length : 0,
                    firstValues: positions.array ? Array.from(positions.array.slice(0, 9)) : 'no array'
                });
                
                let colors = geometry.attributes.COLOR_0 || geometry.attributes.color;
                
                // GLB colors are already BufferAttributes, use them directly
                // But we need to rename COLOR_0 to 'color' for Three.js PointsMaterial
                if (colors) {
                    console.log('Found colors in GLB:', {
                        name: colors.name || 'COLOR_0',
                        count: colors.count,
                        itemSize: colors.itemSize,
                        normalized: colors.normalized,
                        arrayLength: colors.array ? colors.array.length : 0,
                        firstValues: colors.array ? Array.from(colors.array.slice(0, 9)) : 'no array'
                    });
                } else {
                    console.log('No colors found in GLB file');
                }
                
                createPointCloud(positions, colors);
                updateInfo(positions.count);
                dropzone.classList.add('hidden');
                if (!gui) {
                    initGUI();
                }
            } else {
                console.error('No geometry found:', { mesh, hasGeometry: mesh?.geometry });
                alert('GLB file loaded but contains no valid geometry');
            }
        }, (error) => {
            console.error('Error loading GLB:', error);
            console.error('Error stack:', error.stack);
            alert('Error loading GLB file:\n' + (error.message || 'Unknown error'));
        });
    };
    
    reader.onerror = () => {
        alert('Error reading file');
    };
    
    reader.readAsArrayBuffer(file);
}

// Load PLY/SOG
function loadPLY(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        
        // Check if file is actually a PLY file
        if (!text.trim().startsWith('ply')) {
            alert('Invalid PLY file format. File does not appear to be a PLY file.\n\nPlease make sure you are loading a valid .ply or .sog file.');
            console.error('Invalid PLY header. Expected "ply", got:', text.substring(0, 20));
            return;
        }
        
        parsePLY(text);
    };
    
    reader.onerror = () => {
        alert('Error reading file');
    };
    
    reader.readAsText(file);
}

// Parse PLY
function parsePLY(text) {
    const lines = text.split('\n');
    let headerEnd = -1;
    let vertexCount = 0;
    let hasColors = false;
    let properties = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('element vertex')) {
            vertexCount = parseInt(line.split(' ')[2]);
        } else if (line.includes('red') || line.includes('green') || line.includes('blue')) {
            hasColors = true;
        } else if (line.startsWith('property')) {
            properties.push(line.split(' ')[1]);
        } else if (line === 'end_header') {
            headerEnd = i;
            break;
        }
    }
    
    if (headerEnd === -1 || vertexCount === 0) {
        alert('Error parsing PLY file');
        return;
    }
    
    const positions = new Float32Array(vertexCount * 3);
    const colors = hasColors ? new Uint8Array(vertexCount * 3) : null;
    
    let xIdx = properties.indexOf('x');
    let yIdx = properties.indexOf('y');
    let zIdx = properties.indexOf('z');
    let rIdx = hasColors ? properties.indexOf('red') : -1;
    let gIdx = hasColors ? properties.indexOf('green') : -1;
    let bIdx = hasColors ? properties.indexOf('blue') : -1;
    
    // For SOG files
    if (rIdx === -1 && properties.includes('f_dc_0')) {
        rIdx = properties.indexOf('f_dc_0');
        gIdx = properties.indexOf('f_dc_1');
        bIdx = properties.indexOf('f_dc_2');
    }
    
    let dataStart = headerEnd + 1;
    let vertexIdx = 0;
    
    for (let i = dataStart; i < lines.length && vertexIdx < vertexCount; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = line.split(/\s+/).map(v => parseFloat(v));
        
        if (xIdx >= 0 && yIdx >= 0 && zIdx >= 0) {
            positions[vertexIdx * 3] = values[xIdx];
            positions[vertexIdx * 3 + 1] = values[yIdx];
            positions[vertexIdx * 3 + 2] = values[zIdx];
        }
        
        if (colors && rIdx >= 0 && gIdx >= 0 && bIdx >= 0) {
            let r = values[rIdx];
            let g = values[gIdx];
            let b = values[bIdx];
            
            // Convert Spherical Harmonics for SOG
            if (properties.includes('f_dc_0')) {
                const SH_C0 = 0.28209479177387814;
                r = Math.max(0, Math.min(255, (0.5 + SH_C0 * r) * 255));
                g = Math.max(0, Math.min(255, (0.5 + SH_C0 * g) * 255));
                b = Math.max(0, Math.min(255, (0.5 + SH_C0 * b) * 255));
            }
            
            colors[vertexIdx * 3] = r;
            colors[vertexIdx * 3 + 1] = g;
            colors[vertexIdx * 3 + 2] = b;
        }
        
        vertexIdx++;
    }
    
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const colorAttr = colors ? new THREE.BufferAttribute(colors, 3, true) : null;
    
    createPointCloud(positionAttr, colorAttr);
    updateInfo(vertexCount);
    dropzone.classList.add('hidden');
    if (!gui) {
        initGUI();
    }
}

// Filter points uniformly across volume using voxel grid
function filterPointsUniformly(targetCount) {
    if (!originalPositions || !pointCloud) return;
    
    if (targetCount >= originalPointCount) {
        // No filtering needed, restore all points
        restoreAllPoints();
        return;
    }
    
    const positions = new Float32Array(originalPointCount * 3);
    for (let i = 0; i < originalPointCount; i++) {
        positions[i * 3] = originalPositions[i * 3];
        positions[i * 3 + 1] = originalPositions[i * 3 + 1];
        positions[i * 3 + 2] = originalPositions[i * 3 + 2];
    }
    
    // Calculate bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < originalPointCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
    }
    
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    
    // Calculate voxel size based on target count
    // We want approximately targetCount voxels
    const volume = sizeX * sizeY * sizeZ;
    const voxelVolume = volume / targetCount;
    const voxelSize = Math.cbrt(voxelVolume);
    
    // Create voxel grid
    const gridSizeX = Math.ceil(sizeX / voxelSize) + 1;
    const gridSizeY = Math.ceil(sizeY / voxelSize) + 1;
    const gridSizeZ = Math.ceil(sizeZ / voxelSize) + 1;
    
    // Map points to voxels
    const voxelMap = new Map();
    for (let i = 0; i < originalPointCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        
        const voxelX = Math.floor((x - minX) / voxelSize);
        const voxelY = Math.floor((y - minY) / voxelSize);
        const voxelZ = Math.floor((z - minZ) / voxelSize);
        
        const key = `${voxelX},${voxelY},${voxelZ}`;
        if (!voxelMap.has(key)) {
            voxelMap.set(key, []);
        }
        voxelMap.get(key).push(i);
    }
    
    // Select one point per voxel (or more if needed)
    const selectedIndices = new Set();
    const voxelKeys = Array.from(voxelMap.keys());
    
    // Shuffle for randomness
    for (let i = voxelKeys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [voxelKeys[i], voxelKeys[j]] = [voxelKeys[j], voxelKeys[i]];
    }
    
    // Select points from voxels
    for (const key of voxelKeys) {
        const indices = voxelMap.get(key);
        if (indices.length > 0) {
            const randomIndex = indices[Math.floor(Math.random() * indices.length)];
            selectedIndices.add(randomIndex);
            if (selectedIndices.size >= targetCount) break;
        }
    }
    
    // If we need more points, add randomly from remaining voxels
    if (selectedIndices.size < targetCount) {
        const remainingIndices = [];
        for (let i = 0; i < originalPointCount; i++) {
            if (!selectedIndices.has(i)) {
                remainingIndices.push(i);
            }
        }
        // Shuffle
        for (let i = remainingIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remainingIndices[i], remainingIndices[j]] = [remainingIndices[j], remainingIndices[i]];
        }
        const needed = targetCount - selectedIndices.size;
        for (let i = 0; i < needed && i < remainingIndices.length; i++) {
            selectedIndices.add(remainingIndices[i]);
        }
    }
    
    // Create filtered arrays
    const filteredIndices = Array.from(selectedIndices).sort((a, b) => a - b);
    const filteredCount = filteredIndices.length;
    
    const filteredPositions = new Float32Array(filteredCount * 3);
    let filteredColors = null;
    if (originalColors) {
        filteredColors = new Float32Array(filteredCount * 3);
    }
    
    for (let i = 0; i < filteredCount; i++) {
        const origIdx = filteredIndices[i];
        filteredPositions[i * 3] = originalPositions[origIdx * 3];
        filteredPositions[i * 3 + 1] = originalPositions[origIdx * 3 + 1];
        filteredPositions[i * 3 + 2] = originalPositions[origIdx * 3 + 2];
        
        if (filteredColors) {
            filteredColors[i * 3] = originalColors[origIdx * 3];
            filteredColors[i * 3 + 1] = originalColors[origIdx * 3 + 1];
            filteredColors[i * 3 + 2] = originalColors[origIdx * 3 + 2];
        }
    }
    
    // Update geometry
    const geometry = pointCloud.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(filteredPositions, 3));
    if (filteredColors) {
        geometry.setAttribute('color', new THREE.BufferAttribute(filteredColors, 3, true));
    }
    geometry.attributes.position.needsUpdate = true;
    if (geometry.attributes.color) {
        geometry.attributes.color.needsUpdate = true;
    }
    
    // Reapply animation to update shader if needed
    if (currentMaterial && currentMaterial.uniforms) {
        applyAnimation(currentAnimation);
    }
}

// Restore all original points
function restoreAllPoints() {
    if (!originalPositions || !pointCloud) return;
    
    const geometry = pointCloud.geometry;
    const restoredPositions = new Float32Array(originalPositions);
    geometry.setAttribute('position', new THREE.BufferAttribute(restoredPositions, 3));
    
    if (originalColors) {
        const restoredColors = new Float32Array(originalColors);
        geometry.setAttribute('color', new THREE.BufferAttribute(restoredColors, 3, true));
    }
    
    geometry.attributes.position.needsUpdate = true;
    if (geometry.attributes.color) {
        geometry.attributes.color.needsUpdate = true;
    }
    
    // Reapply animation to update shader if needed
    if (currentMaterial && currentMaterial.uniforms) {
        applyAnimation(currentAnimation);
    }
}

// Create point cloud
function createPointCloud(positionAttr, colorAttr) {
    console.log('createPointCloud called with:', {
        positionAttr: positionAttr ? {
            count: positionAttr.count,
            itemSize: positionAttr.itemSize,
            arrayLength: positionAttr.array ? positionAttr.array.length : 0
        } : null,
        colorAttr: colorAttr ? {
            count: colorAttr.count,
            itemSize: colorAttr.itemSize,
            normalized: colorAttr.normalized
        } : null
    });
    
    // Remove old point cloud
    if (pointCloud) {
        scene.remove(pointCloud);
        if (pointCloud.geometry) pointCloud.geometry.dispose();
        if (pointCloud.material) pointCloud.material.dispose();
    }
    
    if (!positionAttr) {
        console.error('No position attribute provided!');
        alert('Cannot create point cloud: no position data');
        return;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionAttr);
    console.log('Geometry created with position attribute, count:', positionAttr.count);
    
    // Handle color attribute - it might already be a BufferAttribute from GLB
    if (colorAttr) {
        // If it's already a BufferAttribute, clone it properly
        if (colorAttr instanceof THREE.BufferAttribute) {
            // Clone the array to avoid modifying the original
            const colorArray = colorAttr.array.slice();
            const colorBuffer = new THREE.BufferAttribute(
                colorArray,
                colorAttr.itemSize,
                colorAttr.normalized
            );
            geometry.setAttribute('color', colorBuffer);
            // Check a few sample colors
            const sampleColors = [];
            for (let i = 0; i < Math.min(5, colorBuffer.count); i++) {
                const idx = i * 3;
                sampleColors.push([colorArray[idx], colorArray[idx + 1], colorArray[idx + 2]]);
            }
            console.log('Cloned color attribute:', {
                count: colorBuffer.count,
                itemSize: colorBuffer.itemSize,
                normalized: colorBuffer.normalized,
                sampleColors: sampleColors
            });
        } else if (colorAttr instanceof THREE.InterleavedBufferAttribute) {
            // For interleaved attributes, extract the data
            const interleavedBuffer = colorAttr.data;
            const stride = interleavedBuffer.stride;
            const offset = colorAttr.offset;
            const count = colorAttr.count;
            const colorArray = new Float32Array(count * 3);
            
            for (let i = 0; i < count; i++) {
                const index = i * stride + offset;
                colorArray[i * 3] = interleavedBuffer.array[index];
                colorArray[i * 3 + 1] = interleavedBuffer.array[index + 1];
                colorArray[i * 3 + 2] = interleavedBuffer.array[index + 2];
            }
            
            const colorBuffer = new THREE.BufferAttribute(colorArray, 3, false);
            geometry.setAttribute('color', colorBuffer);
            console.log('Extracted interleaved color attribute:', {
                count: colorBuffer.count,
                firstColor: [colorArray[0], colorArray[1], colorArray[2]]
            });
        } else {
            // If it's raw data, create BufferAttribute
            geometry.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3, true));
        }
    }
    
    const hasColors = geometry.attributes.color !== undefined;
    const material = new THREE.PointsMaterial({
        size: params.pointSize,
        vertexColors: hasColors,
        transparent: true,
        opacity: params.opacity
    });
    
    // Set default color if no vertex colors
    if (!hasColors) {
        material.color.set(0xffffff);
    }
    
    // Final verification
    const finalColorAttr = geometry.attributes.color;
    console.log('Created point cloud:', {
        pointCount: positionAttr.count,
        hasColors: hasColors,
        vertexColors: material.vertexColors,
        materialVertexColors: material.vertexColors,
        colorAttribute: finalColorAttr ? {
            count: finalColorAttr.count,
            itemSize: finalColorAttr.itemSize,
            normalized: finalColorAttr.normalized,
            exists: true
        } : null
    });
    
    // Force material to use vertex colors if they exist
    if (hasColors) {
        console.log('Forcing vertexColors to true for material');
        material.vertexColors = true;
        material.color.set(0xffffff); // White color when using vertex colors
        material.needsUpdate = true;
        // Explicitly set colorMode to 'file' if colors exist
        params.colorMode = 'file';
    } else {
        material.color.set(0xffffff);
    }
    
    pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
    currentMaterial = material;
    
    // Store original data for filtering
    originalPointCount = geometry.attributes.position.count;
    originalPositions = geometry.attributes.position.array.slice();
    if (geometry.attributes.color) {
        originalColors = geometry.attributes.color.array.slice();
    } else {
        originalColors = null;
    }
    
    // Update params
    params.maxPoints = originalPointCount;
    params.pointPercent = 100;
    
    // Update GUI controls if they exist
    if (maxPointsCtrl) {
        maxPointsCtrl.min(0);
        maxPointsCtrl.max(originalPointCount);
        maxPointsCtrl.updateDisplay();
    }
    if (pointPercentCtrl) {
        pointPercentCtrl.updateDisplay();
    }
    
    // Update estimated file size
    updateEstimatedFileSize(originalPointCount);
    
    // Setup camera
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;
    camera.position.set(center.x, center.y, center.z + cameraZ);
    controls.target.copy(center);
    controls.update();
    
    // Apply current animation (but preserve vertexColors if colors exist)
    const savedHasColors = hasColors;
    
    // Don't auto-enable animations on load - user must enable manually via GUI
    // Animation will be applied based on params.animation (default: 'none')
    
    applyAnimation(params.animation);
    currentAnimation = params.animation;
    
    // After applying animation, restore vertexColors if needed
    if (savedHasColors && currentMaterial) {
        console.log('Restoring vertexColors after animation application');
        currentMaterial.vertexColors = true;
        // Only set color for PointsMaterial (ShaderMaterial doesn't have color property)
        if (currentMaterial.isPointsMaterial && currentMaterial.color) {
            currentMaterial.color.set(0xffffff);
        }
        currentMaterial.needsUpdate = true;
    }
}

// ==================== GUI Setup ====================

function initGUI() {
    // Destroy existing GUI if it exists
    if (gui) {
        gui.destroy();
    }
    
    // Create new GUI
    gui = new GUI({ autoPlace: true });
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '20px';
    gui.domElement.style.right = '20px';
    gui.domElement.style.zIndex = '50';
    
    // Scene folder - FIRST section
    sceneFolder = gui.addFolder('Scene');
    
    // Scene selector dropdown (will be updated when models are loaded)
    // Initialize with empty array, will be updated after models are loaded
    params.selectedScene = defaultScenes.length > 0 ? defaultScenes[0] : '';
    selectedSceneCtrl = sceneFolder.add(params, 'selectedScene', defaultScenes).name('Default Scene');
    selectedSceneCtrl.onChange((value) => {
        if (!value || !defaultScenes.includes(value)) return;
        
        // Remove old point cloud immediately before loading new one
        if (pointCloud) {
            console.log('🟡 [DEBUG] Removing old point cloud before loading new model...');
            scene.remove(pointCloud);
            if (pointCloud.geometry) pointCloud.geometry.dispose();
            if (pointCloud.material) pointCloud.material.dispose();
            pointCloud = null;
            currentMaterial = null;
        }
        
        // Update URL parameter
        updateURLParameter('model', value);
        // Load the file
        const url = `default_scenes/${value}`;
        loadFileFromURL(url, value);
    });
    
    // Load custom file button
    sceneFolder.add(params, 'loadCustomFile').name('Load Custom File');
    
    // Drag & Drop area in panel (we'll add this via HTML/CSS)
    sceneFolder.open();
    
    // Information folder
    infoFolder = gui.addFolder('Information');
    const pointsCtrl = infoFolder.add(params, 'points').name('Points').listen();
    // Disable input for read-only field (lil-gui uses different DOM structure)
    const pointsInput = pointsCtrl.domElement.querySelector('input') || pointsCtrl.domElement.querySelector('.lil-gui input');
    if (pointsInput) pointsInput.disabled = true;
    const sizeCtrl = infoFolder.add(params, 'fileSize').name('Size').listen();
    const sizeInput = sizeCtrl.domElement.querySelector('input') || sizeCtrl.domElement.querySelector('.lil-gui input');
    if (sizeInput) sizeInput.disabled = true;
    
    // Point filtering controls
    pointPercentCtrl = infoFolder.add(params, 'pointPercent', 0, 100, 1).name('Point Percent (%)');
    pointPercentCtrl.onChange((value) => {
        if (originalPointCount > 0) {
            const targetCount = Math.floor((value / 100) * originalPointCount);
            if (params.maxPoints !== targetCount) {
                params.maxPoints = targetCount;
                if (maxPointsCtrl) maxPointsCtrl.updateDisplay();
            }
            filterPointsUniformly(targetCount);
            updateEstimatedFileSize(targetCount);
        }
    });
    
    maxPointsCtrl = infoFolder.add(params, 'maxPoints', 0, originalPointCount || 1, 1).name('Max Points');
    maxPointsCtrl.onChange((value) => {
        if (originalPointCount > 0) {
            // Update percentage based on maxPoints
            const newPercent = Math.round((value / originalPointCount) * 100);
            if (params.pointPercent !== newPercent) {
                params.pointPercent = newPercent;
                if (pointPercentCtrl) pointPercentCtrl.updateDisplay();
            }
            filterPointsUniformly(value);
            updateEstimatedFileSize(value);
        }
    });
    
    // Estimated file size (read-only)
    estimatedFileSizeCtrl = infoFolder.add(params, 'estimatedFileSize').name('Estimated Size').listen();
    const estimatedSizeInput = estimatedFileSizeCtrl.domElement.querySelector('input') || estimatedFileSizeCtrl.domElement.querySelector('.lil-gui input');
    if (estimatedSizeInput) estimatedSizeInput.disabled = true;
    
    // Initialize estimated file size
    if (originalPointCount > 0) {
        updateEstimatedFileSize(params.maxPoints || originalPointCount);
    }
    
    infoFolder.open();
    
    // Display folder
    displayFolder = gui.addFolder('Display');
    
    // Use Shader Material - first in Display folder
    const useShaderCtrl = displayFolder.add(params, 'useShaderMaterial').name('Use Shader Material');
    
    // Point Size and Opacity controls (work for both PointsMaterial and ShaderMaterial)
    const pointSizeCtrl = displayFolder.add(params, 'pointSize', 0.01, 0.2, 0.01).name('Point Size');
    pointSizeCtrl.onChange((value) => {
        if (currentMaterial && !params.useShaderMaterial) {
            // For PointsMaterial
            currentMaterial.size = value;
        } else if (currentMaterial && currentMaterial.uniforms && currentMaterial.uniforms.uPointSize) {
            // For ShaderMaterial
            currentMaterial.uniforms.uPointSize.value = value * 100.0;
        }
    });
    
    const opacityCtrl = displayFolder.add(params, 'opacity', 0, 1, 0.05).name('Opacity');
    opacityCtrl.onChange((value) => {
        if (currentMaterial && !params.useShaderMaterial) {
            // For PointsMaterial
            currentMaterial.opacity = value;
            currentMaterial.transparent = value < 1;
        } else if (currentMaterial && currentMaterial.uniforms && currentMaterial.uniforms.uOpacity) {
            // For ShaderMaterial
            currentMaterial.uniforms.uOpacity.value = value;
        }
    });
    
    // Color Mode and Custom Color controls
    const colorModeCtrl = displayFolder.add(params, 'colorMode', ['file', 'custom']).name('Color Mode');
    colorModeCtrl.onChange((value) => {
        if (!pointCloud) {
            console.warn('Cannot change color mode: pointCloud is null');
            return;
        }
        
        const hasColors = pointCloud.geometry.attributes.color !== undefined;
        console.log('Color mode changed to:', value, 'hasColors:', hasColors);
        
        // If using shader material, recreate it to apply color mode changes
        if (params.useShaderMaterial) {
            applyAnimation(currentAnimation);
        } else {
            // For PointsMaterial
            if (!currentMaterial) {
                console.warn('Cannot change color mode: material is null');
                return;
            }
            
            if (value === 'file') {
                if (hasColors) {
                    currentMaterial.vertexColors = true;
                    currentMaterial.color.set(0xffffff);
                } else {
                    currentMaterial.vertexColors = false;
                    currentMaterial.color.set(0xffffff);
                }
                currentMaterial.needsUpdate = true;
            } else {
                currentMaterial.vertexColors = false;
                const color = new THREE.Color(params.customColor);
                currentMaterial.color.copy(color);
                currentMaterial.needsUpdate = true;
            }
        }
    });
    
    const customColorCtrl = displayFolder.addColor(params, 'customColor').name('Custom Color');
    customColorCtrl.onChange((value) => {
        if (!pointCloud) return;
        
        // If using shader material, update uniform or recreate material
        if (params.useShaderMaterial) {
            if (params.colorMode === 'custom') {
                // Try to update uniform directly if material exists
                if (currentMaterial && currentMaterial.uniforms && currentMaterial.uniforms.uColor) {
                    currentMaterial.uniforms.uColor.value = new THREE.Color(value);
                } else {
                    // Otherwise recreate material
                    applyAnimation(currentAnimation);
                }
            }
        } else {
            // For PointsMaterial
            if (currentMaterial && params.colorMode === 'custom') {
                const color = new THREE.Color(value);
                currentMaterial.color.copy(color);
                currentMaterial.needsUpdate = true;
            }
        }
    });
    
    // Background color control
    const backgroundColorCtrl = displayFolder.addColor(params, 'backgroundColor').name('Background Color');
    backgroundColorCtrl.onChange((value) => {
        renderer.setClearColor(value);
    });
    
    // Update controls state based on useShaderMaterial
    const updateControlsState = () => {
        const isShaderEnabled = params.useShaderMaterial;
        
        // Point size and opacity controls work for both materials now
        // Don't disable them anymore
        pointSizeCtrl.enable();
        opacityCtrl.enable();
        
        // Color mode and custom color are always active when shader material is enabled
        if (isShaderEnabled) {
            colorModeCtrl.enable();
            customColorCtrl.enable();
        } else {
            colorModeCtrl.enable();
            customColorCtrl.enable();
        }
    };
    
    // Initial state update
    updateControlsState();
    
    // Update state when useShaderMaterial changes
    useShaderCtrl.onChange((value) => {
        updateControlsState();
        if (pointCloud) {
            applyAnimation(currentAnimation);
        }
    });
    displayFolder.open();
    
    // Animation folder - Spherical Waves
    const animFolder = gui.addFolder('Animation');
    
    // Enable/disable waves checkbox
    const wavesEnabledCtrl = animFolder.add(params, 'wavesEnabled').name('Enable Waves');
    wavesEnabledCtrl.onChange((value) => {
        if (pointCloud) {
            if (value) {
                // Enable waves animation
                params.animation = 'spherical_waves';
                currentAnimation = 'spherical_waves';
            } else {
                // Disable waves, return to none
                params.animation = 'none';
                currentAnimation = 'none';
            }
            applyAnimation(currentAnimation);
        }
    });
    
    // Wave amplitude control (1-10) - controls wave width
    const wavesAmplitudeCtrl = animFolder.add(params, 'wavesAmplitude', 1, 10, 0.1).name('Wave Width');
    wavesAmplitudeCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavesAmplitude) {
            pointCloud.material.uniforms.uWavesAmplitude.value = value;
        }
    });
    
    // Wave period control (1-10) - number of simultaneous waves
    const wavesPeriodCtrl = animFolder.add(params, 'wavesPeriod', 1, 10, 0.1).name('Wave Count');
    wavesPeriodCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavePeriod) {
            pointCloud.material.uniforms.uWavePeriod.value = value;
        }
    });
    
    // Wave speed control (units per second) - propagation speed
    const wavesSpeedCtrl = animFolder.add(params, 'wavesSpeed', 0.1, 50, 0.1).name('Wave Speed (units/s)');
    wavesSpeedCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavesSpeed) {
            pointCloud.material.uniforms.uWavesSpeed.value = value;
        }
    });
    
    // Wave color control
    const wavesColorCtrl = animFolder.addColor(params, 'wavesColor').name('Wave Color');
    wavesColorCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWaveColor) {
            const waveColor = new THREE.Color(value);
            pointCloud.material.uniforms.uWaveColor.value = waveColor;
        }
    });
    
    // Wave color intensity control (0-10)
    const wavesColorIntensityCtrl = animFolder.add(params, 'wavesColorIntensity', 0, 10, 0.1).name('Color Intensity');
    wavesColorIntensityCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWaveColorIntensity) {
            pointCloud.material.uniforms.uWaveColorIntensity.value = value;
        }
    });
    
    // Displacement axis control
    const wavesDisplacementAxisCtrl = animFolder.add(params, 'wavesDisplacementAxis', ['x', 'y', 'z']).name('Displacement Axis');
    wavesDisplacementAxisCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uDisplacementAxis) {
            const axisValue = value === 'x' ? 0 : (value === 'y' ? 1 : 2);
            pointCloud.material.uniforms.uDisplacementAxis.value = axisValue;
        }
    });
    
    // Displacement amount control (0-10)
    const wavesDisplacementCtrl = animFolder.add(params, 'wavesDisplacement', 0, 10, 0.1).name('Displacement');
    wavesDisplacementCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uDisplacement) {
            pointCloud.material.uniforms.uDisplacement.value = value;
        }
    });
    
    animFolder.open();
    
}

// Apply animation
function applyAnimation(type) {
    if (!pointCloud || !pointCloud.geometry) return;
    
    if (type === 'none') {
        // Use shader material if explicitly enabled
        const useShader = params.useShaderMaterial;
        
        if (useShader) {
            const geometry = pointCloud.geometry;
            const hasColors = geometry.attributes.color !== undefined;
            const useVertexColors = params.colorMode === 'file' && hasColors;
            
            let vertexShader = getVertexShader('none', useVertexColors);
            const fragmentShader = useVertexColors ? `
                precision highp float;
                varying vec3 vColor;
                uniform float uOpacity;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                    alpha *= uOpacity;
                    gl_FragColor = vec4(vColor, alpha);
                }
            ` : `
                precision highp float;
                uniform vec3 uColor;
                uniform float uOpacity;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                    alpha *= uOpacity;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `;
            
            const uniforms = {
                uTime: { value: animationTime },
                uDuration: { value: 2.0 },
                uAmplitude: { value: params.animAmplitude },
                uSpeed: { value: params.animSpeed },
                uPointSize: { value: params.pointSize * 100.0 }, // Конвертируем 0.01-0.2 в 1-20 пикселей
                uOpacity: { value: params.opacity } // Прозрачность
            };
            
            if (!useVertexColors) {
                uniforms.uColor = { value: new THREE.Color(params.customColor) };
            }
            
            const material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms,
                transparent: true,
                vertexColors: useVertexColors,
                lights: false, // Disable automatic lighting - we'll handle it manually
                fog: false
            });
            
            scene.remove(pointCloud);
            if (pointCloud.material) pointCloud.material.dispose();
            pointCloud.material = material;
            scene.add(pointCloud);
            currentMaterial = material;
            return;
        }
        
        // Return to regular PointsMaterial (if not using shader material)
        const geometry = pointCloud.geometry;
        const hasColors = geometry.attributes.color !== undefined;
        console.log('Applying none animation, hasColors:', hasColors, 'colorMode:', params.colorMode);
        
        const material = new THREE.PointsMaterial({
            size: params.pointSize,
            vertexColors: false, // Will be set based on colorMode
            transparent: true,
            opacity: params.opacity
        });
        
        // Set vertexColors based on colorMode
        if (params.colorMode === 'file' && hasColors) {
            material.vertexColors = true;
            material.color.set(0xffffff);
            console.log('Set vertexColors = true for file mode with colors');
        } else if (params.colorMode === 'custom') {
            material.vertexColors = false;
            const color = new THREE.Color(params.customColor);
            material.color.copy(color);
            console.log('Set custom color:', params.customColor);
        } else {
            // No colors or file mode without colors
            material.vertexColors = false;
            material.color.set(0xffffff);
            console.log('Using default white color');
        }
        
        material.needsUpdate = true;
        
        scene.remove(pointCloud);
        if (pointCloud.material) pointCloud.material.dispose();
        pointCloud.material = material;
        scene.add(pointCloud);
        currentMaterial = material;
        
        console.log('Material after none animation:', {
            vertexColors: material.vertexColors,
            hasColors: hasColors,
            colorMode: params.colorMode,
            materialColor: material.color.getHexString()
        });
        return;
    }
    
    // Create shader material for animation
    const geometry = pointCloud.geometry;
    const hasColors = geometry.attributes.color !== undefined;
    // Use colors only if colorMode is 'file' and colors exist
    const useVertexColors = params.colorMode === 'file' && hasColors;
    
    console.log('Creating shader material:', {
        type: type,
        hasColors: hasColors,
        colorMode: params.colorMode,
        useVertexColors: useVertexColors
    });
    
    let vertexShader = getVertexShader(type, useVertexColors);
    
    // Special fragment shader for spherical waves with color interpolation
    let fragmentShader;
    if (type === 'spherical_waves') {
        fragmentShader = useVertexColors ? `
            precision highp float;
            varying vec3 vColor;
            varying float vWaveIntensity;
            uniform vec3 uWaveColor;
            uniform float uWaveColorIntensity;
            uniform float uOpacity;
            
            void main() {
                // Point shape
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                alpha *= uOpacity;
                
                // Normalize color intensity: map from 0-10 to 0.0-1.0
                float normalizedIntensity = uWaveColorIntensity * 0.1;
                
                // Calculate effective wave intensity: multiply wave intensity by color intensity
                // This controls how pronounced the wave color is
                float effectiveIntensity = vWaveIntensity * normalizedIntensity;
                
                // Interpolate between base color and wave color based on effective intensity
                vec3 finalColor = mix(vColor, uWaveColor, effectiveIntensity);
                
                gl_FragColor = vec4(finalColor, alpha);
            }
        ` : `
            precision highp float;
            uniform vec3 uColor;
            varying float vWaveIntensity;
            uniform vec3 uWaveColor;
            uniform float uWaveColorIntensity;
            uniform float uOpacity;
            
            void main() {
                // Point shape
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                alpha *= uOpacity;
                
                // Normalize color intensity: map from 0-10 to 0.0-1.0
                float normalizedIntensity = uWaveColorIntensity * 0.1;
                
                // Calculate effective wave intensity: multiply wave intensity by color intensity
                // This controls how pronounced the wave color is
                float effectiveIntensity = vWaveIntensity * normalizedIntensity;
                
                // Interpolate between base color and wave color based on effective intensity
                vec3 finalColor = mix(uColor, uWaveColor, effectiveIntensity);
                
                gl_FragColor = vec4(finalColor, alpha);
            }
        `;
    } else {
        fragmentShader = useVertexColors ? `
            precision highp float;
            varying vec3 vColor;
            varying float vWaveIntensity;
            uniform float uOpacity;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                alpha *= uOpacity;
                gl_FragColor = vec4(vColor, alpha);
            }
        ` : `
            precision highp float;
            uniform vec3 uColor;
            varying float vWaveIntensity;
            uniform float uOpacity;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                alpha *= uOpacity;
                gl_FragColor = vec4(uColor, alpha);
            }
        `;
    }
    
    const uniforms = {
        uTime: { value: 0 },
        uDuration: { value: 2.0 },
        uAmplitude: { value: params.animAmplitude },
        uSpeed: { value: params.animSpeed },
        uPointSize: { value: params.pointSize * 100.0 }, // Конвертируем 0.01-0.2 в 1-20 пикселей
        uOpacity: { value: params.opacity } // Прозрачность
    };
    
    
    // Add specific uniforms for different animations
    if (type === 'rain') {
        uniforms.uDropHeight = { value: 10.0 };
    } else if (type === 'wave') {
        uniforms.uFrequency = { value: 0.1 };
    } else if (type === 'tornado') {
        uniforms.uFunnelRadius = { value: 5.0 };
        uniforms.uRotationSpeed = { value: 2.0 };
    } else if (type === 'explosion') {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const center = box.getCenter(new THREE.Vector3());
        uniforms.uCenter = { value: center };
        uniforms.uExplosionRadius = { value: 10.0 };
    } else if (type === 'morph') {
        uniforms.uNoiseScale = { value: 0.1 };
        uniforms.uNoiseAmplitude = { value: 2.0 };
    } else if (type === 'spherical_waves') {
        // Calculate model center (local coordinates 0,0,0 after centering)
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDistance = Math.max(size.x, size.y, size.z) * 0.5; // Maximum distance from center
        
        uniforms.uCenter = { value: center };
        uniforms.uWavesAmplitude = { value: params.wavesAmplitude };
        uniforms.uWavePeriod = { value: params.wavesPeriod };
        uniforms.uWavesSpeed = { value: params.wavesSpeed };
        uniforms.uMaxDistance = { value: maxDistance }; // Maximum distance for calculating wave intervals
        // Wave color uniform
        const waveColor = new THREE.Color(params.wavesColor);
        uniforms.uWaveColor = { value: waveColor };
        uniforms.uWaveColorIntensity = { value: params.wavesColorIntensity }; // Color intensity (0-10)
        // Displacement settings
        uniforms.uDisplacementAxis = { value: params.wavesDisplacementAxis === 'x' ? 0 : (params.wavesDisplacementAxis === 'y' ? 1 : 2) }; // 0=x, 1=y, 2=z
        uniforms.uDisplacement = { value: params.wavesDisplacement };
    }
    
    
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        vertexColors: useVertexColors,
        lights: false, // Disable automatic lighting - we'll handle it manually
        fog: false
    });
    
    // Check for shader compilation errors
    material.onBeforeCompile = (shader) => {
        console.log('Compiling shader');
    };
    
    console.log('Shader material created with vertexColors:', useVertexColors);
    
    // If using custom color, add it as uniform
    if (!useVertexColors) {
        const customColor = new THREE.Color(params.customColor);
        material.uniforms.uColor = { value: customColor };
        console.log('Added custom color uniform:', params.customColor);
    }
    
    scene.remove(pointCloud);
    if (pointCloud.material) pointCloud.material.dispose();
    pointCloud.material = material;
    scene.add(pointCloud);
    currentMaterial = material;
}

// Get vertex shader for animation
function getVertexShader(type, hasColors = true) {
    const common = `
        precision highp float;
        // position and color attributes are provided by Three.js automatically
        uniform float uTime;
        uniform float uDuration;
        uniform float uAmplitude;
        uniform float uSpeed;
        varying vec3 vColor;
        varying float vWaveIntensity;
        
        float hash(float n) {
            return fract(sin(n) * 43758.5453);
        }
        
        float easeOutBounce(float t) {
            if (t < 1.0 / 2.75) {
                return 7.5625 * t * t;
            } else if (t < 2.0 / 2.75) {
                return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
            } else if (t < 2.5 / 2.75) {
                return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
            } else {
                return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
            }
        }
        
        float easeOutExpo(float t) {
            return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
        }
        
        vec3 mod289(vec3 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }
        
        vec4 mod289(vec4 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }
        
        vec4 permute(vec4 x) {
            return mod289(((x*34.0)+1.0)*x);
        }
        
        vec4 taylorInvSqrt(vec4 r) {
            return 1.79284291400159 - 0.85373472095314 * r;
        }
        
        float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            
            vec3 i = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            
            i = mod289(i);
            vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
            
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }
    `;
    
    let animationCode = '';
    
    if (type === 'none') {
        animationCode = `
            uniform float uPointSize;
            void main() {
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vWaveIntensity = 0.0; // No wave intensity for 'none' animation
                vec3 pos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'rain') {
        animationCode = `
            uniform float uDropHeight;
            uniform float uPointSize;
            void main() {
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vWaveIntensity = 0.0;
                float delay = fract(hash(float(gl_VertexID)) * uDuration * 0.5);
                float t = clamp((uTime * uSpeed - delay) / uDuration, 0.0, 1.0);
                vec3 start = vec3(position.x, position.y + uDropHeight, position.z);
                vec3 pos = mix(start, position, easeOutBounce(t));
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'wave') {
        animationCode = `
            uniform float uFrequency;
            uniform float uPointSize;
            void main() {
                vWaveIntensity = 0.0;
                float dist = length(position.xz);
                float t = clamp((uTime * uSpeed - dist * 0.3) / uDuration, 0.0, 1.0);
                float wave = sin(dist * uFrequency - uTime * uSpeed * 2.0) * uAmplitude * t;
                
                // Calculate wave phase for color modulation
                float wavePhase = sin(dist * uFrequency - uTime * uSpeed * 2.0);
                // Normalize wavePhase from [-1, 1] to [0, 1]
                float colorPhase = (wavePhase + 1.0) * 0.5;
                
                // Create color gradient based on wave phase
                // Use HSV-like color transition: blue -> cyan -> green -> yellow -> red
                vec3 waveColor;
                if (colorPhase < 0.25) {
                    // Blue to cyan
                    float mixVal = colorPhase * 4.0;
                    waveColor = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), mixVal);
                } else if (colorPhase < 0.5) {
                    // Cyan to green
                    float mixVal = (colorPhase - 0.25) * 4.0;
                    waveColor = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), mixVal);
                } else if (colorPhase < 0.75) {
                    // Green to yellow
                    float mixVal = (colorPhase - 0.5) * 4.0;
                    waveColor = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), mixVal);
                } else {
                    // Yellow to red
                    float mixVal = (colorPhase - 0.75) * 4.0;
                    waveColor = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), mixVal);
                }
                
                // Mix original color (if exists) with wave color based on animation progress
                vec3 baseColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vColor = mix(baseColor, waveColor, t * 0.8); // Blend 80% wave color when animated
                
                vec3 pos = position + vec3(0.0, wave, 0.0);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'tornado') {
        animationCode = `
            uniform float uFunnelRadius;
            uniform float uRotationSpeed;
            uniform float uPointSize;
            void main() {
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vWaveIntensity = 0.0;
                float delay = fract(hash(float(gl_VertexID)) * uDuration * 0.5);
                float t = clamp((uTime * uSpeed - delay) / uDuration, 0.0, 1.0);
                float progress = smoothstep(0.0, 1.0, t);
                float radius = uFunnelRadius * (1.0 - progress);
                float angle = uTime * uSpeed * uRotationSpeed + hash(float(gl_VertexID)) * 6.28;
                vec3 spiral = vec3(cos(angle) * radius, position.y, sin(angle) * radius);
                vec3 pos = mix(spiral, position, progress);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'explosion') {
        animationCode = `
            uniform vec3 uCenter;
            uniform float uExplosionRadius;
            uniform float uPointSize;
            void main() {
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vWaveIntensity = 0.0;
                float delay = fract(hash(float(gl_VertexID)) * uDuration * 0.5);
                float t = clamp((uTime * uSpeed - delay) / uDuration, 0.0, 1.0);
                vec3 dir = normalize(position - uCenter);
                vec3 exploded = uCenter + dir * uExplosionRadius * (hash(float(gl_VertexID)) * 0.5 + 0.5);
                vec3 pos = mix(exploded, position, easeOutExpo(t));
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'morph') {
        animationCode = `
            uniform float uNoiseScale;
            uniform float uNoiseAmplitude;
            uniform float uPointSize;
            void main() {
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                vWaveIntensity = 0.0;
                float delay = fract(hash(float(gl_VertexID)) * uDuration * 0.5);
                float t = clamp((uTime * uSpeed - delay) / uDuration, 0.0, 1.0);
                float progress = smoothstep(0.0, 1.0, t);
                vec3 noise = vec3(
                    snoise(position * uNoiseScale + uTime * uSpeed * 0.5),
                    snoise(position * uNoiseScale + uTime * uSpeed * 0.5 + vec3(100.0)),
                    snoise(position * uNoiseScale + uTime * uSpeed * 0.5 + vec3(200.0))
                );
                vec3 pos = mix(position + noise * uNoiseAmplitude * uAmplitude, position, progress);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    } else if (type === 'spherical_waves') {
        animationCode = `
            uniform vec3 uCenter;
            uniform float uWavesAmplitude; // Wave width (1-10) - controls how many points are affected
            uniform float uWavePeriod; // Number of simultaneous waves (1-10)
            uniform float uWavesSpeed; // Wave propagation speed (units per second)
            uniform float uMaxDistance; // Maximum distance from center
            uniform float uDisplacementAxis; // 0=x, 1=y, 2=z
            uniform float uDisplacement; // Displacement amount (0-10)
            uniform float uPointSize;
            
            void main() {
                // Calculate distance from center (local coordinates 0,0,0)
                vec3 offsetFromCenter = position - uCenter;
                float distance = length(offsetFromCenter);
                
                // Use absolute speed value directly (units per second)
                // No adaptive scaling - user controls speed directly
                float normalizedSpeed = uWavesSpeed;
                
                // Calculate wave interval: how far apart waves start (in distance units)
                // More waves (higher period) = smaller interval between wave starts
                // If period = 5, we want up to 5 waves simultaneously, so interval = maxDistance / 5
                float waveInterval = uMaxDistance / max(uWavePeriod, 1.0);
                
                // Calculate time interval: how often new waves start (in seconds)
                // Time for one wave to travel waveInterval distance
                float timeInterval = waveInterval / normalizedSpeed;
                
                // Calculate current wave number (most recent wave that started)
                float currentWaveNumber = floor(uTime / timeInterval);
                
                // Check multiple recent waves to find which one affects this point
                // We check up to uWavePeriod waves back
                float maxIntensity = 0.0;
                float numWavesToCheck = min(uWavePeriod, 10.0); // Limit to reasonable number
                
                // Wave width: controlled by amplitude (1-10)
                // Normalize amplitude: map from 1-10 to wave width (0.05 to 0.5 of maxDistance)
                float normalizedAmplitude = uWavesAmplitude * 0.05; // 0.05 to 0.5
                float waveWidth = uMaxDistance * normalizedAmplitude;
                
                for (float i = 0.0; i < numWavesToCheck; i += 1.0) {
                    // Calculate wave number to check
                    float waveNum = currentWaveNumber - i;
                    
                    // Only process if wave has started
                    if (waveNum >= 0.0) {
                        // Calculate start time for this wave
                        float waveStartTime = waveNum * timeInterval;
                        
                        // Calculate how long this wave has been traveling
                        float waveTravelTime = uTime - waveStartTime;
                        
                        // Only process if wave has started and hasn't traveled too far
                        if (waveTravelTime >= 0.0) {
                            // Calculate current position of this wave front (distance from center)
                            float waveFrontDistance = waveTravelTime * normalizedSpeed;
                            
                            // Only process if wave is still within reasonable distance
                            if (waveFrontDistance <= uMaxDistance * 1.5) {
                                // Calculate distance from this wave front
                                float distFromThisWave = abs(distance - waveFrontDistance);
                                
                                // Calculate intensity for this wave
                                float waveIntensity = 1.0 - smoothstep(0.0, waveWidth, distFromThisWave);
                                
                                // Take maximum intensity from all waves
                                maxIntensity = max(maxIntensity, waveIntensity);
                            }
                        }
                    }
                }
                
                // Use maximum intensity found
                float intensity = maxIntensity;
                
                // Intensity is already calculated in the loop above
                
                // Store intensity for fragment shader
                vWaveIntensity = intensity;
                
                // Base color (will be modified in fragment shader)
                vColor = ${hasColors ? 'color' : 'vec3(1.0, 1.0, 1.0)'};
                
                // Displace particles along selected axis based on wave intensity and displacement amount
                // Normalize displacement: map from 0-10 to actual displacement (0.0 to 1.0 units)
                float normalizedDisplacement = uDisplacement * 0.1;
                
                // Calculate displacement: particles move along selected axis when wave passes
                float displacement = intensity * normalizedDisplacement;
                
                // Apply displacement to position based on selected axis
                vec3 pos = position;
                if (uDisplacementAxis < 0.5) {
                    // X axis (0)
                    pos.x += displacement;
                } else if (uDisplacementAxis < 1.5) {
                    // Y axis (1)
                    pos.y += displacement;
                } else {
                    // Z axis (2)
                    pos.z += displacement;
                }
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = uPointSize;
            }
        `;
    }
    
    return common + animationCode;
}

// ==================== Information Panel ====================

function updateInfo(pointCount) {
    params.points = pointCount.toLocaleString('en-US');
    
    let sizeStr = '';
    if (fileSize < 1024) {
        sizeStr = fileSize + ' B';
    } else if (fileSize < 1024 * 1024) {
        sizeStr = (fileSize / 1024).toFixed(2) + ' KB';
    } else {
        sizeStr = (fileSize / (1024 * 1024)).toFixed(2) + ' MB';
    }
    params.fileSize = sizeStr;
}

// Calculate estimated file size based on point count
function updateEstimatedFileSize(pointCount) {
    if (!originalPointCount || originalPointCount === 0 || !fileSize || fileSize === 0) {
        params.estimatedFileSize = '—';
        if (estimatedFileSizeCtrl) estimatedFileSizeCtrl.updateDisplay();
        return;
    }
    
    // Calculate size per point ratio from original file
    const sizePerPoint = fileSize / originalPointCount;
    const estimatedSize = sizePerPoint * pointCount;
    
    let sizeStr = '';
    if (estimatedSize < 1024) {
        sizeStr = Math.round(estimatedSize) + ' B';
    } else if (estimatedSize < 1024 * 1024) {
        sizeStr = (estimatedSize / 1024).toFixed(2) + ' KB';
    } else {
        sizeStr = (estimatedSize / (1024 * 1024)).toFixed(2) + ' MB';
    }
    
    params.estimatedFileSize = sizeStr;
    if (estimatedFileSizeCtrl) estimatedFileSizeCtrl.updateDisplay();
}

// ==================== Animation Loop ====================

function animate() {
    requestAnimationFrame(animate);
    
    // Update point size and opacity uniforms for shader material
    if (pointCloud && pointCloud.material && pointCloud.material.uniforms) {
        if (pointCloud.material.uniforms.uPointSize) {
            pointCloud.material.uniforms.uPointSize.value = params.pointSize * 100.0;
        }
        if (pointCloud.material.uniforms.uOpacity) {
            pointCloud.material.uniforms.uOpacity.value = params.opacity;
        }
    }
    
    if (currentAnimation !== 'none' && pointCloud && pointCloud.material && pointCloud.material.uniforms) {
        // Update animation time for spherical waves (continuous, no duration limit)
        if (currentAnimation === 'spherical_waves' && params.wavesEnabled) {
            animationTime += 0.016; // Always increment for continuous waves
            pointCloud.material.uniforms.uTime.value = animationTime;
            // Update wave parameters if they exist
            if (pointCloud.material.uniforms.uWavesAmplitude) {
                pointCloud.material.uniforms.uWavesAmplitude.value = params.wavesAmplitude;
            }
            if (pointCloud.material.uniforms.uWavePeriod) {
                pointCloud.material.uniforms.uWavePeriod.value = params.wavesPeriod;
            }
            if (pointCloud.material.uniforms.uWavesSpeed) {
                pointCloud.material.uniforms.uWavesSpeed.value = params.wavesSpeed;
            }
            if (pointCloud.material.uniforms.uWaveColor) {
                const waveColor = new THREE.Color(params.wavesColor);
                pointCloud.material.uniforms.uWaveColor.value = waveColor;
            }
            if (pointCloud.material.uniforms.uWaveColorIntensity) {
                pointCloud.material.uniforms.uWaveColorIntensity.value = params.wavesColorIntensity;
            }
            if (pointCloud.material.uniforms.uDisplacementAxis) {
                const axisValue = params.wavesDisplacementAxis === 'x' ? 0 : (params.wavesDisplacementAxis === 'y' ? 1 : 2);
                pointCloud.material.uniforms.uDisplacementAxis.value = axisValue;
            }
            if (pointCloud.material.uniforms.uDisplacement) {
                pointCloud.material.uniforms.uDisplacement.value = params.wavesDisplacement;
            }
        } else {
            // Only update animation time if playing (for other animations)
            if (isAnimationPlaying || params.animRepeat) {
                animationTime += 0.016 * params.animSpeed; // ~60fps
                pointCloud.material.uniforms.uTime.value = animationTime;
                pointCloud.material.uniforms.uSpeed.value = params.animSpeed;
                pointCloud.material.uniforms.uAmplitude.value = params.animAmplitude;
                
                const duration = pointCloud.material.uniforms.uDuration.value * 2;
                
                // Check if animation completed
                if (animationTime > duration) {
                    if (params.animRepeat) {
                        // Auto-repeat: reset time
                        animationTime = 0;
                    } else {
                        // No repeat: stop at the end
                        animationTime = duration;
                        isAnimationPlaying = false;
                    }
                }
            } else {
                // Animation is paused, but still update uniforms for current time
                pointCloud.material.uniforms.uTime.value = animationTime;
                pointCloud.material.uniforms.uSpeed.value = params.animSpeed;
                pointCloud.material.uniforms.uAmplitude.value = params.animAmplitude;
            }
        }
    }
    
    controls.update();
    
    renderer.render(scene, camera);
}

// ==================== URL Parameter Handling ====================

// Get URL parameter value
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Update URL parameter without page reload
function updateURLParameter(name, value) {
    const url = new URL(window.location);
    if (value) {
        url.searchParams.set(name, value);
    } else {
        url.searchParams.delete(name);
    }
    window.history.pushState({}, '', url);
}

// Load list of available models from server
async function loadModelsList() {
    console.log('🔵 [DEBUG] loadModelsList() called');
    console.log('🔵 [DEBUG] Current defaultScenes:', defaultScenes);
    
    try {
        // Try to fetch from API endpoint
        const apiUrl = '/api/models';
        console.log('🔵 [DEBUG] Fetching from API:', apiUrl);
        console.log('🔵 [DEBUG] Full URL:', window.location.origin + apiUrl);
        
        const response = await fetch(apiUrl);
        console.log('🔵 [DEBUG] Response status:', response.status, response.statusText);
        console.log('🔵 [DEBUG] Response ok:', response.ok);
        console.log('🔵 [DEBUG] Response headers:', {
            'content-type': response.headers.get('content-type'),
            'access-control-allow-origin': response.headers.get('access-control-allow-origin')
        });
        
        if (!response.ok) {
            console.error('🔴 [ERROR] Response not OK:', response.status, response.statusText);
            throw new Error(`Failed to load models: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('🔵 [DEBUG] Parsed JSON data:', data);
        console.log('🔵 [DEBUG] data.success:', data.success);
        console.log('🔵 [DEBUG] data.models:', data.models);
        console.log('🔵 [DEBUG] data.models is array:', Array.isArray(data.models));
        console.log('🔵 [DEBUG] data.models length:', data.models ? data.models.length : 'null/undefined');
        
        if (data.success && Array.isArray(data.models) && data.models.length > 0) {
            defaultScenes = data.models;
            console.log('✅ [SUCCESS] Loaded models from server:', defaultScenes);
            console.log('✅ [SUCCESS] Total models:', defaultScenes.length);
            return true;
        } else {
            console.warn('🟡 [WARNING] Invalid response format or empty models list');
            console.warn('🟡 [WARNING] data.success:', data.success);
            console.warn('🟡 [WARNING] data.models:', data.models);
            throw new Error('Invalid response format or empty models list');
        }
    } catch (error) {
        console.error('🔴 [ERROR] Error loading models list from API:', error);
        console.error('🔴 [ERROR] Error name:', error.name);
        console.error('🔴 [ERROR] Error message:', error.message);
        console.error('🔴 [ERROR] Error stack:', error.stack);
        console.warn('🟡 [WARNING] Falling back to empty list. User can still load custom files.');
        // Fallback to empty array - user can still load custom files
        defaultScenes = [];
        return false;
    }
}

// Load scene from URL parameter if present
function loadSceneFromURL() {
    const modelParam = getURLParameter('model');
    if (modelParam && defaultScenes.includes(modelParam)) {
        // Set the selected scene in params
        params.selectedScene = modelParam;
        // Load the file
        const url = `default_scenes/${modelParam}`;
        loadFileFromURL(url, modelParam);
        return true;
    }
    return false;
}

// Initialize application
async function initializeApp() {
    console.log('🟢 [DEBUG] ========== initializeApp() STARTED ==========');
    console.log('🟢 [DEBUG] Current defaultScenes before init:', defaultScenes);
    
    // Initialize GUI first (with empty scenes list)
    console.log('🟢 [DEBUG] Calling initGUI()...');
    initGUI();
    console.log('🟢 [DEBUG] initGUI() completed');
    console.log('🟢 [DEBUG] selectedSceneCtrl after initGUI:', selectedSceneCtrl);
    
    // Load models list from server
    console.log('🟢 [DEBUG] Calling loadModelsList()...');
    const modelsLoaded = await loadModelsList();
    console.log('🟢 [DEBUG] loadModelsList() returned:', modelsLoaded);
    console.log('🟢 [DEBUG] defaultScenes after loadModelsList:', defaultScenes);
    console.log('🟢 [DEBUG] defaultScenes.length:', defaultScenes.length);
    
    if (modelsLoaded && defaultScenes.length > 0) {
        console.log('✅ [SUCCESS] Models loaded successfully, updating GUI...');
        // Update GUI with loaded models
        if (selectedSceneCtrl) {
            console.log('🟢 [DEBUG] Updating selectedSceneCtrl options...');
            // Update the controller options
            selectedSceneCtrl.options(defaultScenes);
            console.log('🟢 [DEBUG] Options updated');
            
            // Set default scene
            params.selectedScene = defaultScenes[0];
            console.log('🟢 [DEBUG] Set default scene to:', params.selectedScene);
            
            // Update display
            selectedSceneCtrl.updateDisplay();
            console.log('🟢 [DEBUG] Display updated');
        } else {
            console.warn('🟡 [WARNING] selectedSceneCtrl is null, cannot update GUI');
        }
        
        // Try to load scene from URL parameter, otherwise load first default scene
        console.log('🟢 [DEBUG] Checking URL parameters...');
        if (!loadSceneFromURL()) {
            console.log('🟢 [DEBUG] No URL parameter, loading first default scene...');
            const firstScene = defaultScenes[0];
            params.selectedScene = firstScene;
            
            // Update URL parameter with first scene
            updateURLParameter('model', firstScene);
            console.log('🟢 [DEBUG] Updated URL parameter to:', firstScene);
            
            if (selectedSceneCtrl) {
                selectedSceneCtrl.updateDisplay();
            }
            const url = `default_scenes/${firstScene}`;
            console.log('🟢 [DEBUG] Loading scene from URL:', url);
            loadFileFromURL(url, firstScene);
        } else {
            console.log('🟢 [DEBUG] Scene loaded from URL parameter');
        }
    } else {
        console.warn('🟡 [WARNING] No models available. User can still load custom files.');
        console.warn('🟡 [WARNING] modelsLoaded:', modelsLoaded);
        console.warn('🟡 [WARNING] defaultScenes.length:', defaultScenes.length);
        // Hide or disable scene selector if no models
        if (selectedSceneCtrl) {
            console.log('🟢 [DEBUG] Disabling scene selector...');
            selectedSceneCtrl.disable();
        }
    }
    
    console.log('🟢 [DEBUG] ========== initializeApp() COMPLETED ==========');
}

// Start application
console.log('🚀 [DEBUG] ========== APPLICATION STARTING ==========');
console.log('🚀 [DEBUG] Window location:', window.location.href);
console.log('🚀 [DEBUG] Calling initializeApp()...');
initializeApp();
console.log('🚀 [DEBUG] initializeApp() called (async, may not be completed yet)');
animate();

