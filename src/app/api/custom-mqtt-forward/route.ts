import { NextRequest, NextResponse } from 'next/server';
import { Server } from 'socket.io';
import { createCipheriv, createDecipheriv } from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'utf-8');
const IV = Buffer.from(process.env.IV!, 'utf-8');

function decryptData(encryptedData: string): any {
    try {
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');
        const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
        const decryptedBuffer = Buffer.concat([
            decipher.update(encryptedBuffer),
            decipher.final()
        ]);
        const decryptedString = decryptedBuffer.toString('utf-8');
        return JSON.parse(decryptedString);
    } catch (error) {
        console.error('[Custom MQTT Forward] Decryption error:', error);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        const { topic, message, device } = await req.json();
        if (!topic || !message || !device) {
            return NextResponse.json({ error: 'Missing topic, message, or device' }, { status: 400 });
        }
        // Decrypt message
        const decryptedPayload = decryptData(message);
        if (!decryptedPayload) {
            return NextResponse.json({ error: 'Failed to decrypt message' }, { status: 400 });
        }
        decryptedPayload.device = device;
        decryptedPayload.connectionType = 'custom-mqtt';
        decryptedPayload.timestamp = decryptedPayload.timestamp || new Date().toISOString();
        // Emit to all connected Socket.IO clients
        // @ts-ignore
        if (!global.io) {
            // @ts-ignore
            global.io = new Server(globalThis.server, { path: '/api/socketio' });
        }
        // @ts-ignore
        global.io.emit('sensor_data', { topic, payload: decryptedPayload });
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: 'Internal error', details: String(e) }, { status: 500 });
    }
} 