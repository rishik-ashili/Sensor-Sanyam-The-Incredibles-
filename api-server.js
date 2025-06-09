const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const mqtt = require('mqtt');

// Create Express app
const app = express();

// CORS configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(bodyParser.json());

// Create HTTP server
const httpServer = createServer(app);

// Create HTTPS server if certificates exist
let httpsServer;
try {
    const options = {
        key: fs.readFileSync(path.join(__dirname, 'cert', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'cert', 'cert.pem'))
    };
    httpsServer = https.createServer(options, app);
} catch (error) {
    console.log('No SSL certificates found, HTTPS server not created');
}

// Store sensor data and device states
const sensors = {};
const deviceStates = {};

// Create WebSocket servers
const wss = new WebSocket.Server({
    server: httpServer,
    path: '/ws',
    perMessageDeflate: false,
    clientTracking: true,
    verifyClient: (info, callback) => {
        // Allow all connections
        callback(true);
    }
});

if (httpsServer) {
    const wssSecure = new WebSocket.Server({
        server: httpsServer,
        path: '/ws',
        perMessageDeflate: false,
        clientTracking: true,
        verifyClient: (info, callback) => {
            // Allow all connections
            callback(true);
        }
    });
    wssSecure.on('connection', handleWebSocketConnection);
}

// Create Socket.IO servers
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

if (httpsServer) {
    const ioSecure = new Server(httpsServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000
    });
    ioSecure.on('connection', handleSocketIOConnection);
}

// MQTT Client setup
const mqttClient = mqtt.connect('mqtt://localhost:1883', {
    clientId: 'api-server',
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000
});

mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe('sensorflow/demo/#', (err) => {
        if (err) {
            console.error('MQTT subscription error:', err);
        } else {
            console.log('Subscribed to sensorflow/demo/#');
        }
    });
});

mqttClient.on('error', (error) => {
    console.error('MQTT client error:', error);
});

mqttClient.on('message', (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log(`[MQTT] Received message on ${topic}:`, data);

        // Handle threshold messages
        if (topic.endsWith('/threshold')) {
            const [_, __, device, sensor] = topic.split('/');
            const sensorKey = `${device}/${sensor}`;

            if (!sensors[sensorKey]) {
                sensors[sensorKey] = [];
            }

            // Update threshold for all data points
            sensors[sensorKey] = sensors[sensorKey].map(point => ({
                ...point,
                threshold: data.threshold
            }));

            // Broadcast update
            const update = {
                type: 'threshold_update',
                sensor: sensorKey,
                threshold: data.threshold
            };

            broadcastUpdate(update);
            return;
        }

        // Handle sensor data messages
        const [_, __, device, sensor] = topic.split('/');
        const sensorKey = `${device}/${sensor}`;

        if (!sensors[sensorKey]) {
            sensors[sensorKey] = [];
        }

        const sensorData = {
            value: Number(data.value),
            unit: data.unit || 'N/A',
            timestamp: data.timestamp || new Date().toISOString(),
            coordinates: data.coordinates || null,
            threshold: data.threshold || null
        };

        sensors[sensorKey].push(sensorData);

        // Keep only last 100 data points
        if (sensors[sensorKey].length > 100) {
            sensors[sensorKey] = sensors[sensorKey].slice(-100);
        }

        // Broadcast update
        const update = {
            type: 'sensor_update',
            sensor: sensorKey,
            data: sensorData
        };

        broadcastUpdate(update);
    } catch (error) {
        console.error('Error processing MQTT message:', error);
    }
});

// WebSocket connection handler
function handleWebSocketConnection(ws, req) {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);

    // Send initial data
    ws.send(JSON.stringify({
        type: 'initial_data',
        sensors: sensors,
        deviceStates: deviceStates
    }));

    // Set up heartbeat
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            // Handle heartbeat
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            console.log('Received WebSocket message:', data);
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', (code, reason) => {
        console.log('WebSocket client disconnected:', code, reason);
        clearInterval(heartbeat);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(heartbeat);
    });
}

// Socket.IO connection handler
function handleSocketIOConnection(socket) {
    console.log('Socket.IO client connected');

    // Send initial data
    socket.emit('initial_data', {
        sensors: sensors,
        deviceStates: deviceStates
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket.IO client disconnected:', reason);
    });

    socket.on('error', (error) => {
        console.error('Socket.IO error:', error);
    });
}

// Broadcast update to all clients
function broadcastUpdate(update) {
    // Broadcast to WebSocket clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(update));
            } catch (error) {
                console.error('Error broadcasting to WebSocket client:', error);
            }
        }
    });

    // Broadcast to Socket.IO clients
    io.emit(update.type, update);
}

// API endpoints
app.get('/api/sensor-data', (req, res) => {
    res.json({
        sensors: sensors,
        deviceStates: deviceStates
    });
});

app.post('/api/sensor-data', (req, res) => {
    try {
        const { device, sensor, value, unit, timestamp, coordinates, threshold } = req.body;

        if (!device || !sensor || value === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const sensorKey = `${device}/${sensor}`;
        const data = {
            value: Number(value),
            unit: unit || 'N/A',
            timestamp: timestamp || new Date().toISOString(),
            coordinates: coordinates || null,
            threshold: threshold || null
        };

        // Update sensor data
        if (!sensors[sensorKey]) {
            sensors[sensorKey] = [];
        }
        sensors[sensorKey].push(data);

        // Keep only last 100 data points
        if (sensors[sensorKey].length > 100) {
            sensors[sensorKey] = sensors[sensorKey].slice(-100);
        }

        // Broadcast update
        const update = {
            type: 'sensor_update',
            sensor: sensorKey,
            data: data
        };

        broadcastUpdate(update);

        res.json({ success: true });
    } catch (error) {
        console.error('Error processing sensor data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/device/:device/control', (req, res) => {
    try {
        const { device } = req.params;
        const { enabled, scale } = req.body;

        deviceStates[device] = {
            enabled: enabled !== undefined ? enabled : deviceStates[device]?.enabled ?? true,
            scale: scale !== undefined ? scale : deviceStates[device]?.scale ?? 1
        };

        // Broadcast update
        const update = {
            type: 'device_control',
            device: device,
            state: deviceStates[device]
        };

        broadcastUpdate(update);

        res.json({ success: true });
    } catch (error) {
        console.error('Error processing device control:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/device/:device/sensor/:sensor/threshold', (req, res) => {
    try {
        const { device, sensor } = req.params;
        const { threshold } = req.body;

        const sensorKey = `${device}/${sensor}`;
        if (!sensors[sensorKey]) {
            sensors[sensorKey] = [];
        }

        // Update threshold for all data points
        sensors[sensorKey] = sensors[sensorKey].map(point => ({
            ...point,
            threshold: threshold
        }));

        // Broadcast update
        const update = {
            type: 'threshold_update',
            sensor: sensorKey,
            threshold: threshold
        };

        broadcastUpdate(update);

        res.json({ success: true });
    } catch (error) {
        console.error('Error processing threshold update:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Start servers
const HTTP_PORT = process.env.HTTP_PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP server running on port ${HTTP_PORT}`);
});

if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`HTTPS server running on port ${HTTPS_PORT}`);
    });
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down servers...');
    mqttClient.end();
    httpServer.close();
    if (httpsServer) {
        httpsServer.close();
    }
    process.exit(0);
}); 