import {
  validateBuild,
  validateDevelop,
  validateLoan,
  validateNetwork,
  validatePass,
  validateScout,
  validateSell,
} from '../common/gameEngine';
import {getCurrentPlayerId} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameState, IndustryType, ResourceSource, SellStep} from '../common/types';
import {validationReason} from './validation';

function ordinaryActionBlockReason(game: GameState, playerId: string): string | undefined {
  if (!game.players[playerId]) {
    return `Unknown player: ${playerId}`;
  }
  if (game.status !== 'playing') {
    return 'Game is not active';
  }
  if (game.pendingDecision) {
    return 'Pending decision must be resolved first';
  }
  const currentPlayerId = getCurrentPlayerId(game);
  return currentPlayerId === playerId ? undefined : `It is ${currentPlayerId}'s turn`;
}

export function passActionReason(game: GameState, playerId: string, cardId: string): string | undefined {
  return validationReason(() => validatePass(game, {type: 'pass', playerId, cardId}));
}

export function loanActionReason(game: GameState, playerId: string, cardId: string): string | undefined {
  return validationReason(() => validateLoan(game, {type: 'loan', playerId, cardId}));
}

export function scoutActionReason(game: GameState, playerId: string, cardIds: string[]): string | undefined {
  const blockReason = ordinaryActionBlockReason(game, playerId);
  if (blockReason) {
    return blockReason;
  }
  const player = game.players[playerId];
  if (!player) {
    return `Unknown player: ${playerId}`;
  }
  if (player.handCardIds.length < 3) {
    return 'Need at least three cards to Scout';
  }
  if (player.handCardIds.some((cardId) => {
    const type = staticConfig.cardSpecs[cardId]?.type;
    return type === 'wild_location' || type === 'wild_industry';
  })) {
    return 'Cannot Scout while holding a wild card';
  }
  if (game.cardZones.wildLocationPool.length === 0 || game.cardZones.wildIndustryPool.length === 0) {
    return 'Wild card pools are empty';
  }
  return validationReason(() => validateScout(game, {type: 'scout', playerId, cardIds}));
}

export function buildActionReason(
  game: GameState,
  playerId: string,
  cardId: string,
  locationId: string,
  slotId: string,
  industryType: IndustryType | '' | undefined,
  coalSources?: ResourceSource[],
  ironSources?: ResourceSource[],
): string | undefined {
  const blockReason = ordinaryActionBlockReason(game, playerId);
  if (blockReason) {
    return blockReason;
  }
  if (!locationId) {
    return 'No valid build location';
  }
  if (!slotId) {
    return 'No valid build slot';
  }
  if (!industryType) {
    return 'No buildable industry';
  }
  return validationReason(() => validateBuild(game, {
    type: 'build',
    playerId,
    cardId,
    locationId,
    slotId,
    industryType,
    coalSources,
    ironSources,
  }));
}

export function networkActionReason(
  game: GameState,
  playerId: string,
  cardId: string,
  linkLineIds: string[],
  coalSources?: ResourceSource[],
  beerSourceForDoubleRail?: ResourceSource,
): string | undefined {
  const blockReason = ordinaryActionBlockReason(game, playerId);
  if (blockReason) {
    return blockReason;
  }
  if (linkLineIds.length === 0) {
    return 'No valid network links';
  }
  return validationReason(() => validateNetwork(game, {
    type: 'network',
    playerId,
    cardId,
    linkLineIds,
    coalSources,
    beerSourceForDoubleRail,
  }));
}

export function developActionReason(
  game: GameState,
  playerId: string,
  cardId: string,
  industryTypes: IndustryType[],
  ironSources?: ResourceSource[],
): string | undefined {
  const blockReason = ordinaryActionBlockReason(game, playerId);
  if (blockReason) {
    return blockReason;
  }
  if (industryTypes.length === 0) {
    return 'No developable tiles';
  }
  return validationReason(() => validateDevelop(game, {
    type: 'develop',
    playerId,
    cardId,
    industryTypes,
    ironSources,
  }));
}

export function sellActionReason(
  game: GameState,
  playerId: string,
  cardId: string,
  sales: SellStep[],
): string | undefined {
  const blockReason = ordinaryActionBlockReason(game, playerId);
  if (blockReason) {
    return blockReason;
  }
  if (sales.length === 0 || sales.some((sale) => !sale.industryInstanceId)) {
    return 'Select a sellable industry';
  }
  if (sales.some((sale) => !sale.merchantSpaceId)) {
    return 'Select a merchant';
  }
  return validationReason(() => validateSell(game, {type: 'sell', playerId, cardId, sales}));
}
