
"use client";

import { useEffect, useState } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import ConnectionStatusIndicator from "@/components/dashboard/ConnectionStatusIndicator"; // Used in Header
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2, LineChart as LineChartIcon, Info } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartJsTitle,
  Tooltip as ChartJsTooltip,
  Legend as ChartJsLegend,
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format as formatDate, parseISO } from 'date-fns';

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

interface SensorDataEvent {
  topic: string;
  payload: {
    value: number;
    unit?: string;
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
  topic: string; 
  displayName: string;
  lastUpdateTimestamp: string | null; // Store raw ISO string
}

interface SensorsState {
  [topic: string]: SensorDisplayData; 
}

function formatTopicName(topic: string): string {
  const parts = topic.split('/');
  // Use the last non-empty part or "Sensor" if all parts are empty or topic is simple
  const significantPart = parts.filter(p => p.length > 0).pop() || "Sensor";
  return significantPart.charAt(0).toUpperCase() + significantPart.slice(1).replace(/([A-Z])/g, ' $1').trim();
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
      transports: ['websocket'], 
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
      if (status.connected) setIsSocketConnecting(false); // Also set connecting to false if MQTT connects
    });

    newSocket.on('sensor_data', (data: SensorDataEvent) => {
      console.log('[DashboardPage] Sensor Data Received:', data);
      setLastSensorError(null); 

      setSensors(prevSensors => {
        const existingSensor = prevSensors[data.topic];
        
        let unit = data.payload.unit || 'N/A'; 
        if (unit === 'N/A') { // Infer if not provided and default
            if (data.topic.toLowerCase().includes('temperature')) unit = '°C';
            else if (data.topic.toLowerCase().includes('humidity')) unit = '%';
            else if (data.topic.toLowerCase().includes('pressure')) unit = 'hPa';
        }

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
            lastUpdateTimestamp: data.payload.timestamp, // Store the raw ISO string
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
      return { text: "Connecting to real-time service...", Icon: Loader2, color: "text-yellow-500", iconColor: "text-yellow-500", className: "animate-spin" };
    }
    if (!socket?.connected && !isSocketConnecting) {
         return { text: mqttStatus.message || "Socket.IO not connected to server.", Icon: WifiOff, color: "text-red-500", iconColor: "text-red-500"};
    }
    if (mqttStatus.connected) {
      return { text: mqttStatus.message, Icon: Wifi, color: "text-green-500", iconColor: "text-green-500" };
    }
    const isError = mqttStatus.message.toLowerCase().includes('error') || mqttStatus.message.toLowerCase().includes('offline') || mqttStatus.message.toLowerCase().includes('closed') || mqttStatus.message.toLowerCase().includes('failed');
    return {
      text: mqttStatus.message,
      Icon: isError ? WifiOff : Loader2,
      color: isError ? "text-red-500" : "text-yellow-500",
      iconColor: isError ? "text-red-500" : "text-yellow-500",
      className: !isError && !mqttStatus.connected ? "animate-spin" : ""
    };
  };
  
  const mqttDisplay = getMqttStatusDisplay();

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time' as const, 
        time: {
          unit: 'second' as const,
          tooltipFormat: 'PPpp' as const, 
          displayFormats: {
            second: 'HH:mm:ss' as const, 
          },
        },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
          color: 'hsl(var(--muted-foreground))',
        },
        grid: {
          display: false,
        }
      },
      y: {
        beginAtZero: false,
        grid: {
          color: 'hsl(var(--border))', 
        },
        ticks: {
          color: 'hsl(var(--muted-foreground))',
        }
      },
    },
    plugins: {
      legend: {
        display: false, 
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
        tension: 0.2, 
        borderColor: 'hsl(var(--primary))',
        borderWidth: 2,
        fill: true,
        backgroundColor: 'hsla(var(--primary), 0.1)',
      },
      point: {
        radius: 0, 
        hoverRadius: 5,
        backgroundColor: 'hsl(var(--primary))',
      },
    },
  };
  
  const formatDisplayTimestamp = (isoTimestamp: string | null): string => {
    if (!isoTimestamp) return 'N/A';
    try {
      return formatDate(parseISO(isoTimestamp), 'HH:mm:ss dd/MM/yyyy');
    } catch (e) {
      console.warn("Failed to parse timestamp:", isoTimestamp, e);
      return 'Invalid Date';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        {/* Title is now in global Header, ConnectionStatusIndicator also in Header */}
      </div>

      <Card className="border border-border shadow-md">
        <CardHeader>
          <CardTitle className="font-headline flex items-center text-xl">
            <mqttDisplay.Icon className={`mr-3 h-6 w-6 ${mqttDisplay.iconColor} ${mqttDisplay.className || ''}`} />
            MQTT Broker Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-base font-medium ${mqttDisplay.color}`}>
            {mqttDisplay.text}
          </p>
           <p className="text-xs text-muted-foreground mt-2">API Service Status: {backendApiStatusMessage}</p>
        </CardContent>
      </Card>

      {lastSensorError && (
        <Card className="bg-destructive/10 border-destructive/30 shadow-md">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 shrink-0" />Sensor Data Error
            </CardTitle>
          </CardHeader>
          <CardContent className="text-destructive text-sm space-y-1">
            <p><strong>Topic:</strong> {lastSensorError.topic}</p>
            <p><strong>Details:</strong> {lastSensorError.error}.</p>
            <p><strong>Received:</strong> "{lastSensorError.rawMessage.substring(0,100)}{lastSensorError.rawMessage.length > 100 ? '...' : '' }"</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
        {Object.keys(sensors).length === 0 && !isSocketConnecting && mqttStatus.connected && (
          <Card className="md:col-span-1 lg:col-span-2 xl:col-span-3 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center"><Info className="mr-2 h-5 w-5 text-primary"/>Waiting for Sensor Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No sensor data has been received yet. Ensure your sensors are publishing to the configured MQTT topics (e.g., {process.env.NEXT_PUBLIC_MQTT_BASE_TOPIC || "sensorflow/demo/"}&lt;sensor_name&gt;).</p>
            </CardContent>
          </Card>
        )}

        {Object.values(sensors).map((sensor) => {
          const chartData = {
            labels: sensor.history.map(p => parseISO(p.timestamp)), 
            datasets: [
              {
                label: sensor.displayName,
                data: sensor.history.map(p => p.value),
              },
            ],
          };
          let IconComponent = LineChartIcon; 
          if (sensor.topic.toLowerCase().includes('temperature')) IconComponent = Thermometer;
          if (sensor.topic.toLowerCase().includes('humidity')) IconComponent = Droplets;

          return (
            <Card key={sensor.topic} className="hover:shadow-xl transition-shadow duration-300 ease-in-out border border-border">
              <CardHeader className="pb-2">
                <CardTitle className="font-headline flex items-center justify-between text-xl">
                  <span className="flex items-center">
                    <IconComponent className="mr-2 h-5 w-5 text-primary shrink-0" />
                    {sensor.displayName}
                  </span>
                  <span className="text-2xl font-bold text-right text-primary">
                    {sensor.latestValue !== null ? `${sensor.latestValue.toFixed(1)} ${sensor.unit}` : '--'}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Topic: {sensor.topic} <br/>
                  Last update: {formatDisplayTimestamp(sensor.lastUpdateTimestamp)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-60 w-full"> 
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
      
      {Object.keys(sensors).length > 0 && (
        <Card className="shadow-md mt-8 border border-border">
          <CardHeader>
            <CardTitle className="font-headline text-xl">Sensor Summary</CardTitle>
            <CardDescription>Latest readings from all active sensors.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sensor</TableHead>
                  <TableHead className="text-right">Latest Value</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.values(sensors).sort((a,b) => a.displayName.localeCompare(b.displayName)).map((sensor) => (
                  <TableRow key={sensor.topic}>
                    <TableCell className="font-medium">{sensor.displayName}</TableCell>
                    <TableCell className="text-right">{sensor.latestValue !== null ? sensor.latestValue.toFixed(1) : '--'}</TableCell>
                    <TableCell>{sensor.unit}</TableCell>
                    <TableCell>{formatDisplayTimestamp(sensor.lastUpdateTimestamp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
