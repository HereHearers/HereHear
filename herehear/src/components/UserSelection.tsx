import { useState } from 'react';
import type { DrawnLayer } from '../sharedTypes';
import Flatten from 'flatten-js';

interface MarkerSelectDialogProps {
    show: boolean;
    onClose: () => void;
    onSelect: (markerId: number) => void;
    markerMeta: Map<Flatten.Point, DrawnLayer>;
}

const MarkerSelectDialog = ({ show, onClose, onSelect, markerMeta }: MarkerSelectDialogProps) => {
    const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null);

    const handleOptionChange = (markerId: number) => {
        setSelectedMarkerId(markerId);
    };

    const handleSubmit = () => {
        if (selectedMarkerId !== null) {
            onSelect(selectedMarkerId);
            onClose();
        }
    };

    const handleCancel = () => {
        onClose();
    };

    if (!show) return null;

    const markerMetaArr = Array.from(markerMeta.values())

    return (
        <div
            style={{
                position: 'absolute',
                left: '10px',
                top: '325px',
                backgroundColor: 'white',
                border: '2px solid #333',
                borderRadius: '8px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                zIndex: 10000,
                minWidth: '200px',
                padding: '8px 0',
                fontFamily: 'Arial, sans-serif'
            }}
        >
            <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid #ddd',
                fontWeight: 'bold',
                fontSize: '14px',
                color: '#333',
                backgroundColor: '#f8f8f8'
            }}>
                Select Marker
            </div>
            
            {markerMetaArr.length === 0 ? (
                <div style={{ padding: '12px', color: '#667', fontStyle: 'italic' }}>
                    No markers available
                </div>
            ) : (
                markerMetaArr.map((marker) => (
                    <button
                        key={marker.id}
                        onClick={() => handleOptionChange(marker.id)}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            border: 'none',
                            backgroundColor: selectedMarkerId === marker.id ? '#e3f2fd' : 'white',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: '14px',
                            color: selectedMarkerId === marker.id ? '#1976d2' : '#333',
                            transition: 'background-color 0.2s',
                            display: 'block',
                            position: 'relative'
                        }}
                        onMouseOver={(e) => {
                            if (selectedMarkerId !== marker.id) {
                                (e.target as HTMLElement).style.backgroundColor = '#f0f0f0';
                            }
                        }}
                        onMouseOut={(e) => {
                            if (selectedMarkerId !== marker.id) {
                                (e.target as HTMLElement).style.backgroundColor = 'white';
                            }
                        }}
                    >
                        {marker.id}
                        {selectedMarkerId === marker.id && (
                            <span style={{
                                position: 'absolute',
                                right: '12px',
                                color: '#10b981',
                                fontWeight: 'bold',
                                fontSize: '16px'
                            }}>✔</span>
                        )}
                    </button>
                ))
            )}
            
            <div style={{ borderTop: '1px solid #ddd', padding: '8px', display: 'flex', gap: '8px' }}>
                <button
                    onClick={handleSubmit}
                    disabled={selectedMarkerId === null}
                    style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #3b82f6',
                        backgroundColor: selectedMarkerId !== null ? '#3b82f6' : '#ccc',
                        color: 'white',
                        borderRadius: '4px',
                        cursor: selectedMarkerId !== null ? 'pointer' : 'not-allowed',
                        fontSize: '12px',
                        fontWeight: 'bold'
                    }}
                >
                    Select
                </button>
                <button
                    onClick={handleCancel}
                    style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #ccc',
                        backgroundColor: '#f0f0f0',
                        color: '#666',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold'
                    }}
                    onMouseOver={(e) => (e.target as HTMLElement).style.backgroundColor = '#e0e0e0'}
                    onMouseOut={(e) => (e.target as HTMLElement).style.backgroundColor = '#f0f0f0'}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
};

export default MarkerSelectDialog