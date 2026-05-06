import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { User, SyncedShape, TransportState } from './automergeTypes';

// ── Beatsync wire types (inlined — avoids @beatsync/shared dependency) ────────

type BeatsyncShape = {
  id: string;
  type: string;
  coordinates: unknown;
  createdBy: string;
  createdAt: number;
};

type BeatsyncShapeState = {
  shape: BeatsyncShape;
  audioSources: { url: string; name: string }[];
  playbackState: {
    type: 'playing' | 'paused';
    audioSource: string;
    serverTimeToExecute: number;
    trackPositionSeconds: number;
  };
};

type BeatsyncClient = {
  clientId: string;
  username: string;
  geoPosition?: { lat: number; lng: number };
  isHidden: boolean;
  joinedAt: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws';

function stableString(key: string, init: () => string): string {
  const stored = localStorage.getItem(key);
  if (stored !== null) return stored;
  const value = init();
  localStorage.setItem(key, value);
  return value;
}

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateUsername(): string {
  return `User${Math.floor(Math.random() * 9000) + 1000}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBeatsyncBridge() {
  const [shapes, setShapes] = useState<BeatsyncShapeState[]>([]);
  const [clients, setClients] = useState<BeatsyncClient[]>([]);
  const [isReady, setIsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Stable identity — created once, persisted to localStorage
  const [roomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const existing = params.get('roomId');
    if (existing) return existing;
    const code = generateRoomCode();
    window.history.replaceState({}, '', `?roomId=${code}`);
    return code;
  });

  const [clientId] = useState<string>(() =>
    stableString('herehear-clientId', () => crypto.randomUUID())
  );

  const [username, setUsername] = useState<string>(() =>
    stableString('herehear-username', generateUsername)
  );

  // ── Send helper ─────────────────────────────────────────────────────────────

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // ── Shape mutations ─────────────────────────────────────────────────────────

  const addShape = useCallback(
    (type: string, coordinates: unknown, _soundId: string | null = null): string => {
      const id = crypto.randomUUID();
      send({
        type: 'ADD_SHAPE',
        shape: { id, type, coordinates, createdBy: clientId, createdAt: Date.now() },
      });
      return id;
    },
    [send, clientId]
  );

  const updateShapeCoordinates = useCallback(
    (shapeId: string, coordinates: unknown) => {
      send({ type: 'UPDATE_SHAPE', shapeId, coordinates });
    },
    [send]
  );

  const deleteShape = useCallback(
    (shapeId: string) => {
      send({ type: 'DELETE_SHAPE', shapeId });
    },
    [send]
  );

  const clearAllShapes = useCallback(() => {
    send({ type: 'CLEAR_SHAPES' });
  }, [send]);

  // ── Presence ────────────────────────────────────────────────────────────────

  const updateUserPosition = useCallback(
    (lat: number, lng: number) => {
      send({ type: 'SET_GEO_POSITION', lat, lng });
    },
    [send]
  );

  const updateUserName = useCallback((name: string) => {
    localStorage.setItem('herehear-username', name);
    setUsername(name);
  }, []);

  // ── Stubs (Tone.js / beatsync audio wired in later steps) ──────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateShapeSound = useCallback((_shapeId: string, _soundId: string | null) => {
    // TODO: wire to per-shape beatsync audio sources
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateTransportState = useCallback((_state: TransportState) => {
    // TODO: wire to beatsync broadcastPlay / broadcastPause
  }, []);

  // ── Type-adapted views for DrawMapZones compatibility ───────────────────────

  const syncedShapes = useMemo<SyncedShape[]>(
    () =>
      shapes.map((ss) => ({
        id: ss.shape.id,
        type: ss.shape.type,
        coordinates: ss.shape.coordinates,
        soundId: null,
        createdBy: ss.shape.createdBy,
        createdAt: ss.shape.createdAt,
      })),
    [shapes]
  );

  const connectedUsers = useMemo<(User & { isActive: boolean })[]>(
    () =>
      clients.map((c) => ({
        id: c.clientId,
        name: c.username,
        connectedAt: c.joinedAt,
        lastSeen: c.joinedAt,
        position: c.geoPosition,
        isActive: !c.isHidden,
      })),
    [clients]
  );

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    const url = `${WS_URL}?roomId=${roomId}&username=${encodeURIComponent(username)}&clientId=${clientId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[beatsync] connected to room', roomId);
      setIsReady(true);
    };

    ws.onclose = () => {
      console.log('[beatsync] disconnected');
      setIsReady(false);
    };

    ws.onerror = (e) => console.error('[beatsync] WS error', e);

    ws.onmessage = ({ data }) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data as string);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
      const m = msg as Record<string, unknown>;

      if (m['type'] === 'ROOM_EVENT') {
        const ev = m['event'] as Record<string, unknown> | undefined;
        if (!ev) return;
        if (ev['type'] === 'CLIENT_CHANGE') {
          setClients((ev['clients'] as BeatsyncClient[]) ?? []);
        } else if (ev['type'] === 'SHAPES_UPDATE') {
          setShapes((ev['shapes'] as BeatsyncShapeState[]) ?? []);
        }
      } else if (m['type'] === 'PERMISSION_ERROR') {
        console.warn('[beatsync] permission denied — action:', m['action'], '—', m['message']);
      }
    };

    return () => {
      ws.onclose = () => {};
      ws.close();
      wsRef.current = null;
      setIsReady(false);
    };
  }, [roomId, clientId, username]);

  return {
    roomId,
    userId: clientId,
    username,
    isReady,
    connectedUsers,
    connectedUserCount: clients.length,
    syncedShapes,
    addShape,
    updateShapeSound,
    updateShapeCoordinates,
    deleteShape,
    clearAllShapes,
    updateUserPosition,
    updateUserName,
    updateTransportState,
  };
}
