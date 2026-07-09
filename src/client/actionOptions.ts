import {validateLoan, validatePass, validateScout} from '../common/gameEngine';
import {staticConfig} from '../common/staticData';
import type {GameState} from '../common/types';
import {validationOk} from './validation';

function hasWildCard(game: GameState, cardId: string): boolean {
  const type = staticConfig.cardSpecs[cardId]?.type;
  return type === 'wild_location' || type === 'wild_industry';
}

export function canLoan(game: GameState, playerId: string): boolean {
  const player = game.players[playerId];
  if (!player) {
    return false;
  }
  const cardId = player.handCardIds[0];
  if (!cardId) {
    return false;
  }
  return validationOk(() => validateLoan(game, {type: 'loan', playerId, cardId}));
}

export function canSubmitPass(game: GameState, playerId: string, cardId: string): boolean {
  return validationOk(() => validatePass(game, {type: 'pass', playerId, cardId}));
}

export function canSubmitLoan(game: GameState, playerId: string, cardId: string): boolean {
  return validationOk(() => validateLoan(game, {type: 'loan', playerId, cardId}));
}

export function canScout(game: GameState, playerId: string): boolean {
  const player = game.players[playerId];
  if (!player) {
    return false;
  }
  if (
    player.handCardIds.length < 3 ||
    player.handCardIds.some((cardId) => hasWildCard(game, cardId)) ||
    game.cardZones.wildLocationPool.length === 0 ||
    game.cardZones.wildIndustryPool.length === 0
  ) {
    return false;
  }
  return validationOk(() => validateScout(game, {type: 'scout', playerId, cardIds: player.handCardIds.slice(0, 3)}));
}

export function canSubmitScout(game: GameState, playerId: string, cardIds: string[]): boolean {
  return validationOk(() => validateScout(game, {type: 'scout', playerId, cardIds}));
}

export function scoutCardOptionsForSelect(
  game: GameState,
  playerId: string,
  selectedCardIds: string[],
  index: number,
): string[] {
  if (!canScout(game, playerId)) {
    return [];
  }

  const player = game.players[playerId];
  const current = selectedCardIds[index];
  const selectedElsewhere = new Set(selectedCardIds.filter((id, selectedIndex) => selectedIndex !== index && id));
  return player.handCardIds.filter((id) => id === current || !selectedElsewhere.has(id));
}
