import { NextRequest, NextResponse } from 'next/server';
import mqtt from 'mqtt';
import { createCipheriv } from 'crypto';

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const BASE_TOPIC = 'sensorflow/demo';

// Encryption Configuration
const ENCRYPTION_KEY = Buffer.from('12345678901234567890123456789012', 'utf-8');
const IV = Buffer.from('1234567890123456', 'utf-8');

// Keep a single MQTT client instance
let client: mqtt.MqttClient | null = null;
let isConnecting = false;

async function getClient(): Promise<mqtt.MqttClient> {
    if (client && client.connected) {
        return client;
    }

    if (isConnecting) {
        throw new Error('MQTT client is already connecting');
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

        return new Promise<mqtt.MqttClient>((resolve, reject) => {
            const timeout = setTimeout(() => {
                isConnecting = false;
                reject(new Error('MQTT connection timeout'));
            }, 5000);

            client!.on('connect', () => {
                clearTimeout(timeout);
                isConnecting = false;
                console.log('[Sensor Data API] Connected to MQTT broker');
                resolve(client!);
            });

            client!.on('error', (err) => {
                clearTimeout(timeout);
                isConnecting = false;
                console.error('[Sensor Data API] MQTT error:', err);
                reject(err);
            });
        });
    } catch (error) {
        isConnecting = false;
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

export async function POST(request: NextRequest) {
    try {
        const data = await request.json();

        // Validate required fields
        if (!data.value || !data.timestamp || !data.unit || !data.device) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
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
                        { status: 500 }
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

                    resolve(NextResponse.json({ success: true, message: 'Data published successfully' }));
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
            { status: 500 }
        );
    }
} 