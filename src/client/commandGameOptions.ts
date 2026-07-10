import type {GameCommand} from '../common/types';

export type CommandGamePayload = {
  gameId: string;
  command: GameCommand;
  sessionToken: string;
};

export type CommandGamePayloadResult =
  | {ok: true; payload: CommandGamePayload}
  | {ok: false; error: string};

export type CommandReplyForView = {
  ok: boolean;
  game?: unknown;
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isSupportedPlayerId(playerId: string): boolean {
  return playerId === 'p1' || playerId === 'p2' || playerId === 'p3' || playerId === 'p4';
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function replyGameHasPlayer(game: unknown, playerId: string): boolean {
  const players = objectRecord(objectRecord(game)?.players);
  return objectRecord(players?.[playerId]) !== undefined;
}

export function commandGamePayload(
  gameIdText: string,
  command: unknown,
  sessionTokenText: string,
): CommandGamePayloadResult {
  const gameId = nonEmpty(gameIdText);
  if (!gameId) {
    return {ok: false, error: 'Game ID is required'};
  }

  const commandRecord = objectRecord(command);
  if (!commandRecord) {
    return {ok: false, error: 'Command payload is malformed'};
  }

  const playerId = nonEmpty(typeof commandRecord.playerId === 'string' ? commandRecord.playerId : undefined);
  if (!playerId || !isSupportedPlayerId(playerId)) {
    return {ok: false, error: 'Player ID must be p1, p2, p3, or p4'};
  }

  const sessionToken = nonEmpty(sessionTokenText);
  if (!sessionToken) {
    return {ok: false, error: `No saved session token for ${playerId}`};
  }

  return {
    ok: true,
    payload: {
      gameId,
      command: {...commandRecord, playerId} as GameCommand,
      sessionToken,
    },
  };
}

export function acknowledgedCommandPlayerId(
  reply: CommandReplyForView,
  playerIdText: string,
): string | undefined {
  const playerId = nonEmpty(playerIdText);
  if (
    !reply.ok ||
    !reply.game ||
    !playerId ||
    !isSupportedPlayerId(playerId) ||
    !replyGameHasPlayer(reply.game, playerId)
  ) {
    return undefined;
  }

  return playerId;
}
