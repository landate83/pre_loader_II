/**
 * Type definitions for Keyframe Animation System
 * Using JSDoc for type safety in vanilla JavaScript
 */

/**
 * Camera state snapshot
 * @typedef {Object} CameraState
 * @property {[number, number, number]} position - Camera position [x, y, z]
 * @property {[number, number, number]} target - OrbitControls target [x, y, z]
 * @property {number} fov - Field of view in degrees
 */

/**
 * Color mode enumeration
 * @typedef {'file'|'custom'} ColorMode
 */

/**
 * Displacement axis enumeration
 * @typedef {'x'|'y'|'z'} DisplacementAxis
 */

/**
 * Complete viewer state snapshot
 * Contains all parameters from the UI and scene state
 * 
 * @typedef {Object} ViewerState
 * @property {string|null} sceneId - Selected scene ID or custom file name
 * @property {number} pointPercent - Percentage of points displayed (0-100)
 * @property {number} maxPoints - Maximum number of points
 * @property {boolean} useShaderMaterial - Whether to use ShaderMaterial vs PointsMaterial
 * @property {number} pointSize - Point size in world units
 * @property {number} opacity - Opacity value (0-1)
 * @property {ColorMode} colorMode - Color mode ('file' or 'custom')
 * @property {string} customColor - Custom color as hex string (#rrggbb)
 * @property {string} backgroundColor - Background color as hex string
 * @property {boolean} wavesEnabled - Enable spherical waves animation
 * @property {number} wavesAmplitude - Wave width/amplitude (1-10)
 * @property {number} wavesPeriod - Number of simultaneous waves (1-10)
 * @property {number} wavesSpeed - Wave propagation speed (units/sec)
 * @property {string} wavesColor - Wave color as hex string
 * @property {number} wavesColorIntensity - Wave color intensity (0-10)
 * @property {DisplacementAxis} wavesDisplacementAxis - Displacement axis
 * @property {number} wavesDisplacement - Displacement amount (0-10)
 * @property {CameraState} camera - Camera state snapshot
 */

/**
 * Single keyframe with state and timing
 * @typedef {Object} Keyframe
 * @property {string} id - Unique keyframe ID (UUID)
 * @property {string} name - Display name for the keyframe
 * @property {ViewerState} state - Complete viewer state snapshot
 * @property {number} durationToNextSec - Transition duration to next keyframe in seconds
 */

/**
 * Animation configuration
 * @typedef {Object} AnimationConfig
 * @property {boolean} loop - Whether to loop the animation
 * @property {number} currentTime - Current playback time in seconds
 * @property {boolean} isPlaying - Whether animation is currently playing
 */

// Export types for use in other modules
export const TYPES = {
    // This is a marker export to indicate this is a types-only module
    // The actual types are available through JSDoc @typedef
};
