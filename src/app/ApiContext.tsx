import React, { createContext, useContext, useEffect, useState } from 'react';

interface ApiSensorData {
    value: number;
    unit: string;
    timestamp: string;
    coordinates?: { lat: number; lon: number };
    threshold?: number;
}

interface ApiDeviceState {
    enabled: boolean;
    scale: number;
}

interface ApiContextType {
    sensors: Record<string, ApiSensorData[]>;
    deviceStates: Record<string, ApiDeviceState>;
    isConnected: boolean;
    error: string | null;
    sendControl: (device: string, enabled?: boolean, scale?: number) => Promise<void>;
    sendThreshold: (device: string, sensor: string, threshold: number) => Promise<void>;
}

const ApiContext = createContext<ApiContextType | undefined>(undefined);

export function ApiProvider({ children }: { children: React.ReactNode }) {
    const [sensors, setSensors] = useState<Record<string, ApiSensorData[]>>({});
    const [deviceStates, setDeviceStates] = useState<Record<string, ApiDeviceState>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null);

    useEffect(() => {
        let wsInstance: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout;

        const connect = () => {
            try {
                // Use secure WebSocket if the page is served over HTTPS
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${protocol}//${window.location.hostname}:3001`;

                wsInstance = new WebSocket(wsUrl);

                wsInstance.onopen = () => {
                    console.log('API WebSocket connected');
                    setIsConnected(true);
                    setError(null);
                };

                wsInstance.onclose = () => {
                    console.log('API WebSocket disconnected');
                    setIsConnected(false);
                    setError('Disconnected from API server');

                    // Attempt to reconnect after 5 seconds
                    reconnectTimeout = setTimeout(connect, 5000);
                };

                wsInstance.onerror = (event) => {
                    console.error('API WebSocket error:', event);
                    setError('WebSocket error occurred');
                };

                wsInstance.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);

                        switch (data.type) {
                            case 'initial_data':
                                setSensors(data.sensors || {});
                                setDeviceStates(data.deviceStates || {});
                                break;
                            case 'sensor_update':
                                setSensors(prev => ({
                                    ...prev,
                                    [data.sensor]: [...(prev[data.sensor] || []), data.data]
                                }));
                                break;
                            case 'device_control':
                                setDeviceStates(prev => ({
                                    ...prev,
                                    [data.device]: data.state
                                }));
                                break;
                            case 'threshold_update':
                                setSensors(prev => ({
                                    ...prev,
                                    [data.sensor]: (prev[data.sensor] || []).map(point => ({
                                        ...point,
                                        threshold: data.threshold
                                    }))
                                }));
                                break;
                        }
                    } catch (e) {
                        console.error('Error processing WebSocket message:', e);
                    }
                };

                setWs(wsInstance);
            } catch (e) {
                console.error('Error creating WebSocket connection:', e);
                setError('Failed to create WebSocket connection');
                // Attempt to reconnect after 5 seconds
                reconnectTimeout = setTimeout(connect, 5000);
            }
        };

        connect();

        return () => {
            if (wsInstance) {
                wsInstance.close();
            }
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
        };
    }, []);

    const sendControl = async (device: string, enabled?: boolean, scale?: number) => {
        try {
            const response = await fetch(`http://localhost:3001/api/device/${device}/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, scale })
            });
            if (!response.ok) throw new Error('Failed to send control command');
        } catch (e) {
            console.error('Error sending control command:', e);
            setError('Failed to send control command');
        }
    };

    const sendThreshold = async (device: string, sensor: string, threshold: number) => {
        try {
            const response = await fetch(`http://localhost:3001/api/device/${device}/sensor/${sensor}/threshold`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threshold })
            });
            if (!response.ok) throw new Error('Failed to set threshold');
        } catch (e) {
            console.error('Error setting threshold:', e);
            setError('Failed to set threshold');
        }
    };

    return (
        <ApiContext.Provider value={{
            sensors,
            deviceStates,
            isConnected,
            error,
            sendControl,
            sendThreshold
        }}>
            {children}
        </ApiContext.Provider>
    );
}

export function useApi() {
    const context = useContext(ApiContext);
    if (!context) {
        throw new Error('useApi must be used within an ApiProvider');
    }
    return context;
} 