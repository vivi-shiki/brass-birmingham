import {describe, expect, it} from 'vitest';
import {createGame} from '../src/common/gameSetup';
import {applyCommand, endCurrentEra, scoreCurrentEra, scoreLinkValue, validateBuild} from '../src/common/gameEngine';
import {retreatIncomeLevels} from '../src/common/income';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../src/common/staticData';
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

function passUntilEraLeaves(state: GameState, era: GameState['era']): number {
  let maxRoundSeen = state.roundNumber;
  let actions = 0;
  while (state.status === 'playing' && state.era === era) {
    const playerId = state.turnOrder[state.currentTurnIndex];
    const cardId = state.players[playerId].handCardIds[0];
    if (!cardId) {
      throw new Error(`Player ${playerId} has no card to pass in ${era} round ${state.roundNumber}`);
    }
    maxRoundSeen = Math.max(maxRoundSeen, state.roundNumber);
    applyCommand(state, {type: 'pass', playerId, cardId});
    actions++;
    if (actions > 300) {
      throw new Error(`Pass-only ${era} simulation did not finish`);
    }
  }
  return maxRoundSeen;
}

describe('era scoring and transition', () => {
  it('reports unknown link ids explicitly when scoring a link value', () => {
    expect(() => scoreLinkValue(testGame(), 'missing-link-line')).toThrow('Unknown link line: missing-link-line');
  });

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

  it('rebuilds the Rail deck when a dirty discard pile is missing at Canal cleanup', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    const expectedRailCards = [...state.players.p2.discardCardIds].sort();
    delete (state.players.p1 as Partial<typeof state.players.p1>).discardCardIds;

    expect(() => endCurrentEra(state)).not.toThrow();

    expect(state.era).toBe('rail');
    expect(state.players.p1.discardCardIds).toEqual([]);
    expect(state.players.p2.discardCardIds).toEqual([]);
    expect(cardsInPrivateZones(state).sort()).toEqual(expectedRailCards);
  });

  it('ends an introductory Canal-only game after Canal scoring and applies the extra variant scoring', () => {
    const state = createGame({
      id: 'introductory',
      playerNames: ['Ada', 'Ben'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2'],
      introductoryCanalOnly: true,
    });
    emptyHandsAndPrepareRailDeck(state);
    state.players.p1.cash = 80;
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(6);
    state.players.p2.cash = 10;
    state.players.p2.victoryPoints = 5;
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(-3);

    const p1Level1 = addIndustry(state, {
      id: 'p1-cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const p1Level2 = addIndustry(state, {
      id: 'p1-cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: true,
    });
    const p1UnflippedLevel2 = addIndustry(state, {
      id: 'p1-unflipped-cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'kidderminster',
      slotId: 'kidderminster-0',
      flipped: false,
    });
    const p2Level2 = addIndustry(state, {
      id: 'p2-cotton-2',
      ownerPlayerId: 'p2',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'kidderminster',
      slotId: 'kidderminster-1',
      flipped: true,
    });

    const score = endCurrentEra(state);

    expect(score.era).toBe('canal');
    expect(score.industryVictoryPointsByPlayer).toEqual({p1: 10, p2: 5});
    expect(state.status).toBe('ended');
    expect(state.era).toBe('canal');
    expect(state.variant).toBe('introductory_canal_only');
    expect(state.players.p1.victoryPoints).toBe(36);
    expect(state.players.p2.victoryPoints).toBe(14);
    expect(state.board.industryInstances[p1Level1.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[p1Level2.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[p1UnflippedLevel2.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[p2Level2.id].removedFromGame).toBe(false);
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 15, reason: 'introductory money scoring'});
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 6, reason: 'introductory income scoring'});
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p2', delta: -3, reason: 'introductory income scoring'});
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'introductory industry scoring'});
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p2', delta: 5, reason: 'introductory industry scoring'});
    expect(state.eventLog.filter((event) =>
      event.type === 'victory_points_changed' &&
      event.reason === 'introductory industry scoring' &&
      event.playerId === 'p1',
    )).toHaveLength(1);
    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
  });

  it.each([
    [2, 10],
    [3, 9],
    [4, 8],
  ] as const)('ends each era after the official %i-player round count', (playerCount, expectedRounds) => {
    const playerNames = Array.from({length: playerCount}, (_, index) => `Player ${index + 1}`);
    const playerIds = playerNames.map((_, index) => `p${index + 1}`);
    const state = createGame({
      id: `pass-only-${playerCount}`,
      playerNames,
      seed: 23,
      initialTurnOrder: playerIds,
    });

    expect(passUntilEraLeaves(state, 'canal')).toBe(expectedRounds);
    expect(state.era).toBe('rail');
    expect(state.status).toBe('playing');
    expect(state.roundNumber).toBe(1);

    expect(passUntilEraLeaves(state, 'rail')).toBe(expectedRounds);
    expect(state.status).toBe('ended');
    expect(state.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
    expect(state.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'rail'}));
    expect(state.eventLog).toContainEqual(expect.objectContaining({type: 'game_ended'}));
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

  it('does not allow ending an era before every card has been played', () => {
    const state = testGame();
    const drawDeckBefore = [...state.cardZones.drawDeck];
    const handBefore = [...state.players.p1.handCardIds];
    const eventLogBefore = structuredClone(state.eventLog);

    expect(() => endCurrentEra(state)).toThrow('Cannot end era before all cards are played');
    expect(state.era).toBe('canal');
    expect(state.lastEraScore).toBeUndefined();
    expect(state.cardZones.drawDeck).toEqual(drawDeckBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
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

  it('removes level 1 pottery at Canal end even though pottery I is Rail-buildable', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    const pottery = addIndustry(state, {
      id: 'pottery-1',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-1-1',
      locationId: 'coventry',
      slotId: 'coventry-0',
      flipped: true,
    });
    state.players.p1.industryTileStacks.pottery.builtInstanceIds = [pottery.id];

    expect(staticConfig.industryTileSpecs['pottery-1-1'].buildableEras).toEqual(['canal', 'rail']);

    endCurrentEra(state);

    expect(state.board.industryInstances[pottery.id].removedFromGame).toBe(true);
    expect(state.board.slots['coventry-0'].occupiedBy).toBeUndefined();
    expect(state.players.p1.industryTileStacks.pottery.builtInstanceIds).not.toContain(pottery.id);
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

  it('does not count unflipped industry icons when scoring links', () => {
    const state = testGame();
    emptyHandsAndPrepareRailDeck(state);
    addIndustry(state, {
      id: 'flipped-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    addIndustry(state, {
      id: 'unflipped-iron',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      remainingResource: 4,
    });
    addIndustry(state, {
      id: 'unflipped-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'southern',
      slotId: 'southern-brewery',
      remainingResource: 1,
    });
    addLink(state, 'merchant-link', 'p1', 'birmingham-oxford');
    addLink(state, 'farm-link', 'p2', 'kidderminster-worcester');

    const score = scoreCurrentEra(state);

    expect(score.linkVictoryPointsByPlayer.p1).toBe(3);
    expect(score.linkVictoryPointsByPlayer.p2).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(8);
    expect(state.players.p2.victoryPoints).toBe(0);
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

  it('keeps public wild pools out of the rebuilt Rail deck', () => {
    const state = testGame();
    const discardedCards = getCardIdsForPlayerCount(2).slice(0, 3);
    const wildLocationPoolBefore = [...state.cardZones.wildLocationPool];
    const wildIndustryPoolBefore = [...state.cardZones.wildIndustryPool];

    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = discardedCards.slice(0, 2);
    state.players.p1.faceDownDiscardCount = 1;
    state.players.p2.discardCardIds = discardedCards.slice(2);
    state.players.p2.faceDownDiscardCount = 1;
    setHand(state, 'p1', []);
    setHand(state, 'p2', []);

    endCurrentEra(state);

    expect(state.era).toBe('rail');
    expect(state.cardZones.wildLocationPool).toEqual(wildLocationPoolBefore);
    expect(state.cardZones.wildIndustryPool).toEqual(wildIndustryPoolBefore);
    expect(state.cardZones.wildLocationPool).toEqual(getWildLocationCardIds());
    expect(state.cardZones.wildIndustryPool).toEqual(getWildIndustryCardIds());
    expect(cardsInPrivateZones(state).sort()).toEqual([...discardedCards].sort());
    expect(cardsInPrivateZones(state).some((cardId) => cardId.startsWith('wild-'))).toBe(false);
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

  it('uses final Canal spending order as the first Rail turn order exactly once', () => {
    const state = testGame();
    state.turnOrder = ['p1', 'p2'];
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    state.players.p1.spentThisRound = 8;
    state.players.p2.spentThisRound = 0;
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);

    applyCommand(state, {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'});

    expect(state.era).toBe('rail');
    expect(state.turnOrder).toEqual(['p2', 'p1']);
    expect(state.currentTurnIndex).toBe(0);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.players.p2.spentThisRound).toBe(0);
    expect(state.eventLog.filter((event) => event.type === 'turn_order_updated')).toEqual([
      {type: 'turn_order_updated', order: ['p2', 'p1']},
    ]);
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

  it('keeps only the tied top players as winners in a multiplayer final tie', () => {
    const state = createGame({
      id: 'three-player-final-tie',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2', 'p3'],
    });
    state.era = 'rail';
    state.players.p1.discardCardIds = [...state.players.p1.handCardIds];
    state.players.p2.discardCardIds = [...state.players.p2.handCardIds];
    state.players.p3.discardCardIds = [...state.players.p3.handCardIds];
    state.players.p1.handCardIds = [];
    state.players.p2.handCardIds = [];
    state.players.p3.handCardIds = [];
    state.cardZones.drawDeck = [];
    state.players.p1.victoryPoints = 20;
    state.players.p2.victoryPoints = 20;
    state.players.p3.victoryPoints = 19;
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(5);
    state.players.p3.incomeTrackPosition = positionForIncomeLevel(10);
    state.players.p1.cash = 10;
    state.players.p2.cash = 10;
    state.players.p3.cash = 99;

    endCurrentEra(state);

    expect(state.eventLog).toContainEqual({type: 'game_ended', winners: ['p1', 'p2']});
  });
});
