import {describe, expect, it} from 'vitest';
import type {AddressInfo} from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {io as createClient, type Socket} from 'socket.io-client';
import {createBrassServer, gameStateForPlayer, type BrassServer} from '../../src/server/createServer';
import {GameStore, type PlayerSession} from '../../src/server/gameStore';
import {testGame} from '../helpers';

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

function waitForGameState(socket: Socket, predicate: (state: {currentTurnIndex?: number}) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('game:state', listener);
      reject(new Error('Timed out waiting for game:state'));
    }, 3000);
    const listener = (state: {currentTurnIndex?: number}) => {
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

describe('createBrassServer', () => {
  it('projects observer game state with private hands and deck redacted', () => {
    const game = testGame();
    game.cardZones.drawDeck = ['deck-card-1', 'deck-card-2', 'deck-card-3'];
    game.players.p1.discardCardIds = ['p1-setup-discard', 'p1-face-up-discard'];
    game.players.p1.faceDownDiscardCount = 1;
    game.players.p2.discardCardIds = ['p2-setup-discard', 'p2-face-up-discard'];
    game.players.p2.faceDownDiscardCount = 1;

    const view = gameStateForPlayer(game);

    expect(view.players.p1.handCardIds).toHaveLength(game.players.p1.handCardIds.length);
    expect(view.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.players.p2.handCardIds).toHaveLength(game.players.p2.handCardIds.length);
    expect(view.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.cardZones.drawDeck).toEqual(['hidden-card-1', 'hidden-card-2', 'hidden-card-3']);
    expect(view.players.p1.discardCardIds).toEqual(['hidden-card-1', 'p1-face-up-discard']);
    expect(view.players.p2.discardCardIds).toEqual(['hidden-card-1', 'p2-face-up-discard']);
    expect(game.cardZones.drawDeck).toEqual(['deck-card-1', 'deck-card-2', 'deck-card-3']);
    expect(game.players.p1.discardCardIds).toEqual(['p1-setup-discard', 'p1-face-up-discard']);
  });

  it('projects a player game state with only that player hand visible', () => {
    const game = testGame();

    const view = gameStateForPlayer(game, 'p2');

    expect(view.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
    expect(view.players.p2.handCardIds).toEqual(game.players.p2.handCardIds);
    expect(view.players.p2.handCardIds).not.toBe(game.players.p2.handCardIds);

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

  it('clamps stale face-down discard counts when projecting game state', () => {
    const game = testGame();
    game.players.p1.discardCardIds = ['p1-discard-a', 'p1-discard-b'];
    game.players.p1.faceDownDiscardCount = 99;
    game.players.p2.discardCardIds = ['p2-face-up-discard'];
    game.players.p2.faceDownDiscardCount = -4;

    const view = gameStateForPlayer(game);

    expect(view.players.p1.discardCardIds).toEqual(['hidden-card-1', 'hidden-card-2']);
    expect(view.players.p2.discardCardIds).toEqual(['p2-face-up-discard']);
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
      storedGame.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1};

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
        currentPlayerId: created.game.turnOrder[created.game.currentTurnIndex],
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
    } finally {
      await stopTestServer(testServer);
    }
  });

  it('rejects malformed player names through HTTP without creating a game', async () => {
    const testServer = await startTestServer();
    try {
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
          'x-player-id': 'p2',
          'x-player-token': p2Session?.token ?? '',
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
      const invalidSessionView = await invalidSessionResponse.json() as {game: {players: Record<string, {handCardIds: string[]}>}};
      expect(invalidSessionView.game.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(invalidSessionView.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
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
          sessionToken: session?.token,
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
      expect(commandBody.game.currentTurnIndex).toBe(1);
      const storedGame = testServer.store.get(created.game.id);
      expect(commandBody.game.players.p1.handCardIds).toEqual(storedGame?.players.p1.handCardIds);
      expect(commandBody.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      const observerBroadcast = await broadcast as {
        currentTurnIndex: number;
        players: Record<string, {handCardIds: string[]}>;
      };
      expect(observerBroadcast.currentTurnIndex).toBe(1);
      expect(observerBroadcast.players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(observerBroadcast.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(storedGame?.players.p1.discardCardIds).toContain(cardId);
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
      const commandResponse = await fetch(`${testServer.url}/api/games/${created.game.id}/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-token': session?.token ?? '',
        },
        body: JSON.stringify({type: 'pass', playerId: 'p1', cardId}),
      });
      expect(commandResponse.status).toBe(200);
      await expect(commandResponse.json()).resolves.toMatchObject({game: {currentTurnIndex: 1}});
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
      await expect(emitWithAck(socket, 'game:command', null)).resolves.toEqual({
        ok: false,
        errors: ['Malformed command payload'],
      });
      expect(socket.connected).toBe(true);
    } finally {
      socket?.disconnect();
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

      const firstJoin = await emitWithAck(socket, 'game:join', {gameId: firstGame.id}) as {ok: boolean};
      expect(firstJoin.ok).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).toBe(true);

      const secondJoin = await emitWithAck(socket, 'game:join', {gameId: secondGame.id}) as {ok: boolean};
      expect(secondJoin.ok).toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(firstGame.id)?.has(socketId)).not.toBe(true);
      expect(testServer.io.sockets.adapter.rooms.get(secondGame.id)?.has(socketId)).toBe(true);
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
        game: {id: string; players: Record<string, {handCardIds: string[]}>};
        sessions: PlayerSession[];
      };
      expect(createResponse.ok).toBe(true);
      expect(createResponse.game.players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);

      const session = createResponse.sessions.find((candidate) => candidate.playerId === 'p1');
      const cardId = createResponse.game.players.p1.handCardIds[0];
      const commandResponse = await emitWithAck(socket, 'game:command', {
        gameId: createResponse.game.id,
        command: {type: 'pass', playerId: 'p1', cardId},
        sessionToken: session?.token,
      }) as {ok: boolean; game: {currentTurnIndex: number}};

      expect(commandResponse.ok).toBe(true);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      socket?.disconnect();
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
      }) as {ok: boolean; game: {currentTurnIndex: number}};

      expect(commandResponse.ok).toBe(true);
      expect(commandResponse.game.currentTurnIndex).toBe(1);
      const broadcasts = await Promise.all([firstBroadcast, secondBroadcast]) as Array<{
        currentTurnIndex: number;
        players: Record<string, {handCardIds: string[]}>;
      }>;
      expect(broadcasts).toEqual([
        expect.objectContaining({currentTurnIndex: 1}),
        expect.objectContaining({currentTurnIndex: 1}),
      ]);
      expect(broadcasts[0].players.p1.handCardIds.some((cardId) => !cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[0].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p1.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
      expect(broadcasts[1].players.p2.handCardIds.every((cardId) => cardId.startsWith('hidden-card-'))).toBe(true);
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
      expect(commandResponse.game.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      const broadcast = await observerBroadcast as {players: Record<string, {handCardIds: string[]}>};
      expect(broadcast.players.p1.handCardIds.some((id) => !id.startsWith('hidden-card-'))).toBe(true);
      expect(testServer.store.get(createResponse.game.id)?.players.p1.discardCardIds).toContain(cardId);
    } finally {
      hostSocket?.disconnect();
      observerSocket?.disconnect();
      await stopTestServer(testServer);
    }
  });
});
