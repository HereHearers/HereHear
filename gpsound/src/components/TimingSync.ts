import * as Tone from 'tone';

export interface TransportSyncState {
    startTime: number | null; // Timestamp in ms when transport started
    bpm: number;
    isPlaying: boolean;
}

export class TimingSync {
    private static instance: TimingSync | null = null;
    private updateInterval: number | null = null;
    private isInitialized: boolean = false;
    private onBpmChangeCallback: ((bpm: number) => void) | null = null;
    private currentState: TransportSyncState = {
        startTime: null,
        bpm: 120,
        isPlaying: false
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
     * Call this when local user plays
     * Returns the new state to share via Automerge
     */
    play(): TransportSyncState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        // If already playing, don't restart - just return current state
        if (this.currentState.isPlaying) {
            console.log('Already playing');
            return { ...this.currentState };
        }

        // Start playback with current timestamp
        this.currentState.startTime = Date.now();
        this.currentState.isPlaying = true;

        const transport = Tone.getTransport();
        transport.start();

        console.log('Started playback at:', this.currentState.startTime);
        return { ...this.currentState };
    }

    /**
     * Call this when local user pauses
     * Returns the new state to share via Automerge
     */
    pause(): TransportSyncState {
        if (!this.isInitialized) {
            console.warn('TimingSync not initialized');
            return this.currentState;
        }

        this.currentState.isPlaying = false;
        this.currentState.startTime = null;

        const transport = Tone.getTransport();
        transport.pause();

        console.log('Paused playback');
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
