import * as Tone from 'tone';

export interface InstrumentDefinition {
  id: string;
  name: string;
  defaultNote: string;
  create: () => Instrument | Instrument[];
}

type SynthInstrument = Tone.Synth | Tone.FMSynth | Tone.AMSynth | Tone.MonoSynth | Tone.MembraneSynth;
type Instrument = SynthInstrument | Tone.Loop | Tone.Player;

export const INSTRUMENT_DEFINITIONS: InstrumentDefinition[] = [
  {
    id: 'fm-synth',
    name: 'FM Synth',
    defaultNote: 'C4',
    create: () => new Tone.FMSynth().toDestination()
  },
  {
    id: 'am-synth',
    name: 'AM Synth',
    defaultNote: 'G4',
    create: () => new Tone.AMSynth().toDestination()
  },
  {
    id: 'bass',
    name: 'Bass',
    defaultNote: 'C2',
    create: () => new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.1, decay: 0.3, sustain: 0.3, release: 0.8 }
    }).toDestination()
  },
  {
    id: 'lead',
    name: 'Lead',
    defaultNote: 'C5',
    create: () => new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.2, release: 0.4 }
    }).toDestination()
  },
  {
    id: 'drum',
    name: 'Drum Hit',
    defaultNote: 'C3',
    create: () => new Tone.MembraneSynth().toDestination()
  },
  {
    id: 'beat_loop',
    name: 'Beat Loop',
    defaultNote: 'C4',
    create: () => {
      const player = new Tone.Player("https://tonejs.github.io/audio/drum-samples/loops/blueyellow.mp3").toDestination();
      player.loop = true;
      return player;
    }
  },
  {
    id: 'organ_loop',
    name: 'Organ Loop',
    defaultNote: 'C4',
    create: () => {
      const player = new Tone.Player("https://tonejs.github.io/audio/drum-samples/loops/organ-echo-chords.mp3").toDestination();
      player.loop = true;
      return player;
    }
  },
  {
    id: 'test',
    name: 'Combo Synth',
    defaultNote: 'C4',
    create: () => {
      const synthA = new Tone.FMSynth().toDestination();
      const synthB = new Tone.AMSynth().toDestination();
      const loopA = new Tone.Loop((time) => {
        synthA.triggerAttackRelease("D2", "8n", time);
      }, "4n").start(0);
      const loopB = new Tone.Loop((time) => {
        synthB.triggerAttackRelease("A2", "8n", time);
      }, "4n").start("8n");
      return [loopA, loopB];
    }
  }
];

// Helper to get instrument definition by id
export function getInstrumentDefinition(id: string): InstrumentDefinition | undefined {
  return INSTRUMENT_DEFINITIONS.find(def => def.id === id);
}