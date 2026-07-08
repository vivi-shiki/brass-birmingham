import {describe, expect, it} from 'vitest';
import {
  applyCommand,
  validateBuild,
  validateDevelop,
  validateLoan,
  validateNetwork,
  validatePass,
  validateScout,
  validateSell,
} from '../src/common/gameEngine';
import {getIncomeLevel, retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';
import {addIndustry, addLink, firstHandCard, setHand, setMerchantSpace, testGame} from './helpers';

function testGameWithUnknownCard(cardIds = ['missing-card']) {
  const state = testGame();
  setHand(state, 'p1', cardIds);
  return state;
}

describe('actions', () => {
  it('pass discards a card, draws back to hand limit, and advances to the next player', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId});

    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.handCardIds).toHaveLength(8);
    expect(state.players.p1.discardCardIds).toContain(cardId);
  });

  it('returns a wild card to the public pool when used for a non-Build action', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);
    state.cardZones.wildLocationPool = state.cardZones.wildLocationPool.filter((cardId) => cardId !== 'wild-location-1');

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'wild-location-1'});

    expect(state.cardZones.wildLocationPool).toContain('wild-location-1');
    expect(state.players.p1.discardCardIds).not.toContain('wild-location-1');
    expect(state.eventLog).toContainEqual({
      type: 'card_discarded',
      playerId: 'p1',
      cardId: 'wild-location-1',
      destination: 'wild_pool',
    });
    expect(state.currentTurnIndex).toBe(1);
  });

  it('rejects unknown command types without advancing the turn', () => {
    const state = testGame();
    const handBefore = [...state.players.p1.handCardIds];
    const eventCountBefore = state.eventLog.length;

    expect(() => applyCommand(state, {
      type: 'future_command',
      playerId: 'p1',
    } as never)).toThrow('Unknown command');

    expect(state.currentTurnIndex).toBe(0);
    expect(state.actionIndexInTurn).toBe(0);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('rejects unknown hand card ids during validation before mutating state', () => {
    const unknownCardId = 'missing-card';
    const validators = [
      () => validatePass(testGameWithUnknownCard(), {type: 'pass', playerId: 'p1', cardId: unknownCardId}),
      () => validateLoan(testGameWithUnknownCard(), {type: 'loan', playerId: 'p1', cardId: unknownCardId}),
      () => validateBuild(testGameWithUnknownCard(), {
        type: 'build',
        playerId: 'p1',
        cardId: unknownCardId,
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        industryType: 'cotton_mill',
      }),
      () => validateNetwork(testGameWithUnknownCard(), {
        type: 'network',
        playerId: 'p1',
        cardId: unknownCardId,
        linkLineIds: ['birmingham-walsall'],
      }),
      () => validateDevelop(testGameWithUnknownCard(), {
        type: 'develop',
        playerId: 'p1',
        cardId: unknownCardId,
        industryTypes: ['coal_mine'],
      }),
      () => validateSell(testGameWithUnknownCard(), {
        type: 'sell',
        playerId: 'p1',
        cardId: unknownCardId,
        sales: [],
      }),
      () => validateScout(testGameWithUnknownCard([
        unknownCardId,
        'p2-location-birmingham-1',
        'p2-location-cannock-1',
      ]), {
        type: 'scout',
        playerId: 'p1',
        cardIds: [unknownCardId, 'p2-location-birmingham-1', 'p2-location-cannock-1'],
      }),
    ];

    for (const validate of validators) {
      expect(validate()).toEqual({ok: false, errors: [`Unknown card: ${unknownCardId}`]});
    }

    const state = testGameWithUnknownCard();
    const snapshot = structuredClone(state);

    expect(() => applyCommand(state, {type: 'pass', playerId: 'p1', cardId: unknownCardId})).toThrow(`Unknown card: ${unknownCardId}`);
    expect(state).toEqual(snapshot);
  });

  it('orders the next round by least money spent', () => {
    const state = testGame();

    applyCommand(state, {type: 'network', playerId: 'p1', cardId: firstHandCard(state, 'p1'), linkLineIds: ['birmingham-walsall']});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder[0]).toBe('p2');
    expect(state.turnOrder[1]).toBe('p1');
    expect(state.actionsAllowedThisTurn).toBe(2);
  });

  it('preserves previous turn order when players spend the same amount', () => {
    const state = testGame();
    state.turnOrder = ['p2', 'p1'];
    state.currentTurnIndex = 0;

    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});
    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p2', 'p1']);
    expect(state.eventLog).toContainEqual({type: 'turn_order_updated', order: ['p2', 'p1']});
  });

  it('counts market resource payments as money spent for turn order', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    applyCommand(state, {type: 'develop', playerId: 'p1', cardId, industryTypes: ['coal_mine']});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p2', 'p1']);
    expect(state.players.p1.cash).toBe(15);
    expect(state.markets.iron.occupiedCount).toBe(7);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: -2, reason: 'develop iron'});
  });

  it('does not offset turn-order spending with cash earned from selling resources to market', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    state.markets.coal.occupiedCount = 12;
    addLink(state, 'market-access', 'p1', 'coalbrookdale-shrewsbury');

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-coalbrookdale-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      industryType: 'coal_mine',
    });
    applyCommand(state, {
      type: 'network',
      playerId: 'p2',
      cardId: firstHandCard(state, 'p2'),
      linkLineIds: ['birmingham-walsall'],
    });

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p2', 'p1']);
    expect(state.players.p1.cash).toBe(16);
    expect(state.players.p2.cash).toBe(14);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: -5, reason: 'build'});
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 2, reason: 'income'});
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_sold_to_market' &&
      event.market === 'coal',
    )).toHaveLength(2);
  });

  it('does not count loan cash as money spent for turn order', () => {
    const state = testGame();

    applyCommand(state, {type: 'loan', playerId: 'p1', cardId: firstHandCard(state, 'p1')});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p1', 'p2']);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.players.p2.spentThisRound).toBe(0);
  });

  it('allows two actions before advancing a player after the first canal round', () => {
    const state = testGame();

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});

    expect(state.roundNumber).toBe(2);
    expect(state.currentTurnIndex).toBe(0);
    expect(state.actionIndexInTurn).toBe(0);
    expect(state.actionsAllowedThisTurn).toBe(2);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});

    expect(state.currentTurnIndex).toBe(0);
    expect(state.actionIndexInTurn).toBe(1);
    expect(state.players.p1.handCardIds).toHaveLength(7);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});

    expect(state.currentTurnIndex).toBe(1);
    expect(state.actionIndexInTurn).toBe(0);
    expect(state.players.p1.handCardIds).toHaveLength(8);
  });

  it('loan gains cash and moves income back by income levels', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    applyCommand(state, {type: 'loan', playerId: 'p1', cardId});

    expect(state.players.p1.cash).toBe(47);
    expect(getIncomeLevel(state.players.p1.incomeTrackPosition)).toBe(-3);
    expect(state.players.p1.discardCardIds).toContain(cardId);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 30, reason: 'loan'});
    expect(state.eventLog).toContainEqual({type: 'loan_taken', playerId: 'p1'});
  });

  it('rejects a loan that would move income below the minimum', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 8);

    const result = validateLoan(state, {type: 'loan', playerId: 'p1', cardId});

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('below the minimum');
    expect(state.players.p1.cash).toBe(17);
    expect(state.players.p1.handCardIds).toContain(cardId);
  });

  it('requires matching cards only for Build, not other single-card actions', () => {
    const build = testGame();
    setHand(build, 'p1', ['p2-location-cannock-1']);
    const buildResult = validateBuild(build, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    });
    expect(buildResult.ok).toBe(false);
    expect(buildResult.errors.join(' ')).toContain('Location card does not match');

    const loan = testGame();
    setHand(loan, 'p1', ['p2-industry-pottery-1']);
    expect(validateLoan(loan, {type: 'loan', playerId: 'p1', cardId: 'p2-industry-pottery-1'}).ok).toBe(true);

    const develop = testGame();
    setHand(develop, 'p1', ['p2-location-birmingham-1']);
    expect(validateDevelop(develop, {
      type: 'develop',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      industryTypes: ['coal_mine'],
    }).ok).toBe(true);

    const network = testGame();
    setHand(network, 'p1', ['p2-industry-pottery-1']);
    expect(validateNetwork(network, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-industry-pottery-1',
      linkLineIds: ['birmingham-walsall'],
    }).ok).toBe(true);

    const sell = testGame();
    setHand(sell, 'p1', ['p2-location-cannock-1']);
    const cotton = addIndustry(sell, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(sell, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(sell, 'oxford-0', 'oxford-cotton-0', true);
    expect(validateSell(sell, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    }).ok).toBe(true);
  });

  it('scout discards three cards and adds both wild cards', () => {
    const state = testGame();
    const cardIds = state.players.p1.handCardIds.slice(0, 3) as [string, string, string];

    applyCommand(state, {type: 'scout', playerId: 'p1', cardIds});

    expect(state.cardZones.wildLocationPool).toHaveLength(3);
    expect(state.cardZones.wildIndustryPool).toHaveLength(3);
    expect(state.players.p1.discardCardIds).toEqual(expect.arrayContaining(cardIds));
    expect(state.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-location'))).toBe(true);
    expect(state.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-industry'))).toBe(true);
  });

  it('refills after Scout from the regular draw deck while keeping Wild cards out of discards', () => {
    const state = testGame();
    const cardIds = state.players.p1.handCardIds.slice(0, 3) as [string, string, string];
    const drawDeckSizeBefore = state.cardZones.drawDeck.length;

    applyCommand(state, {type: 'scout', playerId: 'p1', cardIds});

    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.handCardIds).toHaveLength(staticConfig.rules.handSize);
    expect(state.cardZones.drawDeck).toHaveLength(drawDeckSizeBefore - 1);
    expect(state.cardZones.wildLocationPool).toHaveLength(staticConfig.rules.wildCardsPerType - 1);
    expect(state.cardZones.wildIndustryPool).toHaveLength(staticConfig.rules.wildCardsPerType - 1);
    expect(state.players.p1.discardCardIds).toEqual(expect.arrayContaining(cardIds));
    expect(state.players.p1.discardCardIds.filter((cardId) => cardId.startsWith('wild-'))).toEqual([]);
    expect(state.eventLog.filter((event) =>
      event.type === 'card_discarded' &&
      event.playerId === 'p1' &&
      event.destination === 'discard' &&
      cardIds.includes(event.cardId),
    )).toHaveLength(3);
  });

  it('rejects scouting duplicate cards or scouting while already holding a wild card', () => {
    const state = testGame();
    const cardIds = state.players.p1.handCardIds.slice(0, 3) as [string, string, string];

    const duplicateResult = validateScout(state, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [cardIds[0], cardIds[0], cardIds[1]],
    });
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.errors.join(' ')).toContain('distinct');

    setHand(state, 'p1', [cardIds[0], cardIds[1], 'wild-location-1']);
    const wildResult = validateScout(state, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [cardIds[0], cardIds[1], 'wild-location-1'],
    });
    expect(wildResult.ok).toBe(false);
    expect(wildResult.errors.join(' ')).toContain('wild card');
  });

  it('rejects scouting regular cards while any wild card remains in hand', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-coalbrookdale-1',
      'wild-industry-1',
    ]);

    const result = validateScout(state, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [
        'p2-location-birmingham-1',
        'p2-location-cannock-1',
        'p2-location-coalbrookdale-1',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('wild card');
  });

  it('rejects scouting payloads with extra card entries before mutating state', () => {
    const state = testGame();
    const cardIds = state.players.p1.handCardIds.slice(0, 3);
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const wildLocationPoolBefore = [...state.cardZones.wildLocationPool];
    const wildIndustryPoolBefore = [...state.cardZones.wildIndustryPool];

    expect(() => applyCommand(state, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [cardIds[0], cardIds[1], cardIds[2], cardIds[2]],
    })).toThrow('Scout must discard three distinct cards');

    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.cardZones.wildLocationPool).toEqual(wildLocationPoolBefore);
    expect(state.cardZones.wildIndustryPool).toEqual(wildIndustryPoolBefore);
    expect(state.currentTurnIndex).toBe(0);
  });

  it('rejects scouting when either wild card pool is empty', () => {
    const state = testGame();
    const cardIds = state.players.p1.handCardIds.slice(0, 3) as [string, string, string];

    state.cardZones.wildLocationPool = [];
    const missingLocationWild = validateScout(state, {type: 'scout', playerId: 'p1', cardIds});

    expect(missingLocationWild.ok).toBe(false);
    expect(missingLocationWild.errors.join(' ')).toContain('Wild card pools');

    state.cardZones.wildLocationPool = ['wild-location-1'];
    state.cardZones.wildIndustryPool = [];
    const missingIndustryWild = validateScout(state, {type: 'scout', playerId: 'p1', cardIds});

    expect(missingIndustryWild.ok).toBe(false);
    expect(missingIndustryWild.errors.join(' ')).toContain('Wild card pools');
  });

  it('rejects developing lightbulb pottery and allows developing a coal mine with market iron', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    const emptyDevelop = validateDevelop(state, {type: 'develop', playerId: 'p1', cardId, industryTypes: []});
    expect(emptyDevelop.ok).toBe(false);
    expect(emptyDevelop.errors.join(' ')).toContain('one or two tiles');
    expect(validateDevelop(state, {type: 'develop', playerId: 'p1', cardId, industryTypes: ['pottery']}).ok).toBe(false);
    applyCommand(state, {type: 'develop', playerId: 'p1', cardId, industryTypes: ['coal_mine']});

    expect(state.players.p1.cash).toBe(15);
    expect(state.markets.iron.occupiedCount).toBe(7);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
  });

  it('develops two tiles from the same industry stack in order', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    applyCommand(state, {type: 'develop', playerId: 'p1', cardId, industryTypes: ['coal_mine', 'coal_mine']});

    expect(state.players.p1.cash).toBe(13);
    expect(state.markets.iron.occupiedCount).toBe(6);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1', 'coal_mine-2-1']);
  });

  it('rejects developing the same industry twice when only one stack tile is available', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];

    const validation = validateDevelop(state, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine', 'coal_mine'],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('No coal_mine tile');
    expect(state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual([]);
  });

  it('builds an industry from a matching location card', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    });

    const built = Object.values(state.board.industryInstances)[0];
    expect(built.locationId).toBe('birmingham');
    expect(built.industryType).toBe('cotton_mill');
    expect(built.flipped).toBe(false);
    expect(state.players.p1.cash).toBe(5);
    expect(state.board.slots['birmingham-0'].occupiedBy).toBe(built.id);
  });

  it('allows an industry card anywhere before a network exists and requires the network afterward', () => {
    const noNetwork = testGame();
    setHand(noNetwork, 'p1', ['p2-industry-coal_mine-1']);

    const noNetworkValidation = validateBuild(noNetwork, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-industry-coal_mine-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(noNetworkValidation.ok).toBe(true);

    const withNetwork = testGame();
    setHand(withNetwork, 'p1', ['p2-industry-coal_mine-1']);
    addIndustry(withNetwork, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    const offNetworkValidation = validateBuild(withNetwork, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-industry-coal_mine-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(offNetworkValidation.ok).toBe(false);
    expect(offNetworkValidation.errors.join(' ')).toContain('inside the player network');
  });

  it('limits a player to one industry per location in Canal but allows multiples in Rail', () => {
    const canal = testGame();
    setHand(canal, 'p1', ['p2-location-tamworth-1']);
    addIndustry(canal, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
    });

    const canalValidation = validateBuild(canal, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-tamworth-1',
      locationId: 'tamworth',
      slotId: 'tamworth-1',
      industryType: 'coal_mine',
    });

    expect(canalValidation.ok).toBe(false);
    expect(canalValidation.errors.join(' ')).toContain('one industry per player per location');

    const rail = testGame();
    rail.era = 'rail';
    rail.actionsAllowedThisTurn = 2;
    rail.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    setHand(rail, 'p1', ['p2-location-tamworth-1']);
    addIndustry(rail, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
    });

    const railValidation = validateBuild(rail, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-tamworth-1',
      locationId: 'tamworth',
      slotId: 'tamworth-1',
      industryType: 'coal_mine',
    });

    expect(railValidation.ok).toBe(true);
  });

  it('records iron sold to the market when a new iron works fills empty market slots', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      remainingResource: 1,
    });

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-coalbrookdale-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-1',
      industryType: 'iron_works',
    });

    const built = state.board.industryInstances[state.board.slots['coalbrookdale-1'].occupiedBy ?? ''];
    expect(built.industryType).toBe('iron_works');
    expect(built.remainingResource).toBe(2);
    expect(state.markets.iron.occupiedCount).toBe(10);
    expect(state.players.p1.cash).toBe(14);
    expect(state.eventLog).toContainEqual({
      type: 'resource_sold_to_market',
      industryInstanceId: built.id,
      market: 'iron',
      cashReceived: 1,
    });
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_sold_to_market' &&
      event.industryInstanceId === built.id &&
      event.market === 'iron',
    )).toHaveLength(2);
    const builtEventIndex = state.eventLog.findIndex((event) =>
      event.type === 'industry_built' &&
      event.instance.id === built.id
    );
    const firstMarketSaleIndex = state.eventLog.findIndex((event) =>
      event.type === 'resource_sold_to_market' &&
      event.industryInstanceId === built.id &&
      event.market === 'iron'
    );
    const builtEvent = state.eventLog[builtEventIndex];

    expect(builtEventIndex).toBeGreaterThanOrEqual(0);
    expect(firstMarketSaleIndex).toBeGreaterThan(builtEventIndex);
    expect(builtEvent).toMatchObject({
      type: 'industry_built',
      instance: {
        id: built.id,
        remainingResource: 4,
        flipped: false,
      },
    });
  });

  it('sells coal to the market when a new coal mine has merchant access', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    state.markets.coal.occupiedCount = 12;
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
    expect(built.industryType).toBe('coal_mine');
    expect(built.remainingResource).toBe(0);
    expect(built.flipped).toBe(true);
    expect(state.markets.coal.occupiedCount).toBe(14);
    expect(state.players.p1.cash).toBe(14);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_sold_to_market' &&
      event.industryInstanceId === built.id &&
      event.market === 'coal',
    )).toHaveLength(2);
  });

  it('sells coal to the market through a merchant space without a merchant tile', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-coalbrookdale-1']);
    state.markets.coal.occupiedCount = 12;
    delete state.board.merchantSpaces['shrewsbury-0'].merchantTileInstanceId;
    state.board.merchantSpaces['shrewsbury-0'].beerPresent = false;
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
    expect(built.industryType).toBe('coal_mine');
    expect(built.remainingResource).toBe(0);
    expect(built.flipped).toBe(true);
    expect(state.markets.coal.occupiedCount).toBe(14);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_sold_to_market' &&
      event.industryInstanceId === built.id &&
      event.market === 'coal',
    )).toHaveLength(2);
  });

  it('sells coal through merchant spaces without merchant tiles at high-player-count locations', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-industry-coal_mine-1']);
    state.markets.coal.occupiedCount = 12;
    state.players.p1.cash = 50;
    addLink(state, 'link-belper-derby', 'p1', 'belper-derby');
    addLink(state, 'link-derby-nottingham', 'p1', 'derby-nottingham');

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-industry-coal_mine-1',
      locationId: 'belper',
      slotId: 'belper-1',
      industryType: 'coal_mine',
    });

    const built = state.board.industryInstances[state.board.slots['belper-1'].occupiedBy ?? ''];
    expect(built.industryType).toBe('coal_mine');
    expect(built.remainingResource).toBe(0);
    expect(built.flipped).toBe(true);
    expect(state.markets.coal.occupiedCount).toBe(14);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_sold_to_market' &&
      event.industryInstanceId === built.id &&
      event.market === 'coal',
    )).toHaveLength(2);
  });

  it('enforces pure slot priority before mixed slots', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'manufacturer',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('pure industry slot');
  });

  it('allows a mixed slot when every pure slot would require overbuilding', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    setHand(state, 'p1', ['p2-location-cannock-1']);
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-0',
      industryType: 'coal_mine',
    });

    expect(validation.ok).toBe(true);
  });

  it('rejects Wild Location when building on a farm brewery', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-location-1']);

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-location-1',
      locationId: 'northern',
      slotId: 'northern-brewery',
      industryType: 'brewery',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('Farm breweries require');
  });

  it('allows Wild Industry to build a brewery on a farm brewery before the player has a network', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-industry-1']);

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-industry-1',
      locationId: 'northern',
      slotId: 'northern-brewery',
      industryType: 'brewery',
    });

    const built = state.board.industryInstances[state.board.slots['northern-brewery'].occupiedBy ?? ''];
    expect(built.industryType).toBe('brewery');
    expect(built.locationId).toBe('northern');
    expect(state.players.p1.cash).toBe(10);
    expect(state.cardZones.wildIndustryPool).toContain('wild-industry-1');
  });

  it('builds Rail era breweries with two beer', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.industryTileStacks.brewery.availableSpecIdsInOrder = ['brewery-2-1'];
    setHand(state, 'p1', ['wild-industry-1']);

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-industry-1',
      locationId: 'northern',
      slotId: 'northern-brewery',
      industryType: 'brewery',
    });

    const built = state.board.industryInstances[state.board.slots['northern-brewery'].occupiedBy ?? ''];
    expect(built.specId).toBe('brewery-2-1');
    expect(built.remainingResource).toBe(2);
    expect(built.flipped).toBe(false);
  });

  it('keeps built industry event snapshots independent from later board mutations', () => {
    const state = testGame();
    setHand(state, 'p1', ['wild-industry-1']);

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'wild-industry-1',
      locationId: 'northern',
      slotId: 'northern-brewery',
      industryType: 'brewery',
    });

    const builtEvent = state.eventLog.find((event) => event.type === 'industry_built');
    if (!builtEvent || builtEvent.type !== 'industry_built') {
      throw new Error('Missing industry_built event');
    }
    const built = state.board.industryInstances[builtEvent.instance.id];
    built.remainingResource = 0;
    built.flipped = true;

    expect(builtEvent.instance.remainingResource).toBe(1);
    expect(builtEvent.instance.flipped).toBe(false);
  });

  it('allows overbuilding an own coal mine even when coal is not globally depleted', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    const originalCoalMarket = state.markets.coal.occupiedCount;
    const ownCoal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    state.players.p1.industryTileStacks.coal_mine.builtInstanceIds = [ownCoal.id];

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    const built = state.board.industryInstances[state.board.slots['cannock-1'].occupiedBy ?? ''];
    expect(state.markets.coal.occupiedCount).toBe(originalCoalMarket);
    expect(state.board.industryInstances[ownCoal.id].removedFromGame).toBe(true);
    expect(state.board.industryInstances[ownCoal.id].remainingResource).toBe(0);
    expect(built.ownerPlayerId).toBe('p1');
    expect(built.industryType).toBe('coal_mine');
    expect(built.level).toBe(2);
    expect(built.remainingResource).toBe(3);
    expect(state.players.p1.industryTileStacks.coal_mine.builtInstanceIds).not.toContain(ownCoal.id);
    expect(state.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toContain(built.id);
    expect(state.eventLog).toContainEqual({type: 'industry_removed', industryInstanceId: ownCoal.id, reason: 'overbuild'});
  });

  it('allows overbuilding an own sellable industry with a higher same-type tile', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    state.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder = ['cotton_mill-2-1'];
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    const ownCotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [ownCotton.id];

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    });

    const built = state.board.industryInstances[state.board.slots['birmingham-0'].occupiedBy ?? ''];
    expect(state.board.industryInstances[ownCotton.id].removedFromGame).toBe(true);
    expect(built.ownerPlayerId).toBe('p1');
    expect(built.industryType).toBe('cotton_mill');
    expect(built.level).toBe(2);
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(ownCotton.id);
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toContain(built.id);
    expect(state.eventLog).toContainEqual({type: 'industry_removed', industryInstanceId: ownCotton.id, reason: 'overbuild'});
  });

  it('does not remove previously gained income or victory points when overbuilding an own flipped industry', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    state.players.p1.cash = 50;
    state.players.p1.victoryPoints = 5;
    state.players.p1.incomeTrackPosition = staticConfig.incomeTrack.startPosition + 5;
    state.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder = ['cotton_mill-2-1'];
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    const ownCotton = addIndustry(state, {
      id: 'flipped-cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [ownCotton.id];

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    });

    const built = state.board.industryInstances[state.board.slots['birmingham-0'].occupiedBy ?? ''];
    expect(state.board.industryInstances[ownCotton.id].removedFromGame).toBe(true);
    expect(built.ownerPlayerId).toBe('p1');
    expect(built.industryType).toBe('cotton_mill');
    expect(built.level).toBe(2);
    expect(built.flipped).toBe(false);
    expect(state.players.p1.victoryPoints).toBe(5);
    expect(state.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.startPosition + 5);
    expect(state.eventLog).toContainEqual({type: 'industry_removed', industryInstanceId: ownCotton.id, reason: 'overbuild'});
  });

  it('allows overbuilding an opponent depleted coal mine with a higher coal mine', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.markets.coal.occupiedCount = 0;
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    const opponentCoal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: true,
    });
    state.players.p2.industryTileStacks.coal_mine.builtInstanceIds = [opponentCoal.id];

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    const built = state.board.industryInstances[state.board.slots['cannock-1'].occupiedBy ?? ''];
    expect(state.board.industryInstances[opponentCoal.id].removedFromGame).toBe(true);
    expect(built.ownerPlayerId).toBe('p1');
    expect(built.industryType).toBe('coal_mine');
    expect(built.level).toBe(2);
    expect(state.players.p2.industryTileStacks.coal_mine.builtInstanceIds).not.toContain(opponentCoal.id);
    expect(state.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toContain(built.id);
  });

  it('allows overbuilding an opponent depleted iron works with a higher iron works', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-dudley-1']);
    state.markets.iron.occupiedCount = 0;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    const opponentCoal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 1,
    });
    const opponentIron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      flipped: true,
    });
    state.players.p2.industryTileStacks.iron_works.builtInstanceIds = [opponentIron.id];

    applyCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-dudley-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      industryType: 'iron_works',
    });

    const built = state.board.industryInstances[state.board.slots['dudley-1'].occupiedBy ?? ''];
    expect(state.board.industryInstances[opponentIron.id].removedFromGame).toBe(true);
    expect(state.board.industryInstances[opponentCoal.id].flipped).toBe(true);
    expect(built.ownerPlayerId).toBe('p1');
    expect(built.industryType).toBe('iron_works');
    expect(built.level).toBe(2);
    expect(built.remainingResource).toBe(0);
    expect(built.flipped).toBe(true);
    expect(state.players.p2.industryTileStacks.iron_works.builtInstanceIds).not.toContain(opponentIron.id);
    expect(state.players.p1.industryTileStacks.iron_works.builtInstanceIds).toContain(built.id);
  });

  it('rejects overbuilding an opponent coal mine while coal remains in the market', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: true,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('globally depleted');
  });

  it('rejects overbuilding an opponent coal mine while coal remains on the board', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.markets.coal.occupiedCount = 0;
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    const targetCoal = addIndustry(state, {
      id: 'coal-target',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: true,
    });
    const availableCoal = addIndustry(state, {
      id: 'coal-available',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      remainingResource: 1,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('globally depleted');
    expect(state.board.industryInstances[targetCoal.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[availableCoal.id].remainingResource).toBe(1);
  });

  it('rejects Build when a slot points at an industry that does not occupy that slot', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.players.p1.cash = 50;
    state.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder = ['cotton_mill-2-1'];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    addLink(state, 'link-market', 'p1', 'birmingham-oxford', 'rail');
    const staleCotton = addIndustry(state, {
      id: 'stale-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });
    state.board.slots['birmingham-0'] = {occupiedBy: staleCotton.id};

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('Selected slot occupation is stale');
  });

  it('rejects overbuilding an opponent iron works while iron remains in the market', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-dudley-1']);
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      flipped: true,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-dudley-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      industryType: 'iron_works',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('globally depleted');
  });

  it('rejects overbuilding an opponent iron works while iron remains on the board', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-dudley-1']);
    state.markets.iron.occupiedCount = 0;
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    const targetIron = addIndustry(state, {
      id: 'iron-target',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      flipped: true,
    });
    const availableIron = addIndustry(state, {
      id: 'iron-available',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-1',
      remainingResource: 1,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-dudley-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      industryType: 'iron_works',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('globally depleted');
    expect(state.board.industryInstances[targetIron.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[availableIron.id].remainingResource).toBe(1);
  });

  it('rejects overbuilding an opponent coal mine with a different industry type', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.markets.coal.occupiedCount = 0;
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-0',
      flipped: true,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-0',
      industryType: 'manufacturer',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('same industry and a higher level');
  });

  it('rejects overbuilding an opponent coal mine with an equal or lower level coal mine', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-cannock-1']);
    state.markets.coal.occupiedCount = 0;
    addIndustry(state, {
      id: 'coal-2',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: true,
    });

    const validation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('same industry and a higher level');
  });
});
