import { NextResponse } from 'next/server';
import { getGuestView } from '@/lib/party-service';

export async function GET(_: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    return NextResponse.json(await getGuestView(sessionId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load public view' }, { status: 500 });
  }
}
