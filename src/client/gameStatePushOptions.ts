import {hashForGameState} from './sessionLinks';

export type PushPlayerSession = {
  playerId: string;
  token: string;
};

export type GameStatePushOptionsResult =
  | {ok: true; hash: string; sessions: PushPlayerSession[]}
  | {ok: false; error: string};

export type SessionsForGame = (gameId: string) => PushPlayerSession[];

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function comparePlayerIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, {numeric: true});
}

function isSupportedPlayerId(playerId: string): boolean {
  return playerId === 'p1' || playerId === 'p2' || playerId === 'p3' || playerId === 'p4';
}

function normalizedSessions(sessions: PushPlayerSession[]): PushPlayerSession[] {
  const sessionsByPlayer: Record<string, PushPlayerSession> = {};
  for (const session of sessions) {
    const playerId = nonEmpty(session.playerId);
    const token = nonEmpty(session.token);
    if (playerId && token && isSupportedPlayerId(playerId)) {
      sessionsByPlayer[playerId] = {playerId, token};
    }
  }

  const seenTokens = new Set<string>();
  const uniqueSessions: PushPlayerSession[] = [];
  for (const session of Object.values(sessionsByPlayer).sort((a, b) => comparePlayerIds(a.playerId, b.playerId))) {
    if (seenTokens.has(session.token)) {
      continue;
    }
    uniqueSessions.push(session);
    seenTokens.add(session.token);
  }
  return uniqueSessions;
}

export function gameStatePushOptions(
  gameIdText: string,
  currentHash: string,
  sessionsForGame: SessionsForGame,
): GameStatePushOptionsResult {
  const gameId = nonEmpty(gameIdText);
  if (!gameId) {
    return {ok: false, error: 'Game ID is required'};
  }

  let sessions: PushPlayerSession[];
  try {
    sessions = sessionsForGame(gameId);
  } catch {
    sessions = [];
  }

  return {
    ok: true,
    hash: hashForGameState(gameId, currentHash),
    sessions: normalizedSessions(sessions),
  };
}
