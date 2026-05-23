import type { AdminDashboardModel, GuestViewModel, SearchSongResult, SongRequest } from './types';

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export async function createParty(input: { partyName: string; createdBy?: string; partyStyle?: string }) {
  const response = await fetch('/api/party/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  return readJson<{ sessionId: string }>(response);
}

export async function fetchAdminDashboard(sessionId: string) {
  const response = await fetch(`/api/party/${sessionId}`, { cache: 'no-store' });
  return readJson<AdminDashboardModel>(response);
}

export async function fetchGuestView(sessionId: string) {
  const response = await fetch(`/api/party/${sessionId}/public-view`, { cache: 'no-store' });
  return readJson<GuestViewModel>(response);
}

export async function searchSongs(query: string) {
  const response = await fetch(`/api/search-song?query=${encodeURIComponent(query)}`, { cache: 'no-store' });
  return readJson<SearchSongResult[]>(response);
}

export async function submitSongRequest(input: { sessionId: string; requestedBy?: string; song: SearchSongResult }) {
  const response = await fetch('/api/song-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  return readJson<{ request: SongRequest; duplicate?: SongRequest }>(response);
}

// Request YouTube download and S3 upload
export async function requestYouTubeDownload(youtubeUrl: string) {
  const response = await fetch('/api/youtube-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtubeUrl })
  });
  return readJson<{ s3Url?: string; error?: string; time?: string }>(response);
}
