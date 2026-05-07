export interface User {
  id: string;
  name?: string;
  connectedAt: number;
  lastSeen: number;
  hiddenSince?: number;
  position?: {
    lat: number;
    lng: number;
  };
}

export interface SyncedShape {
  id: string;
  type: string;
  coordinates: any;
  soundId: string | null;
  createdBy: string;
  createdAt: number;
}

// Stub type for updateTransportState — will be replaced when beatsync audio is wired
export interface TransportState {
  startTime: number | null;
  bpm: number;
  isPlaying: boolean;
  pausedPosition: number;
}
