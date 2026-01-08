/**
 * Centralized state store for the viewer
 * Provides reactive state management with pub/sub pattern
 */

/**
 * Global application store for viewer state
 */
class ViewerStore {
    constructor() {
        /** @type {import('./types.js').ViewerState|null} */
        this.state = null;

        /** @type {boolean} - Whether animation is currently playing */
        this.isPlaying = false;

        /** @type {boolean} - Whether in keyframe mode (for future use) */
        this.isKeyframeMode = false;

        /** @type {Set<Function>} - Event listeners */
        this.listeners = new Set();
    }

    /**
     * Set the current viewer state
     * @param {import('./types.js').ViewerState} state - New state
     * @param {Object} options - Options
     * @param {string} [options.source='manual'] - Source of state change ('manual', 'animation', 'keyframe')
     */
    setViewerState(state, options = {}) {
        this.state = state;
        this.notify({
            type: 'state',
            source: options.source || 'manual',
            state: state
        });
    }

    /**
     * Get current viewer state
     * @returns {import('./types.js').ViewerState|null}
     */
    getViewerState() {
        return this.state;
    }

    /**
     * Set playing state
     * @param {boolean} playing - Whether animation is playing
     */
    setPlaying(playing) {
        if (this.isPlaying !== playing) {
            this.isPlaying = playing;
            this.notify({ type: 'playing', value: playing });
        }
    }

    /**
     * Get playing state
     * @returns {boolean}
     */
    getPlaying() {
        return this.isPlaying;
    }

    /**
     * Subscribe to store events
     * @param {Function} callback - Event callback
     * @returns {Function} - Unsubscribe function
     */
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of an event
     * @param {Object} event - Event object
     * @private
     */
    notify(event) {
        this.listeners.forEach(fn => {
            try {
                fn(event);
            } catch (error) {
                console.error('Store listener error:', error);
            }
        });
    }
}

// Export singleton instance
export const store = new ViewerStore();
