import { useEffect, useState, useCallback, useMemo } from "react";
import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { repo, getUserId } from "./automergeSetup";
import type { GPSoundDoc, SyncedShape } from "./automergeTypes";

/**
 * Custom hook that manages the Automerge document lifecycle
 * 
 * This hook:
 * 1. Checks URL for an existing document ID
 * 2. Creates a new document if none exists, or loads existing one
 * 3. Updates the URL with the document ID
 * 4. Manages user presence (adding/updating this user in the document)
 * 5. Provides the document state and connected user count
 */
export const useAutomergeDoc = () => {
  const [docUrl, setDocUrl] = useState<AutomergeUrl | null>(null);
  const [userId] = useState(() => getUserId());

  // Initialize document from URL or create new one
  useEffect(() => {
    const initializeDocument = async () => {
      // Check if there's a document ID in the URL query params
      const urlParams = new URLSearchParams(window.location.search);
      const docId = urlParams.get("doc");

      if (docId) {
        // Join existing document
        // Format: automerge:documentId
        const url = `automerge:${docId}` as AutomergeUrl;
        console.log("Joining existing document:", docId);
        setDocUrl(url);
      } else {
        // Create new document
        console.log("Creating new document...");
        const handle = repo.create<GPSoundDoc>();
        
        // Initialize the document with an empty users object
        handle.change((doc) => {
          doc.users = {};
        });

        const url = handle.url;
        setDocUrl(url);

        // Extract the document ID from the URL (format: automerge:xxxxx)
        const newDocId = url.split(":")[1];
        
        // Update the browser URL without reloading the page
        const newUrl = `${window.location.pathname}?doc=${newDocId}`;
        window.history.pushState({}, "", newUrl);
        
        console.log("Created new document:", newDocId);
        console.log("Share this URL with others to collaborate!");
      }
    };

    initializeDocument();
  }, []);

  // Use Automerge's useDocument hook to get live updates
  const [doc, changeDoc] = useDocument<GPSoundDoc>(docUrl);

  // Manage user presence: add this user and send heartbeats
  useEffect(() => {
    if (!changeDoc) return;

    // Add or update this user in the document
    const updatePresence = () => {
      changeDoc((d) => {
        if (!d.users) {
          d.users = {};
        }
        
        const now = Date.now();
        const isVisible = !document.hidden;
        
        if (!d.users[userId]) {
          // New user joining
          const newUser: any = {
            id: userId,
            connectedAt: now,
            lastSeen: now,
          };
          
          // Only set hiddenSince if tab is hidden
          if (!isVisible) {
            newUser.hiddenSince = now;
          }
          
          d.users[userId] = newUser;
        } else {
          // Update existing user's heartbeat and update hiddenSince based on visibility
          d.users[userId].lastSeen = now;
          
          // If visible now, delete hiddenSince (Automerge doesn't allow undefined)
          // If hidden now and wasn't tracking it yet, set hiddenSince
          if (isVisible) {
            if (d.users[userId].hiddenSince !== undefined) {
              delete d.users[userId].hiddenSince;
            }
          } else if (d.users[userId].hiddenSince === undefined) {
            // Only set hiddenSince if it's not already set (tab just became hidden)
            d.users[userId].hiddenSince = now;
          }
          // If already hidden, keep the original hiddenSince timestamp
        }
      });
    };

    // Initial presence update
    updatePresence();

    // Send heartbeat every 5 seconds
    // Note: Browsers will throttle this when tab is hidden (may run ~1x/minute)
    // That's okay - we account for this with a longer timeout
    const heartbeatInterval = setInterval(updatePresence, 5000);

    // Also update presence when visibility changes
    // This gives immediate feedback when users switch tabs
    const handleVisibilityChange = () => {
      updatePresence();
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup: remove user when component unmounts
    return () => {
      clearInterval(heartbeatInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Note: We're not removing the user from the document on unmount
      // In a production app, you'd want a cleanup strategy for stale users
    };
  }, [changeDoc, userId]);

  // Get list of connected users with computed isActive status
  // Use a longer timeout to account for browser throttling of background tabs
  // Browsers may throttle setInterval to ~1x per minute when tab is hidden
  // So we need to be generous with the timeout
  const connectedUsers = useMemo(() => {
    if (!doc?.users) return [];
    
    const now = Date.now();
    const DISCONNECT_TIMEOUT = 90000; // 90 seconds (1.5 minutes) - marks as disconnected
    const AWAY_DELAY = 30000; // 30 seconds - delay before marking as "away"
    
    return Object.values(doc.users)
      .filter((user) => now - user.lastSeen < DISCONNECT_TIMEOUT)
      .map((user) => {
        // Calculate if user is "active" based on hiddenSince timestamp
        // Active if: hiddenSince is undefined OR hidden for less than 30 seconds
        const isActive = user.hiddenSince === undefined || 
                        (now - user.hiddenSince < AWAY_DELAY);
        
        return {
          ...user,
          isActive, // Computed property - not stored in document
        };
      });
  }, [doc?.users]);

  // Function to update the current user's name
  const updateUserName = useCallback((name: string) => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      if (!d.users) {
        d.users = {};
      }
      if (d.users[userId]) {
        d.users[userId].name = name;
      }
    });
  }, [changeDoc, userId]);

  // Function to update the current user's position
  const updateUserPosition = useCallback((lat: number, lng: number) => {
    if (!changeDoc) return;

    changeDoc((d) => {
      if (!d.users) {
        d.users = {};
      }
      if (d.users[userId]) {
        d.users[userId].position = { lat, lng };
      }
    });
  }, [changeDoc, userId]);

  // Get all synced shapes
  const syncedShapes = useMemo(() => {
    if (!doc?.shapes) return [];
    return Object.values(doc.shapes);
  }, [doc?.shapes]);

  // Function to add a new shape to the document
  const addShape = useCallback((type: string, coordinates: any, soundId: string | null = null): string => {
    const shapeId = `shape-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    if (!changeDoc) return shapeId;
    
    changeDoc((d) => {
      if (!d.shapes) {
        d.shapes = {};
      }
      d.shapes[shapeId] = {
        id: shapeId,
        type,
        coordinates,
        soundId,
        createdBy: userId,
        createdAt: Date.now(),
      };
    });
    
    return shapeId;
  }, [changeDoc, userId]);

  // Function to update a shape's sound type
  const updateShapeSound = useCallback((shapeId: string, soundId: string | null) => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      if (d.shapes && d.shapes[shapeId]) {
        d.shapes[shapeId].soundId = soundId;
      }
    });
  }, [changeDoc]);

  // Function to update a shape's coordinates (for edit operations)
  const updateShapeCoordinates = useCallback((shapeId: string, coordinates: any) => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      if (d.shapes && d.shapes[shapeId]) {
        d.shapes[shapeId].coordinates = coordinates;
      }
    });
  }, [changeDoc]);

  // Function to delete a shape
  const deleteShape = useCallback((shapeId: string) => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      if (d.shapes && d.shapes[shapeId]) {
        delete d.shapes[shapeId];
      }
    });
  }, [changeDoc]);

  // Function to clear all shapes
  const clearAllShapes = useCallback(() => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      d.shapes = {};
    });
  }, [changeDoc]);

  // Function to update transport state (called by transport master)
  const updateTransportState = useCallback((transportState: any) => {
    if (!changeDoc) return;

    changeDoc((d) => {
      d.transport = transportState;
    });
  }, [changeDoc]);

  // Function to initialize transport if it doesn't exist
  // Returns true if this user became the master, false otherwise
  const initializeTransportIfNeeded = useCallback((): boolean => {
    if (!changeDoc || !doc) return false;

    // If transport already exists, don't initialize
    if (doc.transport) return false;

    // Initialize transport with current user as master
    changeDoc((d) => {
      if (!d.transport) {
        d.transport = {
          bpm: 120,
          isPlaying: false,
          position: "0:0:0",
          lastUpdated: Date.now(),
          masterId: userId
        };
      }
    });

    return true;
  }, [changeDoc, doc, userId]);

  return {
    doc,
    changeDoc,
    userId,
    connectedUsers,
    connectedUserCount: connectedUsers.length,
    updateUserName,
    updateUserPosition,
    syncedShapes,
    addShape,
    updateShapeSound,
    updateShapeCoordinates,
    deleteShape,
    clearAllShapes,
    updateTransportState,
    initializeTransportIfNeeded,
    isReady: !!doc,
  };
};

