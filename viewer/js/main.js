import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/dist/lil-gui.esm.js';

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

// Update URL when camera position changes (debounced)
controls.addEventListener('change', () => {
    if (cameraUpdateTimeout) {
        clearTimeout(cameraUpdateTimeout);
    }
    cameraUpdateTimeout = setTimeout(() => {
        serializeParamsToURL();
    }, CAMERA_UPDATE_DELAY);
});

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
// Current custom file name (if loaded, not added to defaultScenes)
let currentCustomFileName = null;

// Debounced camera position update for URL
let cameraUpdateTimeout = null;
const CAMERA_UPDATE_DELAY = 500; // Update URL 500ms after camera stops moving

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
    // Share functionality
    shareCurrentView: async () => {
        try {
            // Get current URL with all parameters
            const currentURL = window.location.href;
            
            // Show loading notification
            showNotification('Creating short link...', 'info');
            
            // Try to shorten URL
            const shortURL = await shortenURL(currentURL);
            
            // Use short URL if available, otherwise use original
            const urlToCopy = shortURL || currentURL;
            
            // Copy to clipboard
            const copied = await copyToClipboard(urlToCopy);
            
            if (copied) {
                if (shortURL) {
                    showNotification('Short link copied to clipboard!', 'success');
                } else {
                    showNotification('Original URL copied to clipboard (shortening failed)', 'success');
                }
            } else {
                showNotification('Failed to copy to clipboard. Please copy manually: ' + urlToCopy, 'error');
            }
        } catch (error) {
            console.error('Error in shareCurrentView:', error);
            showNotification('Failed to create share link. Please try again.', 'error');
        }
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

// Drag & Drop - Global handlers on canvas and body
let dragCounter = 0; // Track nested drag events

function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        dropzone.classList.remove('hidden');
        dropzone.classList.add('drag-active');
    }
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    // Use setTimeout to handle nested element transitions
    setTimeout(() => {
        if (dragCounter === 0) {
            dropzone.classList.remove('drag-active');
            // Only hide if no file is being loaded
            if (!pointCloud) {
                dropzone.classList.add('hidden');
            }
        }
    }, 50);
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-active');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        const ext = file.name.toLowerCase().split('.').pop();
        if (ext === 'glb' || ext === 'ply' || ext === 'sog') {
            loadFile(file);
        } else {
            alert('Unsupported file format. Please use .ply, .sog, or .glb files.');
            // Show dropzone again if no model is loaded
            if (!pointCloud) {
                dropzone.classList.remove('hidden');
            }
        }
    }
}

// Add drag & drop handlers to canvas and body
canvas.addEventListener('dragenter', handleDragEnter);
canvas.addEventListener('dragover', handleDragOver);
canvas.addEventListener('dragleave', handleDragLeave);
canvas.addEventListener('drop', handleDrop);

document.body.addEventListener('dragenter', handleDragEnter);
document.body.addEventListener('dragover', handleDragOver);
document.body.addEventListener('dragleave', handleDragLeave);
document.body.addEventListener('drop', handleDrop);

// Also keep existing dropzone handlers for compatibility
dropzone.addEventListener('dragover', handleDragOver);
dropzone.addEventListener('drop', handleDrop);

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
    // Clear custom file name when loading from URL (default scenes)
    currentCustomFileName = null;
    
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
        // Show dropzone if file loading failed
        if (!pointCloud) {
            dropzone.classList.remove('hidden');
        }
    }
}

// Load file
function loadFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    fileSize = file.size;
    
    // Store custom file name and update selectedScene display
    currentCustomFileName = file.name;
    params.selectedScene = file.name;
    
    // Update selectedSceneCtrl to show custom file name
    // Add custom file name to options temporarily for display, but don't add to defaultScenes
    if (selectedSceneCtrl) {
        const displayOptions = [...defaultScenes];
        if (!displayOptions.includes(file.name)) {
            displayOptions.push(file.name);
        }
        selectedSceneCtrl.options(displayOptions);
        params.selectedScene = file.name;
        selectedSceneCtrl.updateDisplay();
    }
    
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

    // Setup MeshoptDecoder for EXT_meshopt_compression (standard Three.js support)
    // MUST be set before parsing any files
    // Using static import from top of file
    if (MeshoptDecoder) {
        // Check if ready() method exists and call it if available (for WASM versions)
        if (typeof MeshoptDecoder.ready === 'function') {
            await MeshoptDecoder.ready();
        }
        loader.setMeshoptDecoder(MeshoptDecoder);
        console.log('✅ MeshoptDecoder set successfully on GLTFLoader');
    } else {
        console.error('❌ MeshoptDecoder import failed - decoder is undefined');
        console.error('Files with EXT_meshopt_compression will not load correctly');
    }
    
    // Read file as ArrayBuffer
    const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsArrayBuffer(file);
    });
    
    // Parse GLB after decoder is set up
    loader.parse(arrayBuffer, '', (gltf) => {
        console.log('GLB loaded successfully:', gltf);
        
        const mesh = gltf.scene.children[0];
        if (!mesh || !mesh.geometry) {
            console.error('No mesh found in scene!');
            alert('GLB file loaded but contains no mesh');
            return;
        }
        
        console.log('Mesh type:', mesh.constructor.name, 'isPoints:', mesh.isPoints);
        
        // If it's already a Points object, try using it directly
        if (mesh.isPoints) {
            console.log('GLB contains Points object, using it directly');
            
            // Log material info
            console.log('Points material:', {
                type: mesh.material.constructor.name,
                size: mesh.material.size,
                opacity: mesh.material.opacity,
                vertexColors: mesh.material.vertexColors,
                visible: mesh.material.visible,
                transparent: mesh.material.transparent
            });
            
            // Log geometry info BEFORE dequantization
            const posAttrBefore = mesh.geometry.attributes.position;
            console.log('Points geometry (BEFORE dequantization):', {
                positionCount: posAttrBefore ? posAttrBefore.count : 0,
                hasColors: !!mesh.geometry.attributes.color,
                firstPositionValues: posAttrBefore && posAttrBefore.array ? Array.from(posAttrBefore.array.slice(0, 9)) : 'no array',
                arrayType: posAttrBefore && posAttrBefore.array ? posAttrBefore.array.constructor.name : 'no array'
            });
            
            // === CRITICAL: For meshopt files with KHR_mesh_quantization ===
            // Meshopt files store coordinates as quantized integers (Uint16/Int16)
            // with a transformation matrix (scale/offset) to convert to real coordinates.
            // Three.js applies the matrix automatically during rendering via matrixWorld.
            // We keep the object as-is for rendering, but need to handle dequantization
            // for filtering/shader logic if coordinates are still quantized.
            
            // Ensure matrix is up to date (Three.js will use it for rendering)
            mesh.updateMatrixWorld(true);
            
            // Remove old point cloud
            if (pointCloud) {
                scene.remove(pointCloud);
                if (pointCloud.geometry) pointCloud.geometry.dispose();
                if (pointCloud.material) pointCloud.material.dispose();
            }
            
            pointCloud = mesh;
            
            // Ensure material is properly configured
            if (pointCloud.material) {
                // Make sure material is visible and has proper settings
                pointCloud.material.visible = true;
                if (!pointCloud.material.size || pointCloud.material.size <= 0) {
                    console.warn('Material size is invalid, setting to default');
                    pointCloud.material.size = params.pointSize || 0.03;
                }
                if (pointCloud.material.opacity === undefined || pointCloud.material.opacity <= 0) {
                    console.warn('Material opacity is invalid, setting to default');
                    pointCloud.material.opacity = params.opacity || 1.0;
                }
                pointCloud.material.needsUpdate = true;
            }
            
            // Ensure point cloud is visible
            pointCloud.visible = true;
            
            scene.add(pointCloud);
            currentMaterial = pointCloud.material;
            
            console.log('Point cloud added to scene:', {
                inScene: scene.children.includes(pointCloud),
                visible: pointCloud.visible,
                materialVisible: pointCloud.material ? pointCloud.material.visible : 'no material'
            });
            
            // Update camera
            // Use Box3().setFromObject() like three-gltf-viewer does
            // This automatically accounts for object's transformation matrix
            pointCloud.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(pointCloud);
            
            // Get position attribute for error logging
            const posAttr = pointCloud.geometry.attributes.position;
            
            // Check if bounding box is valid (not empty and has valid values)
            if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) {
                console.error('Invalid bounding box computed!');
                const firstValues = posAttr && posAttr.array ? Array.from(posAttr.array.slice(0, 9)) : 'no array';
                console.error('Position array first 9 values:', firstValues);
                console.error('Position array type:', posAttr && posAttr.array ? posAttr.array.constructor.name : 'no array');
                console.error('Position attribute details:', {
                    count: posAttr ? posAttr.count : 0,
                    itemSize: posAttr ? posAttr.itemSize : 0,
                    normalized: posAttr ? posAttr.normalized : false
                });
                console.error('Bounding box:', {
                    min: { x: box.min.x, y: box.min.y, z: box.min.z },
                    max: { x: box.max.x, y: box.max.y, z: box.max.z },
                    isEmpty: box.isEmpty()
                });
                
                // Check if values look quantized (large integers)
                if (firstValues !== 'no array' && firstValues.length > 0) {
                    const firstVal = Math.abs(firstValues[0]);
                    const isQuantized = firstVal > 1000 && firstVal < 32768 && Number.isInteger(firstVal);
                    console.error('Values appear quantized (integers):', isQuantized);
                    console.error('This suggests dequantization did not work properly');
                }
            }
            
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            console.log('Bounding box (direct Points, using setFromObject):', {
                min: { x: box.min.x, y: box.min.y, z: box.min.z },
                max: { x: box.max.x, y: box.max.y, z: box.max.z },
                center: { x: center.x, y: center.y, z: center.z },
                size: { x: size.x, y: size.y, z: size.z },
                maxDim: maxDim,
                isEmpty: box.isEmpty()
            });
            
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
            
            // Ensure camera distance is valid
            if (!isFinite(cameraZ) || cameraZ <= 0 || cameraZ > 1e6) {
                console.warn('Invalid camera distance, using fallback');
                cameraZ = maxDim > 0 ? maxDim * 2 : 10;
            }
            
            camera.position.set(center.x, center.y, center.z + cameraZ);
            controls.target.copy(center);
            controls.update();
            
            console.log('Camera setup (direct Points):', {
                position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
                cameraZ: cameraZ,
                pointSize: pointCloud.material ? pointCloud.material.size : 'no material'
            });
            
            // Store original data for filtering
            // Check if coordinates need dequantization (Uint16Array/Int16Array)
            // posAttr is already defined above for error logging
            originalPointCount = posAttr ? posAttr.count : 0;
            
            const posArray = posAttr && posAttr.array ? posAttr.array : null;
            if (posArray) {
                const arrayType = posArray.constructor.name;
                console.log('Position array type for filtering:', arrayType);
                
                // Check if coordinates are quantized (Uint16Array or Int16Array)
                if (arrayType === 'Uint16Array' || arrayType === 'Int16Array') {
                    console.log('Coordinates are quantized, dequantizing for filtering...');
                    // Dequantize using matrix transformation
                    // Apply matrix to each point to get Float32 coordinates
                    const dequantized = new Float32Array(posArray.length);
                    const matrix = pointCloud.matrixWorld;
                    
                    for (let i = 0; i < posArray.length; i += 3) {
                        const x = posArray[i];
                        const y = posArray[i + 1];
                        const z = posArray[i + 2];
                        
                        // Apply matrix transformation
                        const vec = new THREE.Vector3(x, y, z);
                        vec.applyMatrix4(matrix);
                        
                        dequantized[i] = vec.x;
                        dequantized[i + 1] = vec.y;
                        dequantized[i + 2] = vec.z;
                    }
                    
                    originalPositions = dequantized;
                    console.log('Coordinates dequantized for filtering. First values:', Array.from(dequantized.slice(0, 9)));
                } else {
                    // Already Float32Array, use as-is
                    originalPositions = posArray.slice();
                    console.log('Coordinates are already Float32, using as-is');
                }
            } else {
                originalPositions = null;
            }
            
            if (pointCloud.geometry.attributes.color) {
                originalColors = pointCloud.geometry.attributes.color.array.slice();
            } else {
                originalColors = null;
            }
            
            console.log('Original data stored for filtering:', {
                pointCount: originalPointCount,
                positionsType: originalPositions ? originalPositions.constructor.name : 'null',
                hasColors: originalColors !== null
            });
            
            // Update params
            params.maxPoints = originalPointCount;
            params.pointPercent = 100;
            
            updateInfo(originalPointCount);
            dropzone.classList.add('hidden');
            if (!gui) {
                initGUI();
            }
            
            // Apply animation if needed
            applyAnimation(params.animation);
            currentAnimation = params.animation;
            
            return;
        }
        
        // Otherwise, extract attributes and create new point cloud
        const geometry = mesh.geometry;
        const positions = geometry.attributes.position;
        if (!positions) {
            console.error('No position attribute found!');
            alert('GLB file loaded but contains no position data');
            return;
        }
        
        const colors = geometry.attributes.COLOR_0 || geometry.attributes.color;
        
        createPointCloud(positions, colors);
        updateInfo(positions.count);
        dropzone.classList.add('hidden');
        if (!gui) {
            initGUI();
        }
    }, (error) => {
        console.error('Error loading GLB:', error);
        alert('Error loading GLB file:\n' + (error.message || 'Unknown error'));
    });
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
    
    // CRITICAL: Use .clone() for position attribute to preserve quantization metadata
    // This is essential for meshopt files with KHR_mesh_quantization
    // .clone() preserves scale/offset parameters needed for proper coordinate unpacking
    let positionAttribute;
    if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttribute = positionAttr.clone();
        console.log('Position attribute cloned (preserves quantization metadata)', {
            count: positionAttribute.count,
            itemSize: positionAttribute.itemSize,
            firstValues: positionAttribute.array ? Array.from(positionAttribute.array.slice(0, 9)) : 'no array',
            arrayType: positionAttribute.array ? positionAttribute.array.constructor.name : 'no array'
        });
    } else {
        // Fallback for non-BufferAttribute (shouldn't happen with GLB)
        positionAttribute = positionAttr;
        console.warn('Position attribute is not a BufferAttribute, using as-is');
    }
    
    geometry.setAttribute('position', positionAttribute);
    console.log('Geometry created with position attribute, count:', positionAttribute.count);
    
    // Check if coordinates look quantized (large integers) and need dequantization
    const posArray = positionAttribute.array;
    if (posArray && posArray.length > 0) {
        const firstVal = Math.abs(posArray[0]);
        const isLikelyQuantized = firstVal > 1000 && firstVal < 32768 && Number.isInteger(firstVal);
        
        if (isLikelyQuantized) {
            console.warn('Coordinates appear to be quantized (integers in range 1000-32768)');
            console.warn('First 9 values:', Array.from(posArray.slice(0, 9)));
            console.warn('Three.js should have dequantized these automatically. Checking if dequantization is needed...');
            
            // Check if values are in reasonable float range after Three.js processing
            const sampleValues = Array.from(posArray.slice(0, 30));
            const avgAbs = sampleValues.reduce((sum, v) => sum + Math.abs(v), 0) / sampleValues.length;
            
            if (avgAbs > 100 && avgAbs < 10000) {
                console.warn('Values are in suspicious range - may need manual dequantization');
                console.warn('Average absolute value:', avgAbs);
            } else {
                console.log('Values appear to be in reasonable range, Three.js likely handled dequantization');
            }
        }
    }
    
    // Handle color attribute - it might already be a BufferAttribute from GLB
    if (colorAttr) {
        // If it's already a BufferAttribute, clone it properly
        if (colorAttr instanceof THREE.BufferAttribute) {
            // Convert RGBA to RGB if needed (Three.js PointsMaterial expects RGB)
            let colorArray;
            let itemSize = colorAttr.itemSize;
            
            if (itemSize === 4) {
                // Convert RGBA to RGB
                const rgbaArray = colorAttr.array;
                colorArray = new Float32Array((rgbaArray.length / 4) * 3);
                for (let i = 0; i < rgbaArray.length; i += 4) {
                    const rgbIdx = (i / 4) * 3;
                    colorArray[rgbIdx] = rgbaArray[i];
                    colorArray[rgbIdx + 1] = rgbaArray[i + 1];
                    colorArray[rgbIdx + 2] = rgbaArray[i + 2];
                    // Alpha is ignored
                }
                itemSize = 3;
                console.log('Converted RGBA to RGB colors');
            } else {
                // Clone the array as-is
                colorArray = colorAttr.array.slice();
            }
            
            const colorBuffer = new THREE.BufferAttribute(
                colorArray,
                itemSize,
                colorAttr.normalized
            );
            geometry.setAttribute('color', colorBuffer);
            // Check a few sample colors
            const sampleColors = [];
            for (let i = 0; i < Math.min(5, colorBuffer.count); i++) {
                const idx = i * itemSize;
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
        opacity: params.opacity,
        sizeAttenuation: true // Important for proper point size scaling
    });
    
    // Set default color if no vertex colors
    if (!hasColors) {
        material.color.set(0xffffff);
    }
    
    // Final verification
    const finalColorAttr = geometry.attributes.color;
    console.log('Created point cloud:', {
        pointCount: positionAttribute.count,
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
    
    console.log('Point cloud added to scene:', {
        inScene: scene.children.includes(pointCloud),
        sceneChildrenCount: scene.children.length,
        pointCloudVisible: pointCloud.visible,
        materialSize: material.size,
        materialOpacity: material.opacity
    });
    
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
    
    console.log('Bounding box:', {
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z },
        center: { x: center.x, y: center.y, z: center.z },
        size: { x: size.x, y: size.y, z: size.z },
        maxDim: maxDim
    });
    
    // Check if bounding box is valid (not all zeros or invalid)
    const isValidBoundingBox = !isNaN(maxDim) && isFinite(maxDim) && maxDim > 0 && maxDim < 1e6;
    
    if (!isValidBoundingBox) {
        console.error('Invalid bounding box detected! Coordinates may not be properly unpacked.');
        console.error('First 9 position values:', Array.from(geometry.attributes.position.array.slice(0, 9)));
        console.error('Position array type:', geometry.attributes.position.array.constructor.name);
        
        // Try to manually compute bounding box from raw values
        const posArray = geometry.attributes.position.array;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        for (let i = 0; i < posArray.length; i += 3) {
            const x = posArray[i];
            const y = posArray[i + 1];
            const z = posArray[i + 2];
            
            if (isFinite(x) && isFinite(y) && isFinite(z)) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                minZ = Math.min(minZ, z);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                maxZ = Math.max(maxZ, z);
            }
        }
        
        console.log('Manually computed bounds:', {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ }
        });
        
        // Update bounding box manually
        box.min.set(minX, minY, minZ);
        box.max.set(maxX, maxY, maxZ);
        const newCenter = box.getCenter(new THREE.Vector3());
        const newSize = box.getSize(new THREE.Vector3());
        const newMaxDim = Math.max(newSize.x, newSize.y, newSize.z);
        
        center.copy(newCenter);
        maxDim = newMaxDim;
        
        console.log('Updated bounding box:', {
            center: { x: center.x, y: center.y, z: center.z },
            size: { x: newSize.x, y: newSize.y, z: newSize.z },
            maxDim: maxDim
        });
    }
    
    // Adjust point size if bounding box is very large or very small
    if (maxDim > 1000) {
        console.warn('Very large bounding box detected, increasing point size');
        material.size = Math.max(material.size, maxDim / 10000);
    } else if (maxDim < 0.1) {
        console.warn('Very small bounding box detected, decreasing point size');
        material.size = Math.min(material.size, maxDim * 10);
    }
    
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;
    
    // Ensure camera is at reasonable distance
    if (!isFinite(cameraZ) || cameraZ <= 0 || cameraZ > 1e6) {
        console.warn('Invalid camera distance, using fallback');
        cameraZ = maxDim > 0 ? maxDim * 2 : 10;
    }
    
    camera.position.set(center.x, center.y, center.z + cameraZ);
    controls.target.copy(center);
    controls.update();
    
    console.log('Camera setup:', {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        cameraZ: cameraZ,
        pointSize: material.size,
        isValidBoundingBox: isValidBoundingBox
    });
    
    // Apply restored parameters after pointCloud is created
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.toString().length > 0) {
        applyRestoredParams();
    }
    
    // Don't auto-enable animations on load - user must enable manually via GUI
    // Animation will be applied based on params.animation (default: 'none')
    
    applyAnimation(params.animation);
    currentAnimation = params.animation;
    
    // After applying animation, restore colorMode settings
    // This ensures custom color mode is preserved when switching scenes
    if (currentMaterial) {
        if (params.colorMode === 'custom') {
            if (!params.useShaderMaterial && currentMaterial.isPointsMaterial) {
                // For PointsMaterial
                currentMaterial.vertexColors = false;
                currentMaterial.color.set(params.customColor);
                currentMaterial.needsUpdate = true;
            } else if (currentMaterial.uniforms && currentMaterial.uniforms.uColor) {
                // For ShaderMaterial
                currentMaterial.uniforms.uColor.value = new THREE.Color(params.customColor);
            }
        } else if (params.colorMode === 'file' && hasColors) {
            if (!params.useShaderMaterial && currentMaterial.isPointsMaterial) {
                // For PointsMaterial
        currentMaterial.vertexColors = true;
            currentMaterial.color.set(0xffffff);
        currentMaterial.needsUpdate = true;
            }
            // For ShaderMaterial, vertexColors is already set correctly in applyAnimation
        }
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
        if (!value) return;
        
        // If value is a custom file (not in defaultScenes), don't load from default_scenes
        if (!defaultScenes.includes(value)) {
            // This is a custom file, already loaded, just return
            return;
        }
        
        // Clear custom file name when selecting default scene
        currentCustomFileName = null;
        
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
    
    // Share button
    sceneFolder.add(params, 'shareCurrentView').name('Share');
    
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
        serializeParamsToURL();
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
        serializeParamsToURL();
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
        serializeParamsToURL();
    });
    
    // Background color control
    const backgroundColorCtrl = displayFolder.addColor(params, 'backgroundColor').name('Background Color');
    backgroundColorCtrl.onChange((value) => {
        renderer.setClearColor(value);
        serializeParamsToURL();
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
        serializeParamsToURL();
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
        serializeParamsToURL();
    });
    
    // Wave amplitude control (1-10) - controls wave width
    const wavesAmplitudeCtrl = animFolder.add(params, 'wavesAmplitude', 1, 10, 0.1).name('Wave Width');
    wavesAmplitudeCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavesAmplitude) {
            pointCloud.material.uniforms.uWavesAmplitude.value = value;
        }
        serializeParamsToURL();
    });
    
    // Wave period control (1-10) - number of simultaneous waves
    const wavesPeriodCtrl = animFolder.add(params, 'wavesPeriod', 1, 10, 0.1).name('Wave Count');
    wavesPeriodCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavePeriod) {
            pointCloud.material.uniforms.uWavePeriod.value = value;
        }
        serializeParamsToURL();
    });
    
    // Wave speed control (units per second) - propagation speed
    const wavesSpeedCtrl = animFolder.add(params, 'wavesSpeed', 0.1, 50, 0.1).name('Wave Speed (units/s)');
    wavesSpeedCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWavesSpeed) {
            pointCloud.material.uniforms.uWavesSpeed.value = value;
        }
        serializeParamsToURL();
    });
    
    // Wave color control
    const wavesColorCtrl = animFolder.addColor(params, 'wavesColor').name('Wave Color');
    wavesColorCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWaveColor) {
            const waveColor = new THREE.Color(value);
            pointCloud.material.uniforms.uWaveColor.value = waveColor;
        }
        serializeParamsToURL();
    });
    
    // Wave color intensity control (0-10)
    const wavesColorIntensityCtrl = animFolder.add(params, 'wavesColorIntensity', 0, 10, 0.1).name('Color Intensity');
    wavesColorIntensityCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uWaveColorIntensity) {
            pointCloud.material.uniforms.uWaveColorIntensity.value = value;
        }
        serializeParamsToURL();
    });
    
    // Displacement axis control
    const wavesDisplacementAxisCtrl = animFolder.add(params, 'wavesDisplacementAxis', ['x', 'y', 'z']).name('Displacement Axis');
    wavesDisplacementAxisCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uDisplacementAxis) {
            const axisValue = value === 'x' ? 0 : (value === 'y' ? 1 : 2);
            pointCloud.material.uniforms.uDisplacementAxis.value = axisValue;
        }
        serializeParamsToURL();
    });
    
    // Displacement amount control (0-10)
    const wavesDisplacementCtrl = animFolder.add(params, 'wavesDisplacement', 0, 10, 0.1).name('Displacement');
    wavesDisplacementCtrl.onChange((value) => {
        if (pointCloud && pointCloud.material && pointCloud.material.uniforms && pointCloud.material.uniforms.uDisplacement) {
            pointCloud.material.uniforms.uDisplacement.value = value;
        }
        serializeParamsToURL();
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vec3 baseColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
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
                // Handle both vec3 (RGB) and vec4 (RGBA) color attributes
                vColor = ${hasColors ? 'vec3(color.rgb)' : 'vec3(1.0, 1.0, 1.0)'};
                
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

// ==================== URL Shortening and Sharing ====================

// Shorten URL using v.gd API
async function shortenURL(longURL) {
    try {
        const apiURL = `https://v.gd/create.php?format=json&url=${encodeURIComponent(longURL)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(apiURL, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // v.gd returns JSON with 'shorturl' field
        if (data.shorturl && data.shorturl.startsWith('http')) {
            return data.shorturl.trim();
        } else {
            throw new Error('Invalid response from v.gd: ' + (data.errormessage || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error shortening URL:', error);
        return null; // Return null on error, will use original URL as fallback
    }
}

// Copy text to clipboard
async function copyToClipboard(text) {
    try {
        // Try modern Clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        } catch (err) {
            document.body.removeChild(textArea);
            return false;
        }
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        return false;
    }
}

// Show notification to user
function showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    
    // Determine background color based on type
    let bgColor = '#4ecdc4'; // default success color
    if (type === 'error') {
        bgColor = '#ff6b6b';
    } else if (type === 'info') {
        bgColor = '#4a90e2';
    }
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        color: #1a1a2e;
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 500;
        max-width: 90%;
        word-wrap: break-word;
        animation: slideDown 0.3s ease-out;
    `;
    notification.textContent = message;
    
    // Add animation keyframes if not already added
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideDown 0.3s ease-out reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
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

// Serialize all parameters to URL
function serializeParamsToURL() {
    const url = new URL(window.location);
    
    // Clear existing params (except model)
    const modelParam = url.searchParams.get('model');
    url.searchParams.forEach((value, key) => {
        if (key !== 'model') {
            url.searchParams.delete(key);
        }
    });
    
    // Serialize display parameters
    url.searchParams.set('pointSize', params.pointSize.toString());
    url.searchParams.set('opacity', params.opacity.toString());
    url.searchParams.set('colorMode', params.colorMode);
    url.searchParams.set('customColor', params.customColor);
    url.searchParams.set('backgroundColor', params.backgroundColor);
    url.searchParams.set('useShaderMaterial', params.useShaderMaterial.toString());
    
    // Serialize animation parameters
    url.searchParams.set('animation', params.animation);
    url.searchParams.set('animSpeed', params.animSpeed.toString());
    url.searchParams.set('animAmplitude', params.animAmplitude.toString());
    
    // Serialize wave parameters
    url.searchParams.set('wavesEnabled', params.wavesEnabled.toString());
    url.searchParams.set('wavesAmplitude', params.wavesAmplitude.toString());
    url.searchParams.set('wavesPeriod', params.wavesPeriod.toString());
    url.searchParams.set('wavesSpeed', params.wavesSpeed.toString());
    url.searchParams.set('wavesColor', params.wavesColor);
    url.searchParams.set('wavesColorIntensity', params.wavesColorIntensity.toString());
    url.searchParams.set('wavesDisplacementAxis', params.wavesDisplacementAxis);
    url.searchParams.set('wavesDisplacement', params.wavesDisplacement.toString());
    
    // Serialize camera viewport relative to model center
    // Calculate model center if pointCloud exists
    if (pointCloud && pointCloud.geometry) {
        pointCloud.geometry.computeBoundingBox();
        const box = pointCloud.geometry.boundingBox;
        const modelCenter = box.getCenter(new THREE.Vector3());
        
        // Calculate camera position relative to model center
        const camOffset = new THREE.Vector3().subVectors(camera.position, modelCenter);
        url.searchParams.set('camOffsetX', camOffset.x.toFixed(3));
        url.searchParams.set('camOffsetY', camOffset.y.toFixed(3));
        url.searchParams.set('camOffsetZ', camOffset.z.toFixed(3));
        
        // Calculate target offset relative to model center
        const targetOffset = new THREE.Vector3().subVectors(controls.target, modelCenter);
        url.searchParams.set('targetOffsetX', targetOffset.x.toFixed(3));
        url.searchParams.set('targetOffsetY', targetOffset.y.toFixed(3));
        url.searchParams.set('targetOffsetZ', targetOffset.z.toFixed(3));
    } else {
        // Fallback to absolute coordinates if no model loaded
        url.searchParams.set('camX', camera.position.x.toFixed(3));
        url.searchParams.set('camY', camera.position.y.toFixed(3));
        url.searchParams.set('camZ', camera.position.z.toFixed(3));
        url.searchParams.set('targetX', controls.target.x.toFixed(3));
        url.searchParams.set('targetY', controls.target.y.toFixed(3));
        url.searchParams.set('targetZ', controls.target.z.toFixed(3));
    }
    
    // Restore model parameter if it existed
    if (modelParam) {
        url.searchParams.set('model', modelParam);
    }
    
    window.history.replaceState({}, '', url);
}

// Deserialize parameters from URL
function deserializeParamsFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    let hasParams = false;
    
    // Deserialize model/scene parameter first
    if (urlParams.has('model')) {
        params.selectedScene = urlParams.get('model');
        hasParams = true;
    }
    
    // Deserialize display parameters
    if (urlParams.has('pointSize')) {
        params.pointSize = parseFloat(urlParams.get('pointSize'));
        hasParams = true;
    }
    if (urlParams.has('opacity')) {
        params.opacity = parseFloat(urlParams.get('opacity'));
        hasParams = true;
    }
    if (urlParams.has('colorMode')) {
        params.colorMode = urlParams.get('colorMode');
        hasParams = true;
    }
    if (urlParams.has('customColor')) {
        params.customColor = urlParams.get('customColor');
        hasParams = true;
    }
    if (urlParams.has('backgroundColor')) {
        params.backgroundColor = urlParams.get('backgroundColor');
        hasParams = true;
    }
    if (urlParams.has('useShaderMaterial')) {
        params.useShaderMaterial = urlParams.get('useShaderMaterial') === 'true';
        hasParams = true;
    }
    
    // Deserialize animation parameters
    if (urlParams.has('animation')) {
        params.animation = urlParams.get('animation');
        hasParams = true;
    }
    if (urlParams.has('animSpeed')) {
        params.animSpeed = parseFloat(urlParams.get('animSpeed'));
        hasParams = true;
    }
    if (urlParams.has('animAmplitude')) {
        params.animAmplitude = parseFloat(urlParams.get('animAmplitude'));
        hasParams = true;
    }
    
    // Deserialize wave parameters
    if (urlParams.has('wavesEnabled')) {
        params.wavesEnabled = urlParams.get('wavesEnabled') === 'true';
        hasParams = true;
    }
    if (urlParams.has('wavesAmplitude')) {
        params.wavesAmplitude = parseFloat(urlParams.get('wavesAmplitude'));
        hasParams = true;
    }
    if (urlParams.has('wavesPeriod')) {
        params.wavesPeriod = parseFloat(urlParams.get('wavesPeriod'));
        hasParams = true;
    }
    if (urlParams.has('wavesSpeed')) {
        params.wavesSpeed = parseFloat(urlParams.get('wavesSpeed'));
        hasParams = true;
    }
    if (urlParams.has('wavesColor')) {
        params.wavesColor = urlParams.get('wavesColor');
        hasParams = true;
    }
    if (urlParams.has('wavesColorIntensity')) {
        params.wavesColorIntensity = parseFloat(urlParams.get('wavesColorIntensity'));
        hasParams = true;
    }
    if (urlParams.has('wavesDisplacementAxis')) {
        params.wavesDisplacementAxis = urlParams.get('wavesDisplacementAxis');
        hasParams = true;
    }
    if (urlParams.has('wavesDisplacement')) {
        params.wavesDisplacement = parseFloat(urlParams.get('wavesDisplacement'));
        hasParams = true;
    }
    
    // Store viewport parameters for restoration after model loads
    // We'll restore them in applyRestoredParams() after pointCloud is created
    if (urlParams.has('camOffsetX') || urlParams.has('camX')) {
        // Mark that we have viewport parameters to restore
        params._restoreViewport = true;
        if (urlParams.has('camOffsetX')) {
            // Relative coordinates (preferred)
            params._camOffsetX = parseFloat(urlParams.get('camOffsetX'));
            params._camOffsetY = parseFloat(urlParams.get('camOffsetY'));
            params._camOffsetZ = parseFloat(urlParams.get('camOffsetZ'));
            params._targetOffsetX = parseFloat(urlParams.get('targetOffsetX'));
            params._targetOffsetY = parseFloat(urlParams.get('targetOffsetY'));
            params._targetOffsetZ = parseFloat(urlParams.get('targetOffsetZ'));
            params._useRelativeViewport = true;
        } else {
            // Absolute coordinates (fallback)
            params._camX = parseFloat(urlParams.get('camX'));
            params._camY = parseFloat(urlParams.get('camY'));
            params._camZ = parseFloat(urlParams.get('camZ'));
            params._targetX = parseFloat(urlParams.get('targetX'));
            params._targetY = parseFloat(urlParams.get('targetY'));
            params._targetZ = parseFloat(urlParams.get('targetZ'));
            params._useRelativeViewport = false;
        }
        hasParams = true;
    }
    
    return hasParams;
}

// Apply restored parameters to materials, GUI, and other components
function applyRestoredParams() {
    // Apply background color
    if (params.backgroundColor) {
        renderer.setClearColor(params.backgroundColor);
    }
    
    // Apply point size and opacity to current material if exists
    if (pointCloud && currentMaterial) {
        if (!params.useShaderMaterial && currentMaterial.size !== undefined) {
            currentMaterial.size = params.pointSize;
            currentMaterial.opacity = params.opacity;
            currentMaterial.transparent = params.opacity < 1;
        } else if (currentMaterial.uniforms) {
            if (currentMaterial.uniforms.uPointSize) {
                currentMaterial.uniforms.uPointSize.value = params.pointSize * 100.0;
            }
            if (currentMaterial.uniforms.uOpacity) {
                currentMaterial.uniforms.uOpacity.value = params.opacity;
            }
        }
    }
    
    // Apply color mode and custom color if needed
    if (pointCloud && currentMaterial) {
        if (params.colorMode === 'custom') {
            if (!params.useShaderMaterial) {
                currentMaterial.vertexColors = false;
                currentMaterial.color.set(params.customColor);
            } else if (currentMaterial.uniforms && currentMaterial.uniforms.uColor) {
                currentMaterial.uniforms.uColor.value = new THREE.Color(params.customColor);
            }
        } else if (params.colorMode === 'file') {
            const hasColors = pointCloud.geometry.attributes.color !== undefined;
            if (!params.useShaderMaterial) {
                currentMaterial.vertexColors = hasColors;
                currentMaterial.color.set(0xffffff);
            }
        }
    }
    
    // Apply animation if waves are enabled
    if (params.wavesEnabled && params.animation !== 'spherical_waves') {
        params.animation = 'spherical_waves';
        currentAnimation = 'spherical_waves';
        if (pointCloud) {
            applyAnimation('spherical_waves');
        }
    } else if (!params.wavesEnabled && params.animation === 'spherical_waves') {
        params.animation = 'none';
        currentAnimation = 'none';
        if (pointCloud) {
            applyAnimation('none');
        }
    }
    
    // Apply viewport restoration if pointCloud exists
    if (params._restoreViewport && pointCloud && pointCloud.geometry) {
        pointCloud.geometry.computeBoundingBox();
        const box = pointCloud.geometry.boundingBox;
        const modelCenter = box.getCenter(new THREE.Vector3());
        
        if (params._useRelativeViewport) {
            // Restore relative viewport
            camera.position.set(
                modelCenter.x + params._camOffsetX,
                modelCenter.y + params._camOffsetY,
                modelCenter.z + params._camOffsetZ
            );
            controls.target.set(
                modelCenter.x + params._targetOffsetX,
                modelCenter.y + params._targetOffsetY,
                modelCenter.z + params._targetOffsetZ
            );
        } else if (params._camX !== undefined) {
            // Restore absolute viewport (fallback)
            camera.position.set(params._camX, params._camY, params._camZ);
            controls.target.set(params._targetX, params._targetY, params._targetZ);
        }
        
        controls.update();
        params._restoreViewport = false; // Clear flag after restoration
    }
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
    
    // Deserialize parameters from URL first (before GUI initialization)
    const hasURLParams = deserializeParamsFromURL();
    if (hasURLParams) {
        console.log('🟢 [DEBUG] Parameters restored from URL');
        // Apply restored parameters immediately
        applyRestoredParams();
    }
    
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
            // If there's a custom file loaded, include it in display options but not in defaultScenes
            const displayOptions = currentCustomFileName && !defaultScenes.includes(currentCustomFileName)
                ? [...defaultScenes, currentCustomFileName]
                : defaultScenes;
            selectedSceneCtrl.options(displayOptions);
            console.log('🟢 [DEBUG] Options updated');
            
            // Preserve custom file name if it's currently selected
            if (currentCustomFileName && params.selectedScene === currentCustomFileName) {
                // Keep custom file name selected
                params.selectedScene = currentCustomFileName;
                console.log('🟢 [DEBUG] Preserving custom file selection:', currentCustomFileName);
            } else {
                // Check if we have a scene from URL, otherwise use first default scene
                const modelParam = getURLParameter('model');
                if (modelParam && defaultScenes.includes(modelParam)) {
                    // Use scene from URL
                    params.selectedScene = modelParam;
                    console.log('🟢 [DEBUG] Using scene from URL:', params.selectedScene);
                } else {
                    // Set default scene
                    params.selectedScene = defaultScenes[0];
                    console.log('🟢 [DEBUG] Set default scene to:', params.selectedScene);
                }
            }
            
            // Update display to reflect the selected scene
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
        // Show dropzone if no models are available
        if (!pointCloud) {
            dropzone.classList.remove('hidden');
        }
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

