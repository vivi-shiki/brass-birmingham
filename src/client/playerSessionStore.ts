export type PlayerSession = {
  playerId: string;
  token: string;
};

export type StoredSessions = Record<string, Record<string, string>>;

export type SessionStorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const sessionStorageKey = 'brass.playerSessions.v1';

function browserLocalStorage(): SessionStorageAdapter | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function comparePlayerIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, {numeric: true});
}

function playerSessionsFromRecord(sessions: Record<string, string>): PlayerSession[] {
  return Object.entries(sessions)
    .sort(([a], [b]) => comparePlayerIds(a, b))
    .map(([playerId, token]) => ({playerId, token}));
}

function normalizeStoredSessions(value: unknown): StoredSessions {
  if (!isObjectMap(value)) {
    return {};
  }

  const normalized: StoredSessions = {};
  for (const [rawGameId, rawSessions] of Object.entries(value)) {
    const gameId = nonEmptyString(rawGameId);
    if (!gameId || !isObjectMap(rawSessions)) {
      continue;
    }

    const sessions: Record<string, string> = {};
    for (const [rawPlayerId, rawToken] of Object.entries(rawSessions)) {
      const playerId = nonEmptyString(rawPlayerId);
      const token = nonEmptyString(rawToken);
      if (playerId && token) {
        sessions[playerId] = token;
      }
    }

    if (Object.keys(sessions).length > 0) {
      normalized[gameId] = {...(normalized[gameId] ?? {}), ...sessions};
    }
  }

  return normalized;
}

export function readStoredSessions(storage: SessionStorageAdapter | undefined = browserLocalStorage()): StoredSessions {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(sessionStorageKey);
    return raw ? normalizeStoredSessions(JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
}

export function writeStoredSessions(
  sessions: StoredSessions,
  storage: SessionStorageAdapter | undefined = browserLocalStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(sessionStorageKey, JSON.stringify(normalizeStoredSessions(sessions)));
  } catch {
    // localStorage can throw when disabled, private, or quota-limited.
  }
}

export function sessionsForGame(
  gameId: string,
  storage: SessionStorageAdapter | undefined = browserLocalStorage(),
): PlayerSession[] {
  const normalizedGameId = nonEmptyString(gameId);
  if (!normalizedGameId) {
    return [];
  }

  return playerSessionsFromRecord(readStoredSessions(storage)[normalizedGameId] ?? {});
}

export function rememberSessions(
  gameId: string,
  sessions: PlayerSession[],
  storage: SessionStorageAdapter | undefined = browserLocalStorage(),
): PlayerSession[] {
  const normalizedGameId = nonEmptyString(gameId);
  if (!normalizedGameId) {
    return [];
  }

  const stored = readStoredSessions(storage);
  const current = stored[normalizedGameId] ?? {};
  for (const session of sessions) {
    const playerId = nonEmptyString(session.playerId);
    const token = nonEmptyString(session.token);
    if (playerId && token) {
      current[playerId] = token;
    }
  }

  stored[normalizedGameId] = current;
  writeStoredSessions(stored, storage);
  return playerSessionsFromRecord(current);
}
