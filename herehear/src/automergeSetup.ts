import { Repo } from "@automerge/automerge-repo";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

/**
 * This file sets up the Automerge repository that will handle document syncing
 * across multiple users.
 * 
 * Key concepts:
 * - Repo: The main Automerge repository that manages documents
 * - BrowserWebSocketClientAdapter: Connects to a sync server via WebSocket
 */

// Create the Automerge repository
// The repository is the central hub that manages documents and syncing
export const repo = new Repo({
  // Network adapter - connects to Automerge's demo sync server
  // This allows multiple clients to sync their changes in real-time
  network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
});

// Generate a unique user ID for this browser session
// We use a random ID to identify each user in the presence system
export const generateUserId = (): string => {
  return `user-${Math.random().toString(36).substring(2, 11)}`;
};

// Get or create a persistent user ID stored in sessionStorage
// This ensures the same user keeps the same ID during their session
export const getUserId = (): string => {
  let userId = sessionStorage.getItem("automerge-user-id");
  if (!userId) {
    userId = generateUserId();
    sessionStorage.setItem("automerge-user-id", userId);
  }
  return userId;
};

