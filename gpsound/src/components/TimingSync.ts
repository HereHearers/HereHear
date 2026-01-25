import * as Tone from 'tone';
import { TimingObject } from 'timing-object';
import { TimingProvider } from 'timing-provider';

export class TimingSync {
    private static instance: TimingSync | null = null;
    private timingObject: InstanceType<typeof TimingObject> | null = null;
    private updateInterval: number | null = null;
    private isInitialized: boolean = false;
    private onBpmChangeCallback: ((bpm: number) => void) | null = null;

    private constructor() {}

    static getInstance(): TimingSync {
        if (!TimingSync.instance) {
            TimingSync.instance = new TimingSync();
        }
        return TimingSync.instance;
    }

    async initialize(sessionId: string): Promise<void> {
        if (this.isInitialized) {
            console.log('TimingSync already initialized');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                // Create timing provider with local server URL
                // Note: timing-provider-server shares timing state across all connected clients
                // If you need per-session sync, run multiple servers on different ports
                // and use: `ws://localhost:${2276 + hashCode(sessionId) % 100}`
                const timingProvider = new TimingProvider('ws://localhost:2276');
                this.timingObject = new TimingObject(timingProvider);

                console.log(`Connecting to timing server for session: ${sessionId}`);

                // Wait for connection
                const handleReadyStateChange = () => {
                    if (this.timingObject!.readyState === 'open') {
                        this.timingObject!.removeEventListener('readystatechange', handleReadyStateChange);
                        console.log('TimingObject connected');
                        this.isInitialized = true;
                        this.startSyncLoop();
                        resolve();
                    }
                };

                this.timingObject.addEventListener('readystatechange', handleReadyStateChange);

                // Listen for remote changes
                this.timingObject.addEventListener('change', () => {
                    this.syncFromTimingObject();
                });

                // Timeout after 10 seconds
                setTimeout(() => {
                    if (!this.isInitialized) {
                        reject(new Error('TimingObject connection timeout'));
                    }
                }, 10000);
            } catch (error) {
                reject(error);
            }
        });
    }

    private translateVector(vector: { position: number; velocity: number; timestamp: number; acceleration: number }) {
        if (vector.acceleration !== 0) {
            throw new Error('Acceleration not supported');
        }

        // Calculate current position based on elapsed time
        const now = performance.now() / 1000;
        const elapsed = now - vector.timestamp;
        const currentPosition = vector.position + (vector.velocity * elapsed);

        return {
            position: currentPosition,
            velocity: vector.velocity
        };
    }

    private syncFromTimingObject() {
        if (!this.timingObject) return;

        const transport = Tone.getTransport();
        const vector = this.timingObject.query();
        const { position, velocity } = this.translateVector(vector);

        // Convert velocity (BPM/60) back to BPM
        const bpm = velocity * 60;

        // console.log('[TimingSync] Syncing to Transport:', {
        //     position,
        //     bpm,
        //     velocity,
        //     transportState: transport.state,
        //     transportBPM: transport.bpm.value
        // });

        // Notify UI if BPM changed
        if (bpm > 0 && Math.abs(transport.bpm.value - bpm) > 0.1) {
            if (this.onBpmChangeCallback) {
                this.onBpmChangeCallback(Math.round(bpm));
            }
        }

        // Update Tone.js Transport
        if (velocity > 0) {
            // Calculate playback position in seconds
            transport.seconds = position / velocity;
            transport.bpm.value = bpm;

            // Start if stopped or paused
            if (transport.state !== 'started') {
                console.log('[TimingSync] Starting Transport');
                transport.start();
            }
        } else {
            // Stop if started or paused
            if (transport.state !== 'stopped') {
                console.log('[TimingSync] Stopping Transport');
                transport.stop();
            }
        }

        // console.log('[TimingSync] Transport after sync:', {
        //     state: transport.state,
        //     bpm: transport.bpm.value,
        //     position: transport.position
        // });
    }

    private startSyncLoop() {
        // Periodically sync to correct drift with small random jitter to prevent thundering herd
        const sync = () => {
            this.syncFromTimingObject();
            // For even tighter sync (more CPU usage):
            // const baseInterval = 250;  // Sync every ~250ms
            // const jitterRange = 50;    // ±50ms jitter

            // // For balanced performance (current setting):
            // const baseInterval = 500;  // Sync every ~500ms
            // const jitterRange = 100;   // ±100ms jitter

            // // For lower CPU usage (more drift):
            // const baseInterval = 1000; // Sync every ~1 second
            // const jitterRange = 200;   // ±200ms jitter
            // Sync every 500ms with ±100ms jitter (more frequent = less drift)
            const baseInterval = 250;
            const jitterRange = 50;
            const jitter = baseInterval + (Math.random() * jitterRange * 2 - jitterRange);
            this.updateInterval = window.setTimeout(sync, jitter);
        };
        sync();
    }

    // Call this when the local user changes BPM
    setBPM(bpm: number) {
        if (!this.timingObject || !this.isInitialized) {
            console.warn('TimingObject not initialized');
            return;
        }

        const velocity = bpm / 60;
        const currentVector = this.timingObject.query();

        this.timingObject.update({
            velocity: velocity,
            position: currentVector.position
        });

        // Immediately sync local Transport after update
        this.syncFromTimingObject();

        console.log('Updated TimingObject BPM:', bpm);
    }

    // Call this when the local user plays
    play() {
        if (!this.timingObject || !this.isInitialized) {
            console.warn('TimingObject not initialized');
            return;
        }

        const transport = Tone.getTransport();
        const currentVector = this.timingObject.query();

        // If playback is already happening (velocity > 0), just sync to it
        // This prevents overwriting another user's BPM
        if (currentVector.velocity > 0) {
            console.log('Playback already active, syncing to existing BPM');
            this.syncFromTimingObject();
            return;
        }

        // Otherwise, start playback with current local BPM
        const currentBPM = transport.bpm.value;
        this.timingObject.update({
            velocity: currentBPM / 60,
            position: currentVector.position || 0
        });

        // Immediately sync local Transport after update
        this.syncFromTimingObject();

        console.log('Started playback with BPM:', currentBPM);
    }

    // Call this when the local user pauses
    pause() {
        if (!this.timingObject || !this.isInitialized) {
            console.warn('TimingObject not initialized');
            return;
        }

        const currentVector = this.timingObject.query();

        this.timingObject.update({
            velocity: 0,
            position: currentVector.position
        });

        // Immediately sync local Transport after update
        this.syncFromTimingObject();

        console.log('Paused playback');
    }

    getState() {
        if (!this.timingObject) return null;

        const vector = this.timingObject.query();
        return {
            isPlaying: vector.velocity !== 0,
            bpm: vector.velocity * 60,
            position: vector.position
        };
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
        this.timingObject = null;
        this.isInitialized = false;
        this.onBpmChangeCallback = null;
    }
}