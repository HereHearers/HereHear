import { useState, useEffect } from 'react';
import DrawMapZones from './components/DrawMapZones';
import { useAutomergeDoc } from './useAutomergeDoc';
import { useGeolocation } from './useGeolocation';
import type { LocationMode } from './useGeolocation';

// @ts-ignore
window.type = true;


function App() {
  const {
    connectedUserCount,
    connectedUsers,
    userId,
    isDJ,
    updateUserName,
    updateUserPosition,
    grantDJ,
    revokeDJ,
    syncedShapes,
    addShape,
    updateShapeSound,
    updateShapeCoordinates,
    deleteShape,
    clearAllShapes,
    updateTransportState,
    initializeTransportIfNeeded,
    doc,
    isReady
  } = useAutomergeDoc();
  const [isExpanded, setIsExpanded] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [locationMode, setLocationMode] = useState<LocationMode>(() => {
    const saved = localStorage.getItem('gpsound-location-mode');
    return (saved === 'gps' || saved === 'manual') ? saved : 'manual';
  });
  const [showLocationSettings, setShowLocationSettings] = useState(false);

  const {
    latitude,
    longitude,
    accuracy,
    error: gpsError,
    isWatching,
    isSupported: isGpsSupported,
    startWatching,
    stopWatching,
  } = useGeolocation({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 5000,
  });

  // Update user position when GPS coordinates change
  useEffect(() => {
    if (locationMode === 'gps' && latitude !== null && longitude !== null) {
      updateUserPosition(latitude, longitude);
    }
  }, [locationMode, latitude, longitude, updateUserPosition]);

  // Start/stop GPS watching based on location mode
  useEffect(() => {
    if (locationMode === 'gps') {
      startWatching();
    } else {
      stopWatching();
    }
  }, [locationMode, startWatching, stopWatching]);

  // Save location mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('gpsound-location-mode', locationMode);
  }, [locationMode]);

  const handleLocationModeChange = (mode: LocationMode) => {
    setLocationMode(mode);
  };

  // Get current user's name from the document
  const currentUser = connectedUsers.find(u => u.id === userId);
  const currentUserName = currentUser?.name || '';

  // Update nameInput when currentUserName changes (from sync)
  if (nameInput === '' && currentUserName !== '') {
    setNameInput(currentUserName);
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setNameInput(newName);
    updateUserName(newName);
  };

  return (
    <>
      {/* User panel - positioned in top-right corner */}
      <div style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        color: '#1f2937',
        minWidth: '200px',
        overflow: 'hidden',
      }}>
        {/* Name input */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
          borderRadius: '12px 12px 0 0',
        }}>
          <input
            type="text"
            placeholder="Enter your name..."
            value={nameInput}
            onChange={handleNameChange}
            disabled={!isReady}
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'border-color 0.2s',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
            onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
          />
        </div>

        {/* Location settings toggle */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
        }}>
          <div
            onClick={() => setShowLocationSettings(!showLocationSettings)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '14px' }}>
                {locationMode === 'gps' ? '📍' : '✋'}
              </span>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>
                {locationMode === 'gps' ? 'GPS Location' : 'Manual Location'}
              </span>
              {locationMode === 'gps' && isWatching && (
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  animation: 'pulse 2s infinite',
                }} />
              )}
            </div>
            <span style={{
              fontSize: '12px',
              transition: 'transform 0.2s',
              transform: showLocationSettings ? 'rotate(180deg)' : 'rotate(0deg)',
            }}>
              ▼
            </span>
          </div>

          {/* Expanded location settings */}
          {showLocationSettings && (
            <div style={{ marginTop: '10px' }}>
              {/* Mode toggle buttons */}
              <div style={{
                display: 'flex',
                gap: '6px',
                marginBottom: '8px',
              }}>
                <button
                  onClick={() => handleLocationModeChange('manual')}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    backgroundColor: locationMode === 'manual' ? '#3b82f6' : '#e5e7eb',
                    color: locationMode === 'manual' ? 'white' : '#4b5563',
                    transition: 'all 0.2s',
                  }}
                >
                  ✋ Manual
                </button>
                <button
                  onClick={() => handleLocationModeChange('gps')}
                  disabled={!isGpsSupported}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: isGpsSupported ? 'pointer' : 'not-allowed',
                    backgroundColor: locationMode === 'gps' ? '#3b82f6' : '#e5e7eb',
                    color: locationMode === 'gps' ? 'white' : '#4b5563',
                    opacity: isGpsSupported ? 1 : 0.5,
                    transition: 'all 0.2s',
                  }}
                >
                  📍 GPS
                </button>
              </div>

              {/* GPS status info */}
              {locationMode === 'gps' && (
                <div style={{
                  fontSize: '11px',
                  color: '#6b7280',
                  padding: '6px 8px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '4px',
                }}>
                  {gpsError ? (
                    <div style={{ color: '#ef4444' }}>
                      ⚠️ {gpsError}
                    </div>
                  ) : isWatching && latitude !== null ? (
                    <>
                      <div>Lat: {latitude.toFixed(6)}</div>
                      <div>Lng: {longitude?.toFixed(6)}</div>
                      {accuracy && (
                        <div style={{ marginTop: '2px', color: '#9ca3af' }}>
                          Accuracy: ±{accuracy.toFixed(0)}m
                        </div>
                      )}
                    </>
                  ) : (
                    <div>Acquiring location...</div>
                  )}
                </div>
              )}

              {/* Help text */}
              <div style={{
                fontSize: '10px',
                color: '#9ca3af',
                marginTop: '6px',
              }}>
                {locationMode === 'manual' 
                  ? 'Drag your marker on the map to set position'
                  : 'Your position updates automatically from GPS'}
              </div>

              {!isGpsSupported && (
                <div style={{
                  fontSize: '10px',
                  color: '#ef4444',
                  marginTop: '4px',
                }}>
                  GPS not supported in this browser
                </div>
              )}
            </div>
          )}
        </div>

        {/* User count indicator - clickable */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'background-color 0.2s',
            borderRadius: isExpanded ? '0' : '0 0 12px 12px',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          {/* Online indicator dot */}
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isReady ? '#22c55e' : '#94a3b8',
            animation: isReady ? 'pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontWeight: 500, flex: 1 }}>
            {isReady ? (
              <>
                {connectedUserCount} {connectedUserCount === 1 ? 'user' : 'users'} connected
              </>
            ) : (
              'Connecting...'
            )}
          </span>
          {/* Expand/collapse arrow */}
          <span style={{
            fontSize: '12px',
            transition: 'transform 0.2s',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            ▼
          </span>
        </div>

        {/* Expanded user list */}
        {isExpanded && isReady && (
          <div style={{
            borderTop: '1px solid #e5e7eb',
            maxHeight: '300px',
            overflowY: 'auto',
            borderRadius: '0 0 12px 12px',
          }}>
            {connectedUsers.map((user, index) => {
              const isCurrentUser = user.id === userId;
              const isLastUser = index === connectedUsers.length - 1;
              // Default to true if isActive is undefined (for backwards compatibility)
              const isActive = user.isActive !== false;
              const userIsDJ = user.isDJ === true;

              return (
                <div
                  key={user.id}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: isCurrentUser ? '#eff6ff' : 'transparent',
                    borderLeft: isCurrentUser ? '3px solid #3b82f6' : '3px solid transparent',
                    borderRadius: isLastUser ? '0 0 12px 12px' : '0',
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    {/* Active/Away status dot */}
                    <div style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: isActive ? '#22c55e' : '#94a3b8',
                      flexShrink: 0,
                    }} />
                    <div style={{
                      fontWeight: isCurrentUser ? 600 : 400,
                      color: '#1f2937',
                      flex: 1,
                    }}>
                      {user.name || 'Anonymous'}
                      {userIsDJ && (
                        <span style={{
                          marginLeft: '6px',
                          fontSize: '10px',
                          backgroundColor: '#8b5cf6',
                          color: 'white',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          verticalAlign: 'middle',
                        }}>
                          DJ
                        </span>
                      )}
                      {isCurrentUser && (
                        <span style={{
                          marginLeft: '6px',
                          fontSize: '11px',
                          color: '#6b7280',
                          fontWeight: 400,
                        }}>
                          (you)
                        </span>
                      )}
                      {!isActive && (
                        <span style={{
                          marginLeft: '6px',
                          fontSize: '11px',
                          color: '#9ca3af',
                          fontWeight: 400,
                          fontStyle: 'italic',
                        }}>
                          away
                        </span>
                      )}
                    </div>
                    {/* Promote/Demote DJ button - only shown to DJs, for other users */}
                    {isDJ && !isCurrentUser && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (userIsDJ) {
                            revokeDJ(user.id);
                          } else {
                            grantDJ(user.id);
                          }
                        }}
                        title={userIsDJ ? 'Remove DJ privileges' : 'Grant DJ privileges'}
                        style={{
                          padding: '2px 6px',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          backgroundColor: userIsDJ ? '#fecaca' : '#ddd6fe',
                          color: userIsDJ ? '#dc2626' : '#7c3aed',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }}
                      >
                        {userIsDJ ? 'Remove DJ' : 'Make DJ'}
                      </button>
                    )}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: '#9ca3af',
                    marginTop: '2px',
                    marginLeft: '12px',
                  }}>
                    {user.id.substring(0, 12)}...
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add pulse animation for the online indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <DrawMapZones
        connectedUsers={connectedUsers}
        currentUserId={userId}
        isDJ={isDJ}
        updateUserPosition={updateUserPosition}
        syncedShapes={syncedShapes}
        addShape={addShape}
        updateShapeSound={updateShapeSound}
        updateShapeCoordinates={updateShapeCoordinates}
        deleteShape={deleteShape}
        clearAllShapes={clearAllShapes}
        updateTransportState={updateTransportState}
        initializeTransportIfNeeded={initializeTransportIfNeeded}
        transportState={doc?.transport}
        locationMode={locationMode}
      />
    </>
  );
}

export default App;
