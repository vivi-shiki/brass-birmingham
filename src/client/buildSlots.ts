import {validateBuild} from '../common/gameEngine';
import {getActiveIndustries, hasAnyPlayerNetwork, isActiveIndustryInstance, isInPlayerNetwork} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {CitySlotSpec, GameState, IndustryType, LocationSpec, ResourceSource} from '../common/types';
import {validationOk} from './validation';

const buildIndustryTypes: IndustryType[] = ['cotton_mill', 'coal_mine', 'iron_works', 'manufacturer', 'pottery', 'brewery'];

function isMarketExplicitlyEmpty(game: GameState, marketName: 'coal' | 'iron'): boolean {
  const market = (game as unknown as {
    markets?: Partial<Record<'coal' | 'iron', {occupiedCount?: unknown} | null>>;
  }).markets?.[marketName];
  return market?.occupiedCount === 0;
}

function isResourceGloballyDepleted(game: GameState, industryType: IndustryType): boolean {
  if (industryType === 'coal_mine' && !isMarketExplicitlyEmpty(game, 'coal')) {
    return false;
  }
  if (industryType === 'iron_works' && !isMarketExplicitlyEmpty(game, 'iron')) {
    return false;
  }
  if (industryType !== 'coal_mine' && industryType !== 'iron_works') {
    return false;
  }

  return !getActiveIndustries(game).some((industry) =>
    !industry.flipped &&
    industry.industryType === industryType &&
    industry.remainingResource > 0,
  );
}

function canUseBuildSlotForPlayer(
  game: GameState,
  playerId: string | undefined,
  slot: CitySlotSpec,
  locationId: string,
  industryType: IndustryType,
): boolean {
  if (!playerId) {
    return true;
  }

  const player = game.players[playerId];
  const specId = player?.industryTileStacks[industryType]?.availableSpecIdsInOrder[0];
  const spec = specId ? staticConfig.industryTileSpecs[specId] : undefined;
  if (!player || !spec || !spec.buildableEras.includes(game.era)) {
    return false;
  }

  if (game.era === 'canal') {
    const ownElsewhereAtLocation = getActiveIndustries(game).some((industry) =>
      industry.ownerPlayerId === playerId &&
      industry.locationId === locationId &&
      industry.slotId !== slot.id,
    );
    if (ownElsewhereAtLocation) {
      return false;
    }
  }

  const occupiedBy = game.board.slots[slot.id]?.occupiedBy;
  if (!occupiedBy) {
    return true;
  }

  const existing = game.board.industryInstances[occupiedBy];
  if (!existing || existing.slotId !== slot.id || !isActiveIndustryInstance(game, existing)) {
    return false;
  }

  if (existing.ownerPlayerId === playerId) {
    return existing.industryType === industryType && existing.level < spec.level;
  }

  return (
    (existing.industryType === 'coal_mine' || existing.industryType === 'iron_works') &&
    existing.industryType === industryType &&
    existing.level < spec.level &&
    isResourceGloballyDepleted(game, existing.industryType)
  );
}

function buildCardAllowsLocation(game: GameState, playerId: string, cardId: string, locationId: string): boolean {
  const card = staticConfig.cardSpecs[cardId];
  const location = staticConfig.locations[locationId];
  if (!card || !location || location.kind === 'merchant') {
    return false;
  }

  if (card.type === 'location') {
    return card.locationId === locationId;
  }
  if (card.type === 'wild_location') {
    return location.kind === 'city';
  }
  if (card.type === 'industry' || card.type === 'wild_industry') {
    return !hasAnyPlayerNetwork(game, playerId) || isInPlayerNetwork(game, playerId, locationId);
  }
  return false;
}

export function buildIndustryOptionsForLocationAndCard(
  game: GameState,
  playerId: string,
  cardId: string,
  locationId: string,
): IndustryType[] {
  const card = staticConfig.cardSpecs[cardId];
  if (!buildCardAllowsLocation(game, playerId, cardId, locationId)) {
    return [];
  }

  const industryOptions = buildIndustryOptionsForLocation(game, playerId, locationId);
  if (card?.type === 'industry') {
    return industryOptions.filter((industryType) => industryType === card.industryType);
  }
  return industryOptions;
}

export function buildLocationOptionsForCard(game: GameState, playerId: string, cardId: string): LocationSpec[] {
  return Object.values(staticConfig.locations).filter((location) =>
    location.kind !== 'merchant' &&
    buildCardAllowsLocation(game, playerId, cardId, location.id) &&
    buildIndustryOptionsForLocationAndCard(game, playerId, cardId, location.id).length > 0,
  );
}

export function buildIndustryOptionsForLocation(
  game: GameState,
  playerId: string,
  locationId: string,
): IndustryType[] {
  const player = game.players[playerId];
  if (!player) {
    return [];
  }

  return buildIndustryTypes.filter((industryType) => {
    const specId = player.industryTileStacks[industryType]?.availableSpecIdsInOrder[0];
    const spec = specId ? staticConfig.industryTileSpecs[specId] : undefined;
    return Boolean(
      spec &&
      spec.buildableEras.includes(game.era) &&
      buildSlotOptionsForIndustry(game, locationId, industryType, playerId).length > 0,
    );
  });
}

export function buildSlotOptionsForIndustry(
  game: GameState,
  locationId: string,
  industryType: IndustryType,
  playerId?: string,
): CitySlotSpec[] {
  const location = staticConfig.locations[locationId];
  if (location?.kind === 'farm_brewery') {
    const slot = {id: `${location.id}-brewery`, cityId: location.id, allowedIndustryTypes: ['brewery' as const]};
    return industryType === 'brewery' && canUseBuildSlotForPlayer(game, playerId, slot, location.id, industryType)
      ? [slot]
      : [];
  }
  if (location?.kind !== 'city') {
    return [];
  }

  const allowedSlots = location.slots
    .filter((slot) => slot.allowedIndustryTypes.includes(industryType))
    .filter((slot) => canUseBuildSlotForPlayer(game, playerId, slot, locationId, industryType));
  const pureSlots = allowedSlots.filter((slot) =>
    slot.allowedIndustryTypes.length === 1 &&
    slot.allowedIndustryTypes[0] === industryType,
  );
  const unoccupiedPureSlots = pureSlots.filter((slot) => !game.board.slots[slot.id]?.occupiedBy);
  return unoccupiedPureSlots.length > 0 ? unoccupiedPureSlots : allowedSlots;
}

export function canSubmitBuild(
  game: GameState,
  playerId: string,
  cardId: string,
  locationId: string,
  slotId: string,
  industryType: IndustryType | '' | undefined,
  coalSources?: ResourceSource[],
  ironSources?: ResourceSource[],
): boolean {
  if (!locationId || !slotId || !industryType) {
    return false;
  }
  return validationOk(() => validateBuild(game, {
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
