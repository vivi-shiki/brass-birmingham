import {createGame} from '../src/common/gameSetup';
import type {GameState, IndustryInstance, IndustryType, LinkType} from '../src/common/types';

export function testGame(seed = 1): GameState {
  return createGame({id: 'test-game', playerNames: ['Ada', 'Ben'], seed, initialTurnOrder: ['p1', 'p2']});
}

export function setHand(state: GameState, playerId: string, cardIds: string[]): void {
  state.players[playerId].handCardIds = [...cardIds];
}

export function firstHandCard(state: GameState, playerId: string): string {
  const card = state.players[playerId].handCardIds[0];
  if (!card) {
    throw new Error(`Player ${playerId} has no cards`);
  }
  return card;
}

export function addIndustry(state: GameState, partial: {
  id: string;
  ownerPlayerId: string;
  industryType: IndustryType;
  specId: string;
  locationId: string;
  slotId: string;
  remainingResource?: number;
  flipped?: boolean;
}): IndustryInstance {
  const instance: IndustryInstance = {
    id: partial.id,
    ownerPlayerId: partial.ownerPlayerId,
    industryType: partial.industryType,
    specId: partial.specId,
    level: Number(partial.specId.split('-')[1] ?? 1),
    locationId: partial.locationId,
    slotId: partial.slotId,
    remainingResource: partial.remainingResource ?? 0,
    flipped: partial.flipped ?? false,
    removedFromGame: false,
  };
  state.board.industryInstances[instance.id] = instance;
  state.board.slots[instance.slotId] = {occupiedBy: instance.id};
  return instance;
}

export function addLink(state: GameState, id: string, ownerPlayerId: string, linkLineId: string, linkType: LinkType = 'canal'): void {
  state.board.linkInstances[id] = {id, ownerPlayerId, linkLineId, linkType};
  state.board.linkLines[linkLineId] = {occupiedBy: id};
}

export function setMerchantSpace(state: GameState, merchantSpaceId: string, merchantTileInstanceId: string, beerPresent: boolean): void {
  state.board.merchantSpaces[merchantSpaceId] = {
    id: merchantSpaceId,
    merchantTileInstanceId,
    beerPresent,
  };
}
