
"use client";

import { useEffect, useState } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import ConnectionStatusIndicator from "@/components/dashboard/ConnectionStatusIndicator";
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2, LineChart as LineChartIcon } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartJsTitle, // Renamed to avoid conflict
  Tooltip as ChartJsTooltip, // Renamed to avoid conflict
  Legend as ChartJsLegend,
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format } from 'date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartJsTitle,
  ChartJsTooltip,
  ChartJsLegend,
  TimeScale
);

const MAX_HISTORY_POINTS = 50;

interface MqttStatus {
  connected: boolean;
  message: string;
}

// For data received from socket
interface SensorDataEvent {
  topic: string;
  payload: {
    value: number;
    unit?: string; // Unit might come from payload or be inferred
    timestamp: string; // ISO string
  };
}

interface SensorErrorData {
  topic: string;
  rawMessage: string;
  error: string;
}

interface HistoryPoint {
  value: number;
  timestamp: string; // ISO string
}

interface SensorDisplayData {
  latestValue: number | null;
  unit: string;
  history: HistoryPoint[];
  topic: string; // Original topic
  displayName: string; // Formatted name for display
}

interface SensorsState {
  [topic: string]: SensorDisplayData; // Keyed by original topic
}

function formatTopicName(topic: string): string {
  const parts = topic.split('/');
  const lastPart = parts[parts.length - 1] || "Sensor";
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).replace(/([A-Z])/g, ' $1').trim() + " Data";
}


export default function DashboardPage() {
  const [backendApiStatusMessage, setBackendApiStatusMessage] = useState<string>('Checking API status...');
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>({ connected: false, message: 'Initializing MQTT connection...' });
  const [sensors, setSensors] = useState<SensorsState>({});
  const [socket, setSocket] = useState<ClientSocket | null>(null);
  const [lastSensorError, setLastSensorError] = useState<SensorErrorData | null>(null);
  const [isSocketConnecting, setIsSocketConnecting] = useState<boolean>(true);

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    console.log('[DashboardPage] Attempting to connect Socket.IO client...');
    setIsSocketConnecting(true);

    const newSocket: ClientSocket = io({
      path: '/api/socketio',
      addTrailingSlash: false,
      transports: ['websocket'], // Explicitly use WebSocket transport
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[DashboardPage] Socket.IO connected to server:', newSocket.id);
      setIsSocketConnecting(false);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[DashboardPage] Socket.IO disconnected from server. Reason:', reason);
      setIsSocketConnecting(false);
      setMqttStatus({ connected: false, message: `Socket disconnected (${reason}). MQTT status unknown.` });
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('[DashboardPage] Socket.IO connection error:', err.message, err);
      setIsSocketConnecting(false);
      const errorMessage = err.message || 'Unknown socket connection error';
      setMqttStatus({ connected: false, message: `Socket connection error: ${errorMessage}. Ensure server is running and reachable.` });
    });

    newSocket.on('mqtt_status', (status: MqttStatus) => {
      console.log('[DashboardPage] MQTT Status Update:', status);
      setMqttStatus(status);
      if (status.connected) setIsSocketConnecting(false);
    });

    newSocket.on('sensor_data', (data: SensorDataEvent) => {
      console.log('[DashboardPage] Sensor Data Received:', data);
      setLastSensorError(null); 

      setSensors(prevSensors => {
        const existingSensor = prevSensors[data.topic];
        
        let unit = data.payload.unit || 'N/A'; // Prefer unit from payload
        if (data.topic.includes('temperature')) {
          unit = '°C';
        } else if (data.topic.includes('humidity')) {
          unit = '%';
        }
        // Add more specific unit inferences if needed

        const newHistoryEntry: HistoryPoint = { value: data.payload.value, timestamp: data.payload.timestamp };
        
        const updatedHistory = existingSensor
          ? [...existingSensor.history, newHistoryEntry]
          : [newHistoryEntry];
        
        const trimmedHistory = updatedHistory.slice(-MAX_HISTORY_POINTS);

        return {
          ...prevSensors,
          [data.topic]: {
            latestValue: data.payload.value,
            unit: unit,
            history: trimmedHistory,
            topic: data.topic,
            displayName: formatTopicName(data.topic),
          },
        };
      });
    });
    
    newSocket.on('sensor_data_error', (data: SensorErrorData) => {
      console.error('[DashboardPage] Error processing sensor data:', data);
      setLastSensorError(data);
    });

    return () => {
      console.log('[DashboardPage] Cleaning up socket connection...');
      if (newSocket.connected) newSocket.disconnect();
      setSocket(null);
      setIsSocketConnecting(true);
    };
  }, []); 

  const getMqttStatusDisplay = () => {
    if (isSocketConnecting && !socket?.connected) {
      return { text: "Connecting to real-time service...", Icon: Loader2, color: "text-yellow-500 animate-spin", iconColor: "text-yellow-500" };
    }
    if (!socket?.connected && !isSocketConnecting) {
         return { text: mqttStatus.message || "Socket.IO not connected to server.", Icon: WifiOff, color: "text-red-500", iconColor: "text-red-500"};
    }
    if (mqttStatus.connected) {
      return { text: mqttStatus.message, Icon: Wifi, color: "text-green-500", iconColor: "text-green-500" };
    }
    const isError = mqttStatus.message.toLowerCase().includes('error') || mqttStatus.message.toLowerCase().includes('offline') || mqttStatus.message.toLowerCase().includes('closed');
    return {
      text: mqttStatus.message,
      Icon: isError ? WifiOff : Loader2,
      color: isError ? "text-red-500" : "text-yellow-500",
      iconColor: isError ? "text-red-500" : "text-yellow-500",
      className: !isError ? "animate-spin" : ""
    };
  };
  
  const mqttDisplay = getMqttStatusDisplay();

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time' as const, // Necessary for chartjs-adapter-date-fns
        time: {
          unit: 'second' as const,
          tooltipFormat: 'PPpp' as const, // 'Oct 19, 2023, 11:05:12 AM'
          displayFormats: {
            second: 'HH:mm:ss' as const, // Display format for the x-axis labels
          },
        },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10, // Limit number of ticks to avoid clutter
        },
        grid: {
          display: false,
        }
      },
      y: {
        beginAtZero: false, // Adjust as needed, true if values are always positive
        grid: {
          color: 'hsl(var(--border))', // Use theme border color
        },
        ticks: {
          color: 'hsl(var(--muted-foreground))',
        }
      },
    },
    plugins: {
      legend: {
        display: false, //  No legend needed for single dataset per chart
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'hsl(var(--popover))',
        titleColor: 'hsl(var(--popover-foreground))',
        bodyColor: 'hsl(var(--popover-foreground))',
        borderColor: 'hsl(var(--border))',
        borderWidth: 1,
      },
    },
    elements: {
      line: {
        tension: 0.1, // Smooths the line
        borderColor: 'hsl(var(--primary))',
        borderWidth: 2,
      },
      point: {
        radius: 0, // No points by default
        hoverRadius: 4,
        backgroundColor: 'hsl(var(--primary))',
      },
    },
  };


  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-headline font-semibold">Sensor Dashboard</h1>
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

      {lastSensorError && (
        <Card className="bg-destructive/10 border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 shrink-0" />Sensor Data Error
            </CardTitle>
          </CardHeader>
          <CardContent className="text-destructive text-sm">
            <p><strong>Topic:</strong> {lastSensorError.topic}</p>
            <p><strong>Details:</strong> {lastSensorError.error}.</p>
            <p><strong>Received:</strong> "{lastSensorError.rawMessage.substring(0,100)}{lastSensorError.rawMessage.length > 100 ? '...' : '' }"</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
        {Object.keys(sensors).length === 0 && !isSocketConnecting && mqttStatus.connected && (
          <Card className="md:col-span-1 lg:col-span-2">
            <CardHeader>
              <CardTitle>Waiting for Sensor Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No sensor data has been received yet. Ensure your sensors are publishing to the configured MQTT topics (e.g., sensorflow/demo/temperature, sensorflow/demo/humidity).</p>
            </CardContent>
          </Card>
        )}

        {Object.values(sensors).map((sensor) => {
          const chartData = {
            labels: sensor.history.map(p => new Date(p.timestamp)), // Use Date objects for TimeScale
            datasets: [
              {
                label: sensor.displayName,
                data: sensor.history.map(p => p.value),
                fill: false,
              },
            ],
          };
          let IconComponent = LineChartIcon; // Default icon
          if (sensor.topic.includes('temperature')) IconComponent = Thermometer;
          if (sensor.topic.includes('humidity')) IconComponent = Droplets;

          return (
            <Card key={sensor.topic}>
              <CardHeader>
                <CardTitle className="font-headline flex items-center justify-between">
                  <span className="flex items-center">
                    <IconComponent className="mr-2 h-5 w-5 text-primary" />
                    {sensor.displayName}
                  </span>
                  <span className="text-2xl font-bold text-right">
                    {sensor.latestValue !== null ? `${sensor.latestValue.toFixed(1)} ${sensor.unit}` : '--'}
                  </span>
                </CardTitle>
                <CardDescription>Topic: {sensor.topic}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full"> {/* Ensure chart container has dimensions */}
                  {sensor.history.length > 1 ? (
                    <Line options={chartOptions as any} data={chartData} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <p>{sensor.history.length === 0 ? "No data yet." : "Need more data to plot graph."}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

