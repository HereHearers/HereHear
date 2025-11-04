import * as Tone from 'tone';
import { type SoundConfig } from '../sharedTypes';
import { getInstrumentDefinition } from './instrumentConfig';

type SynthInstrument = Tone.Synth | Tone.FMSynth | Tone.AMSynth | Tone.MonoSynth | Tone.MembraneSynth;
type Instrument = SynthInstrument | Tone.Loop | Tone.Player;
type InstrumentGroup = Instrument | Instrument[];

export class SoundPlayer {
  private static instance: SoundPlayer;
  private activeInstruments: InstrumentGroup[] = [];

  static getInstance(): SoundPlayer {
    if (!SoundPlayer.instance) {
      SoundPlayer.instance = new SoundPlayer();
    }
    return SoundPlayer.instance;
  }

  async playSingle(soundType: string, note: string): Promise<void> {
    await Tone.start();
    const timeLimit = 4000;
    
    const instrument = this.createInstrument(soundType);
    this.triggerInstrument(instrument, note);
    
    setTimeout(() => {
      this.destroyInstrument(instrument);
    }, timeLimit);
  }

  async playMultiple(sounds: SoundConfig[]): Promise<void> {
    await Tone.start();
    
    this.stopAll();
    
    const synthConfigs = sounds.map(({ soundType, note }) => {
      const instrument = this.createInstrument(soundType);
      this.activeInstruments.push(instrument);
      return { instrument, note };
    });
    
    const startTime = Tone.now() + 0.1;
    
    synthConfigs.forEach(({ instrument, note }) => {
      this.triggerInstrument(instrument, note, startTime);
    });
  }

  stopAll(): void {
    this.activeInstruments.forEach(instrument => {
      this.destroyInstrument(instrument);
    });
    this.activeInstruments = [];
  }

  private createInstrument(soundType: string): InstrumentGroup {
    const definition = getInstrumentDefinition(soundType);
    if (definition) {
      return definition.create();
    }
    // Fallback to default synth
    return new Tone.Synth().toDestination();
  }

  private triggerInstrument(instrument: InstrumentGroup, note: string, startTime?: number): void {
    const instruments = Array.isArray(instrument) ? instrument : [instrument];
    const time = startTime || Tone.now();
    
    instruments.forEach((inst) => {
      if (inst instanceof Tone.Loop) {
        Tone.getTransport().start();
      } else if (inst instanceof Tone.Player) {
        inst.autostart = true;
      } else if (this.isSynthInstrument(inst)) {
        inst.triggerAttackRelease(note, '8n', time);
      }
    });
  }

  private destroyInstrument(instrument: InstrumentGroup): void {
    const instruments = Array.isArray(instrument) ? instrument : [instrument];
    
    instruments.forEach((inst) => {
      try {
        if (inst instanceof Tone.Loop) {
          inst.stop();
          Tone.getTransport().stop();
        }
        inst.dispose();
      } catch (e) {
        console.warn('Error disposing instrument:', e);
      }
    });
  }

  private isSynthInstrument(inst: Instrument): inst is SynthInstrument {
    return 'triggerAttackRelease' in inst;
  }
}

export default SoundPlayer;