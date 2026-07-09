import {describe, expect, it} from 'vitest';
import type {AddressInfo} from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {io as createClient, type Socket} from 'socket.io-client';
import {advanceIncomeSpaces, getIncomeLevel, retreatIncomeLevels} from '../../src/common/income';
import {staticConfig} from '../../src/common/staticData';
import type {GameState} from '../../src/common/types';
import {createBrassServer, gameStateForPlayer, type BrassServer} from '../../src/server/createServer';
import {GameStore, type PlayerSession} from '../../src/server/gameStore';
import {addIndustry, addLink, setMerchantSpace, testGame} from '../helpers';

interface TestServer extends BrassServer {
  store: GameStore;
  url: string;
}

async function startTestServer(clientDist?: string): Promise<TestServer> {
  const store = new GameStore();
  const brassServer = createBrassServer({store, clientDist});
  await new Promise<void>((resolve) => {
    brassServer.server.listen(0, '127.0.0.1', resolve);
  });
  const address = brassServer.server.address() as AddressInfo;
  return {
    ...brassServer,
    store,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopTestServer(testServer: TestServer): Promise<void> {
  await new Promise<void>((resolve) => {
    testServer.io.close(() => resolve());
  });
  if (testServer.server.listening) {
    await new Promise<void>((resolve, reject) => {
      testServer.server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function connectSocket(url: string): Promise<Socket> {
  const socket = createClient(url, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out connecting socket')), 3000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

function emitWithAck(socket: Socket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

type GameStateProjection = Partial<GameState> & {currentTurnIndex?: number};

function waitForGameState(socket: Socket, predicate: (state: GameStateProjection) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('game:state', listener);
      reject(new Error('Timed out waiting for game:state'));
    }, 3000);
    const listener = (state: GameStateProjection) => {
      if (!predicate(state)) {
        return;
      }
      clearTimeout(timeout);
      socket.off('game:state', listener);
      resolve(state);
    };
    socket.on('game:state', listener);
  });
}

function waitForGameList(socket: Socket, predicate: (payload: {games?: unknown[]}) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('games:list', listener);
      reject(new Error('Timed out waiting for games:list'));
    }, 3000);
    const listener = (payload: {games?: unknown[]}) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timeout);
      socket.off('games:list', listener);
      resolve(payload);
    };
    socket.on('games:list', listener);
  });
}

async function expectNoGameStateWhile<T>(socket: Socket, action: () => Promise<T>, durationMs = 200): Promise<T> {
  let received = false;
  let unexpectedState: unknown;
  const listener = (state: unknown) => {
    received = true;
    unexpectedState = state;
  };
  socket.on('game:state', listener);
  try {
    const result = await action();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (received) {
      throw new Error(`Unexpected game:state broadcast: ${JSON.stringify(unexpectedState)}`);
    }
    return result;
  } finally {
    socket.off('game:state', listener);
  }
}

function expectNoSessionTokens(value: unknown, sessions: PlayerSession[]): void {
  const serialized = JSON.stringify(value);
  for (const session of sessions) {
    expect(serialized).not.toContain(session.token);
  }
}

function prepareSingleCardEraEnd(game: GameState, activePlayerId: string): string {
  const activePlayer = game.players[activePlayerId];
  const cardId = activePlayer?.handCardIds[0];
  if (!activePlayer || !cardId) {
    throw new Error(`Expected ${activePlayerId} to have a final card`);
  }
  for (const player of Object.values(game.players)) {
    player.handCardIds = [];
  }
  activePlayer.handCardIds = [cardId];
  game.cardZones.drawDeck = [];
  game.currentTurnIndex = game.turnOrder.indexOf(activePlayerId);
  if (game.currentTurnIndex < 0) {
    throw new Error(`Expected ${activePlayerId} in turn order`);
  }
  game.actionIndexInTurn = 0;
  game.actionsAllowedThisTurn = 1;
  game.roundNumber = 10;
  return cardId;
}

function prepareEmptyHandSkipEraEnd(game: GameState): {
  p1CardId: string;
  p2FirstCardId: string;
  p2SecondCardId: string;
  p2FinalCardId: string;
} {
  const p1 = game.players.p1;
  const p2 = game.players.p2;
  if (!p1 || !p2) {
    throw new Error('Expected p1 and p2 players');
  }
  const p1CardId = 'p2-location-birmingham-1';
  const p2FirstCardId = 'p2-location-cannock-1';
  const p2SecondCardId = 'p2-location-coalbrookdale-1';
  const p2FinalCardId = 'p2-location-coventry-1';
  game.roundNumber = 9;
  game.actionsAllowedThisTurn = 2;
  game.actionIndexInTurn = 0;
  game.currentTurnIndex = game.turnOrder.indexOf('p1');
  if (game.currentTurnIndex < 0) {
    throw new Error('Expected p1 in turn order');
  }
  game.cardZones.drawDeck = [];
  p1.discardCardIds = [];
  p1.faceDownDiscardCount = 0;
  p1.handCardIds = [p1CardId];
  p2.discardCardIds = [];
  p2.faceDownDiscardCount = 0;
  p2.handCardIds = [p2FirstCardId, p2SecondCardId, p2FinalCardId];
  return {p1CardId, p2FirstCardId, p2SecondCardId, p2FinalCardId};
}

describe('createBrassServer', () => {
  it('projects observer game state with private hands and deck redacted', () => {
    const game = testGame();
    game.cardZones.drawDeck = ['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1', 'secret-token'];
    game.players.p1.discardCardIds = ['p2-location-cannock-1', 'p2-location-birmingham-1', 'secret-token'];
    game.players.p1.faceDownDiscardCount = 1;
    game.players.p2.discardCardIds = ['p2-location-birmingham-1', 'p2-location-cannock-1', 'secret-token'];
    game.players.p2.faceDownDiscardCount = 1;

    const view = gameStateForPlayer(game);

    expect(view.players.p1.handCardIds).toHaveLength(game.players.p1.handCardIds.length);
    expect(view.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.players.p2.handCardIds).toHaveLength(game.players.p2.handCardIds.length);
    expect(view.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.cardZones.drawDeck).toEqual(['hidden-card-1', 'hidden-card-2', 'hidden-card-3']);
    expect(view.players.p1.discardCardIds).toEqual(['hidden-card-1', 'p2-location-birmingham-1']);
    expect(view.players.p2.discardCardIds).toEqual(['hidden-card-1', 'p2-location-cannock-1']);
    expect(JSON.stringify(view)).not.toContain('secret-token');
    expect(game.cardZones.drawDeck).toEqual(['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1', 'secret-token']);
    expect(game.players.p1.discardCardIds).toEqual(['p2-location-cannock-1', 'p2-location-birmingham-1', 'secret-token']);
  });

  it('projects a player game state with only that player hand visible', () => {
    const game = testGame();
    const p2Hand = [...game.players.p2.handCardIds];
    game.players.p2.handCardIds.push('secret-token');

    const view = gameStateForPlayer(game, 'p2');

    expect(view.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.players.p2.handCardIds).toEqual(p2Hand);
    expect(view.players.p2.handCardIds).not.toBe(game.players.p2.handCardIds);
    expect(JSON.stringify(view)).not.toContain('secret-token');

    view.players.p2.handCardIds.push('mutated-view-card');

    expect(game.players.p2.handCardIds).not.toContain('mutated-view-card');
  });

  it('projects an isolated game snapshot without sharing mutable state', () => {
    const game = testGame();
    const originalEventCount = game.eventLog.length;
    const originalCoalMarket = game.markets.coal.occupiedCount;
    const originalSlot = game.board.slots['birmingham-0'];

    const view = gameStateForPlayer(game, 'p1');
    view.board.slots['birmingham-0'] = {occupiedBy: 'view-only-industry'};
    view.eventLog.push({type: 'scouted', playerId: 'p1'});
    view.markets.coal.occupiedCount = 0;
    view.cardZones.wildLocationPool.pop();

    expect(game.board.slots['birmingham-0']).toBe(originalSlot);
    expect(game.board.slots['birmingham-0'].occupiedBy).toBeUndefined();
    expect(game.eventLog).toHaveLength(originalEventCount);
    expect(game.markets.coal.occupiedCount).toBe(originalCoalMarket);
    expect(game.cardZones.wildLocationPool).toHaveLength(4);
  });

  it('strips non-state properties from projected game views', () => {
    const game = testGame() as GameState & {
      sessions?: PlayerSession[];
      sessionToken?: string;
      privateNote?: string;
    };
    game.sessions = [{playerId: 'p1', token: 'secret-token'}];
    game.sessionToken = 'secret-token';
    game.privateNote = 'secret-token';

    const view = gameStateForPlayer(game, 'p1') as GameState & Record<string, unknown>;

    expect(view).not.toHaveProperty('sessions');
    expect(view).not.toHaveProperty('sessionToken');
    expect(view).not.toHaveProperty('privateNote');
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });

  it('projects only public game variant values', () => {
    const game = testGame();
    game.variant = 'introductory_canal_only';

    expect(gameStateForPlayer(game, 'p1').variant).toBe('introductory_canal_only');

    (game as unknown as {variant?: string}).variant = 'secret_variant';
    const view = gameStateForPlayer(game, 'p1') as GameState & Record<string, unknown>;

    expect(view).not.toHaveProperty('variant');
    expect(JSON.stringify(view)).not.toContain('secret_variant');
  });

  it('normalizes public player names in projected game views', () => {
    const game = testGame();
    game.players.p1.name = ' Ada\n';
    game.players.p2.name = '   ';
    (game.players.p2 as unknown as {privateNote?: string}).privateNote = 'secret-token';

    const view = gameStateForPlayer(game, 'p1');

    expect(view.players.p1.name).toBe('Ada');
    expect(view.players.p2.name).toBe('Player 2');
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });

  it('projects incomplete turn order with every valid player represented once while preserving the current player', () => {
    const game = testGame();
    game.turnOrder = ['ghost-player', ' p2 ', 'p2'];
    game.currentTurnIndex = 1;

    const view = gameStateForPlayer(game);

    expect(view.turnOrder).toEqual(['p2', 'p1']);
    expect(view.currentTurnIndex).toBe(0);
    expect(view.turnOrder[view.currentTurnIndex]).toBe('p2');
  });

  it('filters inactive high-player-count links from projected game views', () => {
    const game = testGame();
    addLink(game, 'link-1', 'p1', 'birmingham-oxford');
    addLink(game, 'link-2', 'p1', 'stokeOnTrent-warrington');
    game.eventLog.push(
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'stokeOnTrent-warrington',
        },
      },
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: 2},
      {type: 'link_scored', linkInstanceId: 'link-2', ownerPlayerId: 'p1', points: 2},
    );

    const view = gameStateForPlayer(game, 'p1');

    expect(view.playerCount).toBe(2);
    expect(view.board.linkInstances['link-1']).toEqual({
      id: 'link-1',
      ownerPlayerId: 'p1',
      linkType: 'canal',
      linkLineId: 'birmingham-oxford',
    });
    expect(view.board.linkInstances['link-2']).toBeUndefined();
    expect(view.board.linkLines['birmingham-oxford']).toEqual({occupiedBy: 'link-1'});
    expect(view.board.linkLines['stokeOnTrent-warrington']).toEqual({});
    expect(view.players.p1.remainingLinks.canal).toBe(staticConfig.rules.initialLinksPerType - 1);
    expect(view.eventLog).toContainEqual({
      type: 'link_built',
      instance: {
        id: 'link-1',
        ownerPlayerId: 'p1',
        linkType: 'canal',
        linkLineId: 'birmingham-oxford',
      },
    });
    expect(view.eventLog).toContainEqual({type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: 2});
    expect(view.eventLog.some((event) => event.type === 'link_built' && event.instance.id === 'link-2')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'link_scored' && event.linkInstanceId === 'link-2')).toBe(false);
  });

  it('filters inactive high-player-count merchant spaces from projected game views', () => {
    const game = testGame();
    game.board.merchantSpaces['warrington-0'] = {
      id: 'warrington-0',
      merchantTileInstanceId: 'warrington-pottery-0',
      beerPresent: true,
    };
    game.board.merchantSpaces['nottingham-0'] = {
      id: 'nottingham-0',
      merchantTileInstanceId: 'nottingham-cotton-0',
      beerPresent: true,
    };
    game.eventLog.push(
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'warrington-0',
        bonus: {type: 'cash', cash: 5},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'nottingham-0', merchantTileInstanceId: 'nottingham-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
    );

    const view = gameStateForPlayer(game, 'p1');

    expect(view.playerCount).toBe(2);
    expect(view.board.merchantSpaces['oxford-0']).toBeDefined();
    expect(view.board.merchantSpaces['warrington-0']).toBeUndefined();
    expect(view.board.merchantSpaces['nottingham-0']).toBeUndefined();
    expect(view.eventLog.some((event) => event.type === 'merchant_bonus_claimed' && event.merchantSpaceId === 'warrington-0'))
      .toBe(false);
    expect(view.eventLog.some((event) =>
      event.type === 'resource_consumed' &&
      event.source.kind === 'merchant_beer' &&
      event.source.merchantSpaceId === 'nottingham-0',
    )).toBe(false);
  });

  it('normalizes recoverable merchant tile instance ids in projected game views', () => {
    const game = testGame();
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: ' oxford-cotton-0 ',
      beerPresent: true,
    };
    game.eventLog.push({
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: ' oxford-0 ', merchantTileInstanceId: '\toxford-cotton-0\n'},
      byPlayerId: ' p1 ',
      reason: ' sell ',
    } as unknown as GameState['eventLog'][number]);

    const view = gameStateForPlayer(game, 'p1');

    expect(view.board.merchantSpaces['oxford-0']).toEqual({
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: true,
    });
    expect(view.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    });
  });

  it('filters regular cards from other player counts in projected game views', () => {
    const game = testGame();
    game.players.p1.handCardIds = ['p2-location-birmingham-1', 'p4-location-derby-1', 'wild-location-1'];
    game.players.p1.discardCardIds = ['p4-location-derby-2', 'p2-location-cannock-1'];
    game.players.p1.faceDownDiscardCount = 0;
    game.cardZones.drawDeck = ['p4-location-derby-3', 'p2-location-dudley-1', 'wild-industry-1'];
    game.eventLog.push(
      {type: 'card_discarded', playerId: 'p1', cardId: 'p4-location-derby-2', destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1', destination: 'discard'},
    );

    const playerView = gameStateForPlayer(game, 'p1');
    const observerView = gameStateForPlayer(game);

    expect(playerView.playerCount).toBe(2);
    expect(playerView.players.p1.handCardIds).toEqual(['p2-location-birmingham-1', 'wild-location-1']);
    expect(playerView.players.p1.discardCardIds).toEqual(['p2-location-cannock-1']);
    expect(playerView.cardZones.drawDeck).toEqual(['hidden-card-1', 'hidden-card-2']);
    expect(playerView.eventLog).toContainEqual({
      type: 'card_discarded',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      destination: 'discard',
    });
    expect(playerView.eventLog.some((event) => event.type === 'card_discarded' && event.cardId === 'p4-location-derby-2'))
      .toBe(false);
    expect(observerView.players.p1.handCardIds).toEqual(['hidden-card-1', 'hidden-card-2']);
    expect(JSON.stringify(playerView)).not.toContain('p4-location-derby');
    expect(JSON.stringify(observerView)).not.toContain('p4-location-derby');
  });

  it('strips unknown nested state properties from projected game views', () => {
    const game = testGame();
    const secret = 'secret-token';
    const linkLineId = Object.keys(game.board.linkLines)[0] as string;
    const ghostSlotId = Object.keys(game.board.slots).find((slotId) => slotId !== 'birmingham-0') as string;
    const ghostLinkLineId = Object.keys(game.board.linkLines).find((candidate) => candidate !== linkLineId) as string;
    const nonGeneratedLinkLineId = Object.entries(staticConfig.linkLines).find(([candidate, line]) =>
      candidate !== linkLineId &&
      candidate !== ghostLinkLineId &&
      line.allowedLinkTypes.includes('canal'),
    )?.[0] as string;
    const merchantSpaceId = 'gloucester-0';
    const industry = {
      id: 'industry-1',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: ' p1 ',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
      sessionToken: secret,
    } as unknown as GameState['board']['industryInstances'][string];
    const link = {
      id: 'link-1',
      ownerPlayerId: '\tp1\n',
      linkType: 'canal',
      linkLineId,
      sessionToken: secret,
    } as unknown as GameState['board']['linkInstances'][string];
    const ghostIndustry = {
      ...industry,
      id: 'industry-secret',
      ownerPlayerId: secret,
      slotId: ghostSlotId,
    } as unknown as GameState['board']['industryInstances'][string];
    const ghostLink = {
      ...link,
      id: 'link-secret',
      ownerPlayerId: secret,
      linkLineId: ghostLinkLineId,
    } as unknown as GameState['board']['linkInstances'][string];
    const invalidSpecIndustry = {
      ...industry,
      id: 'industry-invalid-spec',
      specId: secret,
    } as unknown as GameState['board']['industryInstances'][string];
    const invalidSlotIndustry = {
      ...industry,
      id: 'industry-invalid-slot',
      slotId: 'birmingham-2',
    } as unknown as GameState['board']['industryInstances'][string];
    const mismatchedKeyIndustry = {
      ...industry,
      id: 'industry-2',
    } as unknown as GameState['board']['industryInstances'][string];
    const orphanActiveIndustry = {
      ...industry,
      id: 'industry-orphan',
      specId: 'manufacturer-1-1',
      industryType: 'manufacturer',
      slotId: 'birmingham-1',
    } as unknown as GameState['board']['industryInstances'][string];
    const removedHistoryIndustry = {
      ...orphanActiveIndustry,
      id: 'industry-4',
      removedFromGame: true,
    } as unknown as GameState['board']['industryInstances'][string];
    const missingBuiltReferenceIndustry = {
      ...industry,
      id: 'industry-3',
      specId: 'manufacturer-1-1',
      industryType: 'manufacturer',
      locationId: 'walsall',
      slotId: 'walsall-0',
    } as unknown as GameState['board']['industryInstances'][string];
    const availableManufacturerSpecId = staticConfig.industryStackSpecIds.manufacturer
      .find((specId) => specId !== missingBuiltReferenceIndustry.specId) as string;
    const removedManufacturerSpecId = staticConfig.industryStackSpecIds.manufacturer
      .find((specId) => specId !== missingBuiltReferenceIndustry.specId && specId !== availableManufacturerSpecId) as string;
    const nonGeneratedActiveIndustry = {
      ...missingBuiltReferenceIndustry,
      id: 'industry-secret-token',
      locationId: 'wolverhampton',
      slotId: 'wolverhampton-0',
    } as unknown as GameState['board']['industryInstances'][string];
    const nonGeneratedRemovedIndustry = {
      ...missingBuiltReferenceIndustry,
      id: 'industry-secret-removed',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
      removedFromGame: true,
    } as unknown as GameState['board']['industryInstances'][string];
    const invalidLineLink = {
      ...link,
      id: 'link-invalid-line',
      linkLineId: secret,
    } as unknown as GameState['board']['linkInstances'][string];
    const mismatchedKeyLink = {
      ...link,
      id: 'link-2',
    } as unknown as GameState['board']['linkInstances'][string];
    const orphanLink = {
      ...link,
      id: 'link-orphan',
    } as unknown as GameState['board']['linkInstances'][string];
    const nonGeneratedLink = {
      ...link,
      id: 'link-secret-token',
      linkLineId: nonGeneratedLinkLineId,
    } as unknown as GameState['board']['linkInstances'][string];

    const corruptGame = game as unknown as Record<string, unknown>;
    corruptGame.playerCount = 99;
    corruptGame.era = 'future';
    corruptGame.status = 'paused';
    corruptGame.roundNumber = 0;
    corruptGame.currentTurnIndex = 99;
    corruptGame.actionIndexInTurn = 99;
    corruptGame.actionsAllowedThisTurn = 99;
    corruptGame.nextInstanceId = secret;
    (game.players as unknown as Record<string, unknown>)[secret] = {
      id: secret,
      name: secret,
      cash: 99,
      victoryPoints: 99,
      incomeTrackPosition: 0,
      spentThisRound: 0,
      handCardIds: [secret],
      discardCardIds: [secret],
      faceDownDiscardCount: 1,
      industryTileStacks: {},
      remainingLinks: {canal: 0, rail: 0},
    };
    (game.players.p1 as GameState['players'][string] & Record<string, unknown>).id = secret;
    (game.players.p1 as GameState['players'][string] & Record<string, unknown>).sessionToken = secret;
    (game.players.p1.industryTileStacks.coal_mine as unknown as Record<string, unknown>).sessionToken = secret;
    game.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = [
      'coal_mine-1-1',
      secret,
    ];
    game.players.p1.industryTileStacks.coal_mine.removedSpecIds = [
      'coal_mine-2-1',
      secret,
    ];
    game.players.p1.industryTileStacks.coal_mine.builtInstanceIds = [
      ghostIndustry.id,
      secret,
    ];
    game.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [
      industry.id,
      industry.id,
      invalidSpecIndustry.id,
      invalidSlotIndustry.id,
      secret,
    ];
    game.players.p1.industryTileStacks.manufacturer.builtInstanceIds = [
      removedHistoryIndustry.id,
      secret,
    ];
    game.players.p1.industryTileStacks.manufacturer.availableSpecIdsInOrder = [
      missingBuiltReferenceIndustry.specId,
      availableManufacturerSpecId,
      availableManufacturerSpecId,
      removedManufacturerSpecId,
      secret,
    ];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = [
      missingBuiltReferenceIndustry.specId,
      removedManufacturerSpecId,
      removedManufacturerSpecId,
      secret,
    ];
    (game.cardZones as GameState['cardZones'] & Record<string, unknown>).sessionToken = secret;
    game.cardZones.wildLocationPool.push(secret, 'wild-industry-1');
    game.cardZones.wildIndustryPool.push(secret, 'wild-location-1');
    (game.markets.coal as GameState['markets']['coal'] & Record<string, unknown>).sessionToken = secret;
    game.markets.coal.occupiedCount = 999;
    game.markets.iron.occupiedCount = -3;
    game.players.p1.cash = null as unknown as number;
    game.players.p1.victoryPoints = -10;
    game.players.p1.incomeTrackPosition = 999;
    game.players.p1.spentThisRound = 4.8;
    game.players.p1.remainingLinks.canal = -2;
    game.players.p1.remainingLinks.rail = 99;
    game.turnOrder = [secret, 'p2', 'p2', 'p1'];
    game.board.industryInstances[industry.id] = industry;
    game.board.industryInstances[ghostIndustry.id] = ghostIndustry;
    game.board.industryInstances[invalidSpecIndustry.id] = invalidSpecIndustry;
    game.board.industryInstances[invalidSlotIndustry.id] = invalidSlotIndustry;
    game.board.industryInstances[secret] = mismatchedKeyIndustry;
    game.board.industryInstances[orphanActiveIndustry.id] = orphanActiveIndustry;
    game.board.industryInstances[removedHistoryIndustry.id] = removedHistoryIndustry;
    game.board.industryInstances[missingBuiltReferenceIndustry.id] = missingBuiltReferenceIndustry;
    game.board.industryInstances[nonGeneratedActiveIndustry.id] = nonGeneratedActiveIndustry;
    game.board.industryInstances[nonGeneratedRemovedIndustry.id] = nonGeneratedRemovedIndustry;
    game.board.linkInstances[link.id] = link;
    game.board.linkInstances[ghostLink.id] = ghostLink;
    game.board.linkInstances[invalidLineLink.id] = invalidLineLink;
    game.board.linkInstances[secret] = mismatchedKeyLink;
    game.board.linkInstances[orphanLink.id] = orphanLink;
    game.board.linkInstances[nonGeneratedLink.id] = nonGeneratedLink;
    game.board.slots['birmingham-0'] = {occupiedBy: ` ${industry.id}\n`, sessionToken: secret} as unknown as GameState['board']['slots'][string];
    game.board.slots['walsall-0'] = {occupiedBy: `\t${missingBuiltReferenceIndustry.id} `, sessionToken: secret} as unknown as GameState['board']['slots'][string];
    game.board.slots['wolverhampton-0'] = {occupiedBy: nonGeneratedActiveIndustry.id, sessionToken: secret} as unknown as GameState['board']['slots'][string];
    game.board.slots[ghostSlotId] = {occupiedBy: ghostIndustry.id, sessionToken: secret} as unknown as GameState['board']['slots'][string];
    game.board.slots['birmingham-2'] = {occupiedBy: invalidSlotIndustry.id, sessionToken: secret} as unknown as GameState['board']['slots'][string];
    game.board.linkLines[linkLineId] = {occupiedBy: ` ${link.id}\t`, sessionToken: secret} as unknown as GameState['board']['linkLines'][string];
    game.board.linkLines[ghostLinkLineId] = {occupiedBy: ghostLink.id, sessionToken: secret} as unknown as GameState['board']['linkLines'][string];
    game.board.linkLines[nonGeneratedLinkLineId] = {occupiedBy: nonGeneratedLink.id, sessionToken: secret} as unknown as GameState['board']['linkLines'][string];
    (game.board.linkLines as unknown as Record<string, unknown>)[secret] = {occupiedBy: invalidLineLink.id, sessionToken: secret};
    game.board.merchantSpaces[merchantSpaceId] = {
      ...game.board.merchantSpaces[merchantSpaceId],
      id: secret,
      sessionToken: secret,
    } as unknown as GameState['board']['merchantSpaces'][string];
    (game.board.merchantSpaces as unknown as Record<string, unknown>)[secret] = {
      id: secret,
      merchantTileInstanceId: secret,
      beerPresent: true,
    };
    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId,
      merchantSpaceIds: [merchantSpaceId, secret],
      sessionToken: secret,
    } as unknown as GameState['pendingDecision'];
    game.lastEraScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 1, p2: 0, [secret]: 99},
      industryVictoryPointsByPlayer: {p1: 2, p2: 0, [secret]: 99},
      totalVictoryPointsByPlayer: {p1: 3, p2: 0, [secret]: 99},
      sessionToken: secret,
    } as unknown as GameState['lastEraScore'];
    game.eventLog.push({
      type: 'loan_taken',
      playerId: secret,
    } as unknown as GameState['eventLog'][number]);

    const view = gameStateForPlayer(game, 'p1') as GameState & Record<string, unknown>;

    expect(view.playerCount).toBe(2);
    expect(view.era).toBe('canal');
    expect(view.status).toBe('playing');
    expect(view.roundNumber).toBe(1);
    expect(view.turnOrder).toEqual(['p2', 'p1']);
    expect(view.currentTurnIndex).toBe(0);
    expect(view.actionIndexInTurn).toBe(0);
    expect(view.actionsAllowedThisTurn).toBe(1);
    expect(view.nextInstanceId).toBe(1);
    expect(view.players.p1.id).toBe('p1');
    expect(view.players.p1.cash).toBe(staticConfig.rules.initialCash);
    expect(view.players.p1.victoryPoints).toBe(0);
    expect(view.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.positions.length - 1);
    expect(view.players.p1.spentThisRound).toBe(4);
    expect(view.players[secret]).toBeUndefined();
    expect(view.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder).toEqual(['coal_mine-1-1']);
    expect(view.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-2-1']);
    expect(view.players.p1.industryTileStacks.coal_mine.builtInstanceIds).toEqual([]);
    expect(view.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toEqual([industry.id]);
    expect(view.players.p1.industryTileStacks.manufacturer.availableSpecIdsInOrder).toEqual([availableManufacturerSpecId]);
    expect(view.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual([removedManufacturerSpecId]);
    expect(view.players.p1.industryTileStacks.manufacturer.builtInstanceIds).toEqual([missingBuiltReferenceIndustry.id]);
    expect(view.players.p1.remainingLinks).toEqual({
      canal: staticConfig.rules.initialLinksPerType - 1,
      rail: staticConfig.rules.initialLinksPerType,
    });
    expect(view.players.p1).not.toHaveProperty('sessionToken');
    expect(view.players.p1.industryTileStacks.coal_mine).not.toHaveProperty('sessionToken');
    expect(view.board.industryInstances[industry.id]).toEqual({
      id: 'industry-1',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    });
    expect(view.board.linkInstances[link.id]).toEqual({
      id: 'link-1',
      ownerPlayerId: 'p1',
      linkType: 'canal',
      linkLineId,
    });
    expect(view.board.industryInstances[ghostIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[invalidSpecIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[invalidSlotIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[secret]).toBeUndefined();
    expect(view.board.industryInstances[mismatchedKeyIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[orphanActiveIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[nonGeneratedActiveIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[nonGeneratedRemovedIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[removedHistoryIndustry.id]).toEqual({
      id: 'industry-4',
      specId: 'manufacturer-1-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-1',
      flipped: false,
      remainingResource: 0,
      removedFromGame: true,
    });
    expect(view.board.industryInstances[missingBuiltReferenceIndustry.id]).toEqual({
      id: 'industry-3',
      specId: 'manufacturer-1-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      level: 1,
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    });
    expect(view.board.linkInstances[ghostLink.id]).toBeUndefined();
    expect(view.board.linkInstances[invalidLineLink.id]).toBeUndefined();
    expect(view.board.linkInstances[secret]).toBeUndefined();
    expect(view.board.linkInstances[mismatchedKeyLink.id]).toBeUndefined();
    expect(view.board.linkInstances[orphanLink.id]).toBeUndefined();
    expect(view.board.linkInstances[nonGeneratedLink.id]).toBeUndefined();
    expect(view.board.slots['birmingham-0']).toEqual({occupiedBy: industry.id});
    expect(view.board.slots['walsall-0']).toEqual({occupiedBy: missingBuiltReferenceIndustry.id});
    expect(view.board.slots['wolverhampton-0']).toEqual({});
    expect(view.board.slots[ghostSlotId]).toEqual({});
    expect(view.board.slots['birmingham-2']).toEqual({});
    expect(view.board.linkLines[linkLineId]).toEqual({occupiedBy: link.id});
    expect(view.board.linkLines[ghostLinkLineId]).toEqual({});
    expect(view.board.linkLines[nonGeneratedLinkLineId]).toEqual({});
    expect(view.board.linkLines[secret]).toBeUndefined();
    expect(view.board.merchantSpaces[merchantSpaceId].id).toBe(merchantSpaceId);
    expect(view.board.merchantSpaces[secret]).toBeUndefined();
    expect(view.board.merchantSpaces[merchantSpaceId]).not.toHaveProperty('sessionToken');
    expect(view.cardZones).not.toHaveProperty('sessionToken');
    expect(view.cardZones.wildLocationPool.every((cardId) => cardId.startsWith('wild-location-'))).toBe(true);
    expect(view.cardZones.wildIndustryPool.every((cardId) => cardId.startsWith('wild-industry-'))).toBe(true);
    expect(view.markets.coal).not.toHaveProperty('sessionToken');
    expect(view.markets.coal.occupiedCount).toBe(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive.length);
    expect(view.markets.iron.occupiedCount).toBe(0);
    expect(view.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId,
      merchantSpaceIds: [merchantSpaceId],
    });
    expect(view.lastEraScore).toEqual({
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 1, p2: 0},
      industryVictoryPointsByPlayer: {p1: 2, p2: 0},
      totalVictoryPointsByPlayer: {p1: 3, p2: 0},
    });
    expect(view.eventLog).not.toContainEqual({type: 'loan_taken', playerId: secret});
    expect(JSON.stringify(view)).not.toContain(secret);
  });

  it('omits pending decisions whose public fields do not match the current game', () => {
    const game = testGame();

    game.status = 'ended';
    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.status = 'playing';
    game.pendingDecision = {
      type: 'negative_income',
      playerId: ' p1 ',
      amountOwed: 3,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 0,
    });

    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'ghost-player',
      amountOwed: 3,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 1.5,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 0,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 99,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.turnOrder = ['p2', 'p1'];
    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 3,
      incomePlayerIndex: 0,
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: ' p1 ',
      count: 99,
      merchantSpaceId: ' gloucester-0 ',
      merchantSpaceIds: [' gloucester-1 ', 'missing-space', '\tgloucester-0\n'],
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
    });

    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1.5,
      merchantSpaceId: 'gloucester-0',
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'missing-space',
      merchantSpaceIds: ['missing-space'],
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'oxford-0',
      merchantSpaceIds: ['oxford-0'],
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toBeUndefined();

    game.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'oxford-0'],
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
    });
  });

  it('drops projected game state fields with impossible numeric values', () => {
    const game = testGame();
    const negativeResourceIndustry = {
      id: 'industry-1',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: false,
      remainingResource: -1,
      removedFromGame: false,
    } as unknown as GameState['board']['industryInstances'][string];
    const fractionalResourceIndustry = {
      ...negativeResourceIndustry,
      id: 'industry-2',
      remainingResource: 0.5,
    } as unknown as GameState['board']['industryInstances'][string];
    const fractionalLevelIndustry = {
      ...negativeResourceIndustry,
      id: 'industry-3',
      level: 1.5,
      remainingResource: 0,
    } as unknown as GameState['board']['industryInstances'][string];
    game.board.industryInstances[negativeResourceIndustry.id] = negativeResourceIndustry;
    game.board.industryInstances[fractionalResourceIndustry.id] = fractionalResourceIndustry;
    game.board.industryInstances[fractionalLevelIndustry.id] = fractionalLevelIndustry;
    game.board.slots['birmingham-0'] = {occupiedBy: negativeResourceIndustry.id};
    game.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(
      negativeResourceIndustry.id,
      fractionalResourceIndustry.id,
      fractionalLevelIndustry.id,
    );
    game.lastEraScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 1.5, p2: 0},
      industryVictoryPointsByPlayer: {p1: 2, p2: 0},
      totalVictoryPointsByPlayer: {p1: 3, p2: 0},
    } as unknown as GameState['lastEraScore'];

    const view = gameStateForPlayer(game);

    expect(view.board.industryInstances[negativeResourceIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[fractionalResourceIndustry.id]).toBeUndefined();
    expect(view.board.industryInstances[fractionalLevelIndustry.id]).toBeUndefined();
    expect(view.board.slots['birmingham-0']).toEqual({});
    expect(view.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).toEqual([]);
    expect(view.lastEraScore).toBeUndefined();
  });

  it('strips unknown fields from projected event logs', () => {
    const game = testGame();
    game.players.p1.discardCardIds = ['p2-location-birmingham-1'];
    game.players.p1.faceDownDiscardCount = 1;
    game.board.industryInstances['industry-1'] = {
      id: 'industry-1',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.slots['birmingham-0'] = {occupiedBy: 'industry-1'};
    game.board.industryInstances['industry-2'] = {
      id: 'industry-2',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'coventry',
      slotId: 'coventry-0',
      flipped: false,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.slots['coventry-0'] = {occupiedBy: 'industry-2'};
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: false,
    };
    addLink(game, 'link-1', 'p1', 'birmingham-oxford');
    Object.assign(game.eventLog[0] as unknown as {gameId: string; playerIds: string[]}, {
      gameId: ` ${game.id} `,
      playerIds: [' p2 ', 'secret-token', '\tp1\n', 'p2'],
    });
    game.eventLog.push(
      {
        type: 'game_created',
        gameId: game.id,
        playerIds: ['p1', 'secret-token'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'card_discarded',
        playerId: ' p1 ',
        cardId: 'p2-location-birmingham-1',
        destination: 'discard',
        sessionToken: 'secret-token',
        debug: () => 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'card_discarded',
        playerId: 'p1',
        cardId: 'secret-token',
        destination: 'discard',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'cash_changed',
        playerId: '\tp1\n',
        delta: 2,
        reason: 'income',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 99,
        reason: 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 5,
        reason: 'build',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 0,
        reason: 'income',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 10,
        to: 15,
        reason: 'sold cotton_mill',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 10,
        to: 99,
        reason: 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 15,
        to: 10,
        reason: 'sold cotton_mill',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: -1,
        to: 15,
        reason: 'sold cotton_mill',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_built',
        sessionToken: 'secret-token',
        instance: {
          id: 'industry-1',
          specId: 'cotton_mill-1-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          level: 1,
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
          sessionToken: 'secret-token',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_built',
        instance: {
          id: 'secret-token',
          specId: 'cotton_mill-1-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          level: 1,
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_built',
        instance: {
          id: 'industry-invalid-spec',
          specId: 'secret-token',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          level: 1,
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'secret-token',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-invalid-line',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'secret-token',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_flipped',
        industryInstanceId: 'secret-token',
        ownerPlayerId: 'p1',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_flipped',
        industryInstanceId: 'industry-2',
        ownerPlayerId: 'p1',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_sold',
        industryInstanceId: 'industry-1',
        ownerPlayerId: 'p1',
        merchantSpaceId: 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_sold',
        industryInstanceId: 'industry-2',
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: 'secret-token', resourceType: 'beer'},
        byPlayerId: 'p1',
        reason: 'sell',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'secret-token', merchantTileInstanceId: 'secret-token'},
        byPlayerId: 'p1',
        reason: 'sell',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: 1},
        byPlayerId: 'p1',
        reason: 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_sold_to_market',
        industryInstanceId: 'secret-token',
        market: 'coal',
        cashReceived: 3,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: ' link-1 ',
        ownerPlayerId: ' p1 ',
        points: 3,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-2',
        ownerPlayerId: 'p1',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p2',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'secret-token',
        ownerPlayerId: 'p1',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: 'secret-token',
        ownerPlayerId: 'p1',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'secret-token',
        bonus: {type: 'cash', cash: 5},
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'oxford-0'],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        merchantSpaceIds: ['oxford-0', 'secret-token'],
        industryTypes: ['cotton_mill'],
        specIds: ['secret-token'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 3,
        paid: 3,
        victoryPointLoss: 0,
        industryInstanceIds: ['secret-token'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'legacy_secret',
        sessionToken: 'secret-token',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 1, p2: 0, 'secret-token': 99},
          industryVictoryPointsByPlayer: {p1: 2, p2: 0, 'secret-token': 99},
          totalVictoryPointsByPlayer: {p1: 3, p2: 0, 'secret-token': 99},
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'turn_order_updated',
        order: ['secret-token', ' p2 ', 'p2', '\tp1\n'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'turn_order_updated',
        order: ['p1', 'ghost-player'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'game_ended',
        winners: ['secret-token', ' p1 ', 'p1'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'loan_taken',
        playerId: 'secret-token',
      } as unknown as GameState['eventLog'][number],
    );

    const view = gameStateForPlayer(game);
    const builtEvent = view.eventLog.find((event) => event.type === 'industry_built');
    const eraEndedEvent = view.eventLog.find((event) => event.type === 'era_ended');

    expect(view.eventLog).toContainEqual({
      type: 'game_created',
      gameId: game.id,
      playerIds: ['p1', 'p2'],
    });
    expect(view.eventLog.filter((event) => event.type === 'game_created')).toEqual([{
      type: 'game_created',
      gameId: game.id,
      playerIds: ['p1', 'p2'],
    }]);
    expect(view.eventLog).toContainEqual({
      type: 'card_discarded',
      playerId: 'p1',
      cardId: 'hidden-card-1',
      destination: 'discard',
    });
    expect(view.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 2, reason: 'income'});
    expect(view.eventLog).toContainEqual({
      type: 'income_position_changed',
      playerId: 'p1',
      from: 10,
      to: 15,
      reason: 'sold cotton_mill',
    });
    expect(view.eventLog.some((event) => (event as {type: string}).type === 'legacy_secret')).toBe(false);
    expect(builtEvent).toEqual({
      type: 'industry_built',
      instance: {
        id: 'industry-1',
        specId: 'cotton_mill-1-1',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        level: 1,
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: false,
        remainingResource: 0,
        removedFromGame: false,
      },
    });
    expect(eraEndedEvent).toEqual({
      type: 'era_ended',
      era: 'canal',
      score: {
        era: 'canal',
        linkVictoryPointsByPlayer: {p1: 1, p2: 0},
        industryVictoryPointsByPlayer: {p1: 2, p2: 0},
        totalVictoryPointsByPlayer: {p1: 3, p2: 0},
      },
    });
    expect(view.eventLog).toContainEqual({type: 'turn_order_updated', order: ['p2', 'p1']});
    expect(view.eventLog.filter((event) => event.type === 'turn_order_updated')).toEqual([
      {type: 'turn_order_updated', order: ['p2', 'p1']},
    ]);
    expect(view.eventLog.some((event) => event.type === 'game_ended')).toBe(false);
    expect(view.eventLog).toContainEqual({type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: 3});
    expect(view.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    });
    expect(view.eventLog.filter((event) => event.type === 'merchant_develop_resolved')).toEqual([{
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    }]);
    expect(view.eventLog.filter((event) => event.type === 'link_scored')).toEqual([
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: 3},
    ]);
    expect(view.eventLog).not.toContainEqual({type: 'loan_taken', playerId: 'secret-token'});
    expect(view.eventLog.some((event) => event.type === 'industry_built' && event.instance.id === 'secret-token')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'industry_built' && event.instance.id === 'industry-invalid-spec')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'link_built' && event.instance.id === 'secret-token')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'link_built' && event.instance.id === 'link-invalid-line')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'industry_flipped' && event.industryInstanceId === 'industry-2')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'industry_sold' && event.industryInstanceId === 'industry-2')).toBe(false);
    expect(JSON.stringify(view)).not.toContain('secret-token');
    expect(JSON.stringify(view)).not.toContain('p2-location-birmingham-1');
  });

  it('projects game ended events only when winners match final standings', () => {
    const game = testGame();
    game.status = 'ended';
    game.players.p1.victoryPoints = 20;
    game.players.p2.victoryPoints = 20;
    game.players.p1.incomeTrackPosition = staticConfig.incomeTrack.startPosition;
    game.players.p2.incomeTrackPosition = staticConfig.incomeTrack.startPosition + 1;
    game.players.p1.cash = 99;
    game.players.p2.cash = 0;
    game.eventLog = [
      {type: 'game_ended', winners: [' ghost ', ' p2 ', 'p2']},
      {type: 'game_ended', winners: ['p1']},
      {type: 'game_ended', winners: ['p1', 'p2']},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'game_ended', winners: ['p2']},
    ]);
  });

  it('projects lifecycle events only once in public logs', () => {
    const game = testGame();
    game.status = 'ended';
    game.players.p1.victoryPoints = 10;
    game.players.p2.victoryPoints = 3;
    const canalScore = {
      era: 'canal' as const,
      linkVictoryPointsByPlayer: {p1: 1, p2: 0},
      industryVictoryPointsByPlayer: {p1: 2, p2: 1},
      totalVictoryPointsByPlayer: {p1: 3, p2: 1},
    };
    const railScore = {
      era: 'rail' as const,
      linkVictoryPointsByPlayer: {p1: 2, p2: 1},
      industryVictoryPointsByPlayer: {p1: 4, p2: 0},
      totalVictoryPointsByPlayer: {p1: 6, p2: 1},
    };
    game.eventLog = [
      {type: 'game_created', gameId: ` ${game.id} `, playerIds: [' p1 ', ' p2 ']},
      {type: 'game_created', gameId: game.id, playerIds: ['p2', 'p1']},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p1']},
      {type: 'game_ended', winners: [' p1 ', 'p1']},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'game_created', gameId: game.id, playerIds: ['p1', 'p2']},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p1']},
    ]);
  });

  it('projects turn advanced events once per player per round and resets after Canal era end', () => {
    const game = testGame();
    const canalScore = {
      era: 'canal' as const,
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    };
    game.eventLog = [
      {type: 'turn_advanced', currentPlayerId: ' p1 ', roundNumber: 1},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 1},
      {type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 1},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 3},
      {type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 2},
      {type: 'turn_advanced', currentPlayerId: 'secret-token', roundNumber: 4},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 1},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 1},
      {type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 1},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 3},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 1},
    ]);
  });

  it('projects loan taken events only after matching loan cash and income changes', () => {
    const game = testGame();
    const start = staticConfig.incomeTrack.startPosition;
    const firstLoanPosition = retreatIncomeLevels(start, staticConfig.rules.loanIncomeLevelPenalty);
    const secondLoanPosition = retreatIncomeLevels(firstLoanPosition, staticConfig.rules.loanIncomeLevelPenalty);
    game.eventLog = [
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: ' p1 '},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: firstLoanPosition, to: secondLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: firstLoanPosition, to: secondLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
    ]);
  });

  it('projects scouted events only after three consecutive regular discards from the same player', () => {
    const game = testGame();
    const regularCardIds = Object.entries(staticConfig.cardSpecs)
      .filter(([, card]) =>
        card.minPlayers === game.playerCount &&
        card.type !== 'wild_location' &&
        card.type !== 'wild_industry',
      )
      .map(([cardId]) => cardId);
    expect(regularCardIds.length).toBeGreaterThanOrEqual(8);
    const [cardA, cardB, cardC, cardD, cardE, cardF, cardG, cardH] = regularCardIds;
    game.eventLog = [
      {type: 'scouted', playerId: 'p1'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardA, destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardB, destination: 'discard'},
      {type: 'scouted', playerId: 'p1'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardC, destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardD, destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardE, destination: 'discard'},
      {type: 'scouted', playerId: 'p2'},
      {type: 'card_discarded', playerId: 'p1', cardId: cardF, destination: 'discard'},
      {type: 'card_discarded', playerId: ' p1 ', cardId: ` ${cardG} `, destination: ' discard '},
      {type: 'card_discarded', playerId: 'p1', cardId: cardH, destination: 'discard'},
      {type: 'scouted', playerId: ' p1 '},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'scouted')).toEqual([
      {type: 'scouted', playerId: 'p1'},
    ]);
  });

  it('normalizes recoverable merchant develop resolved event fields in projected logs', () => {
    const game = testGame();
    game.eventLog = [
      {
        type: 'merchant_develop_resolved',
        playerId: ' p1 ',
        merchantSpaceId: ' gloucester-0 ',
        merchantSpaceIds: [' gloucester-1 ', '\tgloucester-0\n'],
        industryTypes: [' cotton_mill '],
        specIds: [' cotton_mill-1-1 '],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-1', 'oxford-0'],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    }]);
  });

  it('projects one merchant develop resolution per develop merchant bonus in public logs', () => {
    const game = testGame();
    game.eventLog = [
      {
        type: 'merchant_bonus_claimed',
        playerId: ' p1 ',
        merchantSpaceId: ' gloucester-0 ',
        bonus: {type: ' develop ', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['cotton_mill'],
        specIds: ['secret-token'],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: ' p1 ',
        merchantSpaceId: ' gloucester-0 ',
        industryTypes: [' cotton_mill '],
        specIds: [' cotton_mill-1-1 '],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['iron_works'],
        specIds: ['iron_works-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
    ]);
  });

  it('normalizes recoverable public event reasons in projected logs', () => {
    const game = testGame();
    const ironPrice = staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0];
    game.eventLog = [
      {
        type: 'cash_changed',
        playerId: ' p1 ',
        delta: -3,
        reason: ' build ',
      },
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 10,
        to: 12,
        reason: '\tsold cotton_mill\n',
      },
      {
        type: 'victory_points_changed',
        playerId: ' p2 ',
        delta: 4,
        reason: ' merchant bonus ',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: ironPrice},
        byPlayerId: 'p1',
        reason: ' develop iron ',
      },
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 99,
        reason: ' secret-token ',
      },
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 3,
        reason: 'build',
      },
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 12,
        to: 10,
        reason: 'sold cotton_mill',
      },
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: -1,
        to: 12,
        reason: 'sold cotton_mill',
      },
      {
        type: 'victory_points_changed',
        playerId: 'p2',
        delta: 4,
        reason: 'negative income shortfall',
      },
      {
        type: 'victory_points_changed',
        playerId: 'p2',
        delta: 0,
        reason: 'link scoring',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: -3, reason: 'build'},
      {type: 'income_position_changed', playerId: 'p1', from: 10, to: 12, reason: 'sold cotton_mill'},
      {type: 'victory_points_changed', playerId: 'p2', delta: 4, reason: 'merchant bonus'},
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: ironPrice},
        byPlayerId: 'p1',
        reason: 'develop iron',
      },
    ]);
  });

  it('normalizes recoverable resource consumed source fields in projected logs', () => {
    const game = testGame();
    const ironPrice = staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0];
    const brewery = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
      remainingResource: 1,
    });
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: true,
    };
    game.board.merchantSpaces['oxford-1'] = {
      id: 'oxford-1',
      merchantTileInstanceId: 'blank-2p-0',
      beerPresent: true,
    };
    game.eventLog = [
      {
        type: 'resource_consumed',
        source: {kind: ' industry_tile ', industryInstanceId: ` ${brewery.id} `, resourceType: ' beer '},
        byPlayerId: ' p1 ',
        reason: ' sell ',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' market ', market: ' iron ', price: ironPrice},
        byPlayerId: ' p1 ',
        reason: ' develop iron ',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' oxford-0 ', merchantTileInstanceId: ' oxford-cotton-0 '},
        byPlayerId: ' p1 ',
        reason: ' sell ',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' oxford-0 ', merchantTileInstanceId: ' oxford-cotton-0 '},
        byPlayerId: ' p1 ',
        reason: ' network ',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' oxford-1 ', merchantTileInstanceId: ' blank-2p-0 '},
        byPlayerId: ' p1 ',
        reason: ' sell ',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' industry_tile ', industryInstanceId: ` ${brewery.id} `, resourceType: ' coal '},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' market ', market: ' iron ', price: ironPrice},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' industry_tile ', industryInstanceId: ` ${brewery.id} `, resourceType: ' beer '},
        byPlayerId: 'p1',
        reason: 'develop',
      },
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' oxford-0 ', merchantTileInstanceId: ' secret-token '},
        byPlayerId: 'p1',
        reason: 'sell',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: ironPrice},
        byPlayerId: 'p1',
        reason: 'develop iron',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
    ]);
  });

  it('caps finite resource consumption sources in projected logs', () => {
    const game = testGame();
    const brewery = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
      remainingResource: 0,
    });
    const coal = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
    });
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: true,
    };
    game.eventLog = [
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 0, p2: 0},
          industryVictoryPointsByPlayer: {p1: 0, p2: 0},
          totalVictoryPointsByPlayer: {p1: 0, p2: 0},
        },
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 0, p2: 0},
          industryVictoryPointsByPlayer: {p1: 0, p2: 0},
          totalVictoryPointsByPlayer: {p1: 0, p2: 0},
        },
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 0, p2: 0},
          industryVictoryPointsByPlayer: {p1: 0, p2: 0},
          totalVictoryPointsByPlayer: {p1: 0, p2: 0},
        },
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
    ]);
  });

  it('normalizes recoverable industry removed event fields in projected logs', () => {
    const game = testGame();
    const removedIndustry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    removedIndustry.removedFromGame = true;
    game.board.slots[removedIndustry.slotId] = {};
    const activeIndustry = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 1,
    });
    game.eventLog = [
      {
        type: 'industry_removed',
        industryInstanceId: ' industry-1 ',
        reason: '\tcanal_cleanup\n',
      },
      {
        type: 'industry_removed',
        industryInstanceId: ' industry-1 ',
        reason: ' secret-token ',
      },
      {
        type: 'industry_removed',
        industryInstanceId: activeIndustry.id,
        reason: 'overbuild',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'industry_removed',
      industryInstanceId: 'industry-1',
      reason: 'canal_cleanup',
    }]);
  });

  it('projects each industry removal only once in public logs', () => {
    const game = testGame();
    const removedIndustry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    removedIndustry.removedFromGame = true;
    game.board.slots[removedIndustry.slotId] = {};
    game.eventLog = [
      {
        type: 'industry_removed',
        industryInstanceId: removedIndustry.id,
        reason: 'secret-token',
      },
      {
        type: 'industry_removed',
        industryInstanceId: ` ${removedIndustry.id} `,
        reason: ' overbuild ',
      },
      {
        type: 'industry_removed',
        industryInstanceId: removedIndustry.id,
        reason: 'negative_income',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'industry_removed',
      industryInstanceId: removedIndustry.id,
      reason: 'overbuild',
    }]);
  });

  it('normalizes recoverable resource sold to market event fields in projected logs', () => {
    const game = testGame();
    const coalPrice = staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0];
    const coal = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    game.eventLog = [
      {
        type: 'resource_sold_to_market',
        industryInstanceId: ` ${coal.id} `,
        market: ' coal ',
        cashReceived: coalPrice,
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: ` ${coal.id} `,
        market: ' secret-token ',
        cashReceived: coalPrice,
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: ` ${coal.id} `,
        market: ' iron ',
        cashReceived: staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'resource_sold_to_market',
      industryInstanceId: coal.id,
      market: 'coal',
      cashReceived: coalPrice,
    }]);
  });

  it('projects resource sold to market no more than the industry resource count', () => {
    const game = testGame();
    const coalPrice = staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0];
    const coal = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    game.eventLog = [
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'iron',
        cashReceived: staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0],
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: ` ${coal.id} `,
        market: ' coal ',
        cashReceived: coalPrice,
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
    ]);
  });

  it('filters adjacent market-sale cash changes that do not match the sold resource', () => {
    const game = testGame();
    const coalPrice = staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0];
    const coal = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 0,
      flipped: true,
    });
    game.eventLog = [
      {
        type: 'resource_sold_to_market',
        industryInstanceId: ` ${coal.id} `,
        market: ' coal ',
        cashReceived: coalPrice,
      },
      {type: 'cash_changed', playerId: ' p1 ', delta: coalPrice, reason: ' sold coal to market '},
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
      {type: 'cash_changed', playerId: 'p2', delta: coalPrice, reason: 'sold coal to market'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: 'p1', delta: coalPrice, reason: 'sold coal to market'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'resource_sold_to_market')).toEqual([
      {type: 'resource_sold_to_market', industryInstanceId: coal.id, market: 'coal', cashReceived: coalPrice},
      {type: 'resource_sold_to_market', industryInstanceId: coal.id, market: 'coal', cashReceived: coalPrice},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: coalPrice, reason: 'sold coal to market'},
      {type: 'cash_changed', playerId: 'p1', delta: coalPrice, reason: 'sold coal to market'},
    ]);
  });

  it('projects each industry flip only once in public logs', () => {
    const game = testGame();
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    game.eventLog = [
      {
        type: 'industry_flipped',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p2',
      },
      {
        type: 'industry_flipped',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: ' p1 ',
      },
      {
        type: 'industry_flipped',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'industry_flipped',
      industryInstanceId: cotton.id,
      ownerPlayerId: 'p1',
    }]);
  });

  it('normalizes recoverable industry sale event fields in projected logs', () => {
    const game = testGame();
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: false,
    };
    game.board.merchantSpaces['gloucester-0'] = {
      id: 'gloucester-0',
      merchantTileInstanceId: 'gloucester-manufacturer-0',
      beerPresent: false,
    };
    game.eventLog = [
      {
        type: 'industry_flipped',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: ' p1 ',
      },
      {
        type: 'industry_sold',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: ' p1 ',
        merchantSpaceId: ' oxford-0 ',
      },
      {
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'gloucester-0',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: ' p1 ',
        merchantSpaceId: ' oxford-0 ',
        bonus: {type: ' income_spaces ', spaces: 2},
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: ' cash ', cash: 5},
      },
      {
        type: 'industry_sold',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: 'p1',
        merchantSpaceId: ' secret-token ',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: ' secret-token ',
        bonus: {type: 'cash', cash: 5},
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'industry_flipped',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
      },
      {
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
    ]);
  });

  it('projects each industry sale only once in public logs', () => {
    const game = testGame();
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', false);
    setMerchantSpace(game, 'gloucester-0', 'gloucester-manufacturer-0', false);
    game.eventLog = [
      {
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'gloucester-0',
      },
      {
        type: 'industry_sold',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: ' p1 ',
        merchantSpaceId: ' oxford-0 ',
      },
      {
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([{
      type: 'industry_sold',
      industryInstanceId: cotton.id,
      ownerPlayerId: 'p1',
      merchantSpaceId: 'oxford-0',
    }]);
  });

  it('projects one merchant bonus per merchant beer consumption in public logs', () => {
    const game = testGame();
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', false);
    game.eventLog = [
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' oxford-0 ', merchantTileInstanceId: ' oxford-cotton-0 '},
        byPlayerId: ' p1 ',
        reason: ' sell ',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'cash', cash: 5},
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: ' p1 ',
        merchantSpaceId: ' oxford-0 ',
        bonus: {type: ' income_spaces ', spaces: 2},
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
    ]);
  });

  it('filters adjacent merchant bonus value changes that do not match the claimed bonus', () => {
    const game = testGame();
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', false);
    setMerchantSpace(game, 'shrewsbury-0', 'shrewsbury-pottery-0', false);
    setMerchantSpace(game, 'warrington-0', 'warrington-pottery-0', false);
    const start = staticConfig.incomeTrack.startPosition;
    game.eventLog = [
      {type: 'income_position_changed', playerId: ' p1 ', from: start, to: advanceIncomeSpaces(start, 2), reason: ' merchant bonus '},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {type: 'income_position_changed', playerId: 'p1', from: start, to: advanceIncomeSpaces(start, 1), reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'shrewsbury-0',
        bonus: {type: 'victory_points', points: 4},
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: 3, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'shrewsbury-0',
        bonus: {type: 'victory_points', points: 4},
      },
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'warrington-0',
        bonus: {type: 'cash', cash: 5},
      },
      {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'warrington-0',
        bonus: {type: 'cash', cash: 5},
      },
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'income_position_changed')).toEqual([
      {type: 'income_position_changed', playerId: 'p1', from: start, to: advanceIncomeSpaces(start, 2), reason: 'merchant bonus'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'victory_points_changed')).toEqual([
      {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
    ]);
  });

  it('normalizes recoverable negative income resolved industry ids in projected logs', () => {
    const game = testGame();
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    cotton.removedFromGame = true;
    game.board.slots[cotton.slotId] = {};
    const activeIndustry = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'dudley',
      slotId: 'dudley-0',
      remainingResource: 1,
    });
    game.eventLog = [
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [` ${cotton.id} `],
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [' secret-token '],
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 1,
        paid: 1,
        victoryPointLoss: 0,
        industryInstanceIds: [activeIndustry.id],
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 2,
        victoryPointLoss: 2,
        industryInstanceIds: [cotton.id],
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p2 ',
        amountOwed: 2,
        paid: 2,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [cotton.id],
      },
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

  it('pairs negative income started and resolved events in projected logs', () => {
    const game = testGame();
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    cotton.removedFromGame = true;
    game.board.slots[cotton.slotId] = {};
    game.eventLog = [
      {
        type: 'negative_income_started',
        playerId: ' p1 ',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [` ${cotton.id} `],
      },
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
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 2,
        paid: 2,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [cotton.id],
      },
      {
        type: 'negative_income_started',
        playerId: 'p2',
        amountOwed: 2,
        incomePlayerIndex: 1,
      },
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

  it('normalizes recoverable era ended score records in projected logs', () => {
    const game = testGame();
    game.eventLog = [
      {
        type: 'era_ended',
        era: ' canal ',
        score: {
          era: '\tcanal\n',
          linkVictoryPointsByPlayer: {' p1 ': 3, p2: 1, ghost: 99},
          industryVictoryPointsByPlayer: {p1: 5, '\tp2\n': 2, ghost: 99},
          totalVictoryPointsByPlayer: {' p1 ': 8, p2: 3, ghost: 198},
        },
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {' p1 ': 3, p1: 4, p2: 1},
          industryVictoryPointsByPlayer: {p1: 5, p2: 2},
          totalVictoryPointsByPlayer: {p1: 8, p2: 3},
        },
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {' p1 ': 3},
          industryVictoryPointsByPlayer: {p1: 5, p2: 2},
          totalVictoryPointsByPlayer: {p1: 8, p2: 3},
        },
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'rail',
          linkVictoryPointsByPlayer: {p1: 3, p2: 1},
          industryVictoryPointsByPlayer: {p1: 5, p2: 2},
          totalVictoryPointsByPlayer: {p1: 8, p2: 3},
        },
      },
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: 3, p2: 1},
          industryVictoryPointsByPlayer: {p1: 5, p2: 2},
          totalVictoryPointsByPlayer: {p1: 8, p2: 99},
        },
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
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
    ]);
  });

  it('normalizes recoverable built instance event fields in projected logs', () => {
    const game = testGame();
    game.eventLog = [
      {
        type: 'industry_built',
        instance: {
          id: ' industry-1 ',
          ownerPlayerId: ' p1 ',
          industryType: ' cotton_mill ',
          specId: ' cotton_mill-1-1 ',
          locationId: ' birmingham ',
          slotId: ' birmingham-0 ',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: ' secret-token ',
          ownerPlayerId: ' p1 ',
          industryType: ' cotton_mill ',
          specId: ' cotton_mill-1-1 ',
          locationId: ' birmingham ',
          slotId: ' birmingham-0 ',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'link_built',
        instance: {
          id: ' link-1 ',
          ownerPlayerId: ' p1 ',
          linkType: ' canal ',
          linkLineId: ' birmingham-oxford ',
        },
      },
      {
        type: 'link_built',
        instance: {
          id: ' link-2 ',
          ownerPlayerId: ' p1 ',
          linkType: ' canal ',
          linkLineId: ' secret-token ',
        },
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'industry_built',
        instance: {
          id: 'industry-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
    ]);
  });

  it('projects each built instance only once in public logs', () => {
    const game = testGame();
    game.eventLog = [
      {
        type: 'industry_built',
        instance: {
          id: 'industry-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: 'industry-1',
          ownerPlayerId: 'p2',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: 'industry-2',
          ownerPlayerId: 'p2',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'industry_built',
        instance: {
          id: 'industry-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: 'industry-2',
          ownerPlayerId: 'p2',
          industryType: 'cotton_mill',
          specId: 'cotton_mill-1-1',
          locationId: 'birmingham',
          slotId: 'birmingham-0',
          level: 1,
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      },
    ]);
  });

  it('keeps historical link scoring after scored links leave the public board', () => {
    const game = testGame();
    expect(game.board.linkInstances).toEqual({});

    game.eventLog.push(
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-4',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-oxford',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-4',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId: 'birmingham-walsall',
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: 2,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-3',
        ownerPlayerId: 'p1',
        points: 3,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p2',
        points: 4,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-2',
        ownerPlayerId: 'p1',
        points: 5,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-4',
        ownerPlayerId: 'p1',
        points: 6,
      } as unknown as GameState['eventLog'][number],
    );

    const view = gameStateForPlayer(game);

    expect(view.board.linkInstances).toEqual({});
    expect(view.eventLog.filter((event) => event.type === 'link_scored')).toEqual([
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: 2},
    ]);
  });

  it('projects historical link scoring with only industries active at that scoring point', () => {
    const game = testGame();
    const linkLineId = 'birmingham-oxford';
    const line = staticConfig.linkLines[linkLineId];
    const printedPoints = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
      .filter((locationId): locationId is string => Boolean(locationId))
      .reduce((sum, locationId) => sum + (staticConfig.locations[locationId]?.printedLinkIcons ?? 0), 0);
    const industry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const withIndustryPoints = printedPoints + staticConfig.industryTileSpecs[industry.specId].flip.linkIcons;
    industry.removedFromGame = true;
    game.board.slots[industry.slotId] = {};
    game.eventLog.push(
      {
        type: 'industry_built',
        instance: {...industry, flipped: false, removedFromGame: false},
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_flipped',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-1',
          ownerPlayerId: 'p1',
          linkType: 'canal',
          linkLineId,
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: withIndustryPoints,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_removed',
        industryInstanceId: industry.id,
        reason: 'canal_cleanup',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_built',
        instance: {
          id: 'link-2',
          ownerPlayerId: 'p1',
          linkType: 'rail',
          linkLineId,
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-2',
        ownerPlayerId: 'p1',
        points: withIndustryPoints,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-2',
        ownerPlayerId: 'p1',
        points: printedPoints,
      } as unknown as GameState['eventLog'][number],
    );

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'link_scored')).toEqual([
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: withIndustryPoints},
      {type: 'link_scored', linkInstanceId: 'link-2', ownerPlayerId: 'p1', points: printedPoints},
    ]);
  });

  it('keeps historical industry scoring after cleaned industries leave public slots', () => {
    const game = testGame();
    const industry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    industry.removedFromGame = true;
    game.board.slots[industry.slotId] = {};
    game.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [];
    game.eventLog.push(
      {
        type: 'industry_scored',
        industryInstanceId: ` ${industry.id} `,
        ownerPlayerId: ' p1 ',
        points: staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints,
      },
      {
        type: 'industry_removed',
        industryInstanceId: industry.id,
        reason: 'canal_cleanup',
      },
    );

    const view = gameStateForPlayer(game);

    expect(view.board.slots[industry.slotId].occupiedBy).toBeUndefined();
    expect(view.board.industryInstances[industry.id]).toEqual({
      ...industry,
      removedFromGame: true,
    });
    expect(view.eventLog).toContainEqual({
      type: 'industry_scored',
      industryInstanceId: industry.id,
      ownerPlayerId: 'p1',
      points: staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints,
    });
    expect(view.eventLog).toContainEqual({
      type: 'industry_removed',
      industryInstanceId: industry.id,
      reason: 'canal_cleanup',
    });
  });

  it('projects industry scoring only before that industry is removed in the event history', () => {
    const game = testGame();
    const industry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const points = staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
    industry.removedFromGame = true;
    game.board.slots[industry.slotId] = {};
    game.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [];
    game.eventLog.push(
      {
        type: 'industry_built',
        instance: {...industry, flipped: false, removedFromGame: false},
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_flipped',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
        points,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_removed',
        industryInstanceId: industry.id,
        reason: 'canal_cleanup',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
        points,
      } as unknown as GameState['eventLog'][number],
    );

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'industry_scored')).toEqual([{
      type: 'industry_scored',
      industryInstanceId: industry.id,
      ownerPlayerId: 'p1',
      points,
    }]);
  });

  it('projects each score claim only once per valid scoring window', () => {
    const game = testGame();
    const industry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const industryPoints = staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
    addLink(game, 'link-1', 'p1', 'birmingham-oxford');
    const linkPoints = 2 + staticConfig.industryTileSpecs[industry.specId].flip.linkIcons;
    const canalScore = {
      era: 'canal' as const,
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    };
    game.eventLog = [
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: linkPoints,
      },
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: linkPoints,
      },
      {
        type: 'industry_scored',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
        points: industryPoints,
      },
      {
        type: 'industry_scored',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
        points: industryPoints,
      },
      {type: 'era_ended', era: 'canal', score: canalScore},
      {
        type: 'industry_scored',
        industryInstanceId: industry.id,
        ownerPlayerId: 'p1',
        points: industryPoints,
      },
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: linkPoints,
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'link_scored')).toEqual([
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'industry_scored')).toEqual([
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
    ]);
  });

  it('projects link and industry scoring victory point changes only when paired with matching score details', () => {
    const game = testGame();
    const linkLineId = 'birmingham-oxford';
    addLink(game, 'link-1', 'p1', linkLineId);
    const line = staticConfig.linkLines[linkLineId];
    const printedLinkPoints = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
      .filter((locationId): locationId is string => Boolean(locationId))
      .reduce((sum, locationId) => sum + (staticConfig.locations[locationId]?.printedLinkIcons ?? 0), 0);
    const industry = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const industryPoints = staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
    const linkPoints = printedLinkPoints + staticConfig.industryTileSpecs[industry.specId].flip.linkIcons;
    game.eventLog = [
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      {type: 'cash_changed', playerId: 'p1', delta: 2, reason: 'income'},
      {type: 'victory_points_changed', playerId: 'p2', delta: linkPoints, reason: 'link scoring'},
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
      {type: 'victory_points_changed', playerId: ' p1 ', delta: industryPoints, reason: ' industry scoring '},
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
      {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'victory_points_changed')).toEqual([
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'},
      {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
    ]);
    expect(view.eventLog).toContainEqual({type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints});
    expect(view.eventLog).toContainEqual({
      type: 'industry_scored',
      industryInstanceId: industry.id,
      ownerPlayerId: 'p1',
      points: industryPoints,
    });
  });

  it('drops projected event log entries with impossible public numeric fields', () => {
    const game = testGame();
    game.board.industryInstances['industry-1'] = {
      id: 'industry-1',
      specId: 'cotton_mill-1-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      level: 1,
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
      remainingResource: 0,
      removedFromGame: false,
    };
    game.board.slots['birmingham-0'] = {occupiedBy: 'industry-1'};
    game.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: false,
    };
    const iron = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 0,
      flipped: true,
    });
    const unflippedCotton = addIndustry(game, {
      id: 'industry-3',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'coventry',
      slotId: 'coventry-0',
      flipped: false,
    });
    game.eventLog.push(
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1.5,
        reason: 'income',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: 10,
        to: 10.5,
        reason: 'income',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'victory_points_changed',
        playerId: 'p1',
        delta: -1.5,
        reason: 'negative income shortfall',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: 1.5},
        byPlayerId: 'p1',
        reason: 'develop',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: 99},
        byPlayerId: 'p1',
        reason: 'develop',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_sold_to_market',
        industryInstanceId: 'industry-1',
        market: 'iron',
        cashReceived: -1,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_sold_to_market',
        industryInstanceId: 'industry-1',
        market: 'iron',
        cashReceived: 2,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'link_scored',
        linkInstanceId: 'link-1',
        ownerPlayerId: 'p1',
        points: 2.5,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: 'industry-1',
        ownerPlayerId: 'p1',
        points: -1,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: 'industry-1',
        ownerPlayerId: 'p1',
        points: 99,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'industry_scored',
        industryInstanceId: unflippedCotton.id,
        ownerPlayerId: 'p1',
        points: staticConfig.industryTileSpecs[unflippedCotton.specId].flip.victoryPoints,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'cash', cash: 0},
      } as unknown as GameState['eventLog'][number],
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'victory_points', points: 1.5},
      } as unknown as GameState['eventLog'][number],
      {
        type: 'turn_advanced',
        currentPlayerId: 'p1',
        roundNumber: 0,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 0,
        incomePlayerIndex: 0,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 1.5,
        incomePlayerIndex: 0,
      } as unknown as GameState['eventLog'][number],
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 0,
        paid: 0,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 3,
        paid: -1,
        victoryPointLoss: 0,
        industryInstanceIds: ['industry-1'],
      } as unknown as GameState['eventLog'][number],
      {
        type: 'era_ended',
        era: 'canal',
        score: {
          era: 'canal',
          linkVictoryPointsByPlayer: {p1: -1, p2: 0},
          industryVictoryPointsByPlayer: {p1: 2, p2: 0},
          totalVictoryPointsByPlayer: {p1: 3, p2: 0},
        },
      } as unknown as GameState['eventLog'][number],
      {
        type: 'resource_sold_to_market',
        industryInstanceId: iron.id,
        market: 'iron',
        cashReceived: 2,
      },
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: 2},
        byPlayerId: 'p1',
        reason: 'develop',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'coal', price: staticConfig.markets.coal.fallbackPriceWhenEmpty},
        byPlayerId: 'p1',
        reason: 'network',
      },
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: staticConfig.markets.iron.fallbackPriceWhenEmpty},
        byPlayerId: 'p1',
        reason: 'develop',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
    );

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toContainEqual({
      type: 'resource_sold_to_market',
      industryInstanceId: iron.id,
      market: 'iron',
      cashReceived: 2,
    });
    expect(view.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: 2},
      byPlayerId: 'p1',
      reason: 'develop',
    });
    expect(view.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'coal', price: staticConfig.markets.coal.fallbackPriceWhenEmpty},
      byPlayerId: 'p1',
      reason: 'network',
    });
    expect(view.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'market', market: 'iron', price: staticConfig.markets.iron.fallbackPriceWhenEmpty},
      byPlayerId: 'p1',
      reason: 'develop',
    });
    expect(view.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'oxford-0',
      bonus: {type: 'income_spaces', spaces: 2},
    });
    expect(view.eventLog.filter((event) => event.type === 'resource_consumed')).toHaveLength(3);
    expect(view.eventLog.some((event) => event.type === 'cash_changed')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'income_position_changed')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'victory_points_changed')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'link_scored')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'industry_scored')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'turn_advanced')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(false);
    expect(view.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
    expect(view.eventLog.filter((event) => event.type === 'resource_sold_to_market')).toHaveLength(1);
    expect(view.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(1);
  });

  it('clamps stale face-down discard counts when projecting game state', () => {
    const game = testGame();
    game.players.p1.discardCardIds = ['p2-location-birmingham-1', 'secret-token', 'p2-location-cannock-1'];
    game.players.p1.faceDownDiscardCount = 99;
    game.players.p2.discardCardIds = ['p2-location-birmingham-1'];
    game.players.p2.faceDownDiscardCount = -4;

    const view = gameStateForPlayer(game);

    expect(view.players.p1.discardCardIds).toEqual(['hidden-card-1', 'hidden-card-2']);
    expect(view.players.p2.discardCardIds).toEqual(['p2-location-birmingham-1']);
  });

  it('redacts face-down discard card ids from projected event logs', () => {
    const game = testGame();
    game.players.p1.discardCardIds = ['p2-location-cannock-1', 'p2-location-birmingham-1'];
    game.players.p1.faceDownDiscardCount = 1;
    game.eventLog.push(
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1', destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-birmingham-1', destination: 'discard'},
      {
        type: 'card_discarded',
        playerId: ' p1 ',
        cardId: ' p2-location-cannock-1 ',
        destination: ' discard ',
      } as unknown as GameState['eventLog'][number],
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1'} as GameState['eventLog'][number],
      {type: 'card_discarded', playerId: 'p1', cardId: 'secret-token', destination: 'discard'} as GameState['eventLog'][number],
    );

    const observerView = gameStateForPlayer(game);
    const playerView = gameStateForPlayer(game, 'p1');

    for (const view of [observerView, playerView]) {
      expect(view.players.p1.discardCardIds).toEqual(['hidden-card-1', 'p2-location-birmingham-1']);
      expect(view.eventLog).toContainEqual({
        type: 'card_discarded',
        playerId: 'p1',
        cardId: 'hidden-card-1',
        destination: 'discard',
      });
      expect(view.eventLog.filter((event) =>
        event.type === 'card_discarded' &&
        event.cardId === 'hidden-card-1' &&
        event.destination === 'discard',
      )).toHaveLength(1);
      expect(view.eventLog).toContainEqual({
        type: 'card_discarded',
        playerId: 'p1',
        cardId: 'p2-location-birmingham-1',
        destination: 'discard',
      });
      expect(JSON.stringify(view)).not.toContain('p2-location-cannock-1');
      expect(JSON.stringify(view)).not.toContain('secret-token');
    }
    expect(game.eventLog).toContainEqual({
      type: 'card_discarded',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      destination: 'discard',
    });
  });

  it('limits regular discard log entries to once per player per era', () => {
    const game = testGame();
    game.players.p1.discardCardIds = ['p2-location-cannock-1'];
    game.players.p1.faceDownDiscardCount = 1;
    const canalScore = {
      era: 'canal',
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    } as const;

    game.eventLog.push(
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1', destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1', destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'wild-location-1', destination: 'wild_pool'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'wild-location-1', destination: 'wild_pool'},
      {type: 'era_ended', era: 'canal', score: canalScore},
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-cannock-1', destination: 'discard'},
    );

    const view = gameStateForPlayer(game);
    const discardEvents = view.eventLog.filter((event) => event.type === 'card_discarded');

    expect(discardEvents).toEqual([
      {type: 'card_discarded', playerId: 'p1', cardId: 'hidden-card-1', destination: 'discard'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'wild-location-1', destination: 'wild_pool'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'wild-location-1', destination: 'wild_pool'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'hidden-card-1', destination: 'discard'},
    ]);
    expect(view.eventLog).toContainEqual({type: 'era_ended', era: 'canal', score: canalScore});
    expect(JSON.stringify(view)).not.toContain('p2-location-cannock-1');
  });

  it('allows browser cross-origin requests to the HTTP API', async () => {
    const testServer = await startTestServer();
    try {
      const origin = 'http://127.0.0.1:5173';
      const listResponse = await fetch(`${testServer.url}/api/games`, {
        headers: {origin},
      });
      expect(listResponse.status).toBe(200);
      expect(listResponse.headers.get('access-control-allow-origin')).toBe(origin);
      expect(listResponse.headers.get('access-control-allow-credentials')).toBe('true');

      const preflightResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-player-token',
        },
      });
      expect(preflightResponse.status).toBe(204);
      expect(preflightResponse.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflightResponse.headers.get('access-control-allow-methods')).toContain('GET');
      expect(preflightResponse.headers.get('access-control-allow-headers')).toContain('x-player-token');

      const defaultHeaderPreflight = await fetch(`${testServer.url}/api/games`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
        },
      });
      const allowedHeaders = defaultHeaderPreflight.headers.get('access-control-allow-headers') ?? '';
      expect(defaultHeaderPreflight.status).toBe(204);
      expect(allowedHeaders).toContain('content-type');
      expect(allowedHeaders).toContain('x-player-id');
      expect(allowedHeaders).toContain('x-player-token');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('lists and retrieves games through HTTP', async () => {
    const testServer = await startTestServer();
    try {
      const healthResponse = await fetch(`${testServer.url}/api/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ok: true});

      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {game: {id: string; currentTurnIndex: number; turnOrder: string[]}};

      const listResponse = await fetch(`${testServer.url}/api/games`);
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {
        games: Array<{
          id: string;
          playerNames: string[];
          playerCount: number;
          roundNumber: number;
          era: string;
          status: string;
          currentPlayerId?: string;
        }>;
      };
      expect(Object.keys(listBody).sort()).toEqual(['games']);
      expect(listBody.games).toEqual([
        {
          id: created.game.id,
          playerNames: ['Ada', 'Ben'],
          playerCount: 2,
          roundNumber: 1,
          era: 'canal',
          status: 'playing',
          connectedClientCount: 0,
          currentPlayerId: created.game.turnOrder[created.game.currentTurnIndex],
        },
      ]);

      const getResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`);
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toMatchObject({game: {id: created.game.id}});

      const missingResponse = await fetch(`${testServer.url}/api/games/missing-game`);
      expect(missingResponse.status).toBe(404);
      await expect(missingResponse.json()).resolves.toEqual({errors: ['Game not found']});
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('broadcasts public game lists after HTTP game creation and commands', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);
      const createList = waitForGameList(socket, (payload) => payload.games?.length === 1);
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {
          id: string;
          currentTurnIndex: number;
          turnOrder: string[];
          players: Record<string, {handCardIds: string[]}>;
        };
        sessions: PlayerSession[];
      };
      const createBroadcast = await createList as {games: Array<Record<string, unknown>>};

      expect(createResponse.status).toBe(201);
      expect(createBroadcast.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: created.game.turnOrder[created.game.currentTurnIndex],
      }]);
      expectNoSessionTokens(createBroadcast, created.sessions);

      const cardId = created.game.players.p1.handCardIds[0];
      const p1Session = created.sessions.find((session) => session.playerId === 'p1');
      const commandList = waitForGameList(socket, (payload) =>
        payload.games?.some((game) =>
          typeof game === 'object' &&
          game !== null &&
          (game as {id?: unknown}).id === created.game.id &&
          (game as {currentPlayerId?: unknown}).currentPlayerId === 'p2',
        ) === true,
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session?.token,
        }),
      });
      const commandBroadcast = await commandList as {games: Array<Record<string, unknown>>};

      expect(commandResponse.status).toBe(200);
      expect(commandBroadcast.games).toEqual([expect.objectContaining({
        id: created.game.id,
        currentPlayerId: 'p2',
      })]);
      expectNoSessionTokens(commandBroadcast, created.sessions);
      expect(JSON.stringify(commandBroadcast)).not.toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('serves public game lists through Socket.IO acknowledgements', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {
          id: string;
          currentTurnIndex: number;
          turnOrder: string[];
          players: Record<string, {handCardIds: string[]}>;
        };
        sessions: PlayerSession[];
      };

      socket = await connectSocket(testServer.url);
      const listResponse = await emitWithAck(socket, 'games:list:get', {}) as {
        games: Array<Record<string, unknown>>;
      };

      expect(listResponse.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: created.game.turnOrder[created.game.currentTurnIndex],
      }]);
      expectNoSessionTokens(listResponse, created.sessions);
      expect(JSON.stringify(listResponse)).not.toContain(created.game.players.p1.handCardIds[0]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('tracks connected clients in public game list summaries', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const sessions = testServer.store.getPlayerSessions(game.id);

      lobbySocket = await connectSocket(testServer.url);
      playerSocket = await connectSocket(testServer.url);

      const initialList = await emitWithAck(lobbySocket, 'games:list:get', {}) as {games: Array<Record<string, unknown>>};
      expect(initialList.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 0,
      })]);
      expectNoSessionTokens(initialList, sessions);

      const joinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1,
        ) === true,
      );
      const joinResponse = await emitWithAck(playerSocket, 'game:join', {gameId: game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      const joinedSummary = await joinList as {games: Array<Record<string, unknown>>};
      expect(joinedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
      })]);
      expectNoSessionTokens(joinedSummary, sessions);

      const leaveList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 0,
        ) === true,
      );
      const leaveResponse = await emitWithAck(playerSocket, 'game:leave', {}) as {ok: boolean};
      expect(leaveResponse.ok).toBe(true);
      const leftSummary = await leaveList as {games: Array<Record<string, unknown>>};
      expect(leftSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 0,
      })]);

      const rejoinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1,
        ) === true,
      );
      const rejoinResponse = await emitWithAck(playerSocket, 'game:join', {gameId: game.id}) as {ok: boolean};
      expect(rejoinResponse.ok).toBe(true);
      await rejoinList;

      const disconnectList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 0,
        ) === true,
      );
      playerSocket.disconnect();
      playerSocket = undefined;
      const disconnectedSummary = await disconnectList as {games: Array<Record<string, unknown>>};
      expect(disconnectedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 0,
      })]);
      expectNoSessionTokens(disconnectedSummary, sessions);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('creates introductory Canal-only games through HTTP when requested', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true}),
      });
      const created = await createResponse.json() as {
        game: {id: string; variant?: string};
        sessions: PlayerSession[];
      };

      expect(createResponse.status).toBe(201);
      expect(created.game.variant).toBe('introductory_canal_only');
      expect(created.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2']);
      expect(testServer.store.get(created.game.id)?.variant).toBe('introductory_canal_only');

      const listResponse = await fetch(`${testServer.url}/api/games`);
      const listBody = await listResponse.json() as {games: Array<{id: string; variant?: string}>};
      expect(listResponse.status).toBe(200);
      expect(listBody.games).toEqual([expect.objectContaining({
        id: created.game.id,
        variant: 'introductory_canal_only',
      })]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('lists ended introductory Canal-only games through HTTP without active-turn details', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.status = 'ended';
      storedGame.players.p1.victoryPoints = 14;
      storedGame.players.p2.victoryPoints = 9;
      storedGame.eventLog.push({type: 'game_ended', winners: ['p1']});
      storedGame.pendingDecision = {
        type: 'negative_income',
        playerId: 'p2',
        amountOwed: 5,
        incomePlayerIndex: 1,
      };

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: Array<Record<string, unknown>>};
      expect(listBody.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'ended',
        variant: 'introductory_canal_only',
        connectedClientCount: 0,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 14, p2: 9},
      }]);
      expect(listBody.games[0]).not.toHaveProperty('currentPlayerId');
      expect(listBody.games[0]).not.toHaveProperty('pendingDecision');
      expect(listBody.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(listBody)).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('lists only public game summaries through HTTP while a decision is pending', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; turnOrder: string[]; currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.turnOrder = ['ghost-player', ' p2 ', 'p2'];
      storedGame.currentTurnIndex = 1;
      storedGame.pendingDecision = {
        type: 'negative_income',
        playerId: ' p2 ',
        amountOwed: 5,
        incomePlayerIndex: 0,
      } as unknown as GameState['pendingDecision'];

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: unknown[]};
      expect(listBody.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: 'p2',
        pendingDecision: {type: 'negative_income', playerId: 'p2'},
      }]);
      const summary = listBody.games[0] as Record<string, unknown>;
      expect(summary).not.toHaveProperty('sessions');
      expect(summary).not.toHaveProperty('players');
      expect(summary).not.toHaveProperty('cardZones');
      expect(JSON.stringify(summary)).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(JSON.stringify(summary)).not.toContain(created.game.players.p1.handCardIds[0]);
      expect(JSON.stringify(summary)).not.toContain('amountOwed');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('lists only public summaries for merchant develop decisions through HTTP', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; turnOrder: string[]; currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 2,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      };

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: unknown[]};
      expect(listBody.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: created.game.turnOrder[created.game.currentTurnIndex],
        pendingDecision: {type: 'merchant_develop', playerId: 'p1'},
      }]);
      const summaryText = JSON.stringify(listBody.games[0]);
      expect(summaryText).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(summaryText).not.toContain(created.game.players.p1.handCardIds[0]);
      expect(summaryText).not.toContain('gloucester-0');
      expect(summaryText).not.toContain('merchantSpaceIds');
      expect(summaryText).not.toContain('count');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('falls back to the public turn order and omits invalid runtime pending fields from HTTP game lists', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.turnOrder = ['ghost', 'p2'];
      storedGame.currentTurnIndex = 0;
      (storedGame as unknown as {pendingDecision: unknown}).pendingDecision = {
        type: 'secret-decision',
        playerId: 'p1',
        sessionToken: created.sessions[0]?.token,
      };

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: Record<string, unknown>[]};
      expect(listBody.games).toHaveLength(1);
      expect(listBody.games[0]).toMatchObject({
        id: created.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p2',
      });
      expect(listBody.games[0]).not.toHaveProperty('pendingDecision');
      expect(JSON.stringify(listBody)).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(JSON.stringify(listBody)).not.toContain('secret-decision');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves the public static rules config through HTTP without private game data', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {game: {id: string}; sessions: PlayerSession[]};
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.players.p1.name = 'Static Config Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'static-config-secret-reason',
      });

      const configResponse = await fetch(`${testServer.url}/api/static-config`);

      expect(configResponse.status).toBe(200);
      const configBody = await configResponse.json() as {config: typeof staticConfig};
      expect(Object.keys(configBody).sort()).toEqual(['config']);
      expect(Object.keys(configBody.config).sort()).toEqual(Object.keys(staticConfig).sort());
      expect(configBody.config.components).toEqual(staticConfig.components);
      expect(configBody.config.rules).toEqual(staticConfig.rules);
      expect(configBody.config.audit.components.rulebookPages).toEqual([1, 4, 5]);
      expect(configBody.config.cardSpecs['p2-location-birmingham-1']).toEqual(
        JSON.parse(JSON.stringify(staticConfig.cardSpecs['p2-location-birmingham-1'])),
      );
      expect(configBody.config.linkLines['kidderminster-worcester'].viaFarmBreweryId).toBe('southern');
      expect(configBody.config).not.toHaveProperty('players');
      expect(configBody.config).not.toHaveProperty('board');
      expect(configBody.config).not.toHaveProperty('eventLog');
      expect(configBody.config).not.toHaveProperty('cardZones');
      expect(configBody.config).not.toHaveProperty('pendingDecision');
      const serializedConfig = JSON.stringify(configBody);
      expect(serializedConfig).not.toContain(created.game.id);
      expect(serializedConfig).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedConfig).not.toContain('Static Config Secret Player');
      expect(serializedConfig).not.toContain('static-config-secret-reason');

      configBody.config.components.boardCount = 99 as typeof configBody.config.components.boardCount;
      configBody.config.audit.components.rulebookPages.push(99);

      const freshConfigResponse = await fetch(`${testServer.url}/api/static-config`);
      const freshConfigBody = await freshConfigResponse.json() as {config: typeof staticConfig};
      expect(freshConfigBody.config.components.boardCount).toBe(staticConfig.components.boardCount);
      expect(freshConfigBody.config.audit.components.rulebookPages).toEqual([1, 4, 5]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('normalizes dirty runtime core fields and player names in HTTP game lists', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben', 'Cara'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.playerCount = 99 as GameState['playerCount'];
      storedGame.roundNumber = 0;
      storedGame.era = 'secret-era' as GameState['era'];
      storedGame.status = 'secret-status' as GameState['status'];
      storedGame.players.p1.name = ' Ada\n';
      storedGame.players.p2.name = '   ';
      (storedGame.players.p3 as unknown as {name: unknown}).name = {secret: 'secret-token'};

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: Record<string, unknown>[]};
      expect(listBody.games).toEqual([{
        id: created.game.id,
        playerNames: ['Ada', 'Player 2', 'Player 3'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: 'p1',
      }]);
      expect(JSON.stringify(listBody)).not.toContain('secret-era');
      expect(JSON.stringify(listBody)).not.toContain('secret-status');
      expect(JSON.stringify(listBody)).not.toContain('secret-token');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves the client fallback without masking unknown API routes', async () => {
    const clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-client-dist-'));
    fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><div id="root">client shell</div>');
    const testServer = await startTestServer(clientDist);
    try {
      const clientResponse = await fetch(`${testServer.url}/rooms/example-room`);
      expect(clientResponse.status).toBe(200);
      await expect(clientResponse.text()).resolves.toContain('client shell');

      const apiResponse = await fetch(`${testServer.url}/api/missing-route`);
      expect(apiResponse.status).toBe(404);
      await expect(apiResponse.json()).resolves.toEqual({errors: ['API route not found']});
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed create seeds through HTTP without creating a game', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: null}),
      });

      expect(createResponse.status).toBe(400);
      await expect(createResponse.json()).resolves.toEqual({
        errors: ['Game seed must be a finite number'],
      });
      expect(testServer.store.list()).toEqual([]);

      const fractionalResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 1.5}),
      });

      expect(fractionalResponse.status).toBe(400);
      await expect(fractionalResponse.json()).resolves.toEqual({
        errors: ['Game seed must be an integer'],
      });
      expect(testServer.store.list()).toEqual([]);

      const malformedVariantResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: 'yes'}),
      });

      expect(malformedVariantResponse.status).toBe(400);
      await expect(malformedVariantResponse.json()).resolves.toEqual({
        errors: ['introductoryCanalOnly must be a boolean'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed player names through HTTP without creating a game', async () => {
    const testServer = await startTestServer();
    try {
      const missingNamesResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({seed: 5}),
      });

      expect(missingNamesResponse.status).toBe(400);
      await expect(missingNamesResponse.json()).resolves.toEqual({
        errors: ['Player names must be an array'],
      });

      const nonArrayNamesResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: 'Ada', seed: 5}),
      });

      expect(nonArrayNamesResponse.status).toBe(400);
      await expect(nonArrayNamesResponse.json()).resolves.toEqual({
        errors: ['Player names must be an array'],
      });

      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 42], seed: 5}),
      });

      expect(createResponse.status).toBe(400);
      await expect(createResponse.json()).resolves.toEqual({
        errors: ['Player names must be strings'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('rejects unsupported player counts through HTTP without creating a game', async () => {
    const testServer = await startTestServer();
    try {
      const tooFewResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada'], seed: 5}),
      });

      expect(tooFewResponse.status).toBe(400);
      await expect(tooFewResponse.json()).resolves.toEqual({
        errors: ['Brass: Birmingham supports 2-4 players'],
      });

      const tooManyResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben', 'Cara', 'Dev', 'Eli'], seed: 5}),
      });

      expect(tooManyResponse.status).toBe(400);
      await expect(tooManyResponse.json()).resolves.toEqual({
        errors: ['Brass: Birmingham supports 2-4 players'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('normalizes blank player names through HTTP game creation', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: [' Ada ', '   ', '\t'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {name: string}>};
        sessions: PlayerSession[];
      };

      expect(createResponse.status).toBe(201);
      expect(created.game.players.p1.name).toBe('Ada');
      expect(created.game.players.p2.name).toBe('Player 2');
      expect(created.game.players.p3.name).toBe('Player 3');
      expect(created.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(testServer.store.list()).toEqual([expect.objectContaining({
        id: created.game.id,
        playerNames: ['Ada', 'Player 2', 'Player 3'],
        playerCount: 3,
      })]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('normalizes dirty player names in HTTP game detail views', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.players.p1.name = ' Ada\n';
      (storedGame.players.p2 as unknown as {name: unknown}).name = {secret: 'secret-token'};

      const detailResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`);

      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json() as {
        game: {players: Record<string, {name: string}>};
      };
      expect(detail.game.players.p1.name).toBe('Ada');
      expect(detail.game.players.p2.name).toBe('Player 2');
      expect(JSON.stringify(detail)).not.toContain('secret-token');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('redacts hidden cards in HTTP game views without mutating the stored game', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]; discardCardIds: string[]; faceDownDiscardCount: number}>; cardZones: {drawDeck: string[]}};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();

      expect(created.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(created.game.players.p1.discardCardIds).toEqual(['hidden-card-1']);
      expect(created.game.players.p1.faceDownDiscardCount).toBe(1);
      expect(created.game.players.p2.handCardIds).toHaveLength(storedGame?.players.p2.handCardIds.length ?? 0);
      expect(created.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(created.game.players.p2.discardCardIds).toEqual(['hidden-card-1']);
      expect(created.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(storedGame?.players.p2.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(storedGame?.players.p1.discardCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);

      const observerResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`);
      const observer = await observerResponse.json() as {game: {players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>}};
      expect(observer.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observer.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observer.game.players.p1.discardCardIds).toEqual(['hidden-card-1']);
      expect(observer.game.players.p2.discardCardIds).toEqual(['hidden-card-1']);

      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      const playerViewResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-id': ' p2 ',
          'x-player-token': ` ${p2Session?.token ?? ''}\n`,
        },
      });
      const p2View = await playerViewResponse.json() as {game: {players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>}};
      expect(p2View.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(p2View.game.players.p2.handCardIds).toEqual(storedGame?.players.p2.handCardIds);
      expect(p2View.game.players.p2.discardCardIds).toEqual(['hidden-card-1']);

      const invalidSessionResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-id': 'p2',
          'x-player-token': 'wrong-token',
        },
      });
      expect(invalidSessionResponse.status).toBe(400);
      await expect(invalidSessionResponse.json()).resolves.toEqual({errors: ['Invalid player session']});

      const missingPlayerIdResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-token': p2Session?.token ?? '',
        },
      });
      expect(missingPlayerIdResponse.status).toBe(400);
      await expect(missingPlayerIdResponse.json()).resolves.toEqual({errors: ['Invalid player session']});
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('keeps face-up action discards visible while redacting setup discards', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];

      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: ` ${session?.token ?? ''}\n`,
        }),
      });
      expect(commandResponse.status).toBe(200);

      const observerResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`);
      const observer = await observerResponse.json() as {game: {players: Record<string, {discardCardIds: string[]}>}};
      expect(observer.game.players.p1.discardCardIds).toEqual(['hidden-card-1', cardId]);
      expect(observer.game.players.p2.discardCardIds).toEqual(['hidden-card-1']);
      expect(testServer.store.get(created.game.id)?.players.p1.discardCardIds[1]).toBe(cardId);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('applies a final HTTP pass through Canal scoring and broadcasts sanitized Rail views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame) {
        throw new Error('Expected created game');
      }
      const scoredIndustry = addIndustry(storedGame, {
        id: 'http-era-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: true,
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(scoredIndustry.id);
      addLink(storedGame, 'http-era-link', 'p1', 'birmingham-oxford');
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!session) {
        throw new Error('Expected p1 session');
      }

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        (state as {era?: string; eventLog?: GameState['eventLog']}).era === 'rail' &&
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'era_ended' && event.era === 'canal',
        )),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: GameState;
      };
      const observerBroadcast = await broadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.status).toBe('playing');
      expect(commandBody.game.era).toBe('rail');
      expect(commandBody.game.roundNumber).toBe(1);
      expect(commandBody.game.players.p1.victoryPoints).toBe(8);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 3, reason: 'link scoring'},
        {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'},
        expect.objectContaining({
          type: 'era_ended',
          era: 'canal',
          score: expect.objectContaining({
            linkVictoryPointsByPlayer: {p1: 3, p2: 0},
            industryVictoryPointsByPlayer: {p1: 5, p2: 0},
            totalVictoryPointsByPlayer: {p1: 8, p2: 0},
          }),
        }),
      ]));
      expect(commandBody.game.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
      expect(commandBody.game.board.industryInstances).not.toHaveProperty(scoredIndustry.id);
      expect(commandBody.game.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);

      expect(observerBroadcast.era).toBe('rail');
      expect(observerBroadcast.players.p1.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(finalGame?.era).toBe('rail');
      expect(finalGame?.board.industryInstances[scoredIndustry.id].removedFromGame).toBe(true);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for HTTP negative income liquidation before ending a final-card Canal era Pass', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.players.p1.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
      const cotton = addIndustry(storedGame, {
        id: 'http-final-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const pendingBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const passResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(passResponse.status).toBe(200);
      const passBody = await passResponse.json() as {game: GameState};
      const pendingView = await pendingBroadcast as GameState;
      const pendingDecision = {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 3,
        incomePlayerIndex: 0,
      } as const;

      expectNoSessionTokens([passBody, pendingView], created.sessions);
      expect(passBody.game.pendingDecision).toEqual(pendingDecision);
      expect(passBody.game.era).toBe('canal');
      expect(passBody.game.players.p1.cash).toBe(0);
      expect(passBody.game.eventLog).toContainEqual({
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 3,
        incomePlayerIndex: 0,
      });
      expect(passBody.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
      expect(pendingView.pendingDecision).toEqual(pendingDecision);
      expect(pendingView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal')),
      );
      const resolveResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]},
          sessionToken: session.token,
        }),
      });

      expect(resolveResponse.status).toBe(200);
      const resolveBody = await resolveResponse.json() as {game: GameState};
      const railView = await railBroadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens([resolveBody, railView], created.sessions);
      expect(resolveBody.game.pendingDecision).toBeUndefined();
      expect(resolveBody.game.era).toBe('rail');
      expect(resolveBody.game.roundNumber).toBe(1);
      expect(resolveBody.game.players.p1.cash).toBe(3);
      expect(resolveBody.game.board.industryInstances).not.toHaveProperty(cotton.id);
      expect(resolveBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'cash_changed', playerId: 'p1', delta: 6, reason: 'negative income liquidation'},
        {type: 'cash_changed', playerId: 'p1', delta: -3, reason: 'income'},
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
      ]));
      expect(railView.pendingDecision).toBeUndefined();
      expect(railView.era).toBe('rail');
      expect(railView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(railView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(finalGame?.era).toBe('rail');
      expect(finalGame?.players.p1.cash).toBe(3);
      expect(finalGame?.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(finalGame?.eventLog).toContainEqual({
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 3,
        paid: 3,
        victoryPointLoss: 0,
        industryInstanceIds: [cotton.id],
      });
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('chains HTTP final-card Canal negative income decisions before ending the era', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      storedGame.players.p1.cash = 0;
      storedGame.players.p2.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
      storedGame.players.p2.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
      const p1Cotton = addIndustry(storedGame, {
        id: 'http-chain-negative-income-p1-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      const p2Cotton = addIndustry(storedGame, {
        id: 'http-chain-negative-income-p2-cotton',
        ownerPlayerId: 'p2',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'worcester',
        slotId: 'worcester-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(p1Cotton.id);
      storedGame.players.p2.industryTileStacks.cotton_mill.builtInstanceIds.push(p2Cotton.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const p1PendingDecision = {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      } as const;
      const p1PendingBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p1' &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const passResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session.token,
        }),
      });

      expect(passResponse.status).toBe(200);
      const passBody = await passResponse.json() as {game: GameState};
      const p1PendingView = await p1PendingBroadcast as GameState;
      expectNoSessionTokens([passBody, p1PendingView], created.sessions);
      expect(passBody.game.pendingDecision).toEqual(p1PendingDecision);
      expect(passBody.game.era).toBe('canal');
      expect(passBody.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
      expect(p1PendingView.pendingDecision).toEqual(p1PendingDecision);

      const p2PendingDecision = {
        type: 'negative_income',
        playerId: 'p2',
        amountOwed: 3,
        incomePlayerIndex: 1,
      } as const;
      const p2PendingBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p2' &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const p1ResolveResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [p1Cotton.id]},
          sessionToken: p1Session.token,
        }),
      });

      expect(p1ResolveResponse.status).toBe(200);
      const p1ResolveBody = await p1ResolveResponse.json() as {game: GameState};
      const p2PendingView = await p2PendingBroadcast as GameState;
      expectNoSessionTokens([p1ResolveBody, p2PendingView], created.sessions);
      expect(p1ResolveBody.game.pendingDecision).toEqual(p2PendingDecision);
      expect(p1ResolveBody.game.era).toBe('canal');
      expect(p1ResolveBody.game.currentTurnIndex).toBe(1);
      expect(p1ResolveBody.game.players.p1.cash).toBe(1);
      expect(p1ResolveBody.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
      expect(p2PendingView.pendingDecision).toEqual(p2PendingDecision);
      expect(p2PendingView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal')),
      );
      const p2ResolveResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'resolve_negative_income', playerId: 'p2', industryInstanceIds: [p2Cotton.id]},
          sessionToken: p2Session.token,
        }),
      });

      expect(p2ResolveResponse.status).toBe(200);
      const p2ResolveBody = await p2ResolveResponse.json() as {game: GameState};
      const railView = await railBroadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);
      expectNoSessionTokens([p2ResolveBody, railView], created.sessions);
      expect(p2ResolveBody.game.pendingDecision).toBeUndefined();
      expect(p2ResolveBody.game.era).toBe('rail');
      expect(p2ResolveBody.game.roundNumber).toBe(1);
      expect(p2ResolveBody.game.players.p2.cash).toBe(3);
      expect(p2ResolveBody.game.board.industryInstances).not.toHaveProperty(p1Cotton.id);
      expect(p2ResolveBody.game.board.industryInstances).not.toHaveProperty(p2Cotton.id);
      expect(p2ResolveBody.game.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(railView.pendingDecision).toBeUndefined();
      expect(railView.era).toBe('rail');
      expect(railView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(finalGame?.era).toBe('rail');
      expect(finalGame?.players.p1.cash).toBe(1);
      expect(finalGame?.players.p2.cash).toBe(3);
      expect(finalGame?.board.industryInstances[p1Cotton.id].removedFromGame).toBe(true);
      expect(finalGame?.board.industryInstances[p2Cotton.id].removedFromGame).toBe(true);
      expect(finalGame?.eventLog.filter((event) => event.type === 'negative_income_resolved')).toEqual([
        {
          type: 'negative_income_resolved',
          playerId: 'p1',
          amountOwed: 5,
          paid: 5,
          victoryPointLoss: 0,
          industryInstanceIds: [p1Cotton.id],
        },
        {
          type: 'negative_income_resolved',
          playerId: 'p2',
          amountOwed: 3,
          paid: 3,
          victoryPointLoss: 0,
          industryInstanceIds: [p2Cotton.id],
        },
      ]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies a final HTTP pass through introductory Canal-only scoring and broadcasts sanitized ended views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame) {
        throw new Error('Expected created game');
      }
      storedGame.players.p1.cash = 80;
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!session) {
        throw new Error('Expected p1 session');
      }

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        state.status === 'ended' &&
        state.era === 'canal' &&
        state.variant === 'introductory_canal_only' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended')),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: GameState;
      };
      const observerBroadcast = await broadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.status).toBe('ended');
      expect(commandBody.game.era).toBe('canal');
      expect(commandBody.game.variant).toBe('introductory_canal_only');
      expect(commandBody.game.players.p1.victoryPoints).toBe(15);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 15, reason: 'introductory money scoring'},
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
        {type: 'game_ended', winners: ['p1']},
      ]));

      expect(observerBroadcast.status).toBe('ended');
      expect(observerBroadcast.era).toBe('canal');
      expect(observerBroadcast.variant).toBe('introductory_canal_only');
      expect(observerBroadcast.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(observerBroadcast.players.p1.handCardIds).toEqual([]);
      expect(observerBroadcast.players.p2.handCardIds).toEqual([]);
      expect(finalGame?.status).toBe('ended');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies a final HTTP pass through Rail scoring and broadcasts sanitized ended views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame) {
        throw new Error('Expected created game');
      }
      storedGame.era = 'rail';
      storedGame.roundNumber = 10;
      const scoredIndustry = addIndustry(storedGame, {
        id: 'http-final-rail-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: true,
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(scoredIndustry.id);
      addLink(storedGame, 'http-final-rail-link', 'p1', 'birmingham-oxford', 'rail');
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!session) {
        throw new Error('Expected p1 session');
      }

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended')),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: GameState;
      };
      const observerBroadcast = await broadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.status).toBe('ended');
      expect(commandBody.game.era).toBe('rail');
      expect(commandBody.game.players.p1.victoryPoints).toBe(9);
      expect(commandBody.game.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
      expect(commandBody.game.board.industryInstances).not.toHaveProperty(scoredIndustry.id);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'link scoring'},
        {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'},
        expect.objectContaining({
          type: 'era_ended',
          era: 'rail',
          score: expect.objectContaining({
            linkVictoryPointsByPlayer: {p1: 4, p2: 0},
            industryVictoryPointsByPlayer: {p1: 5, p2: 0},
            totalVictoryPointsByPlayer: {p1: 9, p2: 0},
          }),
        }),
        {type: 'game_ended', winners: ['p1']},
      ]));

      expect(observerBroadcast.status).toBe('ended');
      expect(observerBroadcast.era).toBe('rail');
      expect(observerBroadcast.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(observerBroadcast.players.p1.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(finalGame?.status).toBe('ended');
      expect(finalGame?.board.industryInstances[scoredIndustry.id].removedFromGame).toBe(false);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('ends a final HTTP Rail pass without applying negative income', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.era = 'rail';
      storedGame.players.p1.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
      const scoredIndustry = addIndustry(storedGame, {
        id: 'http-final-rail-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: true,
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(scoredIndustry.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended')),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {game: GameState};
      const observerBroadcast = await broadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);
      if (!finalGame) {
        throw new Error('Expected final game');
      }

      expectNoSessionTokens([commandBody, observerBroadcast], created.sessions);
      expect(commandBody.game.status).toBe('ended');
      expect(commandBody.game.era).toBe('rail');
      expect(commandBody.game.pendingDecision).toBeUndefined();
      expect(commandBody.game.players.p1.cash).toBe(0);
      expect(commandBody.game.players.p1.victoryPoints).toBe(5);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'},
        expect.objectContaining({type: 'era_ended', era: 'rail'}),
        {type: 'game_ended', winners: ['p1']},
      ]));
      expect(commandBody.game.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(commandBody.game.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'income',
      )).toBe(false);
      expect(commandBody.game.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'negative income liquidation',
      )).toBe(false);

      expect(observerBroadcast.status).toBe('ended');
      expect(observerBroadcast.era).toBe('rail');
      expect(observerBroadcast.pendingDecision).toBeUndefined();
      expect(observerBroadcast.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(observerBroadcast.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(finalGame.status).toBe('ended');
      expect(finalGame.pendingDecision).toBeUndefined();
      expect(finalGame.players.p1.cash).toBe(0);
      expect(finalGame.board.industryInstances[scoredIndustry.id].removedFromGame).toBe(false);
      expect(finalGame.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(finalGame.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'income',
      )).toBe(false);
      expect(finalGame.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'negative income liquidation',
      )).toBe(false);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP Loan commands and broadcasts sanitized views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];
      if (!session || !cardId) {
        throw new Error('Expected created p1 session and card');
      }

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'loan_taken' && event.playerId === 'p1',
        )),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'loan', playerId: 'p1', cardId},
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          currentTurnIndex: number;
          eventLog: GameState['eventLog'];
          players: Record<string, {
            cash: number;
            discardCardIds: string[];
            handCardIds: string[];
            incomeTrackPosition: number;
            spentThisRound: number;
          }>;
        };
      };
      const observerBroadcast = await broadcast as {
        currentTurnIndex: number;
        eventLog: GameState['eventLog'];
        players: Record<string, {
          cash: number;
          handCardIds: string[];
          incomeTrackPosition: number;
          spentThisRound: number;
        }>;
      };
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.currentTurnIndex).toBe(1);
      expect(commandBody.game.players.p1.cash).toBe(47);
      expect(getIncomeLevel(commandBody.game.players.p1.incomeTrackPosition)).toBe(-3);
      expect(commandBody.game.players.p1.spentThisRound).toBe(0);
      expect(commandBody.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandBody.game.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
        {type: 'loan_taken', playerId: 'p1'},
      ]));
      expect(commandBody.game.eventLog).toContainEqual(expect.objectContaining({
        type: 'income_position_changed',
        playerId: 'p1',
        reason: 'loan',
      }));
      expect(observerBroadcast.currentTurnIndex).toBe(1);
      expect(observerBroadcast.players.p1.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p1.cash).toBe(47);
      expect(getIncomeLevel(observerBroadcast.players.p1.incomeTrackPosition)).toBe(-3);
      expect(observerBroadcast.players.p1.spentThisRound).toBe(0);
      expect(observerBroadcast.eventLog).toContainEqual({type: 'loan_taken', playerId: 'p1'});
      expect(finalGame?.players.p1.cash).toBe(47);
      expect(getIncomeLevel(finalGame?.players.p1.incomeTrackPosition ?? staticConfig.incomeTrack.startPosition)).toBe(-3);
      expect(finalGame?.players.p1.spentThisRound).toBe(0);
      expect(finalGame?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('keeps Scout wild cards private while broadcasting public discard and pool state', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardIds = created.game.players.p1.handCardIds.slice(0, 3);

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'scout', playerId: 'p1', cardIds},
          sessionToken: session?.token,
        }),
      });
      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          currentTurnIndex: number;
          players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
          cardZones: {wildLocationPool: string[]; wildIndustryPool: string[]};
        };
      };
      const storedGame = testServer.store.get(created.game.id);

      expect(commandBody.game.currentTurnIndex).toBe(1);
      expect(commandBody.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(commandBody.game.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-location-'))).toBe(true);
      expect(commandBody.game.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-industry-'))).toBe(true);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.players.p1.discardCardIds).toEqual(['hidden-card-1', ...cardIds]);
      expect(commandBody.game.cardZones.wildLocationPool).toHaveLength(3);
      expect(commandBody.game.cardZones.wildIndustryPool).toHaveLength(3);
      expect(storedGame?.players.p1.discardCardIds.filter((cardId) => cardId.startsWith('wild-'))).toEqual([]);

      const observerBroadcast = await broadcast as {
        players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
        cardZones: {wildLocationPool: string[]; wildIndustryPool: string[]};
      };
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p1.discardCardIds).toEqual(['hidden-card-1', ...cardIds]);
      expect(observerBroadcast.cardZones.wildLocationPool).toHaveLength(3);
      expect(observerBroadcast.cardZones.wildIndustryPool).toHaveLength(3);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('creates a game through HTTP and broadcasts HTTP commands to joined sockets', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(created.sessions).toHaveLength(2);

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];
      const broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: session?.token,
        }),
      });
      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>};
      };
      expectNoSessionTokens(commandBody, created.sessions);
      expect(commandBody.game.currentTurnIndex).toBe(1);
      const storedGame = testServer.store.get(created.game.id);
      expect(commandBody.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      const observerBroadcast = await broadcast as {
        currentTurnIndex: number;
        players: Record<string, {handCardIds: string[]}>;
      };
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(observerBroadcast.currentTurnIndex).toBe(1);
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(storedGame?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('skips empty-hand players through HTTP while another player finishes the era', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      const cards = prepareEmptyHandSkipEraEnd(storedGame);

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const p2TurnBroadcast = waitForGameState(socket, (state) =>
        state.roundNumber === 9 &&
        state.currentTurnIndex === 1 &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const p1Response = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId: cards.p1CardId},
          sessionToken: p1Session.token,
        }),
      });
      expect(p1Response.status).toBe(200);
      const p1Body = await p1Response.json() as {game: GameState};
      const p2TurnView = await p2TurnBroadcast as GameState;
      expectNoSessionTokens([p1Body, p2TurnView], created.sessions);
      expect(p1Body.game.currentTurnIndex).toBe(1);
      expect(p1Body.game.players.p1.handCardIds).toEqual([]);
      expect(p2TurnView.currentTurnIndex).toBe(1);
      expect(p2TurnView.players.p1.handCardIds).toEqual([]);

      const p2FirstResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p2', cardId: cards.p2FirstCardId},
          sessionToken: p2Session.token,
        }),
      });
      expect(p2FirstResponse.status).toBe(200);
      const p2FirstBody = await p2FirstResponse.json() as {game: GameState};
      expectNoSessionTokens(p2FirstBody, created.sessions);
      expect(p2FirstBody.game.roundNumber).toBe(9);
      expect(p2FirstBody.game.currentTurnIndex).toBe(1);
      expect(p2FirstBody.game.players.p2.handCardIds).toEqual([cards.p2SecondCardId, cards.p2FinalCardId]);

      const skippedBroadcast = waitForGameState(socket, (state) =>
        state.roundNumber === 10 &&
        state.currentTurnIndex === 1 &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const p2SecondResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p2', cardId: cards.p2SecondCardId},
          sessionToken: p2Session.token,
        }),
      });
      expect(p2SecondResponse.status).toBe(200);
      const p2SecondBody = await p2SecondResponse.json() as {game: GameState};
      const skippedView = await skippedBroadcast as GameState;
      expectNoSessionTokens([p2SecondBody, skippedView], created.sessions);
      expect(p2SecondBody.game.roundNumber).toBe(10);
      expect(p2SecondBody.game.currentTurnIndex).toBe(1);
      expect(p2SecondBody.game.players.p1.handCardIds).toEqual([]);
      expect(p2SecondBody.game.players.p2.handCardIds).toEqual([cards.p2FinalCardId]);
      expect(p2SecondBody.game.eventLog).toContainEqual({type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 10});
      expect(p2SecondBody.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
      expect(skippedView.roundNumber).toBe(10);
      expect(skippedView.currentTurnIndex).toBe(1);
      expect(skippedView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);

      const railBroadcast = waitForGameState(socket, (state) =>
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal')),
      );
      const finalResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p2', cardId: cards.p2FinalCardId},
          sessionToken: p2Session.token,
        }),
      });
      expect(finalResponse.status).toBe(200);
      const finalBody = await finalResponse.json() as {game: GameState};
      const railView = await railBroadcast as GameState;
      expectNoSessionTokens([finalBody, railView], created.sessions);
      expect(finalBody.game.era).toBe('rail');
      expect(finalBody.game.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(railView.era).toBe('rail');
      expect(testServer.store.get(created.game.id)?.era).toBe('rail');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('normalizes nested HTTP sell command strings before broadcasting player views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cardId = storedGame.players.p1.handCardIds[0];
      const cotton = addIndustry(storedGame, {
        id: 'industry-42',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-1', 'p1', 'birmingham-oxford');
      storedGame.board.merchantSpaces['oxford-0'] = {
        id: 'oxford-0',
        merchantTileInstanceId: 'oxford-cotton-0',
        beerPresent: true,
      };

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
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
          },
          sessionToken: ` ${session.token} `,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          currentTurnIndex: number;
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {discardCardIds: string[]; handCardIds: string[]}>;
        };
      };
      const observerBroadcast = await broadcast as {
        currentTurnIndex: number;
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      };

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.currentTurnIndex).toBe(1);
      expect(commandBody.game.board.industryInstances[cotton.id].flipped).toBe(true);
      expect(commandBody.game.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
      expect(commandBody.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      });
      expect(observerBroadcast.currentTurnIndex).toBe(1);
      expect(observerBroadcast.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.eventLog).toContainEqual({
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      });
      expect(testServer.store.get(created.game.id)?.board.industryInstances[cotton.id].flipped).toBe(true);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP Sell merchant develop bonuses and broadcasts the pending decision', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cardId = storedGame.players.p1.handCardIds[0];
      const cotton = addIndustry(storedGame, {
        id: 'industry-44',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-44', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'link-45', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        Boolean(state.eventLog?.some((event) => event.type === 'merchant_bonus_claimed')),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'sell',
            playerId: 'p1',
            cardId,
            sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
          },
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: GameState;
      };
      const observerBroadcast = await broadcast as GameState;
      const resolvedStoreView = testServer.store.get(created.game.id);
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.pendingDecision).toEqual(pendingDecision);
      expect(commandBody.game.currentTurnIndex).toBe(0);
      expect(commandBody.game.actionIndexInTurn).toBe(0);
      expect(commandBody.game.board.industryInstances[cotton.id].flipped).toBe(true);
      expect(commandBody.game.board.merchantSpaces['gloucester-0'].beerPresent).toBe(false);
      expect(commandBody.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandBody.game.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          bonus: {type: 'develop', count: 1},
        },
        {
          type: 'industry_sold',
          industryInstanceId: cotton.id,
          ownerPlayerId: 'p1',
          merchantSpaceId: 'gloucester-0',
        },
      ]));

      expect(observerBroadcast.pendingDecision).toEqual(pendingDecision);
      expect(observerBroadcast.currentTurnIndex).toBe(0);
      expect(observerBroadcast.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.eventLog).toContainEqual({
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        bonus: {type: 'develop', count: 1},
      });
      expect(resolvedStoreView?.pendingDecision).toEqual(pendingDecision);
      expect(resolvedStoreView?.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual([]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for HTTP merchant develop resolution before ending a final-card Canal era Sell', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cotton = addIndustry(storedGame, {
        id: 'industry-46',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-48', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'link-49', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const pendingBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        !state.eventLog?.some((event) => event.type === 'era_ended'),
      );
      const sellResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'sell',
            playerId: 'p1',
            cardId,
            sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
          },
          sessionToken: session.token,
        }),
      });

      expect(sellResponse.status).toBe(200);
      const sellBody = await sellResponse.json() as {game: GameState};
      const pendingView = await pendingBroadcast as GameState;
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expectNoSessionTokens([sellBody, pendingView], created.sessions);
      expect(sellBody.game.pendingDecision).toEqual(pendingDecision);
      expect(sellBody.game.era).toBe('canal');
      expect(sellBody.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);
      expect(pendingView.pendingDecision).toEqual(pendingDecision);
      expect(pendingView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal')),
      );
      const resolveResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'resolve_merchant_develop',
            playerId: 'p1',
            industryTypes: ['manufacturer'],
          },
          sessionToken: session.token,
        }),
      });

      expect(resolveResponse.status).toBe(200);
      const resolveBody = await resolveResponse.json() as {game: GameState};
      const railView = await railBroadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens([resolveBody, railView], created.sessions);
      expect(resolveBody.game.pendingDecision).toBeUndefined();
      expect(resolveBody.game.era).toBe('rail');
      expect(resolveBody.game.roundNumber).toBe(1);
      expect(resolveBody.game.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(resolveBody.game.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(resolveBody.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'merchant_develop_resolved',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          merchantSpaceIds: ['gloucester-0'],
          industryTypes: ['manufacturer'],
          specIds: ['manufacturer-1-1'],
        },
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
      ]));
      expect(railView.pendingDecision).toBeUndefined();
      expect(railView.era).toBe('rail');
      expect(railView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(railView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(finalGame?.era).toBe('rail');
      expect(finalGame?.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(finalGame?.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for HTTP merchant develop resolution before ending a final-card Rail era Sell', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      const cotton = addIndustry(storedGame, {
        id: 'http-final-rail-merchant-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);
      addLink(storedGame, 'http-final-rail-merchant-link-1', 'p1', 'birmingham-worcester', 'rail');
      addLink(storedGame, 'http-final-rail-merchant-link-2', 'p1', 'gloucester-worcester', 'rail');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const pendingBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        state.status === 'playing' &&
        !state.eventLog?.some((event) => event.type === 'game_ended'),
      );
      const sellResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'sell',
            playerId: 'p1',
            cardId,
            sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
          },
          sessionToken: session.token,
        }),
      });

      expect(sellResponse.status).toBe(200);
      const sellBody = await sellResponse.json() as {game: GameState};
      const pendingView = await pendingBroadcast as GameState;
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expectNoSessionTokens([sellBody, pendingView], created.sessions);
      expect(sellBody.game.pendingDecision).toEqual(pendingDecision);
      expect(sellBody.game.status).toBe('playing');
      expect(sellBody.game.era).toBe('rail');
      expect(sellBody.game.eventLog.some((event) => event.type === 'game_ended')).toBe(false);
      expect(pendingView.pendingDecision).toEqual(pendingDecision);
      expect(pendingView.status).toBe('playing');
      expect(pendingView.eventLog.some((event) => event.type === 'game_ended')).toBe(false);

      const endedBroadcast = waitForGameState(socket, (state) =>
        state.pendingDecision === undefined &&
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended')),
      );
      const resolveResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'resolve_merchant_develop',
            playerId: 'p1',
            industryTypes: ['manufacturer'],
          },
          sessionToken: session.token,
        }),
      });

      expect(resolveResponse.status).toBe(200);
      const resolveBody = await resolveResponse.json() as {game: GameState};
      const endedView = await endedBroadcast as GameState;
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens([resolveBody, endedView], created.sessions);
      expect(resolveBody.game.pendingDecision).toBeUndefined();
      expect(resolveBody.game.status).toBe('ended');
      expect(resolveBody.game.era).toBe('rail');
      expect(resolveBody.game.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(resolveBody.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'merchant_develop_resolved',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          merchantSpaceIds: ['gloucester-0'],
          industryTypes: ['manufacturer'],
          specIds: ['manufacturer-1-1'],
        },
        expect.objectContaining({type: 'era_ended', era: 'rail'}),
        expect.objectContaining({type: 'game_ended'}),
      ]));
      expect(endedView.pendingDecision).toBeUndefined();
      expect(endedView.status).toBe('ended');
      expect(endedView.eventLog).toContainEqual(expect.objectContaining({type: 'game_ended'}));
      expect(finalGame?.status).toBe('ended');
      expect(finalGame?.board.industryInstances[cotton.id].removedFromGame).toBe(false);
      expect(finalGame?.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP Build resource selections and broadcasts sanitized views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.players.p1.handCardIds = ['wild-location-1'];
      storedGame.cardZones.wildLocationPool = storedGame.cardZones.wildLocationPool
        .filter((cardId) => cardId !== 'wild-location-1');
      const firstIron = addIndustry(storedGame, {
        id: 'industry-121',
        ownerPlayerId: 'p2',
        industryType: 'iron_works',
        specId: 'iron_works-2-1',
        locationId: 'coalbrookdale',
        slotId: 'coalbrookdale-1',
        remainingResource: 1,
      });
      const selectedIron = addIndustry(storedGame, {
        id: 'industry-122',
        ownerPlayerId: 'p2',
        industryType: 'iron_works',
        specId: 'iron_works-2-1',
        locationId: 'dudley',
        slotId: 'dudley-1',
        remainingResource: 1,
      });
      const ironSource = {kind: 'industry_tile' as const, industryInstanceId: selectedIron.id, resourceType: 'iron' as const};

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'industry_built',
        )),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'build',
            playerId: 'p1',
            cardId: 'wild-location-1',
            locationId: 'stone',
            slotId: 'stone-0',
            industryType: 'brewery',
            ironSources: [ironSource],
          },
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          board: GameState['board'];
          cardZones: {wildLocationPool: string[]};
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; discardCardIds: string[]; handCardIds: string[]}>;
        };
      };
      const observerBroadcast = await broadcast as {
        board: GameState['board'];
        cardZones: {wildLocationPool: string[]};
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      };
      const finalGame = testServer.store.get(created.game.id);
      const builtIndustry = Object.values(commandBody.game.board.industryInstances)
        .find((industry) =>
          industry.ownerPlayerId === 'p1' &&
          industry.industryType === 'brewery' &&
          industry.locationId === 'stone' &&
          industry.slotId === 'stone-0',
        );

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(builtIndustry).toMatchObject({
        specId: 'brewery-1-1',
        remainingResource: 1,
        flipped: false,
      });
      expect(commandBody.game.players.p1.cash).toBe(12);
      expect(commandBody.game.players.p1.discardCardIds).not.toContain('wild-location-1');
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: ironSource,
        byPlayerId: 'p1',
        reason: 'build',
      });
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'card_discarded',
        playerId: 'p1',
        cardId: 'wild-location-1',
        destination: 'wild_pool',
      });
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(observerBroadcast.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: ironSource,
        byPlayerId: 'p1',
        reason: 'build',
      });
      expect(finalGame?.board.industryInstances[firstIron.id].remainingResource).toBe(1);
      expect(finalGame?.board.industryInstances[firstIron.id].flipped).toBe(false);
      expect(finalGame?.board.industryInstances[selectedIron.id].remainingResource).toBe(0);
      expect(finalGame?.board.industryInstances[selectedIron.id].flipped).toBe(true);
      expect(finalGame?.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(finalGame?.players.p1.discardCardIds).not.toContain('wild-location-1');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP Develop iron selections and broadcasts sanitized views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.players.p1.handCardIds = ['p2-location-birmingham-1'];
      storedGame.markets.iron.occupiedCount = 7;
      const ironSources = [
        {kind: 'market' as const, market: 'iron' as const, price: 2},
        {kind: 'market' as const, market: 'iron' as const, price: 3},
      ];

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        ((state as {eventLog?: GameState['eventLog']}).eventLog ?? [])
          .filter((event) => event.type === 'resource_consumed' && event.reason === 'develop')
          .length >= 2,
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'develop',
            playerId: 'p1',
            cardId: 'p2-location-birmingham-1',
            industryTypes: ['coal_mine', 'iron_works'],
            ironSources,
          },
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          eventLog: GameState['eventLog'];
          markets: GameState['markets'];
          players: Record<string, {
            cash: number;
            discardCardIds: string[];
            handCardIds: string[];
            industryTileStacks: GameState['players'][string]['industryTileStacks'];
          }>;
        };
      };
      const observerBroadcast = await broadcast as {
        eventLog: GameState['eventLog'];
        markets: GameState['markets'];
        players: Record<string, {handCardIds: string[]}>;
      };
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.markets.iron.occupiedCount).toBe(5);
      expect(commandBody.game.players.p1.cash).toBe(12);
      expect(commandBody.game.players.p1.discardCardIds).toContain('p2-location-birmingham-1');
      expect(commandBody.game.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(commandBody.game.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'resource_consumed', source: ironSources[0], byPlayerId: 'p1', reason: 'develop'},
        {type: 'resource_consumed', source: ironSources[1], byPlayerId: 'p1', reason: 'develop'},
      ]));
      expect(observerBroadcast.markets.iron.occupiedCount).toBe(5);
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.eventLog).toEqual(expect.arrayContaining([
        {type: 'resource_consumed', source: ironSources[0], byPlayerId: 'p1', reason: 'develop'},
        {type: 'resource_consumed', source: ironSources[1], byPlayerId: 'p1', reason: 'develop'},
      ]));
      expect(finalGame?.markets.iron.occupiedCount).toBe(5);
      expect(finalGame?.players.p1.cash).toBe(12);
      expect(finalGame?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(finalGame?.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP single rail Network resource selections and broadcasts sanitized views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      storedGame.actionsAllowedThisTurn = 2;
      storedGame.actionIndexInTurn = 0;
      storedGame.players.p1.cash = 50;
      storedGame.players.p1.handCardIds = ['p2-location-cannock-1'];
      const coal = addIndustry(storedGame, {
        id: 'industry-101',
        ownerPlayerId: 'p2',
        industryType: 'coal_mine',
        specId: 'coal_mine-2-1',
        locationId: 'cannock',
        slotId: 'cannock-1',
        remainingResource: 1,
      });
      addIndustry(storedGame, {
        id: 'industry-102',
        ownerPlayerId: 'p1',
        industryType: 'manufacturer',
        specId: 'manufacturer-2-1',
        locationId: 'stafford',
        slotId: 'stafford-0',
      });
      const brewery = addIndustry(storedGame, {
        id: 'industry-103',
        ownerPlayerId: 'p1',
        industryType: 'brewery',
        specId: 'brewery-1-1',
        locationId: 'coalbrookdale',
        slotId: 'coalbrookdale-0',
        remainingResource: 1,
      });

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'link_built',
        )),
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'network',
            playerId: 'p1',
            cardId: 'p2-location-cannock-1',
            linkLineIds: ['cannock-stafford'],
            coalSources: [{kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'}],
          },
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; handCardIds: string[]; remainingLinks: {rail: number}}>;
        };
      };
      const observerBroadcast = await broadcast as {
        board: GameState['board'];
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      };
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(commandBody.game.players.p1.cash).toBe(50 - staticConfig.rules.railSingleLinkCost);
      expect(commandBody.game.players.p1.remainingLinks.rail).toBe(staticConfig.rules.initialLinksPerType - 1);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(commandBody.game.eventLog.some((event) =>
        event.type === 'resource_consumed' &&
        event.reason === 'network' &&
        event.source.kind === 'industry_tile' &&
        event.source.resourceType === 'beer',
      )).toBe(false);
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(finalGame?.board.industryInstances[coal.id].remainingResource).toBe(0);
      expect(finalGame?.board.industryInstances[coal.id].flipped).toBe(true);
      expect(finalGame?.board.industryInstances[brewery.id].remainingResource).toBe(1);
      expect(finalGame?.board.industryInstances[brewery.id].flipped).toBe(false);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies HTTP double rail Network coal and beer selections and broadcasts sanitized views', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const storedGame = testServer.store.get(created.game.id);
      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      storedGame.actionsAllowedThisTurn = 2;
      storedGame.actionIndexInTurn = 0;
      storedGame.players.p1.cash = 50;
      storedGame.players.p1.handCardIds = ['p2-location-cannock-1'];
      const coal = addIndustry(storedGame, {
        id: 'industry-111',
        ownerPlayerId: 'p2',
        industryType: 'coal_mine',
        specId: 'coal_mine-2-1',
        locationId: 'cannock',
        slotId: 'cannock-1',
        remainingResource: 2,
      });
      const opponentBrewery = addIndustry(storedGame, {
        id: 'industry-112',
        ownerPlayerId: 'p2',
        industryType: 'brewery',
        specId: 'brewery-2-1',
        locationId: 'stone',
        slotId: 'stone-0',
        remainingResource: 1,
      });
      const coalSource = {kind: 'industry_tile' as const, industryInstanceId: coal.id, resourceType: 'coal' as const};
      const beerSource = {kind: 'industry_tile' as const, industryInstanceId: opponentBrewery.id, resourceType: 'beer' as const};

      socket = await connectSocket(testServer.url);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const broadcast = waitForGameState(socket, (state) =>
        ((state as {eventLog?: Array<{type: string}>}).eventLog ?? [])
          .filter((event) => event.type === 'link_built')
          .length >= 2,
      );
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'network',
            playerId: 'p1',
            cardId: 'p2-location-cannock-1',
            linkLineIds: ['cannock-stafford', 'stafford-stone'],
            coalSources: [coalSource, coalSource],
            beerSourceForDoubleRail: beerSource,
          },
          sessionToken: session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; handCardIds: string[]; remainingLinks: {rail: number}}>;
        };
      };
      const observerBroadcast = await broadcast as {
        board: GameState['board'];
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      };
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens(observerBroadcast, created.sessions);
      expect(commandBody.game.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(commandBody.game.board.linkLines['stafford-stone'].occupiedBy).toBeDefined();
      expect(commandBody.game.players.p1.cash).toBe(50 - staticConfig.rules.railDoubleLinkCost);
      expect(commandBody.game.players.p1.remainingLinks.rail).toBe(staticConfig.rules.initialLinksPerType - 2);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog.filter((event) =>
        event.type === 'resource_consumed' &&
        event.reason === 'network' &&
        event.source.kind === 'industry_tile' &&
        event.source.industryInstanceId === coal.id &&
        event.source.resourceType === 'coal',
      )).toHaveLength(2);
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: beerSource,
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(observerBroadcast.board.linkLines['stafford-stone'].occupiedBy).toBeDefined();
      expect(observerBroadcast.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: beerSource,
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(finalGame?.board.industryInstances[coal.id].remainingResource).toBe(0);
      expect(finalGame?.board.industryInstances[coal.id].flipped).toBe(true);
      expect(finalGame?.board.industryInstances[opponentBrewery.id].remainingResource).toBe(0);
      expect(finalGame?.board.industryInstances[opponentBrewery.id].flipped).toBe(true);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('trims HTTP route game IDs when fetching state and broadcasting commands', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const paddedPathId = encodeURIComponent(` ${created.game.id}\n`);

      const getResponse = await fetch(`${testServer.url}/api/games/${paddedPathId}`, {
        headers: {
          'x-player-id': ` ${p1Session?.playerId ?? ''} `,
          'x-player-token': `\t${p1Session?.token ?? ''}\n`,
        },
      });
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toMatchObject({
        game: {
          id: created.game.id,
          players: {
            p1: {handCardIds: created.game.players.p1.handCardIds},
          },
        },
      });

      socket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 0);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const cardId = created.game.players.p1.handCardIds[0];
      const commandBroadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${paddedPathId}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-token': p1Session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: ' p1 ', cardId}),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {id: string; currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>};
      };
      expect(commandBody).toMatchObject({
        game: {id: created.game.id, currentTurnIndex: 1},
      });
      expect(commandBody.game.players.p1.handCardIds.every((id) => !id.startsWith('hidden-card-'))).toBe(true);
      await expect(commandBroadcast).resolves.toMatchObject({
        id: created.game.id,
        currentTurnIndex: 1,
      });
      expect(testServer.io.sockets.adapter.rooms.get(` ${created.game.id}\n`)).toBeUndefined();
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('broadcasts HTTP command results with each joined socket player view', async () => {
    const testServer = await startTestServer();
    let firstSocket: Socket | undefined;
    let secondSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');

      firstSocket = await connectSocket(testServer.url);
      secondSocket = await connectSocket(testServer.url);
      const firstJoin = await emitWithAck(firstSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      const secondJoin = await emitWithAck(secondSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p2Session?.playerId,
        sessionToken: p2Session?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      expect(secondJoin.ok).toBe(true);

      const cardId = created.game.players.p1.handCardIds[0];
      const firstBroadcast = waitForGameState(firstSocket, (state) => state.currentTurnIndex === 1);
      const secondBroadcast = waitForGameState(secondSocket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session?.token,
        }),
      });
      expect(commandResponse.status).toBe(200);

      const storedGame = testServer.store.get(created.game.id);
      const broadcasts = await Promise.all([firstBroadcast, secondBroadcast]) as Array<{
        players: Record<string, {handCardIds: string[]}>;
      }>;

      expectNoSessionTokens(broadcasts, created.sessions);
      expect(broadcasts[0].players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(broadcasts[0].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p2.handCardIds).toEqual(storedGame?.players.p2.handCardIds);
    } finally {
      firstSocket?.disconnect();
      secondSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('broadcasts resolved pending decisions with each joined socket player view', async () => {
    const testServer = await startTestServer();
    let firstSocket: Socket | undefined;
    let secondSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      storedGame.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1};
      storedGame.players.p2.cash = 5;
      storedGame.players.p1.spentThisRound = 5;
      storedGame.players.p2.spentThisRound = 0;

      firstSocket = await connectSocket(testServer.url);
      secondSocket = await connectSocket(testServer.url);
      const firstJoin = await emitWithAck(firstSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p1Session.playerId,
        sessionToken: p1Session.token,
      }) as {ok: boolean};
      const secondJoin = await emitWithAck(secondSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p2Session.playerId,
        sessionToken: p2Session.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      expect(secondJoin.ok).toBe(true);

      const resolvedPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'negative_income_resolved',
        ));
      const firstBroadcast = waitForGameState(firstSocket, resolvedPredicate);
      const secondBroadcast = waitForGameState(secondSocket, resolvedPredicate);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'resolve_negative_income', playerId: 'p2', industryInstanceIds: []},
          sessionToken: p2Session.token,
        }),
      });
      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          pendingDecision?: unknown;
          players: Record<string, {handCardIds: string[]}>;
          eventLog: Array<{type: string}>;
        };
      };
      const resolvedGame = testServer.store.get(created.game.id);
      expect(commandBody.game.pendingDecision).toBeUndefined();
      expect(commandBody.game.eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(true);
      expect(commandBody.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.players.p2.handCardIds).toEqual(resolvedGame?.players.p2.handCardIds);

      const broadcasts = await Promise.all([firstBroadcast, secondBroadcast]) as Array<{
        pendingDecision?: unknown;
        players: Record<string, {handCardIds: string[]}>;
        eventLog: Array<{type: string}>;
      }>;

      expect(broadcasts[0].pendingDecision).toBeUndefined();
      expect(broadcasts[0].eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(true);
      expect(broadcasts[0].players.p1.handCardIds).toEqual(resolvedGame?.players.p1.handCardIds);
      expect(broadcasts[0].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].pendingDecision).toBeUndefined();
      expect(broadcasts[1].eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(true);
      expect(broadcasts[1].players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p2.handCardIds).toEqual(resolvedGame?.players.p2.handCardIds);
    } finally {
      firstSocket?.disconnect();
      secondSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('broadcasts resolved merchant develop decisions with each joined socket player view', async () => {
    const testServer = await startTestServer();
    let firstSocket: Socket | undefined;
    let secondSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      storedGame.pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 2,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      };

      firstSocket = await connectSocket(testServer.url);
      secondSocket = await connectSocket(testServer.url);
      const firstJoin = await emitWithAck(firstSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p1Session.playerId,
        sessionToken: p1Session.token,
      }) as {ok: boolean};
      const secondJoin = await emitWithAck(secondSocket, 'game:join', {
        gameId: created.game.id,
        playerId: p2Session.playerId,
        sessionToken: p2Session.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      expect(secondJoin.ok).toBe(true);

      const resolvedPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'merchant_develop_resolved',
        ));
      const firstBroadcast = waitForGameState(firstSocket, resolvedPredicate);
      const secondBroadcast = waitForGameState(secondSocket, resolvedPredicate);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {
            type: 'resolve_merchant_develop',
            playerId: 'p1',
            industryTypes: ['coal_mine', 'iron_works'],
          },
          sessionToken: p1Session.token,
        }),
      });

      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {
          currentTurnIndex: number;
          pendingDecision?: unknown;
          players: Record<string, {
            handCardIds: string[];
            industryTileStacks: GameState['players'][string]['industryTileStacks'];
          }>;
          eventLog: GameState['eventLog'];
        };
      };
      const resolvedGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expect(commandBody.game.pendingDecision).toBeUndefined();
      expect(commandBody.game.currentTurnIndex).toBe(1);
      expect(commandBody.game.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(commandBody.game.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(commandBody.game.players.p1.handCardIds).toEqual(resolvedGame?.players.p1.handCardIds);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.eventLog).toContainEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['coal_mine', 'iron_works'],
        specIds: ['coal_mine-1-1', 'iron_works-1-1'],
      });

      const broadcasts = await Promise.all([firstBroadcast, secondBroadcast]) as Array<{
        currentTurnIndex: number;
        pendingDecision?: unknown;
        players: Record<string, {
          handCardIds: string[];
          industryTileStacks: GameState['players'][string]['industryTileStacks'];
        }>;
        eventLog: GameState['eventLog'];
      }>;

      expectNoSessionTokens(broadcasts, created.sessions);
      expect(broadcasts[0].pendingDecision).toBeUndefined();
      expect(broadcasts[0].currentTurnIndex).toBe(1);
      expect(broadcasts[0].players.p1.handCardIds).toEqual(resolvedGame?.players.p1.handCardIds);
      expect(broadcasts[0].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[0].players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(broadcasts[0].eventLog).toContainEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['coal_mine', 'iron_works'],
        specIds: ['coal_mine-1-1', 'iron_works-1-1'],
      });
      expect(broadcasts[1].pendingDecision).toBeUndefined();
      expect(broadcasts[1].currentTurnIndex).toBe(1);
      expect(broadcasts[1].players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p2.handCardIds).toEqual(resolvedGame?.players.p2.handCardIds);
      expect(broadcasts[1].players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(resolvedGame?.pendingDecision).toBeUndefined();
      expect(resolvedGame?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(resolvedGame?.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
    } finally {
      firstSocket?.disconnect();
      secondSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not clear negative-income pending decisions from the wrong player over HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session) {
        throw new Error('Expected created game and p1 session');
      }
      const pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1} as const;
      storedGame.pendingDecision = pendingDecision;
      storedGame.players.p2.cash = 0;
      const p2Cotton = addIndustry(storedGame, {
        id: 'http-socket-wrong-negative-income-cotton',
        ownerPlayerId: 'p2',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'worcester',
        slotId: 'worcester-0',
      });
      storedGame.players.p2.industryTileStacks.cotton_mill.builtInstanceIds.push(p2Cotton.id);
      const eventLogLengthBefore = storedGame.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p2',
      );
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: []},
            sessionToken: p1Session.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({
        errors: ['Pending negative income decision belongs to p2'],
      });

      const socketResponse = await expectNoGameStateWhile(observerSocket, () =>
        emitWithAck(observerSocket as Socket, 'game:command', {
          gameId: created.game.id,
          command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: []},
          sessionToken: p1Session.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({
        ok: false,
        errors: ['Pending negative income decision belongs to p2'],
      });

      const finalGame = testServer.store.get(created.game.id);
      expect(finalGame?.pendingDecision).toEqual(pendingDecision);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(false);
      expect(finalGame?.players.p2.cash).toBe(0);
      expect(finalGame?.board.industryInstances[p2Cotton.id].removedFromGame).toBe(false);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not clear merchant-develop pending decisions from the wrong player over HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session) {
        throw new Error('Expected created game and p1 session');
      }
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p2',
        count: 1,
        merchantSpaceId: 'gloucester-0',
      } as const;
      storedGame.pendingDecision = pendingDecision;
      const p1CoalBefore = [...storedGame.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder];
      const p2CoalBefore = [...storedGame.players.p2.industryTileStacks.coal_mine.availableSpecIdsInOrder];
      const eventLogLengthBefore = storedGame.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        state.pendingDecision.playerId === 'p2',
      );
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['coal_mine']},
            sessionToken: p1Session.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({
        errors: ['Pending merchant develop decision belongs to p2'],
      });

      const socketResponse = await expectNoGameStateWhile(observerSocket, () =>
        emitWithAck(observerSocket as Socket, 'game:command', {
          gameId: created.game.id,
          command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['coal_mine']},
          sessionToken: p1Session.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({
        ok: false,
        errors: ['Pending merchant develop decision belongs to p2'],
      });

      const finalGame = testServer.store.get(created.game.id);
      expect(finalGame?.pendingDecision).toEqual(pendingDecision);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) => event.type === 'merchant_develop_resolved')).toBe(false);
      expect(finalGame?.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder).toEqual(p1CoalBefore);
      expect(finalGame?.players.p2.industryTileStacks.coal_mine.availableSpecIdsInOrder).toEqual(p2CoalBefore);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not clear negative-income pending decisions for invalid HTTP liquidation selections', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session) {
        throw new Error('Expected created game and p1 session');
      }
      const pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0} as const;
      storedGame.pendingDecision = pendingDecision;
      storedGame.players.p1.cash = 0;
      const cotton = addIndustry(storedGame, {
        id: 'http-invalid-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      const opponentCoal = addIndustry(storedGame, {
        id: 'http-invalid-negative-income-opponent-coal',
        ownerPlayerId: 'p2',
        industryType: 'coal_mine',
        specId: 'coal_mine-1-1',
        locationId: 'cannock',
        slotId: 'cannock-1',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);
      storedGame.players.p2.industryTileStacks.coal_mine.builtInstanceIds.push(opponentCoal.id);
      const eventLogLengthBefore = storedGame.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p1',
      );
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {
              type: 'resolve_negative_income',
              playerId: 'p1',
              industryInstanceIds: [cotton.id, cotton.id, opponentCoal.id],
            },
            sessionToken: p1Session.token,
          }),
        }),
      );

      expect(httpResponse.status).toBe(400);
      const body = await httpResponse.json() as {errors: string[]};
      expect(body.errors).toEqual(expect.arrayContaining([
        `Industry ${cotton.id} selected more than once`,
        `Industry ${opponentCoal.id} is not owned by p1`,
      ]));

      const finalGame = testServer.store.get(created.game.id);
      expect(finalGame?.pendingDecision).toEqual(pendingDecision);
      expect(finalGame?.players.p1.cash).toBe(0);
      expect(finalGame?.board.industryInstances[cotton.id].removedFromGame).toBe(false);
      expect(finalGame?.board.industryInstances[opponentCoal.id].removedFromGame).toBe(false);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) => event.type === 'negative_income_resolved')).toBe(false);
      expect(finalGame?.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'negative income liquidation',
      )).toBe(false);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not clear merchant-develop pending decisions for invalid Socket.IO tile selections', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(createResponse.game.id);
      if (!storedGame || !p1Session) {
        throw new Error('Expected created game and p1 session');
      }
      const pendingDecision: NonNullable<GameState['pendingDecision']> = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 2,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      };
      storedGame.pendingDecision = pendingDecision;
      storedGame.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];
      const stackBefore = structuredClone(storedGame.players.p1.industryTileStacks.coal_mine);
      const eventLogLengthBefore = storedGame.eventLog.length;

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const socketResponse = await expectNoGameStateWhile(hostSocket, () =>
        expectNoGameStateWhile(observerSocket as Socket, () =>
          emitWithAck(hostSocket as Socket, 'game:command', {
            gameId: createResponse.game.id,
            command: {
              type: 'resolve_merchant_develop',
              playerId: 'p1',
              industryTypes: ['coal_mine', 'coal_mine'],
            },
            sessionToken: p1Session.token,
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
      );

      expect(socketResponse).toEqual({
        ok: false,
        errors: ['No coal_mine tile available to develop'],
      });
      const finalGame = testServer.store.get(createResponse.game.id);
      expect(finalGame?.pendingDecision).toEqual(pendingDecision);
      expect(finalGame?.players.p1.industryTileStacks.coal_mine).toEqual(stackBefore);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) => event.type === 'merchant_develop_resolved')).toBe(false);
      expect(testServer.io.sockets.sockets.get(hostSocket.id as string)?.data.playerId).toBe('p1');
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('accepts the player session token from the HTTP header', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const cardId = created.game.players.p1.handCardIds[0];

      const missingToken = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId}),
      });
      expect(missingToken.status).toBe(400);
      await expect(missingToken.json()).resolves.toEqual({errors: ['Invalid session for p1']});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);

      const session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const wrongBodyToken = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-token': session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId, sessionToken: 'wrong-token'}),
      });
      expect(wrongBodyToken.status).toBe(400);
      await expect(wrongBodyToken.json()).resolves.toEqual({errors: ['Invalid session for p1']});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);

      const mismatchedHeaderPlayer = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id': 'p2',
          'x-player-token': session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId}),
      });
      expect(mismatchedHeaderPlayer.status).toBe(400);
      await expect(mismatchedHeaderPlayer.json()).resolves.toEqual({
        errors: ['Player header does not match command player'],
      });
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);

      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id': ' p1 ',
          'x-player-token': ` ${session?.token ?? ''}\n`,
        },
        body: JSON.stringify({type: ' pass ', playerId: ' p1 ', cardId, sessionToken: '   '}),
      });
      expect(commandResponse.status).toBe(200);
      const commandBody = await commandResponse.json() as {
        game: {currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>};
      };
      expectNoSessionTokens(commandBody, created.sessions);
      expect(commandBody.game.currentTurnIndex).toBe(1);
      expect(commandBody.game.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(commandBody.game.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(created.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('returns HTTP 400 for malformed command bodies without mutating the game', async () => {
    const testServer = await startTestServer();
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const handBefore = [...game.players.p1.handCardIds];

      const response = await fetch(`${testServer.url}/api/games/${game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(null),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({errors: ['Malformed command']});
      expect(testServer.store.get(game.id)?.currentTurnIndex).toBe(0);
      expect(testServer.store.get(game.id)?.players.p1.handCardIds).toEqual(handBefore);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('does not broadcast failed commands through HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      const p2CardId = created.game.players.p2.handCardIds[0];

      const socket = await connectSocket(testServer.url);
      observerSocket = socket;
      const initialBroadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 0);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(socket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'pass', playerId: 'p2', cardId: p2CardId},
            sessionToken: p2Session?.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({errors: ["It is p1's turn"]});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);

      const socketResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket, 'game:command', {
          gameId: created.game.id,
          command: {type: 'pass', playerId: 'p2', cardId: p2CardId},
          sessionToken: p2Session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({ok: false, errors: ["It is p1's turn"]});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not accept ordinary commands while a pending decision exists over HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session || !cardId) {
        throw new Error('Expected created game, p1 session, and p1 card');
      }
      const pendingDecision = {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      } as const;
      storedGame.pendingDecision = pendingDecision;
      storedGame.currentTurnIndex = 0;
      storedGame.actionIndexInTurn = 0;
      const handBefore = [...storedGame.players.p1.handCardIds];
      const discardBefore = [...storedGame.players.p1.discardCardIds];
      const eventLogLengthBefore = storedGame.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p1',
      );
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'pass', playerId: 'p1', cardId},
            sessionToken: p1Session.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({errors: ['Pending decision must be resolved first']});

      const socketResponse = await expectNoGameStateWhile(observerSocket, () =>
        emitWithAck(observerSocket as Socket, 'game:command', {
          gameId: created.game.id,
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({ok: false, errors: ['Pending decision must be resolved first']});

      const finalGame = testServer.store.get(created.game.id);
      expect(finalGame?.status).toBe('playing');
      expect(finalGame?.pendingDecision).toEqual(pendingDecision);
      expect(finalGame?.currentTurnIndex).toBe(0);
      expect(finalGame?.actionIndexInTurn).toBe(0);
      expect(finalGame?.players.p1.handCardIds).toEqual(handBefore);
      expect(finalGame?.players.p1.discardCardIds).toEqual(discardBefore);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) =>
        event.type === 'card_discarded' && event.playerId === 'p1' && event.cardId === cardId,
      )).toBe(false);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not accept commands after a game has ended over HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];
      const storedGame = testServer.store.get(created.game.id);
      if (!storedGame || !p1Session || !cardId) {
        throw new Error('Expected created game, p1 session, and p1 card');
      }
      storedGame.status = 'ended';
      storedGame.pendingDecision = undefined;
      const handBefore = [...storedGame.players.p1.handCardIds];
      const discardBefore = [...storedGame.players.p1.discardCardIds];
      const eventLogLengthBefore = storedGame.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) => state.status === 'ended');
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'pass', playerId: 'p1', cardId},
            sessionToken: p1Session.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({errors: ['Game is not active']});

      const socketResponse = await expectNoGameStateWhile(observerSocket, () =>
        emitWithAck(observerSocket as Socket, 'game:command', {
          gameId: created.game.id,
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({ok: false, errors: ['Game is not active']});

      const finalGame = testServer.store.get(created.game.id);
      expect(finalGame?.status).toBe('ended');
      expect(finalGame?.pendingDecision).toBeUndefined();
      expect(finalGame?.currentTurnIndex).toBe(0);
      expect(finalGame?.players.p1.handCardIds).toEqual(handBefore);
      expect(finalGame?.players.p1.discardCardIds).toEqual(discardBefore);
      expect(finalGame?.eventLog).toHaveLength(eventLogLengthBefore);
      expect(finalGame?.eventLog.some((event) =>
        event.type === 'card_discarded' && event.playerId === 'p1' && event.cardId === cardId,
      )).toBe(false);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not broadcast malformed nested sell commands through HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = created.game.players.p1.handCardIds[0];
      const gameBefore = testServer.store.get(created.game.id);
      const handBefore = [...(gameBefore?.players.p1.handCardIds ?? [])];
      const discardBefore = [...(gameBefore?.players.p1.discardCardIds ?? [])];
      const eventLogLengthBefore = gameBefore?.eventLog.length;

      observerSocket = await connectSocket(testServer.url);
      const initialBroadcast = waitForGameState(observerSocket, (state) => state.currentTurnIndex === 0);
      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const httpResponse = await expectNoGameStateWhile(observerSocket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {
              type: 'sell',
              playerId: 'p1',
              cardId,
              sales: [{
                industryInstanceId: 'industry-42',
                merchantSpaceId: 'oxford-0',
                beerSources: {},
              }],
            },
            sessionToken: p1Session?.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({
        errors: ['sell command sales[0] field beerSources must be an array'],
      });

      const socketResponse = await expectNoGameStateWhile(observerSocket, () =>
        emitWithAck(observerSocket as Socket, 'game:command', {
          gameId: created.game.id,
          command: {
            type: 'sell',
            playerId: 'p1',
            cardId,
            sales: [{
              industryInstanceId: 'industry-42',
              merchantSpaceId: 'oxford-0',
              beerSources: [{kind: 'industry_tile', industryInstanceId: 1, resourceType: 'beer'}],
            }],
          },
          sessionToken: p1Session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({
        ok: false,
        errors: ['sell command sales[0].beerSources[0].industryInstanceId must be a string'],
      });

      const gameAfter = testServer.store.get(created.game.id);
      expect(gameAfter?.currentTurnIndex).toBe(0);
      expect(gameAfter?.players.p1.handCardIds).toEqual(handBefore);
      expect(gameAfter?.players.p1.discardCardIds).toEqual(discardBefore);
      expect(gameAfter?.eventLog).toHaveLength(eventLogLengthBefore ?? 0);
      const serverSocket = testServer.io.sockets.sockets.get(observerSocket.id as string);
      expect(serverSocket?.data.playerId).toBeUndefined();
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not broadcast unknown command types through HTTP or Socket.IO', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');

      const socket = await connectSocket(testServer.url);
      observerSocket = socket;
      const initialBroadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 0);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialBroadcast;

      const command = {type: 'future_command', playerId: 'p1'};
      const httpResponse = await expectNoGameStateWhile(socket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command,
            sessionToken: p1Session?.token,
          }),
        }),
      );
      expect(httpResponse.status).toBe(400);
      await expect(httpResponse.json()).resolves.toEqual({errors: ['Unknown command']});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);

      const socketResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket, 'game:command', {
          gameId: created.game.id,
          command,
          sessionToken: p1Session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(socketResponse).toEqual({ok: false, errors: ['Unknown command']});
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(0);
    } finally {
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('returns JSON errors for invalid HTTP JSON bodies', async () => {
    const testServer = await startTestServer();
    try {
      const response = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{',
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({errors: ['Malformed JSON body']});
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('replies to malformed socket payloads without disconnecting the client', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      await expect(emitWithAck(socket, 'game:join', null)).resolves.toEqual({
        ok: false,
        errors: ['Malformed join payload'],
      });
      await expect(emitWithAck(socket, 'game:join', {gameId: '   '})).resolves.toEqual({
        ok: false,
        errors: ['Malformed join payload'],
      });
      await expect(emitWithAck(socket, 'game:command', null)).resolves.toEqual({
        ok: false,
        errors: ['Malformed command payload'],
      });
      await expect(emitWithAck(socket, 'game:command', {gameId: '\t', command: {type: 'pass'}})).resolves.toEqual({
        ok: false,
        errors: ['Malformed command payload'],
      });
      expect(testServer.io.sockets.adapter.rooms.get('   ')).toBeUndefined();
      expect(testServer.io.sockets.adapter.rooms.get('\t')).toBeUndefined();
      expect(socket.connected).toBe(true);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed socket commands from observers without binding a player or broadcasting', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      socket = await connectSocket(testServer.url);
      const socketId = socket.id as string;
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: game.id}) as {ok: boolean};

      expect(joinResponse.ok).toBe(true);

      const response = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:command', {
          gameId: game.id,
          command: 'pass',
          sessionToken: 'irrelevant-token',
        }) as Promise<{ok: boolean; errors: string[]}>,
      );

      expect(response).toEqual({ok: false, errors: ['Malformed command']});
      expect(testServer.store.get(game.id)?.currentTurnIndex).toBe(0);
      expect(testServer.io.sockets.adapter.rooms.get(game.id)?.has(socketId)).toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socketId);
      expect(serverSocket?.data.gameId).toBe(game.id);
      expect(serverSocket?.data.playerId).toBeUndefined();
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed socket commands from bound players without clearing their view', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const session = testServer.store.getPlayerSession(game.id, 'p1');
      socket = await connectSocket(testServer.url);
      const socketId = socket.id as string;
      const initialState = waitForGameState(socket, (state) => state.id === game.id);
      const joinResponse = await emitWithAck(socket, 'game:join', {
        gameId: game.id,
        playerId: 'p1',
        sessionToken: session?.token,
      }) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialState;

      const malformedEnvelopeResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:command', {
          gameId: '   ',
          command: {type: 'pass', playerId: 'p1'},
          sessionToken: session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(malformedEnvelopeResponse).toEqual({ok: false, errors: ['Malformed command payload']});

      const malformedCommandResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:command', {
          gameId: game.id,
          command: 'pass',
          sessionToken: session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(malformedCommandResponse).toEqual({ok: false, errors: ['Malformed command']});
      expect(testServer.store.get(game.id)?.currentTurnIndex).toBe(0);
      expect(testServer.io.sockets.adapter.rooms.get(game.id)?.has(socketId)).toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socketId);
      expect(serverSocket?.data.gameId).toBe(game.id);
      expect(serverSocket?.data.playerId).toBe('p1');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('projects socket join responses by observer or player session without leaking private cards', async () => {
    const testServer = await startTestServer();
    let observerSocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
        sessions: PlayerSession[];
      };
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();

      observerSocket = await connectSocket(testServer.url);
      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: created.game.id}) as {
        ok: boolean;
        session?: PlayerSession;
        game: {
          players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
          cardZones: {drawDeck: string[]};
        };
      };

      expect(observerJoin.ok).toBe(true);
      expect(observerJoin.session).toBeUndefined();
      expect(observerJoin.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerJoin.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerJoin.game.players.p1.discardCardIds).toEqual(['hidden-card-1']);
      expect(observerJoin.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerJoin.game.cardZones.drawDeck).toHaveLength(storedGame?.cardZones.drawDeck.length ?? 0);

      playerSocket = await connectSocket(testServer.url);
      const playerJoin = await emitWithAck(playerSocket, 'game:join', {
        gameId: created.game.id,
        playerId: ` ${p2Session?.playerId ?? ''} `,
        sessionToken: `\n${p2Session?.token ?? ''}\t`,
      }) as {
        ok: boolean;
        session?: PlayerSession;
        game: {
          players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
          cardZones: {drawDeck: string[]};
        };
      };

      expect(playerJoin.ok).toBe(true);
      expect(playerJoin.session).toEqual(p2Session);
      expect(playerJoin.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(playerJoin.game.players.p2.handCardIds).toEqual(storedGame?.players.p2.handCardIds);
      expect(playerJoin.game.players.p2.discardCardIds).toEqual(['hidden-card-1']);
      expect(playerJoin.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(playerJoin.game.cardZones.drawDeck).toHaveLength(storedGame?.cardZones.drawDeck.length ?? 0);
    } finally {
      observerSocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('moves a socket out of its previous game room when it joins another game', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      socket = await connectSocket(testServer.url);
      expect(socket.id).toBeDefined();
      const socketId = socket.id as string;

      const firstJoin = await emitWithAck(socket, 'game:join', {gameId: ` ${firstGame.id} `}) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(` ${firstGame.id} `)).toBeUndefined();

      const secondJoin = await emitWithAck(socket, 'game:join', {gameId: `\t${secondGame.id}\n`}) as {ok: boolean};
      expect(secondJoin.ok).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(`\t${secondGame.id}\n`)).toBeUndefined();
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('lets sockets leave their current game room and stop receiving broadcasts', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      expect(p1Session).toBeDefined();

      socket = await connectSocket(testServer.url);
      const socketId = socket.id as string;
      const initialState = waitForGameState(socket, (state) => state.id === created.game.id);
      const joinResponse = await emitWithAck(socket, 'game:join', {
        gameId: created.game.id,
        playerId: 'p1',
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await initialState;

      expect(testServer.io.sockets.adapter.rooms.get(created.game.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(created.game.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const leaveResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:leave', {}) as Promise<{ok: boolean}>,
      );
      expect(leaveResponse).toEqual({ok: true});
      expect(testServer.io.sockets.adapter.rooms.get(created.game.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBeUndefined();
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBeUndefined();

      const cardId = created.game.players.p1.handCardIds[0];
      const commandResponse = await expectNoGameStateWhile(socket, () =>
        fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'pass', playerId: 'p1', cardId},
            sessionToken: p1Session?.token,
          }),
        }),
      );
      expect(commandResponse.status).toBe(200);
      expect(testServer.store.get(created.game.id)?.currentTurnIndex).toBe(1);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not move or bind sockets after failed Socket.IO join attempts', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      const p1Session = testServer.store.getPlayerSession(firstGame.id, 'p1');
      expect(p1Session).toBeDefined();

      socket = await connectSocket(testServer.url);
      expect(socket.id).toBeDefined();
      const socketId = socket.id as string;
      const initialState = waitForGameState(socket, (state) => state.id === firstGame.id);
      const firstJoin = await emitWithAck(socket, 'game:join', {
        gameId: firstGame.id,
        playerId: 'p1',
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      await initialState;

      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const invalidSessionResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:join', {
          gameId: secondGame.id,
          playerId: 'p1',
          sessionToken: 'wrong-token',
        }) as Promise<{ok: boolean; errors: string[]}>,
      );
      expect(invalidSessionResponse).toEqual({ok: false, errors: ['Invalid player session']});
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const malformedJoinResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:join', {gameId: '   '}) as Promise<{
          ok: boolean;
          errors: string[];
        }>,
      );
      expect(malformedJoinResponse).toEqual({ok: false, errors: ['Malformed join payload']});
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get('   ')).toBeUndefined();
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const missingGameResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:join', {gameId: 'missing-game'}) as Promise<{
          ok: boolean;
          errors: string[];
        }>,
      );
      expect(missingGameResponse).toEqual({ok: false, errors: ['Game not found']});
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('keeps the previous socket player view after a failed session join', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = created.sessions.find((candidate) => candidate.playerId === 'p2');

      socket = await connectSocket(testServer.url);
      await expect(emitWithAck(socket, 'game:join', {
        gameId: created.game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      })).resolves.toMatchObject({ok: true});

      await expect(emitWithAck(socket, 'game:join', {
        gameId: created.game.id,
        playerId: p2Session?.playerId,
        sessionToken: 'wrong-token',
      })).resolves.toEqual({ok: false, errors: ['Invalid player session']});

      const cardId = created.game.players.p1.handCardIds[0];
      const broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session?.token,
        }),
      });
      expect(commandResponse.status).toBe(200);

      const state = await broadcast as {players: Record<string, {handCardIds: string[]}>};
      const storedGame = testServer.store.get(created.game.id);
      expect(state.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(state.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('clears a socket player view when it rejoins the same game as an observer', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();

      socket = await connectSocket(testServer.url);
      const playerJoin = await emitWithAck(socket, 'game:join', {
        gameId: created.game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      }) as {
        ok: boolean;
        game: {players: Record<string, {handCardIds: string[]}>};
      };
      expect(playerJoin.ok).toBe(true);
      expect(playerJoin.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);

      const observerJoin = await emitWithAck(socket, 'game:join', {gameId: created.game.id}) as {
        ok: boolean;
        session?: PlayerSession;
        game: {players: Record<string, {handCardIds: string[]}>};
      };
      expect(observerJoin.ok).toBe(true);
      expect(observerJoin.session).toBeUndefined();
      expect(observerJoin.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socket.id as string);
      expect(serverSocket?.data.playerId).toBeUndefined();

      const cardId = created.game.players.p1.handCardIds[0];
      const observerBroadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          command: {type: 'pass', playerId: 'p1', cardId},
          sessionToken: p1Session?.token,
        }),
      });
      expect(commandResponse.status).toBe(200);

      const broadcast = await observerBroadcast as {
        players: Record<string, {handCardIds: string[]}>;
      };
      expect(broadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(created.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects non-finite create seeds through Socket.IO without creating a game', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: Number.POSITIVE_INFINITY,
      }) as {ok: boolean; errors: string[]};

      expect(createResponse).toEqual({
        ok: false,
        errors: ['Game seed must be a finite number'],
      });
      expect(testServer.store.list()).toEqual([]);

      const fractionalResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 1.5,
      }) as {ok: boolean; errors: string[]};

      expect(fractionalResponse).toEqual({
        ok: false,
        errors: ['Game seed must be an integer'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed player names through Socket.IO without creating a game', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const missingNamesResponse = await emitWithAck(socket, 'game:create', {seed: 5}) as {ok: boolean; errors: string[]};
      expect(missingNamesResponse).toEqual({
        ok: false,
        errors: ['Player names must be an array'],
      });

      const nonArrayNamesResponse = await emitWithAck(socket, 'game:create', {
        playerNames: 'Ada',
        seed: 5,
      }) as {ok: boolean; errors: string[]};
      expect(nonArrayNamesResponse).toEqual({
        ok: false,
        errors: ['Player names must be an array'],
      });

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', false],
        seed: 5,
      }) as {ok: boolean; errors: string[]};

      expect(createResponse).toEqual({
        ok: false,
        errors: ['Player names must be strings'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects unsupported player counts through Socket.IO without creating a game', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const tooFewResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada'],
        seed: 5,
      }) as {ok: boolean; errors: string[]};
      expect(tooFewResponse).toEqual({
        ok: false,
        errors: ['Brass: Birmingham supports 2-4 players'],
      });

      const tooManyResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben', 'Cara', 'Dev', 'Eli'],
        seed: 5,
      }) as {ok: boolean; errors: string[]};
      expect(tooManyResponse).toEqual({
        ok: false,
        errors: ['Brass: Birmingham supports 2-4 players'],
      });
      expect(testServer.store.list()).toEqual([]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('does not bind or broadcast failed Socket.IO game creation attempts', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await expectNoGameStateWhile(socket, async () => emitWithAck(socket as Socket, 'game:create', {
        playerNames: ['Ada'],
        seed: 5,
      })) as {ok: boolean; errors: string[]};

      expect(createResponse).toEqual({
        ok: false,
        errors: ['Brass: Birmingham supports 2-4 players'],
      });
      expect(testServer.store.list()).toEqual([]);
      const serverSocket = testServer.io.sockets.sockets.get(socket.id as string);
      expect(serverSocket?.data.gameId).toBeUndefined();
      expect(serverSocket?.data.playerId).toBeUndefined();
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('normalizes blank player names through Socket.IO game creation', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: [' Ada ', '   ', '\t'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {name: string}>};
        sessions: PlayerSession[];
      };

      expect(createResponse.ok).toBe(true);
      expect(createResponse.game.players.p1.name).toBe('Ada');
      expect(createResponse.game.players.p2.name).toBe('Player 2');
      expect(createResponse.game.players.p3.name).toBe('Player 3');
      expect(createResponse.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(testServer.store.list()).toEqual([expect.objectContaining({
        id: createResponse.game.id,
        playerNames: ['Ada', 'Player 2', 'Player 3'],
        playerCount: 3,
      })]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('creates introductory Canal-only games through Socket.IO when requested', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
        introductoryCanalOnly: true,
      }) as {
        ok: boolean;
        game: {id: string; variant?: string};
        sessions: PlayerSession[];
      };

      expect(createResponse.ok).toBe(true);
      expect(createResponse.game.variant).toBe('introductory_canal_only');
      expect(createResponse.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2']);
      expect(testServer.store.get(createResponse.game.id)?.variant).toBe('introductory_canal_only');
      expect(testServer.store.list()).toEqual([expect.objectContaining({
        id: createResponse.game.id,
        variant: 'introductory_canal_only',
      })]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('broadcasts public game lists after Socket.IO game creation and commands', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createList = waitForGameList(socket, (payload) => payload.games?.length === 1);
      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {
          id: string;
          currentTurnIndex: number;
          turnOrder: string[];
          players: Record<string, {handCardIds: string[]}>;
        };
        sessions: PlayerSession[];
      };
      const createBroadcast = await createList as {games: Array<Record<string, unknown>>};

      expect(createResponse.ok).toBe(true);
      expect(createBroadcast.games).toEqual([{
        id: createResponse.game.id,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 1,
        currentPlayerId: createResponse.game.turnOrder[createResponse.game.currentTurnIndex],
      }]);
      expectNoSessionTokens(createBroadcast, createResponse.sessions);

      const cardId = createResponse.game.players.p1.handCardIds[0];
      const p1Session = createResponse.sessions.find((session) => session.playerId === 'p1');
      const commandList = waitForGameList(socket, (payload) =>
        payload.games?.some((game) =>
          typeof game === 'object' &&
          game !== null &&
          (game as {id?: unknown}).id === createResponse.game.id &&
          (game as {currentPlayerId?: unknown}).currentPlayerId === 'p2',
        ) === true,
      );
      const commandResponse = await emitWithAck(socket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      const commandBroadcast = await commandList as {games: Array<Record<string, unknown>>};

      expect(commandResponse.ok).toBe(true);
      expect(commandBroadcast.games).toEqual([expect.objectContaining({
        id: createResponse.game.id,
        currentPlayerId: 'p2',
      })]);
      expectNoSessionTokens(commandBroadcast, createResponse.sessions);
      expect(JSON.stringify(commandBroadcast)).not.toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('ends introductory Canal-only games through Socket.IO final-pass broadcasts', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
        introductoryCanalOnly: true,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      const storedGame = testServer.store.get(createResponse.game.id);
      if (!storedGame) {
        throw new Error('Expected created game');
      }
      storedGame.players.p1.cash = 80;
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!session) {
        throw new Error('Expected p1 session');
      }

      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const endedPredicate = (state: {status?: string}) =>
        state.status === 'ended' &&
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'game_ended',
        ));
      const hostBroadcast = waitForGameState(hostSocket, endedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, endedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.status).toBe('ended');
      expect(commandResponse.game.era).toBe('canal');
      expect(commandResponse.game.variant).toBe('introductory_canal_only');
      expect(commandResponse.game.players.p1.victoryPoints).toBe(15);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 15, reason: 'introductory money scoring'},
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
        {type: 'game_ended', winners: ['p1']},
      ]));

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.players.p1.handCardIds).toEqual([]);
      expect(observerView.players.p1.handCardIds).toEqual([]);
      expect(testServer.store.get(createResponse.game.id)?.status).toBe('ended');
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for Socket.IO negative income liquidation before ending a final-card Canal era Pass', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.players.p1.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
      const cotton = addIndustry(storedGame, {
        id: 'socket-final-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'negative_income' &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const pendingHostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const pendingObserverBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const passResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      const pendingDecision = {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 3,
        incomePlayerIndex: 0,
      } as const;

      expect(passResponse.ok).toBe(true);
      expectNoSessionTokens(passResponse, createResponse.sessions);
      expect(passResponse.game.pendingDecision).toEqual(pendingDecision);
      expect(passResponse.game.era).toBe('canal');
      expect(passResponse.game.players.p1.cash).toBe(0);
      expect(passResponse.game.eventLog).toContainEqual({
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 3,
        incomePlayerIndex: 0,
      });
      expect(passResponse.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const [pendingHostView, pendingObserverView] = await Promise.all([pendingHostBroadcast, pendingObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([pendingHostView, pendingObserverView], createResponse.sessions);
      expect(pendingHostView.pendingDecision).toEqual(pendingDecision);
      expect(pendingObserverView.pendingDecision).toEqual(pendingDecision);
      expect(pendingHostView.players.p1.handCardIds).toEqual([]);
      expect(pendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(pendingObserverView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal'));
      const railHostBroadcast = waitForGameState(hostSocket, railPredicate);
      const railObserverBroadcast = waitForGameState(observerSocket, railPredicate);
      const resolveResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(resolveResponse.ok).toBe(true);
      expectNoSessionTokens(resolveResponse, createResponse.sessions);
      expect(resolveResponse.game.pendingDecision).toBeUndefined();
      expect(resolveResponse.game.era).toBe('rail');
      expect(resolveResponse.game.roundNumber).toBe(1);
      expect(resolveResponse.game.players.p1.cash).toBe(3);
      expect(resolveResponse.game.board.industryInstances).not.toHaveProperty(cotton.id);
      expect(resolveResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'cash_changed', playerId: 'p1', delta: 6, reason: 'negative income liquidation'},
        {type: 'cash_changed', playerId: 'p1', delta: -3, reason: 'income'},
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
      ]));

      const [railHostView, railObserverView] = await Promise.all([railHostBroadcast, railObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([railHostView, railObserverView], createResponse.sessions);
      expect(railHostView.pendingDecision).toBeUndefined();
      expect(railObserverView.pendingDecision).toBeUndefined();
      expect(railHostView.era).toBe('rail');
      expect(railObserverView.era).toBe('rail');
      expect(railHostView.players.p1.cash).toBe(3);
      expect(railHostView.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(railObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(railObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(testServer.store.get(createResponse.game.id)?.era).toBe('rail');
      expect(testServer.store.get(createResponse.game.id)?.players.p1.cash).toBe(3);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.eventLog).toContainEqual({
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 3,
        paid: 3,
        victoryPointLoss: 0,
        industryInstanceIds: [cotton.id],
      });
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('chains Socket.IO final-card Canal negative income decisions before ending the era', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p2');
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      storedGame.players.p1.cash = 0;
      storedGame.players.p2.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
      storedGame.players.p2.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
      const p1Cotton = addIndustry(storedGame, {
        id: 'socket-chain-negative-income-p1-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      const p2Cotton = addIndustry(storedGame, {
        id: 'socket-chain-negative-income-p2-cotton',
        ownerPlayerId: 'p2',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'worcester',
        slotId: 'worcester-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(p1Cotton.id);
      storedGame.players.p2.industryTileStacks.cotton_mill.builtInstanceIds.push(p2Cotton.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const p1PendingDecision = {
        type: 'negative_income',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      } as const;
      const p1PendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p1' &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const p1PendingHostBroadcast = waitForGameState(hostSocket, p1PendingPredicate);
      const p1PendingObserverBroadcast = waitForGameState(observerSocket, p1PendingPredicate);
      const passResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: p1Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(passResponse.ok).toBe(true);
      expectNoSessionTokens(passResponse, createResponse.sessions);
      expect(passResponse.game.pendingDecision).toEqual(p1PendingDecision);
      expect(passResponse.game.era).toBe('canal');
      expect(passResponse.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const [p1PendingHostView, p1PendingObserverView] = await Promise.all([
        p1PendingHostBroadcast,
        p1PendingObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([p1PendingHostView, p1PendingObserverView], createResponse.sessions);
      expect(p1PendingHostView.pendingDecision).toEqual(p1PendingDecision);
      expect(p1PendingObserverView.pendingDecision).toEqual(p1PendingDecision);
      expect(p1PendingHostView.players.p1.handCardIds).toEqual([]);
      expect(p1PendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p1PendingObserverView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const p2PendingDecision = {
        type: 'negative_income',
        playerId: 'p2',
        amountOwed: 3,
        incomePlayerIndex: 1,
      } as const;
      const p2PendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'negative_income' &&
        state.pendingDecision.playerId === 'p2' &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const p2PendingHostBroadcast = waitForGameState(hostSocket, p2PendingPredicate);
      const p2PendingObserverBroadcast = waitForGameState(observerSocket, p2PendingPredicate);
      const p1ResolveResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [p1Cotton.id]},
        sessionToken: p1Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(p1ResolveResponse.ok).toBe(true);
      expectNoSessionTokens(p1ResolveResponse, createResponse.sessions);
      expect(p1ResolveResponse.game.pendingDecision).toEqual(p2PendingDecision);
      expect(p1ResolveResponse.game.era).toBe('canal');
      expect(p1ResolveResponse.game.currentTurnIndex).toBe(1);
      expect(p1ResolveResponse.game.players.p1.cash).toBe(1);
      expect(p1ResolveResponse.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const [p2PendingHostView, p2PendingObserverView] = await Promise.all([
        p2PendingHostBroadcast,
        p2PendingObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([p2PendingHostView, p2PendingObserverView], createResponse.sessions);
      expect(p2PendingHostView.pendingDecision).toEqual(p2PendingDecision);
      expect(p2PendingObserverView.pendingDecision).toEqual(p2PendingDecision);
      expect(p2PendingHostView.players.p1.cash).toBe(1);
      expect(p2PendingHostView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p2PendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p2PendingObserverView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p2PendingObserverView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal'));
      const railHostBroadcast = waitForGameState(hostSocket, railPredicate);
      const railObserverBroadcast = waitForGameState(observerSocket, railPredicate);
      const p2ResolveResponse = await emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'resolve_negative_income', playerId: 'p2', industryInstanceIds: [p2Cotton.id]},
        sessionToken: p2Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(p2ResolveResponse.ok).toBe(true);
      expectNoSessionTokens(p2ResolveResponse, createResponse.sessions);
      expect(p2ResolveResponse.game.pendingDecision).toBeUndefined();
      expect(p2ResolveResponse.game.era).toBe('rail');
      expect(p2ResolveResponse.game.roundNumber).toBe(1);
      expect(p2ResolveResponse.game.players.p2.cash).toBe(3);
      expect(p2ResolveResponse.game.board.industryInstances).not.toHaveProperty(p1Cotton.id);
      expect(p2ResolveResponse.game.board.industryInstances).not.toHaveProperty(p2Cotton.id);
      expect(p2ResolveResponse.game.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));

      const [railHostView, railObserverView] = await Promise.all([railHostBroadcast, railObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([railHostView, railObserverView], createResponse.sessions);
      expect(railHostView.pendingDecision).toBeUndefined();
      expect(railObserverView.pendingDecision).toBeUndefined();
      expect(railHostView.era).toBe('rail');
      expect(railObserverView.era).toBe('rail');
      expect(railHostView.players.p1.cash).toBe(1);
      expect(railObserverView.players.p2.cash).toBe(3);
      expect(railHostView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(railObserverView.players.p2.handCardIds).toEqual(testServer.store.get(createResponse.game.id)?.players.p2.handCardIds);
      expect(railObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBe('p2');
      expect(testServer.store.get(createResponse.game.id)?.era).toBe('rail');
      expect(testServer.store.get(createResponse.game.id)?.players.p1.cash).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.players.p2.cash).toBe(3);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[p1Cotton.id].removedFromGame).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[p2Cotton.id].removedFromGame).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.eventLog.filter((event) => event.type === 'negative_income_resolved')).toEqual([
        {
          type: 'negative_income_resolved',
          playerId: 'p1',
          amountOwed: 5,
          paid: 5,
          victoryPointLoss: 0,
          industryInstanceIds: [p1Cotton.id],
        },
        {
          type: 'negative_income_resolved',
          playerId: 'p2',
          amountOwed: 3,
          paid: 3,
          victoryPointLoss: 0,
          industryInstanceIds: [p2Cotton.id],
        },
      ]);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('ends standard Rail games through Socket.IO final-pass broadcasts', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.era = 'rail';
      storedGame.roundNumber = 10;
      const scoredIndustry = addIndustry(storedGame, {
        id: 'socket-final-rail-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: true,
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(scoredIndustry.id);
      addLink(storedGame, 'socket-final-rail-link', 'p1', 'birmingham-oxford', 'rail');
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const endedPredicate = (state: GameStateProjection) =>
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended'));
      const hostBroadcast = waitForGameState(hostSocket, endedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, endedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.status).toBe('ended');
      expect(commandResponse.game.era).toBe('rail');
      expect(commandResponse.game.players.p1.victoryPoints).toBe(9);
      expect(commandResponse.game.board.linkLines['birmingham-oxford'].occupiedBy).toBeUndefined();
      expect(commandResponse.game.board.industryInstances).not.toHaveProperty(scoredIndustry.id);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'link scoring'},
        {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'},
        expect.objectContaining({
          type: 'era_ended',
          era: 'rail',
          score: expect.objectContaining({
            linkVictoryPointsByPlayer: {p1: 4, p2: 0},
            industryVictoryPointsByPlayer: {p1: 5, p2: 0},
            totalVictoryPointsByPlayer: {p1: 9, p2: 0},
          }),
        }),
        {type: 'game_ended', winners: ['p1']},
      ]));

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.era).toBe('rail');
      expect(observerView.era).toBe('rail');
      expect(hostView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(observerView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(testServer.store.get(createResponse.game.id)?.status).toBe('ended');
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[scoredIndustry.id].removedFromGame).toBe(false);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('ends a final Socket.IO Rail pass without applying negative income', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.era = 'rail';
      storedGame.players.p1.cash = 0;
      storedGame.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
      const scoredIndustry = addIndustry(storedGame, {
        id: 'socket-final-rail-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        flipped: true,
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(scoredIndustry.id);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const endedPredicate = (state: GameStateProjection) =>
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended'));
      const hostBroadcast = waitForGameState(hostSocket, endedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, endedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.status).toBe('ended');
      expect(commandResponse.game.era).toBe('rail');
      expect(commandResponse.game.pendingDecision).toBeUndefined();
      expect(commandResponse.game.players.p1.cash).toBe(0);
      expect(commandResponse.game.players.p1.victoryPoints).toBe(5);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'industry scoring'},
        expect.objectContaining({type: 'era_ended', era: 'rail'}),
        {type: 'game_ended', winners: ['p1']},
      ]));
      expect(commandResponse.game.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(commandResponse.game.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'income',
      )).toBe(false);
      expect(commandResponse.game.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'negative income liquidation',
      )).toBe(false);

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as [GameState, GameState];
      const finalGame = testServer.store.get(createResponse.game.id);
      if (!finalGame) {
        throw new Error('Expected final game');
      }

      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.pendingDecision).toBeUndefined();
      expect(observerView.pendingDecision).toBeUndefined();
      expect(hostView.players.p1.cash).toBe(0);
      expect(observerView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(hostView.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(observerView.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(finalGame.status).toBe('ended');
      expect(finalGame.pendingDecision).toBeUndefined();
      expect(finalGame.players.p1.cash).toBe(0);
      expect(finalGame.board.industryInstances[scoredIndustry.id].removedFromGame).toBe(false);
      expect(finalGame.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(finalGame.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'income',
      )).toBe(false);
      expect(finalGame.eventLog.some((event) =>
        event.type === 'cash_changed' && event.reason === 'negative income liquidation',
      )).toBe(false);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('creates a game and applies a socket command with a player session', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>; cardZones: {drawDeck: string[]}};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      expect(createResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(createResponse.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(createResponse.game.cardZones.drawDeck).toHaveLength(testServer.store.get(createResponse.game.id)?.cardZones.drawDeck.length ?? 0);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = createResponse.game.players.p1.handCardIds[0];
      const commandResponse = await emitWithAck(socket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: ` ${session?.token ?? ''}\n`,
      }) as {ok: boolean; game: {currentTurnIndex: number; cardZones: {drawDeck: string[]}}};

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.cardZones.drawDeck).toHaveLength(testServer.store.get(createResponse.game.id)?.cardZones.drawDeck.length ?? 0);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('skips empty-hand players through Socket.IO while another player finishes the era', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p2');
      if (!storedGame || !p1Session || !p2Session) {
        throw new Error('Expected created game and player sessions');
      }
      const cards = prepareEmptyHandSkipEraEnd(storedGame);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const p2TurnPredicate = (state: GameStateProjection) =>
        state.roundNumber === 9 &&
        state.currentTurnIndex === 1 &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const p2TurnHostBroadcast = waitForGameState(hostSocket, p2TurnPredicate);
      const p2TurnObserverBroadcast = waitForGameState(observerSocket, p2TurnPredicate);
      const p1Response = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId: cards.p1CardId},
        sessionToken: p1Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      expect(p1Response.ok).toBe(true);
      expectNoSessionTokens(p1Response, createResponse.sessions);
      expect(p1Response.game.currentTurnIndex).toBe(1);
      expect(p1Response.game.players.p1.handCardIds).toEqual([]);

      const [p2TurnHostView, p2TurnObserverView] = await Promise.all([
        p2TurnHostBroadcast,
        p2TurnObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([p2TurnHostView, p2TurnObserverView], createResponse.sessions);
      expect(p2TurnHostView.currentTurnIndex).toBe(1);
      expect(p2TurnHostView.players.p1.handCardIds).toEqual([]);
      expect(p2TurnHostView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p2TurnObserverView.currentTurnIndex).toBe(1);
      expect(p2TurnObserverView.players.p1.handCardIds).toEqual([]);
      expect(p2TurnObserverView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);

      const p2FirstResponse = await emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p2', cardId: cards.p2FirstCardId},
        sessionToken: p2Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      expect(p2FirstResponse.ok).toBe(true);
      expectNoSessionTokens(p2FirstResponse, createResponse.sessions);
      expect(p2FirstResponse.game.roundNumber).toBe(9);
      expect(p2FirstResponse.game.currentTurnIndex).toBe(1);
      expect(p2FirstResponse.game.players.p2.handCardIds).toEqual([cards.p2SecondCardId, cards.p2FinalCardId]);

      const skippedPredicate = (state: GameStateProjection) =>
        state.roundNumber === 10 &&
        state.currentTurnIndex === 1 &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const skippedHostBroadcast = waitForGameState(hostSocket, skippedPredicate);
      const skippedObserverBroadcast = waitForGameState(observerSocket, skippedPredicate);
      const p2SecondResponse = await emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p2', cardId: cards.p2SecondCardId},
        sessionToken: p2Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      expect(p2SecondResponse.ok).toBe(true);
      expectNoSessionTokens(p2SecondResponse, createResponse.sessions);
      expect(p2SecondResponse.game.roundNumber).toBe(10);
      expect(p2SecondResponse.game.currentTurnIndex).toBe(1);
      expect(p2SecondResponse.game.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(p2SecondResponse.game.players.p2.handCardIds).toEqual([cards.p2FinalCardId]);
      expect(p2SecondResponse.game.eventLog).toContainEqual({type: 'turn_advanced', currentPlayerId: 'p2', roundNumber: 10});
      expect(p2SecondResponse.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const [skippedHostView, skippedObserverView] = await Promise.all([
        skippedHostBroadcast,
        skippedObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([skippedHostView, skippedObserverView], createResponse.sessions);
      expect(skippedHostView.roundNumber).toBe(10);
      expect(skippedHostView.currentTurnIndex).toBe(1);
      expect(skippedHostView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(skippedObserverView.roundNumber).toBe(10);
      expect(skippedObserverView.currentTurnIndex).toBe(1);
      expect(skippedObserverView.players.p2.handCardIds).toEqual([cards.p2FinalCardId]);
      expect(testServer.io.sockets.sockets.get(observerSocket.id as string)?.data.playerId).toBe('p2');

      const railPredicate = (state: GameStateProjection) =>
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal'));
      const railHostBroadcast = waitForGameState(hostSocket, railPredicate);
      const railObserverBroadcast = waitForGameState(observerSocket, railPredicate);
      const finalResponse = await emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p2', cardId: cards.p2FinalCardId},
        sessionToken: p2Session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      expect(finalResponse.ok).toBe(true);
      expectNoSessionTokens(finalResponse, createResponse.sessions);
      expect(finalResponse.game.era).toBe('rail');
      expect(finalResponse.game.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));

      const [railHostView, railObserverView] = await Promise.all([railHostBroadcast, railObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([railHostView, railObserverView], createResponse.sessions);
      expect(railHostView.era).toBe('rail');
      expect(railObserverView.era).toBe('rail');
      expect(railObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(testServer.store.get(createResponse.game.id)?.era).toBe('rail');
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO Loan commands with player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = createResponse.game.players.p1.handCardIds[0];
      if (!session || !cardId) {
        throw new Error('Expected created p1 session and card');
      }

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const loanPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'loan_taken' && event.playerId === 'p1',
        ));
      const hostBroadcast = waitForGameState(hostSocket, loanPredicate);
      const observerBroadcast = waitForGameState(observerSocket, loanPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'loan', playerId: 'p1', cardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          currentTurnIndex: number;
          eventLog: GameState['eventLog'];
          players: Record<string, {
            cash: number;
            discardCardIds: string[];
            handCardIds: string[];
            incomeTrackPosition: number;
            spentThisRound: number;
          }>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.players.p1.cash).toBe(47);
      expect(getIncomeLevel(commandResponse.game.players.p1.incomeTrackPosition)).toBe(-3);
      expect(commandResponse.game.players.p1.spentThisRound).toBe(0);
      expect(commandResponse.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandResponse.game.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
        {type: 'loan_taken', playerId: 'p1'},
      ]));

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        currentTurnIndex: number;
        eventLog: GameState['eventLog'];
        players: Record<string, {
          cash: number;
          handCardIds: string[];
          incomeTrackPosition: number;
          spentThisRound: number;
        }>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.currentTurnIndex).toBe(1);
      expect(hostView.players.p1.handCardIds.some((hiddenCardId) => !hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p1.cash).toBe(47);
      expect(getIncomeLevel(hostView.players.p1.incomeTrackPosition)).toBe(-3);
      expect(hostView.players.p1.spentThisRound).toBe(0);
      expect(observerView.currentTurnIndex).toBe(1);
      expect(observerView.players.p1.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((hiddenCardId) => hiddenCardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.cash).toBe(47);
      expect(getIncomeLevel(observerView.players.p1.incomeTrackPosition)).toBe(-3);
      expect(observerView.players.p1.spentThisRound).toBe(0);
      expect(observerView.eventLog).toContainEqual({type: 'loan_taken', playerId: 'p1'});
      expect(testServer.store.get(createResponse.game.id)?.players.p1.cash).toBe(47);
      expect(getIncomeLevel(testServer.store.get(createResponse.game.id)?.players.p1.incomeTrackPosition ?? staticConfig.incomeTrack.startPosition))
        .toBe(-3);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.spentThisRound).toBe(0);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO negative income resolution commands with player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(createResponse.game.id);
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.players.p1.cash = 1;
      storedGame.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0};
      const cotton = addIndustry(storedGame, {
        id: 'socket-negative-income-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const resolvedPredicate = (state: GameStateProjection) =>
        state.roundNumber === 2 &&
        state.pendingDecision === undefined &&
        Boolean(state.eventLog?.some((event) =>
          event.type === 'cash_changed' && event.reason === 'negative income liquidation',
        ));
      const hostBroadcast = waitForGameState(hostSocket, resolvedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, resolvedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'resolve_negative_income',
          playerId: 'p1',
          industryInstanceIds: [cotton.id],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          pendingDecision?: unknown;
          roundNumber: number;
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {
            cash: number;
            handCardIds: string[];
            industryTileStacks: GameState['players'][string]['industryTileStacks'];
          }>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.pendingDecision).toBeUndefined();
      expect(commandResponse.game.roundNumber).toBe(2);
      expect(commandResponse.game.players.p1.cash).toBe(2);
      expect(commandResponse.game.board.industryInstances).not.toHaveProperty(cotton.id);
      expect(commandResponse.game.board.slots['birmingham-0'].occupiedBy).toBeUndefined();
      expect(commandResponse.game.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(cotton.id);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 6,
        reason: 'negative income liquidation',
      });

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        pendingDecision?: unknown;
        roundNumber: number;
        board: GameState['board'];
        eventLog: GameState['eventLog'];
        players: Record<string, {
          cash: number;
          handCardIds: string[];
          industryTileStacks: GameState['players'][string]['industryTileStacks'];
        }>;
      }>;
      const resolvedGame = testServer.store.get(createResponse.game.id);

      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.pendingDecision).toBeUndefined();
      expect(hostView.roundNumber).toBe(2);
      expect(hostView.players.p1.handCardIds).toEqual(resolvedGame?.players.p1.handCardIds);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.board.industryInstances).not.toHaveProperty(cotton.id);
      expect(observerView.pendingDecision).toBeUndefined();
      expect(observerView.roundNumber).toBe(2);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.board.industryInstances).not.toHaveProperty(cotton.id);
      expect(observerView.eventLog).toContainEqual({
        type: 'cash_changed',
        playerId: 'p1',
        delta: -5,
        reason: 'income',
      });
      expect(resolvedGame?.pendingDecision).toBeUndefined();
      expect(resolvedGame?.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(resolvedGame?.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(cotton.id);
      expect(resolvedGame?.eventLog).toContainEqual({
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [cotton.id],
      });
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO merchant develop resolution commands with player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const storedGame = testServer.store.get(createResponse.game.id);
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }
      storedGame.pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 2,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      };

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const resolvedPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: GameState['eventLog']}).eventLog?.some((event) =>
          event.type === 'merchant_develop_resolved',
        ));
      const hostBroadcast = waitForGameState(hostSocket, resolvedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, resolvedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'resolve_merchant_develop',
          playerId: 'p1',
          industryTypes: ['coal_mine', 'iron_works'],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          currentTurnIndex: number;
          pendingDecision?: unknown;
          players: Record<string, {
            handCardIds: string[];
            industryTileStacks: GameState['players'][string]['industryTileStacks'];
          }>;
          eventLog: GameState['eventLog'];
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.pendingDecision).toBeUndefined();
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(commandResponse.game.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['coal_mine', 'iron_works'],
        specIds: ['coal_mine-1-1', 'iron_works-1-1'],
      });

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        currentTurnIndex: number;
        pendingDecision?: unknown;
        players: Record<string, {
          handCardIds: string[];
          industryTileStacks: GameState['players'][string]['industryTileStacks'];
        }>;
        eventLog: GameState['eventLog'];
      }>;
      const resolvedGame = testServer.store.get(createResponse.game.id);

      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.pendingDecision).toBeUndefined();
      expect(hostView.currentTurnIndex).toBe(1);
      expect(hostView.players.p1.handCardIds).toEqual(resolvedGame?.players.p1.handCardIds);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(observerView.pendingDecision).toBeUndefined();
      expect(observerView.currentTurnIndex).toBe(1);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(observerView.eventLog).toContainEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['coal_mine', 'iron_works'],
        specIds: ['coal_mine-1-1', 'iron_works-1-1'],
      });
      expect(resolvedGame?.pendingDecision).toBeUndefined();
      expect(resolvedGame?.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(resolvedGame?.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO Scout commands with private wild cards and public pool updates', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {
          id: string;
          players: Record<string, {handCardIds: string[]}>;
          cardZones: {wildLocationPool: string[]; wildIndustryPool: string[]};
        };
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardIds = createResponse.game.players.p1.handCardIds.slice(0, 3);
      expect(cardIds).toHaveLength(3);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const scoutedPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'scouted',
        ));
      const hostBroadcast = waitForGameState(hostSocket, scoutedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, scoutedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'scout', playerId: 'p1', cardIds},
        sessionToken: p1Session?.token,
      }) as {
        ok: boolean;
        game: {
          currentTurnIndex: number;
          players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
          cardZones: {wildLocationPool: string[]; wildIndustryPool: string[]};
          eventLog: GameState['eventLog'];
        };
      };
      const storedGame = testServer.store.get(createResponse.game.id);

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(commandResponse.game.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-location-'))).toBe(true);
      expect(commandResponse.game.players.p1.handCardIds.some((cardId) => cardId.startsWith('wild-industry-'))).toBe(true);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.players.p1.discardCardIds).toEqual(['hidden-card-1', ...cardIds]);
      expect(commandResponse.game.cardZones.wildLocationPool).toHaveLength(createResponse.game.cardZones.wildLocationPool.length - 1);
      expect(commandResponse.game.cardZones.wildIndustryPool).toHaveLength(createResponse.game.cardZones.wildIndustryPool.length - 1);
      expect(commandResponse.game.eventLog).toContainEqual({type: 'scouted', playerId: 'p1'});
      expect(storedGame?.players.p1.discardCardIds.filter((cardId) => cardId.startsWith('wild-'))).toEqual([]);

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        players: Record<string, {handCardIds: string[]; discardCardIds: string[]}>;
        cardZones: {wildLocationPool: string[]; wildIndustryPool: string[]};
        eventLog: GameState['eventLog'];
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.discardCardIds).toEqual(['hidden-card-1', ...cardIds]);
      expect(observerView.cardZones.wildLocationPool).toHaveLength(createResponse.game.cardZones.wildLocationPool.length - 1);
      expect(observerView.cardZones.wildIndustryPool).toHaveLength(createResponse.game.cardZones.wildIndustryPool.length - 1);
      expect(observerView.eventLog).toContainEqual({type: 'scouted', playerId: 'p1'});
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('trims Socket.IO command game IDs before applying and joining rooms', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);
      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = createResponse.game.players.p1.handCardIds[0];
      const paddedGameId = ` ${createResponse.game.id}\n`;
      const commandResponse = await emitWithAck(socket, 'game:command', {
        gameId: paddedGameId,
        command: {type: 'pass', playerId: ' p1 ', cardId},
        sessionToken: session?.token,
      }) as {ok: boolean; game: {id: string; currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>}};

      expect(commandResponse.ok).toBe(true);
      expect(commandResponse.game.id).toBe(createResponse.game.id);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.players.p1.handCardIds.every((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(createResponse.game.id)?.has(socket.id as string)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(paddedGameId)).toBeUndefined();
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO Build resource selections and broadcasts player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {ok: boolean; game: {id: string}; sessions: PlayerSession[]};
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.players.p1.handCardIds = ['wild-location-1'];
      storedGame.cardZones.wildLocationPool = storedGame.cardZones.wildLocationPool
        .filter((cardId) => cardId !== 'wild-location-1');
      const firstIron = addIndustry(storedGame, {
        id: 'industry-221',
        ownerPlayerId: 'p2',
        industryType: 'iron_works',
        specId: 'iron_works-2-1',
        locationId: 'coalbrookdale',
        slotId: 'coalbrookdale-1',
        remainingResource: 1,
      });
      const selectedIron = addIndustry(storedGame, {
        id: 'industry-222',
        ownerPlayerId: 'p2',
        industryType: 'iron_works',
        specId: 'iron_works-2-1',
        locationId: 'dudley',
        slotId: 'dudley-1',
        remainingResource: 1,
      });
      const ironSource = {kind: 'industry_tile' as const, industryInstanceId: selectedIron.id, resourceType: 'iron' as const};

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const builtPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'industry_built',
        ));
      const hostBroadcast = waitForGameState(hostSocket, builtPredicate);
      const observerBroadcast = waitForGameState(observerSocket, builtPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'build',
          playerId: 'p1',
          cardId: 'wild-location-1',
          locationId: 'stone',
          slotId: 'stone-0',
          industryType: 'brewery',
          ironSources: [ironSource],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          board: GameState['board'];
          cardZones: {wildLocationPool: string[]};
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; discardCardIds: string[]; handCardIds: string[]}>;
        };
      };
      const finalGame = testServer.store.get(createResponse.game.id);
      const builtIndustry = Object.values(commandResponse.game.board.industryInstances)
        .find((industry) =>
          industry.ownerPlayerId === 'p1' &&
          industry.industryType === 'brewery' &&
          industry.locationId === 'stone' &&
          industry.slotId === 'stone-0',
        );

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(builtIndustry).toMatchObject({
        specId: 'brewery-1-1',
        remainingResource: 1,
        flipped: false,
      });
      expect(commandResponse.game.players.p1.cash).toBe(12);
      expect(commandResponse.game.players.p1.discardCardIds).not.toContain('wild-location-1');
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: ironSource,
        byPlayerId: 'p1',
        reason: 'build',
      });
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'card_discarded',
        playerId: 'p1',
        cardId: 'wild-location-1',
        destination: 'wild_pool',
      });

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        board: GameState['board'];
        cardZones: {wildLocationPool: string[]};
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(observerView.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: ironSource,
        byPlayerId: 'p1',
        reason: 'build',
      });
      expect(finalGame?.board.industryInstances[firstIron.id].remainingResource).toBe(1);
      expect(finalGame?.board.industryInstances[firstIron.id].flipped).toBe(false);
      expect(finalGame?.board.industryInstances[selectedIron.id].remainingResource).toBe(0);
      expect(finalGame?.board.industryInstances[selectedIron.id].flipped).toBe(true);
      expect(finalGame?.cardZones.wildLocationPool).toContain('wild-location-1');
      expect(finalGame?.players.p1.discardCardIds).not.toContain('wild-location-1');
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO Develop iron selections with player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {ok: boolean; game: {id: string}; sessions: PlayerSession[]};
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.players.p1.handCardIds = ['p2-location-birmingham-1'];
      storedGame.markets.iron.occupiedCount = 7;
      const ironSources = [
        {kind: 'market' as const, market: 'iron' as const, price: 2},
        {kind: 'market' as const, market: 'iron' as const, price: 3},
      ];

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const developedPredicate = (state: {currentTurnIndex?: number}) =>
        ((state as {eventLog?: GameState['eventLog']}).eventLog ?? [])
          .filter((event) => event.type === 'resource_consumed' && event.reason === 'develop')
          .length >= 2;
      const hostBroadcast = waitForGameState(hostSocket, developedPredicate);
      const observerBroadcast = waitForGameState(observerSocket, developedPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'develop',
          playerId: 'p1',
          cardId: 'p2-location-birmingham-1',
          industryTypes: ['coal_mine', 'iron_works'],
          ironSources,
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          eventLog: GameState['eventLog'];
          markets: GameState['markets'];
          players: Record<string, {
            cash: number;
            discardCardIds: string[];
            handCardIds: string[];
            industryTileStacks: GameState['players'][string]['industryTileStacks'];
          }>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.markets.iron.occupiedCount).toBe(5);
      expect(commandResponse.game.players.p1.cash).toBe(12);
      expect(commandResponse.game.players.p1.discardCardIds).toContain('p2-location-birmingham-1');
      expect(commandResponse.game.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(commandResponse.game.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'resource_consumed', source: ironSources[0], byPlayerId: 'p1', reason: 'develop'},
        {type: 'resource_consumed', source: ironSources[1], byPlayerId: 'p1', reason: 'develop'},
      ]));

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        eventLog: GameState['eventLog'];
        markets: GameState['markets'];
        players: Record<string, {
          handCardIds: string[];
          industryTileStacks: GameState['players'][string]['industryTileStacks'];
        }>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.markets.iron.occupiedCount).toBe(5);
      expect(hostView.players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(observerView.markets.iron.occupiedCount).toBe(5);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(observerView.eventLog).toEqual(expect.arrayContaining([
        {type: 'resource_consumed', source: ironSources[0], byPlayerId: 'p1', reason: 'develop'},
        {type: 'resource_consumed', source: ironSources[1], byPlayerId: 'p1', reason: 'develop'},
      ]));
      expect(testServer.store.get(createResponse.game.id)?.markets.iron.occupiedCount).toBe(5);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.cash).toBe(12);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.industryTileStacks.coal_mine.removedSpecIds)
        .toEqual(['coal_mine-1-1']);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.industryTileStacks.iron_works.removedSpecIds)
        .toEqual(['iron_works-1-1']);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('normalizes nested Socket.IO sell command strings before broadcasting player views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cardId = storedGame.players.p1.handCardIds[0];
      const cotton = addIndustry(storedGame, {
        id: 'industry-43',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-43', 'p1', 'birmingham-oxford');
      storedGame.board.merchantSpaces['oxford-0'] = {
        id: 'oxford-0',
        merchantTileInstanceId: 'oxford-cotton-0',
        beerPresent: true,
      };

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const hostBroadcast = waitForGameState(hostSocket, (state) => state.currentTurnIndex === 1);
      const observerBroadcast = waitForGameState(observerSocket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: ` ${createResponse.game.id} `,
        command: {
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
        },
        sessionToken: ` ${session.token}\n`,
      }) as {
        ok: boolean;
        game: {
          currentTurnIndex: number;
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {discardCardIds: string[]; handCardIds: string[]}>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.board.industryInstances[cotton.id].flipped).toBe(true);
      expect(commandResponse.game.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
      expect(commandResponse.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      });

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        currentTurnIndex: number;
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.eventLog).toContainEqual({
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      });
      expect(testServer.io.sockets.adapter.rooms.get(createResponse.game.id)?.has(hostSocket.id as string)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(` ${createResponse.game.id} `)).toBeUndefined();
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[cotton.id].flipped).toBe(true);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO Sell merchant develop bonuses with player-specific pending decision views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cardId = storedGame.players.p1.handCardIds[0];
      const cotton = addIndustry(storedGame, {
        id: 'industry-45',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-46', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'link-47', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        Boolean(state.eventLog?.some((event) => event.type === 'merchant_bonus_claimed'));
      const hostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const observerBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'sell',
          playerId: 'p1',
          cardId,
          sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.pendingDecision).toEqual(pendingDecision);
      expect(commandResponse.game.currentTurnIndex).toBe(0);
      expect(commandResponse.game.board.industryInstances[cotton.id].flipped).toBe(true);
      expect(commandResponse.game.board.merchantSpaces['gloucester-0'].beerPresent).toBe(false);
      expect(commandResponse.game.players.p1.discardCardIds).toContain(cardId);
      expect(commandResponse.game.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          bonus: {type: 'develop', count: 1},
        },
      ]));

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.pendingDecision).toEqual(pendingDecision);
      expect(observerView.pendingDecision).toEqual(pendingDecision);
      expect(hostView.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.eventLog).toContainEqual({
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        bonus: {type: 'develop', count: 1},
      });
      expect(testServer.store.get(createResponse.game.id)?.pendingDecision).toEqual(pendingDecision);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual([]);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for Socket.IO merchant develop resolution before ending a final-card Canal era Sell', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      const cotton = addIndustry(storedGame, {
        id: 'industry-47',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'link-50', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'link-51', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        !state.eventLog?.some((event) => event.type === 'era_ended');
      const pendingHostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const pendingObserverBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const sellResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'sell',
          playerId: 'p1',
          cardId,
          sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expect(sellResponse.ok).toBe(true);
      expectNoSessionTokens(sellResponse, createResponse.sessions);
      expect(sellResponse.game.pendingDecision).toEqual(pendingDecision);
      expect(sellResponse.game.era).toBe('canal');
      expect(sellResponse.game.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const [pendingHostView, pendingObserverView] = await Promise.all([pendingHostBroadcast, pendingObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([pendingHostView, pendingObserverView], createResponse.sessions);
      expect(pendingHostView.pendingDecision).toEqual(pendingDecision);
      expect(pendingObserverView.pendingDecision).toEqual(pendingDecision);
      expect(pendingHostView.players.p1.handCardIds).toEqual([]);
      expect(pendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(pendingObserverView.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

      const railPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'era_ended' && event.era === 'canal'));
      const railHostBroadcast = waitForGameState(hostSocket, railPredicate);
      const railObserverBroadcast = waitForGameState(observerSocket, railPredicate);
      const resolveResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'resolve_merchant_develop',
          playerId: 'p1',
          industryTypes: ['manufacturer'],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(resolveResponse.ok).toBe(true);
      expectNoSessionTokens(resolveResponse, createResponse.sessions);
      expect(resolveResponse.game.pendingDecision).toBeUndefined();
      expect(resolveResponse.game.era).toBe('rail');
      expect(resolveResponse.game.roundNumber).toBe(1);
      expect(resolveResponse.game.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(resolveResponse.game.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(resolveResponse.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'merchant_develop_resolved',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          merchantSpaceIds: ['gloucester-0'],
          industryTypes: ['manufacturer'],
          specIds: ['manufacturer-1-1'],
        },
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
      ]));

      const [railHostView, railObserverView] = await Promise.all([railHostBroadcast, railObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([railHostView, railObserverView], createResponse.sessions);
      expect(railHostView.pendingDecision).toBeUndefined();
      expect(railObserverView.pendingDecision).toBeUndefined();
      expect(railHostView.era).toBe('rail');
      expect(railObserverView.era).toBe('rail');
      expect(railHostView.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(railObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(railObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'era_ended', era: 'canal'}));
      expect(testServer.store.get(createResponse.game.id)?.era).toBe('rail');
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[cotton.id].removedFromGame).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.industryTileStacks.manufacturer.removedSpecIds)
        .toEqual(['manufacturer-1-1']);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('waits for Socket.IO merchant develop resolution before ending a final-card Rail era Sell', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      const cotton = addIndustry(storedGame, {
        id: 'socket-final-rail-merchant-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-2-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      storedGame.players.p1.industryTileStacks.cotton_mill.builtInstanceIds.push(cotton.id);
      addLink(storedGame, 'socket-final-rail-merchant-link-1', 'p1', 'birmingham-worcester', 'rail');
      addLink(storedGame, 'socket-final-rail-merchant-link-2', 'p1', 'gloucester-worcester', 'rail');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);
      const cardId = prepareSingleCardEraEnd(storedGame, 'p1');

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        state.status === 'playing' &&
        !state.eventLog?.some((event) => event.type === 'game_ended');
      const pendingHostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const pendingObserverBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const sellResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'sell',
          playerId: 'p1',
          cardId,
          sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      } as const;

      expect(sellResponse.ok).toBe(true);
      expectNoSessionTokens(sellResponse, createResponse.sessions);
      expect(sellResponse.game.pendingDecision).toEqual(pendingDecision);
      expect(sellResponse.game.status).toBe('playing');
      expect(sellResponse.game.era).toBe('rail');
      expect(sellResponse.game.eventLog.some((event) => event.type === 'game_ended')).toBe(false);

      const [pendingHostView, pendingObserverView] = await Promise.all([
        pendingHostBroadcast,
        pendingObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([pendingHostView, pendingObserverView], createResponse.sessions);
      expect(pendingHostView.pendingDecision).toEqual(pendingDecision);
      expect(pendingObserverView.pendingDecision).toEqual(pendingDecision);
      expect(pendingHostView.status).toBe('playing');
      expect(pendingObserverView.status).toBe('playing');
      expect(pendingHostView.players.p1.handCardIds).toEqual([]);
      expect(pendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(pendingObserverView.eventLog.some((event) => event.type === 'game_ended')).toBe(false);

      const endedPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        state.status === 'ended' &&
        state.era === 'rail' &&
        Boolean(state.eventLog?.some((event) => event.type === 'game_ended'));
      const endedHostBroadcast = waitForGameState(hostSocket, endedPredicate);
      const endedObserverBroadcast = waitForGameState(observerSocket, endedPredicate);
      const resolveResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'resolve_merchant_develop',
          playerId: 'p1',
          industryTypes: ['manufacturer'],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(resolveResponse.ok).toBe(true);
      expectNoSessionTokens(resolveResponse, createResponse.sessions);
      expect(resolveResponse.game.pendingDecision).toBeUndefined();
      expect(resolveResponse.game.status).toBe('ended');
      expect(resolveResponse.game.era).toBe('rail');
      expect(resolveResponse.game.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(resolveResponse.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'merchant_develop_resolved',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          merchantSpaceIds: ['gloucester-0'],
          industryTypes: ['manufacturer'],
          specIds: ['manufacturer-1-1'],
        },
        expect.objectContaining({type: 'era_ended', era: 'rail'}),
        expect.objectContaining({type: 'game_ended'}),
      ]));

      const [endedHostView, endedObserverView] = await Promise.all([endedHostBroadcast, endedObserverBroadcast]) as [GameState, GameState];
      expectNoSessionTokens([endedHostView, endedObserverView], createResponse.sessions);
      expect(endedHostView.pendingDecision).toBeUndefined();
      expect(endedObserverView.pendingDecision).toBeUndefined();
      expect(endedHostView.status).toBe('ended');
      expect(endedObserverView.status).toBe('ended');
      expect(endedHostView.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(endedObserverView.players.p1.handCardIds).toEqual([]);
      expect(endedObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'game_ended'}));
      expect(testServer.store.get(createResponse.game.id)?.status).toBe('ended');
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[cotton.id].removedFromGame).toBe(false);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.industryTileStacks.manufacturer.removedSpecIds)
        .toEqual(['manufacturer-1-1']);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO single rail Network resource selections and broadcasts player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);
      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {ok: boolean; game: {id: string}; sessions: PlayerSession[]};
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      storedGame.actionsAllowedThisTurn = 2;
      storedGame.actionIndexInTurn = 0;
      storedGame.players.p1.cash = 50;
      storedGame.players.p1.handCardIds = ['p2-location-cannock-1'];
      const coal = addIndustry(storedGame, {
        id: 'industry-201',
        ownerPlayerId: 'p2',
        industryType: 'coal_mine',
        specId: 'coal_mine-2-1',
        locationId: 'cannock',
        slotId: 'cannock-1',
        remainingResource: 1,
      });
      addIndustry(storedGame, {
        id: 'industry-202',
        ownerPlayerId: 'p1',
        industryType: 'manufacturer',
        specId: 'manufacturer-2-1',
        locationId: 'stafford',
        slotId: 'stafford-0',
      });
      const brewery = addIndustry(storedGame, {
        id: 'industry-203',
        ownerPlayerId: 'p1',
        industryType: 'brewery',
        specId: 'brewery-1-1',
        locationId: 'coalbrookdale',
        slotId: 'coalbrookdale-0',
        remainingResource: 1,
      });

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const linkBuiltPredicate = (state: {currentTurnIndex?: number}) =>
        Boolean((state as {eventLog?: Array<{type: string}>}).eventLog?.some((event) =>
          event.type === 'link_built',
        ));
      const hostBroadcast = waitForGameState(hostSocket, linkBuiltPredicate);
      const observerBroadcast = waitForGameState(observerSocket, linkBuiltPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'network',
          playerId: 'p1',
          cardId: 'p2-location-cannock-1',
          linkLineIds: ['cannock-stafford'],
          coalSources: [{kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'}],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; handCardIds: string[]; remainingLinks: {rail: number}}>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(commandResponse.game.players.p1.cash).toBe(50 - staticConfig.rules.railSingleLinkCost);
      expect(commandResponse.game.players.p1.remainingLinks.rail).toBe(staticConfig.rules.initialLinksPerType - 1);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(commandResponse.game.eventLog.some((event) =>
        event.type === 'resource_consumed' &&
        event.reason === 'network' &&
        event.source.kind === 'industry_tile' &&
        event.source.resourceType === 'beer',
      )).toBe(false);

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        board: GameState['board'];
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(observerView.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: {kind: 'industry_tile', industryInstanceId: coal.id, resourceType: 'coal'},
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[coal.id].remainingResource).toBe(0);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[coal.id].flipped).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[brewery.id].remainingResource).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[brewery.id].flipped).toBe(false);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('applies Socket.IO double rail Network coal and beer selections with player-specific views', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);
      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {ok: boolean; game: {id: string}; sessions: PlayerSession[]};
      expect(createResponse.ok).toBe(true);

      const storedGame = testServer.store.get(createResponse.game.id);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      if (!storedGame || !session) {
        throw new Error('Expected created game and p1 session');
      }

      storedGame.era = 'rail';
      storedGame.actionsAllowedThisTurn = 2;
      storedGame.actionIndexInTurn = 0;
      storedGame.players.p1.cash = 50;
      storedGame.players.p1.handCardIds = ['p2-location-cannock-1'];
      const coal = addIndustry(storedGame, {
        id: 'industry-211',
        ownerPlayerId: 'p2',
        industryType: 'coal_mine',
        specId: 'coal_mine-2-1',
        locationId: 'cannock',
        slotId: 'cannock-1',
        remainingResource: 2,
      });
      const opponentBrewery = addIndustry(storedGame, {
        id: 'industry-212',
        ownerPlayerId: 'p2',
        industryType: 'brewery',
        specId: 'brewery-2-1',
        locationId: 'stone',
        slotId: 'stone-0',
        remainingResource: 1,
      });
      const coalSource = {kind: 'industry_tile' as const, industryInstanceId: coal.id, resourceType: 'coal' as const};
      const beerSource = {kind: 'industry_tile' as const, industryInstanceId: opponentBrewery.id, resourceType: 'beer' as const};

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const doubleRailPredicate = (state: {currentTurnIndex?: number}) =>
        ((state as {eventLog?: Array<{type: string}>}).eventLog ?? [])
          .filter((event) => event.type === 'link_built')
          .length >= 2;
      const hostBroadcast = waitForGameState(hostSocket, doubleRailPredicate);
      const observerBroadcast = waitForGameState(observerSocket, doubleRailPredicate);
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'network',
          playerId: 'p1',
          cardId: 'p2-location-cannock-1',
          linkLineIds: ['cannock-stafford', 'stafford-stone'],
          coalSources: [coalSource, coalSource],
          beerSourceForDoubleRail: beerSource,
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: {
          board: GameState['board'];
          eventLog: GameState['eventLog'];
          players: Record<string, {cash: number; handCardIds: string[]; remainingLinks: {rail: number}}>;
        };
      };

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(commandResponse.game.board.linkLines['stafford-stone'].occupiedBy).toBeDefined();
      expect(commandResponse.game.players.p1.cash).toBe(50 - staticConfig.rules.railDoubleLinkCost);
      expect(commandResponse.game.players.p1.remainingLinks.rail).toBe(staticConfig.rules.initialLinksPerType - 2);
      expect(commandResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.eventLog.filter((event) =>
        event.type === 'resource_consumed' &&
        event.reason === 'network' &&
        event.source.kind === 'industry_tile' &&
        event.source.industryInstanceId === coal.id &&
        event.source.resourceType === 'coal',
      )).toHaveLength(2);
      expect(commandResponse.game.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: beerSource,
        byPlayerId: 'p1',
        reason: 'network',
      });

      const [hostView, observerView] = await Promise.all([hostBroadcast, observerBroadcast]) as Array<{
        board: GameState['board'];
        eventLog: GameState['eventLog'];
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expectNoSessionTokens([hostView, observerView], createResponse.sessions);
      expect(hostView.players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(hostView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerView.board.linkLines['cannock-stafford'].occupiedBy).toBeDefined();
      expect(observerView.board.linkLines['stafford-stone'].occupiedBy).toBeDefined();
      expect(observerView.eventLog).toContainEqual({
        type: 'resource_consumed',
        source: beerSource,
        byPlayerId: 'p1',
        reason: 'network',
      });
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[coal.id].remainingResource).toBe(0);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[coal.id].flipped).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[opponentBrewery.id].remainingResource).toBe(0);
      expect(testServer.store.get(createResponse.game.id)?.board.industryInstances[opponentBrewery.id].flipped).toBe(true);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('broadcasts socket commands to every joined client in the game room', async () => {
    const testServer = await startTestServer();
    let firstSocket: Socket | undefined;
    let secondSocket: Socket | undefined;
    try {
      firstSocket = await connectSocket(testServer.url);
      secondSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(firstSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const joinResponse = await emitWithAck(secondSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);

      const cardId = createResponse.game.players.p1.handCardIds[0];
      const drawnCardId = testServer.store.get(createResponse.game.id)?.cardZones.drawDeck.at(-1);
      if (drawnCardId === undefined) {
        throw new Error('Expected p1 to draw a replacement card after passing');
      }
      const invalidCommand = await emitWithAck(firstSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: 'wrong-token',
      }) as {ok: boolean; errors: string[]};
      expect(invalidCommand).toEqual({ok: false, errors: ['Invalid session for p1']});
      expect(testServer.store.get(createResponse.game.id)?.currentTurnIndex).toBe(0);

      const firstBroadcast = waitForGameState(firstSocket, (state) => state.currentTurnIndex === 1);
      const secondBroadcast = waitForGameState(secondSocket, (state) => state.currentTurnIndex === 1);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const commandResponse = await emitWithAck(firstSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session?.token,
      }) as {ok: boolean; game: {currentTurnIndex: number; players: Record<string, {handCardIds: string[]}>}};

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(commandResponse.game.players.p1.handCardIds).toContain(drawnCardId);
      const broadcasts = await Promise.all([firstBroadcast, secondBroadcast]) as Array<{
        currentTurnIndex: number;
        cardZones: {drawDeck: string[]};
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expectNoSessionTokens(broadcasts, createResponse.sessions);
      expect(broadcasts).toEqual([
        expect.objectContaining({currentTurnIndex: 1}),
        expect.objectContaining({currentTurnIndex: 1}),
      ]);
      expect(broadcasts[0].players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[0].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(JSON.stringify(broadcasts[1])).not.toContain(drawnCardId);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      firstSocket?.disconnect();
      secondSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('keeps an observing socket unbound after a failed socket command', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {
        ok: boolean;
        game: {players: Record<string, {handCardIds: string[]}>};
      };
      expect(observerJoin.ok).toBe(true);
      expect(observerJoin.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);

      const cardId = createResponse.game.players.p1.handCardIds[0];
      await expect(emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: 'wrong-token',
      })).resolves.toEqual({ok: false, errors: ['Invalid session for p1']});

      const observerBroadcast = waitForGameState(observerSocket, (state) => state.currentTurnIndex === 1);
      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const commandResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session?.token,
      }) as {ok: boolean; game: {currentTurnIndex: number}};

      expect(commandResponse.ok).toBe(true);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      const broadcast = await observerBroadcast as {
        players: Record<string, {handCardIds: string[]}>;
      };
      expect(broadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects socket commands for a different player than the bound socket view', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p2');
      const p1CardId = createResponse.game.players.p1.handCardIds[0];
      const p1Broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const p1CommandResponse = await emitWithAck(socket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId: p1CardId},
        sessionToken: p1Session?.token,
      }) as {ok: boolean; game: {currentTurnIndex: number}};
      expect(p1CommandResponse.ok).toBe(true);
      expect(p1CommandResponse.game.currentTurnIndex).toBe(1);
      await p1Broadcast;

      const storedBeforeMismatch = testServer.store.get(createResponse.game.id);
      const p2CardId = storedBeforeMismatch?.players.p2.handCardIds[0];
      if (!p2CardId) {
        throw new Error('Expected p2 to have a card');
      }

      const mismatchedCommandResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:command', {
          gameId: createResponse.game.id,
          command: {type: 'pass', playerId: 'p2', cardId: p2CardId},
          sessionToken: p2Session?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );

      expect(mismatchedCommandResponse).toEqual({
        ok: false,
        errors: ['Socket player does not match command player'],
      });
      expect(testServer.store.get(createResponse.game.id)?.currentTurnIndex).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.players.p2.discardCardIds).not.toContain(p2CardId);
      const serverSocket = testServer.io.sockets.sockets.get(socket.id as string);
      expect(serverSocket?.data.playerId).toBe('p1');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('rejects socket commands for a different game than the bound socket room', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);

      const firstCreateResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
      };
      expect(firstCreateResponse.ok).toBe(true);
      expect(socket.id).toBeDefined();

      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      const secondSession = testServer.store.getPlayerSession(secondGame.id, 'p1');
      const secondCardId = secondGame.players.p1.handCardIds[0];
      const socketId = socket.id as string;

      const crossGameCommandResponse = await expectNoGameStateWhile(socket, () =>
        emitWithAck(socket as Socket, 'game:command', {
          gameId: secondGame.id,
          command: {type: 'pass', playerId: 'p1', cardId: secondCardId},
          sessionToken: secondSession?.token,
        }) as Promise<{ok: boolean; errors: string[]}>,
      );

      expect(crossGameCommandResponse).toEqual({
        ok: false,
        errors: ['Socket game does not match command game'],
      });
      expect(testServer.store.get(secondGame.id)?.currentTurnIndex).toBe(0);
      expect(testServer.store.get(secondGame.id)?.players.p1.discardCardIds).not.toContain(secondCardId);
      expect(testServer.io.sockets.adapter.rooms.get(firstCreateResponse.game.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).not.toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socketId);
      expect(serverSocket?.data.gameId).toBe(firstCreateResponse.game.id);
      expect(serverSocket?.data.playerId).toBe('p1');
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('binds an observing socket to the command player after a valid socket command', async () => {
    const testServer = await startTestServer();
    let hostSocket: Socket | undefined;
    let observerSocket: Socket | undefined;
    try {
      hostSocket = await connectSocket(testServer.url);
      observerSocket = await connectSocket(testServer.url);

      const createResponse = await emitWithAck(hostSocket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);

      const joinResponse = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {
        ok: boolean;
        game: {players: Record<string, {handCardIds: string[]}>};
      };
      expect(joinResponse.ok).toBe(true);
      expect(joinResponse.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = createResponse.game.players.p1.handCardIds[0];
      const observerBroadcast = waitForGameState(observerSocket, (state) => state.currentTurnIndex === 1);
      const commandResponse = await emitWithAck(observerSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session?.token,
      }) as {ok: boolean; game: {players: Record<string, {handCardIds: string[]}>}};

      expect(commandResponse.ok).toBe(true);
      expectNoSessionTokens(commandResponse, createResponse.sessions);
      expect(commandResponse.game.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(commandResponse.game.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      const broadcast = await observerBroadcast as {players: Record<string, {handCardIds: string[]}>};
      expectNoSessionTokens(broadcast, createResponse.sessions);
      expect(broadcast.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(broadcast.players.p2.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
      const serverSocket = testServer.io.sockets.sockets.get(observerSocket.id as string);
      expect(serverSocket?.data.gameId).toBe(createResponse.game.id);
      expect(serverSocket?.data.playerId).toBe('p1');
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });
});
