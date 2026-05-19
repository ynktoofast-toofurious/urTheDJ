import { NextResponse } from 'next/server';
import { pausePartySession } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    return NextResponse.json(await pausePartySession(body.sessionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to pause party' }, { status: 500 });
  }
}
