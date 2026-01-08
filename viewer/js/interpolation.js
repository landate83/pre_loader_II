/**
 * Interpolation utilities for keyframe animation
 * Handles numeric, color, and state interpolation with proper easing
 */

/**
 * Cubic ease-in-out function
 * Provides smooth acceleration and deceleration
 * @param {number} t - Progress value (0-1)
 * @returns {number} - Eased value (0-1)
 */
export function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Linear interpolation between two numbers
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Progress (0-1)
 * @returns {number} - Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Convert hex color to RGB array
 * @param {string} hex - Hex color (#rrggbb)
 * @returns {[number, number, number]} - RGB values (0-255)
 */
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return [r, g, b];
}

/**
 * Convert RGB array to hex color
 * @param {[number, number, number]} rgb - RGB values (0-255)
 * @returns {string} - Hex color (#rrggbb)
 */
function rgbToHex(rgb) {
    const [r, g, b] = rgb.map(v => Math.round(Math.max(0, Math.min(255, v))));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Interpolate between two colors in linear RGB space
 * Uses gamma correction for perceptually correct color blending
 * @param {string} hexA - Start color (#rrggbb)
 * @param {string} hexB - End color (#rrggbb)
 * @param {number} t - Progress (0-1)
 * @returns {string} - Interpolated color (#rrggbb)
 */
export function lerpColor(hexA, hexB, t) {
    // Convert hex to RGB
    const rgbA = hexToRgb(hexA);
    const rgbB = hexToRgb(hexB);

    // Linearize (apply gamma correction)
    // sRGB gamma is approximately 2.2
    const linA = rgbA.map(c => Math.pow(c / 255, 2.2));
    const linB = rgbB.map(c => Math.pow(c / 255, 2.2));

    // Interpolate in linear space
    const linResult = [
        lerp(linA[0], linB[0], t),
        lerp(linA[1], linB[1], t),
        lerp(linA[2], linB[2], t)
    ];

    // Delinearize (remove gamma correction)
    const result = linResult.map(c => Math.pow(c, 1 / 2.2) * 255);

    return rgbToHex(result);
}

/**
 * Interpolate between two viewer states
 * Handles different data types appropriately:
 * - Numbers: linear interpolation
 * - Colors: gamma-corrected interpolation
 * - Booleans/enums: discrete switch at end of segment
 * - Strings: discrete switch at end of segment
 * 
 * @param {import('./types.js').ViewerState} stateA - Start state
 * @param {import('./types.js').ViewerState} stateB - End state
 * @param {number} t - Progress (0-1)
 * @returns {import('./types.js').ViewerState} - Interpolated state
 */
export function interpolateState(stateA, stateB, t) {
    // For discrete values (booleans, enums, strings), switch at end of segment
    // This provides predictable behavior
    const useB = t >= 0.999;

    // Safe color interpolation with fallback
    const safeColorLerp = (colorA, colorB, t) => {
        try {
            const a = colorA || '#ffffff';
            const b = colorB || '#ffffff';
            return lerpColor(a, b, t);
        } catch (e) {
            console.warn('Color interpolation failed:', e);
            return colorA || colorB || '#ffffff';
        }
    };

    // Safe number lerp with fallback
    const safeLerp = (a, b, t, defaultVal = 0) => {
        const valA = typeof a === 'number' ? a : defaultVal;
        const valB = typeof b === 'number' ? b : defaultVal;
        return lerp(valA, valB, t);
    };

    // Safe camera interpolation
    const cameraA = stateA.camera || { position: [0, 0, 5], target: [0, 0, 0], fov: 75 };
    const cameraB = stateB.camera || { position: [0, 0, 5], target: [0, 0, 0], fov: 75 };

    return {
        // Scene ID - discrete switch at end
        sceneId: useB ? stateB.sceneId : stateA.sceneId,

        // Numeric values - linear interpolation
        pointPercent: safeLerp(stateA.pointPercent, stateB.pointPercent, t, 100),
        maxPoints: Math.round(safeLerp(stateA.maxPoints, stateB.maxPoints, t, 0)),
        pointSize: safeLerp(stateA.pointSize, stateB.pointSize, t, 0.03),
        opacity: safeLerp(stateA.opacity, stateB.opacity, t, 1),

        // Boolean - discrete switch
        useShaderMaterial: useB ? stateB.useShaderMaterial : stateA.useShaderMaterial,

        // Enum - discrete switch at end
        colorMode: useB ? stateB.colorMode : stateA.colorMode,

        // Colors - gamma-corrected interpolation with safety
        customColor: safeColorLerp(stateA.customColor, stateB.customColor, t),
        backgroundColor: safeColorLerp(stateA.backgroundColor, stateB.backgroundColor, t),

        // Waves - boolean discrete, numbers interpolated
        wavesEnabled: useB ? stateB.wavesEnabled : stateA.wavesEnabled,
        wavesAmplitude: safeLerp(stateA.wavesAmplitude, stateB.wavesAmplitude, t, 3),
        wavesPeriod: safeLerp(stateA.wavesPeriod, stateB.wavesPeriod, t, 1),
        wavesSpeed: safeLerp(stateA.wavesSpeed, stateB.wavesSpeed, t, 5),
        wavesColor: safeColorLerp(stateA.wavesColor, stateB.wavesColor, t),
        wavesColorIntensity: safeLerp(stateA.wavesColorIntensity, stateB.wavesColorIntensity, t, 5),
        wavesDisplacementAxis: useB ? stateB.wavesDisplacementAxis : stateA.wavesDisplacementAxis,
        wavesDisplacement: safeLerp(stateA.wavesDisplacement, stateB.wavesDisplacement, t, 1),

        // Camera - interpolate position and target
        camera: {
            position: [
                lerp(cameraA.position[0] || 0, cameraB.position[0] || 0, t),
                lerp(cameraA.position[1] || 0, cameraB.position[1] || 0, t),
                lerp(cameraA.position[2] || 5, cameraB.position[2] || 5, t)
            ],
            target: [
                lerp(cameraA.target[0] || 0, cameraB.target[0] || 0, t),
                lerp(cameraA.target[1] || 0, cameraB.target[1] || 0, t),
                lerp(cameraA.target[2] || 0, cameraB.target[2] || 0, t)
            ],
            fov: lerp(cameraA.fov || 75, cameraB.fov || 75, t)
        }
    };
}
