'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchAdminDashboard, searchSongs, submitSongRequest } from '@/lib/api';
import { catalog } from '@/lib/catalog';
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

type MixerTrack = {
  id: string;
  appleMusicId?: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  previewUrl?: string;
  sourceProvider: 'apple-music' | 'catalog';
};

type SourceSelection = 'guest' | 'local';

function dedupeMixerTracks(tracks: MixerTrack[]) {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

export function PartyAdminClient({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<AdminDashboardModel | null>(null);
  const [error, setError] = useState('');
  const [selectedSongId, setSelectedSongId] = useState('');
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'nowplaying' | 'mixer' | 'playlist' | 'pending'>('mixer');
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceSelection>('guest');
  const [appleConnectState, setAppleConnectState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [appleConnectMessage, setAppleConnectMessage] = useState('');
  const [uploadedLocalTracks, setUploadedLocalTracks] = useState<MixerTrack[]>([]);
  const [deckATrackId, setDeckATrackId] = useState('');
  const [deckBTrackId, setDeckBTrackId] = useState('');
  const deckAAudioRef = useRef<HTMLAudioElement | null>(null);
  const deckBAudioRef = useRef<HTMLAudioElement | null>(null);
  const appleMusicRef = useRef<any>(null);
  const lastAppleQueueKeyRef = useRef('');
  const uploadedTracksRef = useRef<MixerTrack[]>([]);

  // DJ song search
  const [djQuery, setDjQuery] = useState('');
  const [djResults, setDjResults] = useState<SearchSongResult[]>([]);
  const [djNotice, setDjNotice] = useState('');
  const [djSearchPending, startDjSearch] = useTransition();

  // Guest list management
  const [newGuestName, setNewGuestName] = useState('');
  const [guestListPending, startGuestListTransition] = useTransition();

  function cleanupTrackUrl(track: MixerTrack) {
    if (track.id.startsWith('local-upload-') && track.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(track.previewUrl);
    }
  }

  function addLocalFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((file) => file.type.startsWith('audio/'));

    if (files.length === 0) {
      setError('Please upload audio files only (mp3, wav, m4a, etc).');
      return;
    }

    const now = Date.now();
    const tracks = files.map((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      return {
        id: `local-upload-${now}-${index}-${file.name}`,
        title: cleanName || file.name,
        artist: 'Local File',
        artworkUrl: undefined,
        previewUrl: objectUrl,
        sourceProvider: 'catalog' as const
      } satisfies MixerTrack;
    });

    setUploadedLocalTracks((current) => dedupeMixerTracks([...tracks, ...current]));
    setDeckBTrackId((current) => current || tracks[0]?.id || current);
    setError('');
  }

  function clearUploadedLocalFiles() {
    setUploadedLocalTracks((current) => {
      current.forEach((track) => cleanupTrackUrl(track));
      return [];
    });
    setDeckBTrackId('');
  }

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

  function saveGuestList(updated: string[]) {
    startGuestListTransition(async () => {
      try {
        await fetch('/api/party/guest-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, guestList: updated })
        });
        await loadDashboard();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update guest list.');
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

  const appleMusicLibrary = useMemo(() => {
    if (!data) return [] as MixerTrack[];
    const tracks = [data.currentSong, ...data.queue, ...data.pendingRequests, ...data.approvedSongs]
      .filter((track): track is SongRequest => Boolean(track))
      .filter((track) => track.sourceProvider === 'apple-music')
      .map((track) => ({
        id: track.requestId,
        appleMusicId: track.appleMusicId,
        title: track.songTitle,
        artist: track.artistName,
        artworkUrl: track.artworkUrl,
        previewUrl: track.previewUrl,
        sourceProvider: 'apple-music' as const
      }));
    return dedupeMixerTracks(tracks);
  }, [data]);

  const localMusicLibrary = useMemo(() => {
    if (!data) return [] as MixerTrack[];
    const queueLocal = [data.currentSong, ...data.queue, ...data.pendingRequests, ...data.approvedSongs]
      .filter((track): track is SongRequest => Boolean(track))
      .filter((track) => track.sourceProvider === 'catalog')
      .map((track) => ({
        id: track.requestId,
        appleMusicId: track.appleMusicId,
        title: track.songTitle,
        artist: track.artistName,
        artworkUrl: track.artworkUrl,
        previewUrl: track.previewUrl,
        sourceProvider: 'catalog' as const
      }));

    const fallbackLocal = catalog.map((track) => ({
      id: track.appleMusicId ?? `${track.songTitle}-${track.artistName}`,
      appleMusicId: track.appleMusicId,
      title: track.songTitle,
      artist: track.artistName,
      artworkUrl: track.artworkUrl,
      previewUrl: track.previewUrl,
      sourceProvider: 'catalog' as const
    }));

    const baseLocal = queueLocal.length > 0 ? dedupeMixerTracks(queueLocal) : fallbackLocal;
    return dedupeMixerTracks([...uploadedLocalTracks, ...baseLocal]);
  }, [data, uploadedLocalTracks]);

  const guestAppleMusicIds = useMemo(
    () => appleMusicLibrary.map((track) => track.appleMusicId).filter((id): id is string => Boolean(id)),
    [appleMusicLibrary]
  );

  async function connectAppleMusic() {
    const developerToken = process.env.NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN;
    if (!developerToken) {
      setAppleConnectMessage('Missing NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN. Add it in Vercel and redeploy.');
      return;
    }

    setAppleConnectState('connecting');
    setAppleConnectMessage('');

    try {
      if (!(window as any).MusicKit) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector('script[data-apple-musickit="true"]') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Unable to load MusicKit script.')), { once: true });
            return;
          }

          const script = document.createElement('script');
          script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
          script.async = true;
          script.dataset.appleMusickit = 'true';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Unable to load MusicKit script.'));
          document.head.appendChild(script);
        });
      }

      const MusicKit = (window as any).MusicKit;
      if (!MusicKit) throw new Error('MusicKit is unavailable in this browser.');

      MusicKit.configure({
        developerToken,
        app: {
          name: 'urTheDJ',
          build: '1.0.0'
        }
      });

      const music = MusicKit.getInstance();
      const userToken = await music.authorize();
      if (!userToken) throw new Error('Apple Music sign in was cancelled.');

      appleMusicRef.current = music;
      setAppleConnectState('connected');
      setAppleConnectMessage('Apple Music connected. Full-song playback is enabled for Guest Playlist.');
    } catch (connectError) {
      setAppleConnectState('disconnected');
      setAppleConnectMessage(connectError instanceof Error ? connectError.message : 'Failed to connect Apple Music.');
    }
  }

  const deckATrack = useMemo(
    () => appleMusicLibrary.find((track) => track.id === deckATrackId) ?? appleMusicLibrary[0],
    [appleMusicLibrary, deckATrackId]
  );

  const deckBTrack = useMemo(
    () => localMusicLibrary.find((track) => track.id === deckBTrackId) ?? localMusicLibrary[0],
    [localMusicLibrary, deckBTrackId]
  );

  useEffect(() => {
    if (!deckATrackId && appleMusicLibrary[0]) setDeckATrackId(appleMusicLibrary[0].id);
  }, [appleMusicLibrary, deckATrackId]);

  useEffect(() => {
    if (!deckBTrackId && localMusicLibrary[0]) setDeckBTrackId(localMusicLibrary[0].id);
  }, [localMusicLibrary, deckBTrackId]);

  useEffect(() => {
    uploadedTracksRef.current = uploadedLocalTracks;
  }, [uploadedLocalTracks]);

  useEffect(() => {
    return () => {
      uploadedTracksRef.current.forEach((track) => cleanupTrackUrl(track));
    };
  }, []);

  useEffect(() => {
    const deckA = deckAAudioRef.current;
    const deckB = deckBAudioRef.current;
    if (!deckA || !deckB) return;

    const guestSelected = selectedSource === 'guest';
    deckA.volume = guestSelected ? 1 : 0;
    deckB.volume = guestSelected ? 0 : 1;

    if (guestSelected) {
      deckB.pause();
    } else {
      deckA.pause();
      if (appleMusicRef.current?.pause) {
        void appleMusicRef.current.pause();
      }
    }
  }, [selectedSource, deckATrack?.id, deckBTrack?.id]);

  useEffect(() => {
    if (data?.session.status !== 'active') return;

    if (selectedSource === 'guest' && appleConnectState === 'connected' && guestAppleMusicIds.length > 0 && appleMusicRef.current) {
      deckAAudioRef.current?.pause();
      deckBAudioRef.current?.pause();

      const queueKey = guestAppleMusicIds.join(',');
      void (async () => {
        try {
          if (lastAppleQueueKeyRef.current !== queueKey) {
            await appleMusicRef.current.setQueue({ songs: guestAppleMusicIds });
            lastAppleQueueKeyRef.current = queueKey;
          }
          await appleMusicRef.current.play();
        } catch {
          // If full-song playback fails, browser audio previews remain available as fallback.
        }
      })();
      return;
    }

    const primaryDeck = selectedSource === 'guest' ? deckAAudioRef.current : deckBAudioRef.current;
    if (primaryDeck?.paused) {
      void primaryDeck.play().catch(() => {
        // Browser autoplay policies may block playback until direct user interaction.
      });
    }
  }, [data?.session.status, selectedSource, appleConnectState, guestAppleMusicIds, deckATrack?.id, deckBTrack?.id]);

  async function postAction(action: ActionName, payload: Record<string, unknown> = {}) {
    setError('');
    startTransition(async () => {
      try {
        const endpointMap: Record<ActionName, string> = {
          start: '/api/party/start',
          pause: '/api/party/pause',
          end: '/api/party/end',
          lock: '/api/party/lock-requests',
          reopen: '/api/party/reopen-requests',
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
            <button
              className="btn secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              onClick={() => { window.location.href = '/admin'; }}
            >
              Back to Parties
            </button>
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
          {(['nowplaying', 'mixer', 'playlist', 'pending'] as const).map((tab) => (
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
              {tab === 'nowplaying'
                ? '🎵 Now Playing'
                : tab === 'mixer'
                  ? '🎚️ Virtual DJ Mixer'
                  : tab === 'playlist'
                    ? `📚 Playlist (${data.queue.length})`
                    : `⏳ Pending (${data.pendingRequests.length})`}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="panel" style={{ borderColor: 'rgba(255,107,139,0.4)' }}>{error}</div> : null}

      {/* ── Persistent: DJ Add a Song ── */}
      <div className="panel">
        <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Add a Song</strong>
        <div className="field" style={{ marginBottom: '0.5rem' }}>
          <input
            value={djQuery}
            onChange={(e) => setDjQuery(e.target.value)}
            placeholder="Search Apple Music or catalog…"
            style={{ width: '100%' }}
          />
        </div>
        {djNotice ? <div className="pill" style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>{djNotice}</div> : null}
        {djSearchPending && djQuery.trim().length >= 2 && djResults.length === 0 && (
          <p className="subtle">Searching…</p>
        )}
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

      {/* ── NOW PLAYING TAB ── */}
      {activeTab === 'nowplaying' && (
        <div className="stack">
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
                        loop
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        style={{ width: '100%', borderRadius: 8 }}
                      >
                        <source src={data.currentSong.previewUrl} type="audio/mpeg" />
                      </audio>
                      <p className="subtle" style={{ fontSize: '0.72rem', marginTop: '0.35rem' }}>30-second Apple Music preview — loops while DJ previews</p>
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
                <strong>Guest List</strong>
                <div className="field" style={{ marginTop: '0.25rem' }}>
                  <input
                    value={newGuestName}
                    onChange={(e) => setNewGuestName(e.target.value)}
                    placeholder="Add guest name"
                  />
                </div>
                <div className="row-actions">
                  <button
                    className="btn secondary"
                    disabled={guestListPending || !newGuestName.trim()}
                    onClick={() => {
                      const updated = [...(data.session.guestList ?? []), newGuestName.trim()];
                      setNewGuestName('');
                      saveGuestList(updated);
                    }}
                  >
                    Add Guest
                  </button>
                </div>
                <div className="timeline-list">
                  {(data.session.guestList ?? []).length ? (data.session.guestList ?? []).map((name) => (
                    <div className="pill" key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{name}</strong>
                      <button
                        className="btn secondary"
                        style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }}
                        disabled={guestListPending}
                        onClick={() => saveGuestList((data.session.guestList ?? []).filter((n) => n !== name))}
                      >
                        Remove
                      </button>
                    </div>
                  )) : <p className="subtle">No guests added yet.</p>}
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

        </div>
      )}

      {/* ── MIXER TAB ── */}
      {activeTab === 'mixer' && (
        <div className="stack">
          <div className="panel stack">
            <p className="eyebrow">Virtual DJ Mixer</p>
            <h3 className="section-title">Playback Source</h3>
            <p className="subtle">Select one source: Guest Playlist or Local Music.</p>

            <div className="status-line" style={{ gap: '0.75rem', justifyContent: 'flex-start' }}>
              <button
                className={`btn ${selectedSource === 'guest' ? '' : 'secondary'}`}
                onClick={() => setSelectedSource('guest')}
              >
                Guest Playlist
              </button>
              <button
                className={`btn ${selectedSource === 'local' ? '' : 'secondary'}`}
                onClick={() => setSelectedSource('local')}
              >
                Local Music
              </button>
              <button
                className={`btn ${appleConnectState === 'connected' ? 'secondary' : ''}`}
                disabled={appleConnectState === 'connecting'}
                onClick={() => void connectAppleMusic()}
              >
                {appleConnectState === 'connected' ? 'Apple Account Connected' : appleConnectState === 'connecting' ? 'Connecting Apple Account…' : 'Connect Apple Account'}
              </button>
            </div>
            <p className="subtle" style={{ fontSize: '0.78rem' }}>
              Active source: {selectedSource === 'guest' ? 'Guest Playlist' : 'Local Music'}
            </p>
            {appleConnectMessage ? <p className="subtle" style={{ fontSize: '0.78rem' }}>{appleConnectMessage}</p> : null}

            <div className="split-grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
              <div className="card stack" style={{ width: '100%', textAlign: 'left' }}>
                <div className="status-line">
                  <strong>Deck A</strong>
                  <span className="badge apple-music">Apple</span>
                </div>
                <p className="track-title">{deckATrack?.title ?? 'Load an Apple Music track'}</p>
                <p className="track-subtitle">{deckATrack?.artist ?? 'No track loaded'}</p>
                <audio
                  ref={deckAAudioRef}
                  key={deckATrack?.id ?? 'deck-a-empty'}
                  controls
                  style={{ width: '100%' }}
                  onEnded={() => {
                    if (appleConnectState === 'connected') return;
                    if (selectedSource !== 'guest') return;
                    if (!appleMusicLibrary.length) return;
                    const currentIndex = appleMusicLibrary.findIndex((track) => track.id === deckATrack?.id);
                    const nextTrack = appleMusicLibrary[(currentIndex + 1) % appleMusicLibrary.length];
                    if (nextTrack) setDeckATrackId(nextTrack.id);
                  }}
                >
                  {deckATrack?.previewUrl ? <source src={deckATrack.previewUrl} type="audio/mpeg" /> : null}
                </audio>
              </div>

              <div className="card stack" style={{ width: '100%', textAlign: 'left' }}>
                <div className="status-line">
                  <strong>Deck B</strong>
                  <span className="badge built-in">Local</span>
                </div>
                <p className="track-title">{deckBTrack?.title ?? 'Load a local track'}</p>
                <p className="track-subtitle">{deckBTrack?.artist ?? 'No track loaded'}</p>
                <audio
                  ref={deckBAudioRef}
                  key={deckBTrack?.id ?? 'deck-b-empty'}
                  controls
                  style={{ width: '100%' }}
                  onEnded={() => {
                    if (selectedSource !== 'local') return;
                    if (!localMusicLibrary.length) return;
                    const currentIndex = localMusicLibrary.findIndex((track) => track.id === deckBTrack?.id);
                    const nextTrack = localMusicLibrary[(currentIndex + 1) % localMusicLibrary.length];
                    if (nextTrack) setDeckBTrackId(nextTrack.id);
                  }}
                >
                  {deckBTrack?.previewUrl ? <source src={deckBTrack.previewUrl} type="audio/mpeg" /> : null}
                </audio>
                {!deckBTrack?.previewUrl ? <p className="subtle">This local track has no audio preview yet. The deck is ready for local file-backed tracks.</p> : null}
              </div>
            </div>

          </div>

          <div className="split-grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
            <div className="panel stack">
              <div className="status-line">
                <h3 className="section-title">Apple Music (Guest Playlist)</h3>
                <span className="badge apple-music">{appleMusicLibrary.length} tracks</span>
              </div>
              <p className="subtle" style={{ fontSize: '0.78rem' }}>This playlist auto-plays in order when party starts and Guest Playlist is selected.</p>
              <div className="timeline-list">
                {appleMusicLibrary.length ? appleMusicLibrary.map((track) => (
                  <div className="queue-row" key={track.id}>
                    <div className="row-top">
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {track.artworkUrl && <img src={track.artworkUrl} alt={track.title} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />}
                        <div>
                          <p className="track-title">{track.title}</p>
                          <p className="track-subtitle">{track.artist}</p>
                        </div>
                      </div>
                      <span className="badge apple-music">Guest</span>
                    </div>
                  </div>
                )) : <p className="subtle">No Apple Music tracks loaded into this party yet.</p>}
              </div>
            </div>

            <div className="panel stack">
              <div className="status-line">
                <h3 className="section-title">Local Music</h3>
                <span className="badge built-in">{localMusicLibrary.length} tracks</span>
              </div>
              <div className="card stack" style={{ gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Add Local Files</strong>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={(event) => {
                    addLocalFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <div className="status-line" style={{ justifyContent: 'space-between' }}>
                  <p className="subtle" style={{ fontSize: '0.75rem' }}>{uploadedLocalTracks.length} uploaded local track(s)</p>
                  {uploadedLocalTracks.length > 0 ? (
                    <button className="btn secondary" style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }} onClick={clearUploadedLocalFiles}>
                      Clear Uploads
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="timeline-list">
                {localMusicLibrary.length ? localMusicLibrary.map((track) => (
                  <div className="queue-row" key={track.id}>
                    <div className="row-top">
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {track.artworkUrl && <img src={track.artworkUrl} alt={track.title} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />}
                        <div>
                          <p className="track-title">{track.title}</p>
                          <p className="track-subtitle">{track.artist}</p>
                        </div>
                      </div>
                      <span className="badge built-in">Local</span>
                    </div>
                  </div>
                )) : <p className="subtle">No local tracks available.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PLAYLIST TAB ── */}
      {activeTab === 'playlist' && (
        <div className="panel stack">
          <div className="status-line">
            <h3 className="section-title">Full Playlist</h3>
            <button className="btn secondary" disabled={isPending || !nextSong} onClick={() => postAction('forceSync', { requestId: nextSong?.requestId })}>Force Sync Current Song</button>
          </div>
          <p className="subtle">Every song requested for this party is shown here, including pending, approved, playing, played, skipped, and rejected tracks.</p>
          {data.queue.length === 0 && <p className="subtle">Playlist is empty. Add songs or wait for guest requests.</p>}
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
