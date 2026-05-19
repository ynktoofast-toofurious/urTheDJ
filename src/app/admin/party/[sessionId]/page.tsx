import { PartyAdminClient } from '@/components/party-admin-client';

export default async function AdminPartyPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  return (
    <main className="app-frame stack">
      <PartyAdminClient sessionId={sessionId} />
    </main>
  );
}
