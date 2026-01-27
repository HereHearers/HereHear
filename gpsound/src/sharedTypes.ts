import Flatten from 'flatten-js';

export interface SoundConfig {
  soundId: string;
  note: string;
  volume?: number;  // Optional volume (0-1 range)
}

export interface DrawnLayer {
    id: number;
    type: string;
    coordinates: any;
    soundId: string | null;
}

export type DrawnShape = Flatten.Circle | Flatten.Polygon;