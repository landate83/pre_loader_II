/**
 * Keyframe Animation Engine
 * Handles timeline calculations, playback control, and state interpolation
 */

import { interpolateState, easeInOutCubic } from './interpolation.js';
import { store } from './store.js';

export class KeyframeAnimator {
    /**
     * @param {import('./KeyframeManager.js').KeyframeManager} keyframeManager
     * @param {Function} applyStateFn - Function to apply state changes (state, options) => void
     */
    constructor(keyframeManager, applyStateFn) {
        this.manager = keyframeManager;
        this.applyState = applyStateFn;
        this.store = store;

        /** @type {number} - Current playback time in seconds */
        this.currentTime = 0;

        /** @type {boolean} - Whether animation is currently playing */
        this.isPlaying = false;

        /** @type {boolean} - Whether to loop the animation */
        this.loop = false;

        /** @type {number} - Timestamp of last frame */
        this.lastFrameTime = 0;

        /** @type {number|null} - RequestAnimationFrame ID */
        this.rafId = null;
    }

    /**
     * Calculate total duration of the animation
     * @returns {number} - Total duration in seconds
     */
    getTotalDuration() {
        const kfs = this.manager.keyframes;

        if (kfs.length < 2) {
            return 0;
        }

        let total = 0;

        // Sum durations between keyframes
        for (let i = 0; i < kfs.length - 1; i++) {
            total += kfs[i].durationToNextSec;
        }

        // For loop mode, add last keyframe's duration (transition back to first)
        if (this.loop && kfs.length > 0) {
            total += kfs[kfs.length - 1].durationToNextSec;
        }

        return total;
    }

    /**
     * Evaluate state at a specific time
     * @param {number} timeSec - Time in seconds
     * @returns {import('./types.js').ViewerState|null} - Interpolated state
     */
    evaluateAt(timeSec) {
        const kfs = this.manager.keyframes;

        // No keyframes
        if (kfs.length === 0) {
            return null;
        }

        // Single keyframe - return its state
        if (kfs.length === 1) {
            return kfs[0].state;
        }

        // Build timeline segments
        const segments = this.buildTimeline();

        // Find current segment
        for (const seg of segments) {
            if (timeSec >= seg.startTime && timeSec < seg.endTime) {
                const duration = seg.endTime - seg.startTime;

                // Avoid division by zero
                if (duration <= 0) {
                    return seg.keyframeA.state;
                }

                const localT = (timeSec - seg.startTime) / duration;
                const easedT = easeInOutCubic(localT);

                return interpolateState(seg.keyframeA.state, seg.keyframeB.state, easedT);
            }
        }

        // Time is past all segments - return last keyframe state
        return kfs[kfs.length - 1].state;
    }

    /**
     * Build timeline segments from keyframes
     * @returns {Array<Object>} - Array of segment objects
     * @private
     */
    buildTimeline() {
        const kfs = this.manager.keyframes;
        const segments = [];
        let cumTime = 0;

        // Create segments between consecutive keyframes
        for (let i = 0; i < kfs.length - 1; i++) {
            segments.push({
                startTime: cumTime,
                endTime: cumTime + kfs[i].durationToNextSec,
                keyframeA: kfs[i],
                keyframeB: kfs[i + 1]
            });
            cumTime += kfs[i].durationToNextSec;
        }

        // Add loop segment (last → first) if loop is enabled
        if (this.loop && kfs.length > 0) {
            segments.push({
                startTime: cumTime,
                endTime: cumTime + kfs[kfs.length - 1].durationToNextSec,
                keyframeA: kfs[kfs.length - 1],
                keyframeB: kfs[0]
            });
        }

        return segments;
    }

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying) {
            return; // Already playing
        }

        const kfs = this.manager.keyframes;
        if (kfs.length < 2) {
            console.warn('Need at least 2 keyframes to play animation');
            return;
        }

        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.store.setPlaying(true);

        console.log('▶ Playing animation');

        // Start animation loop
        this.tick();
    }

    /**
     * Pause playback
     */
    pause() {
        if (!this.isPlaying) {
            return; // Already paused
        }

        this.isPlaying = false;
        this.store.setPlaying(false);

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        console.log('⏸ Paused animation');
    }

    /**
     * Stop playback and reset to beginning
     */
    stop() {
        this.isPlaying = false;
        this.currentTime = 0;
        this.store.setPlaying(false);

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Apply first keyframe state
        const kfs = this.manager.keyframes;
        if (kfs.length > 0) {
            this.applyState(kfs[0].state, { source: 'animation' });
        }

        console.log('⏹ Stopped animation');
    }

    /**
     * Set current playback time (scrubbing)
     * @param {number} timeSec - Time in seconds
     */
    setTime(timeSec) {
        const totalDuration = this.getTotalDuration();

        // Clamp time to valid range
        this.currentTime = Math.max(0, Math.min(timeSec, totalDuration));

        // Evaluate and apply state at this time
        const state = this.evaluateAt(this.currentTime);
        if (state) {
            this.applyState(state, { source: 'animation' });
        }
    }

    /**
     * Set loop mode
     * @param {boolean} enabled - Whether to enable looping
     */
    setLoop(enabled) {
        this.loop = enabled;
        console.log('🔁 Loop:', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Get current playback time
     * @returns {number} - Current time in seconds
     */
    getCurrentTime() {
        return this.currentTime;
    }

    /**
     * Animation tick (called every frame)
     * @private
     */
    tick() {
        if (!this.isPlaying) {
            return;
        }

        try {
            const now = performance.now();
            const deltaSec = (now - this.lastFrameTime) / 1000;
            this.lastFrameTime = now;

            // Update current time
            this.currentTime += deltaSec;

            const totalDuration = this.getTotalDuration();

            // Handle case with no valid duration
            if (totalDuration <= 0) {
                console.warn('No valid animation duration');
                this.pause();
                return;
            }

            // Handle end of timeline
            if (this.currentTime >= totalDuration) {
                if (this.loop) {
                    // Loop back to start
                    this.currentTime = this.currentTime % totalDuration;
                } else {
                    // Clamp to end and pause
                    this.currentTime = totalDuration;
                    this.pause();
                    console.log('✓ Animation finished');
                    return;
                }
            }

            // Evaluate and apply state at current time
            const state = this.evaluateAt(this.currentTime);
            if (state) {
                this.applyState(state, { source: 'animation' });
            }
        } catch (error) {
            console.error('Animation tick error:', error);
            // Don't stop the animation on error, continue to next frame
        }

        // Continue animation loop (outside try-catch to ensure it always runs)
        if (this.isPlaying) {
            this.rafId = requestAnimationFrame(() => this.tick());
        }
    }
}
