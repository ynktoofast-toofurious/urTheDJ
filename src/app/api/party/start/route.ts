import { NextResponse } from 'next/server';
import { startPartySession } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    return NextResponse.json(await startPartySession(body.sessionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to start party' }, { status: 500 });
  }
}
