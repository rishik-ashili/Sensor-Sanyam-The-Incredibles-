import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

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

const POLLING_INTERVAL = 5000; // 5 seconds

export function ApiProvider({ children }: { children: React.ReactNode }) {
    const [sensors, setSensors] = useState<Record<string, ApiSensorData[]>>({});
    const [deviceStates, setDeviceStates] = useState<Record<string, ApiDeviceState>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [usePolling, setUsePolling] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch('/api/sensor-data');
            if (!response.ok) throw new Error('Failed to fetch sensor data');
            const data = await response.json();
            setSensors(data.sensors || {});
            setDeviceStates(data.deviceStates || {});
            setIsConnected(true);
            setError(null);
        } catch (e) {
            console.error('Error fetching data:', e);
            setError('Failed to fetch data');
            setIsConnected(false);
        }
    }, []);

    const connectWebSocket = useCallback(() => {
        try {
            // Use relative WebSocket URL
            const wsUrl = `ws://${window.location.hostname}:3001`;
            const wsInstance = new WebSocket(wsUrl);

            wsInstance.onopen = () => {
                console.log('API WebSocket connected');
                setIsConnected(true);
                setError(null);
                setUsePolling(false);
            };

            wsInstance.onclose = () => {
                console.log('API WebSocket disconnected');
                setIsConnected(false);
                setError('Disconnected from API server');
                setUsePolling(true);
            };

            wsInstance.onerror = (event) => {
                console.error('API WebSocket error:', event);
                setError('WebSocket error occurred');
                setUsePolling(true);
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
            setUsePolling(true);
        }
    }, []);

    useEffect(() => {
        connectWebSocket();

        // Set up polling if WebSocket fails
        let pollingInterval: NodeJS.Timeout;
        if (usePolling) {
            pollingInterval = setInterval(fetchData, POLLING_INTERVAL);
        }

        return () => {
            if (ws) {
                ws.close();
            }
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [connectWebSocket, usePolling, fetchData]);

    const sendControl = async (device: string, enabled?: boolean, scale?: number) => {
        try {
            const response = await fetch(`/api/device/${device}/control`, {
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
            const response = await fetch(`/api/device/${device}/sensor/${sensor}/threshold`, {
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