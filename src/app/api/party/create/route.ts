import { NextResponse } from 'next/server';
import { createPartySession } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { partyName?: string; createdBy?: string; partyStyle?: string };

    if (!body.partyName?.trim()) {
      return NextResponse.json({ error: 'partyName is required' }, { status: 400 });
    }

    const dashboard = await createPartySession({
      partyName: body.partyName.trim(),
      createdBy: body.createdBy,
      partyStyle: body.partyStyle
    });
    return NextResponse.json({ sessionId: dashboard.session.sessionId, dashboard });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create party' }, { status: 500 });
  }
}
