export type SessionStatus = 'draft' | 'active' | 'paused' | 'ended';
export type RequestStatus = 'pending' | 'approved' | 'queued' | 'playing' | 'played' | 'skipped' | 'rejected';
export type EnergyLevel = 'low' | 'medium' | 'high' | 'peak';
export type MusicProvider = 'apple-music' | 'catalog';

export interface PartySession {
  sessionId: string;
  partyName: string;
  createdBy: string;
  status: SessionStatus;
  currentSongId?: string;
  partyStyle?: string;
  requestsLocked: boolean;
  guestList?: string[];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SongRequest {
  requestId: string;
  sessionId: string;
  songTitle: string;
  artistName: string;
  albumName?: string;
  appleMusicId?: string;
  artworkUrl?: string;
  previewUrl?: string;
  durationMs?: number;
  bpm?: number;
  genre?: string;
  style?: string;
  energyLevel?: EnergyLevel;
  priorityScore: number;
  requestedBy: string;
  status: RequestStatus;
  createdAt: string;
  playedAt?: string;
  sourceProvider: MusicProvider;
  manualPriority: number;
  duplicateOfRequestId?: string;
}

export interface SearchSongResult {
  songTitle: string;
  artistName: string;
  albumName?: string;
  appleMusicId?: string;
  artworkUrl?: string;
  previewUrl?: string;
  durationMs?: number;
  bpm?: number;
  genre?: string;
  style?: string;
  energyLevel?: EnergyLevel;
  sourceProvider: MusicProvider;
}

export interface AdminDashboardModel {
  session: PartySession;
  currentSong?: SongRequest;
  lastPlayed: SongRequest[];
  nextSongs: SongRequest[];
  queue: SongRequest[];
  pendingRequests: SongRequest[];
  approvedSongs: SongRequest[];
}

export interface GuestViewModel {
  session: PartySession;
  currentSong?: SongRequest;
  lastPlayed: SongRequest[];
  nextSongs: SongRequest[];
}
