import {validateLoan, validatePass, validateScout} from '../common/gameEngine';
import {staticConfig} from '../common/staticData';
import type {GameState} from '../common/types';
import {validationOk} from './validation';

function hasWildCard(game: GameState, cardId: string): boolean {
  const type = staticConfig.cardSpecs[cardId]?.type;
  return type === 'wild_location' || type === 'wild_industry';
}

function uniqueCardIds(cardIds: string[]): string[] {
  const seen = new Set<string>();
  return cardIds.filter((cardId) => {
    if (seen.has(cardId)) {
      return false;
    }
    seen.add(cardId);
    return true;
  });
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

function cardZoneIds(game: GameState, zoneName: keyof GameState['cardZones']): string[] {
  const zones = (game as unknown as {
    cardZones?: Partial<Record<keyof GameState['cardZones'], unknown>>;
  }).cardZones;
  return stringIds(zones?.[zoneName]);
}

export function canLoan(game: GameState, playerId: string): boolean {
  const player = game.players[playerId];
  if (!player) {
    return false;
  }
  return playerHandCardIds(game, playerId)
    .some((cardId) => validationOk(() => validateLoan(game, {type: 'loan', playerId, cardId})));
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
  const handCardIds = playerHandCardIds(game, playerId);
  if (handCardIds.some((cardId) => hasWildCard(game, cardId))) {
    return false;
  }
  const candidateCardIds = uniqueCardIds(handCardIds);
  if (
    candidateCardIds.length < 3 ||
    cardZoneIds(game, 'wildLocationPool').length === 0 ||
    cardZoneIds(game, 'wildIndustryPool').length === 0
  ) {
    return false;
  }
  return validationOk(() => validateScout(game, {type: 'scout', playerId, cardIds: candidateCardIds.slice(0, 3)}));
}

export function canSubmitScout(game: GameState, playerId: string, cardIds: string[]): boolean {
  return validationOk(() => validateScout(game, {type: 'scout', playerId, cardIds}));
}

export function normalizeScoutCardSelection(
  game: GameState,
  playerId: string,
  selectedCardIds: string[],
): string[] {
  if (!canScout(game, playerId)) {
    return [];
  }

  const handCardIds = uniqueCardIds(playerHandCardIds(game, playerId));
  const normalized: string[] = [];
  const selected = selectedCardIds.slice(0, 3);

  for (const selectedCardId of selected) {
    if (selectedCardId && handCardIds.includes(selectedCardId) && !normalized.includes(selectedCardId)) {
      normalized.push(selectedCardId);
      continue;
    }

    const replacement = handCardIds.find((cardId) => !normalized.includes(cardId));
    if (replacement) {
      normalized.push(replacement);
    }
  }

  while (normalized.length < 3) {
    const replacement = handCardIds.find((cardId) => !normalized.includes(cardId));
    if (!replacement) {
      break;
    }
    normalized.push(replacement);
  }

  return normalized.length === 3 ? normalized : [];
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

  const current = selectedCardIds[index];
  const selectedElsewhere = new Set(selectedCardIds.filter((id, selectedIndex) => selectedIndex !== index && id));
  return uniqueCardIds(playerHandCardIds(game, playerId)).filter((id) => id === current || !selectedElsewhere.has(id));
}
