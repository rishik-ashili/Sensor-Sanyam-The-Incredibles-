"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wifi, WifiOff, Thermometer, Droplets, AlertTriangle, Loader2, LineChart as LineChartIcon, Info, Clock, ChevronDown, XCircle, Bookmark, Circle, Bell, BellOff, Sun, Moon, Palette, MapPin } from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
  ScatterController
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
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { GoogleGenAI } from "@google/genai";
import { marked } from 'marked';
import { AuthProvider, useAuth } from './AuthContext';
import AuthPage from './AuthPage';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
  ScatterController
);

const MAX_HISTORY_POINTS_CLIENT = 50; // Max history points to keep on client if receiving rapidly before initial load
type TimeRangeOption = 'all' | '1m' | '5m';

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
  connectionType?: 'local' | 'api' | 'custom-mqtt';
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
function getDelta(arr: number[]): (number | null)[] {
  if (arr.length < 2) return [];
  return arr.map((v: number, i: number) => (i === 0 ? null : v - arr[i - 1]));
}

// Helper for uptime (simulate: if last update < 2x interval, online)
function getUptime(timestamps: string[], interval: number = 1000): number[] {
  if (!timestamps.length) return [];
  const bins: number[] = [];
  let last = new Date(timestamps[0]).getTime();
  for (let i = 1; i < timestamps.length; i++) {
    const t = new Date(timestamps[i]).getTime();
    bins.push(t - last < interval * 2 ? 1 : 0);
    last = t;
  }
  return [1, ...bins];
}

// Helper for hourly bar chart
function getHourlyAverages(timestamps: string[], values: number[]): { hour: string; avg: number }[] {
  const byHour: { [hour: string]: number[] } = {};
  timestamps.forEach((ts: string, i: number) => {
    const d = new Date(ts);
    const hour = d.getHours().toString();
    if (!byHour[hour]) byHour[hour] = [];
    byHour[hour].push(values[i]);
  });
  return Object.keys(byHour).map(h => ({ hour: h, avg: byHour[h].reduce((a, b) => a + b, 0) / byHour[h].length }));
}

// Helper for heatmap (hour x minute, value)
function getHeatmapData(timestamps: string[], values: number[]): { time: string; avg: number }[] {
  const map: { [key: string]: number[] } = {};
  timestamps.forEach((ts: string, i: number) => {
    const d = new Date(ts);
    const key = `${d.getHours()}:${d.getMinutes()}`;
    if (!map[key]) map[key] = [];
    map[key].push(values[i]);
  });
  return Object.entries(map).map(([k, v]) => ({ time: k, avg: v.reduce((a, b) => a + b, 0) / v.length }));
}

// Helper for histogram (all sensors)
function getAllSensorPeaks(sensors: SensorsState): number[] {
  return Object.values(sensors).map(sensor => {
    const values = sensor.history.map((p: HistoryPoint) => p.value);
    return values.length ? Math.max(...values) : null;
  }).filter((v): v is number => v !== null);
}

// Helper for 10s peak per sensor (dynamic, always returns a number)
function get10sPeak(sensors: SensorsState): number[] {
  const now = Date.now();
  return Object.values(sensors).map(sensor => {
    const recent = sensor.history.filter((p: HistoryPoint) => now - new Date(p.timestamp).getTime() <= 10000);
    const peak = recent.length ? Math.max(...recent.map((p: HistoryPoint) => p.value)) : 0;
    return peak;
  });
}

// Helper to get latest energy value per device
function getLatestEnergyPerDevice(sensors: SensorsState): { deviceNames: string[]; values: number[] } {
  // Find all sensors with topic ending in '/energy'
  const energySensors = Object.values(sensors).filter(s => s.topic.endsWith('/energy'));
  // Group by device
  const byDevice: { [device: string]: SensorDisplayData } = {};
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
function getLatestEnergyPerSensorForDevice(sensors: SensorsState, device: string): { sensorNames: string[]; values: number[] } {
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
function isEnergySensor(sensor: SensorDisplayData): boolean {
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

// Helper: get allowed device names (default + custom)
function getAllowedDevices() {
  const defaultDevices = ['rpi1', 'rpi2', 'rpi3'];
  let customDevices: string[] = [];
  if (typeof window !== 'undefined') {
    try {
      customDevices = JSON.parse(localStorage.getItem('customDevices') || '[]').map((d: any) => d.name);
    } catch { }
  }
  return [...defaultDevices, ...customDevices];
}

function DashboardPage({ isAdmin }: { isAdmin: boolean }) {
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
  const [thresholdAlertActive, setThresholdAlertActive] = useState(false);
  const [mapModalOpen, setMapModalOpen] = useState(false);

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
      // Only allow sensor data for allowed devices
      const allowedDevices = getAllowedDevices();
      const device = (data.payload as any).device || 'Unknown';
      if (!allowedDevices.includes(device)) return;
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
            device: device,
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
      setThresholdAlertActive(false);
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
          onOpenChange: (open: boolean) => {
            if (!open) {
              // Remove from toastIdsRef and update thresholdAlertActive
              Object.entries(toastIdsRef.current).forEach(([k, id]) => {
                if (id === t.id) delete toastIdsRef.current[k];
              });
              setThresholdAlertActive(Object.keys(toastIdsRef.current).length > 0);
            }
          },
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
    // Set red tint if any threshold notification is active
    setThresholdAlertActive(Object.keys(toastIdsRef.current).length > 0);
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
        tension: 0.4,  // Increased tension for smoother curves
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
    animation: {
      duration: 0  // Disable animations for smoother updates
    },
    interaction: {
      mode: 'nearest' as const,
      axis: 'x' as const,
      intersect: false
    }
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

    if (range === '1m') {
      startTime = subMinutes(now, 1);
    } else if (range === '5m') {
      startTime = subMinutes(now, 5);
    } else {
      return history; // Should not happen if range is 'all'
    }
    return history.filter(point => isAfter(parseISO(point.timestamp), startTime));
  };

  const timeRangeOptions: { label: string; value: TimeRangeOption }[] = [
    { label: 'All History', value: 'all' },
    { label: 'Last 1 Minute', value: '1m' },
    { label: 'Last 5 Minutes', value: '5m' },
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

  // Helper: get allowed device names (default + custom)
  function getAllowedDevices() {
    const defaultDevices = ['rpi1', 'rpi2', 'rpi3'];
    let customDevices: string[] = [];
    if (typeof window !== 'undefined') {
      try {
        customDevices = JSON.parse(localStorage.getItem('customDevices') || '[]').map((d: any) => d.name);
      } catch { }
    }
    return [...defaultDevices, ...customDevices];
  }

  // Helper: get all device names to show (union of default and custom)
  const allDeviceNames = useMemo(() => getAllowedDevices(), [forceUpdate]);

  // Helper: is device online? (now also checks if enabled and is allowed)
  const isDeviceOnline = (device: string) => {
    const allowed = getAllowedDevices();
    return deviceEnabled[device] !== false && liveDeviceNames.includes(device) && allowed.includes(device);
  };

  // Helper: get sensors for a device (empty array if offline)
  const getDeviceSensors = (device: string) => (sensorsByDevice[device] || []).filter(s => !isEnergySensor(s));

  useEffect(() => {
    const interval = setInterval(() => setForceUpdate(f => f + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Function to send control message to backend API
  const setDevicePublisher = async (device: string, enabled: boolean) => {
    if (!isAdmin) return; // Only admin can enable/disable devices
    setDeviceEnabled(prev => ({ ...prev, [device]: enabled }));
    await fetch(`/api/device-control?device=${device}&enabled=${enabled ? 'true' : 'false'}`, { method: 'POST' });
  };

  // Function to send scale control message (debounced)
  const setDeviceScaleDebounced = (device: string, scale: number) => {
    if (!isAdmin) return; // Only admin can adjust device scale
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

  // Download Report Modal State
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSensors, setReportSensors] = useState<string[]>([]); // topic names
  const [reportGraphs, setReportGraphs] = useState<string[]>(['rolling']);
  const [reportIncludeSummary, setReportIncludeSummary] = useState(true);
  const [reportIncludeThreshold, setReportIncludeThreshold] = useState(true);
  const [reportIncludeDeviceInfo, setReportIncludeDeviceInfo] = useState(true);
  const [reportDuration, setReportDuration] = useState(10); // seconds
  const [reportLoading, setReportLoading] = useState(false);
  const [reportBuffer, setReportBuffer] = useState<{ [topic: string]: HistoryPoint[] }>({});
  const [reportIncludeOriginalPerSecond, setReportIncludeOriginalPerSecond] = useState(false);

  // Helper: all available sensor topics (non-energy)
  const allSensorTopics = useMemo(() => Object.values(filteredSensors).filter(s => !isEnergySensor(s)).map(s => s.topic), [filteredSensors]);
  // Helper: all graph types
  const allGraphTypes = [
    { key: 'rolling', label: 'Rolling Averages' },
    { key: 'delta', label: 'Delta/Change' },
    { key: 'uptime', label: 'Uptime' },
    { key: 'hourly', label: 'Hourly Avg' },
  ];

  // Gather all devices with coordinates
  const deviceCoords = useMemo(() => {
    const coords: { device: string; lat: number; lon: number }[] = [];
    Object.values(sensorsByDevice).forEach((sArr, i) => {
      const sensorWithCoords = sArr.find(s => s.coordinates && typeof s.coordinates.lat === 'number' && typeof s.coordinates.lon === 'number');
      if (sensorWithCoords && sensorWithCoords.coordinates) {
        coords.push({ device: sensorWithCoords.device || `Device${i + 1}`, lat: sensorWithCoords.coordinates.lat, lon: sensorWithCoords.coordinates.lon });
      }
    });
    return coords;
  }, [sensorsByDevice]);

  // Add state for AI Insights chat
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatCollapsed, setAiChatCollapsed] = useState(false);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatMessages, setAiChatMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatPos, setAiChatPos] = useState({ x: 40, y: 100 });
  const aiChatRef = useRef<HTMLDivElement>(null);
  const aiApiKey = "AIzaSyCmcZBgItGQvaWPwJjy5qLLdy9NPGtYhHk";

  // Draggable logic
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  function onDragStart(e: React.MouseEvent) {
    dragging.current = true;
    const rect = aiChatRef.current?.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
    document.body.style.userSelect = 'none';
  }
  function onDrag(e: MouseEvent) {
    if (!dragging.current) return;
    setAiChatPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  }
  function onDragEnd() {
    dragging.current = false;
    document.body.style.userSelect = '';
  }
  useEffect(() => {
    if (!aiChatOpen) return;
    function move(e: MouseEvent) { onDrag(e); }
    function up() { onDragEnd(); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [aiChatOpen]);

  // Collect 5s of data and send to Gemini
  async function handleAiInsights() {
    setAiChatOpen(true);
    setAiChatCollapsed(false);
    setAiChatLoading(true);
    setAiChatMessages([{ role: 'ai', text: 'Analysing data for 5 seconds...' }]);
    // Buffer 5s of data
    const buffer: { [device: string]: { [param: string]: { value: number, threshold?: number, status: string } } } = {};
    const start = Date.now();
    function onData(data: any) {
      if (!data || !data.topic || !data.payload) return;
      const topic = data.topic;
      const sensor = sensors[topic];
      if (!sensor) return;
      const device = sensor.device || 'Unknown';
      const param = sensor.displayName;
      const value = data.payload.value;
      const threshold = sensor.threshold;
      const status = threshold !== undefined ? (value > threshold ? 'over threshold' : 'ok') : 'no threshold';
      if (!buffer[device]) buffer[device] = {};
      buffer[device][param] = { value, threshold, status };
    }
    socketRef.current?.on('sensor_data', onData);
    await new Promise(res => setTimeout(res, 5000));
    socketRef.current?.off('sensor_data', onData);
    // Prepare summary for AI
    let summary = '';
    Object.entries(buffer).forEach(([device, params]) => {
      summary += `Device: ${device}\n`;
      Object.entries(params).forEach(([param, info]) => {
        summary += `  - ${param}: value=${info.value}`;
        if (info.threshold !== undefined) summary += `, threshold=${info.threshold}, status=${info.status}`;
        summary += '\n';
      });
    });
    // System instruction
    const systemInstruction =
      "You are an expert IoT dashboard assistant. Given device and sensor data (including current value, threshold, and status), generate concise insights about the state of the RPis, how the sensors are working, any issues, and suggestions for improvement. Use short, clear sentences. If any sensor is over threshold, highlight it. If all is well, say so. Be actionable.";
    // Call Gemini
    try {
      const ai = new GoogleGenAI({ apiKey: aiApiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          { role: "user", parts: [{ text: summary }] }
        ],
        config: { systemInstruction },
      });
      setAiChatMessages([{ role: 'ai', text: response.text || 'No insights.' }]);
    } catch (e) {
      setAiChatMessages([{ role: 'ai', text: 'Error getting AI insights.' }]);
    }
    setAiChatLoading(false);
  }
  // Handle user chat
  async function handleAiUserMessage() {
    if (!aiChatInput.trim()) return;
    setAiChatMessages(msgs => [...msgs, { role: 'user', text: aiChatInput }]);
    setAiChatLoading(true);
    setAiChatInput("");
    try {
      const ai = new GoogleGenAI({ apiKey: aiApiKey });
      // Only include real user/model messages (filter out system/placeholder/error)
      const context = aiChatMessages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .filter(m => !m.text.toLowerCase().includes('analysing data')) // filter out placeholder
        .filter(m => !m.text.toLowerCase().includes('error getting ai')) // filter out error
        .map(m =>
          m.role === 'user'
            ? { role: 'user', parts: [{ text: m.text }] }
            : { role: 'model', parts: [{ text: m.text }] }
        );
      // Add the new user message
      context.push({ role: 'user', parts: [{ text: aiChatInput }] });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: context,
        config: { systemInstruction: "You are an expert IoT dashboard assistant. Continue the conversation, answering user questions about the device and sensor data." },
      });
      setAiChatMessages(msgs => [...msgs, { role: 'ai', text: response.text || 'No response.' }]);
    } catch (e) {
      setAiChatMessages(msgs => [...msgs, { role: 'ai', text: 'Error getting AI response.' }]);
    }
    setAiChatLoading(false);
  }

  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === 'customDevices') {
        const customDevices = JSON.parse(e.newValue || '[]');
        const allowedDevices = new Set([...(customDevices.map((cd: any) => cd.name)), 'rpi1', 'rpi2', 'rpi3']);
        setSavedDevices((prev) => prev.filter((d) => allowedDevices.has(d)));
        setSensors((prevSensors) => {
          // Remove all sensors for devices not in allowedDevices
          return Object.fromEntries(Object.entries(prevSensors).filter(([_, sensor]) => allowedDevices.has(sensor.device || '')));
        });
      }
    }
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

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

      {/* Red tint overlay when threshold alert is active */}
      {thresholdAlertActive && (
        <div style={{ pointerEvents: 'none' }} className="fixed inset-0 z-[9999] bg-red-600/30 transition-opacity duration-300" />
      )}

      {/* Floating Map Button (bottom left) */}
      <div className="fixed bottom-10 left-6 z-50">
        <Button
          className="rounded-full shadow-lg px-6 py-3 flex items-center gap-2 bg-primary text-primary-foreground"
          onClick={() => setMapModalOpen(true)}
        >
          <MapPin className="h-5 w-5 mr-2" />
          Show Device Map
        </Button>
      </div>
      {/* Map Modal */}
      <Dialog open={mapModalOpen} onOpenChange={setMapModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Device Locations Map</DialogTitle>
          <div className="w-full flex flex-col items-center">
            {deviceCoords.length === 0 ? (
              <div className="text-muted-foreground py-8">No device coordinates available.</div>
            ) : (
              <svg width={500} height={350} style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                {/* Subtle grid lines for orientation */}
                {[...Array(6)].map((_, i) => (
                  <line
                    key={`vgrid-${i}`}
                    x1={50 + i * 80}
                    y1={30}
                    x2={50 + i * 80}
                    y2={320}
                    stroke="#e5e7eb"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                ))}
                {[...Array(4)].map((_, i) => (
                  <line
                    key={`hgrid-${i}`}
                    x1={50}
                    y1={50 + i * 80}
                    x2={450}
                    y2={50 + i * 80}
                    stroke="#e5e7eb"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                ))}
                {/* Device pins with improved placement and status ring */}
                {(() => {
                  const lats = deviceCoords.map(d => d.lat);
                  const lons = deviceCoords.map(d => d.lon);
                  const minLat = Math.min(...lats);
                  const maxLat = Math.max(...lats);
                  const minLon = Math.min(...lons);
                  const maxLon = Math.max(...lons);
                  const pad = 0.02; // More padding
                  function mapToSvg(lat: number, lon: number) {
                    // Y: top is maxLat, bottom is minLat
                    const y = 70 + ((maxLat - lat) / (maxLat - minLat + 2 * pad)) * 210;
                    // X: left is minLon, right is maxLon
                    const x = 70 + ((lon - minLon) / (maxLon - minLon + 2 * pad)) * 360;
                    return { x, y };
                  }
                  return deviceCoords.map((d, i) => {
                    const { x, y } = mapToSvg(d.lat, d.lon);
                    const online = deviceEnabled[d.device] !== false && liveDeviceNames.includes(d.device);
                    return (
                      <g key={d.device}>
                        {/* Status ring */}
                        <circle cx={x} cy={y} r={18} fill="#2563eb" stroke={online ? "#22c55e" : "#ef4444"} strokeWidth={4} />
                        {/* Pin icon */}
                        <MapPin x={x - 10} y={y - 28} width={20} height={20} color={online ? "#22c55e" : "#ef4444"} />
                        {/* Device name above */}
                        <text x={x} y={y - 34} textAnchor="middle" fontSize={15} fill="#1e293b" fontWeight="bold">{d.device}</text>
                        {/* Coordinates below, selectable */}
                        <text x={x} y={y + 32} textAnchor="middle" fontSize={12} fill="#64748b" style={{ userSelect: 'all' }}>
                          ({d.lat.toFixed(5)}, {d.lon.toFixed(5)})
                        </text>
                      </g>
                    );
                  });
                })()}
                {/* Legend for online/offline */}
                <g>
                  <circle cx={420} cy={320} r={8} fill="#2563eb" stroke="#22c55e" strokeWidth={3} />
                  <text x={435} y={324} fontSize={12} fill="#1e293b">Online</text>
                  <circle cx={420} cy={340} r={8} fill="#2563eb" stroke="#ef4444" strokeWidth={3} />
                  <text x={435} y={344} fontSize={12} fill="#1e293b">Offline</text>
                </g>
              </svg>
            )}
            <div className="text-xs text-muted-foreground mt-2">(Map is a visualization, not to scale or georeferenced)</div>
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

        <Accordion type="multiple" value={openDevices} onValueChange={setOpenDevices}>
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
                    {/* Connection type tag */}
                    {(() => {
                      const deviceSensors = getDeviceSensors(device);
                      const connectionType = deviceSensors[0]?.connectionType ||
                        (device === 'rpi1' || device === 'rpi2' ? 'local' : device === 'rpi3' ? 'api' : 'custom-mqtt');
                      if (connectionType === 'local') return <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Local</span>;
                      if (connectionType === 'api') return <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">API</span>;
                      if (connectionType === 'custom-mqtt') return <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Custom MQTT</span>;
                      return null;
                    })()}
                    {isAdmin && (
                      <Switch
                        checked={enabled}
                        onCheckedChange={checked => setDevicePublisher(device, checked)}
                        className="ml-2"
                        aria-label={`Toggle ${device} publisher`}
                      />
                    )}
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
                    <div className="w-full overflow-x-auto">
                      <ResponsiveGridLayout
                        className="layout"
                        layouts={{ lg: getGridLayout(device, deviceSensors) }}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                        cols={{ lg: 6, md: 4, sm: 2, xs: 1, xxs: 1 }}
                        rowHeight={80}
                        isResizable={true}
                        isDraggable={true}
                        onLayoutChange={(l: Layout[]) => setLayoutByDevice(prev => ({ ...prev, [device]: l }))}
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
                                fill: false,
                                tension: 0.4,  // Increased tension for smoother curves
                                borderWidth: 2,
                                pointRadius: 0,
                                pointHoverRadius: 5,
                              },
                            ],
                          };
                          let IconComponent = LineChartIcon;
                          if (sensor.topic.toLowerCase().includes('temperature')) IconComponent = Thermometer;
                          if (sensor.topic.toLowerCase().includes('humidity')) IconComponent = Droplets;
                          const grid = (layoutByDevice[device] || []).find(l => l.i === sensor.topic) || { i: sensor.topic, x: 0, y: 0, w: 2, h: 4 };
                          const tab = selectedGraphTab[sensor.topic] || 'rolling';
                          return (
                            <div key={sensor.topic} data-grid={grid} className="min-w-[280px] max-w-full sm:min-w-[320px]">
                              <Card className="hover:shadow-xl transition-shadow duration-300 ease-in-out border border-border relative w-full max-w-full">
                                <div className="absolute top-2 right-2 flex gap-2 z-10">
                                  {/* Minimize always enabled, delete only for admin */}
                                  <Button size="icon" variant="ghost" onClick={() => setMinimized(m => ({ ...m, [sensor.topic]: !m[sensor.topic] }))} title={minimized[sensor.topic] ? 'Maximize' : 'Minimize'}>
                                    {minimized[sensor.topic] ? <ChevronDown className="h-4 w-4" /> : <ChevronDown className="h-4 w-4 rotate-180" />}
                                  </Button>
                                  {isAdmin && (
                                    <Button size="icon" variant="destructive" onClick={() => setDeleted(d => ({ ...d, [sensor.topic]: true }))} title="Delete">
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  )}
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
                    </div>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">Device is disabled or offline.</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {/* Sensor Summary Section */}
        <ShadAccordion type="single" collapsible value={summaryOpen ? "summary" : undefined} onValueChange={v => setSummaryOpen(v === "summary")}>
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
                  {isAdmin && (
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
                  )}
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
                          <Bar
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
                    const stddev = values.length ? Math.sqrt(values.reduce((a, b) => a + Math.pow(b - (avg ?? 0), 2), 0) / values.length) : null;
                    // Rolling averages
                    function rollingAvg(arr: number[], window: number): (number | null)[] {
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
                    const avgSafe = avg ?? 0;
                    const stddevSafe = stddev ?? 0;
                    const anomalies = (avg !== null && stddev !== null)
                      ? values.map((v, i) => (Math.abs(v - avgSafe) > 2 * stddevSafe ? { x: timestamps[i], y: v } : null)).filter(Boolean)
                      : [];
                    const peakIndex = (max !== null) ? values.indexOf(max) : -1;
                    const troughIndex = (min !== null) ? values.indexOf(min) : -1;
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
                                      { label: 'Raw', data: values, borderColor: 'hsl(var(--primary))', backgroundColor: 'transparent', borderWidth: 1, pointRadius: 0, fill: false },
                                      { label: '3s Avg', data: rolling3, borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                                      { label: '5s Avg', data: rolling5, borderColor: '#34d399', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                                      { label: '10s Avg', data: rolling10, borderColor: '#60a5fa', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                                      peakIndex >= 0 ? { label: 'Peak', data: timestamps.map((_, i) => i === peakIndex ? max : null), borderColor: '#ef4444', backgroundColor: '#ef4444', pointRadius: 6, type: 'scatter', showLine: false, fill: false } as any : undefined,
                                      troughIndex >= 0 ? { label: 'Trough', data: timestamps.map((_, i) => i === troughIndex ? min : null), borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 6, type: 'scatter', showLine: false, fill: false } as any : undefined,
                                      anomalies.length ? { label: 'Anomaly', data: timestamps.map((t, i) => anomalies.find(a => a && a.x === t) ? values[i] : null), borderColor: '#f59e42', backgroundColor: '#f59e42', pointRadius: 5, type: 'scatter', showLine: false, fill: false } as any : undefined,
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
                                    data={{ labels: timestamps, datasets: [{ label: 'Delta', data: delta, borderColor: '#f472b6', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' }] }} />
                                </div>
                              </div>
                            )}
                            {tab === 'uptime' && (
                              <div className="mb-4">
                                <span className="font-semibold">Uptime (binary, per minute):</span>
                                <div className="h-20 w-full">
                                  <Line options={{ ...chartOptions, plugins: { ...chartOptions.plugins, legend: { display: false } }, scales: { ...chartOptions.scales, y: { min: 0, max: 1, ticks: { stepSize: 1 } } } }}
                                    data={{ labels: timestamps, datasets: [{ label: 'Uptime', data: uptime, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' }] }} />
                                </div>
                              </div>
                            )}
                            {tab === 'hourly' && (
                              <div className="mb-4">
                                <span className="font-semibold">Hourly Averages:</span>
                                <div className="h-32 w-full">
                                  <Bar
                                    options={{
                                      ...chartOptions,
                                      plugins: {
                                        ...chartOptions.plugins,
                                        legend: { display: false }
                                      }
                                    }}
                                    data={{
                                      labels: hourly.map(h => h.hour),
                                      datasets: [{
                                        label: 'Hourly Avg',
                                        data: hourly.map(h => h.avg),
                                        backgroundColor: '#818cf8',
                                        borderColor: '#6366f1',
                                        borderWidth: 2
                                      }]
                                    }}
                                  />
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

      {/* Floating Download Report Button - move above theme toggle */}
      <div className="fixed bottom-10 right-6 z-50 flex flex-col items-end gap-2">
        <Button
          className="rounded-full shadow-lg px-6 py-3 flex items-center gap-2 bg-primary text-primary-foreground"
          onClick={() => setReportModalOpen(true)}
        >
          <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          Download Report
        </Button>
        {/* Floating Theme Toggle */}
        <div className="bg-card shadow-lg rounded-full flex items-center px-2 py-1 border border-border mb-2 mt-4">
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
      {/* Download Report Modal */}
      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Download Analytics Report</DialogTitle>
          <div className="space-y-4 mt-2">
            <div>
              <div className="font-semibold mb-1">Select Parameters</div>
              <div className="flex flex-wrap gap-2">
                <label>
                  <input type="checkbox" checked={reportSensors.length === allSensorTopics.length}
                    onChange={e => setReportSensors(e.target.checked ? allSensorTopics : [])} />
                  <span className="ml-1">All</span>
                </label>
                {allSensorTopics.map(topic => (
                  <label key={topic} className="flex items-center">
                    <input type="checkbox" checked={reportSensors.includes(topic)}
                      onChange={e => setReportSensors(prev => e.target.checked ? [...prev, topic] : prev.filter(t => t !== topic))} />
                    <span className="ml-1">{formatTopicName(topic)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">Select Graphs</div>
              <div className="flex flex-wrap gap-2">
                <label>
                  <input type="checkbox" checked={reportGraphs.length === allGraphTypes.length}
                    onChange={e => setReportGraphs(e.target.checked ? allGraphTypes.map(g => g.key) : [])} />
                  <span className="ml-1">All</span>
                </label>
                {allGraphTypes.map(g => (
                  <label key={g.key} className="flex items-center">
                    <input type="checkbox" checked={reportGraphs.includes(g.key)}
                      onChange={e => setReportGraphs(prev => e.target.checked ? [...prev, g.key] : prev.filter(k => k !== g.key))} />
                    <span className="ml-1">{g.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input type="checkbox" checked={reportIncludeSummary} onChange={e => setReportIncludeSummary(e.target.checked)} />
                <span className="ml-1">Include Summary</span>
              </label>
              <label className="flex items-center">
                <input type="checkbox" checked={reportIncludeThreshold} onChange={e => setReportIncludeThreshold(e.target.checked)} />
                <span className="ml-1">Include Thresholds</span>
              </label>
              <label className="flex items-center">
                <input type="checkbox" checked={reportIncludeDeviceInfo} onChange={e => setReportIncludeDeviceInfo(e.target.checked)} />
                <span className="ml-1">Include Device Info</span>
              </label>
              <label className="flex items-center">
                <input type="checkbox" checked={reportIncludeOriginalPerSecond} onChange={e => setReportIncludeOriginalPerSecond(e.target.checked)} />
                <span className="ml-1">Download only original values (1 per second)</span>
              </label>
            </div>
            <div>
              <div className="font-semibold mb-1">Select Duration</div>
              <div className="flex gap-2">
                {[10, 15, 30].map(sec => (
                  <button key={sec} type="button"
                    className={`px-3 py-1 rounded border ${reportDuration === sec ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'}`}
                    onClick={() => setReportDuration(sec)}>{sec}s</button>
                ))}
                <input type="number" min={1} max={120} value={reportDuration} onChange={e => setReportDuration(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded ml-2" />
                <span className="ml-1">seconds</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={reportLoading || reportSensors.length === 0 || reportGraphs.length === 0}
                onClick={async () => {
                  setReportLoading(true);
                  setReportBuffer({});
                  // Start buffering for the selected duration
                  const buffer: { [topic: string]: HistoryPoint[] } = {};
                  const start = Date.now();
                  const end = start + reportDuration * 1000;
                  function onData(topic: string, payload: HistoryPoint) {
                    if (!reportSensors.includes(topic)) return;
                    buffer[topic] = buffer[topic] || [];
                    buffer[topic].push(payload);
                  }
                  // Attach a temporary listener to buffer data
                  const handler = (data: any) => {
                    if (data && data.topic && data.payload) {
                      onData(data.topic, { value: data.payload.value, timestamp: data.payload.timestamp });
                    }
                  };
                  socketRef.current?.on('sensor_data', handler);
                  // Wait for the duration
                  await new Promise(res => setTimeout(res, reportDuration * 1000));
                  socketRef.current?.off('sensor_data', handler);
                  setReportBuffer(buffer);
                  // --- PDF GENERATION LOGIC ---
                  // Use the dashboard's current chart data for the PDF graphs
                  const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
                  let y = 40;
                  if (reportIncludeSummary) {
                    doc.setFontSize(18);
                    doc.text('SensorFlow Analytics Report', 40, y);
                    y += 30;
                    doc.setFontSize(12);
                    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, y);
                    y += 20;
                  }
                  if (reportIncludeDeviceInfo) {
                    doc.setFontSize(12);
                    doc.text('Devices:', 40, y);
                    y += 18;
                    allDeviceNames.forEach(device => {
                      doc.text(`- ${device}`, 60, y);
                      y += 16;
                    });
                  }
                  if (reportIncludeThreshold) {
                    y += 10;
                    doc.setFontSize(12);
                    doc.text('Thresholds:', 40, y);
                    y += 18;
                    reportSensors.forEach(topic => {
                      const sensor = filteredSensors[topic];
                      if (sensor && sensor.threshold !== undefined) {
                        doc.text(`- ${sensor.displayName}: ${sensor.threshold} ${sensor.unit}`, 60, y);
                        y += 16;
                      }
                    });
                  }
                  y += 10;
                  // For each selected sensor and graph, use the dashboard's current chart data
                  for (const topic of reportSensors) {
                    const sensor = filteredSensors[topic];
                    if (!sensor) continue;
                    doc.addPage();
                    y = 40;
                    doc.setFontSize(14);
                    doc.text(`${sensor.displayName} (${sensor.unit})`, 40, y);
                    y += 20;
                    for (const graphKey of reportGraphs) {
                      // Prepare a hidden canvas/chart for this graph using the dashboard's current data
                      const tempDiv = document.createElement('div');
                      tempDiv.style.position = 'fixed';
                      tempDiv.style.left = '-9999px';
                      tempDiv.style.top = '0';
                      tempDiv.style.width = '600px';
                      tempDiv.style.height = '300px';
                      document.body.appendChild(tempDiv);
                      // Use the dashboard's current data for this sensor
                      const dashboardSensor = filteredSensors[topic];
                      const history = (dashboardSensor?.history || []).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                      const values = history.map(p => p.value);
                      const timestamps = history.map(p => p.timestamp);
                      let chartData: any = {};
                      let chartOptions: any = { responsive: false, animation: false, plugins: { legend: { display: true } } };
                      let chartTitle = '';
                      if (graphKey === 'rolling') {
                        chartTitle = 'Rolling Averages';
                        function rollingAvg(arr: number[], window: number) {
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
                        chartData = {
                          labels: timestamps,
                          datasets: [
                            { label: 'Raw', data: values, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', borderWidth: 1, pointRadius: 0, fill: false },
                            { label: '3s Avg', data: rolling3, borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                            { label: '5s Avg', data: rolling5, borderColor: '#34d399', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                            { label: '10s Avg', data: rolling10, borderColor: '#60a5fa', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                          ].filter(Boolean),
                        };
                      } else if (graphKey === 'delta') {
                        chartTitle = 'Delta/Change Rate';
                        function getDelta(arr: number[]) {
                          if (arr.length < 2) return [];
                          return arr.map((v, i) => (i === 0 ? null : v - arr[i - 1]));
                        }
                        const delta = getDelta(values);
                        chartData = {
                          labels: timestamps,
                          datasets: [
                            { label: 'Delta', data: delta, borderColor: '#f472b6', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                          ],
                        };
                      } else if (graphKey === 'uptime') {
                        chartTitle = 'Uptime (binary, per minute)';
                        function getUptime(timestamps: string[], interval = 1000) {
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
                        const uptime = getUptime(timestamps);
                        chartData = {
                          labels: timestamps,
                          datasets: [
                            { label: 'Uptime', data: uptime, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
                          ],
                        };
                        chartOptions.scales = { y: { min: 0, max: 1, ticks: { stepSize: 1 } } };
                      } else if (graphKey === 'hourly') {
                        chartTitle = 'Hourly Averages';
                        function getHourlyAverages(timestamps: string[], values: number[]) {
                          const byHour: { [hour: string]: number[] } = {};
                          timestamps.forEach((ts, i) => {
                            const d = new Date(ts);
                            const hour = d.getHours();
                            if (!byHour[hour]) byHour[hour] = [];
                            byHour[hour].push(values[i]);
                          });
                          return Object.keys(byHour).map(h => ({ hour: h, avg: byHour[h].reduce((a, b) => a + b, 0) / byHour[h].length }));
                        }
                        const hourly = getHourlyAverages(timestamps, values);
                        chartData = {
                          labels: hourly.map(h => h.hour),
                          datasets: [
                            { label: 'Hourly Avg', data: hourly.map(h => h.avg), backgroundColor: '#818cf8', borderColor: '#6366f1', borderWidth: 2, type: 'bar', fill: false },
                          ],
                        };
                        chartOptions.scales = { x: { type: 'category' } };
                      }
                      // Render chart offscreen
                      const canvas = document.createElement('canvas');
                      canvas.width = 600;
                      canvas.height = 300;
                      tempDiv.appendChild(canvas);
                      // @ts-ignore
                      const chart = new ChartJS(canvas.getContext('2d'), {
                        type: graphKey === 'hourly' ? 'bar' : 'line',
                        data: chartData,
                        options: chartOptions,
                      });
                      await new Promise(res => setTimeout(res, 500)); // let chart render
                      // Capture as image
                      const imgData = await html2canvas(tempDiv, { backgroundColor: '#fff' }).then(canvas => canvas.toDataURL('image/png'));
                      doc.setFontSize(12);
                      doc.text(chartTitle, 40, y);
                      y += 20;
                      doc.addImage(imgData, 'PNG', 40, y, 500, 250);
                      y += 270;
                      chart.destroy();
                      document.body.removeChild(tempDiv);
                    }
                  }
                  doc.save('sensorflow_report.pdf');
                  setReportLoading(false);
                  setReportModalOpen(false);
                }}
              >
                {reportLoading ? 'Collecting Data...' : 'Download PDF'}
              </Button>
              {/* Download as CSV Button */}
              <Button
                disabled={reportLoading || reportSensors.length === 0}
                variant="outline"
                onClick={async () => {
                  setReportLoading(true);
                  setReportBuffer({});
                  // Start buffering for the selected duration
                  const buffer: { [topic: string]: HistoryPoint[] } = {};
                  const start = Date.now();
                  const end = start + reportDuration * 1000;
                  function onData(topic: string, payload: HistoryPoint) {
                    if (!reportSensors.includes(topic)) return;
                    buffer[topic] = buffer[topic] || [];
                    buffer[topic].push(payload);
                  }
                  // Attach a temporary listener to buffer data
                  const handler = (data: any) => {
                    if (data && data.topic && data.payload) {
                      onData(data.topic, { value: data.payload.value, timestamp: data.payload.timestamp });
                    }
                  };
                  socketRef.current?.on('sensor_data', handler);
                  // Wait for the duration
                  await new Promise(res => setTimeout(res, reportDuration * 1000));
                  socketRef.current?.off('sensor_data', handler);
                  setReportBuffer(buffer);
                  // --- CSV GENERATION LOGIC ---
                  // Use the dashboard's current chart data for the CSV
                  let csv = 'Sensor,Time,Value\n';
                  for (const topic of reportSensors) {
                    const sensor = filteredSensors[topic];
                    if (!sensor) continue;
                    const dashboardSensor = filteredSensors[topic];
                    let history = (dashboardSensor?.history || []).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    if (reportIncludeOriginalPerSecond) {
                      // Downsample to 1 value per second (first value per second)
                      const perSecond: { [sec: string]: HistoryPoint } = {};
                      for (const point of history) {
                        const sec = point.timestamp.slice(0, 19); // 'YYYY-MM-DDTHH:MM:SS'
                        if (!perSecond[sec]) perSecond[sec] = point;
                      }
                      history = Object.values(perSecond).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    }
                    for (const point of history) {
                      csv += `"${sensor.displayName}","${point.timestamp}",${point.value}\n`;
                    }
                  }
                  // Download CSV
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'sensorflow_report.csv';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  setReportLoading(false);
                  setReportModalOpen(false);
                }}
              >
                {reportLoading ? 'Collecting Data...' : 'Download CSV'}
              </Button>
            </div>
            {/* Loader while preparing PDF */}
            {reportLoading && (
              <div className="flex flex-col items-center justify-center mt-4">
                <svg className="animate-spin h-6 w-6 text-primary mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>
                <span className="text-sm text-muted-foreground">Preparing PDF, please wait...</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating AI Insights Button (above map button) */}
      <div className="fixed bottom-28 left-6 z-50">
        <Button
          className="rounded-full shadow-lg px-6 py-3 flex items-center gap-2 bg-secondary text-secondary-foreground"
          onClick={handleAiInsights}
        >
          <Info className="h-5 w-5 mr-2" />
          AI Insights
        </Button>
      </div>
      {/* AI Insights Chat Window */}
      {aiChatOpen && (
        <div
          ref={aiChatRef}
          style={{ position: 'fixed', left: aiChatPos.x, top: aiChatPos.y, zIndex: 99999, width: 350, boxShadow: '0 4px 24px #0002', borderRadius: 12, background: '#18181b', color: '#fff', resize: 'both', minHeight: 80 }}
        >
          <div
            style={{ cursor: 'move', background: '#27272a', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            onMouseDown={onDragStart}
          >
            <span style={{ fontWeight: 600 }}>AI Insights</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="icon" variant="ghost" onClick={() => setAiChatCollapsed(c => !c)}><ChevronDown className={`h-5 w-5 transition-transform ${aiChatCollapsed ? '' : 'rotate-180'}`} /></Button>
              <Button size="icon" variant="destructive" onClick={() => setAiChatOpen(false)}><XCircle className="h-5 w-5" /></Button>
            </div>
          </div>
          {!aiChatCollapsed && (
            <div style={{ maxHeight: 350, overflowY: 'auto', padding: 12, background: '#18181b' }}>
              {aiChatMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'ai' ? 'left' : 'right' }}>
                  <span style={{ fontWeight: m.role === 'ai' ? 600 : 400, color: m.role === 'ai' ? '#38bdf8' : '#fbbf24' }}>{m.role === 'ai' ? 'AI:' : 'You:'}</span>
                  <span style={{ marginLeft: 6 }}>
                    {m.role === 'ai' ? (
                      <span dangerouslySetInnerHTML={{ __html: String(marked.parse(m.text)) }} />
                    ) : (
                      m.text
                    )}
                  </span>
                </div>
              ))}
              {aiChatLoading && <div style={{ color: '#fbbf24', fontStyle: 'italic' }}>Analysing...</div>}
            </div>
          )}
          {!aiChatCollapsed && (
            <form style={{ display: 'flex', borderTop: '1px solid #27272a', background: '#18181b' }} onSubmit={e => { e.preventDefault(); handleAiUserMessage(); }}>
              <input
                value={aiChatInput}
                onChange={e => setAiChatInput(e.target.value)}
                placeholder="Ask about your devices..."
                style={{ flex: 1, padding: 8, background: '#27272a', color: '#fff', border: 'none', borderBottomLeftRadius: 12 }}
                disabled={aiChatLoading}
              />
              <Button type="submit" disabled={aiChatLoading || !aiChatInput.trim()} style={{ borderBottomRightRadius: 12 }}>Send</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardWithAuth() {
  const { user, role, logout } = useAuth();
  const [showLoading, setShowLoading] = React.useState(false);
  React.useEffect(() => {
    if (user) {
      setShowLoading(true);
      const t = setTimeout(() => setShowLoading(false), 1500);
      return () => clearTimeout(t);
    }
  }, [user]);

  if (!user) return <AuthPage />;
  if (showLoading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80">
      <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-indigo-500 border-solid"></div>
      <span className="ml-4 text-xl text-indigo-700 font-semibold">Loading dashboard...</span>
    </div>
  );
  return (
    <div>
      {/* Move the logged in message below the navbar */}
      <div className="container mx-auto px-4 mt-6 mb-2 flex items-center justify-end">
        <span className="text-sm text-muted-foreground">
          Logged in as: <span className="font-semibold">{user}</span> ({role})
        </span>
        <button
          onClick={logout}
          className="ml-4 px-4 py-2 rounded-lg bg-indigo-100 text-indigo-700 font-semibold shadow hover:bg-indigo-200 transition"
        >Logout</button>
      </div>
      <DashboardPage isAdmin={role === 'admin'} />
    </div>
  );
}

export default function AppEntry() {
  return (
    <AuthProvider>
      <DashboardWithAuth />
    </AuthProvider>
  );
}