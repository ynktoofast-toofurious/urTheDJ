import { NextResponse } from 'next/server';
import { getPartySession } from '@/lib/party-service';

export async function GET(_: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json(await getPartySession(sessionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load party' }, { status: 500 });
  }
}
