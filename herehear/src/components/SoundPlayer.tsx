import * as Tone from 'tone';
import { type SoundConfig } from '../sharedTypes';
import { getSoundDefinition, type SynthInstrument, type Instrument } from './instrumentConfig';
import type { TransportState } from '../automergeTypes';

type InstrumentGroup = Instrument | Instrument[];

export class SoundPlayer {
  private static instance: SoundPlayer;
  private activeSounds: InstrumentGroup[] = []; //array of all currently playing instruments - used by stopAll() to quickly stop everything without needing to know IDs.
  private soundMap: Map<string, InstrumentGroup> = new Map(); //Tracks sounds by their ID/key (like soundId) - used for the startSound() and stopSound() methods where you need to start/stop specific sounds by name.
  private isSyncingTransport: boolean = false; // Prevent feedback loops during sync

  static getInstance(): SoundPlayer {
    if (!SoundPlayer.instance) {
      SoundPlayer.instance = new SoundPlayer();
    }
    return SoundPlayer.instance;
  }

  async playSingle(soundId: string, note: string): Promise<void> {
    await Tone.start();
    const timeLimit = 8000;
    // const timeLimit = 1e+20;

    const sound = this.createSound(soundId);
    this.activeSounds.push(sound);  // Track it so stopAll() can kill it
    this.triggerSound(sound, note);

    setTimeout(() => {
      this.destroySound(sound);
      // Remove from active sounds
      const index = this.activeSounds.indexOf(sound);
      if (index > -1) {
        this.activeSounds.splice(index, 1);
      }
    }, timeLimit);
  }

  async playMultiple(sounds: SoundConfig[]): Promise<void> {
    await Tone.start();
    
    this.stopAll();
    
    const synthConfigs = sounds.map(({ soundId, note }) => {
      const sound = this.createSound(soundId);
      this.activeSounds.push(sound);
      return { sound, note };
    });
    
    const startTime = Tone.now() + 0.1;
    
    synthConfigs.forEach(({ sound, note }) => {
      this.triggerSound(sound, note, startTime);
    });
  }

  async playMultipleWithVolume(sounds: Array<SoundConfig & { volume: number }>): Promise<void> {
    await Tone.start();
    
    // Create a set of incoming sound IDs
    const incomingSoundIds = new Set(sounds.map(s => s.soundId));
    
    // Stop sounds that are no longer needed
    const soundsToStop: string[] = [];
    for (const soundId of this.soundMap.keys()) {
        if (!incomingSoundIds.has(soundId)) {
            soundsToStop.push(soundId);
        }
    }
    soundsToStop.forEach(soundId => this.stopSound(soundId));
    
    // Start new sounds or update existing ones
    for (const { soundId, note, volume } of sounds) {
        if (this.soundMap.has(soundId)) {
            // Sound is already playing, just update volume
            const sound = this.soundMap.get(soundId)!;
            this.setSoundGain(sound, volume);
        } else {
            // New sound, start it
            const sound = this.createSound(soundId);
            this.soundMap.set(soundId, sound);
            this.activeSounds.push(sound);
            
            // Set initial volume (no ramp)
            this.setSoundGain(sound, volume, 0);
            
            // Start playing
            const startTime = Tone.now() + 0.1;
            this.triggerSound(sound, note, startTime);
        }
    }
  }

  private setSoundGain(sound: InstrumentGroup, volumeMultiplier: number, rampTime: number = 0.1): void {
      const sounds = Array.isArray(sound) ? sound : [sound];
      
      sounds.forEach((inst) => {
          // All Tone.js audio sources have a volume property
          if ('volume' in inst) {
              // Convert 0-1 multiplier to decibels
              // 0 = -Infinity dB (silent)
              // 1 = 0 dB (full volume)
              const volumeDb = volumeMultiplier <= 0 ? -Infinity : 20 * Math.log10(volumeMultiplier);
              
              if (rampTime > 0) {
                  (inst.volume as any).rampTo(volumeDb, rampTime);
              } else {
                  // Immediate volume change (for initial start)
                  (inst.volume as any).value = volumeDb;
              }
          }
      });
  }

  async startSound(soundId: string, note: string = "C4"): Promise<void> {
    // If already playing, don't start again
    if (this.soundMap.has(soundId)) {
      return;
    }

    await Tone.start();
    const sound = this.createSound(soundId);
    this.soundMap.set(soundId, sound);
    this.activeSounds.push(sound);
    this.triggerSound(sound, note);
  }

  stopSound(soundId: string): void {
      const sound = this.soundMap.get(soundId);
      if (sound) {
          // Fade out before stopping
          this.setSoundGain(sound, 0, 0.1);
          
          setTimeout(() => {
              this.destroySound(sound);
              this.soundMap.delete(soundId);
              
              // Remove from activeSounds array
              const index = this.activeSounds.indexOf(sound);
              if (index > -1) {
                  this.activeSounds.splice(index, 1);
              }
          }, 150);
      }
  }

  isSoundPlaying(soundId: string): boolean {
    return this.soundMap.has(soundId);
  }

  stopAll(): void {
    // Stop all tracked sounds
    this.activeSounds.forEach(sound => {
      this.destroySound(sound);
    });
    this.activeSounds = [];
    this.soundMap.clear();

    // NUCLEAR OPTION: Stop Transport and silence everything
    Tone.getTransport().stop();
    Tone.getTransport().cancel();  // Cancel all scheduled events

    // Release all voices on Destination to silence any ongoing sounds
    Tone.getDestination().volume.rampTo(-Infinity, 0.1);
    setTimeout(() => {
      Tone.getDestination().volume.value = 0;  // Reset volume after silence
    }, 150);
  }

  private createSound(soundId: string): InstrumentGroup {
    const definition = getSoundDefinition(soundId);
    if (definition) {
      return definition.create();
    }
    // Fallback to default synth
    return new Tone.Synth().toDestination();
  }

  private triggerSound(soundId: InstrumentGroup, note: string, startTime?: number): void {
    const sounds = Array.isArray(soundId) ? soundId : [soundId];
    const time = startTime || Tone.now();

    sounds.forEach((sound) => {
      if (sound instanceof Tone.Loop || sound instanceof Tone.Pattern) {
        // Patterns and Loops need Transport to be running
        Tone.getTransport().start();
      } else if (sound instanceof Tone.Player) {
        sound.autostart = true;
      } else if (sound instanceof Tone.Noise) {
        // Noise sources just need to be started
        sound.start();
      } else if (this.isSynthInstrument(sound)) {
        // For synths, trigger a note (generative synths trigger themselves via onsilence)
        sound.triggerAttackRelease(note, '8n', time);
      }
    });
  }

  private destroySound(soundId: InstrumentGroup): void {
    const sounds = Array.isArray(soundId) ? soundId : [soundId];

    sounds.forEach((sound) => {
      try {
        // Handle different instrument types
        if (sound instanceof Tone.Loop || sound instanceof Tone.Pattern) {
          sound.stop();
        } else if (sound instanceof Tone.Player) {
          sound.stop();
        } else if (sound instanceof Tone.Noise) {
          sound.stop();
        } else if (this.isSynthInstrument(sound)) {
          // For synths, trigger release and clear onsilence to break generative chains
          sound.triggerRelease();
          if ('onsilence' in sound) {
            sound.onsilence = () => {}; // Break the generative chain
          }
        }

        // Dispose the sounds to free resources
        sound.dispose();
      } catch (e) {
        console.warn('Error disposing sound:', e);
      }
    });
  }

  private isSynthInstrument(inst: Instrument): inst is SynthInstrument {
    return 'triggerAttackRelease' in inst;
  }

  /**
   * Synchronize local Transport with shared state from Automerge
   * This should be called when transport state updates from other users
   */
  syncTransportState(transportState: TransportState): void {
    if (this.isSyncingTransport) return; // Prevent feedback loops

    this.isSyncingTransport = true;

    try {
      const transport = Tone.getTransport();

      // Update BPM if changed
      if (transport.bpm.value !== transportState.bpm) {
        transport.bpm.value = transportState.bpm;
      }

      // Update position if changed (with small tolerance for network latency)
      if (transport.position !== transportState.position) {
        transport.position = transportState.position;
      }

      // Update play/pause state
      if (transportState.isPlaying && transport.state !== 'started') {
        transport.start();
      } else if (!transportState.isPlaying && transport.state === 'started') {
        transport.pause();
      }
    } finally {
      this.isSyncingTransport = false;
    }
  }

  /**
   * Get current transport state to share with other users
   */
  getTransportState(masterId: string): TransportState {
    const transport = Tone.getTransport();
    return {
      bpm: transport.bpm.value,
      isPlaying: transport.state === 'started',
      position: transport.position.toString(),
      lastUpdated: Date.now(),
      masterId
    };
  }

  /**
   * Initialize transport with default settings
   */
  initializeTransport(bpm: number = 120): void {
    const transport = Tone.getTransport();
    transport.bpm.value = bpm;
    transport.loop = false; // Can be changed based on your needs
  }

  /**
   * Start the transport and return new state
   */
  startTransport(masterId: string): TransportState {
    if (!this.isSyncingTransport) {
      Tone.getTransport().start();
    }
    return this.getTransportState(masterId);
  }

  /**
   * Stop/pause the transport and return new state
   */
  stopTransport(masterId: string): TransportState {
    if (!this.isSyncingTransport) {
      Tone.getTransport().pause();
    }
    return this.getTransportState(masterId);
  }

  /**
   * Update BPM and return new state
   */
  setBPM(bpm: number, masterId: string): TransportState {
    if (!this.isSyncingTransport) {
      Tone.getTransport().bpm.value = bpm;
    }
    return this.getTransportState(masterId);
  }
}

export default SoundPlayer;