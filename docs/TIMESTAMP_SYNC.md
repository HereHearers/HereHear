# Timestamp-Based Transport Synchronization

This document describes how HereHear synchronizes the Tone.js Transport across multiple clients using local device clocks and Automerge for state sharing.

## Overview

Instead of using a dedicated timing server, HereHear leverages the fact that modern devices keep their clocks synchronized via NTP (Network Time Protocol) to within a few milliseconds. By sharing a single `startTime` timestamp via Automerge, all clients can independently calculate where they should be in the Transport timeline.

## How It Works

### Shared State (via Automerge)

The transport state is minimal:

```typescript
interface TransportState {
  startTime: number | null;  // Timestamp (ms) when transport started
  bpm: number;               // Beats per minute
  isPlaying: boolean;        // Whether transport is running
}
```

### Position Calculation

Each client calculates their position independently:

```typescript
// Time elapsed since playback started
const elapsed = Date.now() - startTime;

// Convert to beats (position in the Transport timeline)
const positionInSeconds = (elapsed / 1000);

// Sync Tone.js Transport to this position
Transport.seconds = positionInSeconds;
```

### Sync Flow

1. **User clicks Play**
   - Record `startTime = Date.now()`
   - Set `isPlaying = true`
   - Push state to Automerge

2. **Other clients receive update**
   - Get `startTime` and `bpm` from Automerge
   - Calculate expected position based on elapsed time
   - Start Transport at that position

3. **Periodic drift correction**
   - Every ~500ms, recalculate expected position
   - If drift exceeds 50ms, resync Transport

4. **BPM changes**
   - Update `bpm` in Automerge
   - All clients immediately apply new BPM
   - Position calculation automatically adjusts

5. **User clicks Pause**
   - Set `isPlaying = false`, `startTime = null`
   - Push to Automerge
   - All clients stop Transport

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client A                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  UI Controls │───▶│  TimingSync  │───▶│   Tone.js    │  │
│  │  (Play/BPM)  │    │   (calc pos) │    │  Transport   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   ▲                               │
│         │                   │                               │
│         ▼                   │                               │
│  ┌──────────────────────────┴───────────────────────────┐  │
│  │                    Automerge                          │  │
│  │         { startTime, bpm, isPlaying }                 │  │
│  └──────────────────────────┬───────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              │
                    (Automerge sync)
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                        Client B                              │
│  ┌──────────────────────────┴───────────────────────────┐  │
│  │                    Automerge                          │  │
│  │         { startTime, bpm, isPlaying }                 │  │
│  └──────────────────────────┬───────────────────────────┘  │
│         │                   │                               │
│         ▼                   ▼                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  UI Controls │    │  TimingSync  │───▶│   Tone.js    │  │
│  │  (reflects)  │    │   (calc pos) │    │  Transport   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### TimingSync.ts

Singleton class that manages synchronization:

- `initialize(bpm)` - Sets up the sync loop
- `play()` - Records startTime, returns state for Automerge
- `pause()` - Clears startTime, returns state for Automerge
- `setBPM(bpm)` - Updates BPM, returns state for Automerge
- `syncFromRemote(state)` - Applies state from Automerge
- `syncToTransport()` - Periodic drift correction

### Drift Correction

The sync loop runs every ~500ms with slight jitter to prevent all clients from syncing simultaneously:

```typescript
const baseInterval = 500;
const jitterRange = 100;
const interval = baseInterval + (Math.random() * jitterRange * 2 - jitterRange);
// Results in 400-600ms intervals
```

If drift exceeds 50ms, the Transport position is corrected:

```typescript
const expectedPosition = (elapsed / 1000) * (bpm / 60);
const currentPosition = transport.seconds;
const drift = Math.abs(currentPosition - expectedPosition);

if (drift > 0.05) {  // 50ms threshold
    transport.seconds = expectedPosition;
}
```

## Why This Approach?

### Advantages

1. **No external server** - No timing-provider server needed
2. **Simple** - Just timestamps and basic math
3. **Reliable** - NTP keeps clocks within milliseconds
4. **Uses existing infrastructure** - Automerge already syncs state
5. **Fault tolerant** - Each client independently calculates position

### Limitations

1. **Clock skew** - If a device's clock is significantly off, sync will be affected
2. **Network latency** - Automerge sync delay affects how quickly changes propagate
3. **No sub-millisecond precision** - Fine for musical sync, not for scientific applications

## What Gets Synced

| Action | Synced via Automerge |
|--------|---------------------|
| Play | `startTime`, `isPlaying` |
| Pause | `startTime=null`, `isPlaying` |
| BPM change | `bpm` |
| Transport position | Calculated locally, not synced |

## Sounds That Respond to Transport

Only sounds scheduled on the Transport timeline respond to these controls:

- `Tone.Loop` - Repeating patterns
- `Tone.Pattern` - Arpeggiators, sequences
- `Tone.Part` - Scheduled musical parts
- `Tone.Sequence` - Step sequencers

Sounds triggered with `triggerAttackRelease()` play immediately and are NOT affected by Transport play/pause/BPM.

## TODO: check with transport re beats for time