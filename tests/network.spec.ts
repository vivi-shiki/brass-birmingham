import {describe, expect, it} from 'vitest';
import {applyCommand, validateNetwork} from '../src/common/gameEngine';
import {areLocationsConnected, getConnectedLocationsForDebug} from '../src/common/gameEngine';
import {hasAnyPlayerNetwork, isInPlayerNetwork} from '../src/common/selectors';
import {addIndustry, addLink, firstHandCard, setHand, testGame} from './helpers';

function prepareRailDoubleNetwork() {
  const state = testGame();
  state.era = 'rail';
  state.actionsAllowedThisTurn = 2;
  setHand(state, 'p1', ['p2-location-cannock-1']);
  addIndustry(state, {
    id: 'coal-1',
    ownerPlayerId: 'p1',
    industryType: 'coal_mine',
    specId: 'coal_mine-2-1',
    locationId: 'cannock',
    slotId: 'cannock-1',
    remainingResource: 2,
  });
  return state;
}

describe('network connectivity', () => {
  it('allows a first network link anywhere and adds both endpoints to the player network', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    applyCommand(state, {type: 'network', playerId: 'p1', cardId, linkLineIds: ['birmingham-walsall']});

    expect(isInPlayerNetwork(state, 'p1', 'birmingham')).toBe(true);
    expect(isInPlayerNetwork(state, 'p1', 'walsall')).toBe(true);
    expect(isInPlayerNetwork(state, 'p2', 'birmingham')).toBe(false);
    expect(areLocationsConnected(state, 'birmingham', 'walsall')).toBe(true);
  });

  it('enforces canal and rail link count limits', () => {
    const empty = testGame();
    const emptyResult = validateNetwork(empty, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(empty, 'p1'),
      linkLineIds: [],
    });

    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.errors.join(' ')).toContain('at least one link');

    const canal = testGame();
    const canalResult = validateNetwork(canal, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(canal, 'p1'),
      linkLineIds: ['birmingham-walsall', 'walsall-wolverhampton'],
    });

    expect(canalResult.ok).toBe(false);
    expect(canalResult.errors.join(' ')).toContain('exactly one canal');

    const rail = testGame();
    rail.era = 'rail';
    rail.actionsAllowedThisTurn = 2;
    const railResult = validateNetwork(rail, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(rail, 'p1'),
      linkLineIds: ['birmingham-walsall', 'walsall-wolverhampton', 'coalbrookdale-wolverhampton'],
    });

    expect(railResult.ok).toBe(false);
    expect(railResult.errors.join(' ')).toContain('at most two rails');
  });

  it('rejects link lines that do not support the current era link type', () => {
    const canal = testGame();
    const canalResult = validateNetwork(canal, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(canal, 'p1'),
      linkLineIds: ['birmingham-nuneaton'],
    });

    expect(canalResult.ok).toBe(false);
    expect(canalResult.errors.join(' ')).toContain('does not support canal');

    const rail = testGame();
    rail.era = 'rail';
    rail.actionsAllowedThisTurn = 2;
    const railResult = validateNetwork(rail, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(rail, 'p1'),
      linkLineIds: ['burtonOnTrent-walsall'],
    });

    expect(railResult.ok).toBe(false);
    expect(railResult.errors.join(' ')).toContain('does not support rail');
  });

  it('rejects network actions when the player has no links of the current type remaining', () => {
    const state = testGame();
    state.players.p1.remainingLinks.canal = 0;

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(state, 'p1'),
      linkLineIds: ['birmingham-walsall'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('fewer than 1 canal links remaining');
  });

  it('rejects duplicate link selections and canal coal sources', () => {
    const duplicateRail = testGame();
    duplicateRail.era = 'rail';
    duplicateRail.actionsAllowedThisTurn = 2;
    const duplicateResult = validateNetwork(duplicateRail, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(duplicateRail, 'p1'),
      linkLineIds: ['cannock-stafford', 'cannock-stafford'],
    });

    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.errors.join(' ')).toContain('same link line twice');

    const canal = testGame();
    const canalResult = validateNetwork(canal, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(canal, 'p1'),
      linkLineIds: ['birmingham-walsall'],
      coalSources: [{kind: 'market', market: 'coal', price: 1}],
    });

    expect(canalResult.ok).toBe(false);
    expect(canalResult.errors.join(' ')).toContain('does not consume coal');
  });

  it('rejects double rail beer sources outside a two-rail Network action', () => {
    const canal = testGame();
    const canalResult = validateNetwork(canal, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(canal, 'p1'),
      linkLineIds: ['birmingham-walsall'],
      beerSourceForDoubleRail: {kind: 'industry_tile', industryInstanceId: 'brewery-1', resourceType: 'beer'},
    });

    expect(canalResult.ok).toBe(false);
    expect(canalResult.errors.join(' ')).toContain('only valid when building two rails');

    const rail = testGame();
    rail.era = 'rail';
    rail.actionsAllowedThisTurn = 2;
    const railResult = validateNetwork(rail, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(rail, 'p1'),
      linkLineIds: ['birmingham-oxford'],
      beerSourceForDoubleRail: {kind: 'industry_tile', industryInstanceId: 'brewery-1', resourceType: 'beer'},
    });

    expect(railResult.ok).toBe(false);
    expect(railResult.errors.join(' ')).toContain('only valid when building two rails');
  });

  it('uses all built links when calculating connected components', () => {
    const state = testGame();
    applyCommand(state, {type: 'network', playerId: 'p1', cardId: firstHandCard(state, 'p1'), linkLineIds: ['birmingham-walsall']});
    applyCommand(state, {type: 'network', playerId: 'p2', cardId: firstHandCard(state, 'p2'), linkLineIds: ['walsall-wolverhampton']});

    expect(getConnectedLocationsForDebug(state, 'birmingham')).toEqual(['birmingham', 'walsall', 'wolverhampton']);
  });

  it('ignores stale link instances when calculating player networks', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    state.board.linkInstances['stale-link'] = {
      id: 'stale-link',
      ownerPlayerId: 'p1',
      linkType: 'canal',
      linkLineId: 'birmingham-walsall',
    };
    state.board.linkLines['birmingham-walsall'] = {};

    expect(isInPlayerNetwork(state, 'p1', 'walsall')).toBe(false);
    expect(areLocationsConnected(state, 'birmingham', 'walsall')).toBe(false);

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(state, 'p1'),
      linkLineIds: ['walsall-wolverhampton'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('extend from the player network');
  });

  it('ignores industry instances that do not occupy their board slot when calculating player networks', () => {
    const state = testGame();
    const orphanIndustry = addIndustry(state, {
      id: 'orphan-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    state.board.slots[orphanIndustry.slotId] = {};

    expect(hasAnyPlayerNetwork(state, 'p1')).toBe(false);
    expect(isInPlayerNetwork(state, 'p1', 'birmingham')).toBe(false);
  });

  it('rejects building on an occupied link line without mutating the board', () => {
    const state = testGame();
    addLink(state, 'link-1', 'p2', 'birmingham-walsall');
    const cardId = firstHandCard(state, 'p1');
    const linkCount = Object.keys(state.board.linkInstances).length;

    expect(() => applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
    })).toThrow('already occupied');

    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toBe('link-1');
    expect(Object.keys(state.board.linkInstances)).toHaveLength(linkCount);
    expect(state.players.p1.handCardIds).toContain(cardId);
  });

  it('rejects Network when a link line points at a stale occupation', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    state.board.linkLines['birmingham-walsall'] = {occupiedBy: 'missing-link'};

    const validation = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('Selected link occupation is stale');
  });

  it('snapshots Network command payloads before validation and execution', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    let linkLineReads = 0;
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId,
      get linkLineIds() {
        linkLineReads++;
        return linkLineReads <= 6
          ? ['birmingham-walsall']
          : ['birmingham-walsall', 'missing-link-line'];
      },
    } as unknown as {type: 'network'; playerId: string; cardId: string; linkLineIds: string[]};

    applyCommand(state, command);

    expect(linkLineReads).toBe(1);
    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.handCardIds).not.toContain(cardId);
    expect(state.players.p1.remainingLinks.canal).toBe(13);
    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toEqual(expect.any(String));
    expect(state.board.linkLines['missing-link-line']).toBeUndefined();
    expect(Object.keys(state.board.linkInstances)).toHaveLength(1);
  });

  it('rejects a network link that does not extend an existing player network', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: firstHandCard(state, 'p1'),
      linkLineIds: ['cannock-stafford'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('extend from the player network');
  });

  it('treats a built via-farm link as touching the farm brewery and both endpoints', () => {
    const state = testGame();
    applyCommand(state, {type: 'network', playerId: 'p1', cardId: firstHandCard(state, 'p1'), linkLineIds: ['kidderminster-worcester']});

    expect(getConnectedLocationsForDebug(state, 'kidderminster')).toEqual(['kidderminster', 'southern', 'worcester']);
    expect(isInPlayerNetwork(state, 'p1', 'kidderminster')).toBe(true);
    expect(isInPlayerNetwork(state, 'p1', 'worcester')).toBe(true);
    expect(isInPlayerNetwork(state, 'p1', 'southern')).toBe(true);
  });

  it('allows a via-farm link to extend from a player brewery on that farm', () => {
    const state = testGame();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'southern',
      slotId: 'southern-brewery',
      remainingResource: 1,
    });
    const cardId = firstHandCard(state, 'p1');

    const validation = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['kidderminster-worcester'],
    });

    expect(validation.ok).toBe(true);

    applyCommand(state, {type: 'network', playerId: 'p1', cardId, linkLineIds: ['kidderminster-worcester']});

    expect(state.board.industryInstances[brewery.id].removedFromGame).toBe(false);
    expect(state.board.linkLines['kidderminster-worcester'].occupiedBy).toEqual(expect.any(String));
    expect(isInPlayerNetwork(state, 'p1', 'kidderminster')).toBe(true);
    expect(isInPlayerNetwork(state, 'p1', 'worcester')).toBe(true);
  });

  it('allows the second rail to extend the first rail and consumes connected beer', () => {
    const state = prepareRailDoubleNetwork();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
    });

    expect(state.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
    expect(state.board.linkLines['stafford-stone'].occupiedBy).toBeDefined();
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog.some((event) =>
      event.type === 'resource_consumed' &&
      event.reason === 'network' &&
      event.source.kind === 'industry_tile' &&
      event.source.resourceType === 'beer',
    )).toBe(true);
  });

  it('automatically uses own brewery beer before connected opponent beer for double rail', () => {
    const state = prepareRailDoubleNetwork();
    const ownBrewery = addIndustry(state, {
      id: 'own-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const opponentBrewery = addIndustry(state, {
      id: 'opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
    });

    expect(state.board.industryInstances[ownBrewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[ownBrewery.id].flipped).toBe(true);
    expect(state.board.industryInstances[opponentBrewery.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[opponentBrewery.id].flipped).toBe(false);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: ownBrewery.id, resourceType: 'beer'},
      byPlayerId: 'p1',
      reason: 'network',
    });
  });

  it('uses an explicit brewery beer source for a double rail Network', () => {
    const state = prepareRailDoubleNetwork();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      beerSourceForDoubleRail: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
    });

    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
      byPlayerId: 'p1',
      reason: 'network',
    });
  });

  it('snapshots an explicit double rail beer source before execution', () => {
    const state = prepareRailDoubleNetwork();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p1',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'walsall',
      slotId: 'walsall-1',
      remainingResource: 1,
    });
    let beerSourceReads = 0;
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      get beerSourceForDoubleRail() {
        beerSourceReads++;
        return beerSourceReads <= 1
          ? {kind: 'industry_tile' as const, industryInstanceId: brewery.id, resourceType: 'beer' as const}
          : {kind: 'industry_tile' as const, industryInstanceId: iron.id, resourceType: 'beer' as const};
      },
    };

    applyCommand(state, command);

    expect(beerSourceReads).toBe(1);
    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.board.industryInstances[iron.id].remainingResource).toBe(1);
    expect(state.board.linkLines['cannock-stafford'].occupiedBy).toEqual(expect.any(String));
    expect(state.board.linkLines['stafford-stone'].occupiedBy).toEqual(expect.any(String));
  });

  it('snapshots an explicit connected double rail beer source before execution', () => {
    const state = prepareRailDoubleNetwork();
    const connectedBrewery = addIndustry(state, {
      id: 'brewery-connected',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });
    const disconnectedBrewery = addIndustry(state, {
      id: 'brewery-disconnected',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      remainingResource: 1,
    });
    let beerSourceReads = 0;
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      get beerSourceForDoubleRail() {
        beerSourceReads++;
        return beerSourceReads <= 1
          ? {kind: 'industry_tile' as const, industryInstanceId: connectedBrewery.id, resourceType: 'beer' as const}
          : {kind: 'industry_tile' as const, industryInstanceId: disconnectedBrewery.id, resourceType: 'beer' as const};
      },
    };

    applyCommand(state, command);

    expect(beerSourceReads).toBe(1);
    expect(state.board.industryInstances[connectedBrewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[connectedBrewery.id].flipped).toBe(true);
    expect(state.board.industryInstances[disconnectedBrewery.id].remainingResource).toBe(1);
    expect(state.board.linkLines['cannock-stafford'].occupiedBy).toEqual(expect.any(String));
    expect(state.board.linkLines['stafford-stone'].occupiedBy).toEqual(expect.any(String));
  });

  it('rejects non-brewery resource sources for double rail beer', () => {
    const state = prepareRailDoubleNetwork();

    const marketBeer = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      beerSourceForDoubleRail: {kind: 'market', market: 'iron', price: 2},
    });

    expect(marketBeer.ok).toBe(false);
    expect(marketBeer.errors.join(' ')).toContain('must come from a brewery');

    const merchantBeer = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      beerSourceForDoubleRail: {
        kind: 'merchant_beer',
        merchantSpaceId: 'oxford-0',
        merchantTileInstanceId: 'oxford-cotton-0',
      },
    });

    expect(merchantBeer.ok).toBe(false);
    expect(merchantBeer.errors.join(' ')).toContain('must come from a brewery');
  });

  it('rejects an explicit double rail beer source that is not connected to the second rail', () => {
    const state = prepareRailDoubleNetwork();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      remainingResource: 1,
    });

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      beerSourceForDoubleRail: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Selected double rail beer source is not available');
  });

  it('rejects opponent brewery beer connected only to the first rail of a double rail action', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    addIndustry(state, {
      id: 'coal-2',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 1,
    });
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-0',
      remainingResource: 1,
    });

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'birmingham-dudley'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('requires beer');
  });

  it('rejects a double rail Network when no brewery beer is available', () => {
    const state = prepareRailDoubleNetwork();

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('requires beer');
  });
});
