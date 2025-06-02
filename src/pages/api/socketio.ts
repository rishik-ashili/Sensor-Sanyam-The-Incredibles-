
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
let ioServerInstance: IOServer | null = null;

export const config = {
  api: {
    bodyParser: false, // Disable body parsing, as we're dealing with WebSockets
  },
};

const socketIOHandler = (req: NextApiRequest, res: NextApiResponseWithSocket) => {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server and MQTT client...');
    const httpServer: HTTPServer = res.socket.server;
    const io = new IOServer(httpServer, {
      path: '/api/socketio', // Client must connect to this path
      addTrailingSlash: false,
      cors: {
        origin: "*", // Allow all origins for simplicity in demo; restrict in production
        methods: ["GET", "POST"]
      }
    });
    res.socket.server.io = io;
    ioServerInstance = io;

    // MQTT Client Setup
    if (!mqttClient || !mqttClient.connected) {
      mqttClient = mqtt.connect(MQTT_BROKER_URL);

      mqttClient.on('connect', () => {
        console.log('MQTT connected to broker:', MQTT_BROKER_URL);
        io.emit('mqtt_status', { connected: true, message: 'Connected to MQTT broker' });
        MQTT_TOPICS.forEach(topic => {
          mqttClient?.subscribe(topic, (err) => {
            if (err) {
              console.error(`Failed to subscribe to topic ${topic}:`, err);
            } else {
              console.log(`Subscribed to MQTT topic: ${topic}`);
            }
          });
        });
      });

      mqttClient.on('error', (err) => {
        console.error('MQTT connection error:', err);
        io.emit('mqtt_status', { connected: false, message: `MQTT Error: ${err.message}` });
      });

      mqttClient.on('reconnect', () => {
        console.log('MQTT attempting to reconnect...');
        io.emit('mqtt_status', { connected: false, message: 'MQTT reconnecting...' });
      });
      
      mqttClient.on('close', () => {
        console.log('MQTT connection closed');
        io.emit('mqtt_status', { connected: false, message: 'MQTT connection closed' });
      });

      mqttClient.on('offline', () => {
        console.log('MQTT client offline');
        io.emit('mqtt_status', { connected: false, message: 'MQTT client offline' });
      });

      mqttClient.on('message', (topic, message) => {
        console.log(`Received MQTT message on ${topic}: ${message.toString()}`);
        try {
          const payload = JSON.parse(message.toString());
          io.emit('sensor_data', { topic, payload });
        } catch (e) {
          console.error(`Failed to parse MQTT message payload from topic ${topic}:`, e);
          io.emit('sensor_data_error', { topic, rawMessage: message.toString(), error: 'Invalid JSON format' });
        }
      });
    }

    io.on('connection', (socket: Socket) => {
      console.log('Socket.IO client connected:', socket.id);
      // Emit current MQTT status to newly connected client
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

      socket.on('disconnect', () => {
        console.log('Socket.IO client disconnected:', socket.id);
      });
    });
  } else {
    console.log('Socket.IO server already running.');
  }
  res.end(); // Important to end the HTTP response
};

export default socketIOHandler;
