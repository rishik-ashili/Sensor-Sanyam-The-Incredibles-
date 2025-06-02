
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
// Using a wildcard to capture various sensor types under the demo prefix
const MQTT_TOPICS_SUBSCRIBE = ['sensorflow/demo/#']; 
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
          console.log('[SocketIO API] MQTT connected to broker:', MQTT_BROKER_URL);
          io.emit('mqtt_status', { connected: true, message: 'Connected to MQTT broker' });
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
            const parsedPayload = JSON.parse(message.toString());
            // Ensure payload is an object and add timestamp if not present
            let finalPayload = {};
            if (typeof parsedPayload === 'object' && parsedPayload !== null) {
              finalPayload = { ...parsedPayload };
            } else { // If message is just a value, e.g. "23.5"
              finalPayload = { value: parseFloat(parsedPayload) }; 
            }
            
            if (isNaN(Number((finalPayload as any).value))) {
                 console.warn(`[SocketIO API] Parsed value is NaN for topic ${topic}. Raw message: ${message.toString()}`);
                 // Potentially emit an error or skip if value is critical and invalid
            }

            (finalPayload as any).timestamp = (finalPayload as any).timestamp || new Date().toISOString();
            
            io.emit('sensor_data', { topic, payload: finalPayload });
          } catch (e) {
            const parseError = e instanceof Error ? e.message : String(e);
            console.error(`[SocketIO API] Failed to parse MQTT message payload from topic ${topic}: ${parseError}. Raw: "${message.toString()}"`);
            // Try to parse as a raw number if JSON parsing failed
            const numericValue = parseFloat(message.toString());
            if (!isNaN(numericValue)) {
                console.log(`[SocketIO API] Emitting raw numeric value for topic ${topic} after JSON parse fail.`);
                io.emit('sensor_data', {
                    topic,
                    payload: {
                        value: numericValue,
                        timestamp: new Date().toISOString()
                    }
                });
            } else {
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
            ? 'Connected to MQTT broker' 
            : (mqttClient.reconnecting ? 'MQTT reconnecting...' : 'MQTT not connected');
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
