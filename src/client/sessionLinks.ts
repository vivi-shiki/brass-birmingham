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

function decodeHashComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function gameHash(gameId: string): string {
  return `#${encodeURIComponent(gameId)}`;
}

export function playerSessionHash(gameId: string, session: LinkPlayerSession): string {
  const params = new URLSearchParams({
    gameId,
    playerId: session.playerId,
    sessionToken: session.token,
  });
  return `#${params.toString()}`;
}

export function playerSessionUrl(baseUrl: string, gameId: string, session: LinkPlayerSession): string {
  return `${baseUrl.split('#')[0]}${playerSessionHash(gameId, session)}`;
}

export function hashForGameState(gameId: string, currentHash: string): string {
  const current = parseGameJoinHash(currentHash);
  if (current?.gameId === gameId && current.playerId && current.sessionToken) {
    return currentHash.startsWith('#') ? currentHash : `#${currentHash}`;
  }
  return gameHash(gameId);
}

export function parseGameJoinHash(hash: string): GameJoinHash | undefined {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) {
    return undefined;
  }

  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  if (query.includes('=')) {
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
