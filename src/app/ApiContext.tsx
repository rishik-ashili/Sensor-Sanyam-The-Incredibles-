import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

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
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 10000; // 10 seconds

export function ApiProvider({ children }: { children: React.ReactNode }) {
    const [sensors, setSensors] = useState<Record<string, ApiSensorData[]>>({});
    const [deviceStates, setDeviceStates] = useState<Record<string, ApiDeviceState>>({});
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [usePolling, setUsePolling] = useState(false);
    const [reconnectAttempts, setReconnectAttempts] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const connectionTimeoutRef = useRef<NodeJS.Timeout>();

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

    const cleanupWebSocket = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close(1000, 'Cleanup');
            wsRef.current = null;
        }
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
        }
    }, []);

    const connectWebSocket = useCallback(() => {
        cleanupWebSocket();

        try {
            // Determine if we're on HTTPS
            const isSecure = window.location.protocol === 'https:';
            const wsProtocol = isSecure ? 'wss' : 'ws';

            // Use relative WebSocket URL with appropriate protocol and path
            const wsUrl = `${wsProtocol}://${window.location.hostname}:3001/ws`;
            console.log('Connecting to WebSocket:', wsUrl);

            const wsInstance = new WebSocket(wsUrl);
            wsRef.current = wsInstance;

            // Set connection timeout
            connectionTimeoutRef.current = setTimeout(() => {
                if (wsInstance.readyState !== WebSocket.OPEN) {
                    console.log('WebSocket connection timeout');
                    wsInstance.close();
                    setUsePolling(true);
                }
            }, CONNECTION_TIMEOUT);

            wsInstance.onopen = () => {
                console.log('API WebSocket connected');
                setIsConnected(true);
                setError(null);
                setUsePolling(false);
                setReconnectAttempts(0);

                // Clear connection timeout
                if (connectionTimeoutRef.current) {
                    clearTimeout(connectionTimeoutRef.current);
                }

                // Start heartbeat
                heartbeatIntervalRef.current = setInterval(() => {
                    if (wsInstance.readyState === WebSocket.OPEN) {
                        wsInstance.send(JSON.stringify({ type: 'ping' }));
                    }
                }, HEARTBEAT_INTERVAL);
            };

            wsInstance.onclose = (event) => {
                console.log('API WebSocket disconnected:', event.code, event.reason);
                setIsConnected(false);
                setError('Disconnected from API server');
                setUsePolling(true);

                // Clear connection timeout
                if (connectionTimeoutRef.current) {
                    clearTimeout(connectionTimeoutRef.current);
                }

                // Attempt to reconnect if not closed cleanly
                if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        setReconnectAttempts(prev => prev + 1);
                        connectWebSocket();
                    }, RECONNECT_DELAY);
                }
            };

            wsInstance.onerror = (event) => {
                console.error('API WebSocket error:', event);
                setError('WebSocket error occurred');
                setUsePolling(true);
            };

            wsInstance.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Handle heartbeat response
                    if (data.type === 'pong') {
                        return;
                    }

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
        } catch (e) {
            console.error('Error creating WebSocket connection:', e);
            setError('Failed to create WebSocket connection');
            setUsePolling(true);
        }
    }, [reconnectAttempts, cleanupWebSocket]);

    useEffect(() => {
        // Start with polling immediately
        setUsePolling(true);
        fetchData();

        // Try WebSocket connection
        connectWebSocket();

        // Set up polling interval
        const pollingInterval = setInterval(() => {
            if (usePolling) {
                fetchData();
            }
        }, POLLING_INTERVAL);

        return () => {
            cleanupWebSocket();
            clearInterval(pollingInterval);
        };
    }, [connectWebSocket, usePolling, fetchData, cleanupWebSocket]);

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