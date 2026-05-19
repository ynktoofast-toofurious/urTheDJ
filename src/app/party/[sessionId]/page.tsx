import { GuestPartyClient } from '@/components/guest-party-client';

export default async function GuestPartyPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  return (
    <main className="app-frame stack">
      <GuestPartyClient sessionId={sessionId} />
    </main>
  );
}
