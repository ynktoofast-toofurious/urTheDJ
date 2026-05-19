import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="app-frame stack">
      <section className="hero">
        <p className="eyebrow">urTheDJ</p>
        <h1>Party request flow built for live energy, not a generic queue.</h1>
        <p className="hero-copy">
          Create a session, start the party, let guests search Apple Music, and keep the dance floor moving with a DJ dashboard that sorts requests by BPM, style, energy, and request timing.
        </p>
        <div className="hero-actions">
          <Link className="btn" href="/admin/create-party">Create Party</Link>
          <Link className="btn secondary" href="/party/demo">Open Guest Demo</Link>
        </div>
      </section>

      <section className="landing-grid section">
        <div className="panel stack">
          <h2 className="section-title">Guest-first requests</h2>
          <p className="subtle">A mobile-friendly guest view keeps the interface simple: current song, last three played, next three queued, and a one-tap request flow.</p>
        </div>
        <div className="panel stack">
          <h2 className="section-title">DJ control center</h2>
          <p className="subtle">The admin dashboard includes approve, reject, skip, move up/down, mark played, and force sync controls with reserved space for future transition tools.</p>
        </div>
        <div className="panel stack">
          <h2 className="section-title">AWS-ready backend</h2>
          <p className="subtle">The API routes are ready to back onto API Gateway, Lambda, and DynamoDB. Local memory fallback keeps the app usable during development before the cloud tables are connected.</p>
        </div>
      </section>
    </main>
  );
}
