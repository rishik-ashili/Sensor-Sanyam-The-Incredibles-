import { NextRequest, NextResponse } from 'next/server';
import mqtt from 'mqtt';
import { createCipheriv } from 'crypto';

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const BASE_TOPIC = 'sensorflow/demo';

// Authentication Configuration
const API_USERNAME = process.env.API_USERNAME || 'sensorflow';
const API_PASSWORD = process.env.API_PASSWORD || 'sensorflow123';

// Encryption Configuration
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'utf-8');
const IV = Buffer.from(process.env.IV!, 'utf-8');

// Keep a single MQTT client instance
let client: mqtt.MqttClient | null = null;
let isConnecting = false;
let connectionPromise: Promise<mqtt.MqttClient> | null = null;

async function getClient(): Promise<mqtt.MqttClient> {
    if (client && client.connected) {
        return client;
    }

    if (isConnecting && connectionPromise) {
        return connectionPromise;
    }

    isConnecting = true;

    try {
        if (client) {
            client.end();
            client = null;
        }

        client = mqtt.connect(MQTT_BROKER, {
            clientId: `sensorflow-api-${Math.random().toString(16).slice(3)}`,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000,
        });

        connectionPromise = new Promise<mqtt.MqttClient>((resolve, reject) => {
            const timeout = setTimeout(() => {
                isConnecting = false;
                connectionPromise = null;
                reject(new Error('MQTT connection timeout'));
            }, 5000);

            client!.on('connect', () => {
                clearTimeout(timeout);
                isConnecting = false;
                connectionPromise = null;
                console.log('[Sensor Data API] Connected to MQTT broker');
                resolve(client!);
            });

            client!.on('error', (err) => {
                clearTimeout(timeout);
                isConnecting = false;
                connectionPromise = null;
                console.error('[Sensor Data API] MQTT error:', err);
                reject(err);
            });

            client!.on('close', () => {
                console.log('[Sensor Data API] MQTT connection closed');
                isConnecting = false;
                connectionPromise = null;
            });
        });

        return connectionPromise;
    } catch (error) {
        isConnecting = false;
        connectionPromise = null;
        console.error('[Sensor Data API] Failed to create MQTT client:', error);
        throw error;
    }
}

function encryptData(data: any): string {
    try {
        const jsonData = JSON.stringify(data);
        const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
        const encrypted = Buffer.concat([
            cipher.update(jsonData, 'utf8'),
            cipher.final()
        ]);
        return encrypted.toString('base64');
    } catch (error) {
        console.error('[Sensor Data API] Encryption error:', error);
        throw error;
    }
}

function validateAuth(request: NextRequest): boolean {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;

    const [type, credentials] = authHeader.split(' ');
    if (type !== 'Basic') return false;

    const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');
    return username === API_USERNAME && password === API_PASSWORD;
}

export async function POST(request: NextRequest) {
    // Add CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
        return new NextResponse(null, { headers });
    }

    // Validate authentication
    if (!validateAuth(request)) {
        return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401, headers }
        );
    }

    try {
        const data = await request.json();

        // Validate required fields
        if (!data.value || !data.timestamp || !data.unit || !data.device) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400, headers }
            );
        }

        // Get MQTT client
        const mqttClient = await getClient();

        // Prepare the payload
        const payload = {
            value: Number(data.value),
            timestamp: data.timestamp,
            unit: data.unit,
            device: data.device,
            coordinates: data.coordinates || { lat: 0, lon: 0 },
            threshold: data.threshold || null
        };

        // Encrypt the payload
        const encryptedPayload = encryptData(payload);

        // Determine the topic
        const sensorName = data.sensorName || 'unknown';
        const topic = `${BASE_TOPIC}/${sensorName}`;

        // Publish to MQTT
        return new Promise<NextResponse>((resolve, reject) => {
            mqttClient.publish(topic, encryptedPayload, { qos: 1 }, (err) => {
                if (err) {
                    console.error('[Sensor Data API] MQTT publish error:', err);
                    reject(NextResponse.json(
                        { error: 'Failed to publish to MQTT', details: err.message },
                        { status: 500, headers }
                    ));
                } else {
                    console.log(`[Sensor Data API] Published to ${topic}:`, payload);

                    // If energy data is provided, publish it separately
                    if (data.energy) {
                        const energyPayload = {
                            value: Number(data.energy),
                            timestamp: data.timestamp,
                            unit: 'kWh',
                            device: data.device,
                            coordinates: data.coordinates || { lat: 0, lon: 0 }
                        };
                        const encryptedEnergyPayload = encryptData(energyPayload);
                        const energyTopic = `${BASE_TOPIC}/${sensorName}/energy`;

                        mqttClient.publish(energyTopic, encryptedEnergyPayload, { qos: 1 }, (err) => {
                            if (err) {
                                console.error('[Sensor Data API] MQTT energy publish error:', err);
                            } else {
                                console.log(`[Sensor Data API] Published energy to ${energyTopic}:`, energyPayload);
                            }
                        });
                    }

                    resolve(NextResponse.json({ success: true, message: 'Data published successfully' }, { headers }));
                }
            });
        });
    } catch (error) {
        console.error('[Sensor Data API] Error processing request:', error);
        return NextResponse.json(
            {
                error: 'Internal server error',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500, headers }
        );
    }
} 