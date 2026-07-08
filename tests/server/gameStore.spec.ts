import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGame} from '../../src/common/gameSetup';
import {getCurrentPlayerId} from '../../src/common/selectors';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../../src/common/staticData';
import type {GameState, PlayerCount} from '../../src/common/types';
import {GameStore} from '../../src/server/gameStore';
import {addIndustry} from '../helpers';

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

  it('returns validation errors for illegal commands', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben'], seed: 5});
    const cardId = game.players.p2.handCardIds[0];
    const session = store.getPlayerSession(game.id, 'p2');

    const result = store.apply(game.id, {type: 'pass', playerId: 'p2', cardId}, session?.token);

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain("p1's turn");
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

    expect(store.apply(game.id, null, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.apply(game.id, {type: 'pass'}, 'not-a-session')).toEqual({
      ok: false,
      errors: ['Malformed command'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
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

  it('rejects malformed resource source payloads before rules execution', () => {
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
      coalSources: [{kind: 'market', market: 'coal', price: 'cheap'}],
    }, session?.token);

    expect(result).toEqual({
      ok: false,
      errors: ['network command field coalSources[0].price must be a finite number'],
    });
    expect(store.get(game.id)?.currentTurnIndex).toBe(0);
    expect(store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
  });

  it('rejects non-integer or negative market resource prices before rules execution', () => {
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
    delete onePlayerGame.players.p2;

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [
        null,
        42,
        {id: 'missing-players'},
        blankIdGame,
        onePlayerGame,
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
    expect(restored.getPlayerSession(validGame.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(onePlayerGame.id, 'p1')).toBeUndefined();

    const p2Session = restored.getPlayerSession(validGame.id, 'p2');
    expect(p2Session?.token).toEqual(expect.any(String));
    expect(p2Session?.token).not.toBe('');
  });

  it('lists player names in stable seat order instead of current turn order', () => {
    const store = new GameStore();
    const game = store.create({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5});
    game.turnOrder = ['p3', 'p1', 'p2'];
    game.status = 'ended';

    expect(store.list()).toEqual([
      {
        id: game.id,
        playerNames: ['Ada', 'Ben', 'Cara'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'ended',
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

  it('normalizes loaded player count and player basics from persisted games', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-player-count', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    game.playerCount = 4;
    game.players.p1.id = 'wrong-id';
    game.players.p1.name = '  Ada  ';
    game.players.p1.handCardIds = 'not-an-array' as unknown as string[];
    game.players.p2.name = '';
    game.players.p2.discardCardIds = null as unknown as string[];
    (game.players as unknown as Record<string, unknown>).ghost = null;
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
        ],
      },
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.playerCount).toBe(2);
    expect(Object.keys(restoredGame?.players ?? {})).toEqual(['p1', 'p2']);
    expect(restoredGame?.players.p1.id).toBe('p1');
    expect(restoredGame?.players.p1.name).toBe('Ada');
    expect(restoredGame?.players.p1.handCardIds).toEqual([]);
    expect(restoredGame?.players.p2.id).toBe('p2');
    expect(restoredGame?.players.p2.name).toBe('Player 2');
    expect(restoredGame?.players.p2.discardCardIds).toEqual([]);
    expect(Object.keys(restoredGame?.board.merchantSpaces ?? {}).sort()).toEqual(expectedMerchantSpaceIds(2));
    expect(restored.getPlayerSessions(game.id).map((session) => session.playerId).sort()).toEqual(['p1', 'p2']);
    expect(restored.getPlayerSession(game.id, 'p1')).toEqual({playerId: 'p1', token: 'persisted-p1-token'});
    expect(restored.getPlayerSession(game.id, 'ghost')).toBeUndefined();

    const regularCards = regularCardsInZones(restoredGame as GameState);
    expect(regularCards.sort()).toEqual([...getCardIdsForPlayerCount(2)].sort());
    expectUnique(regularCards);
  });

  it('normalizes stale event logs from persisted games before applying commands', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-store-'));
    const storagePath = path.join(directory, 'games.json');
    const game = createGame({id: 'legacy-event-log', playerNames: ['Ada', 'Ben'], seed: 5, initialTurnOrder: ['p1', 'p2']});
    const originalGameCreated = game.eventLog[0];
    game.eventLog = [
      originalGameCreated,
      'not-an-event',
      {type: 123},
      {type: 'legacy_debug_marker', value: 1},
    ] as unknown as GameState['eventLog'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.eventLog).toEqual([
      originalGameCreated,
      {type: 'legacy_debug_marker', value: 1},
    ]);

    const session = restored.getPlayerSession(game.id, 'p1');
    const cardId = restoredGame?.players.p1.handCardIds[0];
    const result = restored.apply(game.id, {type: 'pass', playerId: 'p1', cardId}, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.eventLog).toContainEqual({type: 'card_discarded', playerId: 'p1', cardId, destination: 'discard'});
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
      'missing-card',
    ];
    game.players.p1.discardCardIds = [
      p1DiscardCard,
      p1HandCard,
      'wild-industry-1',
      'missing-card',
    ];
    game.players.p1.faceDownDiscardCount = 99;
    game.cardZones.drawDeck = [
      drawCard,
      drawCard,
      p1HandCard,
      'wild-location-2',
      'missing-card',
    ];
    game.cardZones.wildLocationPool = [
      'wild-location-1',
      'wild-location-2',
      'wild-industry-2',
      'missing-card',
    ];
    game.cardZones.wildIndustryPool = [
      'wild-industry-1',
      'wild-industry-1',
      'wild-location-3',
      'missing-card',
    ];

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
    game.turnOrder = ['ghost-player', 'p2', 'p2'];
    game.currentTurnIndex = 99;
    game.actionIndexInTurn = 99;
    game.actionsAllowedThisTurn = 99 as GameState['actionsAllowedThisTurn'];

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [game],
    }));

    const restored = new GameStore({storagePath});
    const restoredGame = restored.get(game.id);

    expect(restoredGame?.turnOrder).toEqual(['p2', 'p1', 'p3']);
    expect(restoredGame?.currentTurnIndex).toBe(0);
    expect(restoredGame?.actionIndexInTurn).toBe(0);
    expect(restoredGame?.actionsAllowedThisTurn).toBe(1);
    expect(restoredGame ? getCurrentPlayerId(restoredGame) : undefined).toBe('p2');

    const session = restored.getPlayerSession(game.id, 'p2');
    const result = restored.apply(game.id, {
      type: 'pass',
      playerId: 'p2',
      cardId: restoredGame?.players.p2.handCardIds[0],
    }, session?.token);

    expect(result.ok).toBe(true);
    expect(restored.get(game.id)?.players.p2.discardCardIds).toContain(restoredGame?.players.p2.handCardIds[0]);
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
      playerId: 'p1',
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
      playerId: 'p1',
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

    const validMerchantGame = createGame({id: 'legacy-valid-merchant-pending', playerNames: ['Ada', 'Ben'], seed: 9, initialTurnOrder: ['p1', 'p2']});
    validMerchantGame.currentTurnIndex = 99;
    validMerchantGame.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p2',
      count: 2.9,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-1', 'missing-space', 'gloucester-0'],
    };

    fs.writeFileSync(storagePath, JSON.stringify({
      version: 1,
      games: [negativeIncomeGame, zeroValueNegativeIncomeGame, ghostMerchantGame, validMerchantGame],
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
    expect(restoredGame?.markets.iron.occupiedCount).toBe(0);
    expect(restoredGame?.players.p1.cash).toBe(staticConfig.rules.initialCash);
    expect(restoredGame?.players.p1.victoryPoints).toBe(0);
    expect(restoredGame?.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.positions.length - 1);
    expect(restoredGame?.players.p1.spentThisRound).toBe(4);
    expect(restoredGame?.players.p1.remainingLinks).toEqual({canal: 0, rail: staticConfig.rules.initialLinksPerType});
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

    expect(result.ok).toBe(false);
    expect(result.errors?.join(' ')).toContain('fewer than 1 canal links remaining');
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
      'oxford-0': {id: 'legacy-oxford', merchantTileInstanceId: preservedTile, beerPresent: false},
      'nottingham-0': {id: 'nottingham-0', merchantTileInstanceId: 'nottingham-cotton-0', beerPresent: true},
      'gloucester-0': {id: 'gloucester-0', merchantTileInstanceId: 'missing-spec-0', beerPresent: true},
      'warrington-0': {id: 'warrington-0', merchantTileInstanceId: preservedTile, beerPresent: true},
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
      id: 'manufacturer-a',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      level: 1,
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
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
      id: 'link-a',
      ownerPlayerId: 'p1',
      linkLineId: 'walsall-wolverhampton',
      linkType: 'canal',
    };
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
    game.board.linkInstances['missing-id-link'] = {
      id: '',
      ownerPlayerId: 'p1',
      linkLineId: 'birmingham-walsall',
      linkType: 'canal',
    };
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
