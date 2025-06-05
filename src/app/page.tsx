"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2, LineChart as LineChartIcon, Info, Clock, ChevronDown, XCircle, Bookmark, Circle, Bell, BellOff, Sun, Moon, Palette } from 'lucide-react';
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
  BarElement,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format as formatDate, parseISO, subMinutes, isAfter } from 'date-fns';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import GridLayout, { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Accordion as ShadAccordion, AccordionItem as ShadAccordionItem, AccordionTrigger as ShadAccordionTrigger, AccordionContent as ShadAccordionContent } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartJsTitle,
  ChartJsTooltip,
  ChartJsLegend,
  TimeScale,
  BarElement
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
  threshold?: number;  // Add threshold to interface
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

// Helper for change rate (delta)
function getDelta(arr) {
  if (arr.length < 2) return [];
  return arr.map((v, i) => (i === 0 ? null : v - arr[i - 1]));
}

// Helper for uptime (simulate: if last update < 2x interval, online)
function getUptime(timestamps, interval = 1000) {
  if (!timestamps.length) return [];
  const bins = [];
  let last = new Date(timestamps[0]).getTime();
  for (let i = 1; i < timestamps.length; i++) {
    const t = new Date(timestamps[i]).getTime();
    bins.push(t - last < interval * 2 ? 1 : 0);
    last = t;
  }
  return [1, ...bins];
}

// Helper for hourly bar chart
function getHourlyAverages(timestamps, values) {
  const byHour = {};
  timestamps.forEach((ts, i) => {
    const d = new Date(ts);
    const hour = d.getHours();
    if (!byHour[hour]) byHour[hour] = [];
    byHour[hour].push(values[i]);
  });
  return Object.keys(byHour).map(h => ({ hour: h, avg: byHour[h].reduce((a, b) => a + b, 0) / byHour[h].length }));
}

// Helper for heatmap (hour x minute, value)
function getHeatmapData(timestamps, values) {
  const map = {};
  timestamps.forEach((ts, i) => {
    const d = new Date(ts);
    const key = `${d.getHours()}:${d.getMinutes()}`;
    if (!map[key]) map[key] = [];
    map[key].push(values[i]);
  });
  return Object.entries(map).map(([k, v]) => ({ time: k, avg: v.reduce((a, b) => a + b, 0) / v.length }));
}

// Helper for histogram (all sensors)
function getAllSensorPeaks(sensors) {
  return Object.values(sensors).map(sensor => {
    const values = sensor.history.map(p => p.value);
    return values.length ? Math.max(...values) : null;
  }).filter(v => v !== null);
}

// Helper for 10s peak per sensor (dynamic, always returns a number)
function get10sPeak(sensors) {
  const now = Date.now();
  return Object.values(sensors).map(sensor => {
    const recent = sensor.history.filter(p => now - new Date(p.timestamp).getTime() <= 10000);
    const peak = recent.length ? Math.max(...recent.map(p => p.value)) : 0;
    return peak;
  });
}

// Helper to get latest energy value per device
function getLatestEnergyPerDevice(sensors) {
  // Find all sensors with topic ending in '/energy'
  const energySensors = Object.values(sensors).filter(s => s.topic.endsWith('/energy'));
  // Group by device
  const byDevice = {};
  energySensors.forEach(s => {
    const device = s.device || 'Unknown';
    if (!byDevice[device] || (s.lastUpdateTimestamp && (!byDevice[device].lastUpdateTimestamp || s.lastUpdateTimestamp > byDevice[device].lastUpdateTimestamp))) {
      byDevice[device] = s;
    }
  });
  const deviceNames = Object.keys(byDevice);
  const values = deviceNames.map(d => byDevice[d].latestValue ?? 0);
  return { deviceNames, values };
}

// Helper to get latest per-sensor energy values for a device
function getLatestEnergyPerSensorForDevice(sensors, device) {
  // Find all sensors for this device with topic ending in '/energy'
  const energySensors = Object.values(sensors).filter(s => s.device === device && /\/[^/]+\/energy$/.test(s.topic));
  // Map: sensor name (from topic) => latest value
  const sensorNames = energySensors.map(s => {
    const match = s.topic.match(/\/([^/]+)\/energy$/);
    return match ? match[1] : s.topic;
  });
  const values = energySensors.map(s => s.latestValue ?? 0);
  return { sensorNames, values };
}

// Helper to check if a sensor is an energy metric
function isEnergySensor(sensor) {
  return /\/[^/]+\/energy$/.test(sensor.topic);
}

const ThresholdDashboard = ({ sensors }: { sensors: SensorsState }) => {
  const thresholdData = Object.values(sensors).filter(s => s.threshold !== undefined && !isEnergySensor(s));

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Threshold Monitoring
        </CardTitle>
        <CardDescription>Current values vs thresholds</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {thresholdData.map((sensor) => (
            <Card key={sensor.topic} className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-medium">{sensor.displayName}</p>
                    <p className="text-xs text-muted-foreground">{sensor.device}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {sensor.latestValue?.toFixed(2)} {sensor.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Threshold: {sensor.threshold} {sensor.unit}
                    </p>
                  </div>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${sensor.latestValue && sensor.threshold && sensor.latestValue > sensor.threshold
                      ? 'bg-red-500'
                      : 'bg-green-500'
                      }`}
                    style={{
                      width: `${Math.min(
                        ((sensor.latestValue || 0) / (sensor.threshold || 1)) * 100,
                        100
                      )}%`
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default function DashboardPage() {
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [showReadyDialog, setShowReadyDialog] = useState(false);
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
  const socketRef = useRef<ClientSocket | null>(null);
  const [savedDevices, setSavedDevices] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('savedDevices');
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [minimizedAnalytics, setMinimizedAnalytics] = useState<{ [topic: string]: boolean }>({});
  const [forceUpdate, setForceUpdate] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [openDevices, setOpenDevices] = useState<string[]>([]);
  const { toast, dismiss } = useToast();
  const [notificationsOn, setNotificationsOn] = useState(false); // OFF by default
  const [loadingPeriod, setLoadingPeriod] = useState(true); // true for first 15s
  // Track toast ids for each topic
  const toastIdsRef = useRef<{ [topic: string]: string }>({});
  const [theme, setTheme] = useState<'normal' | 'dark' | 'blue'>('normal');
  const [deviceEnabled, setDeviceEnabled] = useState<{ [device: string]: boolean }>({ rpi1: true, rpi2: true });
  const [deviceScale, setDeviceScale] = useState<{ [device: string]: number }>({ rpi1: 1.0, rpi2: 1.0 });
  const scaleTimeouts = useRef<{ [device: string]: NodeJS.Timeout | null }>({ rpi1: null, rpi2: null });

  const { deviceNames, values: energyValues } = getLatestEnergyPerDevice(sensors);
  const energyBarData = {
    labels: deviceNames,
    datasets: [{
      label: 'Energy (kWh)',
      data: energyValues,
      backgroundColor: 'rgba(59,130,246,0.7)',
      borderColor: 'rgba(59,130,246,1)',
      borderWidth: 2,
      type: 'bar',
    }],
  };

  // Filtered sensors by enabled devices
  const filteredSensors = useMemo(() => {
    return Object.fromEntries(
      Object.entries(sensors).filter(([_topic, sensor]) => {
        const device = sensor.device || 'Unknown';
        return deviceEnabled[device] !== false;
      })
    );
  }, [sensors, deviceEnabled]);

  useEffect(() => {
    // Initial loading timer
    const loadingTimer = setTimeout(() => {
      setIsInitialLoading(false);
      setShowReadyDialog(true);
      setTimeout(() => {
        setShowReadyDialog(false);
      }, 1000);
    }, 15000);

    return () => {
      clearTimeout(loadingTimer);
    };
  }, []);

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
    if (socketRef.current) return; // Only one socket connection

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
    socketRef.current = newSocket;
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
        const threshold = data.history.length > 0 && (data.history[data.history.length - 1] as any).threshold;
        return {
          ...prevSensors,
          [data.topic]: {
            ...prevSensors[data.topic],
            latestValue: latestPoint ? latestPoint.value : null,
            unit: data.unit || prevSensors[data.topic]?.unit || 'N/A',
            history: data.history,
            topic: data.topic,
            displayName: formatTopicName(data.topic),
            lastUpdateTimestamp: latestPoint ? latestPoint.timestamp : null,
            device: device || prevSensors[data.topic]?.device || 'Unknown',
            coordinates: coordinates || prevSensors[data.topic]?.coordinates,
            threshold: threshold || prevSensors[data.topic]?.threshold,
          },
        };
      });
    });

    newSocket.on('sensor_data', (data: SensorDataEvent) => {
      setLastSensorError(null);
      setSensors((prevSensors: SensorsState) => {
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
            ...existingSensor,
            latestValue: data.payload.value,
            unit: unit,
            history: trimmedHistory,
            topic: data.topic,
            displayName: existingSensor?.displayName || formatTopicName(data.topic),
            lastUpdateTimestamp: data.payload.timestamp,
            device: (data.payload as any).device || existingSensor?.device || 'Unknown',
            coordinates: (data.payload as any).coordinates || existingSensor?.coordinates,
            threshold: (data.payload as any).threshold || existingSensor?.threshold,
          },
        };
      });
    });

    newSocket.on('sensor_data_error', (data: SensorErrorData) => {
      console.error('[DashboardPage] Error processing sensor data:', data);
      setLastSensorError(data);
    });

    // Clean up listeners and socket on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
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

  // Persist savedDevices
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('savedDevices', JSON.stringify(savedDevices));
    }
  }, [savedDevices]);

  // Ensure minimizedAnalytics is updated when sensors change (collapse new sensors by default)
  useEffect(() => {
    setMinimizedAnalytics(prev => {
      const updated = { ...prev };
      Object.keys(sensors).forEach(topic => {
        if (!(topic in updated)) {
          updated[topic] = true; // collapse by default
        }
      });
      // Remove topics that no longer exist
      Object.keys(updated).forEach(topic => {
        if (!(topic in sensors)) {
          delete updated[topic];
        }
      });
      return updated;
    });
  }, [sensors]);

  // 15s loading period effect
  useEffect(() => {
    const timer = setTimeout(() => setLoadingPeriod(false), 15000);
    return () => clearTimeout(timer);
  }, []);

  // Show/dismiss threshold notifications based on state
  useEffect(() => {
    if (loadingPeriod) return; // No notifications during loading
    // Dismiss all threshold notifications if notifications are turned off
    if (!notificationsOn) {
      Object.values(toastIdsRef.current).forEach(id => dismiss(id));
      toastIdsRef.current = {};
      return;
    }
    // Notifications ON: show for all above-threshold, but only for enabled devices
    Object.entries(sensors).forEach(([topic, sensor]) => {
      const device = sensor.device || 'Unknown';
      if (deviceEnabled[device] === false) return; // skip disabled devices
      if (sensor.threshold === undefined || sensor.latestValue === null || isEnergySensor(sensor)) return;
      const above = sensor.latestValue > sensor.threshold;
      const existingId = toastIdsRef.current[topic];
      if (above && !existingId) {
        // Show notification and store id
        const t = toast({
          title: `${sensor.displayName} Threshold Crossed`,
          description: `${sensor.displayName} is above threshold! Value: ${sensor.latestValue.toFixed(2)}${sensor.unit} (Threshold: ${sensor.threshold}${sensor.unit})`,
          variant: 'destructive',
          duration: 1000000,
        });
        toastIdsRef.current[topic] = t.id;
      } else if (!above && existingId) {
        // Dismiss notification if value goes below threshold
        dismiss(existingId);
        delete toastIdsRef.current[topic];
      }
    });
    // Dismiss notifications for topics that no longer exist or are disabled
    Object.keys(toastIdsRef.current).forEach(topic => {
      const sensor = sensors[topic];
      const device = sensor?.device || 'Unknown';
      if (!sensor || deviceEnabled[device] === false || sensor.threshold === undefined || sensor.latestValue === null || isEnergySensor(sensor)) {
        dismiss(toastIdsRef.current[topic]);
        delete toastIdsRef.current[topic];
      }
    });
  }, [notificationsOn, sensors, loadingPeriod, toast, dismiss, deviceEnabled]);

  // Theme effect: set class on <html>
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const html = document.documentElement;
      html.classList.remove('dark', 'blue');
      if (theme === 'dark') html.classList.add('dark');
      if (theme === 'blue') html.classList.add('blue');
    }
  }, [theme]);

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

  // Helper: get all device names from live data
  const liveDeviceNames = useMemo(() => Object.keys(sensorsByDevice), [sensorsByDevice]);

  // Helper: get all device names to show (union of saved and live)
  const allDeviceNames = useMemo(() => {
    const set = new Set([...savedDevices, ...liveDeviceNames]);
    return Array.from(set);
  }, [savedDevices, liveDeviceNames]);

  // Helper: is device online? (now also checks if enabled)
  const isDeviceOnline = (device: string) => {
    return deviceEnabled[device] !== false && liveDeviceNames.includes(device);
  };

  // Helper: get sensors for a device (empty array if offline)
  const getDeviceSensors = (device: string) => (sensorsByDevice[device] || []).filter(s => !isEnergySensor(s));

  useEffect(() => {
    const interval = setInterval(() => setForceUpdate(f => f + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Function to send control message to backend API
  const setDevicePublisher = async (device: string, enabled: boolean) => {
    setDeviceEnabled(prev => ({ ...prev, [device]: enabled }));
    await fetch(`/api/device-control?device=${device}&enabled=${enabled ? 'true' : 'false'}`, { method: 'POST' });
  };

  // Function to send scale control message (debounced)
  const setDeviceScaleDebounced = (device: string, scale: number) => {
    setDeviceScale(prev => ({ ...prev, [device]: scale }));
    if (scaleTimeouts.current[device]) clearTimeout(scaleTimeouts.current[device]!);
    scaleTimeouts.current[device] = setTimeout(() => {
      fetch(`/api/device-control?device=${device}&scale=${scale}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }).catch(error => {
        console.error('Failed to send scale control:', error);
        toast({
          title: "Error",
          description: "Failed to update device scale. Please try again.",
          variant: "destructive"
        });
      });
    }, 300);
  };

  const graphTabs = [
    { key: 'rolling', label: 'Rolling Averages' },
    { key: 'delta', label: 'Delta/Change' },
    { key: 'uptime', label: 'Uptime' },
    { key: 'hourly', label: 'Hourly Avg' },
  ];
  const [selectedGraphTab, setSelectedGraphTab] = useState<{ [topic: string]: string }>({});

  return (
    <div className="min-h-screen bg-background">
      {/* Loading Overlay */}
      {isInitialLoading && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mb-4"></div>
          <div className="text-2xl font-semibold mb-2">Loading Dashboard</div>
          <div className="text-muted-foreground text-center max-w-md">
            <p>Fetching sensor data and generating meaningful graphs...</p>
            <p className="mt-2">This may take up to 15 seconds to ensure accurate visualization.</p>
          </div>
        </div>
      )}

      {/* Ready Dialog */}
      <Dialog open={showReadyDialog} onOpenChange={setShowReadyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Ready to Go</DialogTitle>
          <div className="flex flex-col items-center justify-center p-4">
            <div className="text-2xl font-semibold text-green-600 mb-2">Ready to Go!</div>
            <p className="text-center text-muted-foreground">
              Your dashboard is now fully loaded and ready to use.
            </p>
          </div>
        </DialogContent>
      </Dialog>

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

        <Accordion type="multiple" collapsible="true" value={openDevices} onValueChange={setOpenDevices}>
          {allDeviceNames.map((device) => {
            const deviceSensors = getDeviceSensors(device);
            const coords = getDeviceCoordinates(deviceSensors);
            const online = isDeviceOnline(device);
            const saved = savedDevices.includes(device);
            const enabled = deviceEnabled[device] !== false;
            return (
              <AccordionItem value={device} key={device}>
                <AccordionTrigger>
                  <span className="flex items-center gap-2">
                    {device}
                    {coords && (
                      <span className="ml-2 text-xs text-muted-foreground">({coords.lat}, {coords.lon})</span>
                    )}
                    <Switch
                      checked={enabled}
                      onCheckedChange={checked => setDevicePublisher(device, checked)}
                      className="ml-2"
                      aria-label={`Toggle ${device} publisher`}
                    />
                    <Button
                      size="sm"
                      variant={saved ? 'default' : 'outline'}
                      className="ml-2 px-2 py-1 h-7"
                      onClick={e => {
                        e.stopPropagation();
                        setSavedDevices(prev =>
                          prev.includes(device)
                            ? prev.filter(d => d !== device)
                            : [...prev, device]
                        );
                      }}
                    >
                      <Bookmark className={`h-4 w-4 mr-1 ${saved ? 'text-yellow-500' : 'text-gray-400'}`} />
                      {saved ? 'Saved' : 'Unsaved'}
                    </Button>
                    <span className="ml-2 flex items-center text-xs">
                      {online ? (
                        <>
                          <Circle className="h-3 w-3 text-green-500 mr-1" /> Online
                        </>
                      ) : (
                        <>
                          <Circle className="h-3 w-3 text-red-500 mr-1" /> Offline
                        </>
                      )}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  {enabled && online ? (
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
                        const displayHistory = getFilteredHistory(
                          [...sensor.history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
                          selectedTimeRange
                        );
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
                        const tab = selectedGraphTab[sensor.topic] || 'rolling';
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
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">Device is disabled or offline.</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {/* Sensor Summary Section */}
        <ShadAccordion type="single" collapsible="true" value={summaryOpen ? "summary" : undefined} onValueChange={v => setSummaryOpen(v === "summary")}>
          <ShadAccordionItem value="summary">
            <ShadAccordionTrigger className="text-xl font-headline">Sensor Summary</ShadAccordionTrigger>
            <ShadAccordionContent>
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
                      {Object.values(filteredSensors).filter(s => !isEnergySensor(s)).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((sensor) => (
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
            </ShadAccordionContent>
          </ShadAccordionItem>
        </ShadAccordion>

        {/* Threshold Monitoring Section (moved and styled) */}
        <ShadAccordion type="single" collapsible value={undefined}>
          <ShadAccordionItem value="thresholds">
            <ShadAccordionTrigger className="text-xl font-headline">Threshold Monitoring</ShadAccordionTrigger>
            <ShadAccordionContent>
              <Card className="shadow-md mt-8 border border-border">
                <CardHeader>
                  <CardTitle className="font-headline text-xl">Threshold Monitoring</CardTitle>
                  <CardDescription>Compare current sensor values to their thresholds in real time.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex flex-wrap gap-6 items-center">
                    {['rpi1', 'rpi2'].map(device => (
                      <div key={device} className="flex flex-col items-center min-w-[200px]">
                        <span className="mb-1 font-semibold text-sm text-primary">{device} Value Scale</span>
                        <Slider
                          min={0.1}
                          max={2.0}
                          step={0.01}
                          value={[deviceScale[device] ?? 1.0]}
                          onValueChange={([val]) => setDeviceScaleDebounced(device, val)}
                          className="w-40"
                        />
                        <span className="mt-1 text-xs text-muted-foreground">{(deviceScale[device] ?? 1.0).toFixed(2)}x</span>
                      </div>
                    ))}
                  </div>
                  <ThresholdDashboard sensors={filteredSensors} />
                </CardContent>
              </Card>
            </ShadAccordionContent>
          </ShadAccordionItem>
        </ShadAccordion>

        {/* Analytics & Insights Section */}
        <ShadAccordion type="single" collapsible value={analyticsOpen ? "analytics" : undefined} onValueChange={v => setAnalyticsOpen(v === "analytics")}>
          <ShadAccordionItem value="analytics">
            <ShadAccordionTrigger className="text-xl font-headline">Analytics & Insights</ShadAccordionTrigger>
            <ShadAccordionContent>
              <Card className="shadow-md mt-4 border border-border">
                <CardHeader>
                  <CardTitle className="font-headline text-xl">Analytics & Insights</CardTitle>
                  <CardDescription>Statistical insights and advanced analytics for each sensor.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  {allDeviceNames.filter(device => deviceEnabled[device] !== false).map(device => {
                    const { sensorNames, values } = getLatestEnergyPerSensorForDevice(sensors, device);
                    if (!sensorNames.length) return null;
                    return (
                      <div key={device} className="mb-8">
                        <span className="font-semibold">{`Bar Plot of Latest Energy Consumed per Sensor (${device}):`}</span>
                        <div className="h-40 w-full">
                          <Line
                            options={{
                              ...chartOptions,
                              plugins: { ...chartOptions.plugins, legend: { display: false } },
                              scales: { ...chartOptions.scales, x: { ...chartOptions.scales.x, type: 'category' } },
                            }}
                            data={{
                              labels: sensorNames,
                              datasets: [{
                                label: 'Energy (kWh)',
                                data: values,
                                backgroundColor: 'rgba(59,130,246,0.7)',
                                borderColor: 'rgba(59,130,246,1)',
                                borderWidth: 2,
                                type: 'bar',
                              }],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(filteredSensors).filter(s => !isEnergySensor(s)).sort((a, b) => a.displayName.localeCompare(b.displayName)).map((sensor) => {
                    // Sort history by timestamp
                    const sortedHistory = [...sensor.history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    const values = sortedHistory.map(p => p.value);
                    const timestamps = sortedHistory.map(p => p.timestamp);
                    // Basic stats
                    const current = sensor.latestValue;
                    const lastUpdated = sensor.lastUpdateTimestamp;
                    const max = values.length ? Math.max(...values) : null;
                    const min = values.length ? Math.min(...values) : null;
                    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
                    const median = values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
                    const stddev = values.length ? Math.sqrt(values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length) : null;
                    // Rolling averages
                    function rollingAvg(arr, window) {
                      if (arr.length < window) return [];
                      return arr.map((_, i) => {
                        if (i < window - 1) return null;
                        const slice = arr.slice(i - window + 1, i + 1);
                        return slice.reduce((a, b) => a + b, 0) / window;
                      });
                    }
                    const rolling3 = rollingAvg(values, 3);
                    const rolling5 = rollingAvg(values, 5);
                    const rolling10 = rollingAvg(values, 10);
                    // Delta/change rate
                    const delta = getDelta(values);
                    // Uptime
                    const uptime = getUptime(timestamps);
                    // Hourly bar chart
                    const hourly = getHourlyAverages(timestamps, values);
                    // Anomaly detection (2 stddev)
                    const anomalies = values.map((v, i) => (Math.abs(v - avg) > 2 * stddev ? { x: timestamps[i], y: v } : null)).filter(Boolean);
                    // Peak/trough markers
                    const peakIndex = values.length ? values.indexOf(max) : -1;
                    const troughIndex = values.length ? values.indexOf(min) : -1;
                    const minimized = minimizedAnalytics[sensor.topic] || false;
                    const tab = selectedGraphTab[sensor.topic] || 'rolling';
                    return (
                      <Card key={sensor.topic} className="border border-border">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="font-headline text-lg flex items-center gap-2">{sensor.displayName} <span className="text-xs text-muted-foreground">({sensor.unit})</span></CardTitle>
                              <CardDescription>Analytics for topic: {sensor.topic}</CardDescription>
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={minimized ? 'Expand' : 'Minimize'}
                              onClick={() => setMinimizedAnalytics(prev => ({ ...prev, [sensor.topic]: !prev[sensor.topic] }))}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setMinimizedAnalytics(prev => ({ ...prev, [sensor.topic]: !prev[sensor.topic] })); }}
                              className={`ml-2 cursor-pointer rounded p-1 transition-colors ${minimized ? 'bg-muted' : 'bg-muted/50'} hover:bg-muted/80 flex items-center`}
                              style={{ outline: 'none' }}
                            >
                              <ChevronDown className={`h-5 w-5 transition-transform ${minimized ? '' : 'rotate-180'}`} />
                            </span>
                          </div>
                        </CardHeader>
                        {!minimized && (
                          <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                              <div><span className="font-semibold">Current:</span> {current !== null ? current.toFixed(2) : '--'}</div>
                              <div><span className="font-semibold">Last Updated:</span> {formatDisplayTimestamp(lastUpdated)}</div>
                              <div><span className="font-semibold">Peak:</span> {max !== null ? max.toFixed(2) : '--'}</div>
                              <div><span className="font-semibold">Min:</span> {min !== null ? min.toFixed(2) : '--'}</div>
                              <div><span className="font-semibold">Average:</span> {avg !== null ? avg.toFixed(2) : '--'}</div>
                              <div><span className="font-semibold">Median:</span> {median !== null ? median.toFixed(2) : '--'}</div>
                              <div><span className="font-semibold">Std Dev:</span> {stddev !== null ? stddev.toFixed(2) : '--'}</div>
                            </div>
                            {/* Graph Tabs */}
                            <div className="flex gap-2 mb-4">
                              {graphTabs.map(tabOpt => (
                                <button
                                  key={tabOpt.key}
                                  className={`px-3 py-1 rounded text-sm font-medium border ${tab === tabOpt.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'} transition-colors`}
                                  onClick={() => setSelectedGraphTab(prev => ({ ...prev, [sensor.topic]: tabOpt.key }))}
                                  type="button"
                                >
                                  {tabOpt.label}
                                </button>
                              ))}
                            </div>
                            {/* Only show the selected graph */}
                            {tab === 'rolling' && (
                              <div className="mb-4">
                                <span className="font-semibold">Rolling Averages (3s/5s/10s) with Markers:</span>
                                <div className="h-48 w-full">
                                  <Line options={{
                                    ...chartOptions,
                                    plugins: { ...chartOptions.plugins, legend: { display: true } },
                                    scales: { ...chartOptions.scales, x: { ...chartOptions.scales.x, type: 'time' } },
                                  }} data={{
                                    labels: timestamps,
                                    datasets: [
                                      { label: 'Raw', data: values, borderColor: 'hsl(var(--primary))', backgroundColor: 'hsla(var(--primary),0.1)', borderWidth: 1, pointRadius: 0 },
                                      { label: '3s Avg', data: rolling3, borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0 },
                                      { label: '5s Avg', data: rolling5, borderColor: '#34d399', borderWidth: 2, pointRadius: 0 },
                                      { label: '10s Avg', data: rolling10, borderColor: '#60a5fa', borderWidth: 2, pointRadius: 0 },
                                      // Peak marker
                                      peakIndex >= 0 ? { label: 'Peak', data: timestamps.map((_, i) => i === peakIndex ? max : null), borderColor: '#ef4444', backgroundColor: '#ef4444', pointRadius: 6, type: 'scatter', showLine: false } : {},
                                      // Trough marker
                                      troughIndex >= 0 ? { label: 'Trough', data: timestamps.map((_, i) => i === troughIndex ? min : null), borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 6, type: 'scatter', showLine: false } : {},
                                      // Anomalies
                                      anomalies.length ? { label: 'Anomaly', data: timestamps.map((t, i) => anomalies.find(a => a.x === t) ? values[i] : null), borderColor: '#f59e42', backgroundColor: '#f59e42', pointRadius: 5, type: 'scatter', showLine: false } : {},
                                    ].filter(Boolean),
                                  }} />
                                </div>
                              </div>
                            )}
                            {tab === 'delta' && (
                              <div className="mb-4">
                                <span className="font-semibold">Delta/Change Rate:</span>
                                <div className="h-32 w-full">
                                  <Line options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } } }}
                                    data={{ labels: timestamps, datasets: [{ label: 'Delta', data: delta, borderColor: '#f472b6', borderWidth: 2, pointRadius: 0 }] }} />
                                </div>
                              </div>
                            )}
                            {tab === 'uptime' && (
                              <div className="mb-4">
                                <span className="font-semibold">Uptime (binary, per minute):</span>
                                <div className="h-20 w-full">
                                  <Line options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } }, scales: { ...chartOptions.scales, y: { min: 0, max: 1, ticks: { stepSize: 1 } } } }}
                                    data={{ labels: timestamps, datasets: [{ label: 'Uptime', data: uptime, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0 }] }} />
                                </div>
                              </div>
                            )}
                            {tab === 'hourly' && (
                              <div className="mb-4">
                                <span className="font-semibold">Hourly Averages:</span>
                                <div className="h-32 w-full">
                                  <Line options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } } }}
                                    data={{ labels: hourly.map(h => h.hour), datasets: [{ label: 'Hourly Avg', data: hourly.map(h => h.avg), backgroundColor: '#818cf8', borderColor: '#6366f1', borderWidth: 2, type: 'bar' }] }} />
                                </div>
                              </div>
                            )}
                            {/* Time-based Metrics */}
                            <div className="mb-4">
                              <span className="font-semibold">Time-based Metrics:</span>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>Duration Active: {timestamps.length ? `${((new Date(timestamps[timestamps.length - 1]).getTime() - new Date(timestamps[0]).getTime()) / 1000).toFixed(0)}s` : '--'}</div>
                                <div>Time in Range: --</div>
                                <div>Time Above/Below Threshold: --</div>
                                <div>% Uptime: {uptime.length ? `${(uptime.filter(x => x === 1).length / uptime.length * 100).toFixed(1)}%` : '--'}</div>
                              </div>
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </CardContent>
              </Card>
            </ShadAccordionContent>
          </ShadAccordionItem>
        </ShadAccordion>
      </div>

      {/* Floating Theme Toggle */}
      <div className="fixed bottom-24 right-6 z-50 flex flex-col items-end gap-2">
        <div className="bg-card shadow-lg rounded-full flex items-center px-2 py-1 border border-border mb-2">
          <Button
            size="icon"
            variant={theme === 'normal' ? 'default' : 'ghost'}
            className={`rounded-full ${theme === 'normal' ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setTheme('normal')}
            aria-label="Normal Mode"
          >
            <Sun className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant={theme === 'dark' ? 'default' : 'ghost'}
            className={`rounded-full ml-1 ${theme === 'dark' ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setTheme('dark')}
            aria-label="Dark Mode"
          >
            <Moon className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant={theme === 'blue' ? 'default' : 'ghost'}
            className={`rounded-full ml-1 ${theme === 'blue' ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setTheme('blue')}
            aria-label="Blue Mode"
          >
            <Palette className="h-5 w-5" />
          </Button>
        </div>
        {/* Existing Notification Toggle */}
        <div>
          <Button
            variant={notificationsOn ? "default" : "outline"}
            className="rounded-full shadow-lg px-6 py-3 flex items-center gap-2"
            onClick={() => {
              const next = !notificationsOn;
              setNotificationsOn(next);
              toast({
                title: next ? "Notifications On" : "Notifications Off",
                description: next
                  ? "Notifications are turned on."
                  : "Notifications are off.",
                duration: 500, // Auto-dismiss after 2 seconds
              });
            }}
          >
            {notificationsOn ? <Bell className="mr-2" /> : <BellOff className="mr-2" />}
            {notificationsOn ? "Notifications On" : "Notifications Off"}
          </Button>
        </div>
      </div>
    </div>
  );
}