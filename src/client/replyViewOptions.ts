export type ReplyPlayerSession = {
  playerId: string;
};

export type ReplyViewPayload = {
  ok: boolean;
  game?: unknown;
  session?: ReplyPlayerSession;
  sessions?: ReplyPlayerSession[];
};

export type ReplyViewerUpdate =
  | {kind: 'player'; playerId: string}
  | {kind: 'observer'}
  | {kind: 'unchanged'};

export type ReplyViewerUpdateOptions = {
  preserveViewerWithoutSession?: boolean;
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

function replyPlayerId(game: unknown, playerIdText: string | undefined): string | undefined {
  const playerId = nonEmpty(playerIdText);
  return playerId && isSupportedPlayerId(playerId) && replyGameHasPlayer(game, playerId)
    ? playerId
    : undefined;
}

function firstSessionPlayerId(game: unknown, sessions: ReplyPlayerSession[] | undefined): string | undefined {
  if (!Array.isArray(sessions)) {
    return undefined;
  }

  for (const session of sessions) {
    const playerId = replyPlayerId(game, session.playerId);
    if (playerId) {
      return playerId;
    }
  }
  return undefined;
}

export function viewerUpdateFromReply(
  reply: ReplyViewPayload,
  options: ReplyViewerUpdateOptions = {},
): ReplyViewerUpdate {
  if (!reply.ok || !reply.game) {
    return {kind: 'unchanged'};
  }

  const sessionPlayerId = replyPlayerId(reply.game, reply.session?.playerId);
  if (sessionPlayerId) {
    return {kind: 'player', playerId: sessionPlayerId};
  }

  const firstPlayerId = firstSessionPlayerId(reply.game, reply.sessions);
  if (firstPlayerId) {
    return {kind: 'player', playerId: firstPlayerId};
  }

  return options.preserveViewerWithoutSession
    ? {kind: 'unchanged'}
    : {kind: 'observer'};
}
