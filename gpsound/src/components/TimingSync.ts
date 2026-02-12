import * as Tone from 'tone';

export interface TransportSyncState {
    startTime: number | null; // Timestamp in ms when transport started (null when paused)
    bpm: number;
    isPlaying: boolean;
    pausedPosition: number; // Transport position in seconds when paused (0 = beginning)
}

export class TimingSync {
    private static instance: TimingSync | null = null;
    private updateInterval: number | null = null;
    private isInitialized: boolean = false;
    private onBpmChangeCallback: ((bpm: number) => void) | null = null;
    private currentState: TransportSyncState = {
        startTime: null,
        bpm: 120,
        isPlaying: false,
        pausedPosition: 0
    };

    private constructor() {}

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
    syncFromRemote(state: TransportSyncState) {
        if (!this.isInitialized) return;

        const transport = Tone.getTransport();
        const prevBpm = this.currentState.bpm;

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
            // Calculate current position based on elapsed time
            const elapsed = Date.now() - state.startTime;
            const positionInSeconds = elapsed / 1000;

            transport.seconds = positionInSeconds;

            if (transport.state !== 'started') {
                console.log('[TimingSync] Starting Transport');
                transport.start();
            }
        } else {
            if (transport.state === 'started') {
                console.log('[TimingSync] Pausing Transport');
                transport.pause();
            }
        }
    }

    private syncToTransport() {
        if (!this.isInitialized || !this.currentState.isPlaying || !this.currentState.startTime) {
            return;
        }

        const transport = Tone.getTransport();

        // Calculate where we should be based on startTime
        const elapsed = Date.now() - this.currentState.startTime;
        const expectedPosition = elapsed / 1000;

        // Get current transport position in seconds
        const currentPosition = transport.seconds;

        // If drift is more than 50ms, resync
        const drift = Math.abs(currentPosition - expectedPosition);
        if (drift > 0.05) {
            console.log(`[TimingSync] Correcting drift: ${(drift * 1000).toFixed(1)}ms`);
            transport.seconds = expectedPosition;
        }
    }

    private startSyncLoop() {
        const sync = () => {
            this.syncToTransport();

            // Sync every 500ms with small jitter
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
    setBPM(bpm: number): TransportSyncState {
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
    start(): TransportSyncState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        const transport = Tone.getTransport();
        transport.seconds = 0;

        this.currentState.startTime = Date.now();
        this.currentState.isPlaying = true;
        this.currentState.pausedPosition = 0;

        transport.start();

        console.log('Started playback from 0 at:', this.currentState.startTime);
        return { ...this.currentState };
    }

    /**
     * Resume playback from the paused position.
     * Returns the new state to share via Automerge.
     */
    resume(): TransportSyncState {
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
        this.currentState.startTime = Date.now() - (pos * 1000);
        this.currentState.isPlaying = true;

        transport.start();

        console.log('Resumed playback from', pos.toFixed(2), 's');
        return { ...this.currentState };
    }

    /**
     * Pause playback, preserving current position for resume.
     * Returns the new state to share via Automerge.
     */
    pause(): TransportSyncState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        if (this.currentState.startTime) {
            this.currentState.pausedPosition = (Date.now() - this.currentState.startTime) / 1000;
        }
        this.currentState.isPlaying = false;
        this.currentState.startTime = null;

        const transport = Tone.getTransport();
        transport.pause();

        console.log('Paused at', this.currentState.pausedPosition.toFixed(2), 's');
        return { ...this.currentState };
    }

    /**
     * Reset position to 0 without changing play/pause state.
     * Returns the new state to share via Automerge.
     */
    reset(): TransportSyncState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        const transport = Tone.getTransport();
        transport.seconds = 0;
        this.currentState.pausedPosition = 0;

        if (this.currentState.isPlaying) {
            this.currentState.startTime = Date.now();
        }

        console.log('Reset position to 0');
        return { ...this.currentState };
    }

    getState(): TransportSyncState {
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
    }
}
