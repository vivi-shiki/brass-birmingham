import {describe, expect, it} from 'vitest';
import {
  applyCommand,
  executeBuild,
  executeDevelop,
  executeNetwork,
  legalCoalSourcesForNetworkSelect,
  legalResourceSourcesForSelect,
  validateBuild,
  validateDevelop,
  validateNetwork,
} from '../src/common/gameEngine';
import {staticConfig} from '../src/common/staticData';
import type {BuildCommand, DevelopCommand, ResourceSource} from '../src/common/types';
import {addIndustry, addLink, setHand, testGame} from './helpers';

describe('manual resource source selection', () => {
  it('build consumes the selected iron works instead of the first automatic source', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    const firstIron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const selectedIron = addIndustry(state, {
      id: 'iron-2',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery',
      ironSources: [{kind: 'industry_tile', industryInstanceId: selectedIron.id, resourceType: 'iron'}],
    });

    expect(state.board.industryInstances[firstIron.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[selectedIron.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[selectedIron.id].flipped).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: selectedIron.id, resourceType: 'iron'},
      byPlayerId: 'p1',
      reason: 'build',
    });
  });

  it('snapshots resource source objects before direct execution consumes them', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const firstIron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const selectedIron = addIndustry(state, {
      id: 'iron-2',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    let sourceIdReads = 0;
    const source = {
      kind: 'industry_tile' as const,
      get industryInstanceId() {
        sourceIdReads++;
        return sourceIdReads <= 4 ? selectedIron.id : firstIron.id;
      },
      resourceType: 'iron' as const,
    } as ResourceSource;

    executeDevelop(state, {
      type: 'develop',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      industryTypes: ['coal_mine'],
      ironSources: [source],
    });

    expect(state.board.industryInstances[selectedIron.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[firstIron.id].remainingResource).toBe(1);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: selectedIron.id, resourceType: 'iron'},
      byPlayerId: 'p1',
      reason: 'develop',
    });
  });

  it('rejects extra Build resource sources before mutating the game', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventCountBefore = state.eventLog.length;
    const cashBefore = state.players.p1.cash;

    expect(() => applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery',
      ironSources: [
        {kind: 'industry_tile', industryInstanceId: iron.id, resourceType: 'iron'},
        {kind: 'market', market: 'iron', price: 2},
      ],
    })).toThrow('iron source count does not match the requirement');

    expect(state.players.p1.cash).toBe(cashBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.board.slots['stone-0'].occupiedBy).toBeUndefined();
    expect(state.board.industryInstances[iron.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[iron.id].flipped).toBe(false);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('rejects missing explicit Build resource sources before mutating the game', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventCountBefore = state.eventLog.length;
    const cashBefore = state.players.p1.cash;
    const command = {
      type: 'build' as const,
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery' as const,
      ironSources: [undefined] as unknown as ResourceSource[],
    };

    const result = validateBuild(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected iron source is missing');
    expect(() => applyCommand(state, command)).toThrow('Selected iron source is missing');

    expect(state.players.p1.cash).toBe(cashBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.board.slots['stone-0'].occupiedBy).toBeUndefined();
    expect(state.board.industryInstances[iron.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[iron.id].flipped).toBe(false);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('does not remove a Build tile before resource sources are rechecked during execution', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const stackBefore = structuredClone(state.players.p1.industryTileStacks.brewery);
    const handBefore = [...state.players.p1.handCardIds];
    const eventLogBefore = structuredClone(state.eventLog);
    let ironSourceReads = 0;
    const command = {
      type: 'build' as const,
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery' as const,
      get ironSources() {
        ironSourceReads++;
        return ironSourceReads === 1
          ? [{kind: 'industry_tile' as const, industryInstanceId: iron.id, resourceType: 'iron' as const}]
          : [{kind: 'industry_tile' as const, industryInstanceId: 'missing-iron', resourceType: 'iron' as const}];
      },
    } as BuildCommand;

    expect(() => executeBuild(state, command)).toThrow('Selected iron source is not available');

    expect(ironSourceReads).toBe(2);
    expect(state.players.p1.industryTileStacks.brewery).toEqual(stackBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.slots['stone-0'].occupiedBy).toBeUndefined();
    expect(state.board.industryInstances[iron.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[iron.id].flipped).toBe(false);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('rejects malformed explicit Build resource sources before availability checks', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const eventCountBefore = state.eventLog.length;
    const command = {
      type: 'build' as const,
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery' as const,
      ironSources: [{kind: 'industry_tile', industryInstanceId: 'iron-1'}] as unknown as ResourceSource[],
    };

    const result = validateBuild(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected iron source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected iron source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.slots['stone-0'].occupiedBy).toBeUndefined();
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('rejects blank explicit Build resource source ids before availability checks', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const eventCountBefore = state.eventLog.length;
    const command = {
      type: 'build' as const,
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'stone',
      slotId: 'stone-0',
      industryType: 'brewery' as const,
      ironSources: [{kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'iron'}] as unknown as ResourceSource[],
    };

    const result = validateBuild(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected iron source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected iron source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.slots['stone-0'].occupiedBy).toBeUndefined();
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('rejects malformed explicit Develop market sources before availability checks', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    state.markets.iron.occupiedCount = 5;
    const handBefore = [...state.players.p1.handCardIds];
    const command = {
      type: 'develop' as const,
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine' as const],
      ironSources: [{kind: 'market', market: 'iron'}] as unknown as ResourceSource[],
    };

    const result = validateDevelop(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected iron source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected iron source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual([]);
    expect(state.markets.iron.occupiedCount).toBe(5);
  });

  it('rejects blank explicit Develop resource source ids before availability checks', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    const handBefore = [...state.players.p1.handCardIds];
    const command = {
      type: 'develop' as const,
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine' as const],
      ironSources: [{kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'iron'}] as unknown as ResourceSource[],
    };

    const result = validateDevelop(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected iron source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected iron source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual([]);
  });

  it('does not consume Develop iron before industry types are rechecked during execution', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    state.markets.iron.occupiedCount = 7;
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const coalStackBefore = structuredClone(state.players.p1.industryTileStacks.coal_mine);
    const potteryStackBefore = structuredClone(state.players.p1.industryTileStacks.pottery);
    const eventLogBefore = structuredClone(state.eventLog);
    const cashBefore = state.players.p1.cash;
    let industryTypeReads = 0;
    const command = {
      type: 'develop' as const,
      playerId: 'p1',
      cardId,
      get industryTypes() {
        industryTypeReads++;
        return industryTypeReads === 1
          ? ['coal_mine' as const]
          : ['pottery' as const];
      },
      ironSources: [{kind: 'market' as const, market: 'iron' as const, price: 2}],
    } as DevelopCommand;

    expect(() => executeDevelop(state, command)).toThrow('pottery level 1 cannot be developed');

    expect(industryTypeReads).toBe(2);
    expect(state.markets.iron.occupiedCount).toBe(7);
    expect(state.players.p1.cash).toBe(cashBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.players.p1.industryTileStacks.coal_mine).toEqual(coalStackBefore);
    expect(state.players.p1.industryTileStacks.pottery).toEqual(potteryStackBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('rejects invalid explicit Develop market prices before availability checks', () => {
    const invalidSources = [
      {kind: 'market', market: 'iron', price: -1},
      {kind: 'market', market: 'iron', price: 1.5},
      {kind: 'market', market: 'iron', price: 99},
    ];

    for (const source of invalidSources) {
      const state = testGame();
      const cardId = state.players.p1.handCardIds[0];
      state.markets.iron.occupiedCount = 5;
      const handBefore = [...state.players.p1.handCardIds];
      const command = {
        type: 'develop' as const,
        playerId: 'p1',
        cardId,
        industryTypes: ['coal_mine' as const],
        ironSources: [source] as unknown as ResourceSource[],
      };

      const result = validateDevelop(state, command);
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('Selected iron source is malformed');
      expect(() => applyCommand(state, command)).toThrow('Selected iron source is malformed');

      expect(state.players.p1.handCardIds).toEqual(handBefore);
      expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual([]);
      expect(state.markets.iron.occupiedCount).toBe(5);
    }
  });

  it('rejects selected market iron while any iron works is available', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });

    const result = validateDevelop(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine'],
      ironSources: [{kind: 'market', market: 'iron', price: 2}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('not available');
  });

  it('build consumes the selected nearest coal mine', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-industry-1']);
    const coal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'coventry',
      slotId: 'coventry-1',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-industry-1',
      locationId: 'coventry',
      slotId: 'coventry-2',
      industryType: 'iron_works',
      coalSources: [{kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'}],
    });

    expect(state.board.industryInstances[coal.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[coal.id].flipped).toBe(true);
  });

  it('ignores removed coal mines when validating selected Build coal', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const removedCoal = addIndustry(state, {
      id: 'removed-coal',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    state.board.industryInstances[removedCoal.id].removedFromGame = true;
    addLink(state, 'link-removed-coal', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'link-market', 'p2', 'birmingham-oxford', 'rail');

    expect(validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
    }).ok).toBe(true);

    const result = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
      coalSources: [{kind: 'industry_tile', industryInstanceId: removedCoal.id, resourceType: 'coal'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is not available');
    expect(state.board.industryInstances[removedCoal.id].remainingResource).toBe(1);
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('ignores stale link instances when finding connected coal for Build', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const coal = addIndustry(state, {
      id: 'stale-route-coal',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    state.board.linkInstances['stale-link'] = {
      id: 'stale-link',
      ownerPlayerId: 'p2',
      linkType: 'rail',
      linkLineId: 'birmingham-tamworth',
    };
    state.board.linkLines['birmingham-tamworth'] = {};

    const result = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('No coal source available');
    expect(state.board.industryInstances[coal.id].remainingResource).toBe(1);
  });

  it('ignores coal mines that do not occupy their board slot when finding connected coal for Build', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const coal = addIndustry(state, {
      id: 'orphan-coal',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    state.board.slots[coal.slotId] = {};
    addLink(state, 'link-to-orphan-coal', 'p2', 'birmingham-tamworth', 'rail');

    const result = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('No coal source available');
    expect(state.board.industryInstances[coal.id].remainingResource).toBe(1);
  });

  it('rejects a farther connected coal source while a nearer coal mine can satisfy Build', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    addIndustry(state, {
      id: 'coal-near',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    const farCoal = addIndustry(state, {
      id: 'coal-far',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    addLink(state, 'link-near', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'link-far-1', 'p2', 'birmingham-walsall', 'rail');
    addLink(state, 'link-far-2', 'p2', 'cannock-walsall', 'rail');

    const result = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
      coalSources: [{kind: 'industry_tile', industryInstanceId: farCoal.id, resourceType: 'coal'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is not available');
    expect(state.board.industryInstances['coal-near'].remainingResource).toBe(1);
    expect(state.board.industryInstances[farCoal.id].remainingResource).toBe(1);
  });

  it('automatically consumes the nearest connected coal mine before farther coal or market coal', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const nearCoal = addIndustry(state, {
      id: 'coal-near',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    const farCoal = addIndustry(state, {
      id: 'coal-far',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    addLink(state, 'link-near', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'link-far-1', 'p2', 'birmingham-walsall', 'rail');
    addLink(state, 'link-far-2', 'p2', 'cannock-walsall', 'rail');
    addLink(state, 'link-market', 'p2', 'birmingham-oxford', 'rail');

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
    });

    expect(state.board.industryInstances[nearCoal.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[nearCoal.id].flipped).toBe(true);
    expect(state.board.industryInstances[farCoal.id].remainingResource).toBe(1);
    expect(state.markets.coal.occupiedCount).toBe(13);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: nearCoal.id, resourceType: 'coal'},
      byPlayerId: 'p1',
      reason: 'build',
    });
    expect(state.eventLog).not.toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: farCoal.id, resourceType: 'coal'},
      byPlayerId: 'p1',
      reason: 'build',
    });
    expect(state.eventLog).not.toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'coal', price: 1},
      byPlayerId: 'p1',
      reason: 'build',
    });
  });

  it('automatically consumes both coal from the same nearest coal mine when Build needs two coal', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.industryTileStacks.manufacturer.availableSpecIdsInOrder = ['manufacturer-3-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const coal = addIndustry(state, {
      id: 'two-coal-near',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 2,
    });
    addIndustry(state, {
      id: 'coal-far',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    addLink(state, 'link-near', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'link-far-1', 'p2', 'birmingham-walsall', 'rail');
    addLink(state, 'link-far-2', 'p2', 'cannock-walsall', 'rail');
    addLink(state, 'link-market', 'p2', 'birmingham-oxford', 'rail');

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
      industryType: 'manufacturer',
    });

    expect(state.board.industryInstances[coal.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[coal.id].flipped).toBe(true);
    expect(state.board.industryInstances['coal-far'].remainingResource).toBe(1);
    expect(state.markets.coal.occupiedCount).toBe(13);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_consumed' &&
      event.reason === 'build' &&
      event.source.kind === 'industry_tile' &&
      event.source.industryInstanceId === coal.id,
    )).toHaveLength(2);
  });

  it('rejects market coal while a connected coal mine can satisfy Build', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const coal = addIndustry(state, {
      id: 'coal-near',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    addLink(state, 'link-near', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'link-market', 'p2', 'birmingham-oxford', 'rail');

    const result = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      industryType: 'iron_works',
      coalSources: [{kind: 'market', market: 'coal', price: 1}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is not available');
    expect(state.board.industryInstances[coal.id].remainingResource).toBe(1);
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('network consumes selected coal sources in link order', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    const coal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 2,
    });
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
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
      coalSources: [
        {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
      ],
    });

    expect(state.board.industryInstances[coal.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[coal.id].flipped).toBe(true);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_consumed' &&
      event.reason === 'network' &&
      event.source.kind === 'industry_tile' &&
      event.source.industryInstanceId === coal.id,
    )).toHaveLength(2);
  });

  it('rejects an invalid second rail coal source before mutating the game', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    const firstCoal = addIndustry(state, {
      id: 'coal-first',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    const disconnectedCoal = addIndustry(state, {
      id: 'coal-disconnected',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventCountBefore = state.eventLog.length;
    const cashBefore = state.players.p1.cash;
    const railLinksBefore = state.players.p1.remainingLinks.rail;

    expect(() => applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      coalSources: [
        {kind: 'industry_tile', industryInstanceId: firstCoal.id, resourceType: 'coal'},
        {kind: 'industry_tile', industryInstanceId: disconnectedCoal.id, resourceType: 'coal'},
      ],
    })).toThrow('Selected coal source is not available');

    expect(state.board.industryInstances[firstCoal.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[disconnectedCoal.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[firstCoal.id].flipped).toBe(false);
    expect(state.board.linkLines['cannock-stafford'].occupiedBy).toBeUndefined();
    expect(state.board.linkLines['stafford-stone'].occupiedBy).toBeUndefined();
    expect(state.players.p1.remainingLinks.rail).toBe(railLinksBefore);
    expect(state.players.p1.cash).toBe(cashBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('does not consume the first Network coal before all execution coal sources are rechecked', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    const firstCoal = addIndustry(state, {
      id: 'coal-first',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    const secondCoal = addIndustry(state, {
      id: 'coal-second',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'stone',
      slotId: 'stone-1',
      remainingResource: 1,
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const handBefore = [...state.players.p1.handCardIds];
    const eventLogBefore = structuredClone(state.eventLog);
    const railLinksBefore = state.players.p1.remainingLinks.rail;
    let coalSourceReads = 0;
    const validSources = [
      {kind: 'industry_tile' as const, industryInstanceId: firstCoal.id, resourceType: 'coal' as const},
      {kind: 'industry_tile' as const, industryInstanceId: secondCoal.id, resourceType: 'coal' as const},
    ];
    const staleSources = [
      validSources[0],
      {kind: 'industry_tile' as const, industryInstanceId: 'missing-coal', resourceType: 'coal' as const},
    ];
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      get coalSources() {
        coalSourceReads++;
        return coalSourceReads === 1 ? validSources : staleSources;
      },
    };

    expect(() => executeNetwork(state, command)).toThrow('Selected coal source is not available');

    expect(coalSourceReads).toBe(2);
    expect(state.board.industryInstances[firstCoal.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[firstCoal.id].flipped).toBe(false);
    expect(state.board.industryInstances[secondCoal.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[secondCoal.id].flipped).toBe(false);
    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(false);
    expect(state.board.linkLines['cannock-stafford'].occupiedBy).toBeUndefined();
    expect(state.board.linkLines['stafford-stone'].occupiedBy).toBeUndefined();
    expect(state.players.p1.remainingLinks.rail).toBe(railLinksBefore);
    expect(state.players.p1.cash).toBe(50);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('rejects using coal connected only by the second rail for the first rail coal demand', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    const coal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'stone',
      slotId: 'stone-1',
      remainingResource: 2,
    });
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford', 'stafford-stone'],
      coalSources: [
        {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is not available');
    expect(state.board.industryInstances[coal.id].remainingResource).toBe(2);
    expect(Object.keys(state.board.linkInstances)).toHaveLength(0);
  });

  it('rejects a rail coal source count that does not match the selected links', () => {
    const state = testGame();
    state.era = 'rail';
    setHand(state, 'p1', ['p2-location-cannock-1']);

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-stafford'],
      coalSources: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Coal source count');
  });

  it('treats both endpoints of a new rail as equal coal anchors', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    const endpointACoal = addIndustry(state, {
      id: 'coal-at-coalbrookdale',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      remainingResource: 1,
    });
    const endpointBCoal = addIndustry(state, {
      id: 'coal-at-wolverhampton',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'wolverhampton',
      slotId: 'wolverhampton-1',
      remainingResource: 1,
    });
    const selectedEndpointB = {kind: 'industry_tile' as const, industryInstanceId: endpointBCoal.id, resourceType: 'coal' as const};

    expect(legalCoalSourcesForNetworkSelect(
      state,
      ['coalbrookdale-wolverhampton'],
      [undefined],
      0,
    )).toEqual(expect.arrayContaining([
      {kind: 'industry_tile', industryInstanceId: endpointACoal.id, resourceType: 'coal'},
      selectedEndpointB,
    ]));
    expect(validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-coalbrookdale-1',
      linkLineIds: ['coalbrookdale-wolverhampton'],
      coalSources: [selectedEndpointB],
    }).ok).toBe(true);

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-coalbrookdale-1',
      linkLineIds: ['coalbrookdale-wolverhampton'],
      coalSources: [selectedEndpointB],
    });

    expect(state.board.industryInstances[endpointACoal.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[endpointBCoal.id].remainingResource).toBe(0);
    expect(state.board.linkLines['coalbrookdale-wolverhampton'].occupiedBy).toBeDefined();
  });

  it('excludes removed coal mines from pending Network coal choices', () => {
    const state = testGame();
    state.era = 'rail';
    const removedCoal = addIndustry(state, {
      id: 'removed-network-coal',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    const activeCoal = addIndustry(state, {
      id: 'active-network-coal',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-1',
      remainingResource: 1,
    });
    state.board.industryInstances[removedCoal.id].removedFromGame = true;

    expect(legalCoalSourcesForNetworkSelect(
      state,
      ['birmingham-tamworth'],
      [undefined],
      0,
    )).toEqual([
      {kind: 'industry_tile', industryInstanceId: activeCoal.id, resourceType: 'coal'},
    ]);
  });

  it('rejects malformed explicit Network coal sources before availability checks', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    const cardId = 'p2-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    addIndustry(state, {
      id: 'network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const handBefore = [...state.players.p1.handCardIds];
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-oxford'],
      coalSources: [{kind: 'market', market: 'coal'}] as unknown as ResourceSource[],
    };

    const result = validateNetwork(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected coal source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('rejects blank explicit Network coal source ids before availability checks', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    const cardId = 'p2-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    addIndustry(state, {
      id: 'network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const handBefore = [...state.players.p1.handCardIds];
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-oxford'],
      coalSources: [{kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'coal'}] as unknown as ResourceSource[],
    };

    const result = validateNetwork(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected coal source is malformed');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('rejects malformed explicit double-rail beer sources before automatic selection', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    const cardId = 'p2-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    addIndustry(state, {
      id: 'network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-oxford', 'birmingham-walsall'],
      coalSources: [
        {kind: 'market' as const, market: 'coal' as const, price: 1},
        {kind: 'market' as const, market: 'coal' as const, price: 2},
      ],
      beerSourceForDoubleRail: null as unknown as ResourceSource,
    };

    const result = validateNetwork(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected double rail beer source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected double rail beer source is malformed');

    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(false);
    expect(state.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toBeUndefined();
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('rejects blank explicit double-rail beer source ids before automatic selection', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    addIndustry(state, {
      id: 'network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const command = {
      type: 'network' as const,
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      linkLineIds: ['birmingham-oxford', 'birmingham-walsall'],
      coalSources: [
        {kind: 'market' as const, market: 'coal' as const, price: 1},
        {kind: 'market' as const, market: 'coal' as const, price: 2},
      ],
      beerSourceForDoubleRail: {kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'beer'} as unknown as ResourceSource,
    };

    const result = validateNetwork(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected double rail beer source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected double rail beer source is malformed');

    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(false);
    expect(state.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toBeUndefined();
    expect(state.markets.coal.occupiedCount).toBe(13);
  });

  it('requires explicit double-rail market coal prices to advance sequentially', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    addIndustry(state, {
      id: 'cotton-network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    const repeatedFirstPrice = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      linkLineIds: ['birmingham-oxford', 'birmingham-walsall'],
      coalSources: [
        {kind: 'market', market: 'coal', price: 1},
        {kind: 'market', market: 'coal', price: 1},
      ],
    });

    expect(repeatedFirstPrice.ok).toBe(false);
    expect(repeatedFirstPrice.errors).toContain('Selected coal source is not available');

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      linkLineIds: ['birmingham-oxford', 'birmingham-walsall'],
      coalSources: [
        {kind: 'market', market: 'coal', price: 1},
        {kind: 'market', market: 'coal', price: 2},
      ],
    });

    expect(state.markets.coal.occupiedCount).toBe(11);
    expect(state.players.p1.cash).toBe(32);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog).toEqual(expect.arrayContaining([
      {type: 'resource_consumed', source: {kind: 'market', market: 'coal', price: 1}, byPlayerId: 'p1', reason: 'network'},
      {type: 'resource_consumed', source: {kind: 'market', market: 'coal', price: 2}, byPlayerId: 'p1', reason: 'network'},
    ]));
  });

  it('uses fallback coal market pricing after the coal market is empty', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.markets.coal.occupiedCount = 0;
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    addIndustry(state, {
      id: 'network-anchor',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      linkLineIds: ['birmingham-oxford', 'birmingham-walsall'],
      coalSources: [
        {kind: 'market', market: 'coal', price: 8},
        {kind: 'market', market: 'coal', price: 8},
      ],
    });

    expect(state.markets.coal.occupiedCount).toBe(0);
    expect(state.players.p1.cash).toBe(19);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog).toEqual(expect.arrayContaining([
      {type: 'resource_consumed', source: {kind: 'market', market: 'coal', price: 8}, byPlayerId: 'p1', reason: 'network'},
      {type: 'resource_consumed', source: {kind: 'market', market: 'coal', price: 8}, byPlayerId: 'p1', reason: 'network'},
    ]));
  });

  it('offers coal market access through merchant spaces without merchant tiles at high-player-count locations', () => {
    const state = testGame();
    state.playerCount = 4;
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    const cardId = 'p4-location-birmingham-1';
    setHand(state, 'p1', [cardId]);

    expect(legalCoalSourcesForNetworkSelect(
      state,
      ['derby-nottingham'],
      [undefined],
      0,
    )).toEqual([{kind: 'market', market: 'coal', price: 1}]);

    expect(validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['derby-nottingham'],
      coalSources: [{kind: 'market', market: 'coal', price: 1}],
    }).ok).toBe(true);

    applyCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['derby-nottingham'],
      coalSources: [{kind: 'market', market: 'coal', price: 1}],
    });

    expect(state.board.linkLines['derby-nottingham'].occupiedBy).toEqual(expect.any(String));
    expect(state.markets.coal.occupiedCount).toBe(12);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'coal', price: 1},
      byPlayerId: 'p1',
      reason: 'network',
    });
  });

  it('rejects coal market access when a pending rail is not connected to any merchant space', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expect(legalCoalSourcesForNetworkSelect(
      state,
      ['birmingham-walsall'],
      [undefined],
      0,
    )).toEqual([]);

    const result = validateNetwork(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      linkLineIds: ['birmingham-walsall'],
      coalSources: [{kind: 'market', market: 'coal', price: 1}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected coal source is not available');
    expect(state.markets.coal.occupiedCount).toBe(13);
    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toBeUndefined();
  });

  it('develop can explicitly consume sequential iron market prices', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    state.markets.iron.occupiedCount = 7;

    applyCommand(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine', 'iron_works'],
      ironSources: [
        {kind: 'market', market: 'iron', price: 2},
        {kind: 'market', market: 'iron', price: 3},
      ],
    });

    expect(state.markets.iron.occupiedCount).toBe(5);
    expect(state.players.p1.cash).toBe(12);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
  });

  it('normalizes missing iron market counts before offering and consuming market iron', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    delete (state.markets.iron as Partial<typeof state.markets.iron>).occupiedCount;

    expect(legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0)).toEqual([
      {kind: 'market', market: 'iron', price: 2},
    ]);

    applyCommand(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine'],
      ironSources: [{kind: 'market', market: 'iron', price: 2}],
    });

    expect(state.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount - 1);
    expect(state.players.p1.cash).toBe(15);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: 2},
      byPlayerId: 'p1',
      reason: 'develop',
    });
  });

  it('normalizes missing markets before offering and consuming market iron', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    delete (state as Partial<typeof state>).markets;

    expect(legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0)).toEqual([
      {kind: 'market', market: 'iron', price: 2},
    ]);
    expect((state as Partial<typeof state>).markets).toBeUndefined();

    applyCommand(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine'],
      ironSources: [{kind: 'market', market: 'iron', price: 2}],
    });

    expect(state.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.initialOccupiedCount);
    expect(state.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount - 1);
    expect(state.players.p1.cash).toBe(15);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: 2},
      byPlayerId: 'p1',
      reason: 'develop',
    });
  });

  it('uses fallback iron market pricing after the iron market is empty', () => {
    const state = testGame();
    const cardId = state.players.p1.handCardIds[0];
    state.markets.iron.occupiedCount = 0;

    applyCommand(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine', 'iron_works'],
      ironSources: [
        {kind: 'market', market: 'iron', price: 6},
        {kind: 'market', market: 'iron', price: 6},
      ],
    });

    expect(state.markets.iron.occupiedCount).toBe(0);
    expect(state.players.p1.cash).toBe(5);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
    expect(state.eventLog).toEqual(expect.arrayContaining([
      {type: 'resource_consumed', source: {kind: 'market', market: 'iron', price: 6}, byPlayerId: 'p1', reason: 'develop'},
      {type: 'resource_consumed', source: {kind: 'market', market: 'iron', price: 6}, byPlayerId: 'p1', reason: 'develop'},
    ]));
  });

  it('requires explicit multi-iron Build market prices to advance sequentially', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.manufacturer.availableSpecIdsInOrder = ['manufacturer-8-1'];
    state.markets.iron.occupiedCount = 7;
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];

    const repeatedFirstPrice = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
      industryType: 'manufacturer',
      ironSources: [
        {kind: 'market', market: 'iron', price: 2},
        {kind: 'market', market: 'iron', price: 2},
      ],
    });

    expect(repeatedFirstPrice.ok).toBe(false);
    expect(repeatedFirstPrice.errors).toContain('Selected iron source is not available');
    expect(state.markets.iron.occupiedCount).toBe(7);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.board.slots['birmingham-1'].occupiedBy).toBeUndefined();

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
      industryType: 'manufacturer',
      ironSources: [
        {kind: 'market', market: 'iron', price: 2},
        {kind: 'market', market: 'iron', price: 3},
      ],
    });

    const builtId = state.board.slots['birmingham-1'].occupiedBy ?? '';
    expect(state.board.industryInstances[builtId]).toMatchObject({
      specId: 'manufacturer-8-1',
      industryType: 'manufacturer',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    expect(state.markets.iron.occupiedCount).toBe(5);
    expect(state.players.p1.cash).toBe(25);
    expect(state.players.p1.spentThisRound).toBe(25);
    expect(state.eventLog).toEqual(expect.arrayContaining([
      {type: 'resource_consumed', source: {kind: 'market', market: 'iron', price: 2}, byPlayerId: 'p1', reason: 'build'},
      {type: 'resource_consumed', source: {kind: 'market', market: 'iron', price: 3}, byPlayerId: 'p1', reason: 'build'},
    ]));
  });

  it('normalizes negative coal market counts before selling a new coal mine to the market', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    state.markets.coal.occupiedCount = -2;
    addLink(state, 'link-1', 'p1', 'coalbrookdale-shrewsbury');

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-coalbrookdale-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      industryType: 'coal_mine',
    });

    const built = state.board.industryInstances[state.board.slots['coalbrookdale-2'].occupiedBy ?? ''];
    expect(state.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive.length);
    expect(built.remainingResource).toBe(1);
    expect(built.flipped).toBe(false);
    expect(state.eventLog).toContainEqual({
      type: 'resource_sold_to_market',
      industryInstanceId: built.id,
      market: 'coal',
      cashReceived: 1,
    });
  });
});
