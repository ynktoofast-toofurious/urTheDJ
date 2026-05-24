'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchGuestView, searchSongs, submitSongRequest } from '@/lib/api';
import type { GuestViewModel, SearchSongResult } from '@/lib/types';

export function GuestPartyClient({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<GuestViewModel | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchSongResult[]>([]);
  const [selectedSong, setSelectedSong] = useState<SearchSongResult | null>(null);
  const [requestedBy, setRequestedBy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

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
      <div className="panel stack guest-request-spotlight">
        <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Request a Song</h3>
        <p className="guest-request-kicker">This is your moment. Pick a track and send it to the DJ.</p>
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
          <input
            id="songSearch"
            className="focus-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search and claim the next vibe..."
          />
        </div>

        {notice ? <div className="pill" style={{ color: 'var(--success)' }}>{notice}</div> : null}
        {error ? <div className="pill" style={{ color: 'var(--danger)' }}>{error}</div> : null}

        {isPending && query.trim().length >= 2 && results.length === 0 && (
          <div className="search-loading">Searching Apple Music…</div>
        )}

        <p className="guest-add-hint">Tap <strong>Add Song</strong> on any result to push it to the DJ queue.</p>

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
                <button className="btn full-width guest-add-song-btn" disabled={isPending} onClick={() => {
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

      {/* ── Party Stats ── */}
      <div className="split-grid">
        <div className="panel stack">
          <div className="metrics">
            <div className="stat"><span className="tiny">Current song</span><strong className="value">{data.currentSong?.songTitle ?? 'Waiting for the first track'}</strong></div>
            <div className="stat"><span className="tiny">Status</span><strong className="value">{data.session.status}</strong></div>
            <div className="stat"><span className="tiny">Requests</span><strong className="value">{data.nextSongs.length}</strong></div>
          </div>
          <p className="subtle" style={{ marginTop: '0.2rem' }}>Only the DJ can start the party and control playback.</p>

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
