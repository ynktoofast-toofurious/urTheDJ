import { randomUUID } from 'crypto';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo, SESSIONS_TABLE, REQUESTS_TABLE } from './dynamo';
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

// ---------- DB item types ----------

interface DbSession {
  sessionId: string;
  partyName: string;
  createdBy: string;
  status: string;
  currentSongId?: string;
  partyStyle?: string;
  requestsLocked: boolean;
  guestList?: string[];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

interface DbRequest {
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
  energyLevel?: string;
  priorityScore: number;
  requestedBy: string;
  status: string;
  createdAt: string;
  playedAt?: string;
  sourceProvider: string;
  manualPriority: number;
  duplicateOfRequestId?: string;
}

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

// ---------- Mappers (DB item → domain type) ----------

function mapSession(s: DbSession): PartySession {
  return {
    sessionId: s.sessionId,
    partyName: s.partyName,
    createdBy: s.createdBy,
    status: s.status as SessionStatus,
    currentSongId: s.currentSongId,
    partyStyle: s.partyStyle,
    requestsLocked: s.requestsLocked,
    guestList: s.guestList,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt
  };
}

function mapRequest(r: DbRequest): SongRequest {
  return {
    requestId: r.requestId,
    sessionId: r.sessionId,
    songTitle: r.songTitle,
    artistName: r.artistName,
    albumName: r.albumName,
    appleMusicId: r.appleMusicId,
    artworkUrl: r.artworkUrl,
    previewUrl: r.previewUrl,
    durationMs: r.durationMs,
    bpm: r.bpm,
    genre: r.genre,
    style: r.style,
    energyLevel: (r.energyLevel ?? 'medium') as EnergyLevel,
    priorityScore: r.priorityScore,
    requestedBy: r.requestedBy,
    status: r.status as RequestStatus,
    createdAt: r.createdAt,
    playedAt: r.playedAt,
    sourceProvider: r.sourceProvider as MusicProvider,
    manualPriority: r.manualPriority,
    duplicateOfRequestId: r.duplicateOfRequestId
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
  const result = await dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } }));
  if (!result.Item) throw new Error(`Party session ${sessionId} not found`);
  return result.Item as unknown as DbSession;
}

async function fetchRequestOrThrow(requestId: string): Promise<DbRequest> {
  const result = await dynamo.send(new GetCommand({ TableName: REQUESTS_TABLE, Key: { requestId } }));
  if (!result.Item) throw new Error(`Song request ${requestId} not found`);
  return result.Item as unknown as DbRequest;
}

async function fetchRequestsBySession(sessionId: string): Promise<DbRequest[]> {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: REQUESTS_TABLE,
      IndexName: 'sessionId-index',
      KeyConditionExpression: 'sessionId = :sid',
      ExpressionAttributeValues: { ':sid': sessionId }
    })
  );
  return (result.Items ?? []) as unknown as DbRequest[];
}

async function refreshQueueState(sessionId: string): Promise<AdminDashboardModel> {
  const [sessionResult, requestRows] = await Promise.all([
    dynamo.send(new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } })),
    fetchRequestsBySession(sessionId)
  ]);
  if (!sessionResult.Item) throw new Error(`Party session ${sessionId} not found`);

  const session = mapSession(sessionResult.Item as unknown as DbSession);
  const allRequests = requestRows.map(mapRequest);
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
  const item: DbSession = {
    sessionId,
    partyName: input.partyName.trim(),
    createdBy: input.createdBy?.trim() || 'DJ',
    status: 'draft',
    partyStyle: input.partyStyle?.trim(),
    requestsLocked: false,
    createdAt: new Date().toISOString()
  };
  await dynamo.send(new PutCommand({ TableName: SESSIONS_TABLE, Item: item }));
  const created = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return created;
}

export async function listPartySessions() {
  const result = await dynamo.send(new ScanCommand({ TableName: SESSIONS_TABLE }));
  const sessions = (result.Items ?? []).map((item) => mapSession(item as unknown as DbSession));
  return sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function startPartySession(sessionId: string) {
  await fetchSessionOrThrow(sessionId);
  await dynamo.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET #s = :active, startedAt = if_not_exists(startedAt, :now)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':now': new Date().toISOString() }
    })
  );
  const started = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return started;
}

export async function pausePartySession(sessionId: string) {
  await fetchSessionOrThrow(sessionId);
  await dynamo.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET #s = :paused',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':paused': 'paused' }
    })
  );
  const paused = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return paused;
}

export async function endPartySession(sessionId: string) {
  await fetchSessionOrThrow(sessionId);
  await dynamo.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET #s = :ended, endedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':ended': 'ended', ':now': new Date().toISOString() }
    })
  );
  const ended = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return ended;
}

export async function lockPartyRequests(sessionId: string, locked: boolean) {
  await fetchSessionOrThrow(sessionId);
  await dynamo.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET requestsLocked = :locked',
      ExpressionAttributeValues: { ':locked': locked }
    })
  );
  const result = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return result;
}

export async function updateGuestList(sessionId: string, guestList: string[]) {
  await fetchSessionOrThrow(sessionId);
  await dynamo.send(
    new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId },
      UpdateExpression: 'SET guestList = :guestList',
      ExpressionAttributeValues: { ':guestList': guestList }
    })
  );
  return refreshQueueState(sessionId);
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
  const rows = await fetchRequestsBySession(sessionId);
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
  const term = encodeURIComponent(query);
  const response = await fetch(
    `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=10`
  );

  if (!response.ok) return searchSongs(query);

  const data = (await response.json()) as {
    resultCount?: number;
    results?: Array<{
      trackId?: number;
      trackName?: string;
      artistName?: string;
      collectionName?: string;
      artworkUrl100?: string;
      previewUrl?: string;
      trackTimeMillis?: number;
      primaryGenreName?: string;
    }>;
  };

  const results = data.results ?? [];
  if (!results.length) return searchSongs(query);

  return results.map((track, index) => ({
    songTitle: track.trackName ?? `Result ${index + 1}`,
    artistName: track.artistName ?? 'Unknown Artist',
    albumName: track.collectionName,
    appleMusicId: track.trackId?.toString(),
    artworkUrl: track.artworkUrl100?.replace('100x100bb', '400x400bb'),
    previewUrl: track.previewUrl,
    durationMs: track.trackTimeMillis,
    bpm: 90 + index * 4,
    genre: track.primaryGenreName ?? 'Music',
    style: 'catalog',
    energyLevel: 'medium' as EnergyLevel,
    sourceProvider: 'apple-music' satisfies MusicProvider
  }));
}

export async function requestSong(input: SongRequestInput) {
  const sessionResult = await dynamo.send(
    new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId: input.sessionId } })
  );
  if (!sessionResult.Item) throw new Error(`Party session ${input.sessionId} not found`);
  const session = mapSession(sessionResult.Item as unknown as DbSession);

  if (session.status === 'ended') throw new Error('This party has ended. Requests are closed.');
  if (session.requestsLocked) throw new Error('Requests are locked for this party.');

  const existingRows = await fetchRequestsBySession(input.sessionId);
  const existing = existingRows.map(mapRequest);

  const currentSong = session.currentSongId
    ? existing.find((r) => r.requestId === session.currentSongId)
    : undefined;

  const duplicate = existing.find((r) => r.status !== 'rejected' && duplicateMatch(r, input.song));

  const createdAt = new Date().toISOString();
  const priorityScore = computePriorityScore(session, currentSong, input.song, createdAt, 0, Boolean(duplicate));
  const requestId = randomUUID();

  const item: DbRequest = {
    requestId,
    sessionId: input.sessionId,
    songTitle: input.song.songTitle,
    artistName: input.song.artistName,
    albumName: input.song.albumName,
    appleMusicId: input.song.appleMusicId,
    artworkUrl: input.song.artworkUrl,
    previewUrl: input.song.previewUrl,
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

  await dynamo.send(new PutCommand({ TableName: REQUESTS_TABLE, Item: item }));
  emitPartyUpdate(input.sessionId);
  return { request: mapRequest(item), duplicate };
}

export async function approveRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  await dynamo.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: 'SET #s = :approved',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':approved': 'approved' }
    })
  );
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function rejectRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  await dynamo.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: 'SET #s = :rejected',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':rejected': 'rejected' }
    })
  );
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function markRequestPlaying({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);

  await Promise.all([
    dynamo.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestId },
        UpdateExpression: 'SET #s = :playing',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':playing': 'playing' }
      })
    ),
    s.status === 'draft'
      ? dynamo.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: r.sessionId },
            UpdateExpression: 'SET currentSongId = :rid, #s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':rid': requestId, ':active': 'active' }
          })
        )
      : dynamo.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: r.sessionId },
            UpdateExpression: 'SET currentSongId = :rid',
            ExpressionAttributeValues: { ':rid': requestId }
          })
        )
  ]);

  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function markRequestPlayed({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);
  const now = new Date().toISOString();

  const updates: Promise<unknown>[] = [
    dynamo.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestId },
        UpdateExpression: 'SET #s = :played, playedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':played': 'played', ':now': now }
      })
    )
  ];

  if (s.currentSongId === requestId) {
    updates.push(
      dynamo.send(
        new UpdateCommand({
          TableName: SESSIONS_TABLE,
          Key: { sessionId: r.sessionId },
          UpdateExpression: 'REMOVE currentSongId'
        })
      )
    );
  }

  await Promise.all(updates);
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function skipRequest({ requestId }: QueueActionInput) {
  const r = await fetchRequestOrThrow(requestId);
  const s = await fetchSessionOrThrow(r.sessionId);

  const updates: Promise<unknown>[] = [
    dynamo.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestId },
        UpdateExpression: 'SET #s = :skipped',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':skipped': 'skipped' }
      })
    )
  ];

  if (s.currentSongId === requestId) {
    updates.push(
      dynamo.send(
        new UpdateCommand({
          TableName: SESSIONS_TABLE,
          Key: { sessionId: r.sessionId },
          UpdateExpression: 'REMOVE currentSongId'
        })
      )
    );
  }

  await Promise.all(updates);
  const state = await refreshQueueState(r.sessionId);
  emitPartyUpdate(r.sessionId);
  return state;
}

export async function forceSyncCurrentSong(sessionId: string, requestId: string) {
  const s = await fetchSessionOrThrow(sessionId);
  const r = await fetchRequestOrThrow(requestId);
  if (r.sessionId !== sessionId) throw new Error('Song request does not belong to this party session.');

  await Promise.all([
    s.status === 'draft'
      ? dynamo.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET currentSongId = :rid, #s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':rid': requestId, ':active': 'active' }
          })
        )
      : dynamo.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET currentSongId = :rid',
            ExpressionAttributeValues: { ':rid': requestId }
          })
        ),
    dynamo.send(
      new UpdateCommand({
        TableName: REQUESTS_TABLE,
        Key: { requestId },
        UpdateExpression: 'SET #s = :playing',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':playing': 'playing' }
      })
    )
  ]);

  const state = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return state;
}

export async function reorderRequest(sessionId: string, requestId: string, direction: 'up' | 'down') {
  const rows = await fetchRequestsBySession(sessionId);
  const requests = rows
    .map(mapRequest)
    .filter((r) => r.status !== 'played' && r.status !== 'skipped' && r.status !== 'rejected');
  const ordered = requests.sort(sortQueue);
  const index = ordered.findIndex((r) => r.requestId === requestId);

  if (index === -1) return refreshQueueState(sessionId);

  const target = ordered[index];
  const neighbor = direction === 'up' ? ordered[index - 1] : ordered[index + 1];
  if (!neighbor) return refreshQueueState(sessionId);

  await dynamo.send(
    new UpdateCommand({
      TableName: REQUESTS_TABLE,
      Key: { requestId },
      UpdateExpression: 'SET manualPriority = :mp, priorityScore = :ps',
      ExpressionAttributeValues: {
        ':mp': target.manualPriority + (direction === 'up' ? 12 : -12),
        ':ps': direction === 'up' ? neighbor.priorityScore + 1 : neighbor.priorityScore - 1
      }
    })
  );

  const state = await refreshQueueState(sessionId);
  emitPartyUpdate(sessionId);
  return state;
}

