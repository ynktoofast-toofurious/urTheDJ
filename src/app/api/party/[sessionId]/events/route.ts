import { subscribeToParty } from '@/lib/event-bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial "connected" ping so the client knows the stream is live.
      controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));

      const unsubscribe = subscribeToParty(sessionId, () => {
        try {
          controller.enqueue(encoder.encode('event: queue-update\ndata: {}\n\n'));
        } catch {
          // Controller may already be closed — ignore.
        }
      });

      // Heartbeat every 20 s to keep the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20_000);

      // Clean up when the client disconnects.
      _request.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(heartbeat);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
