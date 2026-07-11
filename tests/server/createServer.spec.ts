import {describe, expect, it} from 'vitest';
import type {AddressInfo} from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {io as createClient, type Socket} from 'socket.io-client';
import {
  applyFaceAuditReviewSheet,
  buildFaceAuditAreaReviewerInstructionsReport,
  buildFaceAuditAreaReviewSheet,
  buildFaceAuditAreaReviewTodoSummary,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditChecklistExport,
  buildFaceAuditEvidenceRefTemplate,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewerInstructions,
  buildFaceAuditReviewPlan,
  buildFaceAuditReviewSheet,
  buildFaceAuditReviewTodo,
  buildFaceAuditReviewTodoSummary,
  buildFaceAuditReviewTemplate,
  FACE_AUDIT_AREAS,
  faceAuditAreaReviewerInstructionsArtifactFileName,
  faceAuditAreaReviewArtifactFileName,
  faceAuditAreaReviewSheetArtifactFileName,
  summarizeFaceAuditReviewStatus,
} from '../../src/common/faceAudit';
import {createGame} from '../../src/common/gameSetup';
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

async function connectSocket(url: string, origin?: string): Promise<Socket> {
  const socket = createClient(url, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    ...(origin ? {extraHeaders: {origin}} : {}),
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

async function expectNoGameListWhile<T>(socket: Socket, action: () => Promise<T>, durationMs = 200): Promise<T> {
  let received = false;
  let unexpectedList: unknown;
  const listener = (payload: unknown) => {
    received = true;
    unexpectedList = payload;
  };
  socket.on('games:list', listener);
  try {
    const result = await action();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (received) {
      throw new Error(`Unexpected games:list broadcast: ${JSON.stringify(unexpectedList)}`);
    }
    return result;
  } finally {
    socket.off('games:list', listener);
  }
}

function expectNoSessionTokens(value: unknown, sessions: PlayerSession[]): void {
  const serialized = JSON.stringify(value);
  for (const session of sessions) {
    expect(serialized).not.toContain(session.token);
  }
}

function deterministicSetupSnapshot(game: GameState) {
  return {
    playerCount: game.playerCount,
    era: game.era,
    roundNumber: game.roundNumber,
    turnOrder: [...game.turnOrder],
    currentTurnIndex: game.currentTurnIndex,
    actionIndexInTurn: game.actionIndexInTurn,
    actionsAllowedThisTurn: game.actionsAllowedThisTurn,
    players: Object.fromEntries(Object.entries(game.players)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, player]) => [playerId, {
        name: player.name,
        cash: player.cash,
        victoryPoints: player.victoryPoints,
        incomeTrackPosition: player.incomeTrackPosition,
        spentThisRound: player.spentThisRound,
        handCardIds: [...player.handCardIds],
        discardCardIds: [...player.discardCardIds],
        faceDownDiscardCount: player.faceDownDiscardCount,
        industryTileStacks: player.industryTileStacks,
        remainingLinks: player.remainingLinks,
      }])),
    board: {
      slots: game.board.slots,
      linkLines: game.board.linkLines,
      merchantSpaces: game.board.merchantSpaces,
      industryInstances: game.board.industryInstances,
      linkInstances: game.board.linkInstances,
    },
    cardZones: {
      drawDeck: [...game.cardZones.drawDeck],
      wildLocationPool: [...game.cardZones.wildLocationPool],
      wildIndustryPool: [...game.cardZones.wildIndustryPool],
    },
    markets: game.markets,
    nextInstanceId: game.nextInstanceId,
    status: game.status,
    variant: game.variant,
  };
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
    game.players.p2.handCardIds.push('p3-location-leek-1');
    (game.players.p2.handCardIds as unknown[]).push(42);

    const view = gameStateForPlayer(game, 'p2');
    const observerView = gameStateForPlayer(game);

    expect(view.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.players.p2.handCardIds).toEqual(p2Hand);
    expect(view.players.p2.handCardIds).not.toBe(game.players.p2.handCardIds);
    expect(observerView.players.p2.handCardIds).toHaveLength(p2Hand.length);
    expect(observerView.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(JSON.stringify(view)).not.toContain('secret-token');
    expect(JSON.stringify(view)).not.toContain('p3-location-leek-1');

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

  it('normalizes dirty game ids in projected game views', () => {
    const game = testGame();
    (game as unknown as {id: unknown}).id = ' dirty-room-id \n';

    const view = gameStateForPlayer(game, 'p1');

    expect(view.id).toBe('dirty-room-id');

    (game as unknown as {id: unknown}).id = {secret: 'secret-token'};
    const fallbackView = gameStateForPlayer(game, 'p1');

    expect(fallbackView.id).toBe('unknown-game');
    expect(JSON.stringify(fallbackView)).not.toContain('secret-token');
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

  it('does not project the introductory variant on non-Canal game states', () => {
    const game = testGame();
    game.variant = 'introductory_canal_only';
    game.era = 'rail';
    game.actionsAllowedThisTurn = 2;

    const view = gameStateForPlayer(game, 'p1') as GameState & Record<string, unknown>;

    expect(view.era).toBe('rail');
    expect(view).not.toHaveProperty('variant');
    expect(JSON.stringify(view)).not.toContain('introductory_canal_only');
  });

  it('normalizes public player names in projected game views', () => {
    const game = testGame();
    game.players.p1.name = ' Ada\n';
    game.players.p2.name = '   ';
    game.players.p2.color = 'not-a-player-color' as GameState['players'][string]['color'];
    (game.players.p2 as unknown as {privateNote?: string}).privateNote = 'secret-token';

    const view = gameStateForPlayer(game, 'p1');

    expect(view.players.p1.name).toBe('Ada');
    expect(view.players.p1.color).toBe('orange');
    expect(view.players.p2.name).toBe('Player 2');
    expect(view.players.p2.color).toBe('yellow');
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });

  it('does not treat array-shaped players as valid records in projected game views', () => {
    const game = testGame();
    const players = game.players as unknown as Record<string, unknown>;
    players.p1 = ['secret-token'];
    players.p3 = ['secret-token'];

    const view = gameStateForPlayer(game);

    expect(Object.keys(view.players)).toEqual(['p2']);
    expect(view.players).not.toHaveProperty('p1');
    expect(view.players).not.toHaveProperty('p3');
    expect(view.turnOrder).toEqual(['p2']);
    expect(view.currentTurnIndex).toBe(0);
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });

  it('does not inflate two-player projected game views when stale higher seats exist', () => {
    const game = testGame();
    const players = game.players as unknown as Record<string, GameState['players'][string]>;
    players.p3 = {
      ...structuredClone(game.players.p1),
      id: 'p3',
      name: 'Secret player 3',
      handCardIds: ['p3-location-leek-1', 'secret-token'],
    };
    players.p4 = {
      ...structuredClone(game.players.p2),
      id: 'p4',
      name: 'Secret player 4',
      handCardIds: ['p4-location-derby-1', 'secret-token'],
    };
    game.playerCount = 2;
    game.turnOrder = ['p3', 'p1', 'p2', 'p4'];
    game.currentTurnIndex = 0;
    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p3',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    const view = gameStateForPlayer(game, 'p3') as GameState & Record<string, unknown>;

    expect(view.playerCount).toBe(2);
    expect(Object.keys(view.players)).toEqual(['p1', 'p2']);
    expect(view.players).not.toHaveProperty('p3');
    expect(view.players).not.toHaveProperty('p4');
    expect(view.turnOrder).toEqual(['p1', 'p2']);
    expect(view.currentTurnIndex).toBe(0);
    expect(view.pendingDecision).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('Secret player');
    expect(JSON.stringify(view)).not.toContain('secret-token');
  });

  it('keeps the declared player count when projecting a partially corrupt higher-count game', () => {
    const game = createGame({
      id: 'three-player-corrupt',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 5,
      initialTurnOrder: ['p1', 'p2', 'p3'],
    });
    const p3VisibleCard = 'p3-location-leek-1';
    game.players.p3.handCardIds = [p3VisibleCard, 'p4-location-derby-1', 'secret-token'];
    (game.players as unknown as Record<string, unknown>).p2 = ['secret-token'];
    (game.players as unknown as Record<string, unknown>).p4 = {
      ...structuredClone(game.players.p1),
      id: 'p4',
      name: 'Secret player 4',
      handCardIds: ['p4-location-derby-1', 'secret-token'],
    };
    game.turnOrder = ['p3', 'p2', 'p1', 'p4'];
    game.currentTurnIndex = 0;
    game.pendingDecision = {
      type: 'negative_income',
      playerId: 'p3',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    const view = gameStateForPlayer(game, 'p3') as GameState & Record<string, unknown>;

    expect(view.playerCount).toBe(3);
    expect(Object.keys(view.players)).toEqual(['p1', 'p3']);
    expect(view.players).not.toHaveProperty('p2');
    expect(view.players).not.toHaveProperty('p4');
    expect(view.players.p3.handCardIds).toEqual([p3VisibleCard]);
    expect(view.turnOrder).toEqual(['p3', 'p1']);
    expect(view.currentTurnIndex).toBe(0);
    expect(view.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p3',
      amountOwed: 5,
      incomePlayerIndex: 0,
    });
    expect(JSON.stringify(view)).not.toContain('Secret player');
    expect(JSON.stringify(view)).not.toContain('secret-token');
    expect(JSON.stringify(view)).not.toContain('p4-location-derby-1');
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
    expect(view.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);
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

  it('keeps explicit empty markets but projects invalid market counts conservatively', () => {
    const game = testGame();
    game.markets.coal.occupiedCount = 0;
    game.markets.iron.occupiedCount = -1;

    const view = gameStateForPlayer(game);

    expect(view.markets.coal.occupiedCount).toBe(0);
    expect(view.markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);

    delete (game.markets.iron as Partial<typeof game.markets.iron>).occupiedCount;

    expect(gameStateForPlayer(game).markets.iron.occupiedCount).toBe(staticConfig.markets.iron.initialOccupiedCount);
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
      count: 99,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'missing-space'],
    } as GameState['pendingDecision'];
    expect(gameStateForPlayer(game).pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
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
        type: 'industry_flipped',
        industryInstanceId: ' industry-1 ',
        ownerPlayerId: ' p1 ',
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
    expect(view.eventLog).toContainEqual({type: 'industry_flipped', industryInstanceId: 'industry-1', ownerPlayerId: 'p1'});
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
    expect(view.eventLog.filter((event) => event.type === 'merchant_develop_resolved')).toEqual([]);
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

  it('projects game ended events only after final era scoring and when winners match final standings', () => {
    const game = testGame();
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

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p2']},
    ]);
  });

  it('drops projected events between final era scoring and game end', () => {
    const game = testGame();
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

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'era_ended', era: 'rail', score: railScore},
      {type: 'game_ended', winners: ['p1']},
    ]);
  });

  it('filters industry build logs that conflict with the current public board identity', () => {
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
    const manufacturer = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });
    game.eventLog = [
      {
        type: 'industry_built',
        instance: {
          ...cotton,
          flipped: false,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: 'industry-3',
          specId: 'cotton_mill-1-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          level: 1,
          locationId: 'kidderminster',
          slotId: 'kidderminster-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          ...manufacturer,
          locationId: 'birmingham',
          slotId: 'birmingham-1',
        },
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'industry_built',
        instance: {
          ...cotton,
          flipped: false,
          removedFromGame: false,
        },
      },
      {
        type: 'industry_built',
        instance: {
          id: 'industry-3',
          specId: 'cotton_mill-1-1',
          ownerPlayerId: 'p1',
          industryType: 'cotton_mill',
          level: 1,
          locationId: 'kidderminster',
          slotId: 'kidderminster-0',
          flipped: false,
          remainingResource: 0,
          removedFromGame: false,
        },
      },
    ]);
  });

  it('filters link build logs that conflict with the current public board identity', () => {
    const game = testGame();
    addLink(game, 'link-1', 'p1', 'birmingham-oxford');
    addLink(game, 'link-2', 'p1', 'birmingham-walsall');
    game.eventLog = [
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
          id: 'link-3',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'kidderminster-worcester',
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
          id: 'link-3',
          ownerPlayerId: 'p2',
          linkType: 'canal',
          linkLineId: 'kidderminster-worcester',
        },
      },
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

  it('projects loan taken events only after matching loan cash, income, and discard evidence', () => {
    const game = testGame();
    const start = staticConfig.incomeTrack.startPosition;
    const firstLoanPosition = retreatIncomeLevels(start, staticConfig.rules.loanIncomeLevelPenalty);
    const secondLoanPosition = retreatIncomeLevels(firstLoanPosition, staticConfig.rules.loanIncomeLevelPenalty);
    const firstLoanCard = 'p2-location-birmingham-1';
    const secondLoanCard = 'p2-location-cannock-1';
    game.eventLog = [
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p1', cardId: firstLoanCard, destination: 'discard'},
      {type: 'loan_taken', playerId: ' p1 '},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: firstLoanPosition, to: secondLoanPosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p1', cardId: secondLoanCard, destination: 'discard'},
      {type: 'loan_taken', playerId: 'p1'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: firstLoanPosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p1', cardId: firstLoanCard, destination: 'discard'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: firstLoanPosition, to: secondLoanPosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p1', cardId: secondLoanCard, destination: 'discard'},
      {type: 'loan_taken', playerId: 'p1'},
    ]);
  });

  it('filters adjacent loan value changes that do not match the loan chain', () => {
    const game = testGame();
    const start = staticConfig.incomeTrack.startPosition;
    const loanPosition = retreatIncomeLevels(start, staticConfig.rules.loanIncomeLevelPenalty);
    const shortLoanPosition = retreatIncomeLevels(start, 2);
    const loanCard = 'p2-location-birmingham-1';
    game.eventLog = [
      {type: 'cash_changed', playerId: ' p1 ', delta: staticConfig.rules.loanCash, reason: ' loan '},
      {type: 'income_position_changed', playerId: ' p1 ', from: start, to: loanPosition, reason: ' loan '},
      {type: 'card_discarded', playerId: ' p1 ', cardId: ` ${loanCard} `, destination: ' discard '},
      {type: 'loan_taken', playerId: ' p1 '},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p2', from: start, to: loanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p2'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: loanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p2'},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: shortLoanPosition, reason: 'loan'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'income_position_changed')).toEqual([
      {type: 'income_position_changed', playerId: 'p1', from: start, to: loanPosition, reason: 'loan'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'card_discarded')).toEqual([
      {type: 'card_discarded', playerId: 'p1', cardId: loanCard, destination: 'discard'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'loan_taken')).toEqual([
      {type: 'loan_taken', playerId: 'p1'},
    ]);
  });

  it('filters known-position round income cash changes that do not match the public income position', () => {
    const game = testGame();
    const start = staticConfig.incomeTrack.startPosition;
    const cotton = addIndustry(game, {
      id: 'industry-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const incomePosition = advanceIncomeSpaces(start, 5);
    const income = getIncomeLevel(incomePosition);
    expect(income).toBeGreaterThan(0);
    game.eventLog = [
      {type: 'income_position_changed', playerId: 'p1', from: start, to: incomePosition, reason: 'sold cotton_mill'},
      {type: 'industry_flipped', industryInstanceId: cotton.id, ownerPlayerId: 'p1'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: ' p1 ', delta: income, reason: ' income '},
      {type: 'cash_changed', playerId: 'p2', delta: income, reason: 'income'},
      {type: 'cash_changed', playerId: 'p1', delta: income, reason: 'income'},
      {type: 'turn_advanced', currentPlayerId: 'p1', roundNumber: 2},
      {type: 'cash_changed', playerId: 'p1', delta: income + 1, reason: 'income'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: income, reason: 'income'},
      {type: 'cash_changed', playerId: 'p2', delta: income, reason: 'income'},
      {type: 'cash_changed', playerId: 'p1', delta: income + 1, reason: 'income'},
    ]);
  });

  it('filters negative-income payment cash changes that do not match the resolution paid amount', () => {
    const game = testGame();
    const start = staticConfig.incomeTrack.startPosition;
    const negativeIncomePosition = retreatIncomeLevels(start, 3);
    expect(getIncomeLevel(negativeIncomePosition)).toBe(-3);
    game.eventLog = [
      {type: 'cash_changed', playerId: 'p1', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: negativeIncomePosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p1', cardId: 'p2-location-birmingham-1', destination: 'discard'},
      {type: 'loan_taken', playerId: 'p1'},
      {type: 'cash_changed', playerId: 'p2', delta: staticConfig.rules.loanCash, reason: 'loan'},
      {type: 'income_position_changed', playerId: 'p2', from: start, to: negativeIncomePosition, reason: 'loan'},
      {type: 'card_discarded', playerId: 'p2', cardId: 'p2-location-cannock-1', destination: 'discard'},
      {type: 'loan_taken', playerId: 'p2'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'negative_income_started', playerId: 'p1', amountOwed: 3, incomePlayerIndex: 0},
      {type: 'cash_changed', playerId: 'p1', delta: -2, reason: 'income'},
      {type: 'negative_income_resolved', playerId: 'p1', amountOwed: 3, paid: 3, victoryPointLoss: 0, industryInstanceIds: []},
      {type: 'negative_income_started', playerId: 'p2', amountOwed: 3, incomePlayerIndex: 1},
      {type: 'cash_changed', playerId: ' p2 ', delta: -3, reason: ' income '},
      {type: 'negative_income_resolved', playerId: ' p2 ', amountOwed: 3, paid: 3, victoryPointLoss: 0, industryInstanceIds: []},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'cash_changed' && event.reason === 'income')).toEqual([
      {type: 'cash_changed', playerId: 'p2', delta: -3, reason: 'income'},
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
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    game.eventLog = [
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'resource_consumed',
        source: {kind: ' merchant_beer ', merchantSpaceId: ' gloucester-0 ', merchantTileInstanceId: ' gloucester-cotton-0 '},
        byPlayerId: ' p1 ',
        reason: ' sell ',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: ' p1 ',
        merchantSpaceId: ' gloucester-0 ',
        bonus: {type: ' develop ', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: ' p1 ',
        merchantSpaceId: ' gloucester-0 ',
        merchantSpaceIds: [' gloucester-0 ', '\tgloucester-0\n'],
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
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    }, {
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      bonus: {type: 'develop', count: 1},
    }, {
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    }]);
  });

  it('projects one removed-spec merchant develop resolution per develop merchant bonus in public logs', () => {
    const game = testGame();
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = ['manufacturer-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    game.eventLog = [
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
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
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        industryTypes: ['iron_works'],
        specIds: ['iron_works-1-1'],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
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
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        merchantSpaceIds: ['gloucester-1'],
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      },
    ]);
  });

  it('drops projected merchant develop resolutions that duplicate a spec id within one event', () => {
    const game = testGame();
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    game.eventLog = [
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
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['cotton_mill', 'cotton_mill'],
        specIds: ['cotton_mill-1-1', 'cotton_mill-1-1'],
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'merchant_develop_resolved')).toEqual([{
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['cotton_mill'],
      specIds: ['cotton_mill-1-1'],
    }]);
  });

  it('does not carry projected pending merchant develop bonuses across era boundaries', () => {
    const game = testGame();
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = ['manufacturer-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    const canalScore = {
      era: 'canal' as const,
      linkVictoryPointsByPlayer: {p1: 0, p2: 0},
      industryVictoryPointsByPlayer: {p1: 0, p2: 0},
      totalVictoryPointsByPlayer: {p1: 0, p2: 0},
    };
    game.eventLog = [
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'era_ended', era: 'canal', score: canalScore},
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
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'era_ended', era: 'canal', score: canalScore},
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        merchantSpaceIds: ['gloucester-1'],
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      },
    ]);
  });

  it('does not carry projected pending merchant develop bonuses across turn-order updates', () => {
    const game = testGame();
    game.players.p1.industryTileStacks.cotton_mill.removedSpecIds = ['cotton_mill-1-1'];
    game.players.p1.industryTileStacks.manufacturer.removedSpecIds = ['manufacturer-1-1'];
    setMerchantSpace(game, 'gloucester-0', 'gloucester-cotton-0', false);
    setMerchantSpace(game, 'gloucester-1', 'gloucester-manufacturer-0', false);
    game.eventLog = [
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
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        industryTypes: ['cotton_mill'],
        specIds: ['cotton_mill-1-1'],
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
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
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        bonus: {type: 'develop', count: 1},
      },
      {
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-1',
        merchantSpaceIds: ['gloucester-1'],
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
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
      {
        type: 'resource_consumed',
        source: {kind: 'market', market: 'iron', price: ironPrice},
        byPlayerId: 'p1',
        reason: 'develop iron',
      },
    ]);
  });

  it('keeps projected action spend cash changes only with matching action evidence', () => {
    const game = testGame();
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
    addLink(game, 'link-101', 'p1', 'birmingham-oxford');
    game.eventLog = [
      {type: 'cash_changed', playerId: 'p1', delta: -buildSpec.cost.cash, reason: 'build'},
      {type: 'industry_built', instance: builtIndustry},
      {type: 'cash_changed', playerId: 'p1', delta: -buildSpec.cost.cash, reason: 'build'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'link_built', instance: {id: 'link-101', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'birmingham-oxford'}},
      {type: 'cash_changed', playerId: 'p1', delta: -staticConfig.rules.canalLinkCost, reason: 'network'},
      {type: 'link_built', instance: {id: 'link-102', ownerPlayerId: 'p1', linkType: 'canal', linkLineId: 'dudley-worcester'}},
      {type: 'cash_changed', playerId: 'p1', delta: -99, reason: 'network'},
      {type: 'resource_consumed', source: {kind: 'market', market: 'iron', price: ironPrice}, byPlayerId: 'p1', reason: 'develop'},
      {type: 'cash_changed', playerId: 'p1', delta: -ironPrice, reason: 'develop iron'},
      {type: 'cash_changed', playerId: 'p1', delta: -ironPrice, reason: 'develop iron'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: -buildSpec.cost.cash, reason: 'build'},
      {type: 'cash_changed', playerId: 'p1', delta: -staticConfig.rules.canalLinkCost, reason: 'network'},
      {type: 'cash_changed', playerId: 'p1', delta: -ironPrice, reason: 'develop iron'},
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

  it('filters adjacent negative-income liquidation cash changes that do not match the removed industry', () => {
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
    const manufacturer = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p2',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });
    const brewery = addIndustry(game, {
      id: 'industry-3',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
    });
    for (const industry of [cotton, manufacturer, brewery]) {
      industry.removedFromGame = true;
      game.board.slots[industry.slotId] = {};
    }
    const cottonCash = Math.floor(staticConfig.industryTileSpecs[cotton.specId].cost.cash / 2);
    const manufacturerCash = Math.floor(staticConfig.industryTileSpecs[manufacturer.specId].cost.cash / 2);
    const breweryCash = Math.floor(staticConfig.industryTileSpecs[brewery.specId].cost.cash / 2);
    game.eventLog = [
      {type: 'industry_removed', industryInstanceId: ` ${cotton.id} `, reason: ' negative_income '},
      {type: 'cash_changed', playerId: ' p1 ', delta: cottonCash, reason: ' negative income liquidation '},
      {type: 'industry_removed', industryInstanceId: cotton.id, reason: 'negative_income'},
      {type: 'cash_changed', playerId: 'p1', delta: cottonCash, reason: 'negative income liquidation'},
      {type: 'industry_removed', industryInstanceId: manufacturer.id, reason: 'negative_income'},
      {type: 'cash_changed', playerId: 'p1', delta: manufacturerCash, reason: 'negative income liquidation'},
      {type: 'industry_removed', industryInstanceId: brewery.id, reason: 'negative_income'},
      {type: 'cash_changed', playerId: 'p1', delta: breweryCash + 1, reason: 'negative income liquidation'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'cash_changed', playerId: 'p1', delta: cottonCash, reason: 'negative income liquidation'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'cash_changed')).toEqual([
      {type: 'cash_changed', playerId: 'p1', delta: cottonCash, reason: 'negative income liquidation'},
      {type: 'cash_changed', playerId: 'p1', delta: cottonCash, reason: 'negative income liquidation'},
    ]);
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
      {type: 'cash_changed', playerId: 'p1', delta: 99, reason: 'sold coal to market'},
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

  it('filters adjacent market-sale cash changes when the market sale is hidden', () => {
    const game = testGame();
    const coalPrice = staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0];
    const ironPrice = staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0];
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
        market: 'iron',
        cashReceived: ironPrice,
      },
      {type: 'cash_changed', playerId: 'p1', delta: ironPrice, reason: 'sold iron to market'},
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
      {type: 'cash_changed', playerId: 'p1', delta: coalPrice, reason: 'sold coal to market'},
      {
        type: 'resource_sold_to_market',
        industryInstanceId: coal.id,
        market: 'coal',
        cashReceived: coalPrice,
      },
      {type: 'cash_changed', playerId: 'p1', delta: coalPrice, reason: 'sold coal to market'},
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

  it('filters adjacent industry flip income changes that do not match the flip', () => {
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
    const manufacturer = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: true,
    });
    const brewery = addIndustry(game, {
      id: 'industry-3',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
      flipped: true,
    });
    const start = staticConfig.incomeTrack.startPosition;
    const cottonIncome = staticConfig.industryTileSpecs[cotton.specId].flip.incomeSpaces;
    const breweryIncome = staticConfig.industryTileSpecs[brewery.specId].flip.incomeSpaces;
    const mismatchedBreweryIncome = breweryIncome === 1 ? 2 : 1;
    const cottonTo = advanceIncomeSpaces(start, cottonIncome);
    game.eventLog = [
      {type: 'income_position_changed', playerId: ' p1 ', from: start, to: cottonTo, reason: ' sold cotton_mill '},
      {type: 'industry_flipped', industryInstanceId: ` ${cotton.id} `, ownerPlayerId: ' p1 '},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'},
      {type: 'industry_flipped', industryInstanceId: manufacturer.id, ownerPlayerId: 'p1'},
      {
        type: 'income_position_changed',
        playerId: 'p1',
        from: start,
        to: advanceIncomeSpaces(start, mismatchedBreweryIncome),
        reason: 'flipped brewery',
      },
      {type: 'industry_flipped', industryInstanceId: brewery.id, ownerPlayerId: 'p1'},
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: advanceIncomeSpaces(start, 1), reason: 'sold cotton_mill'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'income_position_changed')).toEqual([
      {type: 'income_position_changed', playerId: 'p1', from: start, to: cottonTo, reason: 'sold cotton_mill'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'industry_flipped')).toEqual([
      {type: 'industry_flipped', industryInstanceId: cotton.id, ownerPlayerId: 'p1'},
      {type: 'industry_flipped', industryInstanceId: manufacturer.id, ownerPlayerId: 'p1'},
      {type: 'industry_flipped', industryInstanceId: brewery.id, ownerPlayerId: 'p1'},
    ]);
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
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
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

  it('filters industry sold events when the adjacent flip is for a different industry', () => {
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
    const manufacturer = addIndustry(game, {
      id: 'industry-2',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
      flipped: true,
    });
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', false);
    game.eventLog = [
      {
        type: 'industry_flipped',
        industryInstanceId: ` ${manufacturer.id} `,
        ownerPlayerId: ' p1 ',
      },
      {
        type: 'industry_sold',
        industryInstanceId: cotton.id,
        ownerPlayerId: 'p1',
        merchantSpaceId: 'oxford-0',
      },
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {
        type: 'industry_sold',
        industryInstanceId: ` ${cotton.id} `,
        ownerPlayerId: ' p1 ',
        merchantSpaceId: ' oxford-0 ',
      },
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'industry_sold')).toEqual([{
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
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
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
    const game = createGame({
      id: 'test-game',
      playerNames: ['Ada', 'Ben', 'Cara'],
      seed: 1,
      initialTurnOrder: ['p1', 'p2', 'p3'],
    });
    setMerchantSpace(game, 'oxford-0', 'oxford-cotton-0', false);
    setMerchantSpace(game, 'shrewsbury-0', 'oxford-cotton-1', false);
    setMerchantSpace(game, 'warrington-0', 'warrington-pottery-0', false);
    const start = staticConfig.incomeTrack.startPosition;
    game.eventLog = [
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'income_position_changed', playerId: ' p1 ', from: start, to: advanceIncomeSpaces(start, 2), reason: ' merchant bonus '},
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
      {type: 'income_position_changed', playerId: 'p1', from: start, to: advanceIncomeSpaces(start, 1), reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'oxford-0',
        bonus: {type: 'income_spaces', spaces: 2},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'shrewsbury-0', merchantTileInstanceId: 'oxford-cotton-1'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'shrewsbury-0',
        bonus: {type: 'victory_points', points: 4},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'shrewsbury-0', merchantTileInstanceId: 'oxford-cotton-1'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: 3, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'shrewsbury-0',
        bonus: {type: 'victory_points', points: 4},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'warrington-0', merchantTileInstanceId: 'warrington-pottery-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'warrington-0',
        bonus: {type: 'cash', cash: 5},
      },
      {
        type: 'resource_consumed',
        source: {kind: 'merchant_beer', merchantSpaceId: 'warrington-0', merchantTileInstanceId: 'warrington-pottery-0'},
        byPlayerId: 'p1',
        reason: 'sell',
      },
      {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
      {
        type: 'merchant_bonus_claimed',
        playerId: 'p1',
        merchantSpaceId: 'warrington-0',
        bonus: {type: 'cash', cash: 5},
      },
      {type: 'turn_order_updated', order: ['p1', 'p2', 'p3']},
      {type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
      {type: 'cash_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'},
      {type: 'income_position_changed', playerId: 'p1', from: start, to: advanceIncomeSpaces(start, 1), reason: 'merchant bonus'},
      {type: 'victory_points_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'},
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
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [cotton.id],
      },
      {
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [` ${cotton.id} `],
      },
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [cotton.id],
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
        type: 'negative_income_started',
        playerId: 'p2',
        amountOwed: 2,
        incomePlayerIndex: 1,
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
        type: 'negative_income_started',
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
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

  it('validates projected negative income starts against the current turn order', () => {
    const game = testGame();
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

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
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

  it('drops projected negative income chains interrupted before resolution', () => {
    const game = testGame();
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

    const view = gameStateForPlayer(game);

    expect(view.eventLog).toEqual([
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
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 5,
        victoryPointLoss: 0,
        industryInstanceIds: [],
      },
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
        industryInstanceIds: [],
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
    ]);
  });

  it('filters adjacent negative-income shortfall point changes that do not match the resolution', () => {
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
        playerId: 'p1',
        amountOwed: 5,
        incomePlayerIndex: 0,
      },
      {type: 'victory_points_changed', playerId: ' p1 ', delta: -2, reason: ' negative income shortfall '},
      {
        type: 'negative_income_resolved',
        playerId: ' p1 ',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [],
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: -2, reason: 'negative income shortfall'},
      {
        type: 'negative_income_resolved',
        playerId: 'p2',
        amountOwed: 5,
        paid: 3,
        victoryPointLoss: 2,
        industryInstanceIds: [cotton.id],
      },
      {type: 'victory_points_changed', playerId: 'p1', delta: -2, reason: 'negative income shortfall'},
      {
        type: 'negative_income_resolved',
        playerId: 'p1',
        amountOwed: 5,
        paid: 4,
        victoryPointLoss: 1,
        industryInstanceIds: [cotton.id],
      },
      {type: 'turn_order_updated', order: ['p1', 'p2']},
      {type: 'victory_points_changed', playerId: 'p1', delta: -2, reason: 'negative income shortfall'},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'victory_points_changed')).toEqual([
      {type: 'victory_points_changed', playerId: 'p1', delta: -2, reason: 'negative income shortfall'},
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
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
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
    ]);
    expect(view.eventLog).toContainEqual({type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints});
    expect(view.eventLog).toContainEqual({
      type: 'industry_scored',
      industryInstanceId: industry.id,
      ownerPlayerId: 'p1',
      points: industryPoints,
    });
  });

  it('filters scoring victory point changes when the adjacent score detail is hidden', () => {
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
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      {type: 'link_scored', linkInstanceId: 'link-99', ownerPlayerId: 'p1', points: linkPoints},
      {type: 'victory_points_changed', playerId: ' p1 ', delta: industryPoints, reason: ' industry scoring '},
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
      {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'},
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
      {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'},
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p2', points: industryPoints},
    ] as unknown as GameState['eventLog'];

    const view = gameStateForPlayer(game);

    expect(view.eventLog.filter((event) => event.type === 'victory_points_changed')).toEqual([
      {type: 'victory_points_changed', playerId: 'p1', delta: linkPoints, reason: 'link scoring'},
      {type: 'victory_points_changed', playerId: 'p1', delta: industryPoints, reason: 'industry scoring'},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'link_scored')).toEqual([
      {type: 'link_scored', linkInstanceId: 'link-1', ownerPlayerId: 'p1', points: linkPoints},
    ]);
    expect(view.eventLog.filter((event) => event.type === 'industry_scored')).toEqual([
      {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: 'p1', points: industryPoints},
    ]);
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
        type: 'cash_changed',
        playerId: 'p1',
        delta: staticConfig.incomeTrack.maxIncomeLevel + 1,
        reason: 'income',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'cash_changed',
        playerId: 'p1',
        delta: Math.floor(staticConfig.industryTileSpecs['pottery-5-1'].cost.cash / 2) + 1,
        reason: 'negative income liquidation',
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
        type: 'victory_points_changed',
        playerId: 'p1',
        delta: staticConfig.incomeTrack.maxIncomeLevel + 1,
        reason: 'introductory income scoring',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'victory_points_changed',
        playerId: 'p1',
        delta: 16,
        reason: 'introductory money scoring',
      } as unknown as GameState['eventLog'][number],
      {
        type: 'victory_points_changed',
        playerId: 'p1',
        delta: staticConfig.industryTileSpecs['pottery-5-1'].flip.victoryPoints,
        reason: 'introductory industry scoring',
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
      type: 'resource_consumed',
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'},
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(view.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'oxford-0',
      bonus: {type: 'income_spaces', spaces: 2},
    });
    expect(view.eventLog.filter((event) => event.type === 'resource_consumed')).toHaveLength(4);
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

  it('allows browser cross-origin requests from local and LAN dev clients', async () => {
    const testServer = await startTestServer();
    try {
      const origins = [
        'http://127.0.0.1:5173',
        'http://192.168.1.42:5173',
        'http://[::1]:5173',
      ];

      for (const origin of origins) {
        const listResponse = await fetch(`${testServer.url}/api/games`, {
          headers: {origin},
        });
        expect(listResponse.status).toBe(200);
        expect(listResponse.headers.get('access-control-allow-origin')).toBe(origin);
        expect(listResponse.headers.get('access-control-allow-credentials')).toBe('true');
        expect(listResponse.headers.get('vary')).toContain('Origin');

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
      }

      const defaultHeaderPreflight = await fetch(`${testServer.url}/api/games`, {
        method: 'OPTIONS',
        headers: {
          origin: origins[1],
          'access-control-request-method': 'POST',
        },
      });
      const allowedHeaders = defaultHeaderPreflight.headers.get('access-control-allow-headers') ?? '';
      expect(defaultHeaderPreflight.status).toBe(204);
      expect(allowedHeaders).toContain('content-type');
      expect(allowedHeaders).toContain('x-player-id');
      expect(allowedHeaders).toContain('x-player-token');

      const socket = await connectSocket(testServer.url, origins[1]);
      try {
        const listResponse = await emitWithAck(socket, 'games:list:get', {}) as {games: unknown[]};
        expect(listResponse.games).toEqual([]);
      } finally {
        socket.disconnect();
      }
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
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
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

  it('orders public HTTP and Socket.IO game lists by latest game activity', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      firstGame.createdAt = '2026-01-01T00:00:00.000Z';
      firstGame.updatedAt = '2026-01-01T00:00:00.000Z';
      secondGame.createdAt = '2026-01-01T00:00:01.000Z';
      secondGame.updatedAt = '2026-01-01T00:00:01.000Z';

      const initialHttpResponse = await fetch(`${testServer.url}/api/games`);
      expect(initialHttpResponse.status).toBe(200);
      const initialHttpList = await initialHttpResponse.json() as {games: Array<Record<string, unknown>>};
      expect(initialHttpList.games.map((summary) => summary.id)).toEqual([secondGame.id, firstGame.id]);
      expect(initialHttpList.games.every((summary) => !('eventLog' in summary))).toBe(true);

      socket = await connectSocket(testServer.url);
      const socketList = await emitWithAck(socket, 'games:list:get', {}) as {games: Array<Record<string, unknown>>};
      expect(socketList.games.map((summary) => summary.id)).toEqual([secondGame.id, firstGame.id]);

      const session = testServer.store.getPlayerSession(firstGame.id, 'p1');
      const cardId = firstGame.players.p1.handCardIds[0];
      const commandResponse = await fetch(`${testServer.url}/api/games/${firstGame.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id': 'p1',
          'x-player-token': session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId}),
      });
      expect(commandResponse.status).toBe(200);

      const activeHttpResponse = await fetch(`${testServer.url}/api/games`);
      expect(activeHttpResponse.status).toBe(200);
      const activeHttpList = await activeHttpResponse.json() as {games: Array<Record<string, unknown>>};
      expect(activeHttpList.games.map((summary) => summary.id)).toEqual([firstGame.id, secondGame.id]);
    } finally {
      socket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('creates deterministic seeded rooms through HTTP without sharing room ids or session tokens', async () => {
    const testServer = await startTestServer();
    try {
      const createSeededGame = async (seed: number) => {
        const response = await fetch(`${testServer.url}/api/games`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({playerNames: ['Ada', 'Ben', 'Cara'], seed}),
        });
        expect(response.status).toBe(201);
        return await response.json() as {game: GameState; sessions: PlayerSession[]};
      };
      const first = await createSeededGame(42);
      const repeated = await createSeededGame(42);
      const differentSeed = await createSeededGame(43);
      const firstStored = testServer.store.get(first.game.id);
      const repeatedStored = testServer.store.get(repeated.game.id);
      const differentStored = testServer.store.get(differentSeed.game.id);
      if (!firstStored || !repeatedStored || !differentStored) {
        throw new Error('Expected created games to be stored');
      }

      expect(first.game.id).not.toBe(repeated.game.id);
      expect(first.game.id).not.toBe(differentSeed.game.id);
      expect(first.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(repeated.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(new Set([
        ...first.sessions.map((session) => session.token),
        ...repeated.sessions.map((session) => session.token),
        ...differentSeed.sessions.map((session) => session.token),
      ]).size).toBe(9);
      expectNoSessionTokens(first.game, first.sessions);
      expectNoSessionTokens(repeated.game, repeated.sessions);
      expectNoSessionTokens(differentSeed.game, differentSeed.sessions);

      expect(deterministicSetupSnapshot(repeatedStored)).toEqual(deterministicSetupSnapshot(firstStored));
      expect(deterministicSetupSnapshot(differentStored)).not.toEqual(deterministicSetupSnapshot(firstStored));
      expect(first.game.players.p1.handCardIds).toEqual(firstStored.players.p1.handCardIds);
      expect(first.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(first.game.players.p3.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(first.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(JSON.stringify(first.game)).not.toContain(firstStored.players.p2.handCardIds[0]);
      expect(JSON.stringify(first.game)).not.toContain(firstStored.players.p3.handCardIds[0]);
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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

  it('serves ended public game lists through Socket.IO without active-turn details', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const sessions = testServer.store.getPlayerSessions(game.id);
      const privateCardId = game.players.p1.handCardIds[0];
      game.status = 'ended';
      game.players.p1.victoryPoints = 20;
      game.players.p2.victoryPoints = 9;
      game.eventLog.push({type: 'game_ended', winners: ['p1']});
      game.pendingDecision = {
        type: 'negative_income',
        playerId: 'p2',
        amountOwed: 7,
        incomePlayerIndex: 1,
      };

      lobbySocket = await connectSocket(testServer.url);
      playerSocket = await connectSocket(testServer.url);

      const listResponse = await emitWithAck(lobbySocket, 'games:list:get', {}) as {games: Array<Record<string, unknown>>};
      expect(listResponse.games).toEqual([{
        id: game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'ended',
        connectedClientCount: 0,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 20, p2: 9},
      }]);
      expect(listResponse.games[0]).not.toHaveProperty('currentPlayerId');
      expect(listResponse.games[0]).not.toHaveProperty('pendingDecision');
      expect(listResponse.games[0]).not.toHaveProperty('eventLog');
      expectNoSessionTokens(listResponse, sessions);
      expect(JSON.stringify(listResponse)).not.toContain(privateCardId);

      const joinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
      );
      const joinResponse = await emitWithAck(playerSocket, 'game:join', {gameId: game.id}) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      const joinBroadcast = await joinList as {games: Array<Record<string, unknown>>};
      expect(joinBroadcast.games).toEqual([{
        id: game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'ended',
        connectedClientCount: 1,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 20, p2: 9},
      }]);
      expect(joinBroadcast.games[0]).not.toHaveProperty('currentPlayerId');
      expect(joinBroadcast.games[0]).not.toHaveProperty('pendingDecision');
      expect(joinBroadcast.games[0]).not.toHaveProperty('eventLog');
      expectNoSessionTokens(joinBroadcast, sessions);
      expect(JSON.stringify(joinBroadcast)).not.toContain(privateCardId);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('normalizes dirty runtime metadata in Socket.IO public game lists', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const storedGameId = game.id;
      const sessions = testServer.store.getPlayerSessions(storedGameId);
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

      socket = await connectSocket(testServer.url);
      const listResponse = await emitWithAck(socket, 'games:list:get', {}) as {
        games: Array<Record<string, unknown>>;
      };

      expect(listResponse.games).toEqual([expect.objectContaining({
        id: storedGameId,
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'rail',
        status: 'playing',
        connectedClientCount: 0,
        currentPlayerId: 'p1',
        pendingDecision: {type: 'negative_income', playerId: 'p1'},
      })]);
      expect(listResponse.games[0]).not.toHaveProperty('variant');
      expect(JSON.stringify(listResponse)).not.toContain('secret-game-id');
      expectNoSessionTokens(listResponse, sessions);
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
      expect(initialList.games[0]).not.toHaveProperty('connectedPlayerIds');
      expectNoSessionTokens(initialList, sessions);

      const p1Session = sessions.find((session) => session.playerId === 'p1');
      const joinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        ) === true,
      );
      const joinResponse = await emitWithAck(playerSocket, 'game:join', {
        gameId: game.id,
        playerId: 'p1',
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      const joinedSummary = await joinList as {games: Array<Record<string, unknown>>};
      expect(joinedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
        connectedPlayerIds: ['p1'],
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
      expect(leftSummary.games[0]).not.toHaveProperty('connectedPlayerIds');

      const p2Session = sessions.find((session) => session.playerId === 'p2');
      const rejoinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p2']),
        ) === true,
      );
      const rejoinResponse = await emitWithAck(playerSocket, 'game:join', {
        gameId: game.id,
        playerId: 'p2',
        sessionToken: p2Session?.token,
      }) as {ok: boolean};
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
      expect(disconnectedSummary.games[0]).not.toHaveProperty('connectedPlayerIds');
      expectNoSessionTokens(disconnectedSummary, sessions);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('updates public connected player seats when one socket changes view within the same game', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const sessions = testServer.store.getPlayerSessions(game.id);
      const p1Session = sessions.find((session) => session.playerId === 'p1');
      const p2Session = sessions.find((session) => session.playerId === 'p2');

      lobbySocket = await connectSocket(testServer.url);
      playerSocket = await connectSocket(testServer.url);

      const p1List = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        ) === true,
      );
      const p1Join = await emitWithAck(playerSocket, 'game:join', {
        gameId: game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(p1Join.ok).toBe(true);
      const p1Summary = await p1List as {games: Array<Record<string, unknown>>};
      expect(p1Summary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
        connectedPlayerIds: ['p1'],
      })]);
      expectNoSessionTokens(p1Summary, sessions);

      const observerList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          !Object.prototype.hasOwnProperty.call(summary, 'connectedPlayerIds'),
        ) === true,
      );
      const observerJoin = await emitWithAck(playerSocket, 'game:join', {gameId: game.id}) as {
        ok: boolean;
        session?: PlayerSession;
      };
      expect(observerJoin.ok).toBe(true);
      expect(observerJoin.session).toBeUndefined();
      const observerSummary = await observerList as {games: Array<Record<string, unknown>>};
      expect(observerSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
      })]);
      expect(observerSummary.games[0]).not.toHaveProperty('connectedPlayerIds');
      expect(testServer.io.sockets.sockets.get(playerSocket.id as string)?.data.playerId).toBeUndefined();
      expectNoSessionTokens(observerSummary, sessions);

      const p2List = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p2']),
        ) === true,
      );
      const p2Join = await emitWithAck(playerSocket, 'game:join', {
        gameId: game.id,
        playerId: p2Session?.playerId,
        sessionToken: p2Session?.token,
      }) as {ok: boolean};
      expect(p2Join.ok).toBe(true);
      const p2Summary = await p2List as {games: Array<Record<string, unknown>>};
      expect(p2Summary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
        connectedPlayerIds: ['p2'],
      })]);
      expect(testServer.io.sockets.sockets.get(playerSocket.id as string)?.data.playerId).toBe('p2');
      expectNoSessionTokens(p2Summary, sessions);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('keeps a player seat online while another socket for the same seat remains connected', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let firstPlayerSocket: Socket | undefined;
    let secondPlayerSocket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const sessions = testServer.store.getPlayerSessions(game.id);
      const p1Session = sessions.find((session) => session.playerId === 'p1');

      lobbySocket = await connectSocket(testServer.url);
      firstPlayerSocket = await connectSocket(testServer.url);
      secondPlayerSocket = await connectSocket(testServer.url);

      const firstJoinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        ) === true,
      );
      const firstJoin = await emitWithAck(firstPlayerSocket, 'game:join', {
        gameId: game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      await firstJoinList;

      const secondJoinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 2 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        ) === true,
      );
      const secondJoin = await emitWithAck(secondPlayerSocket, 'game:join', {
        gameId: game.id,
        playerId: p1Session?.playerId,
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(secondJoin.ok).toBe(true);
      const bothConnectedSummary = await secondJoinList as {games: Array<Record<string, unknown>>};
      expect(bothConnectedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 2,
        connectedPlayerIds: ['p1'],
      })]);
      expectNoSessionTokens(bothConnectedSummary, sessions);

      const firstDisconnectList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        ) === true,
      );
      firstPlayerSocket.disconnect();
      firstPlayerSocket = undefined;
      const oneConnectedSummary = await firstDisconnectList as {games: Array<Record<string, unknown>>};
      expect(oneConnectedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
        connectedPlayerIds: ['p1'],
      })]);
      expectNoSessionTokens(oneConnectedSummary, sessions);

      const secondDisconnectList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 0 &&
          !Object.prototype.hasOwnProperty.call(summary, 'connectedPlayerIds'),
        ) === true,
      );
      secondPlayerSocket.disconnect();
      secondPlayerSocket = undefined;
      const disconnectedSummary = await secondDisconnectList as {games: Array<Record<string, unknown>>};
      expect(disconnectedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 0,
      })]);
      expect(disconnectedSummary.games[0]).not.toHaveProperty('connectedPlayerIds');
      expectNoSessionTokens(disconnectedSummary, sessions);
    } finally {
      lobbySocket?.disconnect();
      firstPlayerSocket?.disconnect();
      secondPlayerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('updates public connected counts when a socket moves between game rooms', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      const sessions = [
        ...testServer.store.getPlayerSessions(firstGame.id),
        ...testServer.store.getPlayerSessions(secondGame.id),
      ];
      const connectedCount = (payload: {games?: unknown[]}, gameId: string): unknown => {
        const summary = payload.games?.find((candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          (candidate as {id?: unknown}).id === gameId,
        ) as ({connectedClientCount?: unknown} | undefined);
        return summary?.connectedClientCount;
      };

      lobbySocket = await connectSocket(testServer.url);
      playerSocket = await connectSocket(testServer.url);

      const firstJoinList = waitForGameList(lobbySocket, (payload) =>
        connectedCount(payload, firstGame.id) === 1 &&
        connectedCount(payload, secondGame.id) === 0,
      );
      const firstJoin = await emitWithAck(playerSocket, 'game:join', {gameId: firstGame.id}) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      const firstSummary = await firstJoinList as {games: Array<Record<string, unknown>>};
      expect(firstSummary.games).toEqual(expect.arrayContaining([
        expect.objectContaining({id: firstGame.id, connectedClientCount: 1}),
        expect.objectContaining({id: secondGame.id, connectedClientCount: 0}),
      ]));
      expectNoSessionTokens(firstSummary, sessions);

      const secondJoinList = waitForGameList(lobbySocket, (payload) =>
        connectedCount(payload, firstGame.id) === 0 &&
        connectedCount(payload, secondGame.id) === 1,
      );
      const secondJoin = await emitWithAck(playerSocket, 'game:join', {gameId: secondGame.id}) as {ok: boolean};
      expect(secondJoin.ok).toBe(true);
      const secondSummary = await secondJoinList as {games: Array<Record<string, unknown>>};
      expect(secondSummary.games).toEqual(expect.arrayContaining([
        expect.objectContaining({id: firstGame.id, connectedClientCount: 0}),
        expect.objectContaining({id: secondGame.id, connectedClientCount: 1}),
      ]));
      expectNoSessionTokens(secondSummary, sessions);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('updates public connected summaries when a joined socket creates another game', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let playerSocket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const firstSessions = testServer.store.getPlayerSessions(firstGame.id);
      const p2Session = firstSessions.find((session) => session.playerId === 'p2');

      lobbySocket = await connectSocket(testServer.url);
      playerSocket = await connectSocket(testServer.url);

      const firstJoinList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === firstGame.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p2']),
        ) === true,
      );
      const firstJoin = await emitWithAck(playerSocket, 'game:join', {
        gameId: firstGame.id,
        playerId: p2Session?.playerId,
        sessionToken: p2Session?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      await firstJoinList;

      const createList = waitForGameList(lobbySocket, (payload) => {
        const firstSummary = payload.games?.find((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === firstGame.id,
        ) as ({connectedClientCount?: unknown; connectedPlayerIds?: unknown} | undefined);
        const createdSummary = payload.games?.find((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id !== firstGame.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify(['p1']),
        );
        return firstSummary?.connectedClientCount === 0 &&
          !Object.prototype.hasOwnProperty.call(firstSummary, 'connectedPlayerIds') &&
          createdSummary !== undefined;
      });
      const createResponse = await emitWithAck(playerSocket, 'game:create', {
        playerNames: ['Cara', 'Dan'],
        seed: 7,
      }) as {
        ok: boolean;
        game: {id: string};
        session: PlayerSession;
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      expect(createResponse.session).toEqual(createResponse.sessions[0]);
      const createdSummary = await createList as {games: Array<Record<string, unknown>>};

      expect(createdSummary.games).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: firstGame.id,
          connectedClientCount: 0,
        }),
        expect.objectContaining({
          id: createResponse.game.id,
          connectedClientCount: 1,
          connectedPlayerIds: ['p1'],
        }),
      ]));
      const firstSummary = createdSummary.games.find((summary) => summary.id === firstGame.id);
      expect(firstSummary).not.toHaveProperty('connectedPlayerIds');
      expectNoSessionTokens(createdSummary, [...firstSessions, ...createResponse.sessions]);
    } finally {
      lobbySocket?.disconnect();
      playerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });

  it('updates public connected seats when an observing socket runs a valid command', async () => {
    const testServer = await startTestServer();
    let lobbySocket: Socket | undefined;
    let commandSocket: Socket | undefined;
    try {
      const game = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const sessions = testServer.store.getPlayerSessions(game.id);
      const activePlayerId = game.turnOrder[game.currentTurnIndex];
      const session = sessions.find((candidate) => candidate.playerId === activePlayerId);
      const cardId = activePlayerId ? game.players[activePlayerId]?.handCardIds[0] : undefined;
      if (!activePlayerId || !session || !cardId) {
        throw new Error('Expected active player session and card');
      }

      lobbySocket = await connectSocket(testServer.url);
      commandSocket = await connectSocket(testServer.url);

      const observerList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          !Object.prototype.hasOwnProperty.call(summary, 'connectedPlayerIds'),
        ) === true,
      );
      const observerJoin = await emitWithAck(commandSocket, 'game:join', {gameId: game.id}) as {
        ok: boolean;
        session?: PlayerSession;
        game: {players: Record<string, {handCardIds: string[]}>};
      };
      expect(observerJoin.ok).toBe(true);
      expect(observerJoin.session).toBeUndefined();
      expect(observerJoin.game.players[activePlayerId].handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      const observerSummary = await observerList as {games: Array<Record<string, unknown>>};
      expect(observerSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
      })]);
      expect(observerSummary.games[0]).not.toHaveProperty('connectedPlayerIds');
      expectNoSessionTokens(observerSummary, sessions);

      const commandList = waitForGameList(lobbySocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === game.id &&
          (summary as {connectedClientCount?: unknown}).connectedClientCount === 1 &&
          JSON.stringify((summary as {connectedPlayerIds?: unknown}).connectedPlayerIds) === JSON.stringify([activePlayerId]),
        ) === true,
      );
      const commandBroadcast = waitForGameState(commandSocket, (state) => state.currentTurnIndex !== game.currentTurnIndex);
      const commandResponse = await emitWithAck(commandSocket, 'game:command', {
        gameId: game.id,
        command: {type: 'pass', playerId: activePlayerId, cardId},
        sessionToken: session.token,
      }) as {ok: boolean; game: {players: Record<string, {handCardIds: string[]}>}};
      expect(commandResponse.ok).toBe(true);
      expect(commandResponse.game.players[activePlayerId].handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expectNoSessionTokens(commandResponse, sessions);

      const connectedSummary = await commandList as {games: Array<Record<string, unknown>>};
      expect(connectedSummary.games).toEqual([expect.objectContaining({
        id: game.id,
        connectedClientCount: 1,
        connectedPlayerIds: [activePlayerId],
      })]);
      expectNoSessionTokens(connectedSummary, sessions);
      const broadcast = await commandBroadcast as {players: Record<string, {handCardIds: string[]}>};
      expect(broadcast.players[activePlayerId].handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expectNoSessionTokens(broadcast, sessions);
      expect(testServer.io.sockets.sockets.get(commandSocket.id as string)?.data.playerId).toBe(activePlayerId);
    } finally {
      lobbySocket?.disconnect();
      commandSocket?.disconnect();
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', false);
      setMerchantSpace(storedGame, 'gloucester-1', 'gloucester-manufacturer-0', false);
      storedGame.eventLog.push(
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-0', bonus: {type: 'develop', count: 1}},
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-1', bonus: {type: 'develop', count: 1}},
      );

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: unknown[]};
      expect(listBody.games).toEqual([{
        id: created.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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

  it('serves the public face-audit checklist through HTTP without private game data', async () => {
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
      storedGame.players.p1.name = 'Face Audit Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-secret-reason',
      });

      const auditResponse = await fetch(`${testServer.url}/api/face-audit-checklist`);

      expect(auditResponse.status).toBe(200);
      const auditBody = await auditResponse.json() as {faceAudit: ReturnType<typeof buildFaceAuditChecklistExport>};
      const expectedFaceAudit = buildFaceAuditChecklistExport();
      expect(Object.keys(auditBody).sort()).toEqual(['faceAudit']);
      expect(auditBody.faceAudit.areas.map((area) => area.area)).toEqual([...FACE_AUDIT_AREAS]);
      expect(auditBody.faceAudit.areas).toEqual(expectedFaceAudit.areas);
      expect(auditBody.faceAudit.items).toEqual(expectedFaceAudit.items);
      expect(auditBody.faceAudit.areas.find((area) => area.area === 'regularCards')?.itemCount)
        .toBe(staticConfig.components.locationAndIndustryCardCount);
      expect(auditBody.faceAudit.areas.find((area) => area.area === 'industryTiles')?.expectedFieldNames)
        .toEqual(expect.arrayContaining(['cost', 'flip', 'resourcesWhenBuilt']));
      expect(auditBody.faceAudit.items.find((item) => item.id === 'kidderminster-worcester')?.expectedFields)
        .toContain('viaFarmBreweryId=southern');
      const serializedAudit = JSON.stringify(auditBody);
      expect(serializedAudit).not.toContain(created.game.id);
      expect(serializedAudit).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedAudit).not.toContain('Face Audit Secret Player');
      expect(serializedAudit).not.toContain('face-audit-secret-reason');

      auditBody.faceAudit.areas[0]?.rulebookPages.push(99);
      auditBody.faceAudit.items[0]?.expectedFields.push('mutated=true');

      const freshAuditResponse = await fetch(`${testServer.url}/api/face-audit-checklist`);
      const freshAuditBody = await freshAuditResponse.json() as {faceAudit: ReturnType<typeof buildFaceAuditChecklistExport>};
      expect(freshAuditBody.faceAudit.areas[0]?.rulebookPages).toEqual(expectedFaceAudit.areas[0]?.rulebookPages);
      expect(freshAuditBody.faceAudit.items[0]?.expectedFields).toEqual(expectedFaceAudit.items[0]?.expectedFields);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves the public face-audit review template through HTTP without private game data', async () => {
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
      storedGame.players.p1.name = 'Face Audit Review Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-review-secret-reason',
      });

      const reviewResponse = await fetch(`${testServer.url}/api/face-audit-review-template`);

      expect(reviewResponse.status).toBe(200);
      const reviewBody = await reviewResponse.json() as {faceAuditReview: ReturnType<typeof buildFaceAuditReviewTemplate>};
      const expectedReview = buildFaceAuditReviewTemplate();
      expect(Object.keys(reviewBody).sort()).toEqual(['faceAuditReview']);
      expect(reviewBody.faceAuditReview).toEqual(expectedReview);
      expect(reviewBody.faceAuditReview.version).toBe(1);
      expect(reviewBody.faceAuditReview.checklistItemCount).toBe(staticConfig.components.industryTilesPerPlayer +
        Object.keys(staticConfig.linkLines).length +
        20 +
        staticConfig.components.merchantTileCount +
        staticConfig.components.locationAndIndustryCardCount +
        staticConfig.components.wildCards.total);
      expect(reviewBody.faceAuditReview.completion).toMatchObject({
        status: 'not_started',
        reviewedItemCount: 0,
        unreviewedItemCount: reviewBody.faceAuditReview.checklistItemCount,
      });
      expect(reviewBody.faceAuditReview.items.find((item) => item.id === 'kidderminster-worcester')).toMatchObject({
        key: 'linkLines:kidderminster-worcester',
        reviewStatus: 'unreviewed',
        reviewer: '',
        reviewedAt: '',
        evidenceRef: '',
        notes: '',
      });
      const serializedReview = JSON.stringify(reviewBody);
      expect(serializedReview).not.toContain(created.game.id);
      expect(serializedReview).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedReview).not.toContain('Face Audit Review Secret Player');
      expect(serializedReview).not.toContain('face-audit-review-secret-reason');

      reviewBody.faceAuditReview.areas[0]?.rulebookPages.push(99);
      reviewBody.faceAuditReview.items[0]!.reviewStatus = 'matches_official_face';
      reviewBody.faceAuditReview.items[0]?.expectedFields.push('mutated=true');

      const freshReviewResponse = await fetch(`${testServer.url}/api/face-audit-review-template`);
      const freshReviewBody = await freshReviewResponse.json() as {faceAuditReview: ReturnType<typeof buildFaceAuditReviewTemplate>};
      expect(freshReviewBody.faceAuditReview.areas[0]?.rulebookPages).toEqual(expectedReview.areas[0]?.rulebookPages);
      expect(freshReviewBody.faceAuditReview.items[0]).toEqual(expectedReview.items[0]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves area-level face-audit review templates through HTTP without private game data', async () => {
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
      storedGame.players.p1.name = 'Area Audit Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'area-audit-secret-reason',
      });

      const reviewResponse = await fetch(`${testServer.url}/api/face-audit-review-template/regularCards`);

      expect(reviewResponse.status).toBe(200);
      const reviewBody = await reviewResponse.json() as {faceAuditAreaReview: ReturnType<typeof buildFaceAuditAreaReviewTemplate>};
      const expectedReview = buildFaceAuditAreaReviewTemplate('regularCards');
      expect(Object.keys(reviewBody).sort()).toEqual(['faceAuditAreaReview']);
      expect(reviewBody.faceAuditAreaReview).toEqual(expectedReview);
      expect(reviewBody.faceAuditAreaReview.artifactType).toBe('face_audit_area_review');
      expect(reviewBody.faceAuditAreaReview.area).toBe('regularCards');
      expect(reviewBody.faceAuditAreaReview.areaItemCount).toBe(staticConfig.components.locationAndIndustryCardCount);
      expect(reviewBody.faceAuditAreaReview.items).toHaveLength(staticConfig.components.locationAndIndustryCardCount);
      expect(reviewBody.faceAuditAreaReview.items.every((item) => item.area === 'regularCards')).toBe(true);
      const serializedReview = JSON.stringify(reviewBody);
      expect(serializedReview).not.toContain(created.game.id);
      expect(serializedReview).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedReview).not.toContain('Area Audit Secret Player');
      expect(serializedReview).not.toContain('area-audit-secret-reason');

      reviewBody.faceAuditAreaReview.areaSummary.rulebookPages.push(99);
      reviewBody.faceAuditAreaReview.items[0]!.reviewStatus = 'matches_official_face';
      reviewBody.faceAuditAreaReview.items[0]?.expectedFields.push('mutated=true');

      const freshReviewResponse = await fetch(`${testServer.url}/api/face-audit-review-template/regularCards`);
      const freshReviewBody = await freshReviewResponse.json() as {faceAuditAreaReview: ReturnType<typeof buildFaceAuditAreaReviewTemplate>};
      expect(freshReviewBody.faceAuditAreaReview.areaSummary.rulebookPages).toEqual(expectedReview.areaSummary.rulebookPages);
      expect(freshReviewBody.faceAuditAreaReview.items[0]).toEqual(expectedReview.items[0]);

      const missingResponse = await fetch(`${testServer.url}/api/face-audit-review-template/secretArea`);
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({errors: ['Face-audit area not found']});
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves face-audit evidence refs and matching review templates through HTTP without private game data', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 13}),
      });
      const created = await createResponse.json() as {game: {id: string}; sessions: PlayerSession[]};
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.players.p1.name = 'Face Audit Match Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-match-secret-reason',
      });

      const evidenceRefResponse = await fetch(`${testServer.url}/api/face-audit-evidence-ref-template`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({sourceId: 'photo-set', area: 'wildCards', mode: 'items'}),
      });
      expect(evidenceRefResponse.status).toBe(200);
      const evidenceRefBody = await evidenceRefResponse.json() as {
        faceAuditEvidenceRefTemplate: ReturnType<typeof buildFaceAuditEvidenceRefTemplate>;
      };
      expect(evidenceRefBody.faceAuditEvidenceRefTemplate).toEqual(
        buildFaceAuditEvidenceRefTemplate('photo-set', 'wildCards', 'items'),
      );

      const invalidEvidenceRefResponse = await fetch(`${testServer.url}/api/face-audit-evidence-ref-template`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({sourceId: 'bad id', area: 'unknown', mode: 'item'}),
      });
      expect(invalidEvidenceRefResponse.status).toBe(422);
      const invalidEvidenceRefBody = await invalidEvidenceRefResponse.json() as {
        faceAuditEvidenceRefTemplateValidation: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidEvidenceRefBody.faceAuditEvidenceRefTemplateValidation).toEqual({
        ok: false,
        issueCount: 3,
        issues: expect.arrayContaining([
          {
            field: 'sourceId',
            message: 'Face-audit evidence ref template source id must match the evidenceRef source id format',
          },
          {
            field: 'area',
            message: 'Face-audit evidence ref template area must be a known face-audit area',
          },
          {
            field: 'mode',
            message: 'Face-audit evidence ref template mode must be area or items',
          },
        ]),
      });

      const sourceArtifact = {
        evidenceSources: [{
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham component photos',
          locator: 'reviewer-photos/official-component-set.zip',
          notes: '',
        }],
      };
      const fullMatchResponse = await fetch(`${testServer.url}/api/face-audit-review-template/match`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact,
          sourceId: 'photo-set',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          mode: 'items',
        }),
      });
      expect(fullMatchResponse.status).toBe(200);
      const fullMatchBody = await fullMatchResponse.json() as {
        faceAuditReview: ReturnType<typeof buildFaceAuditReviewTemplate>;
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(fullMatchBody.faceAuditReviewValidation.ok).toBe(true);
      expect(fullMatchBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(fullMatchBody.faceAuditReview).toEqual(fullMatchBody.faceAuditReviewValidation.review);
      expect(fullMatchBody.faceAuditReview.completion).toMatchObject({
        status: 'ready_to_lock',
        reviewedItemCount: 185,
        matchingItemCount: 185,
        unreviewedItemCount: 0,
      });
      expect(fullMatchBody.faceAuditReview.items.every((item) =>
        item.evidenceRef === `official-component:photo-set#${item.area}:${item.id}`,
      )).toBe(true);

      const mappedSources = FACE_AUDIT_AREAS.map((area) => ({
        ...sourceArtifact.evidenceSources[0],
        id: `${area}-source`,
        label: `${area} official component evidence`,
        locator: `reviewer-photos/${area}.zip`,
      }));
      const mappedSourceIdsByArea = Object.fromEntries(mappedSources.map((source) => [
        source.id.replace(/-source$/, ''),
        source.id,
      ]));
      const sourceIdsTemplateResponse = await fetch(`${testServer.url}/api/face-audit-source-ids-by-area-template`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact: {evidenceSources: mappedSources},
          defaultSourceId: 'regularCards-source',
          sourceIdsByArea: {
            industryTiles: 'industryTiles-source',
            linkLines: 'linkLines-source',
            locationsAndSlots: 'locationsAndSlots-source',
            merchantTiles: 'merchantTiles-source',
            wildCards: 'wildCards-source',
          },
        }),
      });
      expect(sourceIdsTemplateResponse.status).toBe(200);
      const sourceIdsTemplateBody = await sourceIdsTemplateResponse.json() as {
        faceAuditSourceIdsByArea: Record<string, string>;
        faceAuditSourceIdsByAreaTemplateValidation: {
          ok: boolean;
          sourceIdsByArea: Record<string, string>;
          issueCount: number;
          issues: unknown[];
        };
      };
      expect(sourceIdsTemplateBody.faceAuditSourceIdsByArea).toEqual(mappedSourceIdsByArea);
      expect(sourceIdsTemplateBody.faceAuditSourceIdsByAreaTemplateValidation).toEqual({
        ok: true,
        sourceIdsByArea: mappedSourceIdsByArea,
        issueCount: 0,
        issues: [],
      });

      const invalidSourceIdsTemplateResponse = await fetch(`${testServer.url}/api/face-audit-source-ids-by-area-template`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact: {evidenceSources: mappedSources},
          defaultSourceId: 'missing-source',
          sourceIdsByArea: {secretArea: 'regularCards-source'},
        }),
      });
      expect(invalidSourceIdsTemplateResponse.status).toBe(422);
      const invalidSourceIdsTemplateBody = await invalidSourceIdsTemplateResponse.json() as {
        faceAuditSourceIdsByAreaTemplateValidation: {
          ok: boolean;
          sourceIdsByArea?: Record<string, string>;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidSourceIdsTemplateBody.faceAuditSourceIdsByAreaTemplateValidation.ok).toBe(false);
      expect(invalidSourceIdsTemplateBody.faceAuditSourceIdsByAreaTemplateValidation.sourceIdsByArea).toBeUndefined();
      expect(invalidSourceIdsTemplateBody.faceAuditSourceIdsByAreaTemplateValidation.issues).toEqual(expect.arrayContaining([
        {
          field: 'defaultSourceId',
          message: 'Face-audit source ids by area template default source id is not declared in the source artifact: missing-source',
        },
        {
          field: 'sourceIdsByAreaOverrides.secretArea',
          message: 'Face-audit source ids by area template area is not known: secretArea',
        },
      ]));

      const mappedFullMatchResponse = await fetch(`${testServer.url}/api/face-audit-review-template/match`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact: {evidenceSources: mappedSources},
          sourceIdsByArea: sourceIdsTemplateBody.faceAuditSourceIdsByArea,
          sourceId: 'photo-set',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
        }),
      });
      expect(mappedFullMatchResponse.status).toBe(200);
      const mappedFullMatchBody = await mappedFullMatchResponse.json() as {
        faceAuditReview: ReturnType<typeof buildFaceAuditReviewTemplate>;
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(mappedFullMatchBody.faceAuditReviewValidation.ok).toBe(true);
      expect(mappedFullMatchBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(mappedFullMatchBody.faceAuditReview.evidenceSources).toEqual(mappedSources);
      for (const area of FACE_AUDIT_AREAS) {
        expect(mappedFullMatchBody.faceAuditReview.items
          .filter((item) => item.area === area)
          .every((item) => item.evidenceRef === `official-component:${mappedSourceIdsByArea[area]}#${area}`))
          .toBe(true);
      }

      const areaMatchResponse = await fetch(`${testServer.url}/api/face-audit-review-template/regularCards/match`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact,
          sourceId: 'photo-set',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
        }),
      });
      expect(areaMatchResponse.status).toBe(200);
      const areaMatchBody = await areaMatchResponse.json() as {
        faceAuditAreaReview: ReturnType<typeof buildFaceAuditAreaReviewTemplate>;
        faceAuditAreaReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditAreaReviewTemplate>;
        };
      };
      expect(areaMatchBody.faceAuditAreaReviewValidation.ok).toBe(true);
      expect(areaMatchBody.faceAuditAreaReview.area).toBe('regularCards');
      expect(areaMatchBody.faceAuditAreaReview.items).toHaveLength(64);
      expect(areaMatchBody.faceAuditAreaReview.items.every((item) =>
        item.evidenceRef === 'official-component:photo-set#regularCards',
      )).toBe(true);

      const invalidMatchResponse = await fetch(`${testServer.url}/api/face-audit-review-template/match`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          sourceArtifact: {evidenceSources: []},
          sourceId: 'missing-source',
          reviewer: '',
          reviewedAt: 'not-a-date',
          mode: 'item',
        }),
      });
      expect(invalidMatchResponse.status).toBe(422);
      const invalidMatchBody = await invalidMatchResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidMatchBody.faceAuditReviewValidation.ok).toBe(false);
      expect(invalidMatchBody.faceAuditReviewValidation.issues).toEqual(expect.arrayContaining([
        {field: 'reviewer', message: 'Face-audit match template reviewer is required'},
        {field: 'reviewedAt', message: 'Face-audit match template reviewedAt must be a valid review timestamp'},
        {field: 'mode', message: 'Face-audit match template mode must be area or items'},
        {
          field: 'sourceId',
          message: 'Face-audit match template source id is not declared in the source artifact: missing-source',
        },
      ]));

      const serialized = JSON.stringify({
        evidenceRefBody,
        invalidEvidenceRefBody,
        sourceIdsTemplateBody,
        invalidSourceIdsTemplateBody,
        fullMatchBody,
        areaMatchBody,
        invalidMatchBody,
      });
      expect(serialized).not.toContain('Face Audit Match Secret Player');
      expect(serialized).not.toContain('face-audit-match-secret-reason');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('merges submitted face-audit review artifacts through HTTP', async () => {
    const testServer = await startTestServer();
    try {
      const evidenceSources = [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component' as const,
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        notes: '',
      }];
      const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
      const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
      const regularReview = {
        ...regularCards,
        evidenceSources,
        items: regularCards.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const wildReview = {
        ...wildCards,
        evidenceSources,
        items: wildCards.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ben',
          reviewedAt: '2026-07-10T01:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };

      const mergeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/merge`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(mergeResponse.status).toBe(200);
      const mergeBody = await mergeResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(mergeBody.faceAuditReviewValidation.ok).toBe(true);
      expect(mergeBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(mergeBody.faceAuditReviewValidation.review.completion).toMatchObject({
        status: 'in_progress',
        reviewedItemCount: staticConfig.components.locationAndIndustryCardCount + staticConfig.components.wildCards.total,
        unreviewedItemCount: buildFaceAuditReviewTemplate().items.length -
          staticConfig.components.locationAndIndustryCardCount -
          staticConfig.components.wildCards.total,
      });
      expect(mergeBody.faceAuditReviewValidation.review.areas.find((area) =>
        area.area === 'regularCards',
      )?.reviewCounts.matches_official_face).toBe(staticConfig.components.locationAndIndustryCardCount);
      expect(mergeBody.faceAuditReviewValidation.review.areas.find((area) =>
        area.area === 'wildCards',
      )?.reviewCounts.matches_official_face).toBe(staticConfig.components.wildCards.total);

      const statusResponse = await fetch(`${testServer.url}/api/face-audit-review-template/status`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(statusResponse.status).toBe(200);
      const statusBody = await statusResponse.json() as {
        faceAuditReviewStatus: {
          artifactType: string;
          version: number;
          ok: boolean;
          artifactCount: number;
          checklistFingerprint: string;
          reviewFingerprint: string;
          artifactCounts: {
            fullReviewArtifactCount: number;
            areaReviewArtifactCount: number;
            unknownArtifactCount: number;
          };
          completion: {
            status: string;
            reviewedItemCount: number;
            unreviewedItemCount: number;
          };
          areaCompletionCounts: {
            not_started: number;
            in_progress: number;
            ready_to_lock: number;
            has_differences: number;
            needs_better_reference: number;
          };
          evidenceSourceCount: number;
          usedEvidenceSourceCount: number;
          usedEvidenceSourceIds: string[];
          unusedEvidenceSourceCount: number;
          unusedEvidenceSourceIds: string[];
          areaProgress: Array<{
          area: string;
            reviewedItemCount: number;
            matchingItemCount: number;
            unreviewedItemCount: number;
            evidenceRefCount: number;
            areaLevelEvidenceRefCount: number;
            itemSpecificEvidenceRefCount: number;
            itemSpecificEvidenceItemCount: number;
            evidenceSourceIds: string[];
            evidenceRefs: string[];
            reviewers: string[];
            firstReviewedAt: string;
            lastReviewedAt: string;
            differenceItemKeys: string[];
            needsReferenceItemKeys: string[];
            unreviewedItemKeys: string[];
          completionStatus: string;
        }>;
          issues: unknown[];
        };
      };
      expect(statusBody.faceAuditReviewStatus.artifactType).toBe('face_audit_review_status');
      expect(statusBody.faceAuditReviewStatus.version).toBe(1);
      expect(statusBody.faceAuditReviewStatus.ok).toBe(true);
      expect(statusBody.faceAuditReviewStatus.artifactCount).toBe(2);
      expect(statusBody.faceAuditReviewStatus.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
      expect(statusBody.faceAuditReviewStatus.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
      expect(statusBody.faceAuditReviewStatus.artifactCounts).toEqual({
        fullReviewArtifactCount: 0,
        areaReviewArtifactCount: 2,
        unknownArtifactCount: 0,
      });
      expect(statusBody.faceAuditReviewStatus.completion).toMatchObject({
        status: 'in_progress',
        reviewedItemCount: staticConfig.components.locationAndIndustryCardCount + staticConfig.components.wildCards.total,
      });
      expect(statusBody.faceAuditReviewStatus.evidenceSourceCount).toBe(1);
      expect(statusBody.faceAuditReviewStatus.usedEvidenceSourceCount).toBe(1);
      expect(statusBody.faceAuditReviewStatus.usedEvidenceSourceIds).toEqual(['photo-set']);
      expect(statusBody.faceAuditReviewStatus.unusedEvidenceSourceCount).toBe(0);
      expect(statusBody.faceAuditReviewStatus.unusedEvidenceSourceIds).toEqual([]);
      expect(statusBody.faceAuditReviewStatus.areaCompletionCounts).toEqual({
        not_started: 4,
        in_progress: 0,
        ready_to_lock: 2,
        has_differences: 0,
        needs_better_reference: 0,
      });
      expect(statusBody.faceAuditReviewStatus.areaProgress.find((area) =>
        area.area === 'regularCards',
      )).toMatchObject({
        reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
        matchingItemCount: staticConfig.components.locationAndIndustryCardCount,
        unreviewedItemCount: 0,
        evidenceRefCount: 1,
        areaLevelEvidenceRefCount: 1,
        itemSpecificEvidenceRefCount: 0,
        itemSpecificEvidenceItemCount: 0,
        evidenceSourceIds: ['photo-set'],
        evidenceRefs: ['official-component:photo-set#regularCards'],
        reviewers: ['Ada'],
        firstReviewedAt: '2026-07-10T00:00:00.000Z',
        lastReviewedAt: '2026-07-10T00:00:00.000Z',
        differenceItemKeys: [],
        needsReferenceItemKeys: [],
        unreviewedItemKeys: [],
        completionStatus: 'ready_to_lock',
      });
      expect(statusBody.faceAuditReviewStatus.areaProgress.find((area) =>
        area.area === 'industryTiles',
      )).toMatchObject({
        reviewedItemCount: 0,
        unreviewedItemCount: staticConfig.components.industryTilesPerPlayer,
        evidenceRefCount: 0,
        areaLevelEvidenceRefCount: 0,
        itemSpecificEvidenceRefCount: 0,
        itemSpecificEvidenceItemCount: 0,
        evidenceSourceIds: [],
        evidenceRefs: [],
        reviewers: [],
        firstReviewedAt: '',
        lastReviewedAt: '',
        completionStatus: 'not_started',
      });
      expect(statusBody.faceAuditReviewStatus.areaProgress.find((area) =>
        area.area === 'industryTiles',
      )?.unreviewedItemKeys).toHaveLength(staticConfig.components.industryTilesPerPlayer);
      expect(statusBody.faceAuditReviewStatus.issues).toEqual([]);

      const emptyStatusResponse = await fetch(`${testServer.url}/api/face-audit-review-template/status`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: []}),
      });
      expect(emptyStatusResponse.status).toBe(200);
      const emptyStatusBody = await emptyStatusResponse.json() as {
        faceAuditReviewStatus: {
          ok: boolean;
          artifactCount: number;
          evidenceSourceCount: number;
          usedEvidenceSourceCount: number;
          usedEvidenceSourceIds: string[];
          unusedEvidenceSourceCount: number;
          unusedEvidenceSourceIds: string[];
          completion: {
            status: string;
            reviewedItemCount: number;
            unreviewedItemCount: number;
            totalItemCount: number;
          };
          areaCompletionCounts: {
            not_started: number;
            in_progress: number;
            ready_to_lock: number;
            has_differences: number;
            needs_better_reference: number;
          };
          areaProgress: Array<{
            area: string;
            evidenceRefCount: number;
            areaLevelEvidenceRefCount: number;
            itemSpecificEvidenceRefCount: number;
            itemSpecificEvidenceItemCount: number;
            evidenceSourceIds: string[];
            evidenceRefs: string[];
            reviewers: string[];
            firstReviewedAt: string;
            lastReviewedAt: string;
            unreviewedItemKeys: string[];
          }>;
        };
      };
      expect(emptyStatusBody.faceAuditReviewStatus).toMatchObject({
        ok: true,
        artifactCount: 0,
        evidenceSourceCount: 0,
        usedEvidenceSourceCount: 0,
        usedEvidenceSourceIds: [],
        unusedEvidenceSourceCount: 0,
        unusedEvidenceSourceIds: [],
        completion: {
          status: 'not_started',
          reviewedItemCount: 0,
          unreviewedItemCount: buildFaceAuditReviewTemplate().items.length,
          totalItemCount: buildFaceAuditReviewTemplate().items.length,
        },
      });
      expect(emptyStatusBody.faceAuditReviewStatus.areaCompletionCounts).toEqual({
        not_started: 6,
        in_progress: 0,
        ready_to_lock: 0,
        has_differences: 0,
        needs_better_reference: 0,
      });
      expect(emptyStatusBody.faceAuditReviewStatus.areaProgress.find((area) =>
        area.area === 'regularCards',
      )).toMatchObject({
        evidenceRefCount: 0,
        areaLevelEvidenceRefCount: 0,
        itemSpecificEvidenceRefCount: 0,
        itemSpecificEvidenceItemCount: 0,
        evidenceSourceIds: [],
        evidenceRefs: [],
        reviewers: [],
        firstReviewedAt: '',
        lastReviewedAt: '',
      });
      expect(emptyStatusBody.faceAuditReviewStatus.areaProgress.find((area) =>
        area.area === 'regularCards',
      )?.unreviewedItemKeys).toHaveLength(staticConfig.components.locationAndIndustryCardCount);

      const invalidShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/merge`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidShapeResponse.status).toBe(422);
      const invalidShapeBody = await invalidShapeResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidShapeBody.faceAuditReviewValidation.ok).toBe(false);
      expect(invalidShapeBody.faceAuditReviewValidation.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review merge expects a JSON array or an object with an artifacts array',
      }]);

      const invalidStatusShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/status`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidStatusShapeResponse.status).toBe(422);
      const invalidStatusShapeBody = await invalidStatusShapeResponse.json() as {
        faceAuditReviewStatus: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidStatusShapeBody.faceAuditReviewStatus.ok).toBe(false);
      expect(invalidStatusShapeBody.faceAuditReviewStatus.issueCount).toBe(1);
      expect(invalidStatusShapeBody.faceAuditReviewStatus.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review status expects a JSON array or an object with an artifacts array',
      }]);
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves compact face-audit todo handoffs through HTTP without private game data', async () => {
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
      storedGame.players.p1.name = 'Face Audit Todo Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-todo-secret-reason',
      });

      const evidenceSources = [{
        id: 'photo-set',
        label: 'Official component photo set',
        sourceType: 'official_physical_component' as const,
        citation: 'Reviewer-owned official Brass: Birmingham component photos',
        locator: 'reviewer-photos/official-component-set.zip',
        notes: '',
      }];
      const regularCards = buildFaceAuditAreaReviewTemplate('regularCards');
      const wildCards = buildFaceAuditAreaReviewTemplate('wildCards');
      const regularReview = {
        ...regularCards,
        evidenceSources,
        items: regularCards.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const wildReview = {
        ...wildCards,
        evidenceSources,
        items: wildCards.items.map((item, index) => index === 0
          ? {
              ...item,
              reviewStatus: 'needs_better_reference',
              reviewer: 'Ben',
              reviewedAt: '2026-07-10T01:00:00.000Z',
              evidenceRef: `official-component:photo-set#${item.area}:${item.id}`,
              notes: 'Official reference image is too low-resolution to confirm print details.',
            }
          : item),
      };

      const todoResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(todoResponse.status).toBe(200);
      const todoBody = await todoResponse.json() as {
        faceAuditReviewTodo: ReturnType<typeof buildFaceAuditReviewTodo>;
      };
      const expectedTodo = buildFaceAuditReviewTodo([regularReview, wildReview]);
      expect(Object.keys(todoBody).sort()).toEqual(['faceAuditReviewTodo']);
      expect(todoBody.faceAuditReviewTodo).toEqual(expectedTodo);
      expect(todoBody.faceAuditReviewTodo.artifactType).toBe('face_audit_review_todo');
      expect(todoBody.faceAuditReviewTodo.pendingAreaCount).toBe(5);
      expect(todoBody.faceAuditReviewTodo.readyAreaCount).toBe(1);
      expect(todoBody.faceAuditReviewTodo.areas.find((area) => area.area === 'regularCards')).toBeUndefined();
      expect(todoBody.faceAuditReviewTodo.areas.find((area) => area.area === 'wildCards')).toMatchObject({
        completionStatus: 'needs_better_reference',
        nextStep: 'find_better_reference',
        remainingItemCount: staticConfig.components.wildCards.total,
      });
      expect(todoBody.faceAuditReviewTodo.areas.find((area) => area.area === 'wildCards')?.commands)
        .toMatchObject({
          blankTemplate: 'npm run face-audit:area-template -- wildCards',
          areaMatchTemplateWithItemRefs: 'npm run face-audit:area-match-template -- wildCards .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
        });

      const todoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo-summary`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(todoSummaryResponse.status).toBe(200);
      const todoSummaryBody = await todoSummaryResponse.json() as {
        faceAuditReviewTodoSummary: ReturnType<typeof buildFaceAuditReviewTodoSummary>;
      };
      const expectedTodoSummary = buildFaceAuditReviewTodoSummary(expectedTodo);
      expect(Object.keys(todoSummaryBody).sort()).toEqual(['faceAuditReviewTodoSummary']);
      expect(todoSummaryBody.faceAuditReviewTodoSummary).toEqual(expectedTodoSummary);
      expect(todoSummaryBody.faceAuditReviewTodoSummary).toMatchObject({
        artifactType: 'face_audit_review_todo_summary',
        pendingAreaCount: 5,
        readyAreaCount: 1,
        pendingItemCount: 121,
      });
      expect(todoSummaryBody.faceAuditReviewTodoSummary.unfinishedAreas.map((area) => area.area))
        .not.toContain('regularCards');
      expect(todoSummaryBody.faceAuditReviewTodoSummary.unfinishedAreas.find((area) => area.area === 'wildCards'))
        .toMatchObject({
          completionStatus: 'needs_better_reference',
          nextStep: 'find_better_reference',
          remainingItemCount: staticConfig.components.wildCards.total,
        });
      expect(JSON.stringify(todoSummaryBody)).not.toContain('blankTemplate');

      const areaTodoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/todo-summary`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });
      expect(areaTodoSummaryResponse.status).toBe(200);
      const areaTodoSummaryBody = await areaTodoSummaryResponse.json() as {
        faceAuditAreaReviewTodoSummary: ReturnType<typeof buildFaceAuditAreaReviewTodoSummary>;
      };
      const expectedAreaTodoSummary = buildFaceAuditAreaReviewTodoSummary([regularReview, wildReview], 'wildCards');
      expect(Object.keys(areaTodoSummaryBody).sort()).toEqual(['faceAuditAreaReviewTodoSummary']);
      expect(areaTodoSummaryBody.faceAuditAreaReviewTodoSummary).toEqual(expectedAreaTodoSummary);
      expect(areaTodoSummaryBody.faceAuditAreaReviewTodoSummary).toMatchObject({
        artifactType: 'face_audit_area_review_todo_summary',
        area: 'wildCards',
        completionStatus: 'needs_better_reference',
        nextStep: 'find_better_reference',
        pendingItemCount: staticConfig.components.wildCards.total,
        remainingItemCount: staticConfig.components.wildCards.total,
        reviewedItemCount: 1,
        needsReferenceItemCount: 1,
        unreviewedItemCount: staticConfig.components.wildCards.total - 1,
      });
      expect(JSON.stringify(areaTodoSummaryBody)).not.toContain('blankTemplate');

      const publicTodoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo-summary`);
      expect(publicTodoSummaryResponse.status).toBe(200);
      const publicTodoSummaryBody = await publicTodoSummaryResponse.json() as {
        faceAuditReviewTodoSummary: ReturnType<typeof buildFaceAuditReviewTodoSummary>;
      };
      expect(Object.keys(publicTodoSummaryBody).sort()).toEqual(['faceAuditReviewTodoSummary']);
      expect(publicTodoSummaryBody.faceAuditReviewTodoSummary).toEqual(
        buildFaceAuditReviewTodoSummary(buildFaceAuditReviewTodo([])),
      );
      expect(publicTodoSummaryBody.faceAuditReviewTodoSummary).toMatchObject({
        artifactType: 'face_audit_review_todo_summary',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
        pendingItemCount: buildFaceAuditReviewTemplate().items.length,
      });
      expect(publicTodoSummaryBody.faceAuditReviewTodoSummary.unfinishedAreas).toHaveLength(6);

      const publicAreaTodoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/todo-summary`);
      expect(publicAreaTodoSummaryResponse.status).toBe(200);
      const publicAreaTodoSummaryBody = await publicAreaTodoSummaryResponse.json() as {
        faceAuditAreaReviewTodoSummary: ReturnType<typeof buildFaceAuditAreaReviewTodoSummary>;
      };
      expect(Object.keys(publicAreaTodoSummaryBody).sort()).toEqual(['faceAuditAreaReviewTodoSummary']);
      expect(publicAreaTodoSummaryBody.faceAuditAreaReviewTodoSummary).toEqual(
        buildFaceAuditAreaReviewTodoSummary([], 'wildCards'),
      );
      expect(publicAreaTodoSummaryBody.faceAuditAreaReviewTodoSummary).toMatchObject({
        artifactType: 'face_audit_area_review_todo_summary',
        ok: true,
        artifactCount: 0,
        area: 'wildCards',
        itemCount: staticConfig.components.wildCards.total,
        completionStatus: 'not_started',
        nextStep: 'review_unreviewed_items',
        pendingItemCount: staticConfig.components.wildCards.total,
        remainingItemCount: staticConfig.components.wildCards.total,
      });

      const publicStatusResponse = await fetch(`${testServer.url}/api/face-audit-review-template/status`);
      expect(publicStatusResponse.status).toBe(200);
      const publicStatusBody = await publicStatusResponse.json() as {
        faceAuditReviewStatus: ReturnType<typeof summarizeFaceAuditReviewStatus>;
      };
      const expectedPublicReviewStatus = summarizeFaceAuditReviewStatus([]);
      expect(Object.keys(publicStatusBody).sort()).toEqual(['faceAuditReviewStatus']);
      expect(publicStatusBody.faceAuditReviewStatus).toEqual(expectedPublicReviewStatus);
      expect(publicStatusBody.faceAuditReviewStatus).toMatchObject({
        artifactType: 'face_audit_review_status',
        ok: true,
        artifactCount: 0,
        checklistItemCount: buildFaceAuditReviewTemplate().items.length,
        completion: {
          status: 'not_started',
          unreviewedItemCount: buildFaceAuditReviewTemplate().items.length,
        },
      });
      expect(publicStatusBody.faceAuditReviewStatus.areaProgress).toHaveLength(6);

      const publicTodoResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo`);
      expect(publicTodoResponse.status).toBe(200);
      const publicTodoBody = await publicTodoResponse.json() as {
        faceAuditReviewTodo: ReturnType<typeof buildFaceAuditReviewTodo>;
      };
      const expectedPublicTodo = buildFaceAuditReviewTodo([]);
      expect(Object.keys(publicTodoBody).sort()).toEqual(['faceAuditReviewTodo']);
      expect(publicTodoBody.faceAuditReviewTodo).toEqual(expectedPublicTodo);
      expect(publicTodoBody.faceAuditReviewTodo).toMatchObject({
        artifactType: 'face_audit_review_todo',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
      });
      expect(publicTodoBody.faceAuditReviewTodo.areas).toHaveLength(6);

      const publicReviewSheetResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-sheet`);
      const publicReviewSheet = buildFaceAuditReviewSheet([]);
      expect(publicReviewSheetResponse.status).toBe(200);
      expect(publicReviewSheetResponse.headers.get('content-type')).toContain('text/tab-separated-values');
      expect(publicReviewSheetResponse.headers.get('content-disposition'))
        .toBe('attachment; filename="face-audit-review-sheet.tsv"');
      expect(publicReviewSheetResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(publicReviewSheet.checklistFingerprint);
      expect(publicReviewSheetResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(publicReviewSheet.reviewFingerprint);
      expect(publicReviewSheetResponse.headers.get('x-face-audit-row-count')).toBe(String(publicReviewSheet.rowCount));
      expect(await publicReviewSheetResponse.text()).toBe(publicReviewSheet.tsv);

      const publicAreaReviewSheetResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/review-sheet`);
      const publicAreaReviewSheet = buildFaceAuditAreaReviewSheet([], 'wildCards');
      expect(publicAreaReviewSheetResponse.status).toBe(200);
      expect(publicAreaReviewSheetResponse.headers.get('content-type')).toContain('text/tab-separated-values');
      expect(publicAreaReviewSheetResponse.headers.get('content-disposition'))
        .toBe(`attachment; filename="${faceAuditAreaReviewSheetArtifactFileName('wildCards')}"`);
      expect(publicAreaReviewSheetResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(publicAreaReviewSheet.checklistFingerprint);
      expect(publicAreaReviewSheetResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(publicAreaReviewSheet.reviewFingerprint);
      expect(publicAreaReviewSheetResponse.headers.get('x-face-audit-area')).toBe('wildCards');
      expect(publicAreaReviewSheetResponse.headers.get('x-face-audit-row-count')).toBe(String(publicAreaReviewSheet.rowCount));
      expect(publicAreaReviewSheetResponse.headers.get('x-face-audit-area-item-count'))
        .toBe(String(publicAreaReviewSheet.areaItemCount));
      expect(await publicAreaReviewSheetResponse.text()).toBe(publicAreaReviewSheet.tsv);

      const publicReviewPlanResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-plan`);
      expect(publicReviewPlanResponse.status).toBe(200);
      const publicReviewPlanBody = await publicReviewPlanResponse.json() as {
        faceAuditReviewPlan: ReturnType<typeof buildFaceAuditReviewPlan>;
      };
      const expectedPublicReviewPlan = buildFaceAuditReviewPlan([]);
      expect(Object.keys(publicReviewPlanBody).sort()).toEqual(['faceAuditReviewPlan']);
      expect(publicReviewPlanBody.faceAuditReviewPlan).toEqual(expectedPublicReviewPlan);
      expect(publicReviewPlanBody.faceAuditReviewPlan).toMatchObject({
        artifactType: 'face_audit_review_plan',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
        pendingItemCount: buildFaceAuditReviewTemplate().items.length,
      });

      const publicHandoffResponse = await fetch(`${testServer.url}/api/face-audit-review-template/handoff`);
      expect(publicHandoffResponse.status).toBe(200);
      const publicHandoffBody = await publicHandoffResponse.json() as {
        faceAuditReviewerHandoff: ReturnType<typeof buildFaceAuditReviewerHandoff>;
      };
      const expectedPublicHandoff = buildFaceAuditReviewerHandoff([]);
      expect(Object.keys(publicHandoffBody).sort()).toEqual(['faceAuditReviewerHandoff']);
      expect(publicHandoffBody.faceAuditReviewerHandoff).toEqual(expectedPublicHandoff);
      expect(publicHandoffBody.faceAuditReviewerHandoff).toMatchObject({
        artifactType: 'face_audit_reviewer_handoff',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
      });
      expect(publicHandoffBody.faceAuditReviewerHandoff.areas).toHaveLength(6);

      const publicReviewerInstructionsResponse =
        await fetch(`${testServer.url}/api/face-audit-review-template/reviewer-instructions`);
      expect(publicReviewerInstructionsResponse.status).toBe(200);
      expect(publicReviewerInstructionsResponse.headers.get('content-type')).toContain('text/markdown');
      expect(publicReviewerInstructionsResponse.headers.get('content-disposition'))
        .toBe('attachment; filename="face-audit-reviewer-instructions.md"');
      const expectedPublicReviewerInstructions = buildFaceAuditReviewerInstructions({
        status: expectedPublicReviewStatus,
        todo: expectedPublicTodo,
        plan: expectedPublicReviewPlan,
        handoff: expectedPublicHandoff,
        areaFiles: expectedPublicHandoff.areas.map((area) => ({
          area: area.area,
          fileName: faceAuditAreaReviewArtifactFileName(area.area),
        })),
      });
      expect(publicReviewerInstructionsResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedPublicReviewStatus.checklistFingerprint);
      expect(publicReviewerInstructionsResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedPublicReviewStatus.reviewFingerprint);
      const publicReviewerInstructionsText = await publicReviewerInstructionsResponse.text();
      expect(publicReviewerInstructionsText).toBe(`${expectedPublicReviewerInstructions}\n`);
      expect(publicReviewerInstructionsText).toContain('file `face-audit-area-wildCards-review.json`');
      expect(publicReviewerInstructionsText)
        .toContain(`sheet \`${faceAuditAreaReviewSheetArtifactFileName('wildCards')}\``);

      const publicAreaReviewerInstructionsResponse =
        await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/reviewer-instructions`);
      const expectedPublicAreaReviewerInstructions =
        buildFaceAuditAreaReviewerInstructionsReport([], 'wildCards');
      expect(publicAreaReviewerInstructionsResponse.status).toBe(200);
      expect(publicAreaReviewerInstructionsResponse.headers.get('content-type')).toContain('text/markdown');
      expect(publicAreaReviewerInstructionsResponse.headers.get('content-disposition'))
        .toBe(`attachment; filename="${faceAuditAreaReviewerInstructionsArtifactFileName('wildCards')}"`);
      expect(publicAreaReviewerInstructionsResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedPublicAreaReviewerInstructions.checklistFingerprint);
      expect(publicAreaReviewerInstructionsResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedPublicAreaReviewerInstructions.reviewFingerprint);
      expect(publicAreaReviewerInstructionsResponse.headers.get('x-face-audit-area')).toBe('wildCards');
      const publicAreaReviewerInstructionsText = await publicAreaReviewerInstructionsResponse.text();
      expect(publicAreaReviewerInstructionsText).toBe(`${expectedPublicAreaReviewerInstructions.markdown}\n`);
      expect(publicAreaReviewerInstructionsText).toContain('- Completion status: `not_started`');
      expect(publicAreaReviewerInstructionsText)
        .toContain(`- Review sheet: \`${faceAuditAreaReviewSheetArtifactFileName('wildCards')}\``);

      const emptyTodoResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: []}),
      });
      expect(emptyTodoResponse.status).toBe(200);
      const emptyTodoBody = await emptyTodoResponse.json() as {
        faceAuditReviewTodo: ReturnType<typeof buildFaceAuditReviewTodo>;
      };
      expect(emptyTodoBody.faceAuditReviewTodo).toMatchObject({
        artifactType: 'face_audit_review_todo',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
        completion: {
          status: 'not_started',
          reviewedItemCount: 0,
          unreviewedItemCount: buildFaceAuditReviewTemplate().items.length,
        },
      });

      const emptyTodoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo-summary`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: []}),
      });
      expect(emptyTodoSummaryResponse.status).toBe(200);
      const emptyTodoSummaryBody = await emptyTodoSummaryResponse.json() as {
        faceAuditReviewTodoSummary: ReturnType<typeof buildFaceAuditReviewTodoSummary>;
      };
      expect(emptyTodoSummaryBody.faceAuditReviewTodoSummary).toMatchObject({
        artifactType: 'face_audit_review_todo_summary',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
        pendingItemCount: buildFaceAuditReviewTemplate().items.length,
      });
      expect(emptyTodoSummaryBody.faceAuditReviewTodoSummary.unfinishedAreas).toHaveLength(6);

      const invalidTodoShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidTodoShapeResponse.status).toBe(422);
      const invalidTodoShapeBody = await invalidTodoShapeResponse.json() as {
        faceAuditReviewTodo: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidTodoShapeBody.faceAuditReviewTodo.ok).toBe(false);
      expect(invalidTodoShapeBody.faceAuditReviewTodo.issueCount).toBe(1);
      expect(invalidTodoShapeBody.faceAuditReviewTodo.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review todo expects a JSON array or an object with an artifacts array',
      }]);

      const invalidTodoSummaryShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/todo-summary`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidTodoSummaryShapeResponse.status).toBe(422);
      const invalidTodoSummaryShapeBody = await invalidTodoSummaryShapeResponse.json() as {
        faceAuditReviewTodoSummary: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidTodoSummaryShapeBody.faceAuditReviewTodoSummary.ok).toBe(false);
      expect(invalidTodoSummaryShapeBody.faceAuditReviewTodoSummary.issueCount).toBe(1);
      expect(invalidTodoSummaryShapeBody.faceAuditReviewTodoSummary.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review todo summary expects a JSON array or an object with an artifacts array',
      }]);

      const invalidAreaTodoSummaryShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/todo-summary`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidAreaTodoSummaryShapeResponse.status).toBe(422);
      const invalidAreaTodoSummaryShapeBody = await invalidAreaTodoSummaryShapeResponse.json() as {
        faceAuditAreaReviewTodoSummary: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidAreaTodoSummaryShapeBody.faceAuditAreaReviewTodoSummary.ok).toBe(false);
      expect(invalidAreaTodoSummaryShapeBody.faceAuditAreaReviewTodoSummary.issueCount).toBe(1);
      expect(invalidAreaTodoSummaryShapeBody.faceAuditAreaReviewTodoSummary.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit area review todo summary expects a JSON array or an object with an artifacts array',
      }]);

      const invalidAreaTodoSummaryResponse = await fetch(`${testServer.url}/api/face-audit-review-template/unknownArea/todo-summary`);
      expect(invalidAreaTodoSummaryResponse.status).toBe(404);
      expect(await invalidAreaTodoSummaryResponse.json()).toEqual({errors: ['Face-audit area not found']});

      const publicInvalidAreaReviewSheetResponse =
        await fetch(`${testServer.url}/api/face-audit-review-template/unknownArea/review-sheet`);
      expect(publicInvalidAreaReviewSheetResponse.status).toBe(404);
      expect(await publicInvalidAreaReviewSheetResponse.json()).toEqual({errors: ['Face-audit area not found']});

      const publicInvalidAreaReviewerInstructionsResponse =
        await fetch(`${testServer.url}/api/face-audit-review-template/unknownArea/reviewer-instructions`);
      expect(publicInvalidAreaReviewerInstructionsResponse.status).toBe(404);
      expect(await publicInvalidAreaReviewerInstructionsResponse.json()).toEqual({errors: ['Face-audit area not found']});

      const reviewPlanResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-plan`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(reviewPlanResponse.status).toBe(200);
      const reviewPlanBody = await reviewPlanResponse.json() as {
        faceAuditReviewPlan: ReturnType<typeof buildFaceAuditReviewPlan>;
      };
      const expectedReviewPlan = buildFaceAuditReviewPlan([regularReview, wildReview]);
      expect(Object.keys(reviewPlanBody).sort()).toEqual(['faceAuditReviewPlan']);
      expect(reviewPlanBody.faceAuditReviewPlan).toEqual(expectedReviewPlan);
      expect(reviewPlanBody.faceAuditReviewPlan.artifactType).toBe('face_audit_review_plan');
      expect(reviewPlanBody.faceAuditReviewPlan.pendingAreaCount).toBe(5);
      expect(reviewPlanBody.faceAuditReviewPlan.readyAreaCount).toBe(1);
      expect(reviewPlanBody.faceAuditReviewPlan.pendingItemCount).toBe(121);
      expect(reviewPlanBody.faceAuditReviewPlan.areas.find((area) => area.area === 'regularCards')).toBeUndefined();
      const wildPlan = reviewPlanBody.faceAuditReviewPlan.areas.find((area) => area.area === 'wildCards');
      expect(wildPlan?.items).toHaveLength(staticConfig.components.wildCards.total);
      expect(wildPlan?.items[0]).toMatchObject({
        key: wildCards.items[0]!.key,
        reviewStatus: 'needs_better_reference',
        nextStep: 'find_better_reference',
        evidenceRef: `official-component:photo-set#wildCards:${wildCards.items[0]!.id}`,
      });
      expect(wildPlan?.items.slice(1).every((item) => item.nextStep === 'review_unreviewed_items')).toBe(true);

      const invalidReviewPlanShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-plan`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidReviewPlanShapeResponse.status).toBe(422);
      const invalidReviewPlanShapeBody = await invalidReviewPlanShapeResponse.json() as {
        faceAuditReviewPlan: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidReviewPlanShapeBody.faceAuditReviewPlan.ok).toBe(false);
      expect(invalidReviewPlanShapeBody.faceAuditReviewPlan.issueCount).toBe(1);
      expect(invalidReviewPlanShapeBody.faceAuditReviewPlan.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review plan expects a JSON array or an object with an artifacts array',
      }]);

      const reviewSheetResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(reviewSheetResponse.status).toBe(200);
      expect(reviewSheetResponse.headers.get('content-type')).toContain('text/tab-separated-values');
      expect(reviewSheetResponse.headers.get('content-disposition'))
        .toBe('attachment; filename="face-audit-review-sheet.tsv"');
      const expectedReviewSheet = buildFaceAuditReviewSheet([regularReview, wildReview]);
      expect(reviewSheetResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedReviewSheet.checklistFingerprint);
      expect(reviewSheetResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedReviewSheet.reviewFingerprint);
      expect(reviewSheetResponse.headers.get('x-face-audit-row-count')).toBe(String(expectedReviewSheet.rowCount));
      const reviewSheetText = await reviewSheetResponse.text();
      const reviewSheetLines = reviewSheetText.trimEnd().split('\n');
      const firstRegularCardRow = reviewSheetLines.find((line) => line.includes(`\t${regularCards.items[0]!.key}\t`));
      const firstWildCardRow = reviewSheetLines.find((line) => line.includes(`\t${wildCards.items[0]!.key}\t`));
      expect(reviewSheetText).toBe(expectedReviewSheet.tsv);
      expect(reviewSheetLines).toHaveLength(buildFaceAuditReviewTemplate().items.length + 1);
      expect(reviewSheetLines[0])
        .toBe('area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes');
      expect(firstRegularCardRow?.split('\t')).toEqual([
        'regularCards',
        regularCards.items[0]!.id,
        regularCards.items[0]!.key,
        regularCards.items[0]!.label,
        regularCards.items[0]!.expectedFields.join('; '),
        'matches_official_face',
        '',
        'Ada',
        '2026-07-10T00:00:00.000Z',
        'official-component:photo-set#regularCards',
        '',
      ]);
      expect(firstWildCardRow?.split('\t')[6]).toBe('find_better_reference');

      const areaReviewSheetResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });
      expect(areaReviewSheetResponse.status).toBe(200);
      expect(areaReviewSheetResponse.headers.get('content-type')).toContain('text/tab-separated-values');
      expect(areaReviewSheetResponse.headers.get('content-disposition'))
        .toBe('attachment; filename="face-audit-area-wildCards-review-sheet.tsv"');
      const expectedAreaReviewSheet = buildFaceAuditAreaReviewSheet([regularReview, wildReview], 'wildCards');
      expect(areaReviewSheetResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedAreaReviewSheet.checklistFingerprint);
      expect(areaReviewSheetResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedAreaReviewSheet.reviewFingerprint);
      expect(areaReviewSheetResponse.headers.get('x-face-audit-area')).toBe('wildCards');
      expect(areaReviewSheetResponse.headers.get('x-face-audit-row-count')).toBe(String(expectedAreaReviewSheet.rowCount));
      expect(areaReviewSheetResponse.headers.get('x-face-audit-area-item-count'))
        .toBe(String(expectedAreaReviewSheet.areaItemCount));
      const areaReviewSheetText = await areaReviewSheetResponse.text();
      const areaReviewSheetLines = areaReviewSheetText.trimEnd().split('\n');
      expect(areaReviewSheetText).toBe(expectedAreaReviewSheet.tsv);
      expect(areaReviewSheetLines).toHaveLength(staticConfig.components.wildCards.total + 1);
      expect(areaReviewSheetLines.slice(1).every((line) => line.startsWith('wildCards\t'))).toBe(true);

      const invalidAreaReviewSheetShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidAreaReviewSheetShapeResponse.status).toBe(422);
      expect(invalidAreaReviewSheetShapeResponse.headers.get('content-type')).toContain('application/json');
      const invalidAreaReviewSheetShapeBody = await invalidAreaReviewSheetShapeResponse.json() as {
        faceAuditAreaReviewSheet: {
          ok: boolean;
          rowCount: number;
          tsv: string;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidAreaReviewSheetShapeBody.faceAuditAreaReviewSheet.ok).toBe(false);
      expect(invalidAreaReviewSheetShapeBody.faceAuditAreaReviewSheet.rowCount).toBe(0);
      expect(invalidAreaReviewSheetShapeBody.faceAuditAreaReviewSheet.tsv).toBe('');
      expect(invalidAreaReviewSheetShapeBody.faceAuditAreaReviewSheet.issueCount).toBe(1);
      expect(invalidAreaReviewSheetShapeBody.faceAuditAreaReviewSheet.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit area review sheet expects a JSON array or an object with an artifacts array',
      }]);

      const invalidAreaReviewSheetResponse = await fetch(`${testServer.url}/api/face-audit-review-template/unknownArea/review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview]}),
      });
      expect(invalidAreaReviewSheetResponse.status).toBe(404);
      expect(await invalidAreaReviewSheetResponse.json()).toEqual({errors: ['Face-audit area not found']});

      const importedReviewSheetLines = reviewSheetText.endsWith('\n')
        ? reviewSheetText.slice(0, -1).split('\n')
        : reviewSheetText.split('\n');
      const importedIndustryRowIndex = importedReviewSheetLines.findIndex((line) =>
        line.includes('\tindustryTiles:brewery-1-1\t'));
      if (importedIndustryRowIndex < 1) {
        throw new Error('Missing industryTiles TSV row');
      }
      const importedIndustryCells = importedReviewSheetLines[importedIndustryRowIndex]!.split('\t');
      importedIndustryCells[5] = 'matches_official_face';
      importedIndustryCells[6] = '';
      importedIndustryCells[7] = 'Ada';
      importedIndustryCells[8] = '2026-07-10T02:00:00.000Z';
      importedIndustryCells[9] = 'official-component:photo-set#industryTiles:brewery-1-1';
      importedReviewSheetLines[importedIndustryRowIndex] = importedIndustryCells.join('\t');
      const importedReviewSheetText = `${importedReviewSheetLines.join('\n')}\n`;
      const expectedReviewSheetImport = applyFaceAuditReviewSheet([regularReview, wildReview], importedReviewSheetText);
      const reviewSheetImportResponse = await fetch(`${testServer.url}/api/face-audit-review-template/apply-review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          artifacts: [regularReview, wildReview],
          reviewSheetTsv: importedReviewSheetText,
        }),
      });
      expect(reviewSheetImportResponse.status).toBe(200);
      const reviewSheetImportBody = await reviewSheetImportResponse.json() as {
        faceAuditReview: ReturnType<typeof applyFaceAuditReviewSheet>['review'];
        faceAuditReviewSheetImport: ReturnType<typeof applyFaceAuditReviewSheet>;
      };
      expect(Object.keys(reviewSheetImportBody).sort()).toEqual(['faceAuditReview', 'faceAuditReviewSheetImport']);
      expect(reviewSheetImportBody.faceAuditReviewSheetImport).toEqual(expectedReviewSheetImport);
      expect(reviewSheetImportBody.faceAuditReview).toEqual(expectedReviewSheetImport.review);
      expect(reviewSheetImportBody.faceAuditReview.items.find((item) => item.key === 'industryTiles:brewery-1-1'))
        .toMatchObject({
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T02:00:00.000Z',
          evidenceRef: 'official-component:photo-set#industryTiles:brewery-1-1',
        });

      const invalidReviewSheetImportShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/apply-review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview]}),
      });
      expect(invalidReviewSheetImportShapeResponse.status).toBe(422);
      const invalidReviewSheetImportShapeBody = await invalidReviewSheetImportShapeResponse.json() as {
        faceAuditReviewSheetImport: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidReviewSheetImportShapeBody.faceAuditReviewSheetImport.ok).toBe(false);
      expect(invalidReviewSheetImportShapeBody.faceAuditReviewSheetImport.issueCount).toBe(1);
      expect(invalidReviewSheetImportShapeBody.faceAuditReviewSheetImport.issues).toEqual([{
        field: 'payload',
        message: 'Face-audit review sheet import expects an object with artifacts array and reviewSheetTsv string',
      }]);

      const invalidReviewSheetShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/review-sheet`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidReviewSheetShapeResponse.status).toBe(422);
      expect(invalidReviewSheetShapeResponse.headers.get('content-type')).toContain('application/json');
      const invalidReviewSheetShapeBody = await invalidReviewSheetShapeResponse.json() as {
        faceAuditReviewSheet: {
          ok: boolean;
          rowCount: number;
          tsv: string;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidReviewSheetShapeBody.faceAuditReviewSheet.ok).toBe(false);
      expect(invalidReviewSheetShapeBody.faceAuditReviewSheet.rowCount).toBe(0);
      expect(invalidReviewSheetShapeBody.faceAuditReviewSheet.tsv).toBe('');
      expect(invalidReviewSheetShapeBody.faceAuditReviewSheet.issueCount).toBe(1);
      expect(invalidReviewSheetShapeBody.faceAuditReviewSheet.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit review sheet expects a JSON array or an object with an artifacts array',
      }]);

      const expectedHandoff = buildFaceAuditReviewerHandoff([regularReview, wildReview]);
      const reviewerInstructionsResponse = await fetch(`${testServer.url}/api/face-audit-review-template/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(reviewerInstructionsResponse.status).toBe(200);
      expect(reviewerInstructionsResponse.headers.get('content-type')).toContain('text/markdown');
      expect(reviewerInstructionsResponse.headers.get('content-disposition'))
        .toBe('attachment; filename="face-audit-reviewer-instructions.md"');
      const expectedReviewStatus = summarizeFaceAuditReviewStatus([regularReview, wildReview]);
      const expectedReviewerInstructions = buildFaceAuditReviewerInstructions({
        status: expectedReviewStatus,
        todo: expectedTodo,
        plan: expectedReviewPlan,
        handoff: expectedHandoff,
        areaFiles: expectedHandoff.areas.map((area) => ({
          area: area.area,
          fileName: faceAuditAreaReviewArtifactFileName(area.area),
        })),
      });
      expect(reviewerInstructionsResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedReviewStatus.checklistFingerprint);
      expect(reviewerInstructionsResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedReviewStatus.reviewFingerprint);
      const reviewerInstructionsText = await reviewerInstructionsResponse.text();
      expect(reviewerInstructionsText).toBe(`${expectedReviewerInstructions}\n`);
      expect(reviewerInstructionsText).toContain('file `face-audit-area-wildCards-review.json`');
      expect(reviewerInstructionsText)
        .toContain(`sheet \`${faceAuditAreaReviewSheetArtifactFileName('wildCards')}\``);

      const invalidReviewerInstructionsShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidReviewerInstructionsShapeResponse.status).toBe(422);
      expect(invalidReviewerInstructionsShapeResponse.headers.get('content-type')).toContain('application/json');
      const invalidReviewerInstructionsShapeBody = await invalidReviewerInstructionsShapeResponse.json() as {
        faceAuditReviewerInstructions: {
          ok: boolean;
          markdown: string;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidReviewerInstructionsShapeBody.faceAuditReviewerInstructions.ok).toBe(false);
      expect(invalidReviewerInstructionsShapeBody.faceAuditReviewerInstructions.markdown)
        .toContain('# Face Audit Reviewer Instructions');
      expect(invalidReviewerInstructionsShapeBody.faceAuditReviewerInstructions.issueCount).toBe(1);
      expect(invalidReviewerInstructionsShapeBody.faceAuditReviewerInstructions.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit reviewer instructions expects a JSON array or an object with an artifacts array',
      }]);

      const areaReviewerInstructionsResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });
      const expectedAreaReviewerInstructions =
        buildFaceAuditAreaReviewerInstructionsReport([regularReview, wildReview], 'wildCards');
      expect(areaReviewerInstructionsResponse.status).toBe(200);
      expect(areaReviewerInstructionsResponse.headers.get('content-type')).toContain('text/markdown');
      expect(areaReviewerInstructionsResponse.headers.get('content-disposition'))
        .toBe(`attachment; filename="${faceAuditAreaReviewerInstructionsArtifactFileName('wildCards')}"`);
      expect(areaReviewerInstructionsResponse.headers.get('x-face-audit-checklist-fingerprint'))
        .toBe(expectedAreaReviewerInstructions.checklistFingerprint);
      expect(areaReviewerInstructionsResponse.headers.get('x-face-audit-review-fingerprint'))
        .toBe(expectedAreaReviewerInstructions.reviewFingerprint);
      expect(areaReviewerInstructionsResponse.headers.get('x-face-audit-area')).toBe('wildCards');
      const areaReviewerInstructionsText = await areaReviewerInstructionsResponse.text();
      expect(areaReviewerInstructionsText).toBe(`${expectedAreaReviewerInstructions.markdown}\n`);
      expect(areaReviewerInstructionsText)
        .toContain(`- Review sheet: \`${faceAuditAreaReviewSheetArtifactFileName('wildCards')}\``);
      expect(areaReviewerInstructionsText)
        .toContain('- Summarize this area: `npm run face-audit:todo -- --summary --area wildCards .\\face-audit-area-wildCards-review.json`');

      const readyAreaReviewerInstructionsResponse = await fetch(`${testServer.url}/api/face-audit-review-template/regularCards/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });
      expect(readyAreaReviewerInstructionsResponse.status).toBe(200);
      const readyAreaReviewerInstructionsText = await readyAreaReviewerInstructionsResponse.text();
      expect(readyAreaReviewerInstructionsText).toContain('# Face Audit Area Reviewer Instructions: regularCards');
      expect(readyAreaReviewerInstructionsText).toContain('- Completion status: `ready_to_lock`');
      expect(readyAreaReviewerInstructionsText).toContain('- No unfinished items remain for this area.');

      const invalidAreaReviewerInstructionsShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/wildCards/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidAreaReviewerInstructionsShapeResponse.status).toBe(422);
      expect(invalidAreaReviewerInstructionsShapeResponse.headers.get('content-type')).toContain('application/json');
      const invalidAreaReviewerInstructionsShapeBody = await invalidAreaReviewerInstructionsShapeResponse.json() as {
        faceAuditAreaReviewerInstructions: {
          ok: boolean;
          markdown: string;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidAreaReviewerInstructionsShapeBody.faceAuditAreaReviewerInstructions.ok).toBe(false);
      expect(invalidAreaReviewerInstructionsShapeBody.faceAuditAreaReviewerInstructions.markdown)
        .toContain('# Face Audit Area Reviewer Instructions: wildCards');
      expect(invalidAreaReviewerInstructionsShapeBody.faceAuditAreaReviewerInstructions.issueCount).toBe(1);
      expect(invalidAreaReviewerInstructionsShapeBody.faceAuditAreaReviewerInstructions.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit area reviewer instructions expects a JSON array or an object with an artifacts array',
      }]);

      const invalidAreaReviewerInstructionsResponse = await fetch(`${testServer.url}/api/face-audit-review-template/unknownArea/reviewer-instructions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview]}),
      });
      expect(invalidAreaReviewerInstructionsResponse.status).toBe(404);
      expect(await invalidAreaReviewerInstructionsResponse.json()).toEqual({errors: ['Face-audit area not found']});

      const handoffResponse = await fetch(`${testServer.url}/api/face-audit-review-template/handoff`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: [regularReview, wildReview]}),
      });

      expect(handoffResponse.status).toBe(200);
      const handoffBody = await handoffResponse.json() as {
        faceAuditReviewerHandoff: ReturnType<typeof buildFaceAuditReviewerHandoff>;
      };
      expect(Object.keys(handoffBody).sort()).toEqual(['faceAuditReviewerHandoff']);
      expect(handoffBody.faceAuditReviewerHandoff).toEqual(expectedHandoff);
      expect(handoffBody.faceAuditReviewerHandoff.artifactType).toBe('face_audit_reviewer_handoff');
      expect(handoffBody.faceAuditReviewerHandoff.pendingAreaCount).toBe(5);
      expect(handoffBody.faceAuditReviewerHandoff.readyAreaCount).toBe(1);
      expect(handoffBody.faceAuditReviewerHandoff.evidenceSourceCount).toBe(1);
      expect(handoffBody.faceAuditReviewerHandoff.todo).toEqual(expectedTodo);
      expect(handoffBody.faceAuditReviewerHandoff.areas.find((area) => area.area === 'regularCards')).toBeUndefined();
      expect(handoffBody.faceAuditReviewerHandoff.areas.find((area) => area.area === 'wildCards')).toMatchObject({
        area: 'wildCards',
        todo: {
          nextStep: 'find_better_reference',
          remainingItemCount: staticConfig.components.wildCards.total,
        },
        reviewArtifact: {
          artifactType: 'face_audit_area_review',
          area: 'wildCards',
          areaItemCount: staticConfig.components.wildCards.total,
          evidenceSources,
          completion: {
            status: 'needs_better_reference',
            reviewedItemCount: 1,
            needsReferenceItemCount: 1,
            unreviewedItemCount: staticConfig.components.wildCards.total - 1,
          },
        },
      });

      const verifyHandoffResponse = await fetch(`${testServer.url}/api/face-audit-reviewer-handoff/verify`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(handoffBody.faceAuditReviewerHandoff),
      });
      expect(verifyHandoffResponse.status).toBe(200);
      const verifyHandoffBody = await verifyHandoffResponse.json() as {
        faceAuditReviewerHandoffValidation: {
          ok: boolean;
          handoff?: ReturnType<typeof buildFaceAuditReviewerHandoff>;
          issues: unknown[];
        };
      };
      expect(verifyHandoffBody.faceAuditReviewerHandoffValidation.ok).toBe(true);
      expect(verifyHandoffBody.faceAuditReviewerHandoffValidation.handoff?.reviewFingerprint)
        .toBe(handoffBody.faceAuditReviewerHandoff.reviewFingerprint);
      expect(verifyHandoffBody.faceAuditReviewerHandoffValidation.issues).toEqual([]);

      const staleHandoffResponse = await fetch(`${testServer.url}/api/face-audit-reviewer-handoff/verify`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ...handoffBody.faceAuditReviewerHandoff,
          checklistFingerprint: 'fnv1a32:00000000',
        }),
      });
      expect(staleHandoffResponse.status).toBe(422);
      const staleHandoffBody = await staleHandoffResponse.json() as {
        faceAuditReviewerHandoffValidation: {
          ok: boolean;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(staleHandoffBody.faceAuditReviewerHandoffValidation.ok).toBe(false);
      expect(staleHandoffBody.faceAuditReviewerHandoffValidation.issues).toContainEqual({
        field: 'checklistFingerprint',
        message: 'Face-audit reviewer handoff does not match the current checklist',
      });

      const industryHandoff = handoffBody.faceAuditReviewerHandoff.areas
        .find((area) => area.area === 'industryTiles');
      if (!industryHandoff) {
        throw new Error('Missing industry handoff response fixture');
      }
      const industryResponseArtifact = {
        ...industryHandoff.reviewArtifact,
        items: industryHandoff.reviewArtifact.items.map((item, index) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
          reviewedAt: new Date(Date.UTC(2026, 6, 10, 2, index)).toISOString(),
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const handoffResponseSummaryResponse = await fetch(`${testServer.url}/api/face-audit-reviewer-handoff/response`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          handoff: handoffBody.faceAuditReviewerHandoff,
          artifacts: [industryResponseArtifact],
        }),
      });
      expect(handoffResponseSummaryResponse.status).toBe(200);
      const handoffResponseSummaryBody = await handoffResponseSummaryResponse.json() as {
        faceAuditReviewerHandoffResponse: {
          ok: boolean;
          handoffReviewFingerprint: string;
          handoffPendingAreaCount: number;
          responseArtifactCount: number;
          acceptedAreaCount: number;
          readyAreaCount: number;
          missingAreaCount: number;
          remainingAreaCount: number;
          areas: Array<{area: string; completionStatus: string; remainingItemCount: number}>;
          issueCount: number;
          issues: unknown[];
        };
      };
      expect(handoffResponseSummaryBody.faceAuditReviewerHandoffResponse).toMatchObject({
        ok: true,
        handoffReviewFingerprint: handoffBody.faceAuditReviewerHandoff.reviewFingerprint,
        handoffPendingAreaCount: 5,
        responseArtifactCount: 1,
        acceptedAreaCount: 1,
        readyAreaCount: 1,
        missingAreaCount: 4,
        remainingAreaCount: 4,
        issueCount: 0,
        issues: [],
      });
      expect(handoffResponseSummaryBody.faceAuditReviewerHandoffResponse.areas).toEqual([
        expect.objectContaining({
          area: 'industryTiles',
          completionStatus: 'ready_to_lock',
          remainingItemCount: 0,
        }),
      ]);

      const invalidHandoffResponseSummaryResponse = await fetch(`${testServer.url}/api/face-audit-reviewer-handoff/response`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          handoff: handoffBody.faceAuditReviewerHandoff,
          artifacts: [regularReview],
        }),
      });
      expect(invalidHandoffResponseSummaryResponse.status).toBe(422);
      const invalidHandoffResponseSummaryBody = await invalidHandoffResponseSummaryResponse.json() as {
        faceAuditReviewerHandoffResponse: {
          ok: boolean;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidHandoffResponseSummaryBody.faceAuditReviewerHandoffResponse.ok).toBe(false);
      expect(invalidHandoffResponseSummaryBody.faceAuditReviewerHandoffResponse.issues).toContainEqual({
        field: 'artifacts[0].area',
        message: 'Face-audit handoff response area is not part of the reviewer handoff pending areas',
      });

      const emptyHandoffResponse = await fetch(`${testServer.url}/api/face-audit-review-template/handoff`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifacts: []}),
      });
      expect(emptyHandoffResponse.status).toBe(200);
      const emptyHandoffBody = await emptyHandoffResponse.json() as {
        faceAuditReviewerHandoff: ReturnType<typeof buildFaceAuditReviewerHandoff>;
      };
      expect(emptyHandoffBody.faceAuditReviewerHandoff).toMatchObject({
        artifactType: 'face_audit_reviewer_handoff',
        ok: true,
        artifactCount: 0,
        pendingAreaCount: 6,
        readyAreaCount: 0,
        evidenceSourceCount: 0,
        completion: {
          status: 'not_started',
          reviewedItemCount: 0,
          unreviewedItemCount: buildFaceAuditReviewTemplate().items.length,
        },
      });
      expect(emptyHandoffBody.faceAuditReviewerHandoff.areas).toHaveLength(6);

      const invalidHandoffShapeResponse = await fetch(`${testServer.url}/api/face-audit-review-template/handoff`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({artifact: regularReview}),
      });
      expect(invalidHandoffShapeResponse.status).toBe(422);
      const invalidHandoffShapeBody = await invalidHandoffShapeResponse.json() as {
        faceAuditReviewerHandoff: {
          ok: boolean;
          issueCount: number;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidHandoffShapeBody.faceAuditReviewerHandoff.ok).toBe(false);
      expect(invalidHandoffShapeBody.faceAuditReviewerHandoff.issueCount).toBe(1);
      expect(invalidHandoffShapeBody.faceAuditReviewerHandoff.issues).toEqual([{
        field: 'artifacts',
        message: 'Face-audit reviewer handoff expects a JSON array or an object with an artifacts array',
      }]);

      const serializedTodo = JSON.stringify(todoBody);
      const serializedTodoSummary = JSON.stringify(todoSummaryBody);
      const serializedAreaTodoSummary = JSON.stringify(areaTodoSummaryBody);
      const serializedPublicTodoSummary = JSON.stringify(publicTodoSummaryBody);
      const serializedPublicAreaTodoSummary = JSON.stringify(publicAreaTodoSummaryBody);
      const serializedReviewSheet = reviewSheetText;
      const serializedHandoff = JSON.stringify(handoffBody);
      const serializedHandoffValidation = JSON.stringify(verifyHandoffBody);
      const serializedHandoffResponse = JSON.stringify(handoffResponseSummaryBody);
      expect(serializedTodo).not.toContain(created.game.id);
      expect(serializedTodoSummary).not.toContain(created.game.id);
      expect(serializedAreaTodoSummary).not.toContain(created.game.id);
      expect(serializedPublicTodoSummary).not.toContain(created.game.id);
      expect(serializedPublicAreaTodoSummary).not.toContain(created.game.id);
      expect(serializedReviewSheet).not.toContain(created.game.id);
      expect(serializedHandoff).not.toContain(created.game.id);
      expect(serializedHandoffValidation).not.toContain(created.game.id);
      expect(serializedHandoffResponse).not.toContain(created.game.id);
      expect(serializedTodo).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedTodoSummary).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedAreaTodoSummary).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedPublicTodoSummary).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedPublicAreaTodoSummary).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedReviewSheet).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedHandoff).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedHandoffValidation).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedHandoffResponse).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedTodo).not.toContain('Face Audit Todo Secret Player');
      expect(serializedTodoSummary).not.toContain('Face Audit Todo Secret Player');
      expect(serializedAreaTodoSummary).not.toContain('Face Audit Todo Secret Player');
      expect(serializedPublicTodoSummary).not.toContain('Face Audit Todo Secret Player');
      expect(serializedPublicAreaTodoSummary).not.toContain('Face Audit Todo Secret Player');
      expect(serializedReviewSheet).not.toContain('Face Audit Todo Secret Player');
      expect(serializedHandoff).not.toContain('Face Audit Todo Secret Player');
      expect(serializedHandoffValidation).not.toContain('Face Audit Todo Secret Player');
      expect(serializedHandoffResponse).not.toContain('Face Audit Todo Secret Player');
      expect(serializedTodo).not.toContain('face-audit-todo-secret-reason');
      expect(serializedTodoSummary).not.toContain('face-audit-todo-secret-reason');
      expect(serializedAreaTodoSummary).not.toContain('face-audit-todo-secret-reason');
      expect(serializedPublicTodoSummary).not.toContain('face-audit-todo-secret-reason');
      expect(serializedPublicAreaTodoSummary).not.toContain('face-audit-todo-secret-reason');
      expect(serializedReviewSheet).not.toContain('face-audit-todo-secret-reason');
      expect(serializedHandoff).not.toContain('face-audit-todo-secret-reason');
      expect(serializedHandoffValidation).not.toContain('face-audit-todo-secret-reason');
      expect(serializedHandoffResponse).not.toContain('face-audit-todo-secret-reason');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('validates submitted face-audit review artifacts without reading game state', async () => {
    const testServer = await startTestServer();
    try {
      const template = buildFaceAuditReviewTemplate();
      const validReview = {
        ...template,
        evidenceSources: [{
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham component photos',
          locator: 'reviewer-photos/official-component-set.zip',
          notes: '',
        }],
        areas: [],
        completion: template.completion,
        items: template.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };

      const validResponse = await fetch(`${testServer.url}/api/face-audit-review-template/validate`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(validReview),
      });

      expect(validResponse.status).toBe(200);
      const validBody = await validResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(validBody.faceAuditReviewValidation.ok).toBe(true);
      expect(validBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(validBody.faceAuditReviewValidation.review.completion).toMatchObject({
        status: 'ready_to_lock',
        reviewedItemCount: template.items.length,
        unreviewedItemCount: 0,
      });
      expect(validBody.faceAuditReviewValidation.review.areas).toHaveLength(FACE_AUDIT_AREAS.length);

      const invalidResponse = await fetch(`${testServer.url}/api/face-audit-review-template/validate`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ...template,
          checklistFingerprint: 'fnv1a32:00000000',
          items: template.items.map((item, index) => index === 0
            ? {
                ...item,
                reviewStatus: 'matches_official_face',
                reviewer: '',
                reviewedAt: 'not-a-date',
                evidenceRef: '',
              }
            : item),
        }),
      });

      expect(invalidResponse.status).toBe(422);
      const invalidBody = await invalidResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: Array<{itemKey?: string; field: string; message: string}>;
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(invalidBody.faceAuditReviewValidation.ok).toBe(false);
      expect(invalidBody.faceAuditReviewValidation.issues).toEqual(expect.arrayContaining([
        {field: 'checklistFingerprint', message: 'Face-audit review artifact does not match the current checklist'},
        {
          itemKey: template.items[0]!.key,
          field: 'reviewer',
          message: 'Reviewed items must include a reviewer',
        },
        {
          itemKey: template.items[0]!.key,
          field: 'reviewedAt',
          message: 'Reviewed items must include a valid review timestamp',
        },
        {
          itemKey: template.items[0]!.key,
          field: 'evidenceRef',
          message: 'Reviewed items must cite official-component evidence',
        },
      ]));
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('enforces face-audit ready checks through HTTP without reading game state', async () => {
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
      storedGame.players.p1.name = 'Face Audit Ready Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-ready-secret-reason',
      });

      const template = buildFaceAuditReviewTemplate();
      const unreviewedResponse = await fetch(`${testServer.url}/api/face-audit-review-template/ready`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(template),
      });

      expect(unreviewedResponse.status).toBe(422);
      const unreviewedBody = await unreviewedResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: Array<{field: string; message: string}>;
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(unreviewedBody.faceAuditReviewValidation.ok).toBe(false);
      expect(unreviewedBody.faceAuditReviewValidation.review.completion.status).toBe('not_started');
      expect(unreviewedBody.faceAuditReviewValidation.issues).toEqual(expect.arrayContaining([
        {
          field: 'completion.status',
          message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
        },
        {
          field: 'completion.unreviewedItemCount',
          message: 'Face-audit review still has 185 unreviewed item(s)',
        },
      ]));

      const readyReview = {
        ...template,
        evidenceSources: [{
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham component photos',
          locator: 'reviewer-photos/official-component-set.zip',
          notes: '',
        }],
        items: template.items.map((item) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: 'Ada',
          reviewedAt: '2026-07-10T00:00:00.000Z',
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const readyResponse = await fetch(`${testServer.url}/api/face-audit-review-template/ready`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readyReview),
      });

      expect(readyResponse.status).toBe(200);
      const readyBody = await readyResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(readyBody.faceAuditReviewValidation.ok).toBe(true);
      expect(readyBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(readyBody.faceAuditReviewValidation.review.completion).toMatchObject({
        status: 'ready_to_lock',
        reviewedItemCount: template.items.length,
        unreviewedItemCount: 0,
      });
      const serializedReady = JSON.stringify(readyBody);
      expect(serializedReady).not.toContain(created.game.id);
      expect(serializedReady).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedReady).not.toContain('Face Audit Ready Secret Player');
      expect(serializedReady).not.toContain('face-audit-ready-secret-reason');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves face-audit lock previews through HTTP without reading game state', async () => {
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
      storedGame.players.p1.name = 'Face Audit Lock Preview Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-lock-preview-secret-reason',
      });

      const template = buildFaceAuditReviewTemplate();
      const unreviewedResponse = await fetch(`${testServer.url}/api/face-audit-review-template/lock-preview`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(template),
      });

      expect(unreviewedResponse.status).toBe(422);
      const unreviewedBody = await unreviewedResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          lockPreview?: unknown;
          issues: Array<{field: string; message: string}>;
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(unreviewedBody.faceAuditReviewValidation.ok).toBe(false);
      expect(unreviewedBody.faceAuditReviewValidation.lockPreview).toBeUndefined();
      expect(unreviewedBody.faceAuditReviewValidation.review.completion.status).toBe('not_started');
      expect(unreviewedBody.faceAuditReviewValidation.issues).toEqual(expect.arrayContaining([{
        field: 'completion.status',
        message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
      }]));

      const readyReview = {
        ...template,
        evidenceSources: [{
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham component photos',
          locator: 'reviewer-photos/official-component-set.zip',
          notes: '',
        }],
        items: template.items.map((item, index) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
          reviewedAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(),
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const previewResponse = await fetch(`${testServer.url}/api/face-audit-review-template/lock-preview`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readyReview),
      });

      expect(previewResponse.status).toBe(200);
      const previewBody = await previewResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          issues: unknown[];
          lockPreview: {
            version: number;
            checklistFingerprint: string;
            reviewFingerprint: string;
            checklistItemCount: number;
            areas: Array<{
              area: string;
              currentStatus: string;
              nextStatus: string;
              itemCount: number;
              reviewedItemCount: number;
              reviewers: string[];
              evidenceRefs: string[];
              evidenceRefCount: number;
              areaLevelEvidenceRefCount: number;
              itemSpecificEvidenceRefCount: number;
              itemSpecificEvidenceItemCount: number;
              firstReviewedAt: string;
              lastReviewedAt: string;
            }>;
          };
          review: ReturnType<typeof buildFaceAuditReviewTemplate>;
        };
      };
      expect(previewBody.faceAuditReviewValidation.ok).toBe(true);
      expect(previewBody.faceAuditReviewValidation.issues).toEqual([]);
      expect(previewBody.faceAuditReviewValidation.review.completion.status).toBe('ready_to_lock');
      expect(previewBody.faceAuditReviewValidation.lockPreview).toMatchObject({
        version: 1,
        checklistFingerprint: template.checklistFingerprint,
        reviewFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
        checklistItemCount: template.checklistItemCount,
      });
      expect(previewBody.faceAuditReviewValidation.lockPreview.areas).toHaveLength(FACE_AUDIT_AREAS.length);
      expect(previewBody.faceAuditReviewValidation.lockPreview.areas).toContainEqual(expect.objectContaining({
        area: 'regularCards',
        currentStatus: 'manifest_locked_face_audit_pending',
        nextStatus: 'manifest_locked',
        itemCount: staticConfig.components.locationAndIndustryCardCount,
        reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
        reviewers: ['Ada', 'Ben'],
        evidenceRefs: ['official-component:photo-set#regularCards'],
        evidenceRefCount: 1,
        areaLevelEvidenceRefCount: 1,
        itemSpecificEvidenceRefCount: 0,
        itemSpecificEvidenceItemCount: 0,
      }));
      expect(previewBody.faceAuditReviewValidation.lockPreview.areas.every((area) =>
        Date.parse(area.firstReviewedAt) <= Date.parse(area.lastReviewedAt),
      )).toBe(true);

      const serializedPreview = JSON.stringify(previewBody);
      expect(serializedPreview).not.toContain(created.game.id);
      expect(serializedPreview).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedPreview).not.toContain('Face Audit Lock Preview Secret Player');
      expect(serializedPreview).not.toContain('face-audit-lock-preview-secret-reason');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves and verifies compact face-audit lock artifacts through HTTP without reading game state', async () => {
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
      storedGame.players.p1.name = 'Face Audit Lock Artifact Secret Player';
      storedGame.eventLog.push({
        type: 'cash_changed',
        playerId: 'p1',
        delta: 1,
        reason: 'face-audit-lock-artifact-secret-reason',
      });

      const template = buildFaceAuditReviewTemplate();
      const unreviewedResponse = await fetch(`${testServer.url}/api/face-audit-review-template/lock-artifact`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(template),
      });

      expect(unreviewedResponse.status).toBe(422);
      const unreviewedBody = await unreviewedResponse.json() as {
        faceAuditReviewValidation: {
          ok: boolean;
          lockArtifact?: unknown;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(unreviewedBody.faceAuditReviewValidation.ok).toBe(false);
      expect(unreviewedBody.faceAuditReviewValidation.lockArtifact).toBeUndefined();
      expect(unreviewedBody.faceAuditReviewValidation.issues).toEqual(expect.arrayContaining([{
        field: 'completion.status',
        message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
      }]));

      const readyReview = {
        ...template,
        evidenceSources: [{
          id: 'photo-set',
          label: 'Official component photo set',
          sourceType: 'official_physical_component',
          citation: 'Reviewer-owned official Brass: Birmingham component photos',
          locator: 'reviewer-photos/official-component-set.zip',
          notes: '',
        }],
        items: template.items.map((item, index) => ({
          ...item,
          reviewStatus: 'matches_official_face',
          reviewer: index % 2 === 0 ? 'Ada' : 'Ben',
          reviewedAt: new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(),
          evidenceRef: `official-component:photo-set#${item.area}`,
        })),
      };
      const artifactResponse = await fetch(`${testServer.url}/api/face-audit-review-template/lock-artifact`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(readyReview),
      });

      expect(artifactResponse.status).toBe(200);
      const artifactBody = await artifactResponse.json() as {
        faceAuditLockArtifact: {
          artifactType: string;
          version: number;
          checklistFingerprint: string;
          reviewFingerprint: string;
          checklistItemCount: number;
          areas: Array<{
            area: string;
            currentStatus: string;
            nextStatus: string;
            itemCount: number;
            reviewedItemCount: number;
            reviewers: string[];
            evidenceRefs: string[];
            evidenceRefCount: number;
            areaLevelEvidenceRefCount: number;
            itemSpecificEvidenceRefCount: number;
            itemSpecificEvidenceItemCount: number;
          }>;
          completion: {
            status: string;
            reviewedItemCount: number;
          };
          items?: unknown;
          review?: unknown;
          issues?: unknown;
        };
      };
      expect(Object.keys(artifactBody).sort()).toEqual(['faceAuditLockArtifact']);
      expect(artifactBody.faceAuditLockArtifact).toMatchObject({
        artifactType: 'face_audit_lock_evidence',
        version: 1,
        checklistFingerprint: template.checklistFingerprint,
        reviewFingerprint: expect.stringMatching(/^fnv1a32:[0-9a-f]{8}$/),
        checklistItemCount: template.checklistItemCount,
        completion: {
          status: 'ready_to_lock',
          reviewedItemCount: template.items.length,
        },
      });
      expect(artifactBody.faceAuditLockArtifact.areas).toHaveLength(FACE_AUDIT_AREAS.length);
      expect(artifactBody.faceAuditLockArtifact.areas).toContainEqual(expect.objectContaining({
        area: 'regularCards',
        currentStatus: 'manifest_locked_face_audit_pending',
        nextStatus: 'manifest_locked',
        itemCount: staticConfig.components.locationAndIndustryCardCount,
        reviewedItemCount: staticConfig.components.locationAndIndustryCardCount,
        reviewers: ['Ada', 'Ben'],
        evidenceRefs: ['official-component:photo-set#regularCards'],
        evidenceRefCount: 1,
        areaLevelEvidenceRefCount: 1,
        itemSpecificEvidenceRefCount: 0,
        itemSpecificEvidenceItemCount: 0,
      }));
      expect(artifactBody.faceAuditLockArtifact.items).toBeUndefined();
      expect(artifactBody.faceAuditLockArtifact.review).toBeUndefined();
      expect(artifactBody.faceAuditLockArtifact.issues).toBeUndefined();

      const verifyResponse = await fetch(`${testServer.url}/api/face-audit-lock-artifact/verify`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(artifactBody.faceAuditLockArtifact),
      });

      expect(verifyResponse.status).toBe(200);
      const verifyBody = await verifyResponse.json() as {
        faceAuditLockArtifactValidation: {
          ok: boolean;
          issues: unknown[];
          lockArtifact: typeof artifactBody.faceAuditLockArtifact;
        };
      };
      expect(verifyBody.faceAuditLockArtifactValidation.ok).toBe(true);
      expect(verifyBody.faceAuditLockArtifactValidation.issues).toEqual([]);
      expect(verifyBody.faceAuditLockArtifactValidation.lockArtifact).toEqual(artifactBody.faceAuditLockArtifact);

      const invalidVerifyResponse = await fetch(`${testServer.url}/api/face-audit-lock-artifact/verify`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          ...artifactBody.faceAuditLockArtifact,
          areas: artifactBody.faceAuditLockArtifact.areas.map((area, index) => index === 0
            ? {...area, evidenceRefs: []}
            : area),
        }),
      });

      expect(invalidVerifyResponse.status).toBe(422);
      const invalidVerifyBody = await invalidVerifyResponse.json() as {
        faceAuditLockArtifactValidation: {
          ok: boolean;
          lockArtifact?: unknown;
          issues: Array<{field: string; message: string}>;
        };
      };
      expect(invalidVerifyBody.faceAuditLockArtifactValidation.ok).toBe(false);
      expect(invalidVerifyBody.faceAuditLockArtifactValidation.lockArtifact).toBeUndefined();
      expect(invalidVerifyBody.faceAuditLockArtifactValidation.issues).toEqual(expect.arrayContaining([{
        field: 'areas[0].evidenceRefs',
        message: 'Face-audit lock artifact area must include at least one official evidence reference',
      }]));

      const currentReleaseGateResponse = await fetch(`${testServer.url}/api/face-audit-release-gate`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({}),
      });

      expect(currentReleaseGateResponse.status).toBe(200);
      const currentReleaseGateBody = await currentReleaseGateResponse.json() as {
        faceAuditStaticLockGate: {
          ok: boolean;
          pendingAreaCount: number;
          lockedAreaCount: number;
          issues: unknown[];
          lockArtifactValidation?: unknown;
        };
      };
      expect(currentReleaseGateBody.faceAuditStaticLockGate).toEqual({
        ok: true,
        pendingAreaCount: FACE_AUDIT_AREAS.length,
        lockedAreaCount: 0,
        issues: [],
      });

      const releaseGateResponse = await fetch(`${testServer.url}/api/face-audit-release-gate`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({lockArtifact: artifactBody.faceAuditLockArtifact}),
      });

      expect(releaseGateResponse.status).toBe(200);
      const releaseGateBody = await releaseGateResponse.json() as {
        faceAuditStaticLockGate: {
          ok: boolean;
          pendingAreaCount: number;
          lockedAreaCount: number;
          issues: unknown[];
          lockArtifactValidation?: {
            ok: boolean;
            lockArtifact: typeof artifactBody.faceAuditLockArtifact;
            issues: unknown[];
          };
        };
      };
      expect(releaseGateBody.faceAuditStaticLockGate.ok).toBe(true);
      expect(releaseGateBody.faceAuditStaticLockGate.pendingAreaCount).toBe(FACE_AUDIT_AREAS.length);
      expect(releaseGateBody.faceAuditStaticLockGate.lockedAreaCount).toBe(0);
      expect(releaseGateBody.faceAuditStaticLockGate.issues).toEqual([]);
      expect(releaseGateBody.faceAuditStaticLockGate.lockArtifactValidation?.ok).toBe(true);
      expect(releaseGateBody.faceAuditStaticLockGate.lockArtifactValidation?.issues).toEqual([]);
      expect(releaseGateBody.faceAuditStaticLockGate.lockArtifactValidation?.lockArtifact)
        .toEqual(artifactBody.faceAuditLockArtifact);

      const invalidReleaseGateResponse = await fetch(`${testServer.url}/api/face-audit-release-gate`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          lockArtifact: {
            ...artifactBody.faceAuditLockArtifact,
            checklistFingerprint: 'fnv1a32:00000000',
          },
        }),
      });

      expect(invalidReleaseGateResponse.status).toBe(422);
      const invalidReleaseGateBody = await invalidReleaseGateResponse.json() as {
        faceAuditStaticLockGate: {
          ok: boolean;
          pendingAreaCount: number;
          lockedAreaCount: number;
          issues: Array<{field: string; message: string}>;
          lockArtifactValidation?: {
            ok: boolean;
            lockArtifact?: unknown;
            issues: Array<{field: string; message: string}>;
          };
        };
      };
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.ok).toBe(false);
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.pendingAreaCount).toBe(FACE_AUDIT_AREAS.length);
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.lockedAreaCount).toBe(0);
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.lockArtifactValidation?.ok).toBe(false);
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.lockArtifactValidation?.lockArtifact).toBeUndefined();
      expect(invalidReleaseGateBody.faceAuditStaticLockGate.issues).toEqual([{
        field: 'checklistFingerprint',
        message: 'Face-audit lock artifact does not match the current or lock-transition checklist fingerprint',
      }]);

      const serializedLockEvidence = JSON.stringify([
        artifactBody,
        verifyBody,
        invalidVerifyBody,
        currentReleaseGateBody,
        releaseGateBody,
        invalidReleaseGateBody,
      ]);
      expect(serializedLockEvidence).not.toContain(created.game.id);
      expect(serializedLockEvidence).not.toContain(created.sessions[0]?.token ?? 'missing-session-token');
      expect(serializedLockEvidence).not.toContain('Face Audit Lock Artifact Secret Player');
      expect(serializedLockEvidence).not.toContain('face-audit-lock-artifact-secret-reason');
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
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

  it('omits introductory variants from non-Canal runtime HTTP game lists', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5, introductoryCanalOnly: true}),
      });
      const created = await createResponse.json() as {
        game: {id: string};
      };
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.era = 'rail';
      storedGame.actionsAllowedThisTurn = 2;

      const listResponse = await fetch(`${testServer.url}/api/games`);

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {games: Array<Record<string, unknown>>};
      expect(listBody.games).toEqual([expect.objectContaining({
        id: created.game.id,
        era: 'rail',
      })]);
      expect(listBody.games[0]).not.toHaveProperty('variant');
      expect(JSON.stringify(listBody)).not.toContain('introductory_canal_only');
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('serves the client fallback without masking unknown API routes', async () => {
    const clientDist = fs.mkdtempSync(path.join(os.tmpdir(), 'brass-client-dist-'));
    fs.mkdirSync(path.join(clientDist, 'assets'));
    fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><div id="root">client shell</div>');
    fs.writeFileSync(path.join(clientDist, 'assets', 'app.js'), 'window.__brassClientAsset = true;');
    const testServer = await startTestServer(clientDist);
    try {
      const rootResponse = await fetch(`${testServer.url}/`);
      expect(rootResponse.status).toBe(200);
      expect(rootResponse.headers.get('content-type')).toContain('text/html');
      await expect(rootResponse.text()).resolves.toContain('client shell');

      const clientResponse = await fetch(`${testServer.url}/rooms/example-room`);
      expect(clientResponse.status).toBe(200);
      expect(clientResponse.headers.get('content-type')).toContain('text/html');
      await expect(clientResponse.text()).resolves.toContain('client shell');

      const deepLinkResponse = await fetch(`${testServer.url}/games/example-game/player/p1`);
      expect(deepLinkResponse.status).toBe(200);
      expect(deepLinkResponse.headers.get('content-type')).toContain('text/html');
      await expect(deepLinkResponse.text()).resolves.toContain('client shell');

      const assetResponse = await fetch(`${testServer.url}/assets/app.js`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get('content-type')).toContain('javascript');
      await expect(assetResponse.text()).resolves.toBe('window.__brassClientAsset = true;');

      const apiResponse = await fetch(`${testServer.url}/api/missing-route`);
      expect(apiResponse.status).toBe(404);
      expect(apiResponse.headers.get('content-type')).toContain('application/json');
      await expect(apiResponse.json()).resolves.toEqual({errors: ['API route not found']});
    } finally {
      await stopTestServer(testServer);
      fs.rmSync(clientDist, {recursive: true, force: true});
    }
  });

  it('marks game HTTP responses as no-store so player views are not cached', async () => {
    const testServer = await startTestServer();
    try {
      const createResponse = await fetch(`${testServer.url}/api/games`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({playerNames: ['Ada', 'Ben'], seed: 5}),
      });
      expect(createResponse.status).toBe(201);
      expect(createResponse.headers.get('cache-control')).toBe('no-store');
      const created = await createResponse.json() as {
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };

      const listResponse = await fetch(`${testServer.url}/api/games`);
      expect(listResponse.status).toBe(200);
      expect(listResponse.headers.get('cache-control')).toBe('no-store');

      const observerDetailResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`);
      expect(observerDetailResponse.status).toBe(200);
      expect(observerDetailResponse.headers.get('cache-control')).toBe('no-store');

      const p1Session = created.sessions.find((session) => session.playerId === 'p1');
      const playerDetailResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-id': 'p1',
          'x-player-token': p1Session?.token ?? '',
        },
      });
      expect(playerDetailResponse.status).toBe(200);
      expect(playerDetailResponse.headers.get('cache-control')).toBe('no-store');

      const invalidSessionResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-id': 'p1',
          'x-player-token': 'wrong-token',
        },
      });
      expect(invalidSessionResponse.status).toBe(400);
      expect(invalidSessionResponse.headers.get('cache-control')).toBe('no-store');

      const cardId = created.game.players.p1.handCardIds[0];
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id': 'p1',
          'x-player-token': p1Session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId}),
      });
      expect(commandResponse.status).toBe(200);
      expect(commandResponse.headers.get('cache-control')).toBe('no-store');

      const invalidCommandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({type: 'pass', playerId: 'p2', cardId: 'missing-card'}),
      });
      expect(invalidCommandResponse.status).toBe(400);
      expect(invalidCommandResponse.headers.get('cache-control')).toBe('no-store');
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
        sessions: PlayerSession[];
      };
      const p1Session = created.sessions.find((session) => session.playerId === 'p1');
      const storedGame = testServer.store.get(created.game.id);
      expect(storedGame).toBeDefined();
      if (!storedGame) {
        throw new Error('Expected stored game');
      }
      storedGame.id = ' secret-game-id ';
      storedGame.players.p1.name = ' Ada\n';
      (storedGame.players.p2 as unknown as {name: unknown}).name = {secret: 'secret-token'};

      const detailResponse = await fetch(`${testServer.url}/api/games/${created.game.id}`, {
        headers: {
          'x-player-id': 'p1',
          'x-player-token': p1Session?.token ?? '',
        },
      });

      expect(detailResponse.status).toBe(200);
      const detail = await detailResponse.json() as {
        game: {id: string; players: Record<string, {name: string}>};
      };
      expect(detail.game.id).toBe(created.game.id);
      expect(detail.game.players.p1.name).toBe('Ada');
      expect(detail.game.players.p2.name).toBe('Player 2');
      expect(JSON.stringify(detail)).not.toContain('secret-token');
      expect(JSON.stringify(detail)).not.toContain('secret-game-id');
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
      const endedGameList = waitForGameList(socket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === created.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
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
      const [observerBroadcast, endedList] = await Promise.all([
        broadcast,
        endedGameList,
      ]) as [GameState, {games: Array<Record<string, unknown>>}];
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens([observerBroadcast, endedList], created.sessions);
      expect(commandBody.game.status).toBe('ended');
      expect(commandBody.game.era).toBe('canal');
      expect(commandBody.game.variant).toBe('introductory_canal_only');
      expect(commandBody.game.players.p1.victoryPoints).toBe(15);
      expect(commandBody.game.players.p2.victoryPoints).toBe(4);
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
      expect(endedList.games).toEqual([{
        id: created.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'canal',
        status: 'ended',
        variant: 'introductory_canal_only',
        connectedClientCount: 1,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 15, p2: 4},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      const endedGameList = waitForGameList(socket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === created.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
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
      const [observerBroadcast, endedList] = await Promise.all([
        broadcast,
        endedGameList,
      ]) as [GameState, {games: Array<Record<string, unknown>>}];
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens(commandBody, created.sessions);
      expectNoSessionTokens([observerBroadcast, endedList], created.sessions);
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
      expect(endedList.games).toEqual([{
        id: created.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 1,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 9, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      const endedGameList = waitForGameList(socket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === created.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
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
      const [observerBroadcast, endedList] = await Promise.all([
        broadcast,
        endedGameList,
      ]) as [GameState, {games: Array<Record<string, unknown>>}];
      const finalGame = testServer.store.get(created.game.id);
      if (!finalGame) {
        throw new Error('Expected final game');
      }

      expectNoSessionTokens([commandBody, observerBroadcast, endedList], created.sessions);
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
      expect(endedList.games).toEqual([{
        id: created.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 1,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 5, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      const endedGameList = waitForGameList(socket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === created.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
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
      const [endedView, endedList] = await Promise.all([
        endedBroadcast,
        endedGameList,
      ]) as [GameState, {games: Array<Record<string, unknown>>}];
      const finalGame = testServer.store.get(created.game.id);

      expectNoSessionTokens([resolveBody, endedView, endedList], created.sessions);
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
      expect(endedList.games).toEqual([{
        id: created.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 1,
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 9, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      storedGame.eventLog.push({
        type: 'negative_income_started',
        playerId: 'p2',
        amountOwed: 5,
        incomePlayerIndex: 1,
      });
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
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', false);
      setMerchantSpace(storedGame, 'gloucester-1', 'gloucester-manufacturer-0', false);
      storedGame.eventLog.push(
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-0', bonus: {type: 'develop', count: 1}},
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-1', bonus: {type: 'develop', count: 1}},
      );

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
      const pendingDecision: NonNullable<GameState['pendingDecision']> = {
        type: 'merchant_develop',
        playerId: 'p2',
        count: 1,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
      };
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
      await expect(wrongBodyToken.json()).resolves.toEqual({
        errors: ['Player token header does not match body session token'],
      });
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

      await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, async () => {
          await expect(emitWithAck(socket as Socket, 'game:join', null)).resolves.toEqual({
            ok: false,
            errors: ['Malformed join payload'],
          });
          await expect(emitWithAck(socket as Socket, 'game:join', {gameId: '   '})).resolves.toEqual({
            ok: false,
            errors: ['Malformed join payload'],
          });
          await expect(emitWithAck(socket as Socket, 'game:command', null)).resolves.toEqual({
            ok: false,
            errors: ['Malformed command payload'],
          });
          await expect(emitWithAck(socket as Socket, 'game:command', {gameId: '\t', command: {type: 'pass'}})).resolves.toEqual({
            ok: false,
            errors: ['Malformed command payload'],
          });
        }),
      );
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
      const joinedState = waitForGameState(socket, (state) => state.id === game.id);
      const joinedList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
      const joinResponse = await emitWithAck(socket, 'game:join', {gameId: game.id}) as {ok: boolean};

      expect(joinResponse.ok).toBe(true);
      await Promise.all([joinedState, joinedList]);

      const response = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:command', {
            gameId: game.id,
            command: 'pass',
            sessionToken: 'irrelevant-token',
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
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
      const initialList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
      const joinResponse = await emitWithAck(socket, 'game:join', {
        gameId: game.id,
        playerId: 'p1',
        sessionToken: session?.token,
      }) as {ok: boolean};
      expect(joinResponse.ok).toBe(true);
      await Promise.all([initialState, initialList]);

      const malformedEnvelopeResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:command', {
            gameId: '   ',
            command: {type: 'pass', playerId: 'p1'},
            sessionToken: session?.token,
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
      );
      expect(malformedEnvelopeResponse).toEqual({ok: false, errors: ['Malformed command payload']});

      const malformedCommandResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:command', {
            gameId: game.id,
            command: 'pass',
            sessionToken: session?.token,
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
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

  it('moves a socket out of its previous game room when it creates another game', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      const firstGame = testServer.store.create({playerNames: ['Ada', 'Ben'], seed: 5});
      const firstSession = testServer.store.getPlayerSession(firstGame.id, 'p2');
      expect(firstSession).toBeDefined();

      socket = await connectSocket(testServer.url);
      const socketId = socket.id as string;
      const firstState = waitForGameState(socket, (state) => state.id === firstGame.id);
      const firstJoin = await emitWithAck(socket, 'game:join', {
        gameId: firstGame.id,
        playerId: firstSession?.playerId,
        sessionToken: firstSession?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      await firstState;

      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p2');

      const secondState = waitForGameState(socket, (state) => state.id !== firstGame.id);
      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Cara', 'Dan'],
        seed: 7,
      }) as {
        ok: boolean;
        game: {id: string};
        session: PlayerSession;
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      expect(createResponse.game.id).not.toBe(firstGame.id);
      expect(createResponse.session).toEqual(createResponse.sessions[0]);
      await secondState;

      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(createResponse.game.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(createResponse.game.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const firstCardId = firstGame.players.p1.handCardIds[0];
      const p1Session = testServer.store.getPlayerSession(firstGame.id, 'p1');
      const commandResponse = await expectNoGameStateWhile(socket, () =>
        fetch(`${testServer.url}/api/games/${firstGame.id}/commands`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            command: {type: 'pass', playerId: 'p1', cardId: firstCardId},
            sessionToken: p1Session?.token,
          }),
        }),
      );
      expect(commandResponse.status).toBe(200);
      expect(testServer.store.get(firstGame.id)?.currentTurnIndex).toBe(1);
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
      const initialList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 2);
      const firstJoin = await emitWithAck(socket, 'game:join', {
        gameId: firstGame.id,
        playerId: 'p1',
        sessionToken: p1Session?.token,
      }) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      await Promise.all([initialState, initialList]);

      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const invalidSessionResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:join', {
            gameId: secondGame.id,
            playerId: 'p1',
            sessionToken: 'wrong-token',
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
      );
      expect(invalidSessionResponse).toEqual({ok: false, errors: ['Invalid player session']});
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const malformedJoinResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:join', {gameId: '   '}) as Promise<{
            ok: boolean;
            errors: string[];
          }>,
        ),
      );
      expect(malformedJoinResponse).toEqual({ok: false, errors: ['Malformed join payload']});
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get('   ')).toBeUndefined();
      expect(testServer.io.sockets.sockets.get(socketId)?.data.gameId).toBe(firstGame.id);
      expect(testServer.io.sockets.sockets.get(socketId)?.data.playerId).toBe('p1');

      const missingGameResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:join', {gameId: 'missing-game'}) as Promise<{
            ok: boolean;
            errors: string[];
          }>,
        ),
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

  it('creates deterministic seeded rooms through Socket.IO without sharing room ids or session tokens', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);
      const createSeededGame = async (seed: number) => {
        const response = await emitWithAck(socket as Socket, 'game:create', {
          playerNames: ['Ada', 'Ben', 'Cara'],
          seed,
        }) as {
          ok: boolean;
          game: GameState;
          sessions: PlayerSession[];
          session?: PlayerSession;
        };
        expect(response.ok).toBe(true);
        return response;
      };

      const first = await createSeededGame(42);
      const repeated = await createSeededGame(42);
      const differentSeed = await createSeededGame(43);
      const firstStored = testServer.store.get(first.game.id);
      const repeatedStored = testServer.store.get(repeated.game.id);
      const differentStored = testServer.store.get(differentSeed.game.id);
      if (!firstStored || !repeatedStored || !differentStored) {
        throw new Error('Expected created games to be stored');
      }

      expect(first.game.id).not.toBe(repeated.game.id);
      expect(repeated.game.id).not.toBe(differentSeed.game.id);
      expect(first.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(repeated.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(differentSeed.sessions.map((session) => session.playerId)).toEqual(['p1', 'p2', 'p3']);
      expect(first.session).toEqual(first.sessions[0]);
      expect(repeated.session).toEqual(repeated.sessions[0]);
      expect(differentSeed.session).toEqual(differentSeed.sessions[0]);
      expect(new Set([
        ...first.sessions.map((session) => session.token),
        ...repeated.sessions.map((session) => session.token),
        ...differentSeed.sessions.map((session) => session.token),
      ]).size).toBe(9);
      expectNoSessionTokens(first.game, first.sessions);
      expectNoSessionTokens(repeated.game, repeated.sessions);
      expectNoSessionTokens(differentSeed.game, differentSeed.sessions);

      expect(deterministicSetupSnapshot(repeatedStored)).toEqual(deterministicSetupSnapshot(firstStored));
      expect(deterministicSetupSnapshot(differentStored)).not.toEqual(deterministicSetupSnapshot(firstStored));
      expect(first.game.players.p1.handCardIds).toEqual(firstStored.players.p1.handCardIds);
      expect(first.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(first.game.players.p3.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(first.game.cardZones.drawDeck.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(JSON.stringify(first.game)).not.toContain(firstStored.players.p2.handCardIds[0]);
      expect(JSON.stringify(first.game)).not.toContain(firstStored.players.p3.handCardIds[0]);

      const socketId = socket.id as string;
      expect(testServer.io.sockets.adapter.rooms.get(first.game.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(repeated.game.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(differentSeed.game.id)?.has(socketId)).toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socketId);
      expect(serverSocket?.data.gameId).toBe(differentSeed.game.id);
      expect(serverSocket?.data.playerId).toBe('p1');
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

      const createResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, async () => emitWithAck(socket as Socket, 'game:create', {
          playerNames: ['Ada'],
          seed: 5,
        })),
      ) as {ok: boolean; errors: string[]};

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

  it('keeps the previous Socket.IO room binding and lobby quiet after a failed game creation', async () => {
    const testServer = await startTestServer();
    let socket: Socket | undefined;
    try {
      socket = await connectSocket(testServer.url);
      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      const previousGameId = createResponse.game.id;
      const socketId = socket.id as string;
      expect(testServer.io.sockets.adapter.rooms.get(previousGameId)?.has(socketId)).toBe(true);

      const failedCreate = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () => emitWithAck(socket as Socket, 'game:create', {
          playerNames: ['Ada'],
          seed: 5,
        })),
      ) as {ok: boolean; errors: string[]};

      expect(failedCreate).toEqual({
        ok: false,
        errors: ['Brass: Birmingham supports 2-4 players'],
      });
      expect(testServer.store.list()).toEqual([expect.objectContaining({id: previousGameId})]);
      expect(testServer.io.sockets.adapter.rooms.get(previousGameId)?.has(socketId)).toBe(true);
      const serverSocket = testServer.io.sockets.sockets.get(socketId);
      expect(serverSocket?.data.gameId).toBe(previousGameId);
      expect(serverSocket?.data.playerId).toBe('p1');
      expectNoSessionTokens(testServer.store.list(), createResponse.sessions);
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
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 1,
        connectedPlayerIds: ['p1'],
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
      const endedGameList = waitForGameList(observerSocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === createResponse.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
      );
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
      expect(commandResponse.game.players.p2.victoryPoints).toBe(4);
      expect(commandResponse.game.eventLog).toEqual(expect.arrayContaining([
        {type: 'victory_points_changed', playerId: 'p1', delta: 15, reason: 'introductory money scoring'},
        expect.objectContaining({type: 'era_ended', era: 'canal'}),
        {type: 'game_ended', winners: ['p1']},
      ]));

      const [hostView, observerView, endedList] = await Promise.all([
        hostBroadcast,
        observerBroadcast,
        endedGameList,
      ]) as [GameState, GameState, {games: Array<Record<string, unknown>>}];
      expectNoSessionTokens([hostView, observerView, endedList], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.players.p1.handCardIds).toEqual([]);
      expect(observerView.players.p1.handCardIds).toEqual([]);
      expect(endedList.games).toEqual([{
        id: createResponse.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'canal',
        status: 'ended',
        variant: 'introductory_canal_only',
        connectedClientCount: 2,
        connectedPlayerIds: ['p1'],
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 15, p2: 4},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      const endedGameList = waitForGameList(observerSocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === createResponse.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
      );
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

      const [hostView, observerView, endedList] = await Promise.all([
        hostBroadcast,
        observerBroadcast,
        endedGameList,
      ]) as [GameState, GameState, {games: Array<Record<string, unknown>>}];
      expectNoSessionTokens([hostView, observerView, endedList], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.era).toBe('rail');
      expect(observerView.era).toBe('rail');
      expect(hostView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(observerView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(endedList.games).toEqual([{
        id: createResponse.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 2,
        connectedPlayerIds: ['p1'],
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 9, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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
      const endedGameList = waitForGameList(observerSocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === createResponse.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
      );
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

      const [hostView, observerView, endedList] = await Promise.all([
        hostBroadcast,
        observerBroadcast,
        endedGameList,
      ]) as [GameState, GameState, {games: Array<Record<string, unknown>>}];
      const finalGame = testServer.store.get(createResponse.game.id);
      if (!finalGame) {
        throw new Error('Expected final game');
      }

      expectNoSessionTokens([hostView, observerView, endedList], createResponse.sessions);
      expect(hostView.status).toBe('ended');
      expect(observerView.status).toBe('ended');
      expect(hostView.pendingDecision).toBeUndefined();
      expect(observerView.pendingDecision).toBeUndefined();
      expect(hostView.players.p1.cash).toBe(0);
      expect(observerView.eventLog).toContainEqual({type: 'game_ended', winners: ['p1']});
      expect(hostView.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(observerView.eventLog.some((event) => event.type === 'negative_income_started')).toBe(false);
      expect(endedList.games).toEqual([{
        id: createResponse.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 2,
        connectedPlayerIds: ['p1'],
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 5, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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

      const createList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
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
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', false);
      setMerchantSpace(storedGame, 'gloucester-1', 'gloucester-manufacturer-0', false);
      storedGame.eventLog.push(
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-0', merchantTileInstanceId: 'gloucester-cotton-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-0', bonus: {type: 'develop', count: 1}},
        {
          type: 'resource_consumed',
          source: {kind: 'merchant_beer', merchantSpaceId: 'gloucester-1', merchantTileInstanceId: 'gloucester-manufacturer-0'},
          byPlayerId: 'p1',
          reason: 'sell',
        },
        {type: 'merchant_bonus_claimed', playerId: 'p1', merchantSpaceId: 'gloucester-1', bonus: {type: 'develop', count: 1}},
      );

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

  it('combines Socket.IO Gloucester develop bonuses from one multi-sale command', async () => {
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
        id: 'industry-451',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      const manufacturer = addIndustry(storedGame, {
        id: 'industry-452',
        ownerPlayerId: 'p1',
        industryType: 'manufacturer',
        specId: 'manufacturer-1-1',
        locationId: 'walsall',
        slotId: 'walsall-0',
      });
      addLink(storedGame, 'link-451', 'p1', 'birmingham-walsall');
      addLink(storedGame, 'link-452', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'link-453', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);
      setMerchantSpace(storedGame, 'gloucester-1', 'gloucester-manufacturer-0', true);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        state.pendingDecision.count === 2 &&
        Boolean(state.eventLog?.filter((event) => event.type === 'merchant_bonus_claimed').length === 2);
      const pendingHostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const pendingObserverBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const sellResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'sell',
          playerId: 'p1',
          cardId,
          sales: [
            {industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'},
            {industryInstanceId: manufacturer.id, merchantSpaceId: 'gloucester-1'},
          ],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };
      const pendingDecision = {
        type: 'merchant_develop',
        playerId: 'p1',
        count: 2,
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      } as const;

      expect(sellResponse.ok).toBe(true);
      expectNoSessionTokens(sellResponse, createResponse.sessions);
      expect(sellResponse.game.pendingDecision).toEqual(pendingDecision);
      expect(sellResponse.game.board.industryInstances[cotton.id].flipped).toBe(true);
      expect(sellResponse.game.board.industryInstances[manufacturer.id].flipped).toBe(true);
      expect(sellResponse.game.board.merchantSpaces['gloucester-0'].beerPresent).toBe(false);
      expect(sellResponse.game.board.merchantSpaces['gloucester-1'].beerPresent).toBe(false);
      expect(sellResponse.game.eventLog).toEqual(expect.arrayContaining([
        {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-0',
          bonus: {type: 'develop', count: 1},
        },
        {
          type: 'merchant_bonus_claimed',
          playerId: 'p1',
          merchantSpaceId: 'gloucester-1',
          bonus: {type: 'develop', count: 1},
        },
        {
          type: 'industry_sold',
          industryInstanceId: cotton.id,
          ownerPlayerId: 'p1',
          merchantSpaceId: 'gloucester-0',
        },
        {
          type: 'industry_sold',
          industryInstanceId: manufacturer.id,
          ownerPlayerId: 'p1',
          merchantSpaceId: 'gloucester-1',
        },
      ]));

      const [pendingHostView, pendingObserverView] = await Promise.all([
        pendingHostBroadcast,
        pendingObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([pendingHostView, pendingObserverView], createResponse.sessions);
      expect(pendingHostView.pendingDecision).toEqual(pendingDecision);
      expect(pendingObserverView.pendingDecision).toEqual(pendingDecision);
      expect(pendingHostView.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(pendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.pendingDecision).toEqual(pendingDecision);

      const resolvedPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        Boolean(state.eventLog?.some((event) => event.type === 'merchant_develop_resolved'));
      const resolvedHostBroadcast = waitForGameState(hostSocket, resolvedPredicate);
      const resolvedObserverBroadcast = waitForGameState(observerSocket, resolvedPredicate);
      const resolveResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'resolve_merchant_develop',
          playerId: 'p1',
          industryTypes: ['coal_mine', 'iron_works'],
        },
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(resolveResponse.ok).toBe(true);
      expectNoSessionTokens(resolveResponse, createResponse.sessions);
      expect(resolveResponse.game.pendingDecision).toBeUndefined();
      expect(resolveResponse.game.currentTurnIndex).toBe(1);
      expect(resolveResponse.game.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(resolveResponse.game.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(resolveResponse.game.eventLog).toContainEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
        industryTypes: ['coal_mine', 'iron_works'],
        specIds: ['coal_mine-1-1', 'iron_works-1-1'],
      });

      const [resolvedHostView, resolvedObserverView] = await Promise.all([
        resolvedHostBroadcast,
        resolvedObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([resolvedHostView, resolvedObserverView], createResponse.sessions);
      expect(resolvedHostView.pendingDecision).toBeUndefined();
      expect(resolvedObserverView.pendingDecision).toBeUndefined();
      expect(resolvedHostView.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
      expect(resolvedObserverView.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
      expect(testServer.store.get(createResponse.game.id)?.pendingDecision).toBeUndefined();
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

  it('continues the Socket.IO turn after resolving a first-action Gloucester develop bonus', async () => {
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

      const sellCardId = 'p2-location-birmingham-1';
      const secondActionCardId = 'p2-location-cannock-1';
      storedGame.roundNumber = 2;
      storedGame.actionsAllowedThisTurn = 2;
      storedGame.currentTurnIndex = 0;
      storedGame.actionIndexInTurn = 0;
      storedGame.players.p1.handCardIds = [sellCardId, secondActionCardId];
      const cotton = addIndustry(storedGame, {
        id: 'socket-same-turn-merchant-cotton',
        ownerPlayerId: 'p1',
        industryType: 'cotton_mill',
        specId: 'cotton_mill-1-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
      });
      addLink(storedGame, 'socket-same-turn-merchant-link-1', 'p1', 'birmingham-worcester');
      addLink(storedGame, 'socket-same-turn-merchant-link-2', 'p1', 'gloucester-worcester');
      setMerchantSpace(storedGame, 'gloucester-0', 'gloucester-cotton-0', true);

      const observerJoin = await emitWithAck(observerSocket, 'game:join', {gameId: createResponse.game.id}) as {ok: boolean};
      expect(observerJoin.ok).toBe(true);

      const pendingPredicate = (state: GameStateProjection) =>
        state.pendingDecision?.type === 'merchant_develop' &&
        state.currentTurnIndex === 0 &&
        state.actionIndexInTurn === 0;
      const pendingHostBroadcast = waitForGameState(hostSocket, pendingPredicate);
      const pendingObserverBroadcast = waitForGameState(observerSocket, pendingPredicate);
      const sellResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {
          type: 'sell',
          playerId: 'p1',
          cardId: sellCardId,
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
      expect(sellResponse.game.currentTurnIndex).toBe(0);
      expect(sellResponse.game.actionIndexInTurn).toBe(0);
      expect(sellResponse.game.players.p1.handCardIds).toEqual([secondActionCardId]);

      const [pendingHostView, pendingObserverView] = await Promise.all([
        pendingHostBroadcast,
        pendingObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([pendingHostView, pendingObserverView], createResponse.sessions);
      expect(pendingHostView.pendingDecision).toEqual(pendingDecision);
      expect(pendingHostView.players.p1.handCardIds).toEqual([secondActionCardId]);
      expect(pendingObserverView.pendingDecision).toEqual(pendingDecision);
      expect(pendingObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);

      const resolvedPredicate = (state: GameStateProjection) =>
        state.pendingDecision === undefined &&
        state.currentTurnIndex === 0 &&
        state.actionIndexInTurn === 1 &&
        Boolean(state.eventLog?.some((event) => event.type === 'merchant_develop_resolved'));
      const resolvedHostBroadcast = waitForGameState(hostSocket, resolvedPredicate);
      const resolvedObserverBroadcast = waitForGameState(observerSocket, resolvedPredicate);
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
      expect(resolveResponse.game.currentTurnIndex).toBe(0);
      expect(resolveResponse.game.actionIndexInTurn).toBe(1);
      expect(resolveResponse.game.roundNumber).toBe(2);
      expect(resolveResponse.game.players.p1.handCardIds).toEqual([secondActionCardId]);
      expect(resolveResponse.game.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(resolveResponse.game.eventLog.at(-1)).toEqual({
        type: 'merchant_develop_resolved',
        playerId: 'p1',
        merchantSpaceId: 'gloucester-0',
        merchantSpaceIds: ['gloucester-0'],
        industryTypes: ['manufacturer'],
        specIds: ['manufacturer-1-1'],
      });

      const [resolvedHostView, resolvedObserverView] = await Promise.all([
        resolvedHostBroadcast,
        resolvedObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([resolvedHostView, resolvedObserverView], createResponse.sessions);
      expect(resolvedHostView.pendingDecision).toBeUndefined();
      expect(resolvedHostView.currentTurnIndex).toBe(0);
      expect(resolvedHostView.actionIndexInTurn).toBe(1);
      expect(resolvedHostView.players.p1.handCardIds).toEqual([secondActionCardId]);
      expect(resolvedObserverView.pendingDecision).toBeUndefined();
      expect(resolvedObserverView.currentTurnIndex).toBe(0);
      expect(resolvedObserverView.actionIndexInTurn).toBe(1);
      expect(resolvedObserverView.players.p1.handCardIds.every((id) => id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.currentTurnIndex).toBe(0);
      expect(testServer.store.get(createResponse.game.id)?.actionIndexInTurn).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.handCardIds).toEqual([secondActionCardId]);

      const p2TurnHostBroadcast = waitForGameState(hostSocket, (state) =>
        state.currentTurnIndex === 1 &&
        state.actionIndexInTurn === 0 &&
        state.pendingDecision === undefined,
      );
      const p2TurnObserverBroadcast = waitForGameState(observerSocket, (state) =>
        state.currentTurnIndex === 1 &&
        state.actionIndexInTurn === 0 &&
        state.pendingDecision === undefined,
      );
      const passResponse = await emitWithAck(hostSocket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId: secondActionCardId},
        sessionToken: session.token,
      }) as {
        ok: boolean;
        game: GameState;
      };

      expect(passResponse.ok).toBe(true);
      expectNoSessionTokens(passResponse, createResponse.sessions);
      expect(passResponse.game.currentTurnIndex).toBe(1);
      expect(passResponse.game.actionIndexInTurn).toBe(0);
      expect(passResponse.game.players.p1.discardCardIds).toEqual(expect.arrayContaining([
        sellCardId,
        secondActionCardId,
      ]));

      const [p2TurnHostView, p2TurnObserverView] = await Promise.all([
        p2TurnHostBroadcast,
        p2TurnObserverBroadcast,
      ]) as [GameState, GameState];
      expectNoSessionTokens([p2TurnHostView, p2TurnObserverView], createResponse.sessions);
      expect(p2TurnHostView.currentTurnIndex).toBe(1);
      expect(p2TurnObserverView.currentTurnIndex).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.currentTurnIndex).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toEqual(expect.arrayContaining([
        sellCardId,
        secondActionCardId,
      ]));
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
      const endedGameList = waitForGameList(observerSocket, (payload) =>
        payload.games?.some((summary) =>
          typeof summary === 'object' &&
          summary !== null &&
          (summary as {id?: unknown}).id === createResponse.game.id &&
          (summary as {status?: unknown}).status === 'ended',
        ) === true,
      );
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

      const [endedHostView, endedObserverView, endedList] = await Promise.all([
        endedHostBroadcast,
        endedObserverBroadcast,
        endedGameList,
      ]) as [GameState, GameState, {games: Array<Record<string, unknown>>}];
      expectNoSessionTokens([endedHostView, endedObserverView, endedList], createResponse.sessions);
      expect(endedHostView.pendingDecision).toBeUndefined();
      expect(endedObserverView.pendingDecision).toBeUndefined();
      expect(endedHostView.status).toBe('ended');
      expect(endedObserverView.status).toBe('ended');
      expect(endedHostView.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
      expect(endedObserverView.players.p1.handCardIds).toEqual([]);
      expect(endedObserverView.eventLog).toContainEqual(expect.objectContaining({type: 'game_ended'}));
      expect(endedList.games).toEqual([{
        id: createResponse.game.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 10,
        era: 'rail',
        status: 'ended',
        connectedClientCount: 2,
        connectedPlayerIds: ['p1'],
        winners: ['p1'],
        victoryPointsByPlayer: {p1: 9, p2: 0},
      }]);
      expect(endedList.games[0]).not.toHaveProperty('currentPlayerId');
      expect(endedList.games[0]).not.toHaveProperty('pendingDecision');
      expect(endedList.games[0]).not.toHaveProperty('eventLog');
      expect(JSON.stringify(endedList)).not.toContain(cardId);
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

      const createList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
      const createResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      await createList;

      const p1Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const p2Session = createResponse.sessions.find((candidate) => candidate.playerId === 'p2');
      const p1CardId = createResponse.game.players.p1.handCardIds[0];
      const p1Broadcast = waitForGameState(socket, (state) => state.currentTurnIndex === 1);
      const p1ListBroadcast = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
      const p1CommandResponse = await emitWithAck(socket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId: p1CardId},
        sessionToken: p1Session?.token,
      }) as {ok: boolean; game: {currentTurnIndex: number}};
      expect(p1CommandResponse.ok).toBe(true);
      expect(p1CommandResponse.game.currentTurnIndex).toBe(1);
      await Promise.all([p1Broadcast, p1ListBroadcast]);

      const storedBeforeMismatch = testServer.store.get(createResponse.game.id);
      const p2CardId = storedBeforeMismatch?.players.p2.handCardIds[0];
      if (!p2CardId) {
        throw new Error('Expected p2 to have a card');
      }

      const mismatchedCommandResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:command', {
            gameId: createResponse.game.id,
            command: {type: 'pass', playerId: 'p2', cardId: p2CardId},
            sessionToken: p2Session?.token,
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
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

      const createList = waitForGameList(socket, (payload) => Array.isArray(payload.games) && payload.games.length === 1);
      const firstCreateResponse = await emitWithAck(socket, 'game:create', {
        playerNames: ['Ada', 'Ben'],
        seed: 5,
      }) as {
        ok: boolean;
        game: {id: string};
      };
      expect(firstCreateResponse.ok).toBe(true);
      await createList;
      expect(socket.id).toBeDefined();

      const secondGame = testServer.store.create({playerNames: ['Cara', 'Dan'], seed: 7});
      const secondSession = testServer.store.getPlayerSession(secondGame.id, 'p1');
      const secondCardId = secondGame.players.p1.handCardIds[0];
      const socketId = socket.id as string;

      const crossGameCommandResponse = await expectNoGameListWhile(socket, () =>
        expectNoGameStateWhile(socket as Socket, () =>
          emitWithAck(socket as Socket, 'game:command', {
            gameId: secondGame.id,
            command: {type: 'pass', playerId: 'p1', cardId: secondCardId},
            sessionToken: secondSession?.token,
          }) as Promise<{ok: boolean; errors: string[]}>,
        ),
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

  it('binds socket commands to the normalized command player id', async () => {
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
        command: {type: 'pass', playerId: ' p1\n', cardId},
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
