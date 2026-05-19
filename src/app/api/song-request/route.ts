import { NextResponse } from 'next/server';
import { requestSong } from '@/lib/party-service';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      requestedBy?: string;
      song?: {
        songTitle: string;
        artistName: string;
        albumName?: string;
        appleMusicId?: string;
        artworkUrl?: string;
        durationMs?: number;
        bpm?: number;
        genre?: string;
        style?: string;
        energyLevel?: 'low' | 'medium' | 'high' | 'peak';
        sourceProvider: 'apple-music' | 'catalog';
      };
    };

    if (!body.sessionId || !body.song) {
      return NextResponse.json({ error: 'sessionId and song are required' }, { status: 400 });
    }

    return NextResponse.json(await requestSong({ sessionId: body.sessionId, requestedBy: body.requestedBy, song: body.song }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to request song' }, { status: 500 });
  }
}
