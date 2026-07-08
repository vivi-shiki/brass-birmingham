import {getCurrentPlayerId} from '../common/selectors';
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

export function sessionForPlayer(
  knownSessions: ClientPlayerSession[],
  playerId: string,
): ClientPlayerSession | undefined {
  return knownSessions.find((session) => session.playerId === playerId);
}

export function handPlayerIdForView(game: GameState, viewerPlayerId?: string): string {
  if (viewerPlayerId && game.players[viewerPlayerId]) {
    return viewerPlayerId;
  }

  return game.pendingDecision?.playerId ?? getCurrentPlayerId(game);
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

  const activePlayerId = game.pendingDecision?.playerId ?? getCurrentPlayerId(game);
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

  const activePlayerId = game.pendingDecision?.playerId ?? getCurrentPlayerId(game);
  const activePlayer = game.players[activePlayerId];
  if (!activePlayer || !sessionForPlayer(knownSessions, activePlayerId)) {
    return false;
  }

  if (game.pendingDecision) {
    return true;
  }

  return activePlayer.handCardIds.every((cardId) => !isRedactedCardId(cardId));
}
