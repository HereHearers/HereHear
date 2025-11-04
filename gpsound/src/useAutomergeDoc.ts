import { useEffect, useState } from "react";
import { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { repo, getUserId } from "./automergeSetup";
import type { GPSoundDoc } from "./automergeTypes";

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
    if (!doc || !changeDoc) return;

    // Add or update this user in the document
    const updatePresence = () => {
      changeDoc((d) => {
        if (!d.users) {
          d.users = {};
        }
        
        const now = Date.now();
        
        if (!d.users[userId]) {
          // New user joining
          d.users[userId] = {
            id: userId,
            connectedAt: now,
            lastSeen: now,
          };
          console.log("User joined:", userId);
        } else {
          // Update existing user's heartbeat
          d.users[userId].lastSeen = now;
        }
      });
    };

    // Initial presence update
    updatePresence();

    // Send heartbeat every 5 seconds to show we're still connected
    const heartbeatInterval = setInterval(updatePresence, 5000);

    // Cleanup: remove user when component unmounts
    return () => {
      clearInterval(heartbeatInterval);
      // Note: We're not removing the user from the document on unmount
      // In a production app, you'd want a cleanup strategy for stale users
    };
  }, [doc, changeDoc, userId]);

  // Get list of connected users
  // Consider a user connected if their last heartbeat was within 10 seconds
  const connectedUsers = (() => {
    if (!doc?.users) return [];
    
    const now = Date.now();
    const TIMEOUT = 10000; // 10 seconds
    
    return Object.values(doc.users).filter(
      (user) => now - user.lastSeen < TIMEOUT
    );
  })();

  // Function to update the current user's name
  const updateUserName = (name: string) => {
    if (!changeDoc) return;
    
    changeDoc((d) => {
      if (!d.users) {
        d.users = {};
      }
      if (d.users[userId]) {
        d.users[userId].name = name;
      }
    });
  };

  return {
    doc,
    changeDoc,
    userId,
    connectedUsers,
    connectedUserCount: connectedUsers.length,
    updateUserName,
    isReady: !!doc,
  };
};

