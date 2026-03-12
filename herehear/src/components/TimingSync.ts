import * as Tone from 'tone';
import type { TransportState } from '../automergeTypes';

export class TimingSync {
    private static instance: TimingSync | null = null;
    private updateInterval: number | null = null;
    private isInitialized: boolean = false;
    private onBpmChangeCallback: ((bpm: number) => void) | null = null;
    private currentState: TransportState = {
        startTime: null,
        bpm: 120,
        isPlaying: false,
        pausedPosition: 0
    };

    /**
     * AudioContext-time anchor for local drift correction (Proposal 1).
     * Set to Tone.now() whenever the transport starts or is seeked.
     * Null when the transport is not playing.
     */
    private _audioContextStartTime: number | null = null;
    private _audioContextStartOffset: number = 0;

    /** How far in the future (ms) to schedule playback start, giving remote clients time to join. */
    private static readonly START_BUFFER_MS = 100;

    private constructor() {}

    /** High-resolution, monotonic wall-clock time in milliseconds.
     *  Equivalent to Date.now() but sub-millisecond precise and immune to NTP jumps. */
    private now(): number {
        return performance.timeOrigin + performance.now();
    }

    /**
     * Record the AudioContext time anchor for the sync loop.
     * expectedPosition = Tone.now() - _audioContextStartTime + _audioContextStartOffset
     * This keeps syncToTransport entirely within AudioContext time-space,
     * eliminating OS-clock vs audio-hardware-clock oscillator divergence.
     */
    private anchorAudioContext(offsetSeconds: number = 0): void {
        this._audioContextStartTime = Tone.now();
        this._audioContextStartOffset = offsetSeconds;
    }

    static getInstance(): TimingSync {
        if (!TimingSync.instance) {
            TimingSync.instance = new TimingSync();
        }
        return TimingSync.instance;
    }

    async initialize(bpm: number = 120): Promise<void> {
        if (this.isInitialized) {
            console.log('TimingSync already initialized');
            return;
        }

        console.log('Initializing TimingSync with timestamp-based sync');

        this.currentState.bpm = bpm;
        this.isInitialized = true;

        // Start Tone.js audio context
        const transport = Tone.getTransport();
        transport.bpm.value = bpm;

        // Start sync loop
        this.startSyncLoop();

        console.log('TimingSync ready!');
    }

    /**
     * Update from remote Automerge state
     * Call this when the shared transport state changes
     */
    syncFromRemote(state: TransportState) {
        if (!this.isInitialized) return;

        const transport = Tone.getTransport();
        const prevBpm = this.currentState.bpm;
        const wasPlaying = this.currentState.isPlaying;

        // Update local state
        this.currentState = { ...state };

        // Notify UI if BPM changed
        if (Math.abs(prevBpm - state.bpm) > 0.1) {
            if (this.onBpmChangeCallback) {
                this.onBpmChangeCallback(Math.round(state.bpm));
            }
        }

        // Update BPM
        transport.bpm.value = state.bpm;

        // Update play/pause state and position
        if (state.isPlaying && state.startTime) {
            // Wall-clock elapsed is only used here, for the initial cross-device seek.
            const msUntilStart = state.startTime - this.now();
            const positionInSeconds = Math.max(0, -msUntilStart / 1000);

            if (!wasPlaying || transport.state !== 'started') {
                // State transition (paused → playing): join at the correct position.
                console.log('[TimingSync] Starting Transport');
                transport.seconds = positionInSeconds;
                if (msUntilStart > 0) {
                    // startTime is in the future — schedule to start exactly on beat 0.
                    transport.start(`+${msUntilStart / 1000}`);
                } else {
                    // startTime already passed — fast-forward to current position.
                    transport.start();
                }
                // Anchor AudioContext time so the sync loop stays in AudioContext time-space.
                this.anchorAudioContext(positionInSeconds);
            } else {
                // Already playing — only correct if drift exceeds threshold to avoid glitches.
                const drift = Math.abs(transport.seconds - positionInSeconds);
                if (drift > 0.05) {
                    console.log(`[TimingSync] syncFromRemote correcting drift: ${(drift * 1000).toFixed(1)}ms`);
                    // Use Transport's native sample-accurate seek (Proposal 2).
                    transport.seconds = positionInSeconds;
                    // Re-anchor so syncToTransport doesn't immediately re-flag this correction.
                    this.anchorAudioContext(positionInSeconds);
                }
            }
        } else {
            if (transport.state === 'started') {
                console.log('[TimingSync] Pausing Transport');
                transport.pause();
            }
            this._audioContextStartTime = null;
        }
    }

    private syncToTransport() {
        if (!this.isInitialized || !this.currentState.isPlaying || this._audioContextStartTime === null) {
            return;
        }

        const transport = Tone.getTransport();

        // Both sides are in AudioContext time-space — no cross-oscillator comparison (Proposal 1).
        const expectedPosition = Tone.now() - this._audioContextStartTime + this._audioContextStartOffset;
        const currentPosition = transport.seconds;

        // If drift is more than 50ms, resync using Transport's native sample-accurate seek (Proposal 2).
        const drift = Math.abs(currentPosition - expectedPosition);
        if (drift > 0.05) {
            console.log(`[TimingSync] Correcting drift: ${(drift * 1000).toFixed(1)}ms`);
            transport.seconds = expectedPosition;
            // Re-anchor so the next loop iteration doesn't re-flag this correction.
            this.anchorAudioContext(expectedPosition);
        }
    }

    private startSyncLoop() {
        const sync = () => {
            this.syncToTransport();

            // Sync every 250ms with small jitter
            const baseInterval = 250;
            const jitterRange = 50;
            const jitter = baseInterval + (Math.random() * jitterRange * 2 - jitterRange);
            this.updateInterval = window.setTimeout(sync, jitter);
        };
        sync();
    }

    /**
     * Call this when local user changes BPM
     * Returns the new state to share via Automerge
     */
    setBPM(bpm: number): TransportState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        this.currentState.bpm = bpm;

        const transport = Tone.getTransport();
        transport.bpm.value = bpm;

        console.log('Updated BPM:', bpm);
        return { ...this.currentState };
    }

    /**
     * Start playback from position 0.
     * Returns the new state to share via Automerge.
     */
    start(): TransportState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        const bufferSec = TimingSync.START_BUFFER_MS / 1000;
        const transport = Tone.getTransport();
        transport.seconds = 0;

        // Schedule startTime in the future so remote clients can receive and join before beat 0.
        this.currentState.startTime = this.now() + TimingSync.START_BUFFER_MS;
        this.currentState.isPlaying = true;
        this.currentState.pausedPosition = 0;

        transport.start(`+${bufferSec}`);
        this.anchorAudioContext(0);

        console.log('Started playback from 0 at:', this.currentState.startTime);
        return { ...this.currentState };
    }

    /**
     * Resume playback from the paused position.
     * Returns the new state to share via Automerge.
     */
    resume(): TransportState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        if (this.currentState.isPlaying) {
            console.log('Already playing');
            return { ...this.currentState };
        }

        const transport = Tone.getTransport();
        const pos = this.currentState.pausedPosition;

        transport.seconds = pos;
        // Adjust startTime so elapsed calculation picks up from pausedPosition
        this.currentState.startTime = this.now() - (pos * 1000);
        this.currentState.isPlaying = true;

        transport.start();
        this.anchorAudioContext(pos);

        console.log('Resumed playback from', pos.toFixed(2), 's');
        return { ...this.currentState };
    }

    /**
     * Pause playback, preserving current position for resume.
     * Returns the new state to share via Automerge.
     */
    pause(): TransportState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        if (this.currentState.startTime) {
            this.currentState.pausedPosition = (this.now() - this.currentState.startTime) / 1000;
        }
        this.currentState.isPlaying = false;
        this.currentState.startTime = null;
        this._audioContextStartTime = null;

        const transport = Tone.getTransport();
        transport.pause();

        console.log('Paused at', this.currentState.pausedPosition.toFixed(2), 's');
        return { ...this.currentState };
    }

    /**
     * Reset position to 0 without changing play/pause state.
     * Returns the new state to share via Automerge.
     */
    reset(): TransportState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        const transport = Tone.getTransport();
        transport.seconds = 0;
        this.currentState.pausedPosition = 0;

        if (this.currentState.isPlaying) {
            this.currentState.startTime = this.now();
            this.anchorAudioContext(0);
        }

        console.log('Reset position to 0');
        return { ...this.currentState };
    }

    getState(): TransportState {
        return { ...this.currentState };
    }

    // Register a callback to be notified when BPM changes from remote
    onBpmChange(callback: (bpm: number) => void) {
        this.onBpmChangeCallback = callback;
    }

    destroy() {
        if (this.updateInterval !== null) {
            clearTimeout(this.updateInterval);
            this.updateInterval = null;
        }
        this.isInitialized = false;
        this.onBpmChangeCallback = null;
        this._audioContextStartTime = null;
        TimingSync.instance = null;
    }
}
