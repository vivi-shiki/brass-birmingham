export type GameSummary = {
  id: string;
  playerNames: string[];
  playerCount: number;
  roundNumber: number;
  era: string;
  status: 'playing' | 'ended';
  currentPlayerId?: string;
  pendingDecision?: {
    type: 'negative_income' | 'merchant_develop';
    playerId: string;
  };
};

export type SavedPlayerSession = {
  playerId: string;
  token: string;
};

export type ListedGame = GameSummary & {
  label: string;
  savedSessions: SavedPlayerSession[];
};

function pendingDecisionLabel(type: NonNullable<GameSummary['pendingDecision']>['type']): string {
  switch (type) {
    case 'merchant_develop':
      return 'merchant develop';
    case 'negative_income':
      return 'negative income';
  }
}

function toGameSummary(value: unknown): GameSummary | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Partial<GameSummary>;
  const validPendingDecision = record.pendingDecision === undefined || (
      typeof record.pendingDecision === 'object' &&
      record.pendingDecision !== null &&
      (record.pendingDecision.type === 'negative_income' || record.pendingDecision.type === 'merchant_develop') &&
      typeof record.pendingDecision.playerId === 'string'
  );
  if (
    typeof record.id !== 'string' ||
    !Array.isArray(record.playerNames) ||
    !record.playerNames.every((name) => typeof name === 'string') ||
    typeof record.playerCount !== 'number' ||
    ![2, 3, 4].includes(record.playerCount) ||
    typeof record.roundNumber !== 'number' ||
    !Number.isFinite(record.roundNumber) ||
    typeof record.era !== 'string' ||
    (record.status !== 'playing' && record.status !== 'ended') ||
    (record.currentPlayerId !== undefined && typeof record.currentPlayerId !== 'string') ||
    !validPendingDecision
  ) {
    return undefined;
  }

  return {
    id: record.id,
    playerNames: [...record.playerNames],
    playerCount: record.playerCount,
    roundNumber: record.roundNumber,
    era: record.era,
    status: record.status,
    ...(record.currentPlayerId === undefined ? {} : {currentPlayerId: record.currentPlayerId}),
    ...(record.pendingDecision === undefined
      ? {}
      : {pendingDecision: {type: record.pendingDecision.type, playerId: record.pendingDecision.playerId}}),
  };
}

export function gameSummaryLabel(game: GameSummary): string {
  const stateLabel = game.status === 'ended' ? 'ended' : `${game.era} round ${game.roundNumber}`;
  const actionLabel = game.status !== 'playing'
    ? ''
    : game.pendingDecision
      ? ` - pending ${game.pendingDecision.playerId}: ${pendingDecisionLabel(game.pendingDecision.type)}`
      : game.currentPlayerId
        ? ` - turn ${game.currentPlayerId}`
        : '';
  return `${game.id}: ${game.playerNames.join(', ')} (${game.playerCount}p) - ${stateLabel}${actionLabel}`;
}

export function gameSummariesFromPayload(payload: unknown): GameSummary[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as {games?: unknown}).games)) {
    return [];
  }
  return (payload as {games: unknown[]}).games
    .map(toGameSummary)
    .filter((game): game is GameSummary => Boolean(game));
}

export function listedGames(
  games: GameSummary[],
  sessionsForGame: (gameId: string) => SavedPlayerSession[],
): ListedGame[] {
  return games.map((game) => ({
    ...game,
    label: gameSummaryLabel(game),
    savedSessions: sessionsForGame(game.id),
  }));
}
