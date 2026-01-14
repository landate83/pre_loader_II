/**
 * Keyframe Manager
 * Handles CRUD operations for keyframes and persistence
 */

import { store } from './store.js';

export class KeyframeManager {
    /**
     * @param {Object} params - Global params object from main.js
     * @param {Object} camera - Three.js camera
     * @param {Object} controls - OrbitControls instance
     */
    constructor(params, camera, controls) {
        this.params = params;
        this.camera = camera;
        this.controls = controls;
        this.store = store;

        /** @type {Array<import('./types.js').Keyframe>} */
        this.keyframes = [];

        this.MAX_KEYFRAMES = 5;

        // Load from localStorage on init
        this.loadFromLocalStorage();
    }

    /**
     * Capture current viewer state as a new keyframe
     * @param {string|null} name - Optional custom name
     * @returns {import('./types.js').Keyframe}
     * @throws {Error} If maximum keyframes reached
     */
    captureKeyframe(name = null) {
        if (this.keyframes.length >= this.MAX_KEYFRAMES) {
            throw new Error(`Maximum ${this.MAX_KEYFRAMES} keyframes allowed`);
        }

        const state = this.captureCurrentState();

        const keyframe = {
            id: this.generateUUID(),
            name: name || `Keyframe ${this.keyframes.length + 1}`,
            state: state,
            durationToNextSec: 2.0 // Default 2 seconds
        };

        this.keyframes.push(keyframe);
        this.saveToLocalStorage();

        console.log('📸 Captured keyframe:', keyframe.name);

        return keyframe;
    }

    /**
     * Capture current viewer state
     * @returns {import('./types.js').ViewerState}
     * @private
     */
    captureCurrentState() {
        const isSplatting = this.params.isGaussianSplatting || false;
        
        const state = {
            sceneId: this.params.selectedScene || null,
            backgroundColor: this.params.backgroundColor,
            camera: {
                position: [
                    this.camera.position.x,
                    this.camera.position.y,
                    this.camera.position.z
                ],
                target: [
                    this.controls.target.x,
                    this.controls.target.y,
                    this.controls.target.z
                ],
                fov: this.camera.fov
            }
        };
        
        // Only include display settings for point clouds, not for Gaussian Splatting
        if (!isSplatting) {
            state.pointPercent = this.params.pointPercent;
            state.maxPoints = this.params.maxPoints;
            state.useShaderMaterial = this.params.useShaderMaterial;
            state.pointSize = this.params.pointSize;
            state.opacity = this.params.opacity;
            state.colorMode = this.params.colorMode;
            state.customColor = this.params.customColor;
            state.wavesEnabled = this.params.wavesEnabled;
            state.wavesAmplitude = this.params.wavesAmplitude;
            state.wavesPeriod = this.params.wavesPeriod;
            state.wavesSpeed = this.params.wavesSpeed;
            state.wavesColor = this.params.wavesColor;
            state.wavesColorIntensity = this.params.wavesColorIntensity;
            state.wavesDisplacementAxis = this.params.wavesDisplacementAxis;
            state.wavesDisplacement = this.params.wavesDisplacement;
        }
        
        return state;
    }

    /**
     * Update an existing keyframe
     * @param {string} id - Keyframe ID
     * @param {Partial<import('./types.js').Keyframe>} updates - Properties to update
     * @returns {boolean} - Success status
     */
    updateKeyframe(id, updates) {
        const index = this.keyframes.findIndex(kf => kf.id === id);
        if (index === -1) {
            console.warn('Keyframe not found:', id);
            return false;
        }

        this.keyframes[index] = {
            ...this.keyframes[index],
            ...updates
        };

        this.saveToLocalStorage();
        return true;
    }

    /**
     * Delete a keyframe
     * @param {string} id - Keyframe ID
     * @returns {boolean} - Success status
     */
    deleteKeyframe(id) {
        const index = this.keyframes.findIndex(kf => kf.id === id);
        if (index === -1) {
            console.warn('Keyframe not found:', id);
            return false;
        }

        this.keyframes.splice(index, 1);
        this.saveToLocalStorage();

        console.log('🗑 Deleted keyframe:', id);
        return true;
    }

    /**
     * Set duration for a keyframe's transition to next
     * @param {string} id - Keyframe ID
     * @param {number} durationSec - Duration in seconds
     * @returns {boolean} - Success status
     */
    setDuration(id, durationSec) {
        return this.updateKeyframe(id, { durationToNextSec: durationSec });
    }

    /**
     * Get keyframe by ID
     * @param {string} id - Keyframe ID
     * @returns {import('./types.js').Keyframe|null}
     */
    getKeyframe(id) {
        return this.keyframes.find(kf => kf.id === id) || null;
    }

    /**
     * Get all keyframes
     * @returns {Array<import('./types.js').Keyframe>}
     */
    getAllKeyframes() {
        return [...this.keyframes];
    }

    /**
     * Export keyframes to JSON string
     * @returns {string}
     */
    exportToJSON() {
        return JSON.stringify(this.keyframes, null, 2);
    }

    /**
     * Import keyframes from JSON string
     * @param {string} json - JSON string
     * @throws {Error} If JSON is invalid
     */
    importFromJSON(json) {
        try {
            const imported = JSON.parse(json);

            if (!Array.isArray(imported)) {
                throw new Error('Invalid format: expected array');
            }

            // Validate keyframes
            for (const kf of imported) {
                if (!kf.id || !kf.name || !kf.state) {
                    throw new Error('Invalid keyframe format');
                }
            }

            this.keyframes = imported;
            this.saveToLocalStorage();

            console.log('📥 Imported', this.keyframes.length, 'keyframes');
        } catch (error) {
            console.error('Import failed:', error);
            throw new Error('Failed to import keyframes: ' + error.message);
        }
    }

    /**
     * Save keyframes to localStorage
     * @private
     */
    saveToLocalStorage() {
        try {
            localStorage.setItem('viewer_keyframes', JSON.stringify(this.keyframes));
            console.log('💾 Saved to localStorage');
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }

    /**
     * Load keyframes from localStorage
     * @private
     */
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('viewer_keyframes');
            if (data) {
                this.keyframes = JSON.parse(data);
                console.log('📂 Loaded', this.keyframes.length, 'keyframes from localStorage');
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            this.keyframes = [];
        }
    }

    /**
     * Clear all keyframes
     */
    clearAll() {
        this.keyframes = [];
        this.saveToLocalStorage();
        console.log('🗑 Cleared all keyframes');
    }

    /**
     * Generate a UUID (simple version)
     * @returns {string}
     * @private
     */
    generateUUID() {
        // Use crypto.randomUUID if available, otherwise fallback
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        // Fallback UUID generation
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}
