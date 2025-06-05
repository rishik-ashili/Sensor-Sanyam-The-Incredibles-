import { NextRequest, NextResponse } from 'next/server';
import mqtt from 'mqtt';

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const BASE_TOPIC = 'sensorflow/demo';

// Keep a single MQTT client instance
let client: mqtt.MqttClient | null = null;
function getClient() {
    if (!client) {
        client = mqtt.connect(MQTT_BROKER);
    }
    return client;
}

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const device = searchParams.get('device');
    const enabledParam = searchParams.get('enabled');
    const scaleParam = searchParams.get('scale');
    if (!device) {
        return NextResponse.json({ error: 'Missing device parameter' }, { status: 400 });
    }
    const topic = `${BASE_TOPIC}/${device}/control`;
    const payloadObj: any = {};
    if (enabledParam !== null) payloadObj.enabled = enabledParam === 'true';
    if (scaleParam !== null) payloadObj.scale = parseFloat(scaleParam);
    const payload = JSON.stringify(payloadObj);
    try {
        await new Promise<void>((resolve, reject) => {
            getClient().publish(topic, payload, {}, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: 'Failed to publish control message', details: String(e) }, { status: 500 });
    }
} 