export type JoinGamePayload = {
  gameId: string;
  playerId?: string;
  sessionToken?: string;
};

export type JoinGamePayloadResult =
  | {ok: true; payload: JoinGamePayload}
  | {ok: false; error: string};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isSupportedPlayerId(playerId: string): boolean {
  return playerId === 'p1' || playerId === 'p2' || playerId === 'p3' || playerId === 'p4';
}

export function joinGamePayload(
  gameIdText: string,
  playerIdText = '',
  sessionTokenText = '',
): JoinGamePayloadResult {
  const gameId = nonEmpty(gameIdText);
  if (!gameId) {
    return {ok: false, error: 'Game ID is required'};
  }

  const playerId = nonEmpty(playerIdText);
  const sessionToken = nonEmpty(sessionTokenText);
  if (Boolean(playerId) !== Boolean(sessionToken)) {
    return {ok: false, error: 'Player ID and session token must both be provided'};
  }
  if (playerId && !isSupportedPlayerId(playerId)) {
    return {ok: false, error: 'Player ID must be p1, p2, p3, or p4'};
  }

  return {
    ok: true,
    payload: playerId && sessionToken
      ? {gameId, playerId, sessionToken}
      : {gameId},
  };
}
