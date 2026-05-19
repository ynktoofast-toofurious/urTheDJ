import { NextResponse } from 'next/server';
import { searchAppleMusic } from '@/lib/party-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? '';
    return NextResponse.json(await searchAppleMusic(query));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to search songs' }, { status: 500 });
  }
}
