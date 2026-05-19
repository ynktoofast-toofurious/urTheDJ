import { randomUUID } from 'crypto';
import type { PartySession as DbSession, SongRequest as DbRequest } from '@/generated/prisma/client/client';
import { prisma } from './prisma';
import { catalog } from './catalog';
import { emitPartyUpdate } from './event-bus';
import type {
  AdminDashboardModel,
  EnergyLevel,
  GuestViewModel,
  MusicProvider,
  PartySession,
  RequestStatus,
  SearchSongResult,
  SessionStatus,
  SongRequest
} from './types';

// ---------- Input types ----------

type SessionInput = {
  partyName: string;
  createdBy?: string;
  partyStyle?: string;
};

type SongRequestInput = {
  sessionId: string;
  requestedBy?: string;
  song: SearchSongResult;
};

type QueueActionInput = {
  requestId: string;
};

// ---------- Mappers (DB row → domain type) ----------

function mapSession(s: DbSession): PartySession {
  return {
    sessionId: s.sessionId,
    partyName: s.partyName,
    createdBy: s.createdBy,
    status: s.status as SessionStatus,
    currentSongId: s.currentSongId ?? undefined,
    partyStyle: s.partyStyle ?? undefined,
    requestsLocked: s.requestsLocked,
    createdAt: s.createdAt.toISOString(),
    startedAt: s.startedAt?.toISOString(),
    endedAt: s.endedAt?.toISOString()
  };
}

function mapRequest(r: DbRequest): SongRequest {
  return {
    requestId: r.requestId,
    sessionId: r.sessionId,
    songTitle: r.songTitle,
    artistName: r.artistName,
    albumName: r.albumName ?? undefined,
    appleMusicId: r.appleMusicId ?? undefined,
    artworkUrl: r.artworkUrl ?? undefined,
    durationMs: r.durationMs ?? undefined,
    bpm: r.bpm ?? undefined,
    genre: r.genre ?? undefined,
    style: r.style ?? undefined,
    energyLevel: (r.energyLevel ?? 'medium') as EnergyLevel,
    priorityScore: r.priorityScore,
    requestedBy: r.requestedBy,
    status: r.status as RequestStatus,
    createdAt: r.createdAt.toISOString(),
    playedAt: r.playedAt?.toISOString(),
    sourceProvider: r.sourceProvider as MusicProvider,
    manualPriority: r.manualPriority,
    duplicateOfRequestId: r.duplicateOfRequestId ?? undefined
  };
}

// ---------- Scoring helpers (pure, in-memory) ----------

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
}

function getEnergyLevel(bpm?: number, fallback?: EnergyLevel): EnergyLevel {
  if (!bpm) return fallback ?? 'medium';
  if (bpm >= 140) return 'peak';
  if (bpm >= 118) return 'high';
  if (bpm >= 95) return 'medium';
  return 'low';
}

function getStyleScore(sessionStyle: string | undefined, songStyle: string | undefined, genre: string | undefined) {
  if (!sessionStyle) return 8;
  const combined = normalize(`${songStyle ?? ''} ${genre ?? ''}`);
  const goal = normalize(sessionStyle);
  if (combined.includes(goal)) return 28;
  if (goal.includes(combined) && combined.length > 0) return 20;
  return 10;
}

function getBpmScore(currentSong: SongRequest | undefined, song: SearchSongResult) {
  const currentBpm = currentSong?.bpm ?? song.bpm ?? 0;
  const targetBpm = song.bpm ?? currentBpm;
  const diff = Math.abs(targetBpm - currentBpm);
  if (!currentBpm || !targetBpm) return 12;
  if (diff <= 5) return 30;
  if (diff <= 10) return 22;
  if (diff <= 16) return 14;
  return 6;
}

function getEnergyScore(currentSong: SongRequest | undefined, song: SearchSongResult) {
  const current = currentSong?.energyLevel ?? 'medium';
  const next = song.energyLevel ?? getEnergyLevel(song.bpm);
  const energyMap: Record<EnergyLevel, number> = { low: 1, medium: 2, high: 3, peak: 4 };
  const diff = Math.abs(energyMap[next] - energyMap[current]);
  if (diff === 0) return 20;
  if (diff === 1) return 18;
  if (diff === 2) return 10;
  return 4;
}

function computePriorityScore(
  session: PartySession,
  currentSong: SongRequest | undefined,
  song: SearchSongResult,
  createdAt: string,
  manualPriority = 0,
  duplicate = false
) {
  const requestAgeScore = Math.max(
    0,
    20 - Math.min(20, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000))
  );
  const bpmScore = getBpmScore(currentSong, song);
  const styleScore = getStyleScore(session.partyStyle, song.style, song.genre);
  const energyScore = getEnergyScore(currentSong, song);
  const duplicatePenalty = duplicate ? -60 : 0;
  return Math.round(bpmScore + styleScore + energyScore + requestAgeScore + manualPriority + duplicatePenalty);
}

function duplicateMatch(existing: SongRequest, song: SearchSongResult) {
  if (existing.appleMusicId && song.appleMusicId && existing.appleMusicId === song.appleMusicId) return true;
  return (
    normalize(existing.songTitle) === normalize(song.songTitle) &&
    normalize(existing.artistName) === normalize(song.artistName)
  );
}

function sortQueue(a: SongRequest, b: SongRequest) {
  const statusOrder: Record<RequestStatus, number> = {
    pending: 0,
    approved: 1,
    queued: 2,
    playing: 3,
    played: 4,
    skipped: 5,
    rejected: 6
  };
  const statusDelta = statusOrder[a.status] - statusOrder[b.status];
  if (statusDelta !== 0) return statusDelta;
  const scoreDelta = b.priorityScore - a.priorityScore;
  if (scoreDelta !== 0) return scoreDelta;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function byPlayedDesc(a: SongRequest, b: SongRequest) {
  return new Date(b.playedAt ?? b.createdAt).getTime() - new Date(a.playedAt ?? a.createdAt).getTime();
}

// ---------- DB helpers ----------

async function fetchSessionOrThrow(sessionId: string): Promise<DbSession> {
  const s = await prisma.partySession.findUnique({ where: { sessionId } });
  if (!s) throw new Error(`Party session ${sessionId} not found`);
  return s;
}

async function fetchRequestOrThrow(requestId: string): Promise<DbRequest> {
  const r = await prisma.songRequest.findUnique({ where: { requestId } });
  if (!r) throw new Error(`Song request ${requestId} not found`);
  return r;
}

async function refreshQueueState(sessionId: string): Promise<AdminDashboardModel> {
  const dbSession = await prisma.partySession.findUnique({
    where: { sessionId },
    include: { requests: true }
  });
  if (!dbSession) throw new Error(`Party session ${sessionId} not found`);

  const session = mapSession(dbSession);
  const allRequests = dbSession.requests.map(mapRequest);
  const currentSong = session.currentSongId
    ? allRequests.find((r) => r.requestId === session.currentSongId)
    : undefined;
  const lastPlayed = allRequests.filter((r) => r.status === 'played').sort(byPlayedDesc).slice(0, 3);
  const nextSongs = allRequests
    .filter((r) => r.status === 'approved' || r.status === 'queued' || r.status === 'pending')
    .sort(sortQueue)
    .slice(0, 3);

  return {
    session,
    currentSong,
    lastPlayed,
    nextSongs,
    queue: allRequests.slice().sort(sortQueue),
    pendingRequests: allRequests.filter((r) => r.status === 'pending').sort(sortQueue),
    approvedSongs: allRequests.filter((r) => r.status === 'approved' || r.status === 'queued').sort(sortQueue)
  } satisfies AdminDashboardModel;
}

// ---------- Public API ----------

export async function createPartySession(input: SessionInput) {
  const sessionId = randomUUID();
  await prisma.partySession.create({
    data: {
      sessionId,
      partyName: input.partyName.trim(),
      createdBy: input.createdBy?.trim() || 'DJ',
      status: 'draft',
      partyStyle: input.partyStyle?.trim() ?? null,
      requestsLocked: false
    }
  });
  const created = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return created;
}

export async function startPartySession(sessionId: string) {
  const session = await fetchSessionOrThrow(sessionId);
  await prisma.partySession.update({
    where: { sessionId },
    data: {
      status: 'active',
      startedAt: session.startedAt ?? new Date()
    }
  });
  const started = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return started;
}

export async function pausePartySession(sessionId: string) {
  await fetchSessionOrThrow(sessionId);
  await prisma.partySession.update({ where: { sessionId }, data: { status: 'paused' } });
  const paused = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return paused;
}

export async function endPartySession(sessionId: string) {
  await fetchSessionOrThrow(sessionId);
  await prisma.partySession.update({
    where: { sessionId },
    data: { status: 'ended', endedAt: new Date() }
  });
  const ended = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return ended;
}

export async function lockPartyRequests(sessionId: string, locked: boolean) {
  await fetchSessionOrThrow(sessionId);
  await prisma.partySession.update({ where: { sessionId }, data: { requestsLocked: locked } });
  const result = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return result;
}

export async function getPartySession(sessionId: string) {
  return refreshQueueState(sessionId);
}

export async function getGuestView(sessionId: string): Promise<GuestViewModel> {
  const dashboard = await refreshQueueState(sessionId);
  return {
    session: dashboard.session,
    currentSong: dashboard.currentSong,
    lastPlayed: dashboard.lastPlayed,
    nextSongs: dashboard.nextSongs
  };
}

export async function listRequests(sessionId: string) {
  const rows = await prisma.songRequest.findMany({ where: { sessionId } });
  return rows.map(mapRequest);
}

export function searchSongs(query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return catalog.slice(0, 8);
  return catalog
    .filter((song) => {
      const searchable = normalize(
        [song.songTitle, song.artistName, song.albumName, song.genre, song.style].filter(Boolean).join(' ')
      );
      return searchable.includes(normalizedQuery);
    })
    .slice(0, 12);
}

export async function searchAppleMusic(query: string) {
  const developerToken = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  const storefront = process.env.APPLE_MUSIC_STOREFRONT ?? 'us';

  if (!developerToken) return searchSongs(query);

  const term = encodeURIComponent(query);
  const response = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${term}&types=songs&limit=10`,
    { headers: { Authorization: `Bearer ${developerToken}` } }
  );

  if (!response.ok) return searchSongs(query);

  const data = (await response.json()) as {
    results?: {
      songs?: {
        data?: Array<{
          id: string;
          attributes?: {
            name?: string;
            artistName?: string;
            albumName?: string;
            artwork?: { url?: string };
            durationInMillis?: number;
          };
        }>;
      };
    };
  };

  const songs = data.results?.songs?.data ?? [];
  if (!songs.length) return searchSongs(query);

  return songs.map((song, index) => ({
    songTitle: song.attributes?.name ?? `Result ${index + 1}`,
    artistName: song.attributes?.artistName ?? 'Apple Music',
    albumName: song.attributes?.albumName,
    appleMusicId: song.id,
    artworkUrl: song.attributes?.artwork?.url
      ?.replace('{w}', '400')
      .replace('{h}', '400')
      .replace('{f}', 'jpg'),
    durationMs: song.attributes?.durationInMillis,
    bpm: 90 + index * 4,
    genre: 'Apple Music',
    style: 'catalog',
    energyLevel: 'medium' as EnergyLevel,
    sourceProvider: 'apple-music' satisfies MusicProvider
  }));
}

export async function requestSong(input: SongRequestInput) {
  const dbSession = await prisma.partySession.findUnique({ where: { sessionId: input.sessionId } });
  if (!dbSession) throw new Error(`Party session ${input.sessionId} not found`);
  const session = mapSession(dbSession);

  if (session.status === 'ended') throw new Error('This party has ended. Requests are closed.');
  if (session.requestsLocked) throw new Error('Requests are locked for this party.');

  const existingRows = await prisma.songRequest.findMany({ where: { sessionId: input.sessionId } });
  const existing = existingRows.map(mapRequest);

  const currentSong = session.currentSongId
    ? existing.find((r) => r.requestId === session.currentSongId)
    : undefined;

  const duplicate = existing.find((r) => r.status !== 'rejected' && duplicateMatch(r, input.song));

  const createdAt = new Date().toISOString();
  const priorityScore = computePriorityScore(session, currentSong, input.song, createdAt, 0, Boolean(duplicate));
  const requestId = randomUUID();

  await prisma.songRequest.create({
    data: {
      requestId,
      sessionId: input.sessionId,
      songTitle: input.song.songTitle,
      artistName: input.song.artistName,
      albumName: input.song.albumName ?? null,
      appleMusicId: input.song.appleMusicId ?? null,
      artworkUrl: input.song.artworkUrl ?? null,
      durationMs: input.song.durationMs ?? null,
      bpm: input.song.bpm ?? null,
      genre: input.song.genre ?? null,
      style: input.song.style ?? null,
      energyLevel: input.song.energyLevel ?? getEnergyLevel(input.song.bpm),
      priorityScore,
      requestedBy: input.requestedBy?.trim() || 'Guest',
      status: duplicate ? 'rejected' : 'pending',
      createdAt: new Date(createdAt),
      sourceProvider: input.song.sourceProvider,
      manualPriority: 0,
      duplicateOfRequestId: duplicate?.requestId ?? null
    }
  });

  const request: SongRequest = {
    requestId,
    sessionId: input.sessionId,
    songTitle: input.song.songTitle,
    artistName: input.song.artistName,
    albumName: input.song.albumName,
    appleMusicId: input.song.appleMusicId,
    artworkUrl: input.song.artworkUrl,
    durationMs: input.song.durationMs,
    bpm: input.song.bpm,
    genre: input.song.genre,
    style: input.song.style,
    energyLevel: input.song.energyLevel ?? getEnergyLevel(input.song.bpm),
    priorityScore,
    requestedBy: input.requestedBy?.trim() || 'Guest',
    status: duplicate ? 'rejected' : 'pending',
    createdAt,
    sourceProvider: input.song.sourceProvider,
    manualPriority: 0,
    duplicateOfRequestId: duplicate?.requestId
  };

  emitPartyUpdate(input.sessionId);
  return { request, duplicate };
}

export async function approveRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  await prisma.songRequest.update({ where: { requestId }, data: { status: 'approved' } });
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function rejectRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  await prisma.songRequest.update({ where: { requestId }, data: { status: 'rejected' } });
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function markRequestPlaying({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);

  await prisma.$transaction([
    prisma.songRequest.update({ where: { requestId }, data: { status: 'playing' } }),
    prisma.partySession.update({
      where: { sessionId: r.sessionId },
      data: {
        currentSongId: requestId,
        ...(s.status === 'draft' && { status: 'active' })
      }
    })
  ]);

  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function markRequestPlayed({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);

  if (s.currentSongId === requestId) {
    await prisma.$transaction([
      prisma.songRequest.update({ where: { requestId }, data: { status: 'played', playedAt: new Date() } }),
      prisma.partySession.update({ where: { sessionId: r.sessionId }, data: { currentSongId: null } })
    ]);
  } else {
    await prisma.songRequest.update({ where: { requestId }, data: { status: 'played', playedAt: new Date() } });
  }

  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function skipRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);

  if (s.currentSongId === requestId) {
    await prisma.$transaction([
      prisma.songRequest.update({ where: { requestId }, data: { status: 'skipped' } }),
      prisma.partySession.update({ where: { sessionId: r.sessionId }, data: { currentSongId: null } })
    ]);
  } else {
    await prisma.songRequest.update({ where: { requestId }, data: { status: 'skipped' } });
  }

  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function forceSyncCurrentSong(sessionId: string, requestId: string) {
  const s = await fetchSessionOrThrow(sessionId);
  const r = await fetchRequestOrThrow(requestId);
  if (r.sessionId !== sessionId) throw new Error('Song request does not belong to this party session.');

  await prisma.$transaction([
    prisma.partySession.update({
      where: { sessionId },
      data: {
        currentSongId: requestId,
        ...(s.status === 'draft' && { status: 'active' })
      }
    }),
    prisma.songRequest.update({ where: { requestId }, data: { status: 'playing' } })
  ]);

  const state = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return state;
}

export async function reorderRequest(sessionId: string, requestId: string, direction: 'up' | 'down') {
  const rows = await prisma.songRequest.findMany({ where: { sessionId } });
  const requests = rows
    .map(mapRequest)
    .filter((r) => r.status !== 'played' && r.status !== 'skipped' && r.status !== 'rejected');
  const ordered = requests.sort(sortQueue);
  const index = ordered.findIndex((r) => r.requestId === requestId);

  if (index === -1) return refreshQueueState(sessionId);

  const target = ordered[index];
  const neighbor = direction === 'up' ? ordered[index - 1] : ordered[index + 1];
  if (!neighbor) return refreshQueueState(sessionId);

  await prisma.songRequest.update({
    where: { requestId },
    data: {
      manualPriority: target.manualPriority + (direction === 'up' ? 12 : -12),
      priorityScore: direction === 'up' ? neighbor.priorityScore + 1 : neighbor.priorityScore - 1
    }
  });

  const state = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return state;
}

