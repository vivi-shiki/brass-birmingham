export type GameSummary = {
  id: string;
  playerNames: string[];
  playerCount: number;
  roundNumber: number;
  era: 'canal' | 'rail';
  status: 'playing' | 'ended';
  variant?: 'introductory_canal_only';
  createdAt?: string;
  updatedAt?: string;
  connectedClientCount?: number;
  connectedPlayerIds?: string[];
  currentPlayerId?: string;
  winners?: string[];
  victoryPointsByPlayer?: Record<string, number>;
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

function normalizedPendingDecisionType(
  value: unknown,
): NonNullable<GameSummary['pendingDecision']>['type'] | undefined {
  return value === 'negative_income' || value === 'merchant_develop' ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function playerIdIsInSeatRange(playerId: string | undefined, playerCount: number): boolean {
  if (!playerId) {
    return false;
  }
  return Array.from({length: playerCount}, (_, index) => `p${index + 1}`).includes(playerId);
}

function normalizedPlayerIds(value: unknown, playerCount: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const playerIds: string[] = [];
  for (const item of value) {
    const playerId = nonEmptyString(item);
    if (playerId && playerIdIsInSeatRange(playerId, playerCount) && !playerIds.includes(playerId)) {
      playerIds.push(playerId);
    }
  }
  return playerIds.length > 0 ? playerIds : undefined;
}

function normalizedConnectedPlayerIds(value: unknown, playerCount: number): string[] | undefined {
  const playerIds = normalizedPlayerIds(value, playerCount);
  if (!playerIds) {
    return undefined;
  }
  return Array.from({length: playerCount}, (_, index) => `p${index + 1}`)
    .filter((playerId) => playerIds.includes(playerId));
}

function normalizedVictoryPointsByPlayer(value: unknown, playerCount: number): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const pointsByPlayer: Record<string, number> = {};
  for (let index = 1; index <= playerCount; index++) {
    const playerId = `p${index}`;
    const points = record[playerId];
    if (typeof points !== 'number' || !Number.isFinite(points) || !Number.isInteger(points) || points < 0) {
      return undefined;
    }
    pointsByPlayer[playerId] = points;
  }
  return pointsByPlayer;
}

function normalizedConnectedClientCount(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function normalizedIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : undefined;
}

function timestampTime(value: string | undefined): number | undefined {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : undefined;
}

function compareTimestampsDesc(left: string | undefined, right: string | undefined): number {
  const leftTime = timestampTime(left);
  const rightTime = timestampTime(right);
  if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if ((leftTime !== undefined) !== (rightTime !== undefined)) {
    return rightTime !== undefined ? 1 : -1;
  }
  return 0;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function savedSessionsForGame(game: GameSummary, sessions: SavedPlayerSession[]): SavedPlayerSession[] {
  const byPlayerId = new Map<string, string>();
  for (const session of sessions) {
    const source = typeof session === 'object' && session !== null
      ? session as Partial<SavedPlayerSession>
      : {};
    const playerId = nonEmptyString(source.playerId);
    const token = nonEmptyString(source.token);
    if (playerId && token && playerIdIsInSeatRange(playerId, game.playerCount)) {
      byPlayerId.set(playerId, token);
    }
  }

  const seenTokens = new Set<string>();
  return Array.from(byPlayerId.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
    .flatMap(([playerId, token]) => {
      if (seenTokens.has(token)) {
        return [];
      }
      seenTokens.add(token);
      return [{playerId, token}];
    });
}

function playerNameForSession(game: GameSummary, playerId: string): string | undefined {
  const match = /^p([1-4])$/.exec(playerId);
  if (!match) {
    return undefined;
  }
  return nonEmptyString(game.playerNames[Number(match[1]) - 1]);
}

function toGameSummary(value: unknown): GameSummary | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Partial<GameSummary>;
  const id = nonEmptyString(record.id);
  const playerNames = Array.isArray(record.playerNames)
    ? record.playerNames.map(nonEmptyString)
    : undefined;
  const playerCount = record.playerCount;
  const pendingDecision = objectRecord(record.pendingDecision);
  const pendingDecisionType = normalizedPendingDecisionType(pendingDecision?.type);
  const currentPlayerId = nonEmptyString(record.currentPlayerId);
  const connectedClientCount = normalizedConnectedClientCount(record.connectedClientCount);
  const normalizedOnlineSeats = normalizedConnectedPlayerIds(record.connectedPlayerIds, typeof playerCount === 'number' ? playerCount : 0);
  const connectedPlayerIds = normalizedOnlineSeats !== undefined &&
    (connectedClientCount === undefined || normalizedOnlineSeats.length <= connectedClientCount)
    ? normalizedOnlineSeats
    : undefined;
  const createdAt = normalizedIsoTimestamp(record.createdAt);
  const updatedAt = normalizedIsoTimestamp(record.updatedAt);
  const shouldKeepCurrentPlayerId = record.status === 'playing' && record.currentPlayerId !== undefined;
  const shouldKeepEndedResults = record.status === 'ended';
  const winners = shouldKeepEndedResults
    ? normalizedPlayerIds(record.winners, typeof playerCount === 'number' ? playerCount : 0)
    : undefined;
  const victoryPointsByPlayer = shouldKeepEndedResults
    ? normalizedVictoryPointsByPlayer(record.victoryPointsByPlayer, typeof playerCount === 'number' ? playerCount : 0)
    : undefined;
  const pendingPlayerId = pendingDecision === undefined
    ? undefined
    : nonEmptyString(pendingDecision.playerId);
  const shouldKeepPendingDecision = record.status === 'playing' && record.pendingDecision !== undefined;
  const validPendingDecision = !shouldKeepPendingDecision || (
      pendingDecision !== undefined &&
      (pendingDecisionType === 'negative_income' || pendingDecisionType === 'merchant_develop') &&
      typeof playerCount === 'number' &&
      playerIdIsInSeatRange(pendingPlayerId, playerCount)
  );
  if (
    !id ||
    !playerNames ||
    !playerNames.every((name) => Boolean(name)) ||
    typeof playerCount !== 'number' ||
    ![2, 3, 4].includes(playerCount) ||
    playerNames.length !== playerCount ||
    typeof record.roundNumber !== 'number' ||
    !Number.isFinite(record.roundNumber) ||
    !Number.isInteger(record.roundNumber) ||
    record.roundNumber < 1 ||
    (record.era !== 'canal' && record.era !== 'rail') ||
    (record.status !== 'playing' && record.status !== 'ended') ||
    (shouldKeepCurrentPlayerId && !playerIdIsInSeatRange(currentPlayerId, playerCount)) ||
    (record.status === 'ended' && record.winners !== undefined && winners === undefined) ||
    (record.status === 'ended' && record.victoryPointsByPlayer !== undefined && victoryPointsByPlayer === undefined) ||
    !validPendingDecision
  ) {
    return undefined;
  }

  const publicPendingDecision = pendingDecisionType !== undefined && pendingPlayerId !== undefined
    ? {type: pendingDecisionType, playerId: pendingPlayerId}
    : undefined;

  return {
    id,
    playerNames: playerNames as string[],
    playerCount,
    roundNumber: record.roundNumber,
    era: record.era,
    status: record.status,
    ...(record.variant === 'introductory_canal_only' && record.era === 'canal' ? {variant: record.variant} : {}),
    ...(createdAt !== undefined ? {createdAt} : {}),
    ...(updatedAt !== undefined ? {updatedAt} : {}),
    ...(connectedClientCount !== undefined ? {connectedClientCount} : {}),
    ...(connectedPlayerIds !== undefined ? {connectedPlayerIds} : {}),
    ...(!shouldKeepCurrentPlayerId ? {} : {currentPlayerId: currentPlayerId as string}),
    ...(winners ? {winners} : {}),
    ...(victoryPointsByPlayer ? {victoryPointsByPlayer} : {}),
    ...(publicPendingDecision === undefined
      ? {}
      : {pendingDecision: publicPendingDecision}),
  };
}

export function gameSummaryLabel(game: GameSummary): string {
  const stateLabel = game.status === 'ended' ? 'ended' : `${game.era} round ${game.roundNumber}`;
  const variantLabel = game.variant === 'introductory_canal_only' ? ' intro' : '';
  const updatedLabel = game.updatedAt === undefined ? '' : ` - updated ${game.updatedAt}`;
  const connectedLabel = game.connectedClientCount === undefined ? '' : ` - ${game.connectedClientCount} connected`;
  const connectedPlayersLabel = game.connectedPlayerIds && game.connectedPlayerIds.length > 0
    ? ` - online ${game.connectedPlayerIds.join(', ')}`
    : '';
  const resultParts: string[] = [];
  if (game.status === 'ended' && game.winners && game.winners.length > 0) {
    resultParts.push(`${game.winners.length === 1 ? 'winner' : 'winners'} ${game.winners.join(', ')}`);
  }
  if (game.status === 'ended' && game.victoryPointsByPlayer) {
    resultParts.push(`VP ${Array.from({length: game.playerCount}, (_, index) => {
      const playerId = `p${index + 1}`;
      return `${playerId} ${game.victoryPointsByPlayer?.[playerId] ?? 0}`;
    }).join(', ')}`);
  }
  const resultLabel = resultParts.length > 0 ? ` - ${resultParts.join(' - ')}` : '';
  const actionLabel = game.status !== 'playing'
    ? resultLabel
    : game.pendingDecision
      ? ` - pending ${game.pendingDecision.playerId}: ${pendingDecisionLabel(game.pendingDecision.type)}`
      : game.currentPlayerId
        ? ` - turn ${game.currentPlayerId}`
        : '';
  return `${game.id}: ${game.playerNames.join(', ')} (${game.playerCount}p${variantLabel}) - ${stateLabel}${updatedLabel}${connectedLabel}${connectedPlayersLabel}${actionLabel}`;
}

export function savedSessionLabel(game: GameSummary, session: SavedPlayerSession): string {
  const playerId = nonEmptyString(session.playerId) ?? session.playerId;
  const playerName = playerNameForSession(game, playerId);
  const playerLabel = playerName ? `${playerName} (${playerId})` : playerId;
  return `Join ${game.id} as ${playerLabel}`;
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
    savedSessions: savedSessionsForGame(game, sessionsForGame(game.id)),
  })).sort((left, right) => {
    return compareTimestampsDesc(left.updatedAt, right.updatedAt) ||
      compareTimestampsDesc(left.createdAt, right.createdAt) ||
      left.id.localeCompare(right.id);
  });
}
