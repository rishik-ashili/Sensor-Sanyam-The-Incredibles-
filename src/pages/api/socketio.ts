
import type { Server as HTTPServer } from 'http';
import type { Socket as NetSocket } from 'net';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Server as IOServer, Socket } from 'socket.io';
import mqtt from 'mqtt';

// Extend NextApiResponse to include the socket property
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
const MQTT_TOPICS = ['sensorflow/demo/temperature', 'sensorflow/demo/humidity'];
let mqttClient: mqtt.MqttClient | null = null;
// Removed ioServerInstance as res.socket.server.io is the primary way to access/check for the IO server

export const config = {
  api: {
    bodyParser: false, // Disable body parsing, as we're dealing with WebSockets
  },
};

const socketIOHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  console.log(`[SocketIO API] HTTP handler invoked. Path: ${req.url}, Method: ${req.method}`);
  try {
    // Allow GET/POST for initial setup & OPTIONS for CORS preflight
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'OPTIONS') {
      console.warn(`[SocketIO API] Method ${req.method} not allowed for this endpoint. Sending 405.`);
      res.status(405).json({ message: `Method ${req.method} Not Allowed` });
      return; 
    }
    // For OPTIONS, just end response if CORS is handled by Socket.IO server config or other middleware
    if (req.method === 'OPTIONS') {
        console.log('[SocketIO API] Responding to OPTIONS request.');
        res.status(200).end();
        return;
    }


    if (!res.socket.server.io) {
      console.log('[SocketIO API] Initializing Socket.IO server and MQTT client...');
      const httpServer: HTTPServer = res.socket.server;
      const io = new IOServer(httpServer, {
        path: '/api/socketio', // Client must connect to this path
        addTrailingSlash: false,
        cors: {
          origin: "*", // Allow all origins for simplicity in demo; restrict in production
          methods: ["GET", "POST"]
        }
      });
      res.socket.server.io = io; // Attach to the main server instance

      // MQTT Client Setup
      // Check if mqttClient is already initialized and in a valid state
      if (!mqttClient || (!mqttClient.connected && !mqttClient.reconnecting)) {
        console.log('[SocketIO API] Setting up new MQTT client connection.');
        mqttClient = mqtt.connect(MQTT_BROKER_URL);

        mqttClient.on('connect', () => {
          console.log('[SocketIO API] MQTT connected to broker:', MQTT_BROKER_URL);
          io.emit('mqtt_status', { connected: true, message: 'Connected to MQTT broker' });
          MQTT_TOPICS.forEach(topic => {
            mqttClient?.subscribe(topic, (err) => {
              if (err) {
                console.error(`[SocketIO API] Failed to subscribe to MQTT topic ${topic}:`, err);
              } else {
                console.log(`[SocketIO API] Subscribed to MQTT topic: ${topic}`);
              }
            });
          });
        });

        mqttClient.on('error', (err) => {
          console.error('[SocketIO API] MQTT connection error:', err);
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
            const payload = JSON.parse(message.toString());
            io.emit('sensor_data', { topic, payload });
          } catch (e) {
            const parseError = e instanceof Error ? e.message : String(e);
            console.error(`[SocketIO API] Failed to parse MQTT message payload from topic ${topic}:`, parseError);
            io.emit('sensor_data_error', { topic, rawMessage: message.toString(), error: `Invalid JSON format: ${parseError}` });
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
            ? 'Connected to MQTT broker' 
            : (mqttClient.reconnecting ? 'MQTT reconnecting...' : 'MQTT not connected (connecting or error)');
          socket.emit('mqtt_status', {
            connected: mqttClient.connected,
            message: statusMessage,
          });
        } else {
           socket.emit('mqtt_status', { connected: false, message: 'MQTT client not initialized' });
        }

        socket.on('disconnect', (reason) => {
          console.log('[SocketIO API] Socket.IO client disconnected:', socket.id, 'Reason:', reason);
        });
      });
      console.log('[SocketIO API] Socket.IO server instance created and event handlers attached.');

    } else {
      console.log('[SocketIO API] Socket.IO server already running. HTTP handler is just ending the response for this request.');
    }
    
    console.log('[SocketIO API] Ending Socket.IO HTTP handler response successfully.');
    res.end();

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error('[SocketIO API] Critical error in socketIOHandler:', errMessage, error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error during Socket.IO setup', error: errMessage });
    } else {
      // If headers sent, can't send new status/body. Log and end.
      console.error('[SocketIO API] Headers already sent, cannot send 500 response for error:', errMessage);
      res.end();
    }
  }
};

export default socketIOHandler;
