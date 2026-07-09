import {staticConfig} from './staticData';
import type {GameState, IndustryInstance, LinkInstance, LinkLineSpec, LocationSpec} from './types';

export function getCurrentPlayerId(state: GameState): string {
  return state.turnOrder[state.currentTurnIndex];
}

export function getCurrentPlayer(state: GameState) {
  return state.players[getCurrentPlayerId(state)];
}

export function getLocationOrThrow(locationId: string): LocationSpec {
  const location = staticConfig.locations[locationId];
  if (!location) {
    throw new Error(`Unknown location: ${locationId}`);
  }
  return location;
}

export function getLinkLineOrThrow(linkLineId: string): LinkLineSpec {
  const line = staticConfig.linkLines[linkLineId];
  if (!line) {
    throw new Error(`Unknown link line: ${linkLineId}`);
  }
  return line;
}

export function isLocationActiveForPlayerCount(state: GameState, locationId: string): boolean {
  const location = staticConfig.locations[locationId];
  return Boolean(location && (location.kind !== 'merchant' || location.minPlayers <= state.playerCount));
}

export function isLinkLineActiveForPlayerCount(state: GameState, line: LinkLineSpec): boolean {
  return [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId))
    .every((locationId) => isLocationActiveForPlayerCount(state, locationId));
}

function industrySlotMatchesLocation(industry: IndustryInstance): boolean {
  const location = staticConfig.locations[industry.locationId];
  if (location?.kind === 'city') {
    const slot = location.slots.find((candidate) => candidate.id === industry.slotId);
    return Boolean(slot?.allowedIndustryTypes.includes(industry.industryType));
  }
  if (location?.kind === 'farm_brewery') {
    return industry.industryType === 'brewery' && industry.slotId === `${location.id}-brewery`;
  }
  return false;
}

export function isActiveIndustryInstance(state: GameState, industry: IndustryInstance): boolean {
  const spec = staticConfig.industryTileSpecs[industry.specId];
  return Boolean(
    !industry.removedFromGame &&
    spec &&
    spec.industryType === industry.industryType &&
    state.players[industry.ownerPlayerId] &&
    industrySlotMatchesLocation(industry) &&
    state.board.slots[industry.slotId]?.occupiedBy === industry.id,
  );
}

export function getActiveIndustries(state: GameState): IndustryInstance[] {
  return Object.values(state.board.industryInstances).filter((industry) => isActiveIndustryInstance(state, industry));
}

export function getIndustriesAtLocation(state: GameState, locationId: string): IndustryInstance[] {
  return getActiveIndustries(state).filter((industry) => industry.locationId === locationId);
}

export function getPlayerIndustriesAtLocation(state: GameState, playerId: string, locationId: string): IndustryInstance[] {
  return getIndustriesAtLocation(state, locationId).filter((industry) => industry.ownerPlayerId === playerId);
}

export function isActiveLinkInstance(state: GameState, link: LinkInstance): boolean {
  const line = staticConfig.linkLines[link.linkLineId];
  return Boolean(
    line &&
    link.linkType === state.era &&
    state.players[link.ownerPlayerId] &&
    state.board.linkLines[link.linkLineId]?.occupiedBy === link.id &&
    line.allowedLinkTypes.includes(link.linkType) &&
    isLinkLineActiveForPlayerCount(state, line),
  );
}

export function getActiveLinks(state: GameState): LinkInstance[] {
  return Object.values(state.board.linkInstances).filter((link) => isActiveLinkInstance(state, link));
}

export function getBuiltLinksForPlayer(state: GameState, playerId: string): LinkInstance[] {
  return getActiveLinks(state).filter((link) => link.ownerPlayerId === playerId);
}

export function hasAnyPlayerNetwork(state: GameState, playerId: string): boolean {
  return getActiveIndustries(state).some((industry) => industry.ownerPlayerId === playerId) ||
    getBuiltLinksForPlayer(state, playerId).length > 0;
}

export function linkLineTouchesLocation(line: LinkLineSpec, locationId: string): boolean {
  return line.endpointA === locationId || line.endpointB === locationId || line.viaFarmBreweryId === locationId;
}

export function isInPlayerNetwork(state: GameState, playerId: string, locationId: string): boolean {
  if (getPlayerIndustriesAtLocation(state, playerId, locationId).length > 0) {
    return true;
  }

  return getBuiltLinksForPlayer(state, playerId)
    .some((link) => linkLineTouchesLocation(staticConfig.linkLines[link.linkLineId], locationId));
}

export function getNeighborLocations(line: LinkLineSpec, fromLocationId: string): string[] {
  const neighbors: string[] = [];
  if (line.endpointA === fromLocationId) {
    neighbors.push(line.endpointB);
  }
  if (line.endpointB === fromLocationId) {
    neighbors.push(line.endpointA);
  }
  if (line.viaFarmBreweryId === fromLocationId) {
    neighbors.push(line.endpointA, line.endpointB);
  } else if (line.viaFarmBreweryId && (line.endpointA === fromLocationId || line.endpointB === fromLocationId)) {
    neighbors.push(line.viaFarmBreweryId);
  }
  return neighbors;
}

export function connectedComponent(state: GameState, startLocationId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [startLocationId];

  while (queue.length > 0) {
    const locationId = queue.shift();
    if (!locationId || visited.has(locationId)) {
      continue;
    }
    visited.add(locationId);

    for (const link of getActiveLinks(state)) {
      const line = staticConfig.linkLines[link.linkLineId];
      for (const neighbor of getNeighborLocations(line, locationId)) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return visited;
}

export function areConnected(state: GameState, a: string, b: string): boolean {
  return connectedComponent(state, a).has(b);
}

export function hasCoalMarketAccess(state: GameState, locationId: string): boolean {
  const component = connectedComponent(state, locationId);
  return [...component].some((id) => {
    const location = staticConfig.locations[id];
    return location?.kind === 'merchant' &&
      location.minPlayers <= state.playerCount &&
      location.providesCoalMarketConnection;
  });
}
