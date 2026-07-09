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

function isRedactedCardId(cardId: string): boolean {
  return cardId.startsWith('hidden-card-');
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

export function sessionForPlayer(
  knownSessions: ClientPlayerSession[],
  playerId: string,
): ClientPlayerSession | undefined {
  const targetPlayerId = nonEmptyString(playerId);
  if (!targetPlayerId) {
    return undefined;
  }

  for (const session of knownSessions) {
    const source = typeof session === 'object' && session !== null
      ? session as Partial<ClientPlayerSession>
      : {};
    const savedPlayerId = nonEmptyString(source.playerId);
    const token = nonEmptyString(source.token);
    if (savedPlayerId === targetPlayerId && token) {
      return {playerId: savedPlayerId, token};
    }
  }

  return undefined;
}

export function pendingDecisionPlayerIdForView(game: GameState): string | undefined {
  const decision = game.pendingDecision as unknown;
  if (!isRecord(decision)) {
    return undefined;
  }

  const pendingPlayerId = nonEmptyString(decision.playerId);
  if (!pendingPlayerId || !game.players[pendingPlayerId]) {
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
  if (currentPlayerId && game.players[currentPlayerId]) {
    return currentPlayerId;
  }

  return Object.keys(game.players)[0] ?? '';
}

export function handPlayerIdForView(game: GameState, viewerPlayerId?: string): string {
  const normalizedViewerPlayerId = nonEmptyString(viewerPlayerId);
  if (normalizedViewerPlayerId && game.players[normalizedViewerPlayerId]) {
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
  if (!activePlayer || activePlayer.handCardIds.every((cardId) => !isRedactedCardId(cardId))) {
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

  return activePlayer.handCardIds.every((cardId) => !isRedactedCardId(cardId));
}
