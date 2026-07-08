import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import {createServer, type Server as HttpServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Server as SocketIOServer, type Socket as ServerSocket} from 'socket.io';
import {validateGameSeed} from '../common/gameSetup';
import type {GameCommand, GameState} from '../common/types';
import type {GameStore, PlayerSession} from './gameStore';

export interface BrassServerOptions {
  store: GameStore;
  clientDist?: string;
}

export interface BrassServer {
  app: express.Express;
  server: HttpServer;
  io: SocketIOServer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError && isRecord(error) && 'body' in error;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.get('origin');
  if (!origin) {
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.get('access-control-request-headers') ?? 'content-type,x-player-id,x-player-token',
  );
  res.append('Vary', 'Origin');
}

function playerNamesFromPayload(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.playerNames)) {
    return [];
  }
  if (!payload.playerNames.every((name) => typeof name === 'string')) {
    throw new Error('Player names must be strings');
  }
  return payload.playerNames;
}

function seedFromPayload(payload: unknown): number | undefined {
  if (!isRecord(payload) || !('seed' in payload) || payload.seed === undefined) {
    return undefined;
  }
  if (typeof payload.seed !== 'number' || !Number.isFinite(payload.seed)) {
    throw new Error('Game seed must be a finite number');
  }
  return validateGameSeed(payload.seed);
}

function hiddenCardIds(count: number): string[] {
  return Array.from({length: count}, (_, index) => `hidden-card-${index + 1}`);
}

function discardCardIdsForView(player: GameState['players'][string]): string[] {
  const loadedFaceDownCount = Number.isFinite(player.faceDownDiscardCount)
    ? Math.floor(player.faceDownDiscardCount)
    : 0;
  const faceDownCount = Math.max(0, Math.min(loadedFaceDownCount, player.discardCardIds.length));
  return [
    ...hiddenCardIds(faceDownCount),
    ...player.discardCardIds.slice(faceDownCount),
  ];
}

export function gameStateForPlayer(game: GameState, playerId?: string): GameState {
  const view = structuredClone(game) as GameState;
  for (const [id, player] of Object.entries(view.players)) {
    player.handCardIds = id === playerId ? [...player.handCardIds] : hiddenCardIds(player.handCardIds.length);
    player.discardCardIds = discardCardIdsForView(player);
  }
  view.cardZones.drawDeck = hiddenCardIds(view.cardZones.drawDeck.length);
  return view;
}

function joinGameRoom(socket: ServerSocket, gameId: string, playerId?: string): void {
  const previousGameId = optionalString(socket.data.gameId);
  if (previousGameId && previousGameId !== gameId) {
    socket.leave(previousGameId);
  }
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;
  socket.join(gameId);
}

export function createBrassServer(options: BrassServerOptions): BrassServer {
  const {store, clientDist} = options;
  const app = express();
  const server = createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  app.use((req, res, next) => {
    applyCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({strict: false}));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!isJsonParseError(error)) {
      next(error);
      return;
    }
    res.status(400).json({errors: ['Malformed JSON body']});
  });

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  app.get('/api/games', (_req, res) => {
    res.json({games: store.list()});
  });

  app.post('/api/games', (req, res) => {
    try {
      const game = store.create({
        playerNames: playerNamesFromPayload(req.body),
        seed: seedFromPayload(req.body),
      });
      const sessions = store.getPlayerSessions(game.id);
      res.status(201).json({game: gameStateForPlayer(game, sessions[0]?.playerId), sessions});
    } catch (error) {
      res.status(400).json({errors: [error instanceof Error ? error.message : String(error)]});
    }
  });

  app.get('/api/games/:id', (req, res) => {
    const game = store.get(req.params.id);
    if (!game) {
      res.status(404).json({errors: ['Game not found']});
      return;
    }
    const playerId = req.get('x-player-id') ?? undefined;
    const token = req.get('x-player-token') ?? undefined;
    const viewerPlayerId = playerId && store.verifyPlayerSession(game.id, playerId, token) ? playerId : undefined;
    res.json({game: gameStateForPlayer(game, viewerPlayerId)});
  });

  app.post('/api/games/:id/commands', (req, res) => {
    const command = isRecord(req.body) && 'command' in req.body
      ? req.body.command
      : req.body;
    const sessionToken = isRecord(req.body) && typeof req.body.sessionToken === 'string'
      ? req.body.sessionToken
      : req.get('x-player-token') ?? undefined;
    const result = store.apply(req.params.id, command, sessionToken);
    if (!result.ok) {
      res.status(400).json({errors: result.errors});
      return;
    }
    const playerId = isRecord(command) && typeof command.playerId === 'string' ? command.playerId : undefined;
    const room = io.sockets.adapter.rooms.get(req.params.id);
    if (room && result.state) {
      for (const socketId of room) {
        const socket = io.sockets.sockets.get(socketId);
        socket?.emit('game:state', gameStateForPlayer(result.state, optionalString(socket.data.playerId)));
      }
    }
    res.json({game: result.state ? gameStateForPlayer(result.state, playerId) : undefined});
  });

  io.on('connection', (socket) => {
    socket.on('game:create', (payload: unknown, reply?: (response: unknown) => void) => {
      try {
        const game = store.create({
          playerNames: playerNamesFromPayload(payload),
          seed: seedFromPayload(payload),
        });
        const sessions = store.getPlayerSessions(game.id);
        joinGameRoom(socket, game.id, sessions[0]?.playerId);
        reply?.({ok: true, game: gameStateForPlayer(game, sessions[0]?.playerId), sessions, session: sessions[0]});
        socket.emit('game:state', gameStateForPlayer(game, sessions[0]?.playerId));
      } catch (error) {
        reply?.({ok: false, errors: [error instanceof Error ? error.message : String(error)]});
      }
    });

    socket.on('game:join', (payload: unknown, reply?: (response: unknown) => void) => {
      if (!isRecord(payload) || typeof payload.gameId !== 'string') {
        reply?.({ok: false, errors: ['Malformed join payload']});
        return;
      }

      const game = store.get(payload.gameId);
      if (!game) {
        reply?.({ok: false, errors: ['Game not found']});
        return;
      }

      const playerId = optionalString(payload.playerId);
      const sessionToken = optionalString(payload.sessionToken);
      let session: PlayerSession | undefined;
      if (playerId || sessionToken) {
        if (!playerId || !store.verifyPlayerSession(game.id, playerId, sessionToken)) {
          reply?.({ok: false, errors: ['Invalid player session']});
          return;
        }
        session = store.getPlayerSession(game.id, playerId);
      }

      joinGameRoom(socket, game.id, playerId);
      reply?.({ok: true, game: gameStateForPlayer(game, playerId), session});
      socket.emit('game:state', gameStateForPlayer(game, playerId));
    });

    socket.on('game:command', (payload: unknown, reply?: (response: unknown) => void) => {
      if (!isRecord(payload) || typeof payload.gameId !== 'string') {
        reply?.({ok: false, errors: ['Malformed command payload']});
        return;
      }

      const result = store.apply(
        payload.gameId,
        payload.command,
        optionalString(payload.sessionToken),
      );
      if (!result.ok) {
        reply?.({ok: false, errors: result.errors});
        return;
      }
      const playerId = isRecord(payload.command) && typeof payload.command.playerId === 'string'
        ? payload.command.playerId
        : undefined;
      if (playerId) {
        joinGameRoom(socket, payload.gameId, playerId);
      }
      const room = io.sockets.adapter.rooms.get(payload.gameId);
      if (room && result.state) {
        for (const socketId of room) {
          const socket = io.sockets.sockets.get(socketId);
          socket?.emit('game:state', gameStateForPlayer(result.state, optionalString(socket.data.playerId)));
        }
      }
      reply?.({ok: true, game: result.state ? gameStateForPlayer(result.state, playerId) : undefined});
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({errors: ['API route not found']});
  });

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return {app, server, io};
}
