import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // Get the Socket.IO server instance from the global scope
    const io = (request as any).socket?.server?.io;

    return NextResponse.json({
      status: 'ok',
      message: 'Backend is running!',
      socketConnected: !!io,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
