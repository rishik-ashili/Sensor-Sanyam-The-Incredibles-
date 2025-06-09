const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    // Add CORS for WebSocket
    verifyClient: (info, callback) => {
        const origin = info.origin || info.req.headers.origin;
        if (!origin || origin === 'http://localhost:3000' || origin === 'https://fictional-yodel-jj5qxp96vwxqc5q44-3000.app.github.dev') {
            callback(true);
        } else {
            callback(false, 403, 'Forbidden');
        }
    }
});

// CORS configuration
const corsOptions = {
    origin: ['http://localhost:3000', 'https://fictional-yodel-jj5qxp96vwxqc5q44-3000.app.github.dev'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());

// Store sensor data and device states
const sensorData = new Map();
const deviceStates = new Map();
const MAX_HISTORY = 300;

// WebSocket clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    console.log('New WebSocket client connected from:', req.socket.remoteAddress);
    clients.add(ws);

    // Send initial data to new client
    const initialData = {
        type: 'initial_data',
        sensors: Object.fromEntries(sensorData),
        deviceStates: Object.fromEntries(deviceStates)
    };

    try {
        ws.send(JSON.stringify(initialData));
    } catch (e) {
        console.error('Error sending initial data:', e);
    }

    ws.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Broadcast to all WebSocket clients
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (e) {
                console.error('Error broadcasting message:', e);
            }
        }
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// API Routes

// 1. Post sensor data
app.post('/api/sensor-data', (req, res) => {
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
    if (!sensorData.has(sensorKey)) {
        sensorData.set(sensorKey, []);
    }
    const history = sensorData.get(sensorKey);
    history.push(data);
    if (history.length > MAX_HISTORY) {
        history.shift();
    }

    // Broadcast update
    broadcast({
        type: 'sensor_update',
        sensor: sensorKey,
        data
    });

    res.json({ success: true });
});

// 2. Get sensor data
app.get('/api/sensor-data/:device/:sensor', (req, res) => {
    const { device, sensor } = req.params;
    const sensorKey = `${device}/${sensor}`;
    const data = sensorData.get(sensorKey);

    if (!data) {
        return res.status(404).json({ error: 'Sensor data not found' });
    }

    res.json(data);
});

// 3. Get all sensors for a device
app.get('/api/device/:device/sensors', (req, res) => {
    const { device } = req.params;
    const deviceSensors = {};

    sensorData.forEach((data, key) => {
        if (key.startsWith(`${device}/`)) {
            deviceSensors[key] = data;
        }
    });

    res.json(deviceSensors);
});

// 4. Device control
app.post('/api/device/:device/control', (req, res) => {
    const { device } = req.params;
    const { enabled, scale } = req.body;

    if (enabled !== undefined) {
        deviceStates.set(`${device}/enabled`, enabled);
    }
    if (scale !== undefined) {
        deviceStates.set(`${device}/scale`, scale);
    }

    // Broadcast control update
    broadcast({
        type: 'device_control',
        device,
        state: {
            enabled: deviceStates.get(`${device}/enabled`),
            scale: deviceStates.get(`${device}/scale`)
        }
    });

    res.json({ success: true });
});

// 5. Get device state
app.get('/api/device/:device/state', (req, res) => {
    const { device } = req.params;
    const state = {
        enabled: deviceStates.get(`${device}/enabled`),
        scale: deviceStates.get(`${device}/scale`)
    };

    res.json(state);
});

// 6. Set threshold
app.post('/api/device/:device/sensor/:sensor/threshold', (req, res) => {
    const { device, sensor } = req.params;
    const { threshold } = req.body;

    if (threshold === undefined) {
        return res.status(400).json({ error: 'Threshold value required' });
    }

    const sensorKey = `${device}/${sensor}`;
    const history = sensorData.get(sensorKey);
    if (history) {
        history.forEach(data => {
            data.threshold = threshold;
        });
    }

    // Broadcast threshold update
    broadcast({
        type: 'threshold_update',
        sensor: sensorKey,
        threshold
    });

    res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${PORT}`);
}); 