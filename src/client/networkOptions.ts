import {legalBeerSourcesForNetwork, validateNetwork} from '../common/gameEngine';
import {hasAnyPlayerNetwork, isInPlayerNetwork, isLinkLineActiveForPlayerCount, linkLineTouchesLocation} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameState, LinkLineSpec, LinkType, ResourceSource} from '../common/types';
import {optionalSource} from './resourceSources';
import {validationOk} from './validation';

function linkTypeForEra(game: GameState): LinkType {
  return game.era === 'canal' ? 'canal' : 'rail';
}

function isInPlayerNetworkWithPendingLinks(
  game: GameState,
  playerId: string,
  locationId: string,
  pendingLinkLineIds: string[],
): boolean {
  if (isInPlayerNetwork(game, playerId, locationId)) {
    return true;
  }
  return pendingLinkLineIds.some((linkLineId) => {
    const line = staticConfig.linkLines[linkLineId];
    return line && isLinkLineActiveForPlayerCount(game, line) ? linkLineTouchesLocation(line, locationId) : false;
  });
}

function linkExtendsPlayerNetwork(
  game: GameState,
  playerId: string,
  line: LinkLineSpec,
  pendingLinkLineIds: string[],
): boolean {
  return [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId))
    .some((locationId) => isInPlayerNetworkWithPendingLinks(game, playerId, locationId, pendingLinkLineIds));
}

function sourceKey(source: ResourceSource): string {
  if (source.kind === 'industry_tile') {
    return `industry:${source.industryInstanceId}:${source.resourceType}`;
  }
  if (source.kind === 'merchant_beer') {
    return `merchant:${source.merchantSpaceId}:${source.merchantTileInstanceId}`;
  }
  return `market:${source.market}:${source.price}`;
}

function remainingLinksForType(game: GameState, playerId: string, linkType: LinkType): number {
  const count = game.players[playerId]?.remainingLinks?.[linkType];
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function networkLinkOptionsForSelect(
  game: GameState,
  playerId: string,
  selectedLinkLineIds: Array<string | undefined>,
  index: number,
): LinkLineSpec[] {
  const player = game.players[playerId];
  if (!player || index < 0 || index >= 2 || (game.era === 'canal' && index > 0)) {
    return [];
  }

  const linkType = linkTypeForEra(game);
  if (remainingLinksForType(game, playerId, linkType) <= index) {
    return [];
  }

  const pendingLinkLineIds = selectedLinkLineIds
    .slice(0, index)
    .filter((linkLineId): linkLineId is string => Boolean(linkLineId));
  if (pendingLinkLineIds.length < index) {
    return [];
  }
  if (new Set(pendingLinkLineIds).size !== pendingLinkLineIds.length) {
    return [];
  }

  const alreadySelected = new Set(pendingLinkLineIds);
  const mustExtendNetwork = hasAnyPlayerNetwork(game, playerId) || pendingLinkLineIds.length > 0;

  return Object.values(staticConfig.linkLines).filter((line) =>
    !alreadySelected.has(line.id) &&
    !game.board.linkLines[line.id]?.occupiedBy &&
    line.allowedLinkTypes.includes(linkType) &&
    isLinkLineActiveForPlayerCount(game, line) &&
    (!mustExtendNetwork || linkExtendsPlayerNetwork(game, playerId, line, pendingLinkLineIds)),
  );
}

export function doubleRailBeerSourceForSubmit(
  game: GameState,
  playerId: string,
  linkLineIds: string[],
  encodedBeerSource: string,
): ResourceSource | undefined {
  if (game.era !== 'rail' || linkLineIds.length !== 2 || !encodedBeerSource) {
    return undefined;
  }

  const selectedSource = optionalSource(encodedBeerSource);
  if (!selectedSource) {
    return undefined;
  }

  const selectedKey = sourceKey(selectedSource);
  return legalBeerSourcesForNetwork(game, playerId, linkLineIds)
    .some((source) => sourceKey(source) === selectedKey)
    ? selectedSource
    : undefined;
}

export function canSubmitNetwork(
  game: GameState,
  playerId: string,
  cardId: string,
  linkLineIds: string[],
  coalSources?: ResourceSource[],
  beerSourceForDoubleRail?: ResourceSource,
): boolean {
  if (linkLineIds.length === 0) {
    return false;
  }
  return validationOk(() => validateNetwork(game, {
    type: 'network',
    playerId,
    cardId,
    linkLineIds,
    coalSources,
    beerSourceForDoubleRail,
  }));
}
