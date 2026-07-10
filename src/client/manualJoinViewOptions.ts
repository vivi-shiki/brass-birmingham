export type ManualJoinReply = {
  ok: boolean;
  game?: unknown;
  session?: {
    playerId?: string;
  };
};

export type ManualJoinViewerUpdate =
  | {apply: true; playerId?: string}
  | {apply: false};

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

export function manualJoinViewerUpdate(
  reply: ManualJoinReply,
  playerIdText?: string,
): ManualJoinViewerUpdate {
  if (!reply.ok || !reply.game) {
    return {apply: false};
  }

  const playerId = nonEmpty(playerIdText);
  const acknowledgedPlayerId = nonEmpty(reply.session?.playerId);
  if (playerId) {
    if (!isSupportedPlayerId(playerId) || acknowledgedPlayerId !== playerId || !replyGameHasPlayer(reply.game, playerId)) {
      return {apply: false};
    }
    return {
      apply: true,
      playerId,
    };
  }

  if (acknowledgedPlayerId) {
    return {apply: false};
  }

  return {
    apply: true,
    playerId: undefined,
  };
}
