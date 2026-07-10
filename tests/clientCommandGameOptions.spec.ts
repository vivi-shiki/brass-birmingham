import {describe, expect, it} from 'vitest';
import {acknowledgedCommandPlayerId, commandGamePayload} from '../src/client/commandGameOptions';
import type {GameCommand} from '../src/common/types';

const passCommand: GameCommand = {
  type: 'pass',
  playerId: 'p1',
  cardId: 'p2-location-birmingham-1',
};

describe('client command game options', () => {
  it('normalizes command payload game ids and session tokens', () => {
    expect(commandGamePayload(' game-1 ', {...passCommand, playerId: ' p1 '}, ' token-1 ')).toEqual({
      ok: true,
      payload: {
        gameId: 'game-1',
        command: passCommand,
        sessionToken: 'token-1',
      },
    });
  });

  it('rejects blank game ids before emitting commands', () => {
    expect(commandGamePayload('   ', passCommand, 'token-1')).toEqual({
      ok: false,
      error: 'Game ID is required',
    });
  });

  it('rejects blank session tokens before emitting commands', () => {
    expect(commandGamePayload('game-1', passCommand, '   ')).toEqual({
      ok: false,
      error: 'No saved session token for p1',
    });
  });

  it('rejects commands for unsupported player seats before emitting', () => {
    expect(commandGamePayload('game-1', {...passCommand, playerId: 'p5'}, 'token-5')).toEqual({
      ok: false,
      error: 'Player ID must be p1, p2, p3, or p4',
    });
  });

  it('rejects malformed command payloads before emitting', () => {
    expect(commandGamePayload('game-1', null, 'token-1')).toEqual({
      ok: false,
      error: 'Command payload is malformed',
    });
    expect(commandGamePayload('game-1', [], 'token-1')).toEqual({
      ok: false,
      error: 'Command payload is malformed',
    });
    expect(commandGamePayload('game-1', {type: 'pass'}, 'token-1')).toEqual({
      ok: false,
      error: 'Player ID must be p1, p2, p3, or p4',
    });
    expect(commandGamePayload('game-1', {type: 'pass', playerId: 1}, 'token-1')).toEqual({
      ok: false,
      error: 'Player ID must be p1, p2, p3, or p4',
    });
  });

  it('switches the viewer only after a successful command ACK with game state', () => {
    expect(acknowledgedCommandPlayerId({ok: true, game: {id: 'game-1', players: {p1: {id: 'p1'}}}}, ' p1 ')).toBe('p1');
    expect(acknowledgedCommandPlayerId({ok: false}, 'p1')).toBeUndefined();
    expect(acknowledgedCommandPlayerId({ok: true}, 'p1')).toBeUndefined();
  });

  it('does not switch the viewer for malformed ACKs without the command player', () => {
    expect(acknowledgedCommandPlayerId({ok: true, game: {id: 'game-1'}}, 'p1')).toBeUndefined();
    expect(acknowledgedCommandPlayerId({ok: true, game: {id: 'game-1', players: {p2: {id: 'p2'}}}}, 'p1')).toBeUndefined();
    expect(acknowledgedCommandPlayerId({ok: true, game: {id: 'game-1', players: {p1: null}}}, 'p1')).toBeUndefined();
    expect(acknowledgedCommandPlayerId({ok: true, game: {id: 'game-1', players: {p1: {id: 'p1'}}}}, '   ')).toBeUndefined();
  });

  it('does not switch the viewer for unsupported player seats even when ACKed', () => {
    expect(acknowledgedCommandPlayerId({
      ok: true,
      game: {id: 'game-1', players: {p5: {id: 'p5'}}},
    }, 'p5')).toBeUndefined();
  });
});
