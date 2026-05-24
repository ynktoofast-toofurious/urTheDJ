import Link from 'next/link';
import { listPartySessions } from '@/lib/party-service';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const sessions = await listPartySessions();

  return (
    <main className="app-frame stack">
      <section className="hero">
        <p className="eyebrow">Admin</p>
        <h1>Pick a party to host</h1>
        <p className="hero-copy">Choose an existing party session or create a new one.</p>
        <div className="hero-actions">
          <Link className="btn" href="/admin/create-party">Create New Party</Link>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="section-title">Created Parties</h2>
        {sessions.length === 0 ? (
          <p className="subtle">No parties created yet.</p>
        ) : (
          <div className="queue-list">
            {sessions.map((session) => (
              <div className="queue-row" key={session.sessionId}>
                <div className="row-top">
                  <div>
                    <p className="track-title">{session.partyName}</p>
                    <p className="track-subtitle">Host: {session.createdBy} • Status: {session.status}</p>
                    <p className="track-subtitle">Session: {session.sessionId}</p>
                  </div>
                  <Link className="btn" href={`/admin/party/${session.sessionId}`}>Host This Party</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
