# HereHear

A collaborative, GPS-aware map experience. Users draw zones on a shared Leaflet map; zones sync in real-time across all connected clients. Each zone is designed to carry an audio playlist that plays based on how close you physically are to the zone.

---

## Quick start

HereHear requires two services running simultaneously: the **beatsync server** (WebSocket + HTTP backend) and the **herehear client** (this Vite app).

### 1. Start the beatsync server

```bash
cd /path/to/beatsync
bun install
bun server          # starts on port 8080
```

### 2. Configure the herehear client

Create `.env` in this directory (already in `.gitignore`):

```
VITE_WS_URL=ws://localhost:8080/ws
```

### 3. Start the herehear client

```bash
npm install
npm run dev         # starts on http://localhost:5173
```

### 4. Open the app

```
http://localhost:5173
```

A room code is auto-generated and appended to the URL (`?roomId=XXXXXX`). Share the full URL with collaborators — anyone who opens it joins the same room.

---

## Joining and sharing rooms

The URL query param `?roomId=XXXXXX` is the room identifier. Rules:

- If no `?roomId` is present, a random 6-character code is generated and the URL is updated in-place.
- The same URL on different devices or browser tabs connects to the same room.
- Usernames are auto-generated on first visit and stored in `localStorage`. They can be changed via the name input in the top-right panel.
- The `clientId` that identifies your connection is also stored in `localStorage` so you keep your identity across page reloads.

---

## Architecture

```
herehear/  (this repo — Vite + React 19)
└── src/
    ├── App.tsx                  root component: GPS, user panel, mounts DrawMapZones
    ├── useBeatsyncBridge.ts     WebSocket connection + all shared state
    ├── useGeolocation.ts        browser GPS hook
    ├── automergeTypes.ts        shared TypeScript types (User, SyncedShape, TransportState)
    └── components/
        └── DrawMapZones.tsx     Leaflet map, leaflet-draw controls, zone rendering + GPS audio

beatsync/  (separate repo — Bun server)
└── apps/server/
    └── src/
        ├── managers/RoomManager.ts      per-room shapes, clients, playback state
        ├── websocket/handlers/          one file per WS action type
        └── routes/websocketHandlers.ts  WS lifecycle (open/message/close)
└── packages/shared/
    └── types/                   Zod schemas — the contract between client and server
```

### How the connection works

`useBeatsyncBridge` (in this app) opens a single WebSocket:

```
ws://localhost:8080/ws?roomId=XXXXXX&username=Alice&clientId=<uuid>
```

On open the server sends an initial state burst to the joining client:

| Message | Content |
|---|---|
| `SET_PLAYBACK_CONTROLS` | who can control playback (admin-only or everyone) |
| `GLOBAL_VOLUME_CONFIG` | current room volume |
| `CLIENT_CHANGE` | list of all connected clients with presence data |
| `SHAPES_UPDATE` | all existing shapes in the room |
| `CHAT_UPDATE` | full chat history (if any) |

After that, every mutation is event-driven in both directions.

### Shape sync flow

```
User draws on map
  └─▶ DrawMapZones: draw:created fires
        └─▶ addShape(type, coords)          — generates UUID client-side, returns immediately
              └─▶ useBeatsyncBridge: send ADD_SHAPE { id, type, coordinates, createdBy, createdAt }
                    └─▶ beatsync server: RoomManager.addShape()
                          └─▶ broadcast SHAPES_UPDATE to all clients in room
                                └─▶ useBeatsyncBridge: setShapes(...)
                                      └─▶ DrawMapZones: syncedShapes effect skips local shape
                                                        (already in processedSyncIdsRef)
                                                        confirms remote shapes → adds to map
```

The client generates the shape UUID before sending so `DrawMapZones` can track the layer immediately — no round-trip wait before the layer→ID mapping is established.

### Client presence flow

```
GPS position changes
  └─▶ App.tsx: useEffect → updateUserPosition(lat, lng)
        └─▶ send SET_GEO_POSITION { lat, lng }
              └─▶ server: updates client.geoPosition, broadcasts CLIENT_CHANGE
                    └─▶ useBeatsyncBridge: setClients(...)
                          └─▶ DrawMapZones: connectedUsers updates → user marker moves on map
```

---

## Key source files

| File | Purpose |
|---|---|
| [src/useBeatsyncBridge.ts](src/useBeatsyncBridge.ts) | WS connection, room/clientId from URL+localStorage, shape/user state, all send helpers |
| [src/App.tsx](src/App.tsx) | GPS hook wiring, user panel UI, mounts DrawMapZones with bridge callbacks |
| [src/components/DrawMapZones.tsx](src/components/DrawMapZones.tsx) | 1700-line Leaflet component: draw controls, shape-layer mapping, GPS collision detection |
| [src/automergeTypes.ts](src/automergeTypes.ts) | `User`, `SyncedShape`, `TransportState` types shared across this app |

---

## Permission model

Shape drawing and playback are gated by the room's `playbackControlsPermissions` setting (set by an admin):

- **`EVERYONE`** (default): all clients can draw shapes and control playback
- **`ADMIN_ONLY`**: only the room admin can mutate shapes or control playback

When a non-admin attempts a restricted action, the server sends a `PERMISSION_ERROR` WS message and the bridge logs a console warning. A future step will surface this as a UI toast.

The first client to join a room is automatically made admin.

---

## What is stubbed / not yet wired

The following are explicitly stubbed in `useBeatsyncBridge.ts` with `TODO` comments and will be wired in subsequent steps:

| Stub | Planned replacement |
|---|---|
| `updateShapeSound` | Per-shape beatsync audio source upload and `ADD_SHAPE_AUDIO_SOURCE` WS send |
| `updateTransportState` | Beatsync `broadcastPlay` / `broadcastPause` targeting specific shapes |
| GPS proximity gain | On `CLIENT_CHANGE`, compute distance from `geoPosition` to shape centroid, apply per-shape `GainNode` |
| Tab visibility | Send `SET_VISIBILITY` on `document.visibilitychange` |

Tone.js synthesis (`TimingSync.ts`, `SoundKit.tsx`, `SoundPlayer.tsx`) remains present but is inactive while transport state is stubbed. It will be removed when the beatsync audio pipeline is fully connected.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:8080/ws` | WebSocket URL of the beatsync server |

Set in `.env` (local dev) or your deployment environment. The `.env` file is gitignored.
