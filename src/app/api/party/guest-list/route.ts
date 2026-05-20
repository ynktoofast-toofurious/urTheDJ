import { NextResponse } from 'next/server';
import { updateGuestList } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; guestList?: unknown };
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!Array.isArray(body.guestList)) {
      return NextResponse.json({ error: 'guestList must be an array' }, { status: 400 });
    }
    const sanitized = body.guestList
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter(Boolean);

    return NextResponse.json(await updateGuestList(body.sessionId, sanitized));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update guest list' }, { status: 500 });
  }
}
