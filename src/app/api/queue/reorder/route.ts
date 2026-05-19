import { NextResponse } from 'next/server';
import { reorderRequest } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; requestId?: string; direction?: 'up' | 'down' };
    if (!body.sessionId || !body.requestId || !body.direction) {
      return NextResponse.json({ error: 'sessionId, requestId, and direction are required' }, { status: 400 });
    }

    return NextResponse.json(await reorderRequest(body.sessionId, body.requestId, body.direction));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to reorder queue' }, { status: 500 });
  }
}
