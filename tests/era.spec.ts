import {describe, expect, it} from 'vitest';
import {createGame} from '../src/common/gameSetup';
import {applyCommand, endCurrentEra, scoreCurrentEra, validateBuild} from '../src/common/gameEngine';
import {retreatIncomeLevels} from '../src/common/income';
import {getCardIdsForPlayerCount, staticConfig} from '../src/common/staticData';
import type {GameState} from '../src/common/types';
import {addIndustry, addLink, setHand, setMerchantSpace, testGame} from './helpers';

function emptyHandsAndPrepareRailDeck(state: ReturnType<typeof testGame>): void {
  state.players.p1.discardCardIds = [...state.players.p1.handCardIds];
  state.players.p2.discardCardIds = [...state.players.p2.handCardIds];
  state.players.p1.handCardIds = [];
  state.players.p2.handCardIds = [];
  state.cardZones.drawDeck = [];
}

function positionForIncomeLevel(incomeLevel: number): number {
  const position = staticConfig.incomeTrack.positions.find((entry) => entry.incomeLevel === incomeLevel);
  if (!position) {
    throw new Error(`No income position for level ${incomeLevel}`);
  }
  return position.position;
}

function positionsForIncomeLevel(incomeLevel: number): number[] {
  const positions = staticConfig.incomeTrack.positions
    .filter((entry) => entry.incomeLevel === incomeLevel)
    .map((entry) => entry.position);
  if (positions.length === 0) {
    throw new Error(`No income positions for level ${incomeLevel}`);
  }
  return positions;
}

function cardsInPrivateZones(state: GameState): string[] {
  return [
    ...state.cardZones.drawDeck,
    ...Object.values(state.players).flatMap((player) => [
      ...player.handCardIds,
      ...player.discardCardIds,
    ]),
  ];
}

describe('era scoring and transition', () => {
  it('scores links and flipped industries, cleans Canal pieces, and moves into Rail', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [cotton.id];
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', false);

    const score = endCurrentEra(state);

    expect(score.era).toBe('canal');
    expect(score.linkVictoryPointsByPlayer.p1).toBe(3);
    expect(score.industryVictoryPointsByPlayer.p1).toBe(5);
    expect(score.totalVictoryPointsByPlayer.p1).toBe(8);
    expect(state.players.p1.victoryPoints).toBe(8);
    expect(state.era).toBe('rail');
    expect(state.roundNumber).toBe(1);
    expect(state.actionsAllowedThisTurn).toBe(2);
    expect(state.board.linkInstances).toEqual({});
    expect(state.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(true);
    expect(state.board.slots['birmingham-0'].occupiedBy).toBeUndefined();
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(cotton.id);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.players.p1.faceDownDiscardCount).toBe(0);
    expect(state.players.p2.faceDownDiscardCount).toBe(0);
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 3, reason: 'link scoring'});
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'});
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('ignores stale link instances while scoring an era', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    addLink(state, 'link-valid', 'p1', 'birmingham-oxford');
    state.board.linkInstances['link-stale-occupancy'] = {
      id: 'link-stale-occupancy',
      ownerPlayerId: 'p2',
      linkType: 'canal',
      linkLineId: 'birmingham-oxford',
    };
    state.board.linkInstances['link-stale-wrong-era'] = {
      id: 'link-stale-wrong-era',
      ownerPlayerId: 'p2',
      linkType: 'rail',
      linkLineId: 'coalbrookdale-shrewsbury',
    };
    state.board.linkLines['coalbrookdale-shrewsbury'] = {occupiedBy: 'link-stale-wrong-era'};
    state.board.linkInstances['link-stale-unknown-line'] = {
      id: 'link-stale-unknown-line',
      ownerPlayerId: 'p2',
      linkType: 'canal',
      linkLineId: 'missing-line',
    };

    const score = scoreCurrentEra(state);

    expect(score.linkVictoryPointsByPlayer.p1).toBe(3);
    expect(score.linkVictoryPointsByPlayer.p2).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(8);
    expect(state.players.p2.victoryPoints).toBe(0);
    const scoredLinkIds = state.eventLog
      .filter((event) => event.type === 'link_scored')
      .map((event) => event.linkInstanceId);
    expect(scoredLinkIds).toEqual(['link-valid']);
  });

  it('clears stale link line occupancy while transitioning eras', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    state.board.linkLines['birmingham-walsall'] = {occupiedBy: 'missing-link'};
    state.board.linkLines['ghost-link-line'] = {occupiedBy: 'missing-link'};

    endCurrentEra(state);

    expect(state.era).toBe('rail');
    expect(state.board.linkInstances).toEqual({});
    expect(state.board.linkLines['birmingham-walsall'].occupiedBy).toBeUndefined();
    expect(state.board.linkLines['ghost-link-line']).toBeUndefined();
    expect(Object.keys(state.board.linkLines).sort()).toEqual(Object.keys(staticConfig.linkLines).sort());
  });

  it('restocks only non-blank merchant beer when transitioning into Rail', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', false);
    setMerchantSpace(state, 'oxford-1', 'blank-2p-0', true);
    state.board.merchantSpaces['gloucester-0'] = {id: 'gloucester-0', beerPresent: true};

    endCurrentEra(state);

    expect(state.era).toBe('rail');
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.board.merchantSpaces['oxford-1'].beerPresent).toBe(false);
    expect(state.board.merchantSpaces['gloucester-0'].beerPresent).toBe(false);
  });

  it('ignores industry instances that do not occupy their board slot while scoring an era', () => {
    const state = testGame();
    const orphanCotton = addIndustry(state, {
      id: 'orphan-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    state.board.slots[orphanCotton.slotId] = {};
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');

    const score = scoreCurrentEra(state);

    expect(score.linkVictoryPointsByPlayer.p1).toBe(2);
    expect(score.industryVictoryPointsByPlayer.p1).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(2);
    expect(state.eventLog.some((event) =>
      event.type === 'industry_scored' &&
      event.industryInstanceId === orphanCotton.id,
    )).toBe(false);
  });

  it('ignores unflipped industries for industry scoring and adjacent link icons', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    const flippedCotton = addIndustry(state, {
      id: 'flipped-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const unflippedManufacturer = addIndustry(state, {
      id: 'unflipped-manufacturer',
      ownerPlayerId: 'p2',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-1',
      flipped: false,
    });
    addLink(state, 'link-1', 'p1', 'birmingham-walsall');

    const score = endCurrentEra(state);

    expect(score.linkVictoryPointsByPlayer.p1).toBe(1);
    expect(score.industryVictoryPointsByPlayer.p1).toBe(5);
    expect(score.industryVictoryPointsByPlayer.p2).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(6);
    expect(state.players.p2.victoryPoints).toBe(0);
    expect(state.eventLog).toContainEqual({
      type: 'industry_scored',
      industryInstanceId: flippedCotton.id,
      ownerPlayerId: 'p1',
      points: 5,
    });
    expect(state.eventLog.some((event) =>
      event.type === 'industry_scored' &&
      event.industryInstanceId === unflippedManufacturer.id,
    )).toBe(false);
  });

  it('does not score or transition while a pending decision is unresolved', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    state.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'oxford-0',
    };

    expect(() => endCurrentEra(state)).toThrow('Pending decision must be resolved first');
    expect(state.era).toBe('canal');
    expect(state.lastEraScore).toBeUndefined();
    expect(state.board.linkInstances).toEqual({});
    expect(state.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
  });

  it('does not allow the same era to be scored twice', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });

    const score = scoreCurrentEra(state);

    expect(score.industryVictoryPointsByPlayer.p1).toBe(5);
    expect(state.players.p1.victoryPoints).toBe(5);
    expect(() => scoreCurrentEra(state)).toThrow('canal era has already been scored');
    expect(state.players.p1.victoryPoints).toBe(5);
    expect(state.eventLog.filter((event) => event.type === 'industry_scored')).toHaveLength(1);
  });

  it('keeps level 2+ industries for Rail and scores them again at game end', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    const cotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [cotton.id];

    endCurrentEra(state);

    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(false);
    expect(state.board.slots['birmingham-0'].occupiedBy).toBe(cotton.id);
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toContain(cotton.id);
    expect(state.players.p1.victoryPoints).toBe(5);

    state.players.p1.handCardIds = [];
    state.players.p2.handCardIds = [];
    state.cardZones.drawDeck = [];
    endCurrentEra(state);

    expect(state.status).toBe('ended');
    expect(state.players.p1.victoryPoints).toBe(10);
    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
  });

  it('blocks undeveloped Canal-only level 1 tiles in Rail but keeps pottery I buildable', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);

    endCurrentEra(state);

    setHand(state, 'p1', ['p2-location-cannock-1']);
    const coalValidation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      industryType: 'coal_mine',
    });

    expect(coalValidation.ok).toBe(false);
    expect(coalValidation.errors.join(' ')).toContain('not buildable in this era');

    state.players.p1.cash = 50;
    setHand(state, 'p1', ['p2-location-coventry-1']);
    const potteryValidation = validateBuild(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-coventry-1',
      locationId: 'coventry',
      slotId: 'coventry-0',
      industryType: 'pottery',
    });

    expect(potteryValidation.ok).toBe(true);
  });

  it('scores flipped industries on farm breweries touched by a via-farm link', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'southern',
      slotId: 'southern-brewery',
      flipped: true,
    });
    addLink(state, 'link-1', 'p1', 'kidderminster-worcester');

    const score = endCurrentEra(state);

    expect(score.linkVictoryPointsByPlayer.p1).toBe(2);
    expect(score.industryVictoryPointsByPlayer.p1).toBe(4);
    expect(score.totalVictoryPointsByPlayer.p1).toBe(6);
    expect(state.players.p1.victoryPoints).toBe(6);
  });

  it('automatically ends an era after the last card is discarded', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.era).toBe('rail');
    expect(state.currentTurnIndex).toBe(0);
    expect(state.players.p1.handCardIds).toContain('p2-location-birmingham-1');
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('returns a final Canal wild card to the public pool instead of the Rail deck', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.cardZones.wildLocationPool = state.cardZones.wildLocationPool.filter((cardId) => cardId !== 'wild-location-1');
    setHand(state, 'p1', ['wild-location-1']);
    setHand(state, 'p2', []);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'wild-location-1'});

    expect(state.era).toBe('rail');
    expect(state.cardZones.wildLocationPool).toContain('wild-location-1');
    expect(state.cardZones.wildLocationPool).toHaveLength(staticConfig.rules.wildCardsPerType);
    expect(cardsInPrivateZones(state).some((cardId) => cardId.startsWith('wild-'))).toBe(false);
    expect(state.eventLog).toContainEqual({
      type: 'card_discarded',
      playerId: 'p1',
      cardId: 'wild-location-1',
      destination: 'wild_pool',
    });
  });

  it.each([2, 3, 4] as const)('rebuilds the Rail deck from all Canal discards and clears discard state for %i players', (playerCount) => {
    const playerNames = Array.from({length: playerCount}, (_, index) => `Player ${index + 1}`);
    const state = createGame({id: `rail-rebuild-${playerCount}`, playerNames, seed: 11});
    const playerIds = Object.keys(state.players);
    const expectedCards = getCardIdsForPlayerCount(playerCount);
    const finalCardId = expectedCards[0];
    const discardCardIds = expectedCards.filter((cardId) => cardId !== finalCardId);

    state.cardZones.drawDeck = [];
    for (const [playerIndex, playerId] of playerIds.entries()) {
      const player = state.players[playerId];
      player.discardCardIds = discardCardIds.filter((_, index) => index % playerCount === playerIndex);
      player.faceDownDiscardCount = Math.min(1, player.discardCardIds.length);
      setHand(state, playerId, []);
    }
    setHand(state, 'p1', [finalCardId]);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: finalCardId});

    expect(state.era).toBe('rail');
    for (const playerId of playerIds) {
      expect(state.players[playerId].discardCardIds).toEqual([]);
      expect(state.players[playerId].faceDownDiscardCount).toBe(0);
      expect(state.players[playerId].handCardIds).toHaveLength(staticConfig.rules.handSize);
    }
    expect(state.cardZones.drawDeck).toHaveLength(expectedCards.length - playerCount * staticConfig.rules.handSize);
    expect([...cardsInPrivateZones(state)].sort()).toEqual([...expectedCards].sort());
    expect(new Set(cardsInPrivateZones(state)).size).toBe(expectedCards.length);
  });

  it('pays income at the end of the final Canal round before era scoring', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.era).toBe('rail');
    expect(state.players.p1.cash).toBe(22);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'income'});
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('resolves final Canal round negative income before ending the era', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.players.p1.cash = 0;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.era).toBe('canal');
    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 0,
    });
    expect(state.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.era).toBe('rail');
    expect(state.players.p1.cash).toBe(3);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('resolves chained final Canal negative income decisions before ending the era', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.players.p1.cash = 0;
    state.players.p2.cash = 0;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    state.players.p2.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);
    const p1Cotton = addIndustry(state, {
      id: 'p1-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const p2Cotton = addIndustry(state, {
      id: 'p2-cotton',
      ownerPlayerId: 'p2',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.era).toBe('canal');
    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    });

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [p1Cotton.id]});

    expect(state.era).toBe('canal');
    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p2',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
    expect(state.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p2', industryInstanceIds: [p2Cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.era).toBe('rail');
    expect(state.board.industryInstances[p1Cotton.id].removedFromGame).toBe(true);
    expect(state.board.industryInstances[p2Cotton.id].removedFromGame).toBe(true);
    expect(state.players.p1.cash).toBe(1);
    expect(state.players.p2.cash).toBe(3);
    expect(state.eventLog.filter((event) => event.type === 'negative_income_resolved')).toHaveLength(2);
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('skips empty-hand players while other players finish the era', () => {
    const state = testGame();
    state.roundNumber = 9;
    state.actionsAllowedThisTurn = 2;
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', [
      'p2-location-cannock-1',
      'p2-location-coalbrookdale-1',
      'p2-location-coventry-1',
    ]);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: 'p2-location-cannock-1'});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: 'p2-location-coalbrookdale-1'});

    expect(state.era).toBe('canal');
    expect(state.roundNumber).toBe(10);
    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.handCardIds).toEqual([]);
    expect(state.players.p2.handCardIds).toEqual(['p2-location-coventry-1']);

    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: 'p2-location-coventry-1'});

    expect(state.era).toBe('rail');
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('does not pay income after the final Rail card is discarded', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.status).toBe('ended');
    expect(state.players.p1.cash).toBe(17);
    expect(state.eventLog).not.toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'income'});
    expect(state.eventLog.some((event) => event.type === 'game_ended')).toBe(true);
  });

  it('breaks final VP ties by income track position', () => {
    const state = testGame();
    state.era = 'rail';
    emptyHandsAndPrepareRailDeck(state);
    state.players.p1.victoryPoints = 20;
    state.players.p2.victoryPoints = 20;
    state.players.p1.cash = 1;
    state.players.p2.cash = 50;
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(4);

    endCurrentEra(state);

    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
  });

  it('breaks final VP ties by the higher space within the same income level before cash', () => {
    const state = testGame();
    state.era = 'rail';
    emptyHandsAndPrepareRailDeck(state);
    const [lowerPosition, higherPosition] = positionsForIncomeLevel(5);
    state.players.p1.victoryPoints = 20;
    state.players.p2.victoryPoints = 20;
    state.players.p1.incomeTrackPosition = higherPosition;
    state.players.p2.incomeTrackPosition = lowerPosition;
    state.players.p1.cash = 1;
    state.players.p2.cash = 50;

    endCurrentEra(state);

    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
  });

  it('breaks final VP and income ties by cash', () => {
    const state = testGame();
    state.era = 'rail';
    emptyHandsAndPrepareRailDeck(state);
    state.players.p1.victoryPoints = 20;
    state.players.p2.victoryPoints = 20;
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p1.cash = 10;
    state.players.p2.cash = 11;

    endCurrentEra(state);

    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p2']});
  });

  it('keeps multiple winners on an exact final tie', () => {
    const state = testGame();
    state.era = 'rail';
    emptyHandsAndPrepareRailDeck(state);
    state.players.p1.victoryPoints = 20;
    state.players.p2.victoryPoints = 20;
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p1.cash = 10;
    state.players.p2.cash = 10;

    endCurrentEra(state);

    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1', 'p2']});
  });
});
