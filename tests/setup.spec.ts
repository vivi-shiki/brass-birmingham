import {describe, expect, it} from 'vitest';
import {createGame} from '../src/common/gameSetup';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../src/common/staticData';
import {getIncomeLevel} from '../src/common/income';
import type {GameState, IndustryType, PlayerCount} from '../src/common/types';

function allCardsInGame(state: GameState): string[] {
  return [
    ...state.cardZones.drawDeck,
    ...Object.values(state.players).flatMap((player) => [
      ...player.handCardIds,
      ...player.discardCardIds,
    ]),
  ];
}

function expectedBoardSlotIds(): string[] {
  return Object.values(staticConfig.locations).flatMap((location) => {
    if (location.kind === 'city') {
      return location.slots.map((slot) => slot.id);
    }
    if (location.kind === 'farm_brewery') {
      return [`${location.id}-brewery`];
    }
    return [];
  }).sort();
}

function merchantTileSpecId(merchantTileInstanceId: string): string {
  return merchantTileInstanceId.replace(/-\d+$/, '');
}

describe('game setup', () => {
  it('creates a two-player game with hands, facedown discards, markets, and first-round turn state', () => {
    const state = createGame({id: 'g1', playerNames: ['Ada', 'Ben'], seed: 42});

    expect(state.playerCount).toBe(2);
    expect(state.era).toBe('canal');
    expect(state.roundNumber).toBe(1);
    expect(state.actionsAllowedThisTurn).toBe(1);
    expect(state.turnOrder).toEqual(['p1', 'p2']);
    expect(state.players.p1.cash).toBe(17);
    expect(getIncomeLevel(state.players.p1.incomeTrackPosition)).toBe(0);
    expect(state.players.p1.handCardIds).toHaveLength(8);
    expect(state.players.p2.handCardIds).toHaveLength(8);
    expect(state.players.p1.discardCardIds).toHaveLength(1);
    expect(state.players.p2.discardCardIds).toHaveLength(1);
    expect(state.players.p1.faceDownDiscardCount).toBe(1);
    expect(state.players.p2.faceDownDiscardCount).toBe(1);
    expect(state.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.initialOccupiedCount);
    expect(state.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);
  });

  it('creates complete player industry stacks from static tile specs', () => {
    const state = createGame({id: 'g1', playerNames: ['Ada', 'Ben'], seed: 42});

    expect(state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder[0]).toBe('coal_mine-1-1');
    expect(state.players.p1.industryTileStacks.pottery.availableSpecIdsInOrder[0]).toBe('pottery-1-1');
    expect(staticConfig.industryTileSpecs['pottery-1-1'].canDevelop).toBe(false);
    expect(state.players.p1.remainingLinks).toEqual({canal: 14, rail: 14});
  });

  it('deals exactly the selected player-count deck and keeps wild cards out of private zones', () => {
    for (const playerCount of [2, 3, 4] as const) {
      const playerNames = Array.from({length: playerCount}, (_, index) => `Player ${index + 1}`);
      const state = createGame({id: `g${playerCount}`, playerNames, seed: 7});
      const expectedDeck = getCardIdsForPlayerCount(playerCount);
      const cardsInGame = allCardsInGame(state);

      expect(cardsInGame).toHaveLength(expectedDeck.length);
      expect([...cardsInGame].sort()).toEqual([...expectedDeck].sort());
      expect(new Set(cardsInGame).size).toBe(cardsInGame.length);
      expect(state.cardZones.drawDeck).toHaveLength(expectedDeck.length - playerCount * (staticConfig.rules.handSize + 1));
      expect(state.cardZones.wildLocationPool).toEqual(getWildLocationCardIds());
      expect(state.cardZones.wildIndustryPool).toEqual(getWildIndustryCardIds());
      expect(cardsInGame.some((cardId) => cardId.startsWith('wild-'))).toBe(false);

      for (const player of Object.values(state.players)) {
        expect(player.handCardIds).toHaveLength(staticConfig.rules.handSize);
        expect(player.discardCardIds).toHaveLength(1);
        expect(player.faceDownDiscardCount).toBe(1);
      }
    }
  });

  it('initializes each player board from shared static config', () => {
    const state = createGame({id: 'g1', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], seed: 42});

    for (const [playerId, player] of Object.entries(state.players)) {
      expect(player.id).toBe(playerId);
      expect(player.cash).toBe(staticConfig.rules.initialCash);
      expect(player.victoryPoints).toBe(0);
      expect(player.incomeTrackPosition).toBe(staticConfig.incomeTrack.startPosition);
      expect(player.spentThisRound).toBe(0);
      expect(player.remainingLinks).toEqual({
        canal: staticConfig.rules.initialLinksPerType,
        rail: staticConfig.rules.initialLinksPerType,
      });
      for (const industryType of Object.keys(staticConfig.industryStackSpecIds)) {
        const stack = player.industryTileStacks[industryType as keyof typeof staticConfig.industryStackSpecIds];
        expect(stack.availableSpecIdsInOrder).toEqual(staticConfig.industryStackSpecIds[industryType as keyof typeof staticConfig.industryStackSpecIds]);
        expect(stack.removedSpecIds).toEqual([]);
        expect(stack.builtInstanceIds).toEqual([]);
      }
    }
  });

  it('creates empty board occupancy maps from every static slot and link line', () => {
    const state = createGame({id: 'g1', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], seed: 42});

    expect(Object.keys(state.board.slots).sort()).toEqual(expectedBoardSlotIds());
    expect(Object.values(state.board.slots)).toEqual(Object.values(state.board.slots).map(() => ({})));
    expect(Object.keys(state.board.linkLines).sort()).toEqual(Object.keys(staticConfig.linkLines).sort());
    expect(Object.values(state.board.linkLines)).toEqual(Object.values(state.board.linkLines).map(() => ({})));
    expect(state.board.industryInstances).toEqual({});
    expect(state.board.linkInstances).toEqual({});
    expect(state.nextInstanceId).toBe(1);
    expect(state.eventLog).toEqual([{type: 'game_created', gameId: 'g1', playerIds: ['p1', 'p2', 'p3', 'p4']}]);
  });

  it('creates merchant spaces and merchant beers for the selected player count', () => {
    const twoPlayer = createGame({id: 'g2', playerNames: ['Ada', 'Ben'], seed: 42});
    const threePlayer = createGame({id: 'g3', playerNames: ['Ada', 'Ben', 'Cara'], seed: 42});
    const fourPlayer = createGame({id: 'g4', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], seed: 42});

    expect(Object.keys(twoPlayer.board.merchantSpaces).sort()).toEqual([
      'gloucester-0',
      'gloucester-1',
      'oxford-0',
      'oxford-1',
      'shrewsbury-0',
    ]);
    expect(Object.keys(threePlayer.board.merchantSpaces).sort()).toEqual([
      'gloucester-0',
      'gloucester-1',
      'oxford-0',
      'oxford-1',
      'shrewsbury-0',
      'warrington-0',
      'warrington-1',
    ]);
    expect(Object.keys(fourPlayer.board.merchantSpaces).sort()).toEqual([
      'gloucester-0',
      'gloucester-1',
      'nottingham-0',
      'nottingham-1',
      'oxford-0',
      'oxford-1',
      'shrewsbury-0',
      'warrington-0',
      'warrington-1',
    ]);

    for (const state of [twoPlayer, threePlayer, fourPlayer]) {
      for (const space of Object.values(state.board.merchantSpaces)) {
        expect(space.merchantTileInstanceId).toBeDefined();
        const specId = space.merchantTileInstanceId?.replace(/-\d+$/, '') ?? '';
        const spec = staticConfig.merchantTileSpecs[specId];
        expect(spec.minPlayers).toBeLessThanOrEqual(state.playerCount);
        expect(space.beerPresent).toBe(!spec.blank);
      }
    }
  });

  it('matches rulebook component counts in actual setup for each player count', () => {
    const expectedDeckSizes: Record<PlayerCount, number> = {2: 40, 3: 54, 4: 64};
    const expectedMerchantSpaceCounts: Record<PlayerCount, number> = {2: 5, 3: 7, 4: 9};
    const expectedBlankMerchantTileCounts: Record<PlayerCount, number> = {2: 1, 3: 2, 4: 2};
    const expectedIndustryTilesPerPlayer: Record<IndustryType, number> = {
      cotton_mill: 11,
      coal_mine: 7,
      iron_works: 4,
      manufacturer: 11,
      pottery: 5,
      brewery: 7,
    };

    for (const playerCount of [2, 3, 4] as const) {
      const playerNames = Array.from({length: playerCount}, (_, index) => `Player ${index + 1}`);
      const state = createGame({id: `component-audit-${playerCount}`, playerNames, seed: 17});
      const activeCards = allCardsInGame(state);
      const activeMerchantTileSpecIds = Object.values(state.board.merchantSpaces)
        .map((space) => space.merchantTileInstanceId)
        .filter((id): id is string => Boolean(id))
        .map(merchantTileSpecId);

      expect(activeCards).toHaveLength(expectedDeckSizes[playerCount]);
      expect(activeCards.sort()).toEqual(getCardIdsForPlayerCount(playerCount).sort());
      expect(state.cardZones.wildLocationPool).toHaveLength(staticConfig.rules.wildCardsPerType);
      expect(state.cardZones.wildIndustryPool).toHaveLength(staticConfig.rules.wildCardsPerType);
      expect([
        ...state.cardZones.wildLocationPool,
        ...state.cardZones.wildIndustryPool,
      ]).toHaveLength(8);

      expect(Object.keys(state.board.merchantSpaces)).toHaveLength(expectedMerchantSpaceCounts[playerCount]);
      expect(activeMerchantTileSpecIds).toHaveLength(expectedMerchantSpaceCounts[playerCount]);
      expect(new Set(activeMerchantTileSpecIds).size).toBe(activeMerchantTileSpecIds.length);
      expect(activeMerchantTileSpecIds.filter((specId) => staticConfig.merchantTileSpecs[specId].blank))
        .toHaveLength(expectedBlankMerchantTileCounts[playerCount]);
      expect(Object.values(state.board.merchantSpaces).filter((space) => space.beerPresent))
        .toHaveLength(expectedMerchantSpaceCounts[playerCount] - expectedBlankMerchantTileCounts[playerCount]);

      for (const specId of activeMerchantTileSpecIds) {
        expect(staticConfig.merchantTileSpecs[specId].minPlayers).toBeLessThanOrEqual(playerCount);
      }
      if (playerCount === 2) {
        expect(Object.keys(state.board.merchantSpaces).some((id) => id.startsWith('warrington-'))).toBe(false);
        expect(Object.keys(state.board.merchantSpaces).some((id) => id.startsWith('nottingham-'))).toBe(false);
      }
      if (playerCount === 3) {
        expect(Object.keys(state.board.merchantSpaces).some((id) => id.startsWith('nottingham-'))).toBe(false);
      }

      expect(state.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive.length - 1);
      expect(state.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.priceSlotsCheapestToMostExpensive.length - 2);

      for (const player of Object.values(state.players)) {
        const playerIndustryTileCount = Object.entries(expectedIndustryTilesPerPlayer)
          .reduce((total, [industryType, count]) => {
            expect(player.industryTileStacks[industryType as IndustryType].availableSpecIdsInOrder).toHaveLength(count);
            return total + count;
          }, 0);
        expect(playerIndustryTileCount).toBe(45);
        expect(Math.max(player.remainingLinks.canal, player.remainingLinks.rail)).toBe(14);
        expect(player.cash).toBe(staticConfig.rules.initialCash);
        expect(player.handCardIds).toHaveLength(staticConfig.rules.handSize);
        expect(player.discardCardIds).toHaveLength(1);
        expect(player.faceDownDiscardCount).toBe(1);
      }
    }
  });

  it('randomizes the initial turn order deterministically from the setup seed', () => {
    const state = createGame({id: 'g1', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], seed: 1});
    const repeated = createGame({id: 'g2', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], seed: 1});

    expect(state.turnOrder).toEqual(['p4', 'p2', 'p1', 'p3']);
    expect(repeated.turnOrder).toEqual(state.turnOrder);
  });

  it('rejects fractional setup seeds instead of truncating them implicitly', () => {
    expect(() => createGame({id: 'fractional-seed', playerNames: ['Ada', 'Ben'], seed: 1.5}))
      .toThrow('Game seed must be an integer');
  });

  it('accepts explicit initial turn order for deterministic fixtures', () => {
    const state = createGame({
      id: 'g1',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 1,
      initialTurnOrder: ['p3', 'p1', 'p2'],
    });

    expect(state.turnOrder).toEqual(['p3', 'p1', 'p2']);
    expect(() => createGame({
      id: 'bad',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 1,
      initialTurnOrder: ['p1', 'p1', 'p2'],
    })).toThrow('Initial turn order must include every player exactly once');
  });

  it('rejects unsupported player counts', () => {
    expect(() => createGame({id: 'too-few', playerNames: ['Ada'], seed: 1})).toThrow('2-4 players');
    expect(() => createGame({id: 'too-many', playerNames: ['Ada', 'Ben', 'Cara', 'Dev', 'Eli'], seed: 1})).toThrow('2-4 players');
  });
});
