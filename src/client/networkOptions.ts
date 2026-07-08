import {validateNetwork} from '../common/gameEngine';
import {hasAnyPlayerNetwork, isInPlayerNetwork, linkLineTouchesLocation} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameState, LinkLineSpec, LinkType, ResourceSource} from '../common/types';
import {optionalSource} from './resourceSources';

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
    return line ? linkLineTouchesLocation(line, locationId) : false;
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
  if (player.remainingLinks[linkType] <= index) {
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
    (!mustExtendNetwork || linkExtendsPlayerNetwork(game, playerId, line, pendingLinkLineIds)),
  );
}

export function doubleRailBeerSourceForSubmit(
  game: GameState,
  linkLineIds: string[],
  encodedBeerSource: string,
): ResourceSource | undefined {
  if (game.era !== 'rail' || linkLineIds.length !== 2 || !encodedBeerSource) {
    return undefined;
  }

  return optionalSource(encodedBeerSource);
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
  return validateNetwork(game, {
    type: 'network',
    playerId,
    cardId,
    linkLineIds,
    coalSources,
    beerSourceForDoubleRail,
  }).ok;
}
