import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGame} from '../../src/common/gameSetup';
import {advanceIncomeSpaces, retreatIncomeLevels} from '../../src/common/income';
import {getCurrentPlayerId} from '../../src/common/selectors';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../../src/common/staticData';
import type {GameState, PlayerCount} from '../../src/common/types';
import {GameStore} from '../../src/server/gameStore';
import {addIndustry, addLink, setMerchantSpace} from '../helpers';

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

function expectedMerchantSpaceIds(playerCount: PlayerCount): string[] {
  return Object.values(staticConfig.locations)
    .filter((location) => location.kind === 'merchant' && location.minPlayers <= playerCount)
    .flatMap((location) => location.kind === 'merchant'
      ? location.spaces.filter((space) => space.minPlayers <= playerCount).map((space) => space.id)
      : [])
    .sort();
}

function merchantTileSpecId(merchantTileInstanceId: string): string {
  return merchantTileInstanceId.replace(/-\d+$/, '');
}

function regularCardsInZones(game: GameState): string[] {
  return [
    ...game.cardZones.drawDeck,
    ...Object.values(game.players).flatMap((player) => [
      ...player.handCardIds.filter((cardId) => !cardId.startsWith('wild-')),
      ...player.discardCardIds,
    ]),
  ];
}

function expectUnique(values: string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

describe('GameStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates games and applies commands through the shared rules engine', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(true);
    expect(result.state?.currentTurnIndex).toBe(1);
    expect(store.get(game.id)?.players.p1.discardCardIds).toContain(cardId);
  });

  it('timestamps games and orders public summaries by latest activity', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const store = new GameStore();
      const firstGame = store.create({playerNames: ['Ada', 'Ben'], seed: 5});

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      const secondGame = store.create({playerNames: ['Cara', 'Dan'], seed: 7});

      expect(firstGame.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(firstGame.updatedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(secondGame.createdAt).toBe('2026-01-01T00:00:01.000Z');
      expect(secondGame.updatedAt).toBe('2026-01-01T00:00:01.000Z');
      expect(store.list()).toEqual([
        expect.objectContaining({
          id: secondGame.id,
          createdAt: '2026-01-01T00:00:01.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
        expect.objectContaining({
          id: firstGame.id,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ]);

      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      const cardId = firstGame.players.p1.handCardIds[0];
      const session = store.getPlayerSession(firstGame.id, 'p1');
      const result = store.apply(firstGame.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

      expect(result.ok).toBe(true);
      expect(result.state?.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.state?.updatedAt).toBe('2026-01-01T00:00:02.000Z');
      expect(store.list()).toEqual([
        expect.objectContaining({
          id: firstGame.id,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
        expect.objectContaining({
          id: secondGame.id,
          createdAt: '2026-01-01T00:00:01.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores persisted timestamps and latest-activity summary order', () => {
    vi.useFakeTimers();
    try {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
      const storagePath = path.join(directory, 'games.json');

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const store = new GameStore({storagePath});
      const firstGame = store.create({playerNames: ['Ada', 'Ben'], seed: 5});

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      const secondGame = store.create({playerNames: ['Cara', 'Dan'], seed: 7});

      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      const cardId = firstGame.players.p1.handCardIds[0];
      const session = store.getPlayerSession(firstGame.id, 'p1');
      expect(store.apply(firstGame.id, {type: 'pass', playerId: 'p1', cardId}, session?.token).ok).toBe(true);

      const restored = new GameStore({storagePath});

      expect(restored.get(firstGame.id)?.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(restored.get(firstGame.id)?.updatedAt).toBe('2026-01-01T00:00:02.000Z');
      expect(restored.get(secondGame.id)?.createdAt).toBe('2026-01-01T00:00:01.000Z');
      expect(restored.get(secondGame.id)?.updatedAt).toBe('2026-01-01T00:00:01.000Z');
      expect(restored.list()).toEqual([
        expect.objectContaining({
          id: firstGame.id,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:02.000Z',
        }),
        expect.objectContaining({
          id: secondGame.id,
          createdAt: '2026-01-01T00:00:01.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps game activity timestamps monotonic when the system clock moves backwards', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const store = new GameStore();
      const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const p1Session = store.getPlayerSession(game.id, 'p1');
      const p2Session = store.getPlayerSession(game.id, 'p2');
      const p1CardId = game.players.p1.handCardIds[0];
      const p2CardId = game.players.p2.handCardIds[0];

      vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
      const firstResult = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId: p1CardId}, p1Session?.token);
      expect(firstResult.ok).toBe(true);
      expect(firstResult.state?.updatedAt).toBe('2026-01-01T00:00:02.000Z');

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      const secondResult = store.apply(game.id, {type: 'pass', playerId: 'p2', cardId: p2CardId}, p2Session?.token);
      expect(secondResult.ok).toBe(true);
      expect(secondResult.state?.updatedAt).toBe('2026-01-01T00:00:02.000Z');
      expect(store.get(game.id)?.updatedAt).toBe('2026-01-01T00:00:02.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates and restores introductory Canal-only games when requested', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true});

    expect(game.variant).toBe('introductory_canal_only');
    expect(store.get(game.id)?.variant).toBe('introductory_canal_only');
    expect(store.list()[0]).toMatchObject({id: game.id, variant: 'introductory_canal_only'});

    const restoredStore = new GameStore({storagePath});
    expect(restoredStore.get(game.id)?.variant).toBe('introductory_canal_only');
    expect(restoredStore.list()[0]).toMatchObject({id: game.id, variant: 'introductory_canal_only'});
  });

  it('omits unknown variants when restoring legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-secret-variant', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    (game as unknown as {variant?: string}).variant = 'secret_variant';

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: [{gameId: game.id, players: []}],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id) as (GameState & Record<string, unknown>) | undefined;
    const summary = restored.list()[0] as unknown as Record<string, unknown>;

    expect(restoredGame).toBeDefined();
    expect(restoredGame).not.toHaveProperty('variant');
    expect(summary).not.toHaveProperty('variant');
    expect(JSON.stringify(summary)).not.toContain('secret_variant');
  });

  it('omits introductory variants from restored non-Canal persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({
      id: 'legacy-intro-rail',
      playerNames: ['Ada', 'Ben'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2'],
      introductoryCanalOnly: true,
    });
    game.era = 'rail';
    game.roundNumber = 2;
    game.actionsAllowedThisTurn = 2;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id) as (GameState & Record<string, unknown>) | undefined;
    const summary = restored.list()[0] as unknown as Record<string, unknown>;

    expect(restoredGame?.era).toBe('rail');
    expect(restoredGame).not.toHaveProperty('variant');
    expect(summary).not.toHaveProperty('variant');
    expect(JSON.stringify(summary)).not.toContain('introductory_canal_only');
  });

  it('keeps the introductory variant in ended public summaries without active-turn details', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true});
    game.status = 'ended';
    game.players.p1.victoryPoints = 12;
    game.players.p2.victoryPoints = 8;
    game.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 7, incomePlayerIndex: 1};

    expect(store.list()[0]).toEqual({
      id: game.id,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'ended',
      variant: 'introductory_canal_only',
      winners: ['p1'],
      victoryPointsByPlayer: {p1: 12, p2: 8},
    });
  });

  it('omits introductory variants from non-Canal runtime public summaries', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true});
    game.era = 'rail';
    game.actionsAllowedThisTurn = 2;

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: game.id,
      era: 'rail',
      status: 'playing',
    });
    expect(summary).not.toHaveProperty('variant');
    expect(JSON.stringify(summary)).not.toContain('introductory_canal_only');
  });

  it('normalizes padded command strings before session verification and rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(` ${game.id}\n`, {
      type: ' develop ',
      playerId: ' p1 ',
      cardId: `\t${cardId} `,
      industryTypes: [' coal_mine '],
      ironSources: [{kind: ' market ', market: ' iron ', price: 2}],
    }, ` ${session?.token ?? ''}\n`);

    expect(result.ok).toBe(true);
    expect(result.state?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(result.state?.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount - 1);
    expect(result.state?.players.p1.cash).toBe(staticConfig.rules.initialCash - 2);
    expect(result.state?.players.p1.handCardIds).not.toContain(cardId);
    expect(result.state?.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: 2},
      byPlayerId: 'p1',
      reason: 'develop',
    });
  });

  it('normalizes padded nested sell command strings before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = 'p2-location-birmingham-1';
    game.players.p1.handCardIds = [cardId];
    const cotton = addIndustry(game, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(game, 'link-1', 'p1', 'birmingham-oxford');
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: true,
    };
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(` ${game.id} `, {
      type: ' sell ',
      playerId: ' p1 ',
      cardId: ` ${cardId} `,
      sales: [{
        industryInstanceId: ` ${cotton.id} `,
        merchantSpaceId: ' oxford-0 ',
        beerSources: [{
          kind: ' merchant_beer ',
          merchantSpaceId: ' oxford-0 ',
          merchantTileInstanceId: ' oxford-cotton-0 ',
        }],
      }],
    }, ` ${session?.token ?? ''} `);

    expect(result.ok).toBe(true);
    expect(result.state?.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(result.state?.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(result.state?.players.p1.discardCardIds).toContain(cardId);
    expect(result.state?.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(result.state?.eventLog).toContainEqual({
      type: 'industry_sold',
      industryInstanceId: cotton.id,
      ownerPlayerId: 'p1',
      merchantSpaceId: 'oxford-0',
    });
  });

  it('returns validation errors for illegal commands', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p2.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p2');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p2', cardId}, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain("p1's turn");
  });

  it('normalizes dirty runtime turn state before applying a command', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    game.turnOrder = ['ghost-player', ' p2 ', 'p2'];
    game.currentTurnIndex = 1;
    game.actionIndexInTurn = 99;
    game.actionsAllowedThisTurn = 99 as GameState['actionsAllowedThisTurn'];
    const cardId = game.players.p2.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p2');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p2', cardId}, session?.token);

    expect(result.ok).toBe(true);
    expect(result.state?.turnOrder).toEqual(['p2', 'p1']);
    expect(result.state?.currentTurnIndex).toBe(1);
    expect(result.state?.actionIndexInTurn).toBe(0);
    expect(store.get(game.id)?.players.p2.discardCardIds).toContain(cardId);
  });

  it('uses the stored game id for public lists and persisted command results', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const storedGameId = game.id;
    game.id = ' secret-game-id ';
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(storedGameId, 'p1');

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: storedGameId,
      playerNames: ['Ada', 'Ben'],
      currentPlayerId: 'p1',
    });
    expect(JSON.stringify(summary)).not.toContain('secret-game-id');

    const result = store.apply(storedGameId, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(true);
    expect(result.state?.id).toBe(storedGameId);
    expect(store.get(storedGameId)?.id).toBe(storedGameId);
    expect(store.get(storedGameId)?.players.p1.discardCardIds).toContain(cardId);

    const saved = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {games: Array<Record<string, unknown>>};
    expect(saved.games.find((game) => game.id === storedGameId)).toBeDefined();
    expect(JSON.stringify(saved)).not.toContain('secret-game-id');

    const restored = new GameStore({storagePath});
    expect(restored.get(storedGameId)?.id).toBe(storedGameId);
    expect(restored.list()[0]?.id).toBe(storedGameId);
  });

  it('normalizes stale runtime metadata when games are retrieved by their stored id', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const storedGameId = game.id;
    game.id = ' secret-game-id ';
    game.era = 'rail';
    (game as unknown as {variant?: string}).variant = 'introductory_canal_only';
    game.turnOrder = ['p2', 'p2', ' ghost ', 'p1'];
    game.currentTurnIndex = 99;
    game.actionIndexInTurn = 99;
    game.pendingDecision = {
      type: 'negative_income',
      playerId: ' p1 ',
      amountOwed: 3.8,
      incomePlayerIndex: 99,
    };

    const retrieved = store.get(` ${storedGameId}\n`);

    expect(retrieved).toBe(game);
    expect(retrieved?.id).toBe(storedGameId);
    expect(game.id).toBe(storedGameId);
    expect(retrieved).not.toHaveProperty('variant');
    expect(retrieved?.turnOrder).toEqual(['p2', 'p1']);
    expect(retrieved?.currentTurnIndex).toBe(1);
    expect(retrieved?.actionIndexInTurn).toBe(0);
    expect(retrieved?.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
  });

  it('normalizes stale runtime metadata before building public game summaries', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const storedGameId = game.id;
    game.id = ' secret-game-id ';
    game.era = 'rail';
    (game as unknown as {variant?: string}).variant = 'introductory_canal_only';
    game.turnOrder = ['p2', 'p2', ' ghost ', 'p1'];
    game.currentTurnIndex = 99;
    game.actionIndexInTurn = 99;
    game.pendingDecision = {
      type: 'negative_income',
      playerId: ' p1 ',
      amountOwed: 3.8,
      incomePlayerIndex: 99,
    };

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: storedGameId,
      playerNames: ['Ada', 'Ben'],
      currentPlayerId: 'p1',
      pendingDecision: {type: 'negative_income', playerId: 'p1'},
      era: 'rail',
      status: 'playing',
    });
    expect(summary).not.toHaveProperty('variant');
    expect(JSON.stringify(summary)).not.toContain('secret-game-id');
    expect(game.id).toBe(storedGameId);
    expect(game.turnOrder).toEqual(['p2', 'p1']);
    expect(game.currentTurnIndex).toBe(1);
    expect(game.actionIndexInTurn).toBe(0);
    expect(game.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
  });

  it('normalizes every stored game before persisting due to another game command', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const staleGame = store.create({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true});
    const staleGameId = staleGame.id;
    const activeGame = store.create({playerNames: ['Cara', 'Dev'], seed: 7});
    staleGame.id = ' secret-game-id ';
    staleGame.era = 'rail';
    staleGame.actionsAllowedThisTurn = 2;
    staleGame.turnOrder = ['p2', 'p2', ' ghost ', 'p1'];
    staleGame.currentTurnIndex = 99;
    staleGame.actionIndexInTurn = 99;
    staleGame.pendingDecision = {
      type: 'negative_income',
      playerId: ' p1 ',
      amountOwed: 3.8,
      incomePlayerIndex: 99,
    };
    const activePlayerId = getCurrentPlayerId(activeGame);
    const activeCardId = activeGame.players[activePlayerId].handCardIds[0];
    const activeSession = store.getPlayerSession(activeGame.id, activePlayerId);

    const result = store.apply(
      activeGame.id,
      {type: 'pass', playerId: activePlayerId, cardId: activeCardId},
      activeSession?.token,
    );

    expect(result.ok).toBe(true);
    const saved = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {games: Array<GameState>};
    const savedStaleGame = saved.games.find((game) => game.id === staleGameId);
    expect(savedStaleGame).toMatchObject({
      id: staleGameId,
      era: 'rail',
      turnOrder: ['p2', 'p1'],
      currentTurnIndex: 1,
      actionIndexInTurn: 0,
      pendingDecision: {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 3,
        incomePlayerIndex: 1,
      },
    });
    expect(savedStaleGame).not.toHaveProperty('variant');
    expect(JSON.stringify(saved)).not.toContain('secret-game-id');
  });

  it('normalizes stale runtime variants before applying and persisting commands', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const railIntro = store.create({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true});
    railIntro.era = 'rail';
    railIntro.actionsAllowedThisTurn = 2;
    const railIntroCardId = railIntro.players.p1.handCardIds[0];
    const railIntroSession = store.getPlayerSession(railIntro.id, 'p1');

    const railIntroResult = store.apply(
      railIntro.id,
      {type: 'pass', playerId: 'p1', cardId: railIntroCardId},
      railIntroSession?.token,
    );

    expect(railIntroResult.ok).toBe(true);
    expect(railIntroResult.state).not.toHaveProperty('variant');
    expect(store.get(railIntro.id)).not.toHaveProperty('variant');

    const secretVariant = store.create({playerNames: ['Cara', 'Dev'], seed: 6});
    (secretVariant as unknown as {variant?: string}).variant = 'secret_variant';
    const secretCardId = secretVariant.players.p1.handCardIds[0];
    const secretSession = store.getPlayerSession(secretVariant.id, 'p1');

    const secretResult = store.apply(
      secretVariant.id,
      {type: 'pass', playerId: 'p1', cardId: secretCardId},
      secretSession?.token,
    );

    expect(secretResult.ok).toBe(true);
    expect(secretResult.state).not.toHaveProperty('variant');
    expect(store.get(secretVariant.id)).not.toHaveProperty('variant');

    const saved = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {games: Array<Record<string, unknown>>};
    expect(saved.games.find((game) => game.id === railIntro.id)).not.toHaveProperty('variant');
    expect(saved.games.find((game) => game.id === secretVariant.id)).not.toHaveProperty('variant');

    const restored = new GameStore({storagePath});
    expect(restored.get(railIntro.id)).not.toHaveProperty('variant');
    expect(restored.get(secretVariant.id)).not.toHaveProperty('variant');
  });

  it('rejects commands without the matching player session token', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const p2Session = store.getPlayerSession(game.id, 'p2');

    expect(store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}).errors?.[0]).toContain('Invalid session');
    expect(store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, p2Session?.token).errors?.[0]).toContain('Invalid session');
  });

  it('rejects malformed command payloads without throwing or mutating the game', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const handBefore = [...game.players.p1.handCardIds];
    const arrayCommand = [] as unknown as {type: string; playerId: string; cardId: string};
    arrayCommand.type = 'pass';
    arrayCommand.playerId = 'p1';
    arrayCommand.cardId = game.players.p1.handCardIds[0];

    expect(store.apply(game.id, null, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.apply(game.id, {type: 'pass'}, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.apply(game.id, arrayCommand, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects uncloneable or throwing command payloads without leaking exceptions', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const discardBefore = [...game.players.p1.discardCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const throwingEnvelope = {
      get type() {
        throw new Error('unexpected getter');
      },
      playerId: 'p1',
      cardId,
    };
    const uncloneablePayload = {
      type: 'pass',
      playerId: 'p1',
      cardId,
      afterApply: () => undefined,
    };

    expect(() => store.apply(game.id, throwingEnvelope, session?.token)).not.toThrow();
    expect(store.apply(game.id, throwingEnvelope, session?.token)).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.apply(game.id, uncloneablePayload, session?.token)).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.players.p1.discardCardIds).toEqual(discardBefore);
  });

  it('rejects blank command envelope fields before session verification or rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    expect(store.apply(game.id, {
      type: 'pass',
      playerId: '   ',
      cardId,
    }, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Command playerId must be a non-empty string'],
    });
    expect(store.apply(game.id, {
      type: '\t',
      playerId: 'p1',
      cardId,
    }, session?.token)).toEqual({
      ok: false,
      errors: ['Command type must be a non-empty string'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('normalizes command envelope fields before session verification and rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(` ${game.id}\n`, {
      type: ' pass ',
      playerId: ' p1 ',
      cardId,
    }, ` ${session?.token ?? ''}\n`);

    expect(result.ok).toBe(true);
    expect(store.get(` ${game.id}\n`)?.currentTurnIndex).toBe(1);
    expect(store.get(game.id)?.players.p1.discardCardIds).toContain(cardId);
  });

  it('returns validation errors for malformed commands without mutating the game', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['missing-link-line'],
    }, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain('Unknown link line');
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toContain(cardId);
  });

  it('returns validation errors for unknown hand cards without mutating the stored game', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const unknownCardId = 'missing-card';
    game.players.p1.handCardIds = [unknownCardId];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId: unknownCardId}, session?.token);

    expect(result).toEqual({ok: false, errors: [`Unknown card: ${unknownCardId}`]});
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual([unknownCardId]);
    expect(store.get(game.id)?.players.p1.discardCardIds).not.toContain(unknownCardId);
  });

  it('rejects known command payloads with missing required fields before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['network command requires linkLineIds as a string array'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects blank required id fields before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: '   ',
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['pass command field cardId must be a non-empty string'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects blank id array entries before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const [firstCardId, _secondCardId, thirdCardId] = game.players.p1.handCardIds;
    const handBefore = [...game.players.p1.handCardIds];
    const discardBefore = [...game.players.p1.discardCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [firstCardId, '   ', thirdCardId],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['scout command field cardIds[1] must be a non-empty string'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.players.p1.discardCardIds).toEqual(discardBefore);
  });

  it('rejects impossible command array lengths before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const [cardId, secondCardId, thirdCardId, fourthCardId] = game.players.p1.handCardIds;
    const handBefore = [...game.players.p1.handCardIds];
    const discardBefore = [...game.players.p1.discardCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    expect(store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: [],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['network command field linkLineIds must contain at least 1 entry'],
    });
    expect(store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall', 'walsall-wolverhampton', 'coalbrookdale-wolverhampton'],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['network command field linkLineIds must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: [],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['develop command field industryTypes must contain at least 1 entry'],
    });
    expect(store.apply(game.id, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine', 'iron_works', 'manufacturer'],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['develop command field industryTypes must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'scout',
      playerId: 'p1',
      cardIds: [cardId, secondCardId, thirdCardId, fourthCardId],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['scout command field cardIds must contain exactly 3 entries'],
    });
    expect(store.apply(game.id, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['sell command field sales must contain at least 1 entry'],
    });
    expect(store.apply(game.id, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: Array.from(
        {length: staticConfig.components.industryTilesPerPlayer + 1},
        (_value, index) => `industry-${index}`,
      ),
    }, session?.token)).toEqual({
      ok: false,
      errors: [
        `resolve_negative_income command field industryInstanceIds must contain at most ${staticConfig.components.industryTilesPerPlayer} entries`,
      ],
    });
    expect(store.apply(game.id, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine', 'iron_works', 'manufacturer'],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['resolve_merchant_develop command field industryTypes must contain at most 2 entries'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.players.p1.discardCardIds).toEqual(discardBefore);
  });

  it('rejects impossible resource source array lengths before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const discardBefore = [...game.players.p1.discardCardIds];
    const session = store.getPlayerSession(game.id, 'p1');
    const coalSources = [
      {kind: 'market', market: 'coal', price: 1},
      {kind: 'market', market: 'coal', price: 2},
      {kind: 'market', market: 'coal', price: 3},
    ];
    const ironSources = [
      {kind: 'market', market: 'iron', price: 1},
      {kind: 'market', market: 'iron', price: 2},
      {kind: 'market', market: 'iron', price: 3},
    ];
    const beerSources = [
      {kind: 'industry_tile', industryInstanceId: 'brewery-1', resourceType: 'beer'},
      {kind: 'industry_tile', industryInstanceId: 'brewery-2', resourceType: 'beer'},
      {kind: 'industry_tile', industryInstanceId: 'brewery-3', resourceType: 'beer'},
    ];

    expect(store.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'coal_mine',
      coalSources,
    }, session?.token)).toEqual({
      ok: false,
      errors: ['build command field coalSources must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'manufacturer',
      ironSources,
    }, session?.token)).toEqual({
      ok: false,
      errors: ['build command field ironSources must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      coalSources,
    }, session?.token)).toEqual({
      ok: false,
      errors: ['network command field coalSources must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine'],
      ironSources,
    }, session?.token)).toEqual({
      ok: false,
      errors: ['develop command field ironSources must contain at most 2 entries'],
    });
    expect(store.apply(game.id, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{
        industryInstanceId: 'cotton-1',
        merchantSpaceId: 'oxford-0',
        beerSources,
      }],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['sell command field sales[0].beerSources must contain at most 2 entries'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.players.p1.discardCardIds).toEqual(discardBefore);
  });

  it('rejects malformed resource source payloads before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');
    const arraySource = [] as unknown as {kind: string; market: string; price: number};
    arraySource.kind = 'market';
    arraySource.market = 'coal';
    arraySource.price = 1;

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      coalSources: [{kind: 'market', market: 'coal', price: 'cheap'}],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['network command field coalSources[0].price must be a finite number'],
    });
    expect(store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      coalSources: [arraySource],
    }, session?.token)).toEqual({
      ok: false,
      errors: ['network command field coalSources[0] must be a resource source'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects resource sources whose resource type does not match the command field before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const discardBefore = [...game.players.p1.discardCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const coalResult = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      coalSources: [{kind: 'market', market: 'iron', price: 2}],
    }, session?.token);
    expect(coalResult).toEqual({
      ok: false,
      errors: ['network command field coalSources[0].market must be coal'],
    });

    const ironResult = store.apply(game.id, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine'],
      ironSources: [{kind: 'industry_tile', industryInstanceId: 'coal-1', resourceType: 'coal'}],
    }, session?.token);
    expect(ironResult).toEqual({
      ok: false,
      errors: ['develop command field ironSources[0].resourceType must be iron'],
    });

    const beerResult = store.apply(game.id, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{
        industryInstanceId: 'cotton-1',
        merchantSpaceId: 'oxford-0',
        beerSources: [{kind: 'market', market: 'iron', price: 2}],
      }],
    }, session?.token);
    expect(beerResult).toEqual({
      ok: false,
      errors: ['sell command sales[0].beerSources[0] cannot be a market source for beer'],
    });

    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.players.p1.discardCardIds).toEqual(discardBefore);
  });

  it('rejects blank nested resource source ids before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      beerSourceForDoubleRail: {
        kind: 'merchant_beer',
        merchantSpaceId: '   ',
        merchantTileInstanceId: '\t',
      },
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: [
        'network command field beerSourceForDoubleRail.merchantSpaceId must be a non-empty string',
        'network command field beerSourceForDoubleRail.merchantTileInstanceId must be a non-empty string',
      ],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects non-integer, negative, or impossible market resource prices before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    for (const price of [-1, 1.5]) {
      const result = store.apply(game.id, {
        type: 'network',
        playerId: 'p1',
        cardId,
        linkLineIds: ['birmingham-walsall'],
        coalSources: [{kind: 'market', market: 'coal', price}],
      }, session?.token);

      expect(result).toEqual({
        ok: false,
        errors: ['network command field coalSources[0].price must be a non-negative integer'],
      });
      expect(store.get(game.id)?.currentTurnIndex).toBe(0);
      expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    }

    const impossiblePriceResult = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      coalSources: [{kind: 'market', market: 'coal', price: 99}],
    }, session?.token);

    expect(impossiblePriceResult).toEqual({
      ok: false,
      errors: ['network command field coalSources[0].price must match a coal market price'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects invalid industry type payloads before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const buildResult = store.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'steel_mill',
    }, session?.token);
    expect(buildResult).toEqual({
      ok: false,
      errors: ['build command field industryType must be a valid industry type'],
    });

    const developResult = store.apply(game.id, {
      type: 'develop',
      playerId: 'p1',
      cardId,
      industryTypes: ['coal_mine', 'steel_mill'],
    }, session?.token);
    expect(developResult).toEqual({
      ok: false,
      errors: ['develop command field industryTypes[1] must be a valid industry type'],
    });

    game.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};
    const merchantDevelopResult = store.apply(game.id, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['steel_mill'],
    }, session?.token);
    expect(merchantDevelopResult).toEqual({
      ok: false,
      errors: ['resolve_merchant_develop command field industryTypes[0] must be a valid industry type'],
    });

    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    expect(store.get(game.id)?.board.industryInstances).toEqual({});
  });

  it('rejects malformed negative-income resolution payloads before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    game.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0};
    const pendingBefore = structuredClone(game.pendingDecision);
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: ['industry-1', 2],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['resolve_negative_income command requires industryInstanceIds as a string array'],
    });
    expect(store.get(game.id)?.pendingDecision).toEqual(pendingBefore);
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.board.industryInstances).toEqual({});
  });

  it('rejects malformed double rail beer source payloads before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['birmingham-walsall'],
      beerSourceForDoubleRail: {kind: 'merchant_beer', merchantSpaceId: 1},
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: [
        'network command field beerSourceForDoubleRail.merchantSpaceId must be a string',
        'network command field beerSourceForDoubleRail.merchantTileInstanceId must be a string',
      ],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
  });

  it('rejects malformed nested sell beer source payloads before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{
        industryInstanceId: 'cotton-1',
        merchantSpaceId: 'oxford-0',
        beerSources: [{kind: 'industry_tile', industryInstanceId: 1, resourceType: 'beer'}],
      }],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['sell command sales[0].beerSources[0].industryInstanceId must be a string'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects blank nested sell ids before rules execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const handBefore = [...game.players.p1.handCardIds];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{
        industryInstanceId: '   ',
        merchantSpaceId: '\t',
        beerSources: [{kind: 'industry_tile', industryInstanceId: '', resourceType: 'beer'}],
      }],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: [
        'sell command sales[0].industryInstanceId must be a non-empty string',
        'sell command sales[0].merchantSpaceId must be a non-empty string',
        'sell command sales[0].beerSources[0].industryInstanceId must be a non-empty string',
      ],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('normalizes nested sell command strings before applying through the store', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');
    const cotton = addIndustry(game, {
      id: 'industry-43',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(game, 'link-43', 'p1', 'birmingham-oxford');
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', true);

    const result = store.apply(game.id, {
      type: ' sell ',
      playerId: ' p1 ',
      cardId: ` ${cardId} `,
      sales: [{
        industryInstanceId: ` ${cotton.id} `,
        merchantSpaceId: ' oxford-0 ',
        beerSources: [{
          kind: ' merchant_beer ',
          merchantSpaceId: ' oxford-0 ',
          merchantTileInstanceId: ' oxford-cotton-0 ',
        }],
      }],
    }, ` ${session?.token ?? ''}\n`);

    expect(result.ok).toBe(true);
    expect(store.get(game.id)?.currentTurnIndex).toBe(1);
    expect(store.get(game.id)?.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(store.get(game.id)?.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(store.get(game.id)?.players.p1.discardCardIds).toContain(cardId);
    expect(store.get(game.id)?.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    });
  });

  it('leaves unknown command types to the shared rules validator', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'future_command',
      playerId: 'p1',
    }, session?.token);

    expect(result).toEqual({ok: false, errors: ['Unknown command']});
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
  });

  it('snapshots command payloads before validation and execution', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');
    let linkLineReads = 0;
    const command = {
      type: 'network',
      playerId: 'p1',
      cardId,
      get linkLineIds() {
        linkLineReads++;
        return linkLineReads <= 12
          ? ['birmingham-walsall']
          : ['birmingham-walsall', 'missing-link-line'];
      },
    };

    const result = store.apply(game.id, command, session?.token);

    expect(result.ok).toBe(true);
    expect(linkLineReads).toBe(1);
    expect(store.get(game.id)?.currentTurnIndex).toBe(1);
    expect(store.get(game.id)?.players.p1.handCardIds).not.toContain(cardId);
    expect(store.get(game.id)?.players.p1.remainingLinks.canal).toBe(13);
    expect(store.get(game.id)?.board.linkLines['birmingham-walsall'].occupiedBy).toEqual(expect.any(String));
    expect(store.get(game.id)?.board.linkLines['missing-link-line']).toBeUndefined();
    expect(Object.keys(store.get(game.id)?.board.linkInstances ?? {})).toHaveLength(1);
  });

  it('does not persist a failed command to disk', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['missing-link-line'],
    }, session?.token);

    expect(result.ok).toBe(false);

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    expect(restoredGame?.currentTurnIndex).toBe(0);
    expect(restoredGame?.players.p1.handCardIds).toContain(cardId);
    expect(restoredGame?.players.p1.discardCardIds).not.toContain(cardId);
    expect(Object.keys(restoredGame?.board.linkInstances ?? {})).toEqual([]);
  });

  it('rolls back in-memory state when persistence fails after a valid command', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain('disk full');
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toContain(cardId);
    expect(store.get(game.id)?.players.p1.discardCardIds).not.toContain(cardId);
    expect(fs.existsSync(`${storagePath}.tmp`)).toBe(false);

    const restored = new GameStore({storagePath});
    expect(restored.get(game.id)?.currentTurnIndex).toBe(0);
    expect(restored.get(game.id)?.players.p1.handCardIds).toContain(cardId);
    expect(restored.get(game.id)?.players.p1.discardCardIds).not.toContain(cardId);
  });

  it('preserves the original persistence error when temporary-file cleanup also fails', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });
    vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('cleanup failed');
    });

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain('rename failed');
    expect(result.errors?.[0]).not.toContain('cleanup failed');
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toContain(cardId);
    expect(store.get(game.id)?.players.p1.discardCardIds).not.toContain(cardId);
  });

  it('rejects commands after the game has ended even with a valid session', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');
    game.status = 'ended';

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Game is not active');
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toContain(cardId);
  });

  it.each([
    {playerNames: ['Ada', 'Ben'], playerCount: 2 as const},
    {playerNames: ['Ada', 'Ben', 'Cara'], playerCount: 3 as const},
    {playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], playerCount: 4 as const},
  ])('can advance a complete $playerCount-player game through the store session command path', ({playerNames, playerCount}) => {
    const store = new GameStore();
    const game = store.create({playerNames, seed: 5});
    const expectedCommandCount = getCardIdsForPlayerCount(playerCount).length * 2 - playerCount;
    let commandCount = 0;

    for (let step = 0; step < 200; step++) {
      const current = store.get(game.id);
      if (!current || current.status === 'ended') {
        break;
      }

      expect(current.pendingDecision).toBeUndefined();
      const playerId = getCurrentPlayerId(current);
      const cardId = current.players[playerId].handCardIds[0];
      expect(cardId).toEqual(expect.any(String));
      const session = store.getPlayerSession(game.id, playerId);

      const result = store.apply(game.id, {type: 'pass', playerId, cardId}, session?.token);

      expect(result.ok).toBe(true);
      commandCount++;
    }

    const ended = store.get(game.id);
    expect(commandCount).toBe(expectedCommandCount);
    expect(ended?.status).toBe('ended');
    expect(ended?.playerCount).toBe(playerCount);
    expect(ended?.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
    expect(ended?.eventLog.some((event) => event.type === 'era_ended' && event.era === 'rail')).toBe(true);
    expect(ended?.eventLog.some((event) => event.type === 'game_ended')).toBe(true);
  });

  it('persists games and reloads them from disk', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p1.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p1');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);
    expect(result.ok).toBe(true);

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    const restoredSession = restored.getPlayerSession(game.id, 'p1');
    expect(restoredGame?.players.p1.discardCardIds).toContain(cardId);
    expect(restoredGame?.currentTurnIndex).toBe(1);
    expect(restoredSession).toEqual(session);
    expect(restored.verifyPlayerSession(game.id, 'p1', session?.token)).toBe(true);
    expect(restored.list()).toEqual([
      {
        id: game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: restoredGame?.turnOrder[restoredGame.currentTurnIndex],
      },
    ]);
  });

  it('reports the persisted store path when saved JSON cannot be parsed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    fs.writeFileSync(storagePath, '{"version":1,');

    expect(() => new GameStore({storagePath})).toThrow(`Could not parse game store file ${storagePath}:`);
  });

  it('skips unrecoverable persisted game entries while loading the rest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const validGame = createGame({id: 'valid-load', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const onePlayerGame = createGame({id: 'one-player-corrupt', playerNames: ['Ada', 'Ben'], seed: 7, initialTurnOrder: ['p1', 'p2']});
    const blankIdGame = createGame({id: '   ', playerNames: ['Ada', 'Ben'], seed: 9, initialTurnOrder: ['p1', 'p2']});
    const missingSeatGame = createGame({id: 'missing-seat', playerNames: ['Ada', 'Ben'], seed: 11, initialTurnOrder: ['p1', 'p2']});
    delete onePlayerGame.players.p2;
    missingSeatGame.players.p3 = structuredClone(missingSeatGame.players.p2);
    missingSeatGame.players.p3.id = 'p3';
    delete missingSeatGame.players.p2;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [
        null,
        42,
        {id: 'missing-players'},
        blankIdGame,
        onePlayerGame,
        missingSeatGame,
        validGame,
      ],
      sessions: {
        [validGame.id]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
        ],
        [onePlayerGame.id]: [
          {playerId: 'p1', token: 'should-not-load'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});

    expect(restored.list()).toEqual([
      {
        id: validGame.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
      },
    ]);
    expect(restored.get(validGame.id)).toBeDefined();
    expect(restored.get('missing-players')).toBeUndefined();
    expect(restored.get(blankIdGame.id)).toBeUndefined();
    expect(restored.get(onePlayerGame.id)).toBeUndefined();
    expect(restored.get(missingSeatGame.id)).toBeUndefined();
    expect(restored.getPlayerSession(validGame.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(onePlayerGame.id, 'p1')).toBeUndefined();

    const p2Session = restored.getPlayerSession(validGame.id, 'p2');
    expect(p2Session?.token).toEqual(expect.any(String));
    expect(p2Session?.token).not.toBe('');
  });

  it('normalizes padded persisted game ids and preserves sessions under the legacy key', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const legacyGameId = '  legacy-padded-id  ';
    const normalizedGameId = 'legacy-padded-id';
    const game = createGame({id: legacyGameId, playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [legacyGameId]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
        ],
        [normalizedGameId]: [
          {playerId: 'p1', token: 'normalized-key-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(normalizedGameId);
    const session = restored.getPlayerSession(normalizedGameId, 'p1');

    expect(restored.get(legacyGameId)?.id).toBe(normalizedGameId);
    expect(restored.list()).toEqual([
      expect.objectContaining({id: normalizedGameId, playerNames: ['Ada', 'Ben'], playerCount: 2}),
    ]);
    expect(restoredGame?.id).toBe(normalizedGameId);
    expect(restoredGame?.eventLog).toContainEqual({
      type: 'game_created',
      gameId: normalizedGameId,
      playerIds: ['p1', 'p2'],
    });
    expect(session).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.verifyPlayerSession(normalizedGameId, 'p1', 'normalized-key-token')).toBe(false);

    const cardId = restoredGame?.players.p1.handCardIds[0];
    const result = restored.apply(normalizedGameId, {
      type: 'pass',
      playerId: 'p1',
      cardId,
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(normalizedGameId)?.players.p1.discardCardIds).toContain(cardId);
  });

  it('skips duplicate persisted games after id normalization', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const normalizedGame = createGame({id: 'duplicate-room', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const paddedDuplicate = createGame({id: ' duplicate-room ', playerNames: ['Cara', 'Dev'], seed: 7, initialTurnOrder: ['p1', 'p2']});

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [normalizedGame, paddedDuplicate],
      sessions: {
        [normalizedGame.id]: [
          {playerId: 'p1', token: 'first-p1-token'},
        ],
        [paddedDuplicate.id]: [
          {playerId: 'p1', token: 'duplicate-p1-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});

    expect(restored.list()).toEqual([
      expect.objectContaining({
        id: 'duplicate-room',
        playerNames: ['Ada', 'Ben'],
      }),
    ]);
    expect(restored.get('duplicate-room')?.players.p1.name).toBe('Ada');
    expect(restored.getPlayerSession('duplicate-room', 'p1')).toEqual({playerId: 'p1', token: 'first-p1-token'});
    expect(restored.verifyPlayerSession('duplicate-room', 'p1', 'duplicate-p1-token')).toBe(false);
  });

  it('normalizes persisted player sessions to valid seats and fills missing tokens', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-sessions', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: ' p1 ', token: ' persisted-p1-token '},
          {playerId: 'p1', token: 'duplicate-p1-token'},
          {playerId: ' p2 ', token: '   '},
          {playerId: 'p3', token: 'ghost-seat-token'},
          {playerId: 'p2', token: 42},
          null,
        ],
      },
    }));

    const restored = new GameStore({storagePath});

    expect(restored.getPlayerSessions(game.id).map((session) => session.playerId).sort()).toEqual(['p1', 'p2']);
    expect(restored.getPlayerSessions(` ${game.id}\n`).map((session) => session.playerId).sort()).toEqual(['p1', 'p2']);
    expect(restored.getPlayerSession(game.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(` ${game.id}\n`, ' p1 ')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.verifyPlayerSession(game.id, 'p1', 'persisted-p1-token')).toBe(true);
    expect(restored.verifyPlayerSession(` ${game.id}\n`, ' p1 ', 'persisted-p1-token')).toBe(true);
    expect(restored.verifyPlayerSession(game.id, 'p1', ' persisted-p1-token ')).toBe(true);
    expect(restored.verifyPlayerSession(game.id, 'p1', 'duplicate-p1-token')).toBe(false);
    expect(restored.getPlayerSession(game.id, 'p3')).toBeUndefined();

    const p2Session = restored.getPlayerSession(game.id, 'p2');
    expect(p2Session?.token).toEqual(expect.any(String));
    expect(p2Session?.token).not.toBe('');
    expect(p2Session?.token).not.toBe('ghost-seat-token');
  });

  it('preserves the active player when normalizing stale turn order from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-turn-order', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.turnOrder = ['ghost', 'p2', 'p2', 'p1'];
    game.currentTurnIndex = 3;
    game.roundNumber = 2;
    game.actionsAllowedThisTurn = 2;
    game.actionIndexInTurn = 99;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
          {playerId: 'p2', token: 'persisted-p2-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    const cardId = restoredGame?.players.p1.handCardIds[0];

    expect(restoredGame?.turnOrder).toEqual(['p2', 'p1']);
    expect(restoredGame?.currentTurnIndex).toBe(1);
    expect(restoredGame ? getCurrentPlayerId(restoredGame) : undefined).toBe('p1');
    expect(restoredGame?.actionIndexInTurn).toBe(1);
    expect(restored.list()[0]).toMatchObject({currentPlayerId: 'p1'});

    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId,
    }, 'persisted-p1-token');

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.players.p1.discardCardIds).toContain(cardId);
  });

  it('normalizes stale first Canal round action limits from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-first-canal-actions', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.actionsAllowedThisTurn = 2;
    game.actionIndexInTurn = 1;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
          {playerId: 'p2', token: 'persisted-p2-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    const cardId = restoredGame?.players.p1.handCardIds[0];

    expect(restoredGame?.era).toBe('canal');
    expect(restoredGame?.roundNumber).toBe(1);
    expect(restoredGame?.actionsAllowedThisTurn).toBe(1);
    expect(restoredGame?.actionIndexInTurn).toBe(0);

    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId,
    }, 'persisted-p1-token');

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.currentTurnIndex).toBe(1);
    expect(restored.get(game.id)?.actionIndexInTurn).toBe(0);
  });

  it('normalizes stale Rail round action limits from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-rail-actions', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.era = 'rail';
    game.roundNumber = 1;
    game.actionsAllowedThisTurn = 1;
    game.actionIndexInTurn = 0;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    const cardId = restoredGame?.players.p1.handCardIds[0];

    expect(restoredGame?.actionsAllowedThisTurn).toBe(2);
    expect(restoredGame?.actionIndexInTurn).toBe(0);

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId,
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.currentTurnIndex).toBe(0);
    expect(restored.get(game.id)?.actionIndexInTurn).toBe(1);
  });

  it('lists player names in stable seat order instead of current turn order', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.turnOrder = ['p3', 'p1', 'p2'];
    game.status = 'ended';
    game.players.p2.victoryPoints = 9;
    game.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 7, incomePlayerIndex: 1};

    expect(store.list()).toEqual([
      {
        id: game.id,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        playerNames: ['Ada', 'Ben', 'Cara'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'ended',
        winners: ['p2'],
        victoryPointsByPlayer: {p1: 0, p2: 9, p3: 0},
      },
    ]);
  });

  it('lists public active-player and pending-decision summaries without private state', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    game.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 7, incomePlayerIndex: 1};

    const summary = store.list()[0];

    expect(summary).toEqual({
      id: game.id,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: game.turnOrder[game.currentTurnIndex],
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    });
    expect(summary).not.toHaveProperty('players');
    expect(summary).not.toHaveProperty('cardZones');
    expect(summary).not.toHaveProperty('sessions');
    expect(JSON.stringify(summary)).not.toContain(game.players.p1.handCardIds[0]);
    expect(JSON.stringify(summary)).not.toContain('amountOwed');
  });

  it('lists public ended results without private event details', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    game.status = 'ended';
    game.players.p1.victoryPoints = 20;
    game.players.p1.incomeTrackPosition = 9;
    game.players.p2.victoryPoints = 20;
    game.players.p2.incomeTrackPosition = 7;
    game.eventLog.push({type: 'game_ended', winners: ['p1']});
    game.eventLog.push({type: 'game_ended', winners: ['p2']} as unknown as GameState['eventLog'][number]);
    game.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 7, incomePlayerIndex: 1};

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toEqual({
      id: game.id,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'ended',
      winners: ['p1'],
      victoryPointsByPlayer: {p1: 20, p2: 20},
    });
    expect(summary).not.toHaveProperty('currentPlayerId');
    expect(summary).not.toHaveProperty('pendingDecision');
    expect(summary).not.toHaveProperty('eventLog');
    expect(JSON.stringify(summary)).not.toContain(game.players.p1.handCardIds[0]);
    expect(JSON.stringify(summary)).not.toContain('amountOwed');
  });

  it('lists multiplayer ended winners from final standings instead of stale ended events', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.status = 'ended';
    game.players.p1.victoryPoints = 40;
    game.players.p2.victoryPoints = 41;
    game.players.p3.victoryPoints = 41;
    game.players.p1.incomeTrackPosition = 10;
    game.players.p2.incomeTrackPosition = 12;
    game.players.p3.incomeTrackPosition = 12;
    game.players.p2.cash = 7;
    game.players.p3.cash = 7;
    game.eventLog.push({type: 'game_ended', winners: ['p1']});
    game.eventLog.push({type: 'game_ended', winners: ['p2', 'p3']});

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: game.id,
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      status: 'ended',
      winners: ['p2', 'p3'],
      victoryPointsByPlayer: {p1: 40, p2: 41, p3: 41},
    });
    expect(summary).not.toHaveProperty('eventLog');
    expect(JSON.stringify(summary)).not.toContain(game.players.p1.handCardIds[0]);
  });

  it('normalizes public active-player and pending-decision summaries from dirty runtime turn state', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.turnOrder = ['ghost-player', ' p2 ', 'p2'];
    game.currentTurnIndex = 1;
    game.pendingDecision = {
      type: 'negative_income',
      playerId: ' p2 ',
      amountOwed: 7.9,
      incomePlayerIndex: 0,
    } as unknown as GameState['pendingDecision'];

    const summary = store.list()[0];

    expect(summary).toMatchObject({
      id: game.id,
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      status: 'playing',
      currentPlayerId: 'p2',
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    });
  });

  it('normalizes public list summary core fields from dirty runtime state', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.playerCount = 99 as GameState['playerCount'];
    game.roundNumber = 0;
    game.era = 'secret-era' as GameState['era'];
    game.status = 'secret-status' as GameState['status'];

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: game.id,
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p1',
    });
    expect(JSON.stringify(summary)).not.toContain('secret-era');
    expect(JSON.stringify(summary)).not.toContain('secret-status');
  });

  it('normalizes public list player names from dirty runtime state', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.players.p1.name = ' Ada\n';
    game.players.p2.name = '   ';
    (game.players.p3 as unknown as {name: unknown}).name = {secret: 'secret-token'};

    const summary = store.list()[0];

    expect(summary.playerNames).toEqual(['Ada', 'Player 2', 'Player 3']);
    expect(JSON.stringify(summary)).not.toContain('secret-token');
  });

  it('falls back to the public turn order while omitting invalid runtime pending-decision summaries from public lists', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    game.turnOrder = ['ghost', 'p2'];
    game.currentTurnIndex = 0;
    (game as unknown as {pendingDecision: unknown}).pendingDecision = {
      type: 'secret-decision',
      playerId: 'p1',
      sessionToken: 'secret-token',
    };

    const summary = store.list()[0] as unknown as Record<string, unknown>;

    expect(summary).toMatchObject({
      id: game.id,
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p2',
    });
    expect(summary).not.toHaveProperty('pendingDecision');
    expect(JSON.stringify(summary)).not.toContain('secret-token');
    expect(JSON.stringify(summary)).not.toContain('secret-decision');
  });

  it('omits malformed runtime pending-decision summaries from public lists', () => {
    const store = new GameStore();
    const negativeIncomeGame = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    negativeIncomeGame.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 0,
      incomePlayerIndex: 0,
    };
    const merchantGame = store.create({playerNames: ['Cara', 'Dan'], seed: 7});
    merchantGame.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'oxford-0',
    };

    const summaries = store.list();
    const negativeIncomeSummary = summaries.find((summary) => summary.id === negativeIncomeGame.id);
    const merchantSummary = summaries.find((summary) => summary.id === merchantGame.id);

    expect(negativeIncomeSummary).not.toHaveProperty('pendingDecision');
    expect(merchantSummary).not.toHaveProperty('pendingDecision');
  });

  it('rolls back in-memory state when persistence fails during game creation', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() => store.create({playerNames: ['Ada', 'Ben'], seed: 5})).toThrow('disk full');

    expect(store.list()).toEqual([]);
    expect(store.getPlayerSessions('missing-game')).toEqual([]);
    expect(fs.existsSync(storagePath)).toBe(false);
    expect(fs.existsSync(`${storagePath}.tmp`)).toBe(false);
  });

  it('rejects invalid seeds during game creation without mutating the store', () => {
    const store = new GameStore();

    expect(() => store.create({
      playerNames: ['Ada', 'Ben'],
      seed: Number.POSITIVE_INFINITY,
    })).toThrow('Game seed must be a finite number');

    expect(() => store.create({
      playerNames: ['Ada', 'Ben'],
      seed: 1.5,
    })).toThrow('Game seed must be an integer');

    expect(store.list()).toEqual([]);
  });

  it('normalizes loaded sessions to the players in the saved game', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'saved-game', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
          {playerId: 'ghost-player', token: 'ghost-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const sessions = restored.getPlayerSessions(game.id);

    expect(sessions).toHaveLength(2);
    expect(restored.getPlayerSession(game.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(game.id, 'ghost-player')).toBeUndefined();
    const p2Session = restored.getPlayerSession(game.id, 'p2');
    expect(p2Session?.token).toEqual(expect.any(String));
    expect(p2Session?.token).not.toBe('');
    expect(restored.verifyPlayerSession(game.id, 'p2', p2Session?.token)).toBe(true);
  });

  it('returns defensive player session copies from accessors', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const originalP1Session = store.getPlayerSession(game.id, 'p1');
    const originalP2Session = store.getPlayerSession(game.id, 'p2');
    if (!originalP1Session || !originalP2Session) {
      throw new Error('Expected player sessions');
    }
    const originalP1Token = originalP1Session.token;

    const listedSessions = store.getPlayerSessions(game.id);
    const listedP1Session = listedSessions.find((session) => session.playerId === 'p1');
    if (!listedP1Session) {
      throw new Error('Expected listed p1 session');
    }

    listedSessions.length = 0;
    listedP1Session.playerId = 'p2';
    listedP1Session.token = 'mutated-token';
    originalP1Session.token = 'mutated-token';

    expect(store.getPlayerSessions(game.id)).toEqual([
      {playerId: 'p1', token: originalP1Token},
      {playerId: 'p2', token: originalP2Session.token},
    ]);
    expect(store.verifyPlayerSession(game.id, 'p1', 'mutated-token')).toBe(false);
    expect(store.verifyPlayerSession(game.id, 'p1', originalP1Token)).toBe(true);
    expect(store.verifyPlayerSession(game.id, 'p2', originalP2Session.token)).toBe(true);
  });

  it('filters runtime session maps to current valid seats before exposing or persisting tokens', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const store = new GameStore({storagePath});
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const p1Session = store.getPlayerSession(game.id, 'p1');
    const p2Session = store.getPlayerSession(game.id, 'p2');
    if (!p1Session || !p2Session) {
      throw new Error('Expected player sessions');
    }

    const sessionStore = store as unknown as {sessions: Map<string, Map<string, string>>};
    sessionStore.sessions.get(game.id)?.set('p5', 'p5-token');
    sessionStore.sessions.get(game.id)?.set('ghost-player', 'ghost-token');

    expect(store.getPlayerSessions(game.id)).toEqual([
      {playerId: 'p1', token: p1Session.token},
      {playerId: 'p2', token: p2Session.token},
    ]);
    expect(store.getPlayerSession(game.id, 'p5')).toBeUndefined();
    expect(store.getPlayerSession(game.id, 'ghost-player')).toBeUndefined();
    expect(store.verifyPlayerSession(game.id, 'p5', 'p5-token')).toBe(false);
    expect(store.verifyPlayerSession(game.id, 'ghost-player', 'ghost-token')).toBe(false);

    const result = store.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: game.players.p1.handCardIds[0],
    }, p1Session.token);
    expect(result.ok).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {
      sessions?: Record<string, {playerId: string; token: string}[]>;
    };
    expect(persisted.sessions?.[game.id]).toEqual([
      {playerId: 'p1', token: p1Session.token},
      {playerId: 'p2', token: p2Session.token},
    ]);
  });

  it('ignores blank and duplicate persisted sessions while restoring valid player sessions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-duplicate-sessions', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p2', token: '  persisted-p2-token \n'},
          {playerId: 'p2', token: '   '},
          {playerId: 'p1', token: 'persisted-p1-token'},
          {playerId: 'p1', token: 'overwriting-p1-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const p1Session = restored.getPlayerSession(game.id, 'p1');
    const p2Session = restored.getPlayerSession(game.id, 'p2');

    expect(p1Session).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.verifyPlayerSession(game.id, 'p1', 'persisted-p1-token')).toBe(true);
    expect(restored.verifyPlayerSession(game.id, 'p1', 'overwriting-p1-token')).toBe(false);
    expect(p2Session).toEqual({playerId: 'p2', token: 'persisted-p2-token'});
    expect(restored.verifyPlayerSession(game.id, 'p2', 'persisted-p2-token')).toBe(true);
    expect(restored.verifyPlayerSession(game.id, 'p2', '  persisted-p2-token \n')).toBe(true);
    expect(restored.getPlayerSessions(game.id)).toEqual([
      {playerId: 'p1', token: 'persisted-p1-token'},
      {playerId: 'p2', token: 'persisted-p2-token'},
    ]);
  });

  it('replaces duplicate persisted session tokens so seats cannot share credentials', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-shared-session-token', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p1', token: 'shared-token'},
          {playerId: 'p2', token: 'shared-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const p1Session = restored.getPlayerSession(game.id, 'p1');
    const p2Session = restored.getPlayerSession(game.id, 'p2');

    expect(p1Session).toEqual({playerId: 'p1', token: 'shared-token'});
    expect(p2Session?.playerId).toBe('p2');
    expect(p2Session?.token).toEqual(expect.any(String));
    expect(p2Session?.token).not.toBe('');
    expect(p2Session?.token).not.toBe('shared-token');
    expect(restored.verifyPlayerSession(game.id, 'p1', 'shared-token')).toBe(true);
    expect(restored.verifyPlayerSession(game.id, 'p2', 'shared-token')).toBe(false);
    expect(restored.verifyPlayerSession(game.id, 'p2', p2Session?.token)).toBe(true);
  });

  it('normalizes loaded player count and player basics from persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-player-count', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.playerCount = 4;
    game.players.p1.id = 'wrong-id';
    game.players.p1.name = '  Ada  ';
    game.players.p1.color = 'not-a-player-color' as GameState['players'][string]['color'];
    game.players.p1.handCardIds = 'not-an-array' as unknown as string[];
    game.players.p2.name = '';
    delete (game.players.p2 as Partial<GameState['players'][string]>).color;
    game.players.p2.discardCardIds = null as unknown as string[];
    (game.players as unknown as Record<string, unknown>).ghost = {
      ...structuredClone(game.players.p1),
      id: 'ghost',
      name: 'Ghost',
    };
    (game.players as unknown as Record<string, unknown>).p5 = {
      ...structuredClone(game.players.p1),
      id: 'p5',
      name: 'Player 5',
    };
    const legacyP1 = game.players.p1;
    const legacyP2 = game.players.p2;
    delete (game.players as Partial<GameState['players']>).p1;
    delete (game.players as Partial<GameState['players']>).p2;
    (game.players as unknown as Record<string, unknown>)[' p1 '] = legacyP1;
    (game.players as unknown as Record<string, unknown>)['\tp2\n'] = legacyP2;
    game.board.merchantSpaces = {
      ...game.board.merchantSpaces,
      'nottingham-0': {id: 'nottingham-0', merchantTileInstanceId: 'nottingham-cotton-0', beerPresent: true},
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
      sessions: {
        [game.id]: [
          {playerId: 'p1', token: 'persisted-p1-token'},
          {playerId: 'p2', token: 'persisted-p2-token'},
          {playerId: 'ghost', token: 'ghost-token'},
          {playerId: 'p5', token: 'p5-token'},
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.playerCount).toBe(2);
    expect(Object.keys(restoredGame?.players ?? {})).toEqual(['p1', 'p2']);
    expect(restoredGame?.players.p1.id).toBe('p1');
    expect(restoredGame?.players.p1.name).toBe('Ada');
    expect(restoredGame?.players.p1.color).toBe('orange');
    expect(restoredGame?.players.p1.handCardIds).toEqual([]);
    expect(restoredGame?.players.p2.id).toBe('p2');
    expect(restoredGame?.players.p2.name).toBe('Player 2');
    expect(restoredGame?.players.p2.color).toBe('yellow');
    expect(restoredGame?.players.p2.discardCardIds).toEqual([]);
    expect(Object.keys(restoredGame?.board.merchantSpaces ?? {}).sort()).toEqual(expectedMerchantSpaceIds(2));
    expect(restored.getPlayerSessions(game.id).map((session) => session.playerId).sort()).toEqual(['p1', 'p2']);
    expect(restored.getPlayerSession(game.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(game.id, 'ghost')).toBeUndefined();
    expect(restored.getPlayerSession(game.id, 'p5')).toBeUndefined();

    const regularCards = regularCardsInZones(restoredGame as GameState);
    expect(regularCards.sort()).toEqual([...getCardIdsForPlayerCount(2)].sort());
    expectUnique(regularCards);
  });

  it('normalizes stale event logs from persisted games before applying commands', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-event-log', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.coal_mine.removedSpecIds = ['coal_mine-1-1'];
    const liquidatedIndustry = addIndustry(game, {
      id: 'industry-42',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    liquidatedIndustry.removedFromGame = true;
    game.board.slots[liquidatedIndustry.slotId] = {};
    const soldIndustry = addIndustry(game, {
      id: 'industry-8',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: true,
    });
    const unflippedCotton = addIndustry(game, {
      id: 'industry-11',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'coventry',
      slotId: 'coventry-0',
    });
    const coalIndustry = addIndustry(game, {
      id: 'industry-9',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 1,
    });
    const brewery = addIndustry(game, {
      id: 'industry-10',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'walsall',
      slotId: 'walsall-1',
      remainingResource: 1,
    });
    const merchantSpaceId = 'gloucester-0';
    game.board.merchantSpaces[merchantSpaceId] = {
      id: merchantSpaceId,
      merchantTileInstanceId: 'gloucester-cotton-0',
      beerPresent: true,
    };
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-manufacturer-0',
      beerPresent: false,
    };
    game.board.merchantSpaces['oxford-1'] = {
      id: 'oxford-1',
      merchantTileInstanceId: 'blank-2p-0',
      beerPresent: true,
    };
    const merchantTileInstanceId = game.board.merchantSpaces[merchantSpaceId]?.merchantTileInstanceId;
    if (!merchantTileInstanceId) {
      throw new Error('Expected Gloucester merchant tile');
    }
    const originalGameCreated = structuredClone(game.eventLog[0]) as Extract<GameState['eventLog'][number], {type: 'game_created'}>;
    originalGameCreated.gameId = 'stale-game-id';
    originalGameCreated.playerIds = ['p2', 'ghost', 'p2'];
    const legacyDiscardCardId = game.players.p1.handCardIds[1];
    const legacyWildCardId = game.cardZones.wildLocationPool[0];
    const dirtyRegularDiscard = {type: 'card_discarded', playerId: ' p1 ', cardId: ` ${legacyDiscardCardId} `, destination: 'wild_pool'};
    const dirtyWildDiscard = {type: 'card_discarded', playerId: 'p1', cardId: legacyWildCardId, destination: 'discard'};
    const invalidDiscard = {type: 'card_discarded', playerId: 'p1', cardId: 'secret-token', destination: 'discard'};
    const dirtyLoan = {type: 'loan_taken', playerId: '\tp2\n', sessionToken: 'secret-token'};
    const invalidLoan = {type: 'loan_taken', playerId: 'ghost'};
    const dirtyScout = {type: 'scouted', playerId: ' p1 ', sessionToken: 'secret-token'};
    const invalidScout = {type: 'scouted', playerId: '   '};
    const dirtyCashChange = {type: 'cash_changed', playerId: ' p1 ', delta: -5, reason: ' build ', sessionToken: 'secret-token'};
    const validMarketSaleCashChange = {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'sold coal to market'};
    const invalidMarketSaleCashChange = {type: 'cash_changed', playerId: 'p1', delta: 99, reason: 'sold coal to market'};
    const validMerchantBonusCashChange = {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'};
    const invalidMerchantBonusCashChange = {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'};
    const invalidCashChange = {type: 'cash_changed', playerId: 'p1', delta: 1.5, reason: 'secret-token'};
    const mismatchedCashChange = {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'build'};
    const zeroCashChange = {type: 'cash_changed', playerId: 'p1', delta: 0, reason: 'income'};
    const invalidIncomeCashChange = {type: 'cash_changed', playerId: 'p1', delta: staticConfig.incomeTrack.maxIncomeLevel + 1, reason: 'income'};
    const invalidNegativeIncomeLiquidationCashChange = {
      type: 'cash_changed',
      playerId: 'p1',
      delta: Math.floor(staticConfig.industryTileSpecs['pottery-5-1'].cost.cash / 2) + 1,
      reason: 'negative income liquidation',
    };
    const loanFromPosition = staticConfig.incomeTrack.startPosition;
    const loanToPosition = retreatIncomeLevels(loanFromPosition, staticConfig.rules.loanIncomeLevelPenalty);
    const dirtyIncomeChange = {type: 'income_position_changed', playerId: '\tp1\n', from: 9, to: 12, reason: 'sold cotton_mill'};
    const invalidIndustryIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: advanceIncomeSpaces(loanFromPosition, 1), reason: 'sold cotton_mill'};
    const validLoanIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: loanToPosition, reason: 'loan'};
    const validMerchantBonusIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: advanceIncomeSpaces(loanFromPosition, 2), reason: 'merchant bonus'};
    const invalidMerchantBonusIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: advanceIncomeSpaces(loanFromPosition, 1), reason: 'merchant bonus'};
    const invalidIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: 9, to: 12.5, reason: 'income'};
    const mismatchedIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: 12, to: 9, reason: 'sold cotton_mill'};
    const mismatchedLoanIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: retreatIncomeLevels(loanFromPosition, 2), reason: 'loan'};
    const outOfRangeIncomeChange = {type: 'income_position_changed', playerId: 'p1', from: -1, to: 12, reason: 'sold cotton_mill'};
    const dirtyIndustryBuilt = {
      type: 'industry_built',
      instance: {
        id: ' industry-77 ',
        ownerPlayerId: ' p1 ',
        industryType: ' cotton_mill ',
        specId: ' cotton_mill-1-1 ',
        level: 99,
        locationId: ' worcester ',
        slotId: ' worcester-0 ',
        flipped: false,
        remainingResource: 99,
        removedFromGame: false,
        sessionToken: 'secret-token',
      },
      sessionToken: 'secret-token',
    };
    const invalidIndustryBuilt = {
      type: 'industry_built',
      instance: {
        id: 'secret-token',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        level: 1,
        locationId: 'worcester',
        slotId: 'worcester-0',
        flipped: false,
        remainingResource: 0,
        removedFromGame: false,
      },
    };
    const dirtyIndustryRemoved = {type: 'industry_removed', industryInstanceId: ' industry-42 ', reason: ' negative_income ', sessionToken: 'secret-token'};
    const invalidIndustryRemoved = {type: 'industry_removed', industryInstanceId: 'secret-token', reason: 'negative_income'};
    const activeIndustryRemoved = {type: 'industry_removed', industryInstanceId: coalIndustry.id, reason: 'overbuild'};
    const dirtyIndustryFlipped = {type: 'industry_flipped', industryInstanceId: ' industry-8 ', ownerPlayerId: ' p1 ', sessionToken: 'secret-token'};
    const invalidIndustryFlipped = {type: 'industry_flipped', industryInstanceId: soldIndustry.id, ownerPlayerId: 'p2'};
    const unflippedIndustryFlipped = {type: 'industry_flipped', industryInstanceId: coalIndustry.id, ownerPlayerId: 'p2'};
    const dirtyIndustrySold = {
      type: 'industry_sold',
      industryInstanceId: ' industry-8 ',
      ownerPlayerId: ' p1 ',
      merchantSpaceId: ` ${merchantSpaceId} `,
      sessionToken: 'secret-token',
    };
    const invalidIndustrySold = {type: 'industry_sold', industryInstanceId: soldIndustry.id, ownerPlayerId: 'p1', merchantSpaceId: 'secret-token'};
    const mismatchedMerchantIndustrySold = {
      type: 'industry_sold',
      industryInstanceId: soldIndustry.id,
      ownerPlayerId: 'p1',
      merchantSpaceId: 'oxford-0',
    };
    const unflippedIndustrySold = {
      type: 'industry_sold',
      industryInstanceId: unflippedCotton.id,
      ownerPlayerId: 'p1',
      merchantSpaceId,
    };
    const dirtyResourceConsumed = {
      type: 'resource_consumed',
      source: {kind: ' industry_tile ', industryInstanceId: ` ${brewery.id} `, resourceType: ' beer ', sessionToken: 'secret-token'},
      byPlayerId: ' p2 ',
      reason: ' sell ',
      sessionToken: 'secret-token',
    };
    const invalidResourceConsumed = {
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: 'secret-token', resourceType: 'beer'},
      byPlayerId: 'p2',
      reason: 'sell',
    };
    const invalidMerchantBeerNetworkConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId, merchantTileInstanceId},
      byPlayerId: 'p2',
      reason: 'network',
    };
    const invalidBlankMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-1', merchantTileInstanceId: 'blank-2p-0'},
      byPlayerId: 'p2',
      reason: 'sell',
    };
    const invalidCoalSellConsumed = {
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: coalIndustry.id, resourceType: 'coal'},
      byPlayerId: 'p2',
      reason: 'sell',
    };
    const invalidIronNetworkConsumed = {
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0]},
      byPlayerId: 'p2',
      reason: 'network',
    };
    const dirtyResourceSoldToMarket = {
      type: 'resource_sold_to_market',
      industryInstanceId: ` ${coalIndustry.id} `,
      market: ' coal ',
      cashReceived: 4,
      sessionToken: 'secret-token',
    };
    const invalidResourceSoldToMarket = {
      type: 'resource_sold_to_market',
      industryInstanceId: soldIndustry.id,
      market: 'coal',
      cashReceived: 4,
    };
    const invalidResourceSoldToMarketPrice = {
      type: 'resource_sold_to_market',
      industryInstanceId: coalIndustry.id,
      market: 'coal',
      cashReceived: 99,
    };
    const dirtyLinkBuilt = {
      type: 'link_built',
      instance: {
        id: ' link-123 ',
        ownerPlayerId: ' p1 ',
        linkType: ' canal ',
        linkLineId: ' birmingham-oxford ',
        sessionToken: 'secret-token',
      },
      sessionToken: 'secret-token',
    };
    const invalidLinkBuilt = {
      type: 'link_built',
      instance: {id: 'secret-token', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-walsall'},
    };
    const inactiveLinkBuilt = {
      type: 'link_built',
      instance: {id: 'link-999', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'stokeOnTrent-warrington'},
    };
    const dirtyLinkScored = {type: 'link_scored', linkInstanceId: ' link-123 ', ownerPlayerId: ' p1 ', points: 2, sessionToken: 'secret-token'};
    const mismatchedLinkScored = {type: 'link_scored', linkInstanceId: 'link-123', ownerPlayerId: 'p1', points: 99};
    const invalidLinkScored = {type: 'link_scored', linkInstanceId: 'link-123', ownerPlayerId: 'p2', points: 2};
    const inactiveLinkScored = {type: 'link_scored', linkInstanceId: 'link-999', ownerPlayerId: 'p1', points: 2};
    const dirtyIndustryScored = {type: 'industry_scored', industryInstanceId: ' industry-42 ', ownerPlayerId: ' p1 ', points: 5, sessionToken: 'secret-token'};
    const invalidIndustryScored = {type: 'industry_scored', industryInstanceId: soldIndustry.id, ownerPlayerId: 'p2', points: 5};
    const mismatchedIndustryScored = {type: 'industry_scored', industryInstanceId: 'industry-42', ownerPlayerId: 'p1', points: 99};
    const unflippedIndustryScored = {
      type: 'industry_scored',
      industryInstanceId: coalIndustry.id,
      ownerPlayerId: 'p2',
      points: staticConfig.industryTileSpecs[coalIndustry.specId].flip.victoryPoints,
    };
    const validMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {
        kind: ' merchant_beer ',
        merchantSpaceId: ` ${merchantSpaceId} `,
        merchantTileInstanceId: ` ${merchantTileInstanceId} `,
      },
      byPlayerId: ' p1 ',
      reason: ' sell ',
    };
    const dirtyMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: ' p2 ',
      merchantSpaceId: ` ${merchantSpaceId} `,
      bonus: {type: ' develop ', count: 1, sessionToken: 'secret-token'},
      sessionToken: 'secret-token',
    };
    const invalidMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p2',
      merchantSpaceId: merchantSpaceId,
      bonus: {type: 'cash', cash: -1},
    };
    const mismatchedMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p2',
      merchantSpaceId,
      bonus: {type: 'income_spaces', spaces: 2},
    };
    const validMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId,
      bonus: {type: 'develop', count: 1},
    };
    const dirtyMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: ' p1 ',
      merchantSpaceId: ` ${merchantSpaceId} `,
      merchantSpaceIds: [` ${merchantSpaceId} `, merchantSpaceId],
      industryTypes: [' cotton_mill ', ' coal_mine '],
      specIds: [' cotton_mill-1-1 ', ' coal_mine-1-1 '],
      sessionToken: 'secret-token',
    };
    const legacyMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId,
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const emptyMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId,
      merchantSpaceIds: [],
      industryTypes: [],
      specIds: [],
    };
    const nonDevelopMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'oxford-0',
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const mixedMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId,
      merchantSpaceIds: [merchantSpaceId, 'oxford-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const unremovedSpecMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId,
      merchantSpaceIds: [merchantSpaceId],
      industryTypes: ['iron_works'],
      specIds: ['iron_works-1-1'],
    };
    const invalidMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId,
      merchantSpaceIds: [merchantSpaceId],
      industryTypes: ['cotton_mill'],
      specIds: ['secret-token'],
    };
    const dirtyVictoryPointChange = {type: 'victory_points_changed', playerId: ' p2 ', delta: 4, reason: ' link scoring '};
    const validMerchantBonusVictoryPointChange = {type: 'victory_points_changed', playerId: 'p2', delta: 3, reason: 'merchant bonus'};
    const invalidMerchantBonusVictoryPointChange = {type: 'victory_points_changed', playerId: 'p2', delta: 5, reason: 'merchant bonus'};
    const invalidVictoryPointChange = {type: 'victory_points_changed', playerId: 'ghost', delta: 4, reason: 'link scoring'};
    const mismatchedVictoryPointChange = {type: 'victory_points_changed', playerId: 'p2', delta: 4, reason: 'negative income shortfall'};
    const zeroVictoryPointChange = {type: 'victory_points_changed', playerId: 'p2', delta: 0, reason: 'link scoring'};
    const invalidIntroductoryIncomeVictoryPointChange = {
      type: 'victory_points_changed',
      playerId: 'p2',
      delta: staticConfig.incomeTrack.maxIncomeLevel + 1,
      reason: 'introductory income scoring',
    };
    const invalidIntroductoryMoneyVictoryPointChange = {
      type: 'victory_points_changed',
      playerId: 'p2',
      delta: 16,
      reason: 'introductory money scoring',
    };
    const invalidIntroductoryIndustryVictoryPointChange = {
      type: 'victory_points_changed',
      playerId: 'p2',
      delta: staticConfig.industryTileSpecs['pottery-5-1'].flip.victoryPoints,
      reason: 'introductory industry scoring',
    };
    const dirtyNegativeIncomeStarted = {
      type: 'negative_income_started',
      playerId: ' p1 ',
      amountOwed: 5,
      incomePlayerIndex: 0,
      sessionToken: 'secret-token',
    };
    const invalidNegativeIncomeStarted = {
      type: 'negative_income_started',
      playerId: 'p1',
      amountOwed: -1,
      incomePlayerIndex: 0,
    };
    const invalidZeroNegativeIncomeStarted = {
      type: 'negative_income_started',
      playerId: 'p1',
      amountOwed: 0,
      incomePlayerIndex: 0,
    };
    const dirtyNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: ' p1 ',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [' industry-42 ', 'industry-42'],
      sessionToken: 'secret-token',
    };
    const cashOnlyNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p2',
      amountOwed: 2,
      paid: 2,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    };
    const cashOnlyNegativeIncomeStarted = {
      type: 'negative_income_started',
      playerId: 'p2',
      amountOwed: 2,
      incomePlayerIndex: 1,
    };
    const activeIndustryNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p2',
      amountOwed: 1,
      paid: 1,
      victoryPointLoss: 0,
      industryInstanceIds: [coalIndustry.id],
    };
    const underpaidLiquidationNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 3,
      victoryPointLoss: 2,
      industryInstanceIds: ['industry-42'],
    };
    const unbalancedNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 2,
      victoryPointLoss: 2,
      industryInstanceIds: ['industry-42'],
    };
    const invalidNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 3,
      victoryPointLoss: 2,
      industryInstanceIds: ['industry-42', 'secret-token'],
    };
    const invalidZeroNegativeIncomeResolved = {
      type: 'negative_income_resolved',
      playerId: 'p2',
      amountOwed: 0,
      paid: 0,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    };
    const dirtyEraEnded = {
      type: 'era_ended',
      era: ' canal ',
      score: {
        era: '\tcanal\n',
        linkVictoryPointsByPlayer: {' p1 ': 3, p2: 1, ghost: 99},
        industryVictoryPointsByPlayer: {p1: 5, '\tp2\n': 2, ghost: 99},
        totalVictoryPointsByPlayer: {' p1 ': 8, p2: 3, ghost: 198},
      },
      sessionToken: 'secret-token',
    };
    const invalidEraEnded = {
      type: 'era_ended',
      era: 'secret-token',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 3, p2: 1},
        industryVictoryPointsByPlayer: {p1: 5, p2: 2},
        totalVictoryPointsByPlayer: {p1: 8, p2: 3},
      },
    };
    const mismatchedEraEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'rail',
        linkVictoryPointsByPlayer: {p1: 3, p2: 1},
        industryVictoryPointsByPlayer: {p1: 5, p2: 2},
        totalVictoryPointsByPlayer: {p1: 8, p2: 3},
      },
    };
    const unbalancedEraEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 3, p2: 1},
        industryVictoryPointsByPlayer: {p1: 5, p2: 2},
        totalVictoryPointsByPlayer: {p1: 8, p2: 99},
      },
    };
    const dirtyGameEnded = {type: 'game_ended', winners: [' ghost ', ' p2 ', 'p2', '\tp1\n'], sessionToken: 'secret-token'};
    const invalidGameEnded = {type: 'game_ended', winners: ['ghost']};
    const paddedKnownEvent = {type: ' turn_advanced ', currentPlayerId: ' p2 ', roundNumber: 1};
    const invalidTurnAdvanced = {type: 'turn_advanced', currentPlayerId: 'ghost', roundNumber: 2};
    const dirtyTurnOrder = {type: 'turn_order_updated', order: [' p2 ', 'ghost', 'p1', 'p2']};
    const incompleteTurnOrder = {type: 'turn_order_updated', order: ['p1', 'ghost']};
    game.eventLog = [
      originalGameCreated,
      'not-an-event',
      {type: 123},
      {type: 'legacy_debug_marker', value: 1},
      dirtyRegularDiscard,
      dirtyWildDiscard,
      invalidDiscard,
      dirtyLoan,
      invalidLoan,
      dirtyScout,
      invalidScout,
      dirtyCashChange,
      validMarketSaleCashChange,
      invalidMarketSaleCashChange,
      validMerchantBonusCashChange,
      invalidMerchantBonusCashChange,
      invalidCashChange,
      mismatchedCashChange,
      zeroCashChange,
      invalidIncomeCashChange,
      invalidNegativeIncomeLiquidationCashChange,
      dirtyIncomeChange,
      invalidIndustryIncomeChange,
      validLoanIncomeChange,
      validMerchantBonusIncomeChange,
      invalidMerchantBonusIncomeChange,
      invalidIncomeChange,
      mismatchedIncomeChange,
      mismatchedLoanIncomeChange,
      outOfRangeIncomeChange,
      dirtyIndustryBuilt,
      invalidIndustryBuilt,
      dirtyIndustryRemoved,
      invalidIndustryRemoved,
      activeIndustryRemoved,
      dirtyIndustryFlipped,
      invalidIndustryFlipped,
      unflippedIndustryFlipped,
      dirtyIndustrySold,
      invalidIndustrySold,
      mismatchedMerchantIndustrySold,
      unflippedIndustrySold,
      dirtyResourceConsumed,
      invalidResourceConsumed,
      invalidMerchantBeerNetworkConsumed,
      invalidBlankMerchantBeerConsumed,
      invalidCoalSellConsumed,
      invalidIronNetworkConsumed,
      dirtyResourceSoldToMarket,
      invalidResourceSoldToMarket,
      invalidResourceSoldToMarketPrice,
      dirtyLinkBuilt,
      invalidLinkBuilt,
      inactiveLinkBuilt,
      dirtyLinkScored,
      mismatchedLinkScored,
      invalidLinkScored,
      inactiveLinkScored,
      dirtyIndustryScored,
      invalidIndustryScored,
      mismatchedIndustryScored,
      unflippedIndustryScored,
      validMerchantBeerConsumed,
      dirtyMerchantBonusClaimed,
      invalidMerchantBonusClaimed,
      mismatchedMerchantBonusClaimed,
      validMerchantBonusClaimed,
      dirtyMerchantDevelopResolved,
      legacyMerchantDevelopResolved,
      emptyMerchantDevelopResolved,
      nonDevelopMerchantDevelopResolved,
      mixedMerchantDevelopResolved,
      unremovedSpecMerchantDevelopResolved,
      invalidMerchantDevelopResolved,
      dirtyVictoryPointChange,
      validMerchantBonusVictoryPointChange,
      invalidMerchantBonusVictoryPointChange,
      invalidVictoryPointChange,
      mismatchedVictoryPointChange,
      zeroVictoryPointChange,
      invalidIntroductoryIncomeVictoryPointChange,
      invalidIntroductoryMoneyVictoryPointChange,
      invalidIntroductoryIndustryVictoryPointChange,
      dirtyNegativeIncomeStarted,
      invalidNegativeIncomeStarted,
      invalidZeroNegativeIncomeStarted,
      dirtyNegativeIncomeResolved,
      cashOnlyNegativeIncomeStarted,
      cashOnlyNegativeIncomeResolved,
      activeIndustryNegativeIncomeResolved,
      underpaidLiquidationNegativeIncomeResolved,
      unbalancedNegativeIncomeResolved,
      invalidNegativeIncomeResolved,
      invalidZeroNegativeIncomeResolved,
      dirtyEraEnded,
      invalidEraEnded,
      mismatchedEraEnded,
      unbalancedEraEnded,
      dirtyGameEnded,
      invalidGameEnded,
      paddedKnownEvent,
      invalidTurnAdvanced,
      dirtyTurnOrder,
      incompleteTurnOrder,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.eventLog).toEqual([
      {type: 'game_created', gameId: game.id, playerIds: ['p1', 'p2']},
      {type: 'card_discarded', playerId: 'p1', cardId: legacyDiscardCardId, destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: legacyWildCardId, destination: 'wild_pool'},
      {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'sold coal to market'},
      {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: loanToPosition, reason: 'loan'},
      {
        type: 'industry_built',
        instance: {
          id: 'industry-77',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          level: 1,
          locationId: 'worcester',
          slotId: 'worcester-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {type: 'industry_removed', industryInstanceId: 'industry-42', reason: 'negative_income'},
      {type: 'industry_flipped', industryInstanceId: 'industry-8', ownerPlayerId: 'p1'},
      {type: 'industry_sold', industryInstanceId: 'industry-8', ownerPlayerId: 'p1', merchantSpaceId},
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
        byPlayerId: 'p2',
        reason: 'sell',
      },
      {type: 'resource_sold_to_market', industryInstanceId: coalIndustry.id, market: 'coal', cashReceived: 4},
      {type: 'link_built', instance: {id: 'link-123', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-oxford'}},
      {type: 'link_scored', linkInstanceId: 'link-123', ownerPlayerId: 'p1', points: 2},
      {type: 'industry_scored', industryInstanceId: 'industry-42', ownerPlayerId: 'p1', points: 5},
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId, merchantTileInstanceId},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId, bonus: {type: 'develop', count: 1}},
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId,
        merchantSpaceIds: [merchantSpaceId],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {type: 'negative_income_started', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0},
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: ['industry-42'],
      },
      {type: 'negative_income_started', playerId: 'p2', amountOwed: 2, incomePlayerIndex: 1},
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 2,
        paid: 2,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 3, p2: 1},
          industryVictoryPointsByPlayer: {p1: 5, p2: 2},
          totalVictoryPointsByPlayer: {p1: 8, p2: 3},
        },
      },
      {type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 1},
      {type: 'turn_order_updated', order: ['p2', 'p1']},
    ]);
    expect(restoredGame?.eventLog.some((event) => event.type === 'link_built' && event.instance.id === 'link-999')).toBe(false);
    expect(restoredGame?.eventLog.some((event) => event.type === 'link_scored' && event.linkInstanceId === 'link-999')).toBe(false);
    expect(JSON.stringify(restoredGame?.eventLog)).not.toContain('secret-token');

    const session = restored.getPlayerSession(game.id, 'p1');
    const cardId = restoredGame?.players.p1.handCardIds[0];
    const result = restored.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.eventLog).toContainEqual({type: 'card_discarded', playerId: 'p1', cardId, destination: 'discard'});
  });

  it('keeps restored merchant bonus value changes only with matching claims', () => {
    const start = staticConfig.incomeTrack.startPosition;
    const cases = [
      {
        id: 'legacy-merchant-income-evidence',
        playerNames: ['Ada', 'Ben'],
        initialTurnOrder: ['p1', 'p2'],
        merchantSpaceId: 'oxford-0',
        merchantTileInstanceId: 'oxford-cotton-0',
        valueChange: {
          type: 'income_position_changed',
          playerId: ' p1 ',
          from: start,
          to: advanceIncomeSpaces(start, 2),
          reason: ' merchant bonus ',
        },
        expectedValueChange: {
          type: 'income_position_changed',
          playerId: 'p1',
          from: start,
          to: advanceIncomeSpaces(start, 2),
          reason: 'merchant bonus',
        },
        claim: {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'oxford-0',
          bonus: {type: 'income_spaces', spaces: 2},
        },
      },
      {
        id: 'legacy-merchant-vp-evidence',
        playerNames: ['Ada', 'Ben'],
        initialTurnOrder: ['p1', 'p2'],
        merchantSpaceId: 'shrewsbury-0',
        merchantTileInstanceId: 'gloucester-cotton-0',
        valueChange: {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
        expectedValueChange: {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
        claim: {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'shrewsbury-0',
          bonus: {type: 'victory_points', points: 4},
        },
      },
      {
        id: 'legacy-merchant-cash-evidence',
        playerNames: ['Ada', 'Ben', 'Cara'],
        initialTurnOrder: ['p1', 'p2', 'p3'],
        merchantSpaceId: 'warrington-0',
        merchantTileInstanceId: 'warrington-pottery-0',
        valueChange: {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
        expectedValueChange: {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
        claim: {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'warrington-0',
          bonus: {type: 'cash', cash: 5},
        },
      },
    ] as const;

    for (const scenario of cases) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
      const storagePath = path.join(directory, 'games.json');
      const game = createGame({
        id: scenario.id,
        playerNames: [...scenario.playerNames],
        seed: 5,
        initialTurnOrder: [...scenario.initialTurnOrder],
      });
      game.board.merchantSpaces = {
        [scenario.merchantSpaceId]: {
          id: scenario.merchantSpaceId,
          merchantTileInstanceId: scenario.merchantTileInstanceId,
          beerPresent: true,
        },
      };
      const orphanCash = {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'};
      const merchantBeer = {
        type: 'resource_consumed',
        source: {
          kind: 'merchant_beer',
          merchantSpaceId: scenario.merchantSpaceId,
          merchantTileInstanceId: scenario.merchantTileInstanceId,
        },
        byPlayerId: 'p1',
        reason: 'sell',
      };

      game.eventLog = [
        orphanCash,
        merchantBeer,
        scenario.valueChange,
        scenario.claim,
      ] as unknown as GameState['eventLog'];

      fs.writeFileSync(storagePath, JSON.stringify({
        version: 1,
        games: [game],
      }));

      const restored = new GameStore({storagePath});

      expect(restored.get(game.id)?.eventLog).toEqual([
        merchantBeer,
        scenario.expectedValueChange,
        scenario.claim,
      ]);
    }
  });

  it('drops restored merchant develop resolutions that reuse an already claimed spec id', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-duplicate-merchant-develop-spec', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    const firstMerchantBeer = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const firstClaim = {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-0', bonus: {type: 'develop', count: 1}};
    const firstResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const secondMerchantBeer = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const secondClaim = {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-1', bonus: {type: 'develop', count: 1}};
    const duplicateResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-1',
      merchantSpaceIds: ['gloucester-1'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    game.eventLog = [
      firstMerchantBeer,
      firstClaim,
      firstResolved,
      secondMerchantBeer,
      secondClaim,
      duplicateResolved,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      firstMerchantBeer,
      firstClaim,
      firstResolved,
      secondMerchantBeer,
      secondClaim,
    ]);
  });

  it('keeps restored industry income changes only with matching flips', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-industry-income-evidence', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const cotton = addIndustry(game, {
      id: 'industry-8',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: true,
    });
    const brewery = addIndustry(game, {
      id: 'industry-9',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
      flipped: true,
      remainingResource: 0,
    });
    const start = staticConfig.incomeTrack.startPosition;
    const cottonTo = advanceIncomeSpaces(start, staticConfig.industryTileSpecs[cotton.specId].flip.incomeSpaces);
    const breweryTo = advanceIncomeSpaces(start, staticConfig.industryTileSpecs[brewery.specId].flip.incomeSpaces);
    const orphanIncome = {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'};
    const validIncome = {type: 'income_position_changed', playerId: ' p1 ', from: start, to: cottonTo, reason: ' sold cotton_mill '};
    const validFlip = {type: 'industry_flipped', industryInstanceId: cotton.id, ownerPlayerId: 'p1'};
    const mismatchedIncome = {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'};
    const mismatchedFlip = {type: 'industry_flipped', industryInstanceId: brewery.id, ownerPlayerId: 'p1'};
    const validBreweryIncome = {type: 'income_position_changed', playerId: 'p1', from: start, to: breweryTo, reason: 'flipped brewery'};
    const duplicateBreweryFlip = {type: 'industry_flipped', industryInstanceId: brewery.id, ownerPlayerId: 'p1'};

    game.eventLog = [
      orphanIncome,
      validIncome,
      validFlip,
      mismatchedIncome,
      mismatchedFlip,
      validBreweryIncome,
      duplicateBreweryFlip,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'},
      validFlip,
      mismatchedFlip,
    ]);
  });

  it('keeps restored scoring victory point changes only with matching score details', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-scoring-vp-evidence', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const linkLineId = 'birmingham-oxford';
    addLink(game, 'link-1', 'p1', linkLineId);
    const line = staticConfig.linkLines[linkLineId];
    const printedLinkPoints = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
      .filter((locationId): locationId is string => Boolean(locationId))
      .reduce((sum, locationId) => sum + (staticConfig.locations[locationId]?.printedLinkIcons ?? 0), 0);
    const industry = addIndustry(game, {
      id: 'industry-8',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const industryPoints = staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
    const linkPoints = printedLinkPoints + staticConfig.industryTileSpecs[industry.specId].flip.linkIcons;
    const validLinkVictoryPoints = {type: 'victory_points_changed', playerId: ' p1 ', delta: linkPoints, reason: ' link scoring '};
    const linkScored = {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints};
    const validIndustryVictoryPoints = {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'};
    const industryScored = {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints};

    game.eventLog = [
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      'legacy marker',
      validLinkVictoryPoints,
      linkScored,
      validIndustryVictoryPoints,
      industryScored,
      {type: 'victory_points_changed', playerId: 'p2', delta: linkPoints, reason: 'link scoring'},
      linkScored,
      {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'},
      industryScored,
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      linkScored,
      validIndustryVictoryPoints,
      industryScored,
    ]);
  });

  it('keeps restored action spend cash changes only with matching action evidence', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-action-spend-evidence', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const ironPrice = staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0];
    const buildSpec = staticConfig.industryTileSpecs['cotton_mill-1-1'];
    const builtIndustry = {
      id: 'industry-101',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill' as const,
      specId: buildSpec.id,
      level: buildSpec.level,
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    const validBuildCash = {type: 'cash_changed', playerId: ' p1 ', delta: -buildSpec.cost.cash, reason: ' build '};
    const validBuild = {type: 'industry_built', instance: builtIndustry};
    const validNetworkLink = {
      type: 'link_built',
      instance: {id: 'link-101', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-oxford'},
    };
    const validNetworkCash = {type: 'cash_changed', playerId: 'p1', delta: -staticConfig.rules.canalLinkCost, reason: 'network'};
    const validDevelopResource = {
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: ironPrice},
      byPlayerId: 'p1',
      reason: 'develop',
    };
    const validDevelopCash = {type: 'cash_changed', playerId: 'p1', delta: -ironPrice, reason: 'develop iron'};

    game.eventLog = [
      {type: 'cash_changed', playerId: 'p1', delta: -buildSpec.cost.cash, reason: 'build'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      validBuildCash,
      validBuild,
      validNetworkLink,
      validNetworkCash,
      {type: 'link_built', instance: {id: 'link-102', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-walsall'}},
      {type: 'cash_changed', playerId: 'p1', delta: -99, reason: 'network'},
      validDevelopResource,
      validDevelopCash,
      {type: 'cash_changed', playerId: 'p1', delta: -ironPrice, reason: 'develop iron'},
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: 'p1', delta: -buildSpec.cost.cash, reason: 'build'},
      validBuild,
      validNetworkLink,
      validNetworkCash,
      {type: 'link_built', instance: {id: 'link-102', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-walsall'}},
      validDevelopResource,
      validDevelopCash,
    ]);
  });

  it('drops restored market-sale events beyond the industry resource capacity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-excess-market-sales', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const coalIndustry = addIndustry(game, {
      id: 'industry-9',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    const capacity = staticConfig.industryTileSpecs[coalIndustry.specId].resourcesWhenBuilt?.canal;
    if (capacity === undefined) {
      throw new Error('Expected level 1 coal mine to have Canal coal capacity');
    }
    const cashReceived = staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0];

    game.eventLog = Array.from({length: capacity + 1}, () => ({
      type: 'resource_sold_to_market',
      industryInstanceId: coalIndustry.id,
      market: 'coal',
      cashReceived,
    })) as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual(Array.from({length: capacity}, () => ({
      type: 'resource_sold_to_market',
      industryInstanceId: coalIndustry.id,
      market: 'coal',
      cashReceived,
    })));
  });

  it('drops restored resource-consumed events beyond the source capacity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-excess-resource-consumption', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const coalIndustry = addIndustry(game, {
      id: 'industry-9',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    const merchantSpaceId = 'gloucester-0';
    const merchantTileInstanceId = 'gloucester-cotton-0';
    game.board.merchantSpaces[merchantSpaceId] = {
      id: merchantSpaceId,
      merchantTileInstanceId,
      beerPresent: true,
    };
    const capacity = staticConfig.industryTileSpecs[coalIndustry.specId].resourcesWhenBuilt?.canal;
    if (capacity === undefined) {
      throw new Error('Expected level 1 coal mine to have Canal coal capacity');
    }
    const coalConsumed = {
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: coalIndustry.id, resourceType: 'coal'},
      byPlayerId: 'p1',
      reason: 'network',
    };
    const merchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId, merchantTileInstanceId},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const canalEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 0, p2: 0},
        industryVictoryPointsByPlayer: {p1: 0, p2: 0},
        totalVictoryPointsByPlayer: {p1: 0, p2: 0},
      },
    };

    game.eventLog = [
      ...Array.from({length: capacity + 1}, () => coalConsumed),
      merchantBeerConsumed,
      merchantBeerConsumed,
      canalEnded,
      merchantBeerConsumed,
    ] as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      ...Array.from({length: capacity}, () => coalConsumed),
      merchantBeerConsumed,
      canalEnded,
      merchantBeerConsumed,
    ]);
  });

  it('does not carry restored pending merchant develop bonuses across era boundaries', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-cross-era-merchant-develop', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = ['manufacturer-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    const canalEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 0, p2: 0},
        industryVictoryPointsByPlayer: {p1: 0, p2: 0},
        totalVictoryPointsByPlayer: {p1: 0, p2: 0},
      },
    };
    const oldMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const oldMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      bonus: {type: 'develop', count: 1},
    };
    const oldMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const newMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const newMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-1',
      bonus: {type: 'develop', count: 1},
    };
    const newMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-1',
      industryTypes: ['manufacturer'],
      specIds: ['manufacturer-1-1'],
    };
    game.eventLog = [
      oldMerchantBeerConsumed,
      canalEnded,
      oldMerchantBonusClaimed,
      oldMerchantDevelopResolved,
      newMerchantBeerConsumed,
      newMerchantBonusClaimed,
      newMerchantDevelopResolved,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      oldMerchantBeerConsumed,
      canalEnded,
      newMerchantBeerConsumed,
      newMerchantBonusClaimed,
      {
        ...newMerchantDevelopResolved,
        merchantSpaceIds: ['gloucester-1'],
      },
    ]);
  });

  it('does not carry restored pending merchant develop bonuses across turn-order updates', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-cross-turn-merchant-develop', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = ['manufacturer-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    const oldMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const oldMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      bonus: {type: 'develop', count: 1},
    };
    const turnOrderUpdated = {type: 'turn_order_updated', order: ['p1', 'p2']};
    const oldMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    };
    const newMerchantBeerConsumed = {
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    };
    const newMerchantBonusClaimed = {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-1',
      bonus: {type: 'develop', count: 1},
    };
    const newMerchantDevelopResolved = {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-1',
      industryTypes: ['manufacturer'],
      specIds: ['manufacturer-1-1'],
    };
    game.eventLog = [
      oldMerchantBeerConsumed,
      oldMerchantBonusClaimed,
      turnOrderUpdated,
      oldMerchantDevelopResolved,
      newMerchantBeerConsumed,
      newMerchantBonusClaimed,
      newMerchantDevelopResolved,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      oldMerchantBeerConsumed,
      oldMerchantBonusClaimed,
      turnOrderUpdated,
      newMerchantBeerConsumed,
      newMerchantBonusClaimed,
      {
        ...newMerchantDevelopResolved,
        merchantSpaceIds: ['gloucester-1'],
      },
    ]);
  });

  it('drops duplicate restored board lifecycle events for the same instance', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-duplicate-board-events', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const cottonIndustry = addIndustry(game, {
      id: 'industry-8',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: true,
    });
    const removedIndustry = addIndustry(game, {
      id: 'industry-9',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    removedIndustry.removedFromGame = true;
    game.board.slots[removedIndustry.slotId] = {};
    const merchantSpaceId = 'gloucester-0';
    game.board.merchantSpaces[merchantSpaceId] = {
      id: merchantSpaceId,
      merchantTileInstanceId: 'gloucester-cotton-0',
      beerPresent: true,
    };
    const builtEvent = {
      type: 'industry_built',
      instance: cottonIndustry,
    };
    const removedEvent = {
      type: 'industry_removed',
      industryInstanceId: removedIndustry.id,
      reason: 'overbuild',
    };
    const flippedEvent = {
      type: 'industry_flipped',
      industryInstanceId: cottonIndustry.id,
      ownerPlayerId: 'p1',
    };
    const soldEvent = {
      type: 'industry_sold',
      industryInstanceId: cottonIndustry.id,
      ownerPlayerId: 'p1',
      merchantSpaceId,
    };
    const linkBuiltEvent = {
      type: 'link_built',
      instance: {
        id: 'link-123',
        ownerPlayerId: 'p1',
        linkType: 'canal',
        linkLineId: 'birmingham-oxford',
      },
    };

    game.eventLog = [
      builtEvent,
      builtEvent,
      removedEvent,
      removedEvent,
      flippedEvent,
      flippedEvent,
      soldEvent,
      soldEvent,
      linkBuiltEvent,
      linkBuiltEvent,
    ] as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      builtEvent,
      removedEvent,
      flippedEvent,
      soldEvent,
      linkBuiltEvent,
    ]);
  });

  it('drops duplicate restored scoring and lifecycle events', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-duplicate-scoring-events', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.status = 'ended';
    game.players.p1.victoryPoints = 10;
    game.players.p2.victoryPoints = 0;
    const cottonIndustry = addIndustry(game, {
      id: 'industry-8',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
      flipped: true,
    });
    addLink(game, 'link-123', 'p1', 'birmingham-oxford');
    const gameCreated = {type: 'game_created', gameId: 'stale-game-id', playerIds: ['p2', 'p1']};
    const linkScored = {type: 'link_scored', linkInstanceId: 'link-123', ownerPlayerId: 'p1', points: 2};
    const industryScored = {
      type: 'industry_scored',
      industryInstanceId: cottonIndustry.id,
      ownerPlayerId: 'p1',
      points: staticConfig.industryTileSpecs[cottonIndustry.specId].flip.victoryPoints,
    };
    const canalEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 0, p2: 0},
        industryVictoryPointsByPlayer: {p1: 0, p2: 0},
        totalVictoryPointsByPlayer: {p1: 0, p2: 0},
      },
    };
    const railEnded = {
      type: 'era_ended',
      era: 'rail',
      score: {
        era: 'rail',
        linkVictoryPointsByPlayer: {p1: 0, p2: 0},
        industryVictoryPointsByPlayer: {p1: 0, p2: 0},
        totalVictoryPointsByPlayer: {p1: 0, p2: 0},
      },
    };
    const gameEnded = {type: 'game_ended', winners: ['p1']};

    game.eventLog = [
      gameCreated,
      gameCreated,
      linkScored,
      linkScored,
      industryScored,
      industryScored,
      canalEnded,
      canalEnded,
      industryScored,
      railEnded,
      railEnded,
      gameEnded,
      gameEnded,
    ] as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'game_created', gameId: game.id, playerIds: ['p1', 'p2']},
      linkScored,
      industryScored,
      canalEnded,
      industryScored,
      railEnded,
      gameEnded,
    ]);
  });

  it('drops duplicate restored regular-card discards and stale turn advances within an era', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-duplicate-turn-events', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const regularCardId = getCardIdsForPlayerCount(2)[0];
    const wildCardId = getWildLocationCardIds()[0];
    const regularDiscard = {type: 'card_discarded', playerId: 'p1', cardId: regularCardId, destination: 'discard'};
    const wildDiscard = {type: 'card_discarded', playerId: 'p1', cardId: wildCardId, destination: 'wild_pool'};
    const turnOneP1 = {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 1};
    const turnOneP2 = {type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 1};
    const turnTwoP1 = {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 2};
    const canalEnded = {
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 0, p2: 0},
        industryVictoryPointsByPlayer: {p1: 0, p2: 0},
        totalVictoryPointsByPlayer: {p1: 0, p2: 0},
      },
    };

    game.eventLog = [
      regularDiscard,
      regularDiscard,
      wildDiscard,
      wildDiscard,
      turnOneP1,
      turnOneP1,
      turnOneP2,
      turnTwoP1,
      turnOneP2,
      canalEnded,
      regularDiscard,
      turnOneP1,
    ] as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      regularDiscard,
      wildDiscard,
      wildDiscard,
      turnOneP1,
      turnOneP2,
      turnTwoP1,
      canalEnded,
      regularDiscard,
      turnOneP1,
    ]);
  });

  it('drops restored Loan and Scout completion events without their evidence chains', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-loan-scout-evidence', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const cards = getCardIdsForPlayerCount(2);
    const loanFromPosition = staticConfig.incomeTrack.startPosition;
    const loanToPosition = retreatIncomeLevels(loanFromPosition, staticConfig.rules.loanIncomeLevelPenalty);
    const orphanLoan = {type: 'loan_taken', playerId: 'p1'};
    const orphanScout = {type: 'scouted', playerId: 'p1'};
    const loanCash = {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'};
    const loanIncome = {type: 'income_position_changed', playerId: 'p1', from: loanFromPosition, to: loanToPosition, reason: 'loan'};
    const loanDiscard = {type: 'card_discarded', playerId: 'p1', cardId: cards[0], destination: 'discard'};
    const loanTaken = {type: 'loan_taken', playerId: 'p1'};
    const shortScoutDiscardOne = {type: 'card_discarded', playerId: 'p1', cardId: cards[1], destination: 'discard'};
    const shortScoutDiscardTwo = {type: 'card_discarded', playerId: 'p1', cardId: cards[2], destination: 'discard'};
    const scoutDiscardOne = {type: 'card_discarded', playerId: 'p1', cardId: cards[3], destination: 'discard'};
    const scoutDiscardTwo = {type: 'card_discarded', playerId: 'p1', cardId: cards[4], destination: 'discard'};
    const scoutDiscardThree = {type: 'card_discarded', playerId: 'p1', cardId: cards[5], destination: 'discard'};
    const scouted = {type: 'scouted', playerId: 'p1'};

    game.eventLog = [
      orphanLoan,
      orphanScout,
      loanCash,
      loanIncome,
      loanDiscard,
      loanTaken,
      shortScoutDiscardOne,
      shortScoutDiscardTwo,
      orphanScout,
      scoutDiscardOne,
      scoutDiscardTwo,
      scoutDiscardThree,
      scouted,
    ] as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      loanCash,
      loanIncome,
      loanDiscard,
      loanTaken,
      shortScoutDiscardOne,
      shortScoutDiscardTwo,
      scoutDiscardOne,
      scoutDiscardTwo,
      scoutDiscardThree,
      scouted,
    ]);
  });

  it('pairs restored negative income starts and resolutions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-negative-income-evidence', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const orphanResolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    };
    const started = {
      type: 'negative_income_started',
      playerId: ' p1 ',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };
    const duplicateStarted = {
      type: 'negative_income_started',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };
    const mismatchedResolved = {
      type: 'negative_income_resolved',
      playerId: 'p2',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    };
    const resolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 3,
      victoryPointLoss: 2,
      industryInstanceIds: [],
    };
    const unmatchedResolved = {
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    };

    game.eventLog = [
      orphanResolved,
      started,
      duplicateStarted,
      mismatchedResolved,
      resolved,
      unmatchedResolved,
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'negative_income_started', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0},
      resolved,
    ]);
  });

  it('validates restored negative income starts against the current turn order', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-negative-income-turn-order', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.turnOrder = ['p2', 'p1'];
    game.eventLog = [
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 4,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 4,
        paid: 4,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
      {
        type: 'negative_income_started',
        playerId: ' p1 ',
        amountOwed: 5,
        incomePlayerIndex: 1,
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 1,
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ]);
  });

  it('drops restored negative income chains interrupted before resolution', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-interrupted-negative-income', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.eventLog = [
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
      {
        type: 'negative_income_started',
        playerId: 'p2',
        amountOwed: 2,
        incomePlayerIndex: 1,
      },
      {type: 'cash_changed', playerId: 'p2', delta: -2, reason: 'income'},
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 2,
        paid: 2,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {
        type: 'negative_income_started',
        playerId: 'p2',
        amountOwed: 2,
        incomePlayerIndex: 1,
      },
      {type: 'cash_changed', playerId: 'p2', delta: -2, reason: 'income'},
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 2,
        paid: 2,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ]);
  });

  it('keeps restored negative income resolutions for flipped removed industries', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-flipped-negative-income', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const liquidatedIndustry = addIndustry(game, {
      id: 'industry-42',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    liquidatedIndustry.removedFromGame = true;
    game.board.slots[liquidatedIndustry.slotId] = {};
    game.eventLog = [
      {
        type: 'negative_income_started',
        playerId: ' p1 ',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [` ${liquidatedIndustry.id} `],
      },
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.eventLog).toEqual([
      {type: 'negative_income_started', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0},
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [liquidatedIndustry.id],
      },
    ]);
    expect(restoredGame?.board.industryInstances[liquidatedIndustry.id]).toMatchObject({
      flipped: true,
      removedFromGame: true,
    });
    expect(restoredGame?.board.slots[liquidatedIndustry.slotId]).toEqual({});
  });

  it('keeps only game ended events after final era scoring whose winners match restored final standings', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-game-ended-winners', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.status = 'ended';
    game.era = 'rail';
    game.players.p1.victoryPoints = 20;
    game.players.p2.victoryPoints = 20;
    game.players.p1.incomeTrackPosition = staticConfig.incomeTrack.startPosition;
    game.players.p2.incomeTrackPosition = staticConfig.incomeTrack.startPosition + 1;
    game.players.p1.cash = 99;
    game.players.p2.cash = 0;
    const railScore = {
      era: 'rail' as const,
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    };
    game.eventLog = [
      {type: 'game_ended', winners: ['p2']},
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p1']},
      {type: 'turn_order_updated', order: ['p2', 'p1']},
      {type: 'game_ended', winners: [' ghost ', ' p2 ', 'p2']},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'game_ended', winners: ['p1', 'p2']},
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p2']},
    ]);
  });

  it('drops restored events between final era scoring and game end', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-final-era-boundary', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.status = 'ended';
    game.era = 'rail';
    game.players.p1.victoryPoints = 10;
    game.players.p2.victoryPoints = 0;
    const railScore = {
      era: 'rail' as const,
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    };
    game.eventLog = [
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'turn_order_updated', order: ['p2', 'p1']},
      {type: 'game_ended', winners: ['p1']},
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(game.id)?.eventLog).toEqual([
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p1']},
    ]);
  });

  it('normalizes legacy persisted games without face-down discard metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const canalGame = createGame({id: 'legacy-canal', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const railGame = createGame({id: 'legacy-rail', playerNames: ['Ada', 'Ben'], seed: 7, initialTurnOrder: ['p1', 'p2']});
    railGame.era = 'rail';
    railGame.players.p1.discardCardIds.push(railGame.players.p1.handCardIds.pop() as string);

    for (const game of [canalGame, railGame]) {
      for (const player of Object.values(game.players)) {
        delete (player as Partial<typeof player>).faceDownDiscardCount;
      }
    }
    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [canalGame, railGame],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(canalGame.id)?.players.p1.faceDownDiscardCount).toBe(1);
    expect(restored.get(canalGame.id)?.players.p2.faceDownDiscardCount).toBe(1);
    expect(restored.get(railGame.id)?.players.p1.faceDownDiscardCount).toBe(0);
    expect(restored.get(railGame.id)?.players.p2.faceDownDiscardCount).toBe(0);
  });

  it('caps stale face-down discard counts by era when restoring persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const canalGame = createGame({id: 'legacy-stale-canal-face-down', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const railGame = createGame({id: 'legacy-stale-rail-face-down', playerNames: ['Ada', 'Ben'], seed: 7, initialTurnOrder: ['p1', 'p2']});
    railGame.era = 'rail';

    const canalExtraDiscards = canalGame.players.p1.handCardIds.splice(0, 2);
    canalGame.players.p1.discardCardIds.push(...canalExtraDiscards);
    canalGame.players.p1.faceDownDiscardCount = 3;

    const railExtraDiscards = railGame.players.p1.handCardIds.splice(0, 2);
    railGame.players.p1.discardCardIds.push(...railExtraDiscards);
    railGame.players.p1.faceDownDiscardCount = 3;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [canalGame, railGame],
    }));

    const restored = new GameStore({storagePath});

    expect(restored.get(canalGame.id)?.players.p1.discardCardIds).toHaveLength(3);
    expect(restored.get(canalGame.id)?.players.p1.faceDownDiscardCount).toBe(1);
    expect(restored.get(railGame.id)?.players.p1.discardCardIds).toHaveLength(3);
    expect(restored.get(railGame.id)?.players.p1.faceDownDiscardCount).toBe(0);
  });

  it('normalizes stale card zones from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-card-zones', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const p1HandCard = game.players.p1.handCardIds[0];
    const p1DiscardCard = game.players.p1.discardCardIds[0];
    const drawCard = game.cardZones.drawDeck[0];
    game.players.p1.handCardIds = [
      p1HandCard,
      p1HandCard,
      'wild-location-1',
      'wild-location-1',
      'p3-location-leek-1',
      'missing-card',
    ];
    (game.players.p1.handCardIds as unknown[]).push(42);
    game.players.p1.discardCardIds = [
      p1DiscardCard,
      p1HandCard,
      'wild-industry-1',
      'p3-location-leek-1',
      'missing-card',
    ];
    (game.players.p1.discardCardIds as unknown[]).push({cardId: 'p2-location-birmingham-1'});
    game.players.p1.faceDownDiscardCount = 99;
    game.cardZones.drawDeck = [
      drawCard,
      drawCard,
      p1HandCard,
      'p3-location-leek-1',
      'wild-location-2',
      'missing-card',
    ];
    (game.cardZones.drawDeck as unknown[]).push(42);
    game.cardZones.wildLocationPool = [
      'wild-location-1',
      'wild-location-2',
      'wild-industry-2',
      'missing-card',
    ];
    (game.cardZones.wildLocationPool as unknown[]).push({cardId: 'wild-location-3'});
    game.cardZones.wildIndustryPool = [
      'wild-industry-1',
      'wild-industry-1',
      'wild-location-3',
      'missing-card',
    ];
    (game.cardZones.wildIndustryPool as unknown[]).push(42);

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);
    expect(restoredGame).toBeDefined();
    if (!restoredGame) {
      return;
    }

    expect(restoredGame.players.p1.handCardIds).toEqual([p1HandCard, 'wild-location-1']);
    expect(restoredGame.players.p1.discardCardIds).toEqual([p1DiscardCard]);
    expect(restoredGame.players.p1.faceDownDiscardCount).toBe(1);
    expect(JSON.stringify(restoredGame)).not.toContain('p3-location-leek-1');
    expect(restoredGame.cardZones.drawDeck).not.toContain('wild-location-2');
    expect(restoredGame.cardZones.drawDeck).not.toContain('missing-card');
    expect(restoredGame.cardZones.wildLocationPool).not.toContain('wild-location-1');
    expect(restoredGame.cardZones.wildLocationPool).toEqual(expect.arrayContaining(['wild-location-2', 'wild-location-3']));
    expect(restoredGame.cardZones.wildIndustryPool).toEqual(expect.arrayContaining(['wild-industry-1', 'wild-industry-2']));
    expect(restoredGame.cardZones.wildLocationPool.every((cardId) => cardId.startsWith('wild-location-'))).toBe(true);
    expect(restoredGame.cardZones.wildIndustryPool.every((cardId) => cardId.startsWith('wild-industry-'))).toBe(true);

    const regularCards = regularCardsInZones(restoredGame);
    expect(regularCards.sort()).toEqual([...getCardIdsForPlayerCount(2)].sort());
    expectUnique(regularCards);
    expectUnique(restoredGame.cardZones.wildLocationPool);
    expectUnique(restoredGame.cardZones.wildIndustryPool);
    expect([...restoredGame.cardZones.wildLocationPool, ...restoredGame.players.p1.handCardIds.filter((cardId) => cardId.startsWith('wild-location-'))].sort())
      .toEqual(getWildLocationCardIds().sort());
    expect([...restoredGame.cardZones.wildIndustryPool, ...restoredGame.players.p1.handCardIds.filter((cardId) => cardId.startsWith('wild-industry-'))].sort())
      .toEqual(getWildIndustryCardIds().sort());
  });

  it('normalizes stale turn state from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-turn-state', playerNames: ['Ada', 'Ben', 'Cara'], seed: 5, initialTurnOrder: ['p1', 'p2', 'p3']});
    game.turnOrder = ['ghost-player', ' p2 ', 'p2', '\tp1\n'];
    game.currentTurnIndex = 3;
    game.actionIndexInTurn = 99;
    game.actionsAllowedThisTurn = 99 as GameState['actionsAllowedThisTurn'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.turnOrder).toEqual(['p2', 'p1', 'p3']);
    expect(restoredGame?.currentTurnIndex).toBe(1);
    expect(restoredGame?.actionIndexInTurn).toBe(0);
    expect(restoredGame?.actionsAllowedThisTurn).toBe(1);
    expect(restoredGame ? getCurrentPlayerId(restoredGame) : undefined).toBe('p1');

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: restoredGame?.players.p1.handCardIds[0],
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.players.p1.discardCardIds).toContain(restoredGame?.players.p1.handCardIds[0]);
  });

  it('normalizes stale pending decisions from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const negativeIncomeGame = createGame({
      id: 'legacy-negative-income-pending',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 5,
      initialTurnOrder: ['p2', 'p1', 'p3'],
    });
    negativeIncomeGame.currentTurnIndex = 99;
    negativeIncomeGame.actionIndexInTurn = 1;
    negativeIncomeGame.pendingDecision = {
      type: 'negative_income',
      playerId: ' p1 ',
      amountOwed: 3.9,
      incomePlayerIndex: 99,
    };

    const zeroValueNegativeIncomeGame = createGame({
      id: 'legacy-zero-value-negative-income-pending',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 6,
      initialTurnOrder: ['p2', 'p1', 'p3'],
    });
    zeroValueNegativeIncomeGame.players.p1.cash = 0;
    zeroValueNegativeIncomeGame.players.p1.victoryPoints = 5;
    const zeroValuePottery = addIndustry(zeroValueNegativeIncomeGame, {
      id: 'zero-value-pottery',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-1',
    });
    zeroValueNegativeIncomeGame.currentTurnIndex = 99;
    zeroValueNegativeIncomeGame.actionIndexInTurn = 1;
    zeroValueNegativeIncomeGame.pendingDecision = {
      type: 'negative_income',
      playerId: '\tp1\n',
      amountOwed: 3,
      incomePlayerIndex: 99,
    };

    const ghostMerchantGame = createGame({id: 'legacy-ghost-pending', playerNames: ['Ada', 'Ben'], seed: 7, initialTurnOrder: ['p1', 'p2']});
    ghostMerchantGame.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'ghost-player',
      count: 99,
      merchantSpaceId: 'missing-space',
    } as GameState['pendingDecision'];

    const endedPendingGame = createGame({id: 'legacy-ended-pending', playerNames: ['Ada', 'Ben'], seed: 8, initialTurnOrder: ['p1', 'p2']});
    endedPendingGame.status = 'ended';
    endedPendingGame.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 0,
    };

    const validMerchantGame = createGame({id: 'legacy-valid-merchant-pending', playerNames: ['Ada', 'Ben'], seed: 9, initialTurnOrder: ['p1', 'p2']});
    validMerchantGame.currentTurnIndex = 99;
    validMerchantGame.pendingDecision = {
      type: 'merchant_develop',
      playerId: ' p2 ',
      count: 2.9,
      merchantSpaceId: ' gloucester-0 ',
      merchantSpaceIds: [' gloucester-1 ', 'missing-space', '\tgloucester-0\n'],
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [negativeIncomeGame, zeroValueNegativeIncomeGame, ghostMerchantGame, endedPendingGame, validMerchantGame],
    }));

    const restored = new GameStore({storagePath});
    const restoredNegative = restored.get(negativeIncomeGame.id);

    expect(restoredNegative?.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
    expect(restoredNegative?.currentTurnIndex).toBe(1);
    expect(restoredNegative?.actionIndexInTurn).toBe(0);

    const negativeSession = restored.getPlayerSession(negativeIncomeGame.id, 'p1');
    const negativeResult = restored.apply(negativeIncomeGame.id, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [],
    }, negativeSession?.token);

    expect(negativeResult.ok).toBe(true);
    expect(restored.get(negativeIncomeGame.id)?.pendingDecision).toBeUndefined();
    expect(restored.get(negativeIncomeGame.id)?.roundNumber).toBe(2);
    expect(restored.get(negativeIncomeGame.id)?.players.p1.cash).toBe(14);

    const restoredZeroValueNegative = restored.get(zeroValueNegativeIncomeGame.id);
    expect(restoredZeroValueNegative?.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
    expect(restoredZeroValueNegative?.currentTurnIndex).toBe(1);
    expect(restoredZeroValueNegative?.actionIndexInTurn).toBe(0);

    const zeroValueNegativeSession = restored.getPlayerSession(zeroValueNegativeIncomeGame.id, 'p1');
    const zeroValueNegativeResult = restored.apply(zeroValueNegativeIncomeGame.id, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [],
    }, zeroValueNegativeSession?.token);

    const resolvedZeroValueNegative = restored.get(zeroValueNegativeIncomeGame.id);
    expect(zeroValueNegativeResult.ok).toBe(true);
    expect(resolvedZeroValueNegative?.pendingDecision).toBeUndefined();
    expect(resolvedZeroValueNegative?.players.p1.cash).toBe(0);
    expect(resolvedZeroValueNegative?.players.p1.victoryPoints).toBe(2);
    expect(resolvedZeroValueNegative?.board.industryInstances[zeroValuePottery.id].removedFromGame).toBe(false);

    const restoredGhost = restored.get(ghostMerchantGame.id);
    expect(restoredGhost?.pendingDecision).toBeUndefined();
    const ghostSession = restored.getPlayerSession(ghostMerchantGame.id, 'p1');
    const passCard = restoredGhost?.players.p1.handCardIds[0];
    const passResult = restored.apply(ghostMerchantGame.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: passCard,
    }, ghostSession?.token);

    expect(passResult.ok).toBe(true);
    expect(restored.get(ghostMerchantGame.id)?.players.p1.discardCardIds).toContain(passCard);

    const restoredEnded = restored.get(endedPendingGame.id);
    expect(restoredEnded?.status).toBe('ended');
    expect(restoredEnded?.pendingDecision).toBeUndefined();

    const restoredMerchant = restored.get(validMerchantGame.id);
    expect(restoredMerchant?.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p2',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
    });
    expect(restoredMerchant?.currentTurnIndex).toBe(1);
  });

  it('caps restored merchant develop counts to the valid source capacity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({
      id: 'legacy-overcounted-merchant-pending',
      playerNames: ['Ada', 'Ben'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2'],
    });
    game.currentTurnIndex = 99;
    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: ' p1 ',
      count: 2.9,
      merchantSpaceId: ' gloucester-0 ',
      merchantSpaceIds: [' gloucester-0 ', 'missing-space'],
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
    });
    expect(restoredGame?.currentTurnIndex).toBe(0);

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.pendingDecision).toBeUndefined();
    expect(restored.get(game.id)?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(restored.get(game.id)?.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['coal_mine'],
      specIds: ['coal_mine-1-1'],
    });
  });

  it('resets invalid restored merchant develop action slots before resolving the bonus', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({
      id: 'legacy-merchant-pending-action-slot',
      playerNames: ['Ada', 'Ben'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2'],
    });
    game.roundNumber = 2;
    game.actionsAllowedThisTurn = 2;
    game.actionIndexInTurn = 99;
    game.currentTurnIndex = 99;
    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: ' p1 ',
      count: 1,
      merchantSpaceId: ' gloucester-0 ',
      merchantSpaceIds: [' gloucester-0 '],
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.actionsAllowedThisTurn).toBe(2);
    expect(restoredGame?.currentTurnIndex).toBe(0);
    expect(restoredGame?.actionIndexInTurn).toBe(0);
    expect(restoredGame?.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
    });

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    }, session?.token);
    const resolvedGame = restored.get(game.id);

    expect(result.ok).toBe(true);
    expect(resolvedGame?.pendingDecision).toBeUndefined();
    expect(resolvedGame?.currentTurnIndex).toBe(0);
    expect(resolvedGame?.actionIndexInTurn).toBe(1);
    expect(resolvedGame ? getCurrentPlayerId(resolvedGame) : undefined).toBe('p1');
  });

  it('normalizes stale numeric counters from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-numeric-state', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.era = 'broken' as GameState['era'];
    game.status = 'paused' as GameState['status'];
    game.roundNumber = 0;
    game.nextInstanceId = null as unknown as number;
    game.markets.coal.occupiedCount = 999;
    game.markets.iron.occupiedCount = -3;
    game.players.p1.cash = null as unknown as number;
    game.players.p1.victoryPoints = -10;
    game.players.p1.incomeTrackPosition = 999;
    game.players.p1.spentThisRound = 4.8;
    game.players.p1.remainingLinks.canal = -2;
    game.players.p1.remainingLinks.rail = 99;
    game.players.p2.remainingLinks = null as unknown as GameState['players'][string]['remainingLinks'];
    game.players.p2.incomeTrackPosition = -3;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.era).toBe('canal');
    expect(restoredGame?.status).toBe('playing');
    expect(restoredGame?.roundNumber).toBe(1);
    expect(restoredGame?.nextInstanceId).toBe(1);
    expect(restoredGame?.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive.length);
    expect(restoredGame?.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);
    expect(restoredGame?.players.p1.cash).toBe(staticConfig.rules.initialCash);
    expect(restoredGame?.players.p1.victoryPoints).toBe(0);
    expect(restoredGame?.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.positions.length - 1);
    expect(restoredGame?.players.p1.spentThisRound).toBe(4);
    expect(restoredGame?.players.p1.remainingLinks).toEqual({
      canal: staticConfig.rules.initialLinksPerType,
      rail: staticConfig.rules.initialLinksPerType,
    });
    expect(restoredGame?.players.p2.remainingLinks).toEqual({
      canal: staticConfig.rules.initialLinksPerType,
      rail: staticConfig.rules.initialLinksPerType,
    });
    expect(restoredGame?.players.p2.incomeTrackPosition).toBe(0);

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'network',
      playerId: 'p1',
      cardId: restoredGame?.players.p1.handCardIds[0],
      linkLineIds: ['birmingham-walsall'],
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.players.p1.remainingLinks.canal).toBe(staticConfig.rules.initialLinksPerType - 1);
  });

  it('preserves explicitly empty markets when restoring persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'empty-market-state', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.markets.coal.occupiedCount = 0;
    game.markets.iron.occupiedCount = 0;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.markets.coal.occupiedCount).toBe(0);
    expect(restoredGame?.markets.iron.occupiedCount).toBe(0);
  });

  it('restores missing market counts to their initial occupied counts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'missing-market-state', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    delete (game.markets.coal as Partial<typeof game.markets.coal>).occupiedCount;
    delete (game.markets.iron as Partial<typeof game.markets.iron>).occupiedCount;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.initialOccupiedCount);
    expect(restoredGame?.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);
  });

  it('normalizes next instance id above restored board instances', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-next-instance-id', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.nextInstanceId = 1;
    game.players.p1.handCardIds = ['p2-location-birmingham-1'];
    addIndustry(game, {
      id: 'industry-42',
      ownerPlayerId: 'p2',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });
    addLink(game, 'link-58', 'p1', 'birmingham-walsall', 'canal');

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.nextInstanceId).toBe(59);
    expect(restoredGame?.board.industryInstances['industry-42'].ownerPlayerId).toBe('p2');
    expect(restoredGame?.board.linkInstances['link-58'].linkLineId).toBe('birmingham-walsall');

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    }, session?.token);

    const updated = restored.get(game.id);
    expect(result.ok).toBe(true);
    expect(updated?.board.slots['birmingham-0'].occupiedBy).toBe('industry-59');
    expect(updated?.board.industryInstances['industry-42'].ownerPlayerId).toBe('p2');
    expect(updated?.board.linkInstances['link-58'].linkLineId).toBe('birmingham-walsall');
    expect(updated?.nextInstanceId).toBe(60);
  });

  it('drops stale current-era scores from legacy playing games so era end can score once', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-current-score', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const finalCard = getCardIdsForPlayerCount(2)[0];
    const otherCards = getCardIdsForPlayerCount(2).filter((cardId) => cardId !== finalCard);
    game.cardZones.drawDeck = [];
    game.players.p1.handCardIds = [finalCard];
    game.players.p1.discardCardIds = otherCards;
    game.players.p1.faceDownDiscardCount = 1;
    game.players.p2.handCardIds = [];
    game.players.p2.discardCardIds = [];
    game.players.p2.faceDownDiscardCount = 0;
    game.lastEraScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 99, p2: 0},
      industryVictoryPointsByPlayer: {p1: 99, p2: 0},
      totalVictoryPointsByPlayer: {p1: 198, p2: 0},
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    expect(restored.get(game.id)?.lastEraScore).toBeUndefined();

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: finalCard,
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.era).toBe('rail');
    expect(restored.get(game.id)?.lastEraScore?.era).toBe('canal');
    expect(restored.get(game.id)?.lastEraScore?.totalVictoryPointsByPlayer.p1).toBe(0);
  });

  it('normalizes legacy era score player keys while restoring persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-score-player-keys', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.era = 'rail';
    game.roundNumber = 2;
    game.actionsAllowedThisTurn = 2;
    game.lastEraScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {' p1 ': 4, p2: 2, ghost: 99},
      industryVictoryPointsByPlayer: {p1: 6, '\tp2\n': 3, ghost: 99},
      totalVictoryPointsByPlayer: {' p1 ': 10, '\tp2\n': 5, ghost: 198},
    };
    const unbalancedScoreGame = createGame({id: 'legacy-unbalanced-score', playerNames: ['Ada', 'Ben'], seed: 6, initialTurnOrder: ['p1', 'p2']});
    unbalancedScoreGame.era = 'rail';
    unbalancedScoreGame.lastEraScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 4, p2: 2},
      industryVictoryPointsByPlayer: {p1: 6, p2: 3},
      totalVictoryPointsByPlayer: {p1: 10, p2: 99},
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game, unbalancedScoreGame],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.lastEraScore).toEqual({
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 4, p2: 2},
      industryVictoryPointsByPlayer: {p1: 6, p2: 3},
      totalVictoryPointsByPlayer: {p1: 10, p2: 5},
    });
    expect(restored.get(unbalancedScoreGame.id)?.lastEraScore).toBeUndefined();
  });

  it('keeps a restored final Canal wild card out of the Rail deck', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'persisted-final-wild', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const finalWild = 'wild-location-1';
    const regularCards = getCardIdsForPlayerCount(2);
    game.cardZones.drawDeck = [];
    game.cardZones.wildLocationPool = game.cardZones.wildLocationPool.filter((cardId) => cardId !== finalWild);
    game.players.p1.handCardIds = [finalWild];
    game.players.p1.discardCardIds = [...regularCards];
    game.players.p1.faceDownDiscardCount = 1;
    game.players.p2.handCardIds = [];
    game.players.p2.discardCardIds = [];
    game.players.p2.faceDownDiscardCount = 0;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: finalWild,
    }, session?.token);

    expect(result.ok).toBe(true);
    const railGame = restored.get(game.id);
    expect(railGame?.era).toBe('rail');
    expect(railGame?.cardZones.wildLocationPool).toContain(finalWild);
    expect(railGame?.cardZones.wildLocationPool).toHaveLength(staticConfig.rules.wildCardsPerType);
    expect(regularCardsInZones(railGame as GameState).sort()).toEqual([...regularCards].sort());
    expect(regularCardsInZones(railGame as GameState)).not.toContain(finalWild);

    const reread = new GameStore({storagePath});
    const persistedRailGame = reread.get(game.id);
    expect(persistedRailGame?.era).toBe('rail');
    expect(persistedRailGame?.cardZones.wildLocationPool).toContain(finalWild);
    expect(regularCardsInZones(persistedRailGame as GameState).sort()).toEqual([...regularCards].sort());
  });

  it('normalizes stale industry instance fields from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-industry-fields', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.board.industryInstances['coal-overfull'] = {
      id: 'coal-overfull',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      level: 99,
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-2',
      flipped: false,
      remainingResource: 999,
      removedFromGame: false,
    };
    game.board.industryInstances['iron-depleted'] = {
      id: 'iron-depleted',
      ownerPlayerId: 'p1',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      level: 99,
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-1',
      flipped: false,
      remainingResource: -4,
      removedFromGame: false,
    };
    game.board.industryInstances['manufacturer-stale'] = {
      id: 'manufacturer-stale',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      level: 99,
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: 'not-a-boolean' as unknown as boolean,
      remainingResource: 999,
      removedFromGame: false,
    };
    game.board.industryInstances['canal-brewery-overfull'] = {
      id: 'canal-brewery-overfull',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      level: 2,
      locationId: 'burtonOnTrent',
      slotId: 'burtonOnTrent-1',
      flipped: false,
      remainingResource: 2,
      removedFromGame: false,
    };
    game.board.industryInstances['rail-only-pottery'] = {
      id: 'rail-only-pottery',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-5-1',
      level: 5,
      locationId: 'coventry',
      slotId: 'coventry-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.board.industryInstances['coal-overfull']).toMatchObject({
      level: staticConfig.industryTileSpecs['coal_mine-1-1'].level,
      flipped: false,
      remainingResource: staticConfig.industryTileSpecs['coal_mine-1-1'].resourcesWhenBuilt?.canal,
      removedFromGame: false,
    });
    expect(restoredGame?.board.industryInstances['iron-depleted']).toMatchObject({
      level: staticConfig.industryTileSpecs['iron_works-1-1'].level,
      flipped: true,
      remainingResource: 0,
      removedFromGame: false,
    });
    expect(restoredGame?.board.industryInstances['manufacturer-stale']).toMatchObject({
      level: staticConfig.industryTileSpecs['manufacturer-1-1'].level,
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    });
    expect(restoredGame?.board.industryInstances['canal-brewery-overfull']).toMatchObject({
      level: staticConfig.industryTileSpecs['brewery-2-1'].level,
      flipped: false,
      remainingResource: staticConfig.industryTileSpecs['brewery-2-1'].resourcesWhenBuilt?.canal,
      removedFromGame: false,
    });
    expect(restoredGame?.board.industryInstances['rail-only-pottery'].removedFromGame).toBe(true);
    expect(restoredGame?.board.slots['coventry-0'].occupiedBy).toBeUndefined();
    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toEqual(['coal-overfull']);
    expect(restoredGame?.players.p1.industryTileStacks.iron_works.builtInstanceIds).toEqual(['iron-depleted']);
    expect(restoredGame?.players.p1.industryTileStacks.manufacturer.builtInstanceIds).toEqual(['manufacturer-stale']);
    expect(restoredGame?.players.p1.industryTileStacks.brewery.builtInstanceIds).toEqual(['canal-brewery-overfull']);
    expect(restoredGame?.players.p1.industryTileStacks.pottery.builtInstanceIds).not.toContain('rail-only-pottery');
  });

  it('reconstructs missing legacy board containers and merchant spaces', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-missing-board', playerNames: ['Ada', 'Ben', 'Cara'], seed: 5, initialTurnOrder: ['p1', 'p2', 'p3']});
    const persisted = structuredClone(game) as Partial<typeof game>;
    delete persisted.board;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [persisted],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.board.industryInstances).toEqual({});
    expect(restoredGame?.board.linkInstances).toEqual({});
    expect(Object.keys(restoredGame?.board.slots ?? {}).sort()).toEqual(expectedBoardSlotIds());
    expect(Object.keys(restoredGame?.board.linkLines ?? {}).sort()).toEqual(Object.keys(staticConfig.linkLines).sort());
    expect(Object.keys(restoredGame?.board.merchantSpaces ?? {}).sort()).toEqual(expectedMerchantSpaceIds(3));
    expect(Object.values(restoredGame?.board.merchantSpaces ?? {}).every((space) => typeof space.merchantTileInstanceId === 'string')).toBe(true);

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p1',
      cardId: restoredGame?.players.p1.handCardIds[0],
    }, session?.token);

    expect(result.ok).toBe(true);
  });

  it('normalizes stale merchant spaces from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-merchant-spaces', playerNames: ['Ada', 'Ben', 'Cara'], seed: 5, initialTurnOrder: ['p1', 'p2', 'p3']});
    const preservedTile = game.board.merchantSpaces['oxford-0'].merchantTileInstanceId as string;
    game.board.merchantSpaces = {
      'oxford-0': {id: 'legacy-oxford', merchantTileInstanceId: ` ${preservedTile}\n`, beerPresent: false},
      'nottingham-0': {id: 'nottingham-0', merchantTileInstanceId: 'nottingham-cotton-0', beerPresent: true},
      'gloucester-0': {id: 'gloucester-0', merchantTileInstanceId: 'missing-spec-0', beerPresent: true},
      'warrington-0': {id: 'warrington-0', merchantTileInstanceId: `\t${preservedTile} `, beerPresent: true},
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const spaces = restored.get(game.id)?.board.merchantSpaces ?? {};
    const specIds = Object.values(spaces).map((space) => merchantTileSpecId(space.merchantTileInstanceId as string));

    expect(Object.keys(spaces).sort()).toEqual(expectedMerchantSpaceIds(3));
    expect(spaces['oxford-0']).toEqual({id: 'oxford-0', merchantTileInstanceId: preservedTile, beerPresent: false});
    expect(spaces['nottingham-0']).toBeUndefined();
    expect(spaces['gloucester-0'].merchantTileInstanceId).not.toBe('missing-spec-0');
    expect(spaces['warrington-0'].merchantTileInstanceId).not.toBe(preservedTile);
    expect(new Set(specIds).size).toBe(specIds.length);
    for (const specId of specIds) {
      expect(staticConfig.merchantTileSpecs[specId].minPlayers).toBeLessThanOrEqual(3);
    }
  });

  it('normalizes legacy built industry stack references from the board', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-built-refs', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.board.industryInstances['coal-active'] = {
      id: 'coal-active',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      level: 1,
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: false,
      remainingResource: 2,
      removedFromGame: false,
    };
    game.board.industryInstances['coal-removed'] = {
      id: 'coal-removed',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      level: 1,
      locationId: 'dudley',
      slotId: 'dudley-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: true,
    };
    game.board.slots['cannock-1'] = {occupiedBy: 'coal-active'};
    const persisted = structuredClone(game) as typeof game;
    persisted.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = [
      'missing-spec',
      'iron_works-1-1',
      'coal_mine-2-1',
      'coal_mine-2-1',
      'coal_mine-1-1',
      'coal_mine-3-1',
    ];
    persisted.players.p1.industryTileStacks.coal_mine.removedSpecIds = [
      'missing-spec',
      'iron_works-1-1',
      'coal_mine-3-1',
      'coal_mine-3-1',
      'coal_mine-1-1',
    ];
    persisted.players.p1.industryTileStacks.coal_mine.builtInstanceIds = ['stale-coal'];
    persisted.players.p1.industryTileStacks.iron_works = null as unknown as typeof persisted.players.p1.industryTileStacks.iron_works;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [persisted],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toEqual(['coal-active']);
    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder).toEqual(['coal_mine-2-1']);
    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-3-1']);
    expect(restoredGame?.players.p1.industryTileStacks.iron_works).toEqual({
      availableSpecIdsInOrder: staticConfig.industryStackSpecIds.iron_works,
      removedSpecIds: [],
      builtInstanceIds: [],
    });
    expect(restoredGame?.players.p2.industryTileStacks.coal_mine.builtInstanceIds).toEqual([]);
  });

  it('reconstructs missing legacy player industry stacks and keeps the game playable', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-missing-industry-stacks', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.handCardIds = ['p2-location-birmingham-1'];
    game.board.industryInstances['coal-active'] = {
      id: 'coal-active',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      level: 1,
      locationId: 'cannock',
      slotId: 'cannock-1',
      flipped: false,
      remainingResource: 2,
      removedFromGame: false,
    };
    game.board.slots['cannock-1'] = {occupiedBy: 'coal-active'};
    const persisted = structuredClone(game);
    delete (persisted.players.p1 as Partial<GameState['players'][string]>).industryTileStacks;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [persisted],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toEqual(['coal-active']);
    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder).not.toContain('coal_mine-1-1');
    expect(restoredGame?.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder[0]).toBe('coal_mine-2-1');
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder[0]).toBe('cotton_mill-1-1');

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    }, session?.token);
    const builtIndustryId = restored.get(game.id)?.board.slots['birmingham-0'].occupiedBy;

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.board.industryInstances[builtIndustryId ?? '']?.specId).toBe('cotton_mill-1-1');
  });

  it('does not consume player stack tiles for invalid active industries from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-invalid-active-industry', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.handCardIds = ['p2-location-birmingham-1'];
    game.board.slots['ghost-slot'] = {occupiedBy: 'ghost-cotton'};
    game.board.industryInstances['ghost-cotton'] = {
      id: 'ghost-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      level: 1,
      locationId: 'birmingham',
      slotId: 'ghost-slot',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.board.industryInstances['ghost-cotton'].removedFromGame).toBe(true);
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toEqual([]);
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder[0]).toBe('cotton_mill-1-1');

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    }, session?.token);
    const builtIndustryId = restored.get(game.id)?.board.slots['birmingham-0'].occupiedBy;

    expect(result.ok).toBe(true);
    expect(builtIndustryId).toEqual(expect.any(String));
    expect(restored.get(game.id)?.board.industryInstances[builtIndustryId ?? '']?.specId).toBe('cotton_mill-1-1');
  });

  it('does not consume stack tiles for invalid Rail-era Canal-only ghosts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-rail-canal-ghost', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.era = 'rail';
    game.actionsAllowedThisTurn = 2;
    game.board.industryInstances['missed-cleanup-cotton'] = {
      id: 'missed-cleanup-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.slots['birmingham-0'] = {occupiedBy: 'missed-cleanup-cotton'};
    game.board.industryInstances['ghost-cotton'] = {
      id: 'ghost-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-2',
      level: 1,
      locationId: 'birmingham',
      slotId: 'ghost-slot',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.slots['ghost-slot'] = {occupiedBy: 'ghost-cotton'};

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.board.industryInstances['missed-cleanup-cotton'].removedFromGame).toBe(true);
    expect(restoredGame?.board.industryInstances['ghost-cotton'].removedFromGame).toBe(true);
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder).not.toContain('cotton_mill-1-1');
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.availableSpecIdsInOrder).toContain('cotton_mill-1-2');
    expect(restoredGame?.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toEqual([]);
  });

  it('normalizes stale board occupancy from legacy persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-occupancy', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.players.p1.handCardIds = ['p2-location-birmingham-1'];
    game.board.industryInstances['removed-cotton'] = {
      id: 'removed-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: false,
      remainingResource: 1,
      removedFromGame: true,
    };
    game.board.slots['birmingham-0'] = {occupiedBy: 'removed-cotton'};
    game.board.slots['birmingham-1'] = {occupiedBy: 'missing-industry'};
    game.board.slots['ghost-slot'] = {occupiedBy: 'ghost-cotton'};
    game.board.linkLines['birmingham-walsall'] = {occupiedBy: 'missing-link'};
    game.board.linkLines['ghost-link-line'] = {occupiedBy: 'missing-link'};
    game.board.industryInstances['ghost-cotton'] = {
      id: 'ghost-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      level: 1,
      locationId: 'birmingham',
      slotId: 'ghost-slot',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.industryInstances['manufacturer-a'] = {
      id: ' manufacturer-a ',
      ownerPlayerId: ' p1 ',
      industryType: ' manufacturer ',
      specId: '\tmanufacturer-1-1\n',
      level: 1,
      locationId: ' walsall ',
      slotId: ' walsall-0 ',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    } as unknown as GameState['board']['industryInstances'][string];
    game.board.industryInstances['manufacturer-b'] = {
      id: 'manufacturer-b',
      ownerPlayerId: 'p2',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      level: 1,
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.industryInstances['orphan-iron'] = {
      id: 'orphan-iron',
      ownerPlayerId: 'ghost-player',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      level: 1,
      locationId: 'walsall',
      slotId: 'walsall-1',
      flipped: false,
      remainingResource: 1,
      removedFromGame: false,
    };
    game.board.industryInstances['wrong-location-manufacturer'] = {
      id: 'wrong-location-manufacturer',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      level: 1,
      locationId: 'walsall',
      slotId: 'birmingham-1',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.industryInstances['wrong-slot-cotton'] = {
      id: 'wrong-slot-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.linkInstances['link-a'] = {
      id: '\tlink-a ',
      ownerPlayerId: ' p1 ',
      linkLineId: ' walsall-wolverhampton ',
      linkType: ' canal ',
    } as unknown as GameState['board']['linkInstances'][string];
    game.board.linkInstances['link-b'] = {
      id: 'link-b',
      ownerPlayerId: 'p2',
      linkLineId: 'walsall-wolverhampton',
      linkType: 'canal',
    };
    game.board.linkInstances['invalid-canal-link'] = {
      id: 'invalid-canal-link',
      ownerPlayerId: 'p1',
      linkLineId: 'birmingham-nuneaton',
      linkType: 'canal',
    };
    game.board.linkInstances['inactive-merchant-link'] = {
      id: 'inactive-merchant-link',
      ownerPlayerId: 'p1',
      linkLineId: 'stokeOnTrent-warrington',
      linkType: 'canal',
    };
    game.board.linkInstances[' missing-id-link '] = {
      id: '',
      ownerPlayerId: '\tp1\n',
      linkLineId: '\tbirmingham-walsall\n',
      linkType: ' canal ',
    } as unknown as GameState['board']['linkInstances'][string];
    game.board.linkInstances['non-object-link'] = null as unknown as typeof game.board.linkInstances[string];
    game.board.linkInstances['orphan-link'] = {
      id: 'orphan-link',
      ownerPlayerId: 'ghost-player',
      linkLineId: 'birmingham-dudley',
      linkType: 'canal',
    };
    game.board.linkInstances['wrong-type-link'] = {
      id: 'wrong-type-link',
      ownerPlayerId: 'p1',
      linkLineId: 'birmingham-nuneaton',
      linkType: 'canal',
    };
    game.board.linkInstances['wrong-era-link'] = {
      id: 'wrong-era-link',
      ownerPlayerId: 'p1',
      linkLineId: 'birmingham-dudley',
      linkType: 'rail',
    };
    game.players.p1.remainingLinks.canal = staticConfig.rules.initialLinksPerType;
    game.players.p2.remainingLinks.canal = 0;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.board.slots['birmingham-0'].occupiedBy).toBeUndefined();
    expect(restoredGame?.board.slots['birmingham-1'].occupiedBy).toBeUndefined();
    expect(restoredGame?.board.slots['ghost-slot']).toBeUndefined();
    expect(restoredGame?.board.linkLines['birmingham-walsall'].occupiedBy).toBe('missing-id-link');
    expect(restoredGame?.board.linkLines['ghost-link-line']).toBeUndefined();
    expect(restoredGame?.board.slots['walsall-0'].occupiedBy).toBe('manufacturer-a');
    expect(restoredGame?.board.industryInstances['removed-cotton'].remainingResource).toBe(0);
    expect(restoredGame?.board.industryInstances['ghost-cotton'].removedFromGame).toBe(true);
    expect(restoredGame?.board.industryInstances['manufacturer-b'].removedFromGame).toBe(true);
    expect(restoredGame?.board.industryInstances['orphan-iron'].removedFromGame).toBe(true);
    expect(restoredGame?.board.industryInstances['orphan-iron'].remainingResource).toBe(0);
    expect(restoredGame?.board.industryInstances['wrong-location-manufacturer'].removedFromGame).toBe(true);
    expect(restoredGame?.board.industryInstances['wrong-slot-cotton'].removedFromGame).toBe(true);
    expect(restoredGame?.board.linkLines['walsall-wolverhampton'].occupiedBy).toBe('link-a');
    expect(restoredGame?.board.linkInstances['link-b']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['invalid-canal-link']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['inactive-merchant-link']).toBeUndefined();
    expect(restoredGame?.board.linkLines['stokeOnTrent-warrington'].occupiedBy).toBeUndefined();
    expect(restoredGame?.board.linkInstances['non-object-link']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['orphan-link']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['wrong-type-link']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['wrong-era-link']).toBeUndefined();
    expect(restoredGame?.board.linkInstances['missing-id-link']).toEqual({
      id: 'missing-id-link',
      ownerPlayerId: 'p1',
      linkLineId: 'birmingham-walsall',
      linkType: 'canal',
    });
    expect(restoredGame?.players.p1.remainingLinks.canal).toBe(staticConfig.rules.initialLinksPerType - 2);
    expect(restoredGame?.players.p2.remainingLinks.canal).toBe(staticConfig.rules.initialLinksPerType);

    const session = restored.getPlayerSession(game.id, 'p1');
    const result = restored.apply(game.id, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.board.slots['birmingham-0'].occupiedBy).toEqual(expect.any(String));
  });
});
