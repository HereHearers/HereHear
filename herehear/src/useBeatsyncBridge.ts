import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { User, SyncedShape, TransportState } from './types';

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

// ── Reconnection constants ────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 15;
const INITIAL_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 10000;
const CONNECTION_TIMEOUT_MS = 5000; // detect Safari/iOS silent drops

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
  return Math.random().toString(36).substring(2, 8).padEnd(6, '0').toUpperCase();
}

function generateUsername(): string {
  return `User${Math.floor(Math.random() * 9000) + 1000}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBeatsyncBridge() {
  const [shapes, setShapes] = useState<BeatsyncShapeState[]>([]);
  const [clients, setClients] = useState<BeatsyncClient[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingQueueRef = useRef<unknown[]>([]);

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
    } else {
      pendingQueueRef.current.push(msg);
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

  // ── WebSocket lifecycle with reconnection ───────────────────────────────────

  useEffect(() => {
    let intentionalClose = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (connectionTimer) { clearTimeout(connectionTimer); connectionTimer = null; }
    };

    const scheduleReconnect = () => {
      clearTimers();
      reconnectAttempts++;
      setIsReconnecting(true);
      setReconnectAttempt(reconnectAttempts);

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[beatsync] max reconnection attempts reached — giving up');
        setIsReconnecting(false);
        return;
      }

      // Exponential backoff with ±15% jitter to avoid thundering herd
      const base = Math.min(
        INITIAL_INTERVAL_MS * Math.pow(1.1, reconnectAttempts - 1),
        MAX_INTERVAL_MS
      );
      const delay = base + Math.random() * 0.15 * base;
      console.log(`[beatsync] reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      reconnectTimer = setTimeout(connect, delay);
    };

    // Declared as function so scheduleReconnect can reference it before it's
    // defined (mutual recursion within the same effect scope).
    function connect() {
      const url = `${WS_URL}?roomId=${roomId}&username=${encodeURIComponent(username)}&clientId=${clientId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // Detect Safari/iOS silent drops — if the socket hasn't opened within
      // CONNECTION_TIMEOUT_MS, treat it as a failed attempt and retry.
      connectionTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('[beatsync] connection timeout — server unreachable, retrying');
          ws.onclose = () => {};
          ws.close();
          scheduleReconnect();
        }
      }, CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimers();
        reconnectAttempts = 0;
        console.log('[beatsync] connected to room', roomId);

        const pending = pendingQueueRef.current.splice(0);
        if (pending.length > 0) {
          console.log(`[beatsync] draining ${pending.length} queued message(s)`);
          for (const msg of pending) ws.send(JSON.stringify(msg));
        }

        setIsReady(true);
        setIsReconnecting(false);
        setReconnectAttempt(0);
      };

      ws.onclose = () => {
        setIsReady(false);
        if (!intentionalClose) {
          console.log('[beatsync] connection lost — scheduling reconnect');
          scheduleReconnect();
        }
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
    }

    connect();

    return () => {
      intentionalClose = true;
      clearTimers();
      pendingQueueRef.current = [];
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = () => {};
        ws.close();
        wsRef.current = null;
      }
      setIsReady(false);
      setIsReconnecting(false);
      setReconnectAttempt(0);
    };
  }, [roomId, clientId, username]);

  return {
    roomId,
    userId: clientId,
    username,
    isReady,
    isReconnecting,
    reconnectAttempt,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
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
