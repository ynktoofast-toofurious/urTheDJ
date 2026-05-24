import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="app-frame stack">
      <section className="hero">
        <p className="eyebrow">urTheDJ</p>
        <h1>Party requests built for live energy.</h1>
        <p className="hero-copy">
          Create a session, let guests search Apple Music, and keep the dance floor moving with a smart queue that sorts by BPM, style, energy, and timing — updated live on every device.
        </p>
        <div className="hero-actions">
          <Link className="btn" href="/admin/login">Login</Link>
          <Link className="btn secondary" href="/signup">Sign Up</Link>
        </div>
      </section>

      <section className="landing-grid section">
        <div className="panel stack">
          <h2 className="section-title">Smart queue</h2>
          <p className="subtle">Requests auto-sort by BPM, energy level, style compatibility, and request timing — the dashboard always surfaces the best next track, not just the oldest one.</p>
        </div>
        <div className="panel stack">
          <h2 className="section-title">Live Apple Music search</h2>
          <p className="subtle">Guests search the full Apple Music catalog in real time. Results include artwork, BPM, and energy level — everything the DJ needs to make the call instantly.</p>
        </div>
        <div className="panel stack">
          <h2 className="section-title">Instant sync</h2>
          <p className="subtle">Server-sent events push queue updates to every screen the moment the DJ acts — no page refresh, no polling delay, no missed moments on the floor.</p>
        </div>
      </section>
    </main>
  );
}
