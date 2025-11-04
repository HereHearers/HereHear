import Flatten from 'flatten-js';

export interface SoundConfig {
  soundType: string;
  note: string;
}

export interface DrawnLayer {
    id: number;
    type: string;
    coordinates: any;
    soundType: string | null;
}

export type DrawnShape = Flatten.Circle | Flatten.Polygon;