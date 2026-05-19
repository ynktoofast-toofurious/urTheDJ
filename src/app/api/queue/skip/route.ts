import { NextResponse } from 'next/server';
import { skipRequest } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { requestId?: string };
    if (!body.requestId) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    }

    return NextResponse.json(await skipRequest({ requestId: body.requestId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to skip request' }, { status: 500 });
  }
}
