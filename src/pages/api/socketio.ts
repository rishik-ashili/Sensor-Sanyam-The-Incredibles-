
import type { Server as HTTPServer } from 'http';
import type { Socket as NetSocket } from 'net';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Server as IOServer, Socket } from 'socket.io';
import mqtt from 'mqtt';

interface SocketServer extends HTTPServer {
  io?: IOServer;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com';
const MQTT_BASE_TOPIC = process.env.MQTT_BASE_TOPIC || 'sensorflow/demo/#';
const MQTT_TOPICS_SUBSCRIBE = [MQTT_BASE_TOPIC];

const MAX_HISTORY_POINTS_PER_SENSOR = 300; // Approx 5 mins of data at 1s interval

interface HistoryPoint {
  value: number;
  timestamp: string;
}

interface SensorDataEntry {
  history: HistoryPoint[];
  currentUnit?: string;
}

const sensorDataStore = new Map<string, SensorDataEntry>();

let mqttClient: mqtt.MqttClient | null = null;

export const config = {
  api: {
    bodyParser: false,
  },
};

const socketIOHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  console.log(`[SocketIO API] HTTP handler invoked. Path: ${req.url}, Method: ${req.method}`);
  try {
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'OPTIONS') {
      console.warn(`[SocketIO API] Method ${req.method} not allowed. Sending 405.`);
      res.status(405).json({ message: `Method ${req.method} Not Allowed` });
      return;
    }
    if (req.method === 'OPTIONS') {
      console.log('[SocketIO API] Responding to OPTIONS request.');
      res.status(200).end();
      return;
    }

    if (!res.socket.server.io) {
      console.log('[SocketIO API] Initializing Socket.IO server and MQTT client...');
      console.log(`[SocketIO API] Attempting to connect to MQTT broker at: ${MQTT_BROKER_URL}`);
      const httpServer: HTTPServer = res.socket.server;
      const io = new IOServer(httpServer, {
        path: '/api/socketio',
        addTrailingSlash: false,
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        }
      });
      res.socket.server.io = io;

      if (!mqttClient || (!mqttClient.connected && !mqttClient.reconnecting)) {
        console.log('[SocketIO API] Setting up new MQTT client connection.');
        mqttClient = mqtt.connect(MQTT_BROKER_URL);

        mqttClient.on('connect', () => {
          console.log(`[SocketIO API] MQTT connected to broker: ${MQTT_BROKER_URL}`);
          io.emit('mqtt_status', { connected: true, message: `Connected to MQTT broker (${MQTT_BROKER_URL})` });
          MQTT_TOPICS_SUBSCRIBE.forEach(topicPattern => {
            mqttClient?.subscribe(topicPattern, (err) => {
              if (err) {
                console.error(`[SocketIO API] Failed to subscribe to MQTT topic pattern ${topicPattern}:`, err);
              } else {
                console.log(`[SocketIO API] Subscribed to MQTT topic pattern: ${topicPattern}`);
              }
            });
          });
        });

        mqttClient.on('error', (err) => {
          console.error('[SocketIO API] MQTT connection error:', err.message, err);
          io.emit('mqtt_status', { connected: false, message: `MQTT Error: ${err.message}` });
        });

        mqttClient.on('reconnect', () => {
          console.log('[SocketIO API] MQTT attempting to reconnect...');
          io.emit('mqtt_status', { connected: false, message: 'MQTT reconnecting...' });
        });

        mqttClient.on('close', () => {
          console.log('[SocketIO API] MQTT connection closed.');
          io.emit('mqtt_status', { connected: false, message: 'MQTT connection closed' });
        });

        mqttClient.on('offline', () => {
          console.log('[SocketIO API] MQTT client offline.');
          io.emit('mqtt_status', { connected: false, message: 'MQTT client offline' });
        });

        mqttClient.on('message', (topic, message) => {
          console.log(`[SocketIO API] Received MQTT message on ${topic}: ${message.toString()}`);
          try {
            const parsedPayload = JSON.parse(message.toString());
            let finalPayload: Record<string, any> = {};
            if (typeof parsedPayload === 'object' && parsedPayload !== null) {
              finalPayload = { ...parsedPayload };
            } else {
              finalPayload = { value: parseFloat(parsedPayload) };
            }

            if (typeof finalPayload.value === 'undefined' || finalPayload.value === null || isNaN(Number(finalPayload.value))) {
              console.warn(`[SocketIO API] Parsed value is invalid or missing for topic ${topic}. Raw message: ${message.toString()}. Attempting to use raw message.`);
              finalPayload.value = parseFloat(message.toString());
              if(isNaN(finalPayload.value)) {
                console.error(`[SocketIO API] Critical: Could not determine a valid numeric value for ${topic}. Skipping message.`);
                io.emit('sensor_data_error', { topic, rawMessage: message.toString(), error: `Invalid value (not parseable to number).` });
                return;
              }
            }
            finalPayload.timestamp = finalPayload.timestamp || new Date().toISOString();
            finalPayload.unit = finalPayload.unit || 'N/A';
            
            // Update history buffer
            if (!sensorDataStore.has(topic)) {
              sensorDataStore.set(topic, { history: [], currentUnit: finalPayload.unit });
            }
            const sensorEntry = sensorDataStore.get(topic)!;
            sensorEntry.currentUnit = finalPayload.unit;
            sensorEntry.history.push({ value: finalPayload.value, timestamp: finalPayload.timestamp });
            if (sensorEntry.history.length > MAX_HISTORY_POINTS_PER_SENSOR) {
              sensorEntry.history.splice(0, sensorEntry.history.length - MAX_HISTORY_POINTS_PER_SENSOR);
            }
            
            io.emit('sensor_data', { topic, payload: finalPayload });
          } catch (e) {
            const parseError = e instanceof Error ? e.message : String(e);
            console.warn(`[SocketIO API] Failed to parse MQTT message as JSON from topic ${topic}: ${parseError}. Raw: "${message.toString()}". Attempting to treat as raw value.`);
            const numericValue = parseFloat(message.toString());
            if (!isNaN(numericValue)) {
              const timestamp = new Date().toISOString();
              const unit = 'N/A'; // Default unit for raw values
              if (!sensorDataStore.has(topic)) {
                sensorDataStore.set(topic, { history: [], currentUnit: unit });
              }
              const sensorEntry = sensorDataStore.get(topic)!;
              sensorEntry.currentUnit = unit;
              sensorEntry.history.push({ value: numericValue, timestamp });
              if (sensorEntry.history.length > MAX_HISTORY_POINTS_PER_SENSOR) {
                 sensorEntry.history.splice(0, sensorEntry.history.length - MAX_HISTORY_POINTS_PER_SENSOR);
              }
              io.emit('sensor_data', {
                topic,
                payload: { value: numericValue, unit, timestamp }
              });
            } else {
              console.error(`[SocketIO API] Message on topic ${topic} is not valid JSON and not a parseable number: "${message.toString()}"`);
              io.emit('sensor_data_error', { topic, rawMessage: message.toString(), error: `Invalid format (not JSON or number): ${parseError}` });
            }
          }
        });
      } else {
        console.log('[SocketIO API] MQTT client already initialized. State:',
          mqttClient.connected ? 'connected' : (mqttClient.reconnecting ? 'reconnecting' : 'disconnected/other'));
      }

      io.on('connection', (socket: Socket) => {
        console.log('[SocketIO API] Socket.IO client connected:', socket.id);
        if (mqttClient) {
          const statusMessage = mqttClient.connected
            ? `Connected to MQTT broker (${MQTT_BROKER_URL})`
            : (mqttClient.reconnecting ? 'MQTT reconnecting...' : 'MQTT not connected');
          socket.emit('mqtt_status', {
            connected: mqttClient.connected,
            message: statusMessage,
          });
        } else {
          socket.emit('mqtt_status', { connected: false, message: 'MQTT client not initialized' });
        }

        // Send initial historical data for all known sensors to the newly connected client
        sensorDataStore.forEach((data, topic) => {
          if (data.history.length > 0) {
            console.log(`[SocketIO API] Sending initial_sensor_history for ${topic} to ${socket.id}`);
            socket.emit('initial_sensor_history', { topic: topic, history: data.history, unit: data.currentUnit });
          }
        });

        socket.on('disconnect', (reason) => {
          console.log('[SocketIO API] Socket.IO client disconnected:', socket.id, 'Reason:', reason);
        });
      });
      console.log('[SocketIO API] Socket.IO server instance created and event handlers attached.');

    } else {
      console.log('[SocketIO API] Socket.IO server already running.');
    }

    console.log('[SocketIO API] Ending Socket.IO HTTP handler response successfully.');
    res.end();

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('[SocketIO API] Critical error in socketIOHandler:', errMessage, error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error during Socket.IO setup', error: errMessage });
    } else {
      console.error('[SocketIO API] Headers already sent, cannot send 500 response for error:', errMessage);
      res.end();
    }
  }
};

export default socketIOHandler;
