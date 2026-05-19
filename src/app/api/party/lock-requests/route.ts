import { NextResponse } from 'next/server';
import { lockPartyRequests } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    return NextResponse.json(await lockPartyRequests(body.sessionId, true));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to lock requests' }, { status: 500 });
  }
}
