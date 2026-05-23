'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchGuestView, searchSongs, submitSongRequest } from '@/lib/api';
import type { GuestViewModel, SearchSongResult } from '@/lib/types';

// Simple modal component
function Modal({ open, onClose, children }: { open: boolean, onClose: () => void, children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: 24, minWidth: 320, maxWidth: 400, boxShadow: '0 2px 16px rgba(0,0,0,0.2)' }}>
        {children}
        <button className="btn" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function GuestPartyClient({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<GuestViewModel | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchSongResult[]>([]);
  const [selectedSong, setSelectedSong] = useState<SearchSongResult | null>(null);
  const [requestedBy, setRequestedBy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  // YouTube modal state
  const [ytModalOpen, setYtModalOpen] = useState(false);
  const [ytInput, setYtInput] = useState('');
  const [ytError, setYtError] = useState('');
  const [ytWindowOpened, setYtWindowOpened] = useState(false);

  async function loadView() {
    try {
      const view = await fetchGuestView(sessionId);
      setData(view);
      if (!requestedBy) {
        const firstGuest = view.session.guestList?.[0] ?? '';
        setRequestedBy(firstGuest);
      }
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load guest view.');
    }
  }

  useEffect(() => {
    void loadView();

    // Prefer SSE for instant updates; fall back to a slow poll if the connection drops.
    let fallbackInterval: number | null = null;

    const es = new EventSource(`/api/party/${sessionId}/events`);

    es.addEventListener('queue-update', () => {
      void loadView();
    });

    es.addEventListener('connected', () => {
      // SSE is live — clear the fallback poll if it was already set.
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    });

    es.addEventListener('error', () => {
      // Connection dropped — start a slow poll until SSE reconnects.
      if (fallbackInterval === null) {
        fallbackInterval = window.setInterval(() => { void loadView(); }, 10_000);
      }
    });

    return () => {
      es.close();
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
    };
  }, [sessionId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const items = await searchSongs(query);
          setResults(items);
        } catch (searchError) {
          setError(searchError instanceof Error ? searchError.message : 'Search failed.');
        }
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query]);

  async function addSong(song: SearchSongResult) {
    setNotice('');
    setError('');
    if (!requestedBy.trim()) {
      setError('Please select your name before adding a song.');
      return;
    }
    startTransition(async () => {
      try {
        const response = await submitSongRequest({
          sessionId,
          requestedBy,
          song
        });

        if (response.duplicate) {
          setNotice(`${song.songTitle} is already in the queue.`);
        } else {
          setNotice(`${song.songTitle} was added to the party request queue.`);
        }

        setSelectedSong(null);
        await loadView();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Unable to add song.');
      }
    });
  }

  function extractYoutubeId(url: string) {
    const match = url.match(/(?:youtu.be\/|youtube.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
    return match?.[1] ?? '';
  }

  // Add YouTube song handler
  async function addYouTubeSong() {
    setYtError('');
    setNotice('');
    if (!requestedBy.trim()) {
      setYtError('Please select your name before adding a song.');
      return;
    }
    const videoId = extractYoutubeId(ytInput.trim());
    if (!videoId) {
      setYtError('Please enter a valid YouTube link.');
      return;
    }

    const youtubeSong: SearchSongResult = {
      songTitle: `YouTube Song (${videoId})`,
      artistName: 'YouTube',
      albumName: 'YouTube Request',
      artworkUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      previewUrl: ytInput.trim(),
      genre: 'YouTube',
      style: 'Web Request',
      energyLevel: 'medium',
      sourceProvider: 'catalog'
    };

    await addSong(youtubeSong);
    setYtModalOpen(false);
    setYtInput('');
    setYtWindowOpened(false);
  }

  function openYoutubePopup() {
    const popup = window.open(
      'https://www.youtube.com',
      'yt_song_picker',
      'popup=yes,width=1100,height=760,left=160,top=80,resizable=yes,scrollbars=yes'
    );
    if (!popup) {
      setYtError('Popup was blocked by your browser. Please allow popups and try again.');
      return;
    }
    setYtError('');
    setYtWindowOpened(true);
    popup.focus();
  }

  if (!data) {
    return (
      <div className="panel">
        <p className="subtle">Loading party view...</p>
        {error ? <p className="helper" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      {/* ── Header ── */}
      <div className="panel">
        <p className="eyebrow">Guest view</p>
        <h2 className="section-title">{data.session.partyName}</h2>
        <p className="subtle">Search for a song and the DJ dashboard keeps the set flowing by BPM, style, and energy.</p>
      </div>

      {/* ── Request a Song (right after header) ── */}
      <div className="panel stack">
        <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Request a Song</h3>
        <div className="field">
          <label htmlFor="requestedBy">Your name</label>
          {data.session.guestList?.length ? (
            <select id="requestedBy" value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)}>
              <option value="" disabled>Select your name</option>
              {data.session.guestList.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input id="requestedBy" value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} placeholder="Guest or nickname" />
          )}
        </div>
        <div className="field">
          <label htmlFor="songSearch">Search songs</label>
          <input id="songSearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Apple Music or fallback catalog" />
          <button
            className="btn"
            style={{ marginTop: 8 }}
            type="button"
            onClick={() => {
              setYtModalOpen(true);
              setYtError('');
              setYtWindowOpened(false);
              setYtInput('');
            }}
          >
            Add Song
          </button>
        </div>

        {notice ? <div className="pill" style={{ color: 'var(--success)' }}>{notice}</div> : null}
        {error ? <div className="pill" style={{ color: 'var(--danger)' }}>{error}</div> : null}

        {isPending && query.trim().length >= 2 && results.length === 0 && (
          <div className="search-loading">Searching Apple Music…</div>
        )}

        <div className="search-list">
          {results.map((song) => (
            <div className="search-result" key={`${song.appleMusicId ?? song.songTitle}-${song.artistName}`}>
              <div className="search-result-top">
                <div className="song-meta">
                  {song.artworkUrl ? (
                    <img className="artwork-img" src={song.artworkUrl} alt={song.albumName ?? song.songTitle} />
                  ) : (
                    <div className="image-chip" aria-hidden="true" />
                  )}
                  <div>
                    <p className="track-title">{song.songTitle}</p>
                    <p className="track-subtitle">{song.artistName}{song.albumName ? ` • ${song.albumName}` : ''}</p>
                  </div>
                </div>
                <div className={`badge ${song.sourceProvider === 'apple-music' ? 'apple-music' : 'built-in'}`}>
                  {song.sourceProvider === 'apple-music' ? '♫ Apple Music' : 'built-in'}
                </div>
              </div>
              <div className="row-meta" style={{ marginTop: 12 }}>
                <div className="pill"><strong>{song.bpm ?? '??'}</strong><span>BPM</span></div>
                <div className="pill"><strong>{song.energyLevel ?? 'medium'}</strong><span>energy</span></div>
                <div className="pill"><strong>{song.style ?? 'style'}</strong><span>style</span></div>
              </div>
              <div className="result-actions" style={{ marginTop: 12 }}>
                <button className="btn full-width" disabled={isPending} onClick={() => {
                  setSelectedSong(song);
                  void addSong(song);
                }}>Add Song</button>
              </div>
            </div>
          ))}
        </div>

        {selectedSong ? (
          <div className="card stack">
            <strong>Selected song</strong>
            <p className="subtle">{selectedSong.songTitle} by {selectedSong.artistName}</p>
          </div>
        ) : null}
      </div>

      {/* YouTube Song Modal */}
      <Modal open={ytModalOpen} onClose={() => { setYtModalOpen(false); setYtError(''); }}>
        <h3>Add a YouTube Song</h3>
        <p className="subtle" style={{ marginBottom: 8 }}>
          Open YouTube in a real popup browser window, find your song, copy its URL, then paste it here.
        </p>
        <button className="btn secondary" type="button" onClick={openYoutubePopup}>
          Open YouTube Browser
        </button>
        {ytWindowOpened ? (
          <p className="subtle" style={{ marginTop: 8 }}>
            YouTube popup opened. Search your song there and paste the link below.
          </p>
        ) : null}
        <input
          type="text"
          placeholder="Paste selected YouTube URL here"
          value={ytInput}
          onChange={e => setYtInput(e.target.value)}
          style={{ width: '100%', marginTop: 8, marginBottom: 8 }}
        />
        {extractYoutubeId(ytInput) ? (
          <div style={{ margin: '8px 0' }}>
            <iframe
              width="320"
              height="180"
              src={`https://www.youtube.com/embed/${extractYoutubeId(ytInput)}`}
              title="YouTube preview"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : null}
        {ytError && <div className="pill" style={{ color: 'var(--danger)' }}>{ytError}</div>}
        <button className="btn" style={{ marginTop: 8 }} onClick={addYouTubeSong}>Add Song</button>
      </Modal>

      {/* ── Party Stats ── */}
      <div className="split-grid">
        <div className="panel stack">
          <div className="metrics">
            <div className="stat"><span className="tiny">Current song</span><strong className="value">{data.currentSong?.songTitle ?? 'Waiting for the first track'}</strong></div>
            <div className="stat"><span className="tiny">Status</span><strong className="value">{data.session.status}</strong></div>
            <div className="stat"><span className="tiny">Requests</span><strong className="value">{data.nextSongs.length}</strong></div>
          </div>

          <div className="card stack">
            <strong>Last 3 songs played</strong>
            <div className="timeline-list">
              {data.lastPlayed.length ? data.lastPlayed.map((request) => (
                <div className="pill" key={request.requestId}>
                  <strong>{request.songTitle}</strong>
                  <span>{request.artistName}</span>
                </div>
              )) : <p className="subtle">No songs have been played yet.</p>}
            </div>
          </div>
        </div>

        <div className="panel stack">
          <div className="card stack">
            <strong>Next 3 songs</strong>
            <div className="timeline-list">
              {data.nextSongs.length ? data.nextSongs.map((request) => (
                <div className="pill" key={request.requestId}>
                  <strong>{request.songTitle}</strong>
                  <span>{request.artistName}</span>
                </div>
              )) : <p className="subtle">Waiting for the next request.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
