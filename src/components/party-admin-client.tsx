'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchAdminDashboard } from '@/lib/api';
import type { AdminDashboardModel, SongRequest } from '@/lib/types';

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
    <div className="split-grid">
      <div className="panel stack">
        <div className="status-line">
          <div>
            <p className="eyebrow">Admin / DJ dashboard</p>
            <h2 className="section-title">{data.session.partyName}</h2>
            <p className="subtle">Status: {data.session.status} • Requests {data.session.requestsLocked ? 'locked' : 'open'}</p>
          </div>
          <div className={`pill ${data.session.status}`}>
            <strong>{data.session.status}</strong>
          </div>
        </div>

        <div className="metrics">
          <div className="stat"><span className="tiny">Current song</span><strong className="value">{data.currentSong ? `${data.currentSong.songTitle}` : 'Nothing playing'}</strong></div>
          <div className="stat"><span className="tiny">Queue items</span><strong className="value">{data.queue.length}</strong></div>
          <div className="stat"><span className="tiny">Pending</span><strong className="value">{data.pendingRequests.length}</strong></div>
          <div className="stat"><span className="tiny">Approved</span><strong className="value">{data.approvedSongs.length}</strong></div>
        </div>

        <div className="control-row">
          <button className="btn" disabled={isPending || data.session.status === 'active'} onClick={() => postAction('start')}>Start Your Party</button>
          <button className="btn secondary" disabled={isPending || data.session.status === 'paused'} onClick={() => postAction('pause')}>Pause Party</button>
          <button className="btn danger" disabled={isPending || data.session.status === 'ended'} onClick={() => postAction('end')}>End Party</button>
          <button className="btn secondary" disabled={isPending || data.session.requestsLocked} onClick={() => postAction('lock')}>Lock Requests</button>
          <button className="btn secondary" disabled={isPending || !data.session.requestsLocked} onClick={() => postAction('reopen')}>Reopen Requests</button>
        </div>

        <div className="section-grid">
          <div className="card stack">
            <div className="status-line">
              <h3 className="section-title" style={{ fontSize: '1.15rem' }}>Current / Next</h3>
              {nextSong ? <ScoreChip request={nextSong} /> : null}
            </div>
            {data.currentSong ? (
              <div className="queue-row">
                <div className="row-top">
                  <div>
                    <p className="track-title">Now playing: {data.currentSong.songTitle}</p>
                    <p className="track-subtitle">{data.currentSong.artistName} • Requested by {data.currentSong.requestedBy}</p>
                  </div>
                  <span className={`badge ${data.currentSong.status}`}>{statusLabels[data.currentSong.status]}</span>
                </div>
                <div className="row-actions">
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('playing', { requestId: data.currentSong?.requestId })}>Mark as Playing</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('played', { requestId: data.currentSong?.requestId })}>Mark as Played</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('skip', { requestId: data.currentSong?.requestId })}>Skip Song</button>
                </div>
              </div>
            ) : (
              <p className="subtle">No song is currently marked as playing. Use the queue below to force sync a track.</p>
            )}
          </div>

          <div className="card stack">
            <h3 className="section-title" style={{ fontSize: '1.15rem' }}>Coming Soon Audio Tools</h3>
            <p className="subtle">Reserved space for transition suggestions, vocal isolation, beat dry mix, and tempo blend controls.</p>
            <div className="timeline-list">
              {['Live transition suggestion', 'Remove vocals / acapella', 'Isolate melody', 'Keep dry beat', 'Transition type selector'].map((item) => (
                <div className="coming-soon-item" key={item}>
                  <div className="status-line">
                    <strong>{item}</strong>
                    <span className="badge pending">Coming soon</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="split-grid two-up">
        <div className="panel stack">
          <div className="status-line">
            <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Full Queue</h3>
            <button className="btn secondary" disabled={isPending || !nextSong} onClick={() => postAction('forceSync', { requestId: nextSong?.requestId })}>Force Sync Current Song</button>
          </div>

          <div className="queue-list">
            {data.queue.map((request) => (
              <div className="queue-row" key={request.requestId}>
                <div className="row-top">
                  <div>
                    <p className="track-title">{request.songTitle}</p>
                    <p className="track-subtitle">{request.artistName} • {request.requestedBy} • {request.genre ?? 'Genre unknown'} / {request.style ?? 'Style unknown'}</p>
                  </div>
                  <span className={`badge ${request.status}`}>{statusLabels[request.status]}</span>
                </div>
                <div className="row-meta">
                  <ScoreChip request={request} />
                  <span className="tiny">Source: {request.sourceProvider}</span>
                </div>
                <div className="row-actions">
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('approve', { requestId: request.requestId })}>Approve</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reject', { requestId: request.requestId })}>Reject</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reorder', { requestId: request.requestId, direction: 'up' })}>Move Up</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('reorder', { requestId: request.requestId, direction: 'down' })}>Move Down</button>
                </div>
                <div className="row-actions">
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('playing', { requestId: request.requestId })}>Mark Playing</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('played', { requestId: request.requestId })}>Mark Played</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('skip', { requestId: request.requestId })}>Skip</button>
                  <button className="btn secondary" disabled={isPending} onClick={() => postAction('forceSync', { requestId: request.requestId })}>Force Sync</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel stack">
          <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Live Snapshot</h3>
          <div className="card stack">
            <strong>Guest QR Code</strong>
            <p className="subtle" style={{ fontSize: '0.78rem' }}>Guests scan this to open the song-request screen.</p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 8 }}>
              <QRCodeSVG
                value={typeof window !== 'undefined' ? `${window.location.origin}/party/${sessionId}` : `/party/${sessionId}`}
                size={180}
                bgColor="transparent"
                fgColor="currentColor"
                level="M"
              />
              <code style={{ fontSize: '0.72rem', opacity: 0.6 }}>/party/{sessionId}</code>
            </div>
          </div>

          <div className="card stack">
            <strong>Last 3 songs played</strong>
            <div className="timeline-list">
              {data.lastPlayed.length ? data.lastPlayed.map((request) => (
                <div className="pill" key={request.requestId}>
                  <strong>{request.songTitle}</strong>
                  <span>by {request.artistName}</span>
                </div>
              )) : <p className="subtle">No songs have been marked as played yet.</p>}
            </div>
          </div>

          <div className="card stack">
            <strong>Next 3 songs</strong>
            <div className="timeline-list">
              {data.nextSongs.length ? data.nextSongs.map((request) => (
                <div className="pill" key={request.requestId}>
                  <strong>{request.songTitle}</strong>
                  <span>{request.artistName}</span>
                </div>
              )) : <p className="subtle">No approved or pending songs in the queue.</p>}
            </div>
          </div>

          <div className="card stack">
            <strong>Request statuses</strong>
            <div className="timeline-list">
              {data.pendingRequests.length ? data.pendingRequests.map((request) => (
                <div className="pill" key={request.requestId}>
                  <strong>Pending</strong>
                  <span>{request.songTitle}</span>
                </div>
              )) : <p className="subtle">No pending requests.</p>}
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="panel" style={{ borderColor: 'rgba(255,107,139,0.4)' }}>{error}</div> : null}
    </div>
  );
}
