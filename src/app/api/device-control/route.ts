import { NextRequest, NextResponse } from 'next/server';
import mqtt from 'mqtt';

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const BASE_TOPIC = 'sensorflow/demo';

// Keep MQTT clients for different brokers
const clients: { [broker: string]: mqtt.MqttClient } = {};

function getClient(broker: string) {
    if (!clients[broker]) {
        clients[broker] = mqtt.connect(broker);
    }
    return clients[broker];
}

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const device = searchParams.get('device');
    const enabledParam = searchParams.get('enabled');
    const scaleParam = searchParams.get('scale');

    if (!device) {
        return NextResponse.json({ error: 'Missing device parameter' }, { status: 400 });
    }

    // Check if this is a custom MQTT device
    const customDevices = JSON.parse(localStorage.getItem('customDevices') || '[]');
    const customDevice = customDevices.find((d: any) => d.name === device);

    const broker = customDevice ? customDevice.broker : MQTT_BROKER;
    const topic = `${BASE_TOPIC}/${device}/control`;
    const payloadObj: any = {};

    if (enabledParam !== null) payloadObj.enabled = enabledParam === 'true';
    if (scaleParam !== null) payloadObj.scale = parseFloat(scaleParam);

    const payload = JSON.stringify(payloadObj);

    try {
        await new Promise<void>((resolve, reject) => {
            getClient(broker).publish(topic, payload, {}, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('Failed to publish control message:', e);
        return NextResponse.json({ error: 'Failed to publish control message', details: String(e) }, { status: 500 });
    }
} 