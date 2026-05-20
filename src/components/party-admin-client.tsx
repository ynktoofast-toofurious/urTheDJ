'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchAdminDashboard, searchSongs, submitSongRequest } from '@/lib/api';
import type { AdminDashboardModel, SearchSongResult, SongRequest } from '@/lib/types';

type ActionName = 'start' | 'pause' | 'end' | 'lock' | 'reopen' | 'approve' | 'reject' | 'playing' | 'played' | 'skip' | 'forceSync' | 'reorder';

const statusLabels = {
  pending: 'Pending',
  approved: 'Approved',
  queued: 'Queued',
  playing: 'Playing',
  played: 'Played',
  skipped: 'Skipped',
  rejected: 'Rejected'
} as const;

function ScoreChip({ request }: { request: SongRequest }) {
  return (
    <div className="pill">
      <strong>{request.priorityScore}</strong>
      <span>score</span>
      <span>•</span>
      <span>{request.bpm ?? '??'} BPM</span>
      <span>•</span>
      <span>{request.energyLevel ?? 'medium'}</span>
    </div>
  );
}

export function PartyAdminClient({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<AdminDashboardModel | null>(null);
  const [error, setError] = useState('');
  const [selectedSongId, setSelectedSongId] = useState('');
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'nowplaying' | 'queue' | 'pending'>('nowplaying');
  const [isPlaying, setIsPlaying] = useState(false);

  // DJ song search
  const [djQuery, setDjQuery] = useState('');
  const [djResults, setDjResults] = useState<SearchSongResult[]>([]);
  const [djNotice, setDjNotice] = useState('');
  const [djSearchPending, startDjSearch] = useTransition();

  async function loadDashboard() {
    try {
      const dashboard = await fetchAdminDashboard(sessionId);
      setData(dashboard);
      setSelectedSongId((current) => current || dashboard.currentSong?.requestId || dashboard.nextSongs[0]?.requestId || dashboard.queue[0]?.requestId || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load party dashboard.');
    }
  }

  useEffect(() => {
    if (djQuery.trim().length < 2) { setDjResults([]); return; }
    const t = window.setTimeout(() => {
      startDjSearch(async () => {
        try { setDjResults(await searchSongs(djQuery)); } catch { /* ignore */ }
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [djQuery]);

  async function djAddSong(song: SearchSongResult) {
    setDjNotice('');
    startTransition(async () => {
      try {
        await submitSongRequest({ sessionId, requestedBy: 'DJ', song });
        setDjNotice(`${song.songTitle} added to queue.`);
        setDjQuery('');
        setDjResults([]);
        await loadDashboard();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to add song.');
      }
    });
  }

  useEffect(() => {
    void loadDashboard();

    // SSE for instant queue updates; fall back to slow poll if connection drops.
    let fallbackInterval: number | null = null;

    const es = new EventSource(`/api/party/${sessionId}/events`);

    es.addEventListener('queue-update', () => {
      void loadDashboard();
    });

    es.addEventListener('connected', () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    });

    es.addEventListener('error', () => {
      if (fallbackInterval === null) {
        fallbackInterval = window.setInterval(() => { void loadDashboard(); }, 10_000);
      }
    });

    return () => {
      es.close();
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
    };
  }, [sessionId]);

  const nextSong = useMemo(
    () => data?.queue.find((request) => request.requestId === selectedSongId) ?? data?.nextSongs[0] ?? data?.currentSong,
    [data, selectedSongId]
  );

  async function postAction(action: ActionName, payload: Record<string, unknown> = {}) {
    setError('');
    startTransition(async () => {
      try {
        const endpointMap: Record<ActionName, string> = {
          start: '/api/party/start',
          pause: '/api/party/pause',
          end: '/api/party/end',
          lock: '/api/queue/lock-requests',
          reopen: '/api/queue/reopen-requests',
          approve: '/api/queue/approve',
          reject: '/api/queue/reject',
          playing: '/api/queue/mark-playing',
          played: '/api/queue/mark-played',
          skip: '/api/queue/skip',
          forceSync: '/api/queue/force-sync',
          reorder: '/api/queue/reorder'
        };

        const response = await fetch(endpointMap[action], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ...payload })
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Action failed.');
        }

        await loadDashboard();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : 'Action failed.');
      }
    });
  }

  if (!data) {
    return (
      <div className="panel">
        <p className="subtle">Loading live queue...</p>
        {error ? <p className="helper" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      {/* ── Header ── */}
      <div className="panel" style={{ paddingBottom: '0.5rem' }}>
        <div className="status-line">
          <div>
            <p className="eyebrow">Admin / DJ dashboard</p>
            <h2 className="section-title">{data.session.partyName}</h2>
            <p className="subtle">Status: {data.session.status} • Requests {data.session.requestsLocked ? 'locked' : 'open'}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className={`pill ${data.session.status}`}><strong>{data.session.status}</strong></div>
            <button className="btn secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/admin/login'; }}>
              Log out
            </button>
          </div>
        </div>

        {/* Party controls */}
        <div className="control-row" style={{ marginTop: '0.75rem' }}>
          <button className="btn" disabled={isPending || data.session.status === 'active'} onClick={() => postAction('start')}>▶ Start Party</button>
          <button className="btn secondary" disabled={isPending || data.session.status === 'paused'} onClick={() => postAction('pause')}>⏸ Pause</button>
          <button className="btn danger" disabled={isPending || data.session.status === 'ended'} onClick={() => postAction('end')}>⏹ End Party</button>
          <button className="btn secondary" disabled={isPending || data.session.requestsLocked} onClick={() => postAction('lock')}>🔒 Lock Requests</button>
          <button className="btn secondary" disabled={isPending || !data.session.requestsLocked} onClick={() => postAction('reopen')}>🔓 Reopen</button>
        </div>

        {/* Tab bar */}
        <div className="tab-bar" style={{ display: 'flex', gap: '0', marginTop: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {(['nowplaying', 'queue', 'pending'] as const).map((tab) => (
            <button key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.5rem 1.25rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent, #fff)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--fg, #fff)' : 'rgba(255,255,255,0.5)',
                fontWeight: activeTab === tab ? 700 : 400,
                cursor: 'pointer',
                fontSize: '0.9rem',
                letterSpacing: '0.02em',
                textTransform: 'capitalize'
              }}>
              {tab === 'nowplaying' ? '🎵 Now Playing' : tab === 'queue' ? '🎛 Queue' : `⏳ Pending (${data.pendingRequests.length})`}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="panel" style={{ borderColor: 'rgba(255,107,139,0.4)' }}>{error}</div> : null}

      {/* ── NOW PLAYING TAB ── */}
      {activeTab === 'nowplaying' && (
        <div className="split-grid">
          <div className="panel stack">
            <div className="metrics">
              <div className="stat"><span className="tiny">Queue</span><strong className="value">{data.queue.length}</strong></div>
              <div className="stat"><span className="tiny">Pending</span><strong className="value">{data.pendingRequests.length}</strong></div>
              <div className="stat"><span className="tiny">Approved</span><strong className="value">{data.approvedSongs.length}</strong></div>
            </div>

            {/* Current song player card */}
            {data.currentSong ? (
              <div className="card stack" style={{ textAlign: 'center' }}>
                {data.currentSong.artworkUrl && (
                  <img
                    src={data.currentSong.artworkUrl}
                    alt={data.currentSong.albumName ?? data.currentSong.songTitle}
                    style={{ width: '100%', maxWidth: 280, margin: '0 auto', borderRadius: 12, display: 'block' }}
                  />
                )}
                <div style={{ marginTop: '1rem' }}>
                  <p className="track-title" style={{ fontSize: '1.3rem' }}>{data.currentSong.songTitle}</p>
                  <p className="track-subtitle">{data.currentSong.artistName}{data.currentSong.albumName ? ` • ${data.currentSong.albumName}` : ''}</p>
                  <p className="subtle" style={{ marginTop: '0.25rem' }}>Requested by {data.currentSong.requestedBy}</p>
                </div>

                {/* 30-second preview player */}
                {data.currentSong.previewUrl && (
                  <div style={{ marginTop: '1rem' }}>
                    <audio
                      key={data.currentSong.requestId}
                      controls
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      style={{ width: '100%', borderRadius: 8 }}
                    >
                      <source src={data.currentSong.previewUrl} type="audio/mpeg" />
                    </audio>
                    <p className="subtle" style={{ fontSize: '0.72rem', marginTop: '0.35rem' }}>30-second Apple Music preview</p>
                  </div>
                )}

                <div className="row-actions" style={{ marginTop: '1rem', justifyContent: 'center' }}>
                  <button className="btn" disabled={isPending} onClick={() => postAction('playing', { requestId: data.currentSong?.requestId })}>
                    {isPlaying ? '▶ Now Playing' : '▶ Mark as Playing'}
                  </button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('played', { requestId: data.currentSong?.requestId })}>✓ Mark Played</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('skip', { requestId: data.currentSong?.requestId })}>⏭ Skip</button>
                </div>
              </div>
            ) : (
              <div className="card stack" style={{ textAlign: 'center', padding: '2.5rem' }}>
                <p style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎧</p>
                <p className="section-title">Nothing is playing yet</p>
                <p className="subtle">Start the party, then mark a song from the queue as playing.</p>
                {data.session.status === 'draft' && (
                  <button className="btn" style={{ marginTop: '1rem' }} disabled={isPending} onClick={() => postAction('start')}>▶ Start the Party</button>
                )}
              </div>
            )}

            {/* DJ Add Song search */}
            <div className="card stack">
              <strong>Add a Song</strong>
              <div className="field">
                <input
                  value={djQuery}
                  onChange={(e) => setDjQuery(e.target.value)}
                  placeholder="Search Apple Music or catalog…"
                />
              </div>
              {djNotice ? <div className="pill" style={{ color: 'var(--success)' }}>{djNotice}</div> : null}
              <div className="search-list">
                {djResults.map((song) => (
                  <div className="search-result" key={`${song.appleMusicId ?? song.songTitle}-${song.artistName}`}>
                    <div className="search-result-top">
                      <div className="song-meta">
                        {song.artworkUrl ? <img className="artwork-img" src={song.artworkUrl} alt={song.songTitle} /> : <div className="image-chip" aria-hidden="true" />}
                        <div>
                          <p className="track-title">{song.songTitle}</p>
                          <p className="track-subtitle">{song.artistName}{song.albumName ? ` • ${song.albumName}` : ''}</p>
                        </div>
                      </div>
                    </div>
                    <div className="result-actions" style={{ marginTop: 8 }}>
                      <button className="btn full-width" disabled={isPending} onClick={() => void djAddSong(song)}>Add to Queue</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Up Next + QR */}
          <div className="panel stack">
            <div className="card stack">
              <strong>Up Next</strong>
              <div className="timeline-list">
                {data.nextSongs.length ? data.nextSongs.map((req) => (
                  <div className="queue-row" key={req.requestId}>
                    <div className="row-top">
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {req.artworkUrl && <img src={req.artworkUrl} alt={req.songTitle} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />}
                        <div>
                          <p className="track-title">{req.songTitle}</p>
                          <p className="track-subtitle">{req.artistName} • {req.requestedBy}</p>
                        </div>
                      </div>
                      <span className={`badge ${req.status}`}>{statusLabels[req.status]}</span>
                    </div>
                    <div className="row-actions">
                      <button className="btn secondary" disabled={isPending} onClick={() => postAction('playing', { requestId: req.requestId })}>▶ Play This</button>
                      <button className="btn secondary" disabled={isPending} onClick={() => postAction('skip', { requestId: req.requestId })}>⏭ Skip</button>
                    </div>
                  </div>
                )) : <p className="subtle">No songs in the queue yet.</p>}
              </div>
            </div>

            <div className="card stack">
              <strong>Guest QR Code</strong>
              <p className="subtle" style={{ fontSize: '0.78rem' }}>Guests scan this to request songs.</p>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 8 }}>
                <QRCodeSVG
                  value={typeof window !== 'undefined' ? `${window.location.origin}/party/${sessionId}` : `/party/${sessionId}`}
                  size={180} bgColor="transparent" fgColor="currentColor" level="M"
                />
                <code style={{ fontSize: '0.72rem', opacity: 0.6 }}>/party/{sessionId}</code>
              </div>
            </div>

            <div className="card stack">
              <strong>Last played</strong>
              <div className="timeline-list">
                {data.lastPlayed.length ? data.lastPlayed.map((req) => (
                  <div className="pill" key={req.requestId}><strong>{req.songTitle}</strong><span>by {req.artistName}</span></div>
                )) : <p className="subtle">No songs played yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── QUEUE TAB ── */}
      {activeTab === 'queue' && (
        <div className="panel stack">
          <div className="status-line">
            <h3 className="section-title">Full Queue</h3>
            <button className="btn secondary" disabled={isPending || !nextSong} onClick={() => postAction('forceSync', { requestId: nextSong?.requestId })}>Force Sync Current Song</button>
          </div>
          {data.queue.length === 0 && <p className="subtle">Queue is empty. Add songs or wait for guest requests.</p>}
          <div className="queue-list">
            {data.queue.map((request) => (
              <div className="queue-row" key={request.requestId}>
                <div className="row-top">
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    {request.artworkUrl && <img src={request.artworkUrl} alt={request.songTitle} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />}
                    <div>
                      <p className="track-title">{request.songTitle}</p>
                      <p className="track-subtitle">{request.artistName} • {request.requestedBy} • {request.genre ?? ''}</p>
                    </div>
                  </div>
                  <span className={`badge ${request.status}`}>{statusLabels[request.status]}</span>
                </div>
                <div className="row-meta">
                  <ScoreChip request={request} />
                </div>
                <div className="row-actions">
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('approve', { requestId: request.requestId })}>Approve</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reject', { requestId: request.requestId })}>Reject</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reorder', { requestId: request.requestId, direction: 'up' })}>Move Up</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reorder', { requestId: request.requestId, direction: 'down' })}>Move Down</button>
                  <button className="btn" disabled={isPending} onClick={() => postAction('playing', { requestId: request.requestId })}>▶ Play</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('played', { requestId: request.requestId })}>✓ Played</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('skip', { requestId: request.requestId })}>⏭ Skip</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PENDING TAB ── */}
      {activeTab === 'pending' && (
        <div className="panel stack">
          <h3 className="section-title">Pending Requests</h3>
          {data.pendingRequests.length === 0 && <p className="subtle">No pending song requests right now.</p>}
          <div className="queue-list">
            {data.pendingRequests.map((request) => (
              <div className="queue-row" key={request.requestId}>
                <div className="row-top">
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    {request.artworkUrl && <img src={request.artworkUrl} alt={request.songTitle} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />}
                    <div>
                      <p className="track-title">{request.songTitle}</p>
                      <p className="track-subtitle">{request.artistName} • Requested by {request.requestedBy}</p>
                    </div>
                  </div>
                  <ScoreChip request={request} />
                </div>
                <div className="row-actions">
                  <button className="btn" disabled={isPending} onClick={() => postAction('approve', { requestId: request.requestId })}>✓ Approve</button>
                  <button className="btn danger" disabled={isPending} onClick={() => postAction('reject', { requestId: request.requestId })}>✗ Reject</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('playing', { requestId: request.requestId })}>▶ Play Now</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
