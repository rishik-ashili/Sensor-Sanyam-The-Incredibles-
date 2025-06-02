
"use client";

import { useEffect, useState } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client'; // Renamed to ClientSocket to avoid conflict
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConnectionStatusIndicator from "@/components/dashboard/ConnectionStatusIndicator"; // For general backend status
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2 } from 'lucide-react';

// Define types for sensor data and MQTT status
interface SensorData {
  topic: string;
  payload: {
    value: number;
    unit?: string; 
  };
}

interface MqttStatus {
  connected: boolean;
  message: string;
}

interface SensorErrorData {
  topic: string;
  rawMessage: string;
  error: string;
}

export default function DashboardPage() {
  const [backendApiStatusMessage, setBackendApiStatusMessage] = useState<string>('Checking API status...');
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>({ connected: false, message: 'Initializing MQTT connection...' });
  const [temperature, setTemperature] = useState<number | null>(null);
  const [humidity, setHumidity] = useState<number | null>(null);
  const [socket, setSocket] = useState<ClientSocket | null>(null);
  const [lastSensorError, setLastSensorError] = useState<SensorErrorData | null>(null);
  const [isSocketConnecting, setIsSocketConnecting] = useState<boolean>(true);

  // Effect for fetching initial backend API status (standard API call)
  useEffect(() => {
    async function fetchBackendStatus() {
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          setBackendApiStatusMessage(data.message || 'Backend API is responsive.');
        } else {
          setBackendApiStatusMessage(`Backend API error: ${response.statusText} (Status: ${response.status})`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setBackendApiStatusMessage(`Failed to connect to backend API: ${errorMessage}`);
      }
    }
    fetchBackendStatus();
  }, []);

  // Effect for Socket.IO connection and event listeners
  useEffect(() => {
    // Ensure this runs only on the client
    if (typeof window === "undefined") return;

    console.log('[DashboardPage] Attempting to connect Socket.IO client...');
    setIsSocketConnecting(true);

    const newSocket: ClientSocket = io({
      path: '/api/socketio',
      addTrailingSlash: false,
      transports: ['websocket'], 
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[DashboardPage] Socket.IO connected to server:', newSocket.id);
      setIsSocketConnecting(false);
      // Initial MQTT status will be emitted by server upon connection or received via 'mqtt_status'
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[DashboardPage] Socket.IO disconnected from server. Reason:', reason);
      setIsSocketConnecting(false); // Or true if it will attempt to reconnect
      setMqttStatus({ connected: false, message: `Socket disconnected (${reason}). MQTT status unknown.` });
    });
    
    newSocket.on('connect_error', (err) => {
      // err is an Error object
      console.error('[DashboardPage] Socket.IO connection error:', err.message, err);
      setIsSocketConnecting(false);
      const errorMessage = err.message || 'Unknown socket connection error';
      setMqttStatus({ connected: false, message: `Socket connection error: ${errorMessage}. Ensure server is running and reachable.` });
    });

    newSocket.on('mqtt_status', (status: MqttStatus) => {
      console.log('[DashboardPage] MQTT Status Update:', status);
      setMqttStatus(status);
      // If MQTT is connected, ensure socket connecting indicator is false
      if (status.connected) {
        setIsSocketConnecting(false);
      }
    });

    newSocket.on('sensor_data', (data: SensorData) => {
      console.log('[DashboardPage] Sensor Data Received:', data);
      setLastSensorError(null); // Clear previous error on new data
      if (data.topic.includes('temperature')) {
        setTemperature(data.payload.value);
      } else if (data.topic.includes('humidity')) {
        setHumidity(data.payload.value);
      }
    });
    
    newSocket.on('sensor_data_error', (data: SensorErrorData) => {
      console.error('[DashboardPage] Error processing sensor data:', data);
      setLastSensorError(data);
    });

    return () => {
      console.log('[DashboardPage] Cleaning up socket connection...');
      if (newSocket.connected) {
        newSocket.disconnect();
      }
      setSocket(null);
      setIsSocketConnecting(true); // Reset for potential remount
    };
  }, []); 

  const getMqttStatusDisplay = () => {
    if (isSocketConnecting && !socket?.connected) {
      return { 
        text: "Connecting to real-time service...", 
        Icon: Loader2, 
        color: "text-yellow-500 animate-spin",
        iconColor: "text-yellow-500" 
      };
    }
    if (!socket?.connected && !isSocketConnecting) { // Socket explicitly disconnected or failed
         return { 
           text: mqttStatus.message || "Socket.IO not connected to server.", 
           Icon: WifiOff, 
           color: "text-red-500",
           iconColor: "text-red-500"
        };
    }
    // Socket is connected, now check MQTT status
    if (mqttStatus.connected) {
      return { 
        text: mqttStatus.message, 
        Icon: Wifi, 
        color: "text-green-500",
        iconColor: "text-green-500"
      };
    }
    // Socket connected, but MQTT has an issue or is (re)connecting
    const isError = mqttStatus.message.toLowerCase().includes('error') || mqttStatus.message.toLowerCase().includes('offline') || mqttStatus.message.toLowerCase().includes('closed');
    return {
      text: mqttStatus.message,
      Icon: isError ? WifiOff : Loader2, // Loader if (re)connecting, WifiOff if error/closed
      color: isError ? "text-red-500" : "text-yellow-500",
      iconColor: isError ? "text-red-500" : "text-yellow-500",
      className: !isError ? "animate-spin" : ""
    };
  };
  
  const mqttDisplay = getMqttStatusDisplay();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-headline font-semibold">Dashboard</h1>
        <ConnectionStatusIndicator /> 
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline flex items-center">
            <mqttDisplay.Icon className={`mr-2 h-5 w-5 ${mqttDisplay.iconColor} ${mqttDisplay.className || ''}`} />
            MQTT Broker Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm font-medium ${mqttDisplay.color}`}>
            {mqttDisplay.text}
          </p>
           <p className="text-xs text-muted-foreground mt-1">API Service Status: {backendApiStatusMessage}</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline">Latest Sensor Data</CardTitle>
          </CardHeader>
          <CardContent>
            {lastSensorError && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-xs">
                <p className="flex items-center"><AlertTriangle className="h-4 w-4 mr-2 shrink-0" /><strong>Sensor Data Error:</strong></p>
                <p>Topic: {lastSensorError.topic}</p>
                <p>Details: {lastSensorError.error}. Received: "{lastSensorError.rawMessage.substring(0,100)}{lastSensorError.rawMessage.length > 100 ? '...' : '' }"</p>
              </div>
            )}
            <div className="space-y-4">
              <div className="p-4 bg-secondary/50 rounded-lg shadow-md">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-lg flex items-center"><Thermometer className="mr-2 h-5 w-5 text-primary" />Temperature</p>
                  <p className="text-3xl font-bold">{temperature !== null ? `${temperature.toFixed(1)} °C` : '-- °C'}</p>
                </div>
              </div>
              <div className="p-4 bg-secondary/50 rounded-lg shadow-md">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-lg flex items-center"><Droplets className="mr-2 h-5 w-5 text-primary" />Humidity</p>
                  <p className="text-3xl font-bold">{humidity !== null ? `${humidity.toFixed(1)} %` : '-- %'}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Sensor Data Graphs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Interactive graphs will be displayed here.</p>
            <div className="mt-4 h-64 bg-secondary/50 rounded-md flex items-center justify-center">
              <p className="text-muted-foreground">Graph Area</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
