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

// The root structure of our shared Automerge document
export interface GPSoundDoc {
  // Map of user IDs to User objects
  // We use a map so each user can update their own entry independently
  users?: { [userId: string]: User };
  
  // Future fields will go here:
  // - Map zones/shapes
  // - Sound configurations
  // - User positions
}

