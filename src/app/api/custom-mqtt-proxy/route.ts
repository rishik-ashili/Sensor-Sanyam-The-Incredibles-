import { NextRequest, NextResponse } from 'next/server';
import mqtt from 'mqtt';
import fetch from 'node-fetch';

interface DeviceConfig {
    name: string;
    broker: string;
    connectionType: 'custom-mqtt';
}

const clients: { [device: string]: mqtt.MqttClient } = {};

export async function POST(req: NextRequest) {
    const data = await req.json() as DeviceConfig;
    if (!data.name || !data.broker) {
        return NextResponse.json({ error: 'Missing device name or broker' }, { status: 400 });
    }
    if (clients[data.name]) {
        return NextResponse.json({ error: 'Client already exists for this device' }, { status: 400 });
    }
    const client = mqtt.connect(data.broker);
    clients[data.name] = client;
    client.on('connect', () => {
        // Subscribe to all topics for this device
        client.subscribe(`sensorflow/demo/${data.name}/#`, (err) => {
            if (err) console.error(`[Custom MQTT] Subscribe error for ${data.name}:`, err);
        });
    });
    client.on('message', async (topic, message) => {
        // Forward to main dashboard
        try {
            await fetch('http://localhost:9003/api/custom-mqtt-forward', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message: message.toString(), device: data.name }),
            });
        } catch (e) {
            console.error(`[Custom MQTT] Failed to forward message for ${data.name} on ${topic}:`, e);
        }
    });
    return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
    const data = await req.json();
    if (!data.name) {
        return NextResponse.json({ error: 'Missing device name' }, { status: 400 });
    }
    const client = clients[data.name];
    if (client) {
        client.end(true); // Force disconnect
        delete clients[data.name];
    }
    return NextResponse.json({ success: true });
} 