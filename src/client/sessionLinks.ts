export type LinkPlayerSession = {
  playerId: string;
  token: string;
};

export type GameJoinHash = {
  gameId: string;
  playerId?: string;
  sessionToken?: string;
};

function nonEmpty(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clean(value: string): string {
  return value.trim();
}

function decodeHashComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function hasValidPercentEncoding(value: string): boolean {
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

export function gameHash(gameId: string): string {
  return `#${encodeURIComponent(clean(gameId))}`;
}

export function playerSessionHash(gameId: string, session: LinkPlayerSession): string {
  const params = new URLSearchParams({gameId: clean(gameId)});
  const playerId = nonEmpty(session.playerId);
  const sessionToken = nonEmpty(session.token);
  if (playerId && sessionToken) {
    params.set('playerId', playerId);
    params.set('sessionToken', sessionToken);
  }
  return `#${params.toString()}`;
}

export function playerSessionUrl(baseUrl: string, gameId: string, session: LinkPlayerSession): string {
  return `${baseUrl.split('#')[0]}${playerSessionHash(gameId, session)}`;
}

export function hashForGameState(gameId: string, currentHash: string): string {
  const normalizedGameId = clean(gameId);
  const current = parseGameJoinHash(currentHash);
  if (current?.gameId === normalizedGameId && current.playerId && current.sessionToken) {
    return playerSessionHash(normalizedGameId, {playerId: current.playerId, token: current.sessionToken});
  }
  return gameHash(normalizedGameId);
}

export function parseGameJoinHash(hash: string): GameJoinHash | undefined {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) {
    return undefined;
  }

  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  if (query.includes('=')) {
    if (!hasValidPercentEncoding(query)) {
      return undefined;
    }

    const params = new URLSearchParams(query);
    const gameId = nonEmpty(params.get('gameId'));
    if (!gameId) {
      return undefined;
    }

    const playerId = nonEmpty(params.get('playerId'));
    const sessionToken = nonEmpty(params.get('sessionToken'));
    return playerId && sessionToken
      ? {gameId, playerId, sessionToken}
      : {gameId};
  }

  const gameId = nonEmpty(decodeHashComponent(raw) ?? null);
  return gameId ? {gameId} : undefined;
}
