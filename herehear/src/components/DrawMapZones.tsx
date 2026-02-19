import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet-draw';
import Flatten from 'flatten-js';
import SoundKit from './SoundKit';
import SoundPlayer from './SoundPlayer';
import { SOUND_DEFINITIONS } from './instrumentConfig';
import type { DrawnLayer, DrawnShape, SoundConfig } from '../sharedTypes';
import type { User, SyncedShape, TransportState } from '../automergeTypes';
import { TimingSync } from './TimingSync';
import type { LocationMode } from '../useGeolocation';

// Fix for default markers
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// TODO: remove vestigial marker logic

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

interface SoundDropdownState {
    show: boolean;
    position: { x: number; y: number };
    shapeId: number | null;
    soundId: string | null;
}

interface ConvertedCoords {
    x: number;
    y: number;
}

interface DrawMapZonesProps {
    connectedUsers: (User & { isActive: boolean })[];
    currentUserId: string;
    updateUserPosition: (lat: number, lng: number) => void;
    syncedShapes: SyncedShape[];
    addShape: (type: string, coordinates: any, soundId?: string | null) => string;
    updateShapeSound: (shapeId: string, soundId: string | null) => void;
    updateShapeCoordinates: (shapeId: string, coordinates: any) => void;
    deleteShape: (shapeId: string) => void;
    clearAllShapes: () => void;
    locationMode: LocationMode;
    transportState?: TransportState;
    updateTransportState: (state: TransportState) => void;
}

const DrawMapZones = ({
    connectedUsers,
    currentUserId,
    updateUserPosition,
    syncedShapes,
    addShape,
    updateShapeSound,
    updateShapeCoordinates,
    deleteShape,
    clearAllShapes,
    locationMode,
    transportState,
    updateTransportState
}: DrawMapZonesProps) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const [mapLoc, ] = useState<L.LatLngTuple>([42.308606, -83.747036]);
    const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
    const [drawnShapes, setDrawnShapes] = useState<DrawnShape[]>([]);
    const shapeMetadataRef = useRef(new Map<DrawnShape, DrawnLayer>());
    const markerMetadataRef = useRef(new Map<Flatten.Point, DrawnLayer>());
    const [soundDropdown, setSoundDropdown] = useState<SoundDropdownState>({
        show: false,
        position: { x: 0, y: 0 },
        shapeId: null,
        soundId: null
    });
    const [showDebugSounds, setShowDebugSounds] = useState(false);
    const [debugMode, setDebugMode] = useState(false);
    const [playingSounds, setplayingSounds] = useState<Set<string>>(new Set());
    let {point} = Flatten;
    
    // Track user markers (userId -> L.Marker)
    const userMarkersRef = useRef<Map<string, L.Marker>>(new Map());
    // Track if the current user's marker is being dragged
    const isDraggingRef = useRef<boolean>(false);
    // Track if audio is enabled
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    // Track currently playing sounds to avoid unnecessary restarts
    const currentSoundsRef = useRef<string>('');
    // Map sync shape IDs to Leaflet layers for bidirectional lookup
    const syncIdToLayerRef = useRef<Map<string, L.Layer>>(new Map());
    const layerToSyncIdRef = useRef<Map<L.Layer, string>>(new Map());
    // Track synced shape IDs we've already processed (from Automerge sync)
    const processedSyncIdsRef = useRef<Set<string>>(new Set());
    // Track shapes created locally that are pending Automerge confirmation
    const pendingLocalShapesRef = useRef<Set<string>>(new Set());

    // timing sync state
    const [timingSyncReady, setTimingSyncReady] = useState(false);
    const [timingSyncError, setTimingSyncError] = useState<string | null>(null);
    
    // Track last location update time
    const lastCalculationRef = useRef<number>(0);
    const THROTTLE_MS = 500; // Calculate at most once per 0.5s

    // Refs for Automerge functions to avoid stale closures in event handlers
    const addShapeRef = useRef(addShape);
    const deleteShapeRef = useRef(deleteShape);
    const syncedShapesRef = useRef(syncedShapes);
    
    // Keep refs up to date
    useEffect(() => {
        addShapeRef.current = addShape;
        deleteShapeRef.current = deleteShape;
        syncedShapesRef.current = syncedShapes;
    }, [addShape, deleteShape, syncedShapes]);

    // Initialize TimingSync when audio is enabled
    useEffect(() => {
        if (!isAudioEnabled || timingSyncReady) return;

        const initializeTiming = async () => {
            try {
                const timingSync = TimingSync.getInstance();

                console.log('Initializing TimingSync with timestamp-based sync...');
                await timingSync.initialize(120);
                setTimingSyncReady(true);
                console.log('TimingSync ready!');

                // Start Tone.js audio context
                const soundPlayer = SoundPlayer.getInstance();
                await soundPlayer.initializeTransport(120);

                // Sync from Automerge if transport state exists
                if (transportState) {
                    timingSync.syncFromRemote(transportState);
                    setCurrentBPM(transportState.bpm);
                    console.log('Synced to existing transport state:', transportState);
                }

                // Register callback to update UI when BPM changes from other clients
                timingSync.onBpmChange((newBpm) => {
                    console.log('BPM changed remotely to:', newBpm);
                    setCurrentBPM(newBpm);
                });

            } catch (error) {
                console.error('Failed to initialize TimingSync:', error);
                setTimingSyncError('Failed to initialize timing sync');
            }
        };

        initializeTiming();
    }, [isAudioEnabled, timingSyncReady, transportState]);

    // Sync from remote Automerge transport state changes
    useEffect(() => {
        if (!isAudioEnabled || !timingSyncReady || !transportState) return;

        const timingSync = TimingSync.getInstance();
        timingSync.syncFromRemote(transportState);
        setCurrentBPM(transportState.bpm);
    }, [transportState, isAudioEnabled, timingSyncReady]);


    // Track current BPM for UI
    const [currentBPM, setCurrentBPM] = useState(120);
    // Track if transport controls are visible
    const [showTransportControls, setShowTransportControls] = useState(false);
    // Track if zone management menu is visible
    const [showZoneManagement, setShowZoneManagement] = useState(false);
    
    // handling state updates for shapes
    const addUpdateShapeMeta = (k: DrawnShape, v: DrawnLayer) => {
        shapeMetadataRef.current.set(k, v);
    }
    const removeShapeFromState = (shapeToRemove: DrawnShape) => {
        // Remove from metadata
        shapeMetadataRef.current.delete(shapeToRemove);
        // Remove from state
        setDrawnShapes(prev => prev.filter(shape => shape !== shapeToRemove));
    };

    const getShapeByID = (shapeId: number) => {
        for (const [marker, metadata] of shapeMetadataRef.current.entries()) {
            if (metadata.id === shapeId) {
                return marker;
            }
        }
        return null;
    }

    useEffect(() => {
        if (!mapRef.current || mapInstanceRef.current) return;

        // var gulestan: L.LatLngTuple = [42.308606, -83.747036];

        const map = L.map(mapRef.current, {
            maxZoom: 23
        }).setView(mapLoc, 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 23,
            maxNativeZoom: 19
        }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 23,
            maxNativeZoom: 19
        }).addTo(map);

        const drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        const drawControl = new L.Control.Draw({
            draw: {
                polyline: false,
                marker: false, // Disable marker tool - using user markers instead
            },
            edit: {
                featureGroup: drawnItems,
            }
        });
        map.addControl(drawControl);
        L.control.scale().addTo(map);
        mapInstanceRef.current = map;
        drawnItemsRef.current = drawnItems;

        map.on(L.Draw.Event.CREATED, function (event: any) {
            const layer = event.layer;
            const type = event.layerType;
            
            // Skip markers - we use user markers instead
            if (type === 'marker') return;
            
            drawnItems.addLayer(layer);

            const shapeCoor = getCoordinates(layer, type);
            const flatShape = flattenShape(type, shapeCoor);

            // Sync to Automerge and get the sync ID (use ref to avoid stale closure)
            const syncId = addShapeRef.current(type, shapeCoor, null);
            
            // Track the mapping between sync ID and layer
            syncIdToLayerRef.current.set(syncId, layer);
            layerToSyncIdRef.current.set(layer, syncId);
            processedSyncIdsRef.current.add(syncId);
            // Mark as locally created, pending Automerge confirmation
            pendingLocalShapesRef.current.add(syncId);

            const shapeInfo: DrawnLayer = {
                    id: L.stamp(layer), // Local ID for internal use
                    type: type,
                    coordinates: shapeCoor,
                    soundId: null
            }

            // Add to local state
            if (flatShape instanceof Flatten.Circle || flatShape instanceof Flatten.Polygon) {
                addUpdateShapeMeta(flatShape, shapeInfo);
                setDrawnShapes(prev => [...prev, flatShape]);
            }

            // Add click handler to the new shape
            if (flatShape !== null) {
                layer.on('click', function (e: any) {
                    if (!mapInstanceRef.current) return;
                    const containerPoint = map.mouseEventToContainerPoint(e.originalEvent);
                    
                    // Get sound type from synced shapes (use ref to avoid stale closure)
                    const syncedShape = syncedShapesRef.current.find(s => s.id === syncId);
                    const currentsoundId = syncedShape?.soundId || null;

                    setSoundDropdown({
                        show: true,
                        position: { x: containerPoint.x, y: containerPoint.y },
                        shapeId: syncId as any, // Use sync ID for sound selection
                        soundId: currentsoundId
                    });
                });
                console.log('Shape created and synced:', syncId, type);
            }
        });

        // TODO UPDATE SHAPE, MARKER, and METADATA STATE HERE:
        map.on(L.Draw.Event.DELETED, function (e: any) {
            var deletedLayers = e.layers;
            deletedLayers.eachLayer(function (layer: any) {
                // Get sync ID from layer
                const syncId = layerToSyncIdRef.current.get(layer);
                
                if (syncId) {
                    // Delete from Automerge (use ref to avoid stale closure)
                    deleteShapeRef.current(syncId);
                    
                    // Clean up mappings
                    syncIdToLayerRef.current.delete(syncId);
                    layerToSyncIdRef.current.delete(layer);
                    processedSyncIdsRef.current.delete(syncId);
                    pendingLocalShapesRef.current.delete(syncId);
                    
                    console.log('Shape deleted and synced:', syncId);
                }
                
                // Also remove from local state
                const leafletId = L.stamp(layer);
                const shapeToRemove = getShapeByID(leafletId);
                if (shapeToRemove) {
                    removeShapeFromState(shapeToRemove);
                }
            });
        });

        // Close dropdown when clicking on map
        map.on('click', function (e: any) {
            // Only close if not clicking on a shape
            if (!e.originalEvent.target.closest('.leaflet-interactive')) {
                setSoundDropdown(prev => ({ ...prev, show: false }));
            }
        });

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []);

    // Function to create a custom icon with username label
    const createUserIcon = (username: string, isCurrentUser: boolean, locMode?: LocationMode) => {
        const color = isCurrentUser ? '#3b82f6' : '#10b981'; // Blue for current user, green for others
        const borderColor = isCurrentUser ? '#fbbf24' : 'white'; // Gold for current user, white for others
        const showGpsIndicator = isCurrentUser && locMode === 'gps';
        
        const iconHtml = `
            <div style="position: relative;">
                <div style="
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    background-color: ${color};
                    border: 3px solid ${borderColor};
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    color: white;
                    font-size: 14px;
                ">
                    ${username.substring(0, 1).toUpperCase()}
                </div>
                ${showGpsIndicator ? `
                <div style="
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 14px;
                    height: 14px;
                    background-color: #22c55e;
                    border-radius: 50%;
                    border: 2px solid white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 8px;
                ">
                    📍
                </div>
                ` : ''}
                <div style="
                    position: absolute;
                    top: 35px;
                    left: 50%;
                    transform: translateX(-50%);
                    background-color: rgba(0, 0, 0, 0.75);
                    color: white;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 11px;
                    white-space: nowrap;
                    pointer-events: none;
                ">
                    ${username}${isCurrentUser ? ' (you)' : ''}${showGpsIndicator ? ' 📍' : ''}
                </div>
            </div>
        `;
        
        return L.divIcon({
            html: iconHtml,
            className: 'user-marker-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
        });
    };

    // Manage user markers based on connected users
    useEffect(() => {
        if (!mapInstanceRef.current) return;
        
        const map = mapInstanceRef.current;
        const currentUserMarkers = userMarkersRef.current;
        
        // Track which users we've processed
        const processedUserIds = new Set<string>();
        
        // Add or update markers for all connected users
        connectedUsers.forEach(user => {
            processedUserIds.add(user.id);
            
            const isCurrentUser = user.id === currentUserId;
            const username = user.name || 'Anonymous';
            // Only allow dragging for current user in manual mode
            const canDrag = isCurrentUser && locationMode === 'manual';
            
            // Check if marker already exists
            let marker = currentUserMarkers.get(user.id);
            
            if (marker) {
                // Update existing marker
                // Skip all updates if currently being dragged by this user
                if (!(isCurrentUser && isDraggingRef.current)) {
                    // Update position
                    if (user.position) {
                        marker.setLatLng([user.position.lat, user.position.lng]);
                    }
                    // Update icon (in case username changed)
                    marker.setIcon(createUserIcon(username, isCurrentUser, locationMode));
                    
                    // Update draggable state based on location mode
                    if (isCurrentUser) {
                        if (canDrag && !marker.dragging?.enabled()) {
                            marker.dragging?.enable();
                        } else if (!canDrag && marker.dragging?.enabled()) {
                            marker.dragging?.disable();
                        }
                    }
                }
            } else {
                // Create new marker
                const position: L.LatLngTuple = user.position 
                    ? [user.position.lat, user.position.lng]
                    : [mapLoc[0], mapLoc[1]]; // Default to map center if no position
                
                marker = L.marker(position, {
                    icon: createUserIcon(username, isCurrentUser, locationMode),
                    draggable: canDrag,
                }).addTo(map);
                
                // If this is the current user's marker, set up drag events
                if (isCurrentUser) {
                    marker.on('dragstart', () => {
                        isDraggingRef.current = true;
                    });
                    
                    marker.on('dragend', (event: any) => {
                        isDraggingRef.current = false;
                        const newPos = event.target.getLatLng();
                        updateUserPosition(newPos.lat, newPos.lng);
                    });
                    
                    // Initialize current user's position if not set (only in manual mode)
                    if (!user.position && locationMode === 'manual') {
                        updateUserPosition(position[0], position[1]);
                    }
                }
                
                currentUserMarkers.set(user.id, marker);
            }
        });
        
        // Remove markers for users who are no longer connected
        for (const [userId, marker] of currentUserMarkers.entries()) {
            if (!processedUserIds.has(userId)) {
                map.removeLayer(marker);
                currentUserMarkers.delete(userId);
            }
        }
    }, [connectedUsers, currentUserId, updateUserPosition, mapLoc, locationMode]);

    // Sync shapes from Automerge to the map
    useEffect(() => {
        if (!mapInstanceRef.current || !drawnItemsRef.current) return;
        
        const map = mapInstanceRef.current;
        const drawnItems = drawnItemsRef.current;
        
        // Track which sync IDs we've seen in this update
        const currentSyncIds = new Set<string>();
        
        // Process each synced shape
        syncedShapes.forEach(syncedShape => {
            currentSyncIds.add(syncedShape.id);
            
            // If this was a locally created shape, mark it as confirmed
            if (pendingLocalShapesRef.current.has(syncedShape.id)) {
                pendingLocalShapesRef.current.delete(syncedShape.id);
                console.log('Local shape confirmed by Automerge:', syncedShape.id);
            }
            
            // Skip if we already have this shape (locally created or previously synced)
            if (processedSyncIdsRef.current.has(syncedShape.id)) {
                return;
            }
            
            // This is a new shape from another user - create the Leaflet layer
            let layer: L.Layer | null = null;
            const coords = syncedShape.coordinates;
            
            switch (syncedShape.type) {
                case 'circle':
                    layer = L.circle(coords.center, { radius: coords.radius });
                    break;
                case 'rectangle':
                    layer = L.rectangle(coords);
                    break;
                case 'polygon':
                    layer = L.polygon(coords);
                    break;
                case 'circlemarker':
                    layer = L.circleMarker(coords.center, { radius: coords.radius });
                    break;
                default:
                    console.log('Unknown shape type:', syncedShape.type);
                    break;
            }
            
            if (layer) {
                drawnItems.addLayer(layer);
                
                // Track the mapping
                syncIdToLayerRef.current.set(syncedShape.id, layer);
                layerToSyncIdRef.current.set(layer, syncedShape.id);
                processedSyncIdsRef.current.add(syncedShape.id);
                
                // Create the Flatten shape for collision detection
                const flatShape = flattenShape(syncedShape.type, coords);
                if (flatShape instanceof Flatten.Circle || flatShape instanceof Flatten.Polygon) {
                    const shapeInfo: DrawnLayer = {
                        id: L.stamp(layer),
                        type: syncedShape.type,
                        coordinates: coords,
                        soundId: syncedShape.soundId
                    };
                    addUpdateShapeMeta(flatShape, shapeInfo);
                    setDrawnShapes(prev => [...prev, flatShape]);
                }
                
                // Add click handler for sound dropdown
                // Store syncId in closure, but get current sound from ref
                const shapeIdForHandler = syncedShape.id;
                layer.on('click', function (e: any) {
                    if (!mapInstanceRef.current) return;
                    const containerPoint = map.mouseEventToContainerPoint(e.originalEvent);
                    // Get current sound from syncedShapesRef to avoid stale closure
                    const currentShape = syncedShapesRef.current.find(s => s.id === shapeIdForHandler);
                    const currentSound = currentShape?.soundId || null;
                    
                    setSoundDropdown({
                        show: true,
                        position: { x: containerPoint.x, y: containerPoint.y },
                        shapeId: shapeIdForHandler as any,
                        soundId: currentSound
                    });
                });
                
                console.log('Synced shape from another user:', syncedShape.id, syncedShape.type);
            }
        });
        
        // Remove shapes that are no longer in the synced list
        // BUT don't remove shapes that are pending local confirmation
        for (const [syncId, layer] of syncIdToLayerRef.current.entries()) {
            if (!currentSyncIds.has(syncId) && !pendingLocalShapesRef.current.has(syncId)) {
                // Remove from map
                drawnItems.removeLayer(layer);
                
                // Clean up mappings
                syncIdToLayerRef.current.delete(syncId);
                layerToSyncIdRef.current.delete(layer);
                processedSyncIdsRef.current.delete(syncId);
                
                // Remove from local state
                const leafletId = L.stamp(layer);
                const shapeToRemove = getShapeByID(leafletId);
                if (shapeToRemove) {
                    removeShapeFromState(shapeToRemove);
                }
                
                console.log('Removed shape (deleted by another user):', syncId);
            }
        }
    }, [syncedShapes]);

    // Helper function to get current user's position as a Flatten.Point
    const getUserPoint = () => {
        const currentUser = connectedUsers.find(u => u.id === currentUserId);
        if (!currentUser?.position) return null;

        const { lat, lng } = currentUser.position;
        const refLat = mapLoc[0];
        const refLng = mapLoc[1];
        const userCoords = GPStoMeters(lat, lng, refLat, refLng);
        return point(userCoords.x, userCoords.y);
    };

    // Extract current user's position as a string to avoid re-triggering on object reference changes
    const currentUserPositionKey = (() => {
        const currentUser = connectedUsers.find(u => u.id === currentUserId);
        if (!currentUser?.position) return null;
        return `${currentUser.position.lat},${currentUser.position.lng}`;
    })();

    // Automatically update audio based on user position
    useEffect(() => {
        // throttle location update calculation
        const now = Date.now();
        if (now - lastCalculationRef.current < THROTTLE_MS) {
            console.log("throttled...")
            return; // Skip this update
        }
        lastCalculationRef.current = now;

        if (!isAudioEnabled || !transportState?.isPlaying) {
            // Stop any playing sounds when audio is disabled or transport is paused
            if (currentSoundsRef.current !== '') {
                const soundPlayer = SoundPlayer.getInstance();
                soundPlayer.stopAll();
                currentSoundsRef.current = '';
            }
            return;
        }
        if (drawnShapes.length === 0) return;
        if (!currentUserPositionKey) return;

        const userPoint = getUserPoint();
        if (!userPoint) return;

        // Check collisions
        let planarSet = new Flatten.PlanarSet();
        drawnShapes.forEach(shape => {
            planarSet.add(shape);
        });
        
        const collidedShapes: any[] = planarSet.hit(userPoint);

        // Check nearby shapes (threshold in meters)
        const DISTANCE_THRESHOLD = 300; // meters
        const nearby = nearestShapes({ threshold: DISTANCE_THRESHOLD });

        // Collect sounds with volume from collided shapes (full volume) and nearby shapes (modulated volume)
        const sounds: Array<SoundConfig & { volume: number }> = [];

        // Process collided shapes - full volume (100%)
        collidedShapes.forEach(shape => {
            const metadata = shapeMetadataRef.current.get(shape);
            if (metadata) {
                let syncId: string | undefined;
                for (const [id, layer] of syncIdToLayerRef.current.entries()) {
                    if (L.stamp(layer) === metadata.id) {
                        syncId = id;
                        break;
                    }
                }
                
                const syncedShape = syncedShapes.find(s => s.id === syncId);
                const soundId = syncedShape?.soundId;
                
                if (soundId) {
                    sounds.push({
                        soundId: soundId,
                        note: 'C4',
                        volume: 1.0  // 100% volume for collided shapes
                    });
                }
            }
        });

        // Process nearby shapes - modulated volume based on distance
        if (nearby && nearby.length > 0) {
            nearby.forEach(({ shape, dist }) => {
                // Skip if already colliding (already processed above)
                if (collidedShapes.includes(shape)) {
                    return;
                }

                const metadata = shapeMetadataRef.current.get(shape);
                if (metadata) {
                    let syncId: string | undefined;
                    for (const [id, layer] of syncIdToLayerRef.current.entries()) {
                        if (L.stamp(layer) === metadata.id) {
                            syncId = id;
                            break;
                        }
                    }
                    
                    const syncedShape = syncedShapes.find(s => s.id === syncId);
                    const soundId = syncedShape?.soundId;
                    
                    if (soundId) {
                        // Calculate volume: 0% at threshold, 100% at distance 0
                        // Linear interpolation: volume = 1 - (distance / threshold)
                        const volume = Math.max(0, 1 - (dist / DISTANCE_THRESHOLD));
                        
                        sounds.push({
                            soundId: soundId,
                            note: 'C4',
                            volume: volume
                        });
                    }
                }
            });
        }

        // Create a unique key based on sound IDs only (not volumes)
        const soundsKey = sounds
            .map(s => s.soundId)
            .sort()
            .join(',');
        
        // Check if the SET of sounds changed
        if (soundsKey !== currentSoundsRef.current) {
            currentSoundsRef.current = soundsKey;
            
            const soundPlayer = SoundPlayer.getInstance();
            if (sounds.length > 0) {
                console.log('Updating sounds with volumes:', sounds);
                soundPlayer.playMultipleWithVolume(sounds);
            } else {
                console.log('Stopping all sounds');
                soundPlayer.stopAll();
            }
        } else if (sounds.length > 0) {
            // Sounds haven't changed, but volumes might have - update them
            const soundPlayer = SoundPlayer.getInstance();
            soundPlayer.playMultipleWithVolume(sounds);
        }

    }, [isAudioEnabled, transportState?.isPlaying, currentUserPositionKey, drawnShapes, mapLoc, point, syncedShapes]);

    const getCoordinates = function (layer: any, type: any) {
        switch (type) {
            case 'marker':
                const markerLatLng = layer.getLatLng();
                return [markerLatLng.lat, markerLatLng.lng];
            case 'circle':
                const circleLatLng = layer.getLatLng();
                return {
                    center: [circleLatLng.lat, circleLatLng.lng],
                    radius: layer.getRadius()
                };
            case 'rectangle':
            case 'polygon':
                return layer.getLatLngs()[0].map((latlng: any) => [latlng.lat, latlng.lng]);
            case 'circlemarker':
                const cmLatLng = layer.getLatLng();
                return {
                    center: [cmLatLng.lat, cmLatLng.lng],
                    radius: layer.getRadius()
                };
            default:
                return null;
        }
    };

    const clearArrangement = () => {
        if (drawnItemsRef.current) {
            drawnItemsRef.current.clearLayers();
            setDrawnShapes([]);
            shapeMetadataRef.current.clear();
            markerMetadataRef.current.clear();
            syncIdToLayerRef.current.clear();
            layerToSyncIdRef.current.clear();
            processedSyncIdsRef.current.clear();
            pendingLocalShapesRef.current.clear();
            setSoundDropdown(prev => ({ ...prev, show: false }));
            
            // Clear shapes in Automerge
            clearAllShapes();
        }
    };

    // Export arrangement (shapes and map view) to JSON file
    // Exports from Automerge (syncedShapes) for consistency
    const exportArrangement = () => {
        let mapView = null;
        if (mapInstanceRef.current) {
            const center = mapInstanceRef.current.getCenter();
            const zoom = mapInstanceRef.current.getZoom();
            mapView = {
                center: [center.lat, center.lng],
                zoom
            };
        }
        
        // Export from synced shapes (Automerge) instead of local metadata
        const shapes = syncedShapesRef.current.map(shape => ({
            id: shape.id,
            type: shape.type,
            coordinates: shape.coordinates,
            soundId: shape.soundId
        }));
        
        const exportData = {
            shapes,
            mapView
        };
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'arrangement.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Get flatten object from leaflet shape
    const flattenShape = (shapeType: string, shapeCoor: any) => {
        const refLat = mapLoc[0];
        const refLng = mapLoc[1];
        let {point, circle, Polygon} = Flatten;
        
        switch (shapeType) {
            case 'marker': {
                const markerCoords = GPStoMeters(
                    shapeCoor[0], 
                    shapeCoor[1], 
                    refLat, 
                    refLng
                );
                return point(markerCoords.x, markerCoords.y);
            }
            case 'circle': {
                const circleCoords = GPStoMeters(
                    shapeCoor.center[0], 
                    shapeCoor.center[1], 
                    refLat, 
                    refLng
                );
                return circle(point(circleCoords.x, circleCoords.y), shapeCoor.radius);
            }
            case 'rectangle': {
                const rectcoor: Flatten.Point[] = []
                shapeCoor.forEach((pt: [number, number]) => {
                        const pointConv = GPStoMeters(pt[0], pt[1], refLat, refLng)
                        rectcoor.push(point(pointConv.x, pointConv.y))
                });
                const rect = new Polygon();
                rect.addFace(rectcoor);
                return rect
            }
            case 'polygon': {
                const polycoor: Flatten.Point[] = []
                    shapeCoor.forEach((pt: [number, number]) => {
                        const pointConv = GPStoMeters(pt[0], pt[1], refLat, refLng)
                        polycoor.push(point(pointConv.x, pointConv.y))
                })
                const polygon = new Polygon();
                polygon.addFace(polycoor);
                return polygon
            }
            case 'circlemarker': {
                const cmCoords = GPStoMeters(
                    shapeCoor.center[0], 
                    shapeCoor.center[1], 
                    refLat, 
                    refLng
                );
                return circle(point(cmCoords.x, cmCoords.y), shapeCoor.radius);
            }
            default:
                throw new Error(`Unknown shape type: ${shapeType}`);
            }
    }

    // Convert GPS to meters relative to a reference point
    const GPStoMeters = (lat: number, lng: number, 
                         refLat: number, refLng: number): ConvertedCoords => {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat - refLat) * Math.PI / 180;
        const dLng = (lng - refLng) * Math.PI / 180;
        
        const x = dLng * Math.cos(refLat * Math.PI / 180) * R;
        const y = dLat * R;
        
        return { x, y };
    };

    const getCollisions = (chosenMarker: Flatten.Point) => {
        if (!chosenMarker) {
            console.log("no marker selected")
            return
        }
        if (drawnShapes.length === 0) {
            console.log("No shapes to check collisions");
            return [];
        }
        // set of unique shapes
        let planarSet = new Flatten.PlanarSet();

        // Add all shape flatten objects to planar set
        drawnShapes.forEach(shape => { 
                planarSet.add(shape)
        });
        
        // Compute marker collisions (may need to edit to update state var rather than create new var)
        const collidedShapes: any[] = planarSet.hit(chosenMarker); 
        if (collidedShapes.length > 0) {
            // console.log("get collisions output:", collidedShapes)
            return collidedShapes
        } else {
            // console.log("no marker collisions")
            return null
        }
    };
 
    const nearestShapes = ({
        // DONE: calculate distance of marker to nearest shapes within distance threshold (in meters)
        // 1. get collusions, then filter out collided
        // 2. calculate distance to all other shapes and return shapes within threshold
        // TODO:
        // modulate sound as user nears zone within distance threshold (meters) - eg ramp sound
        // potentially calculated when user position changes by x amount
        // chosenMarker, 
        threshold} : {
            threshold?: number}) => {

        // get array of shapes that do not include marker sorted by distance to marker
        // if (!chosenMarker) {
        //     console.log("no marker selected")
        //     return
        // }
        if (drawnShapes.length === 0) {
            console.log("No shapes to check collisions");
            return [];
        }

        const userPoint = getUserPoint();
        if (!userPoint) {
            console.log("No user position available");
            return [];
        }

        const collidedShapes = getCollisions(userPoint);
        const outsideShapes = drawnShapes.filter(x => !collidedShapes?.includes(x))
        const shapeProximity: any[] = []
        outsideShapes.forEach( (shape) => {
            // distance calculated as meters
            const dist = userPoint.distanceTo(shape)[0]
            // if threshold defined return shapes within distance threshold
            if (threshold == null) {
                shapeProximity.push({
                    shape: shape,
                    dist: dist}
                )
            } else {
                if (dist <= threshold) {
                    shapeProximity.push({
                    shape: shape,
                    dist: dist}
                    )
                }
            }  
        })
        shapeProximity.sort((a,b) => a.dist - b.dist)
        // console.log(shapeProximity)
        return shapeProximity
    }

    // Import arrangement (shapes and map view) from JSON file
    // This syncs to Automerge so all users see the imported shapes
    const importArrangement = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target?.result as string);
                if (importedData && Array.isArray(importedData.shapes)) {
                    // First, clear existing shapes (both local and in Automerge)
                    clearArrangement();
                    
                    // Add each shape to Automerge - the sync effect will draw them
                    importedData.shapes.forEach((shape: DrawnLayer) => {
                        // Skip markers - we use user markers instead
                        if (shape.type === 'marker') return;
                        
                        // Add to Automerge with the sound type
                        addShapeRef.current(shape.type, shape.coordinates, shape.soundId);
                    });
                    
                    // Restore map view if present
                    if (importedData.mapView && mapInstanceRef.current) {
                        const { center, zoom } = importedData.mapView;
                        if (
                            Array.isArray(center) &&
                            center.length === 2 &&
                            typeof center[0] === 'number' &&
                            typeof center[1] === 'number' &&
                            typeof zoom === 'number'
                        ) {
                            mapInstanceRef.current.setView([center[0], center[1]], zoom);
                        }
                    }
                    
                    console.log('Imported', importedData.shapes.length, 'shapes to Automerge');
                } else if (Array.isArray(importedData)) {
                    // Fallback for old format - just add shapes without sound
                    console.log("Importing old format (no sound data)");
                    clearArrangement();
                    importedData.forEach((shape: any) => {
                        if (shape.type && shape.coordinates) {
                            addShapeRef.current(shape.type, shape.coordinates, null);
                        }
                    });
                }
            } catch (err) {
                console.log(err)
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
        
        // Reset the input so the same file can be imported again
        event.target.value = '';
    };

    // update soundId assigned to shape
    const handleSoundSelect = (soundId: string) => {
        const syncId = soundDropdown.shapeId as unknown as string;
        
        // Sync to Automerge
        if (syncId) {
            updateShapeSound(syncId, soundId);
            console.log(`Synced sound "${soundId}" to shape ${syncId}`);
        }

        // Update the dropdown state with the new sound type
        setSoundDropdown(prev => ({ ...prev, soundId }));
    };

    const closeSoundDropdown = () => {
        setSoundDropdown({
            show: false,
            position: { x: 0, y: 0 },
            shapeId: null,
            soundId: null
        });
    };

    const handleUpdateMarkerAudio = () => {
        setIsAudioEnabled(true);
    }

    const handleStopAudio = () => {
        setIsAudioEnabled(false);
        currentSoundsRef.current = ''; // Reset tracked sounds
        const soundPlayer = SoundPlayer.getInstance();
        soundPlayer.stopAll();
    }

    const handleSoundboxing = () => {
        // Toggle the debug instrument selector
        setShowDebugSounds(!showDebugSounds);
    }

    const handleToggleTrySound = async (soundId: string) => {
        const soundPlayer = SoundPlayer.getInstance();

        if (playingSounds.has(soundId)) {
            // Stop the instrument
            console.log(`Stopping debug instrument: ${soundId}`);
            soundPlayer.stopSound(soundId);
            setplayingSounds(prev => {
                const newSet = new Set(prev);
                newSet.delete(soundId);
                return newSet;
            });
        } else {
            // Start the instrument
            console.log(`Starting debug instrument: ${soundId}`);
            await soundPlayer.startSound(soundId, "C4");
            setplayingSounds(prev => new Set(prev).add(soundId));
        }
    }

    const handleCloseDebugSelector = () => {
        setShowDebugSounds(false);
    }

    const handleCloseZoneManagement = () => {
        setShowZoneManagement(false);
    }

    const handleCloseTransportControls = () => {
        setShowTransportControls(false);
    }

    const handleTransportStart = () => {
        if (!timingSyncReady) return;
        const timingSync = TimingSync.getInstance();
        const newState = timingSync.start();
        updateTransportState(newState);
        console.log('Transport started from 0, syncing to Automerge');
    };

    const handleTransportResume = () => {
        if (!timingSyncReady) return;
        const timingSync = TimingSync.getInstance();
        const newState = timingSync.resume();
        updateTransportState(newState);
        console.log('Transport resumed, syncing to Automerge');
    };

    const handleTransportPause = () => {
        if (!timingSyncReady) return;
        const timingSync = TimingSync.getInstance();
        const newState = timingSync.pause();
        updateTransportState(newState);
        console.log('Transport paused, syncing to Automerge');
    };

    const handleTransportReset = () => {
        if (!timingSyncReady) return;
        const timingSync = TimingSync.getInstance();
        const newState = timingSync.reset();
        updateTransportState(newState);
        console.log('Transport reset to 0, syncing to Automerge');
    };

    const handleBPMChange = (newBPM: number) => {
        if (!timingSyncReady) return;
        const timingSync = TimingSync.getInstance();
        const newState = timingSync.setBPM(newBPM);
        updateTransportState(newState);
        setCurrentBPM(newBPM);
        console.log('BPM changed, syncing to Automerge');
    };


    return (
        <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
            <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

            {/* Zone Management Button */}
            <button
                onClick={() => setShowZoneManagement(!showZoneManagement)}
                style={{
                    position: 'absolute',
                    top: '600px',
                    left: '10px',
                    backgroundColor: '#8b5cf6',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    zIndex: 1000,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
            >
                {showZoneManagement ? '📍 Hide Zones' : '📍 Zone Management'}
            </button>

            {/* Zone Management Menu */}
            {showZoneManagement && (
                <>
                    {/* Overlay to close on click outside */}
                    <div
                        onClick={handleCloseZoneManagement}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 1000,
                            backgroundColor: 'transparent'
                        }}
                    />
                    {/* Zone management panel */}
                    <div style={{
                        position: 'absolute',
                        top: '540px',
                        left: '10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        padding: '12px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        zIndex: 1001,
                        minWidth: '200px',
                    }}>
                        <div style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            marginBottom: '12px',
                            color: '#374151',
                        }}>
                            Zone Management
                        </div>

                        {/* Export Button */}
                        <button
                            onClick={exportArrangement}
                            style={{
                                width: '100%',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: 'pointer',
                                marginBottom: '8px',
                                fontWeight: '500'
                            }}
                        >
                            💾 Export Arrangement
                        </button>

                        {/* Import Button */}
                        <label htmlFor="importArrangement" style={{
                            display: 'block',
                            width: '100%',
                            backgroundColor: '#10b981',
                            color: 'white',
                            padding: '8px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            marginBottom: '8px',
                            textAlign: 'center',
                            fontWeight: '500',
                            boxSizing: 'border-box'
                        }}>
                            📂 Import Arrangement
                            <input
                                id="importArrangement"
                                type="file"
                                accept="application/json"
                                style={{ display: 'none' }}
                                onChange={importArrangement}
                            />
                        </label>

                        {/* Clear Button */}
                        <button
                            onClick={clearArrangement}
                            style={{
                                width: '100%',
                                backgroundColor: '#ef4444',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: 'pointer',
                                fontWeight: '500'
                            }}
                        >
                            🗑️ Clear Arrangement
                        </button>
                    </div>
                </>
            )}

            <button
                onClick={() => setDebugMode(!debugMode)}
                style={{
                    position: 'absolute',
                    bottom: '10px',
                    right: '10px',
                    backgroundColor: debugMode ? '#6b7280' : '#8b5cf6',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    zIndex: 1000,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
            >
                {debugMode ? 'hide experimental' : 'experimental'}
            </button>

            {debugMode && (
                <>
                    <button
                        onClick={handleSoundboxing}
                        style={{
                            position: 'absolute',
                            bottom: '100px',
                            right: '10px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            padding: '8px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            zIndex: 1000,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                    >
                        sound bank
                    </button>
                    <button
                        onClick={() => nearestShapes({threshold: 100})}
                        style={{
                            position: 'absolute',
                            bottom: '55px',
                            right: '10px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            padding: '8px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            zIndex: 1000,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                    >
                        get nearest (debug)
                    </button>
                    <button
                        onClick={handleStopAudio}
                        style={{
                            position: 'absolute',
                            bottom: '145px',
                            right: '10px',
                            backgroundColor: '#f63b3bff',
                            color: 'white',
                            padding: '8px 12px',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            zIndex: 1000,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                    >
                        stop all audio
                    </button>
                </>
            )}

            {/* Debug Instrument Selector */}
            {showDebugSounds && (
                <>
                    {/* Overlay to close on click outside */}
                    <div
                        onClick={handleCloseDebugSelector}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 1000,
                            backgroundColor: 'transparent'
                        }}
                    />
                    {/* Instrument list */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: '145px',
                            right: '10px',
                            backgroundColor: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                            zIndex: 1001,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            minWidth: '200px'
                        }}
                    >
                        <div style={{ padding: '8px', borderBottom: '1px solid #e5e5e5', fontWeight: 'bold', color: '#111' }}>
                            Select sounds
                        </div>
                        {SOUND_DEFINITIONS.map((sound) => {
                            const isPlaying = playingSounds.has(sound.id);
                            return (
                                <div
                                    key={sound.id}
                                    style={{
                                        padding: '8px 12px',
                                        borderBottom: '1px solid #f0f0f0',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '12px'
                                    }}
                                >
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: '500', color: '#111' }}>{sound.name}</div>
                                        <div style={{ fontSize: '12px', color: '#1f34b8ff' }}>ID: {sound.id}</div>
                                    </div>
                                    <button
                                        onClick={() => handleToggleTrySound(sound.id)}
                                        style={{
                                            padding: '6px 12px',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            backgroundColor: isPlaying ? '#ef4444' : '#10b981',
                                            color: 'white',
                                            transition: 'all 0.2s',
                                            minWidth: '60px'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = isPlaying ? '#dc2626' : '#059669';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = isPlaying ? '#ef4444' : '#10b981';
                                        }}
                                    >
                                        {isPlaying ? '⏹ Stop' : '▶ Play'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <button
                onClick={isAudioEnabled ? () => setShowTransportControls(!showTransportControls) : handleUpdateMarkerAudio}
                style={{
                    position: 'absolute',
                    top: '325px',
                    left: '10px',
                    backgroundColor: isAudioEnabled ? '#3b82f6' : '#10b981',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    zIndex: 1000,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }}
            >
                {isAudioEnabled ? (showTransportControls ? '🎵 Hide Transport' : '🎵 Transport Controls') : 'Enable Audio'}
            </button>
            <button
                onClick={handleStopAudio}
                disabled={!isAudioEnabled}
                style={{
                    position: 'absolute',
                    top: '360px',
                    left: '10px',
                    backgroundColor: isAudioEnabled ? '#f63b3bff' : '#6b7280',
                    color: 'white',
                    padding: '8px 12px',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: isAudioEnabled ? 'pointer' : 'not-allowed',
                    zIndex: 1000,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    opacity: isAudioEnabled ? 1 : 0.6
                }}
            >
                Disable Audio
            </button>

            {/* Transport controls panel */}
            {showTransportControls && (
                <>
                    {/* Overlay to close on click outside */}
                    <div
                        onClick={handleCloseTransportControls}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 1000,
                            backgroundColor: 'transparent'
                        }}
                    />
                    {/* Transport controls panel */}
                    <div style={{
                        position: 'absolute',
                        top: '400px',
                        left: '10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        padding: '12px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        zIndex: 1001,
                        minWidth: '200px',
                    }}>
                        <div style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            marginBottom: '8px',
                            color: '#374151',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                            🎵 Transport Controls
                            {timingSyncReady ? (
                                <span style={{
                                    fontSize: '10px',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontWeight: 'normal'
                                }}>
                                    Synced
                                </span>
                            ) : timingSyncError ? (
                                <span style={{
                                    fontSize: '10px',
                                    backgroundColor: '#ef4444',
                                    color: 'white',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontWeight: 'normal'
                                }}>
                                    Error
                                </span>
                            ) : (
                                <span style={{
                                    fontSize: '10px',
                                    backgroundColor: '#f59e0b',
                                    color: 'white',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontWeight: 'normal'
                                }}>
                                    Connecting...
                                </span>
                            )}
                        </div>

                        {timingSyncError && (
                            <div style={{
                                fontSize: '10px',
                                color: '#ef4444',
                                marginBottom: '8px',
                                padding: '4px',
                                backgroundColor: '#fee2e2',
                                borderRadius: '3px'
                            }}>
                                {timingSyncError}
                            </div>
                        )}

                        {/* Start Button — starts from 0 */}
                        <button
                            onClick={handleTransportStart}
                            disabled={!timingSyncReady || transportState?.isPlaying}
                            style={{
                                width: '100%',
                                backgroundColor: (!timingSyncReady || transportState?.isPlaying) ? '#6b7280' : '#10b981',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: (!timingSyncReady || transportState?.isPlaying) ? 'not-allowed' : 'pointer',
                                marginBottom: '8px',
                                fontWeight: '500',
                                opacity: (!timingSyncReady || transportState?.isPlaying) ? 0.6 : 1
                            }}
                        >
                            ▶ Start
                        </button>

                        {/* Resume Button — resumes from paused position */}
                        <button
                            onClick={handleTransportResume}
                            disabled={!timingSyncReady || transportState?.isPlaying || !(transportState?.pausedPosition && transportState.pausedPosition > 0)}
                            style={{
                                width: '100%',
                                backgroundColor: (!timingSyncReady || transportState?.isPlaying || !(transportState?.pausedPosition && transportState.pausedPosition > 0)) ? '#6b7280' : '#3b82f6',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: (!timingSyncReady || transportState?.isPlaying || !(transportState?.pausedPosition && transportState.pausedPosition > 0)) ? 'not-allowed' : 'pointer',
                                marginBottom: '8px',
                                fontWeight: '500',
                                opacity: (!timingSyncReady || transportState?.isPlaying || !(transportState?.pausedPosition && transportState.pausedPosition > 0)) ? 0.6 : 1
                            }}
                        >
                            ▶▶ Resume
                        </button>

                        {/* Pause Button */}
                        <button
                            onClick={handleTransportPause}
                            disabled={!timingSyncReady || !transportState?.isPlaying}
                            style={{
                                width: '100%',
                                backgroundColor: (!timingSyncReady || !transportState?.isPlaying) ? '#6b7280' : '#f59e0b',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: (!timingSyncReady || !transportState?.isPlaying) ? 'not-allowed' : 'pointer',
                                marginBottom: '8px',
                                fontWeight: '500',
                                opacity: (!timingSyncReady || !transportState?.isPlaying) ? 0.6 : 1
                            }}
                        >
                            ⏸ Pause
                        </button>

                        {/* Reset Button — resets position to 0 */}
                        <button
                            onClick={handleTransportReset}
                            disabled={!timingSyncReady || (!transportState?.isPlaying && !(transportState?.pausedPosition && transportState.pausedPosition > 0))}
                            style={{
                                width: '100%',
                                backgroundColor: (!timingSyncReady || (!transportState?.isPlaying && !(transportState?.pausedPosition && transportState.pausedPosition > 0))) ? '#6b7280' : '#ef4444',
                                color: 'white',
                                padding: '8px 12px',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                cursor: (!timingSyncReady || (!transportState?.isPlaying && !(transportState?.pausedPosition && transportState.pausedPosition > 0))) ? 'not-allowed' : 'pointer',
                                marginBottom: '8px',
                                fontWeight: '500',
                                opacity: (!timingSyncReady || (!transportState?.isPlaying && !(transportState?.pausedPosition && transportState.pausedPosition > 0))) ? 0.6 : 1
                            }}
                        >
                            ⏹ Reset
                        </button>

                        {/* BPM Control */}
                        <div style={{ marginTop: '12px' }}>
                            <label style={{
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#374151',
                                display: 'block',
                                marginBottom: '4px'
                            }}>
                                BPM: {currentBPM}
                            </label>
                            <input
                                type="range"
                                min="60"
                                max="180"
                                value={currentBPM}
                                onChange={(e) => handleBPMChange(parseInt(e.target.value))}
                                disabled={!timingSyncReady}
                                style={{
                                    width: '100%',
                                    cursor: timingSyncReady ? 'pointer' : 'not-allowed',
                                    opacity: timingSyncReady ? 1 : 0.6
                                }}
                            />
                        </div>
                    </div>
                </>
            )}

            <SoundKit
                show={soundDropdown.show}
                shapeId={soundDropdown.shapeId}
                position={soundDropdown.position}
                onSoundSelect={handleSoundSelect}
                onClose={closeSoundDropdown}
                selectedsoundId={soundDropdown.soundId}
            />
        </div>
    );
};

export default DrawMapZones;