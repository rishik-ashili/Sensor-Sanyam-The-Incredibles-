"use client";

import { useEffect, useState, useMemo, useCallback } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2, LineChart as LineChartIcon, Info, Clock, ChevronDown, XCircle } from 'lucide-react';
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
import { format as formatDate, parseISO, subMinutes, isAfter } from 'date-fns';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import GridLayout, { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

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

const MAX_HISTORY_POINTS_CLIENT = 50; // Max history points to keep on client if receiving rapidly before initial load
type TimeRangeOption = 'all' | '5m' | '15m';

interface MqttStatus {
  connected: boolean;
  message: string;
}

interface HistoryPoint {
  value: number;
  timestamp: string; // ISO string
}

interface SensorDataEventPayload {
  value: number;
  unit?: string;
  timestamp: string; // ISO string
}

interface SensorDataEvent {
  topic: string;
  payload: SensorDataEventPayload;
}

interface InitialSensorHistoryEvent {
  topic: string;
  history: HistoryPoint[];
  unit?: string;
}

interface SensorErrorData {
  topic: string;
  rawMessage: string;
  error: string;
}

interface SensorDisplayData {
  latestValue: number | null;
  unit: string;
  history: HistoryPoint[];
  topic: string;
  displayName: string;
  lastUpdateTimestamp: string | null; // Store raw ISO string
  device?: string;
  coordinates?: { lat: number; lon: number };
}

interface SensorsState {
  [topic: string]: SensorDisplayData;
}

function formatTopicName(topic: string): string {
  const parts = topic.split('/');
  const significantPart = parts.filter(p => p.length > 0).pop() || "Sensor";
  return significantPart.charAt(0).toUpperCase() + significantPart.slice(1).replace(/([A-Z])/g, ' $1').trim();
}

const ResponsiveGridLayout = WidthProvider(Responsive);

export default function DashboardPage() {
  const [backendApiStatusMessage, setBackendApiStatusMessage] = useState<string>('Checking API status...');
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>({ connected: false, message: 'Initializing MQTT connection...' });
  const [sensors, setSensors] = useState<SensorsState>({});
  const [socket, setSocket] = useState<ClientSocket | null>(null);
  const [lastSensorError, setLastSensorError] = useState<SensorErrorData | null>(null);
  const [isSocketConnecting, setIsSocketConnecting] = useState<boolean>(true);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeOption>('all');
  const [minimized, setMinimized] = useState<{ [key: string]: boolean }>({});
  const [deleted, setDeleted] = useState<{ [key: string]: boolean }>({});
  const [layoutByDevice, setLayoutByDevice] = useState<{ [device: string]: Layout[] }>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sensorGridLayoutByDevice');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

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
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      forceNew: true,
      autoConnect: true,
      withCredentials: false,
      extraHeaders: {
        "Access-Control-Allow-Origin": "*"
      }
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

    newSocket.on('initial_sensor_history', (data: InitialSensorHistoryEvent) => {
      console.log(`[DashboardPage] Received initial_sensor_history for ${data.topic}`, data);
      setSensors(prevSensors => {
        const latestPoint = data.history.length > 0 ? data.history[data.history.length - 1] : null;
        const device = data.history.length > 0 && (data.history[data.history.length - 1] as any).device;
        const coordinates = data.history.length > 0 && (data.history[data.history.length - 1] as any).coordinates;
        return {
          ...prevSensors,
          [data.topic]: {
            latestValue: latestPoint ? latestPoint.value : null,
            unit: data.unit || prevSensors[data.topic]?.unit || 'N/A',
            history: data.history,
            topic: data.topic,
            displayName: formatTopicName(data.topic),
            lastUpdateTimestamp: latestPoint ? latestPoint.timestamp : null,
            device: device || prevSensors[data.topic]?.device || 'Unknown',
            coordinates: coordinates || prevSensors[data.topic]?.coordinates,
          },
        };
      });
    });

    newSocket.on('sensor_data', (data: SensorDataEvent) => {
      console.log('[DashboardPage] Sensor Data Received:', data);
      setLastSensorError(null);

      setSensors(prevSensors => {
        const existingSensor = prevSensors[data.topic];

        let unit = data.payload.unit || existingSensor?.unit || 'N/A';
        if (unit === 'N/A') {
          if (data.topic.toLowerCase().includes('temperature')) unit = '°C';
          else if (data.topic.toLowerCase().includes('humidity')) unit = '%';
          else if (data.topic.toLowerCase().includes('pressure')) unit = 'hPa';
        }

        const newHistoryEntry: HistoryPoint = { value: data.payload.value, timestamp: data.payload.timestamp };

        const updatedHistory = existingSensor
          ? [...existingSensor.history, newHistoryEntry]
          : [newHistoryEntry];

        const trimmedHistory = updatedHistory.slice(-MAX_HISTORY_POINTS_CLIENT);

        return {
          ...prevSensors,
          [data.topic]: {
            latestValue: data.payload.value,
            unit: unit,
            history: trimmedHistory,
            topic: data.topic,
            displayName: existingSensor?.displayName || formatTopicName(data.topic),
            lastUpdateTimestamp: data.payload.timestamp,
            device: (data.payload as any).device || existingSensor?.device || 'Unknown',
            coordinates: (data.payload as any).coordinates || existingSensor?.coordinates,
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

  // Persist layoutByDevice
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sensorGridLayoutByDevice', JSON.stringify(layoutByDevice));
      localStorage.setItem('sensorDeleted', JSON.stringify(deleted));
      localStorage.setItem('sensorMinimized', JSON.stringify(minimized));
    }
  }, [layoutByDevice, deleted, minimized]);

  // Restore deleted/minimized state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const del = localStorage.getItem('sensorDeleted');
      if (del) setDeleted(JSON.parse(del));
      const min = localStorage.getItem('sensorMinimized');
      if (min) setMinimized(JSON.parse(min));
    }
  }, []);

  const getMqttStatusDisplay = () => {
    if (isSocketConnecting && !socket?.connected) {
      return { text: "Connecting to real-time service...", Icon: Loader2, color: "text-yellow-500", iconColor: "text-yellow-500", className: "animate-spin" };
    }
    if (!socket?.connected && !isSocketConnecting) {
      return { text: mqttStatus.message || "Socket.IO not connected to server.", Icon: WifiOff, color: "text-red-500", iconColor: "text-red-500" };
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
        grid: { display: false }
      },
      y: {
        beginAtZero: false,
        grid: { color: 'hsl(var(--border))' },
        ticks: { color: 'hsl(var(--muted-foreground))' }
      },
    },
    plugins: {
      legend: { display: false },
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

  const getFilteredHistory = (history: HistoryPoint[], range: TimeRangeOption): HistoryPoint[] => {
    if (range === 'all' || history.length === 0) return history;

    const now = parseISO(history[history.length - 1].timestamp); // Use latest point as 'now'
    let startTime: Date;

    if (range === '5m') {
      startTime = subMinutes(now, 5);
    } else if (range === '15m') {
      startTime = subMinutes(now, 15);
    } else {
      return history; // Should not happen if range is 'all'
    }
    return history.filter(point => isAfter(parseISO(point.timestamp), startTime));
  };

  const timeRangeOptions: { label: string; value: TimeRangeOption }[] = [
    { label: 'All History', value: 'all' },
    { label: 'Last 5 Minutes', value: '5m' },
    { label: 'Last 15 Minutes', value: '15m' },
  ];

  const sensorsByDevice = useMemo(() => {
    const grouped: { [device: string]: SensorDisplayData[] } = {};
    Object.values(sensors).forEach(sensor => {
      const device = sensor.device || 'Unknown';
      if (!grouped[device]) grouped[device] = [];
      grouped[device].push(sensor);
    });
    return grouped;
  }, [sensors]);

  const getGridLayout = useCallback((device: string, deviceSensors: SensorDisplayData[]) => {
    const layout = layoutByDevice[device];
    if (layout && layout.length > 0) {
      // Only return layout for sensors in this device group
      return layout.filter(l => deviceSensors.some(s => s.topic === l.i));
    }
    // Default grid: 3 per row
    return deviceSensors.filter(s => !deleted[s.topic]).map((sensor, i) => ({
      i: sensor.topic,
      x: (i % 3) * 2,
      y: Math.floor(i / 3) * 2,
      w: 2,
      h: minimized[sensor.topic] ? 1 : 4,
      minW: 2,
      minH: 1,
      maxH: 8,
      maxW: 4,
      static: false,
    }));
  }, [layoutByDevice, deleted, minimized]);

  // Helper to get coordinates for a device group
  const getDeviceCoordinates = (deviceSensors: SensorDisplayData[]) => {
    const sensorWithCoords = deviceSensors.find(s => s.coordinates);
    return sensorWithCoords?.coordinates;
  };

  return (
    <div className="space-y-8 p-2 md:p-6">
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
            <p><strong>Received:</strong> "{lastSensorError.rawMessage.substring(0, 100)}{lastSensorError.rawMessage.length > 100 ? '...' : ''}"</p>
          </CardContent>
        </Card>
      )}

      <Card className="border border-border shadow-md">
        <CardHeader>
          <CardTitle className="font-headline flex items-center text-lg">
            <Clock className="mr-2 h-5 w-5 text-primary" />
            Graph Time Range
          </CardTitle>
          <CardDescription>Select the historical data range to display on the charts.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {timeRangeOptions.map(opt => (
            <Button
              key={opt.value}
              variant={selectedTimeRange === opt.value ? 'default' : 'outline'}
              onClick={() => setSelectedTimeRange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Button
        className="mb-4 mt-4"
        variant="secondary"
        onClick={() => {
          setDeleted({});
          setMinimized({});
          if (typeof window !== 'undefined') {
            localStorage.removeItem('sensorDeleted');
            localStorage.removeItem('sensorMinimized');
          }
        }}
      >
        Restore All Tiles
      </Button>

      <Accordion type="multiple" collapsible="true" defaultValue={Object.keys(sensorsByDevice)}>
        {Object.entries(sensorsByDevice).map(([device, deviceSensors]) => {
          const coords = getDeviceCoordinates(deviceSensors);
          return (
            <AccordionItem value={device} key={device}>
              <AccordionTrigger>
                {device}
                {coords && (
                  <span className="ml-4 text-xs text-muted-foreground">({coords.lat}, {coords.lon})</span>
                )}
              </AccordionTrigger>
              <AccordionContent>
                <ResponsiveGridLayout
                  className="layout"
                  layouts={{ lg: getGridLayout(device, deviceSensors) }}
                  breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                  cols={{ lg: 6, md: 4, sm: 2, xs: 1, xxs: 1 }}
                  rowHeight={80}
                  isResizable
                  isDraggable
                  onLayoutChange={l => setLayoutByDevice(prev => ({ ...prev, [device]: l }))}
                  measureBeforeMount={false}
                  useCSSTransforms={true}
                  compactType="vertical"
                  preventCollision={false}
                >
                  {deviceSensors.filter(s => !deleted[s.topic]).map((sensor) => {
                    const displayHistory = getFilteredHistory(sensor.history, selectedTimeRange);
                    const chartData = {
                      labels: displayHistory.map(p => parseISO(p.timestamp)),
                      datasets: [
                        {
                          label: sensor.displayName,
                          data: displayHistory.map(p => p.value),
                        },
                      ],
                    };
                    let IconComponent = LineChartIcon;
                    if (sensor.topic.toLowerCase().includes('temperature')) IconComponent = Thermometer;
                    if (sensor.topic.toLowerCase().includes('humidity')) IconComponent = Droplets;
                    const grid = (layoutByDevice[device] || []).find(l => l.i === sensor.topic) || { i: sensor.topic, x: 0, y: 0, w: 2, h: 4 };
                    return (
                      <div key={sensor.topic} data-grid={grid}>
                        <Card className="hover:shadow-xl transition-shadow duration-300 ease-in-out border border-border relative">
                          <div className="absolute top-2 right-2 flex gap-2 z-10">
                            <Button size="icon" variant="ghost" onClick={() => setMinimized(m => ({ ...m, [sensor.topic]: !m[sensor.topic] }))} title={minimized[sensor.topic] ? 'Maximize' : 'Minimize'}>
                              {minimized[sensor.topic] ? <ChevronDown className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 rotate-180" />}
                            </Button>
                            <Button size="icon" variant="destructive" onClick={() => setDeleted(d => ({ ...d, [sensor.topic]: true }))} title="Delete">
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
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
                              Topic: {sensor.topic} <br />
                              Last update: {formatDisplayTimestamp(sensor.lastUpdateTimestamp)}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {!minimized[sensor.topic] && (
                              <div className="h-60 w-full">
                                {displayHistory.length > 1 ? (
                                  <Line options={chartOptions as any} data={chartData} />
                                ) : (
                                  <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <p>{sensor.history.length === 0 ? "No data yet." : (displayHistory.length <= 1 ? "Need more data for selected range to plot graph." : "Need more data to plot graph.")}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </ResponsiveGridLayout>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {Object.keys(sensors).length > 0 && (
        <Card className="shadow-md mt-8 border border-border">
          <CardHeader>
            <CardTitle className="font-headline text-xl">Sensor Summary</CardTitle>
            <CardDescription>Latest readings from all active sensors.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
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
                {Object.values(sensors).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((sensor) => (
                  <TableRow key={sensor.topic}>
                    <TableCell className="font-medium whitespace-nowrap">{sensor.displayName}</TableCell>
                    <TableCell className="text-right">{sensor.latestValue !== null ? sensor.latestValue.toFixed(1) : '--'}</TableCell>
                    <TableCell>{sensor.unit}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDisplayTimestamp(sensor.lastUpdateTimestamp)}</TableCell>
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

