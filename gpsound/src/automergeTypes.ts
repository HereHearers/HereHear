/**
 * TypeScript types for our Automerge document structure
 * 
 * Automerge documents are CRDT (Conflict-free Replicated Data Types)
 * which means multiple users can edit them simultaneously without conflicts
 */

// Represents a single connected user
export interface User {
  id: string;
  name?: string; // user's display name (optional)
  connectedAt: number; // timestamp
  lastSeen: number; // timestamp for heartbeat
  hiddenSince?: number; // timestamp when tab became hidden (undefined if visible)
  position?: {
    lat: number;
    lng: number;
  };
}

// Represents a shape/zone on the map
export interface SyncedShape {
  id: string; // Unique identifier (string for CRDT compatibility)
  type: string; // 'polygon', 'circle', 'rectangle', 'circlemarker'
  coordinates: any; // Raw coordinates from Leaflet
  soundId: string | null; // Associated sound (null if none)
  createdBy: string; // User ID who created this shape
  createdAt: number; // Timestamp
}

// Shared Transport state for synchronized playback across all users
// Uses timestamp-based sync: all clients calculate position from startTime
export interface TransportState {
  startTime: number | null; // Timestamp (ms) when transport started (null when stopped)
  bpm: number; // Beats per minute (tempo)
  isPlaying: boolean; // Whether transport is currently playing
}

// The root structure of our shared Automerge document
export interface HereHearDoc {
  // Map of user IDs to User objects
  // We use a map so each user can update their own entry independently
  users?: { [userId: string]: User };

  // Shared transport state for synchronized playback
  transport?: TransportState;

  // Map of shape IDs to Shape objects
  // All users see the same shapes and can edit/delete them
  shapes?: { [shapeId: string]: SyncedShape };
}

