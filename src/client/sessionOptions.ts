import {getCurrentPlayerId} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameState} from '../common/types';

export type ClientPlayerSession = {
  playerId: string;
  token: string;
};

export type ActivePlayerViewOptions = {
  autoFollowActivePlayer?: boolean;
};

export type SavedSessionJoinReply = {
  ok: boolean;
  game?: GameState;
  session?: {
    playerId?: string;
  };
};

export type SavedSessionJoinViewerUpdate =
  | {apply: true; playerId: string; autoFollowActivePlayer: boolean}
  | {apply: false};

function isRedactedCardId(cardId: string): boolean {
  return cardId.startsWith('hidden-card-');
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function playerHandCardIds(game: GameState, playerId: string): string[] {
  const player = game.players[playerId] as ({handCardIds?: unknown} | undefined);
  return stringIds(player?.handCardIds);
}

function handIsVisible(game: GameState, playerId: string): boolean {
  return playerHandCardIds(game, playerId).every((cardId) => !isRedactedCardId(cardId));
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function isSupportedPlayerId(playerId: string): boolean {
  return playerId === 'p1' || playerId === 'p2' || playerId === 'p3' || playerId === 'p4';
}

function comparePlayerIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, {numeric: true});
}

export function normalizedSessionsForView(knownSessions: ClientPlayerSession[]): ClientPlayerSession[] {
  const sessionsByPlayer: Record<string, ClientPlayerSession> = {};
  for (const session of knownSessions) {
    const source = typeof session === 'object' && session !== null
      ? session as Partial<ClientPlayerSession>
      : {};
    const playerId = nonEmptyString(source.playerId);
    const token = nonEmptyString(source.token);
    if (playerId && token && isSupportedPlayerId(playerId)) {
      sessionsByPlayer[playerId] = {playerId, token};
    }
  }

  const seenTokens = new Set<string>();
  const uniqueSessions: ClientPlayerSession[] = [];
  for (const session of Object.values(sessionsByPlayer).sort((a, b) => comparePlayerIds(a.playerId, b.playerId))) {
    if (seenTokens.has(session.token)) {
      continue;
    }
    uniqueSessions.push(session);
    seenTokens.add(session.token);
  }
  return uniqueSessions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function merchantSpaceHasDevelopBonus(merchantSpaceId: string): boolean {
  return Object.values(staticConfig.locations).some((location) => (
    location.kind === 'merchant'
    && location.bonus.type === 'develop'
    && location.spaces.some((space) => space.id === merchantSpaceId)
  ));
}

function gameHasPlayer(game: unknown, playerId: string): boolean {
  if (!isSupportedPlayerId(playerId)) {
    return false;
  }
  const players = isRecord(game) ? game.players : undefined;
  const player = isRecord(players) ? players[playerId] : undefined;
  return isRecord(player);
}

function gameHasPlayerForView(game: GameState, playerId: string): boolean {
  return isSupportedPlayerId(playerId) && isRecord(game.players[playerId]);
}

function firstSupportedPlayerIdForView(game: GameState): string {
  return Object.keys(game.players).find((playerId) => gameHasPlayerForView(game, playerId)) ?? '';
}

export function sessionForPlayer(
  knownSessions: ClientPlayerSession[],
  playerId: string,
): ClientPlayerSession | undefined {
  const targetPlayerId = nonEmptyString(playerId);
  if (!targetPlayerId || !isSupportedPlayerId(targetPlayerId)) {
    return undefined;
  }

  return normalizedSessionsForView(knownSessions).find((session) => session.playerId === targetPlayerId);
}

export function pendingDecisionPlayerIdForView(game: GameState): string | undefined {
  const decision = game.pendingDecision as unknown;
  if (!isRecord(decision)) {
    return undefined;
  }

  const pendingPlayerId = nonEmptyString(decision.playerId);
  if (!pendingPlayerId || !gameHasPlayerForView(game, pendingPlayerId)) {
    return undefined;
  }

  if (decision.type === 'negative_income') {
    const incomePlayerIndex = decision.incomePlayerIndex;
    const incomePlayerId = nonNegativeInteger(incomePlayerIndex)
      ? nonEmptyString(game.turnOrder[incomePlayerIndex])
      : undefined;
    return positiveInteger(decision.amountOwed) && incomePlayerId === pendingPlayerId
      ? pendingPlayerId
      : undefined;
  }

  if (decision.type === 'merchant_develop') {
    const merchantSpaceId = nonEmptyString(decision.merchantSpaceId);
    return positiveInteger(decision.count)
      && merchantSpaceId
      && game.board.merchantSpaces[merchantSpaceId]
      && merchantSpaceHasDevelopBonus(merchantSpaceId)
      ? pendingPlayerId
      : undefined;
  }

  return undefined;
}

export function activePlayerIdForView(game: GameState): string {
  const pendingPlayerId = pendingDecisionPlayerIdForView(game);
  if (pendingPlayerId) {
    return pendingPlayerId;
  }

  const currentPlayerId = nonEmptyString(getCurrentPlayerId(game));
  if (currentPlayerId && gameHasPlayerForView(game, currentPlayerId)) {
    return currentPlayerId;
  }

  return firstSupportedPlayerIdForView(game);
}

export function savedSessionJoinViewerUpdate(
  reply: SavedSessionJoinReply,
  session: ClientPlayerSession,
): SavedSessionJoinViewerUpdate {
  const requestedPlayerId = nonEmptyString(session.playerId);
  const acknowledgedPlayerId = nonEmptyString(reply.session?.playerId);
  if (
    !reply.ok ||
    !reply.game ||
    !requestedPlayerId ||
    !isSupportedPlayerId(requestedPlayerId) ||
    requestedPlayerId !== acknowledgedPlayerId ||
    !gameHasPlayer(reply.game, requestedPlayerId)
  ) {
    return {apply: false};
  }

  return {
    apply: true,
    playerId: requestedPlayerId,
    autoFollowActivePlayer: activePlayerIdForView(reply.game) === requestedPlayerId,
  };
}

export function handPlayerIdForView(game: GameState, viewerPlayerId?: string): string {
  const normalizedViewerPlayerId = nonEmptyString(viewerPlayerId);
  if (normalizedViewerPlayerId && gameHasPlayerForView(game, normalizedViewerPlayerId)) {
    return normalizedViewerPlayerId;
  }

  return activePlayerIdForView(game);
}

export function sessionNeededForActivePlayerView(
  game: GameState,
  knownSessions: ClientPlayerSession[],
  options: ActivePlayerViewOptions = {},
): ClientPlayerSession | undefined {
  if (options.autoFollowActivePlayer === false) {
    return undefined;
  }

  if (game.status === 'ended') {
    return undefined;
  }

  const activePlayerId = activePlayerIdForView(game);
  const activePlayer = game.players[activePlayerId];
  if (!activePlayer || handIsVisible(game, activePlayerId)) {
    return undefined;
  }

  return sessionForPlayer(knownSessions, activePlayerId);
}

export function canSubmitForActivePlayerView(
  game: GameState,
  knownSessions: ClientPlayerSession[],
): boolean {
  if (game.status === 'ended') {
    return false;
  }

  const activePlayerId = activePlayerIdForView(game);
  const activePlayer = game.players[activePlayerId];
  if (!activePlayer || !sessionForPlayer(knownSessions, activePlayerId)) {
    return false;
  }

  if (game.pendingDecision) {
    return pendingDecisionPlayerIdForView(game) !== undefined;
  }

  return handIsVisible(game, activePlayerId);
}
