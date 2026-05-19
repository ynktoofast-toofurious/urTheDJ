import { NextResponse } from 'next/server';
import { forceSyncCurrentSong } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; requestId?: string };
    if (!body.sessionId || !body.requestId) {
      return NextResponse.json({ error: 'sessionId and requestId are required' }, { status: 400 });
    }

    return NextResponse.json(await forceSyncCurrentSong(body.sessionId, body.requestId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to force sync' }, { status: 500 });
  }
}
