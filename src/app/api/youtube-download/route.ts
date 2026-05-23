import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Lightweight in-memory log to support admin visibility without external runtime deps.
const failedDownloads: Array<{ url: string; time: string; reason: string }> = [];

export async function POST(request: NextRequest) {
  try {
    const { youtubeUrl } = await request.json();
    if (!youtubeUrl) {
      return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });
    }
    // Not used in the current in-page YouTube URL flow.
    const time = new Date().toISOString();
    failedDownloads.push({ url: youtubeUrl, time, reason: 'Direct download endpoint is disabled in this build.' });
    return NextResponse.json({ error: 'Direct download endpoint is disabled in this build.', time }, { status: 501 });
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET() {
  // Return the failure log
  return NextResponse.json({ failedDownloads });
}
