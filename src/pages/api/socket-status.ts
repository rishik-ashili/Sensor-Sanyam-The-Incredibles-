import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        // Get the Socket.IO server instance from the global scope
        const io = (req.socket as any).server.io;

        if (!io) {
            return res.status(503).json({
                status: 'error',
                message: 'Socket.IO server not initialized',
                connected: false
            });
        }

        return res.status(200).json({
            status: 'ok',
            message: 'Socket.IO server is running',
            connected: true,
            engine: io.engine.name,
            clients: io.engine.clientsCount
        });
    } catch (error) {
        console.error('Socket status check error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
} 