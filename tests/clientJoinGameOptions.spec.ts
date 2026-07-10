import {describe, expect, it} from 'vitest';
import {joinGamePayload} from '../src/client/joinGameOptions';

describe('client join game options', () => {
  it('normalizes observer join payloads', () => {
    expect(joinGamePayload(' game-1 ')).toEqual({
      ok: true,
      payload: {gameId: 'game-1'},
    });
  });

  it('normalizes player-session join payloads', () => {
    expect(joinGamePayload(' game-1 ', ' p2 ', ' token-2 ')).toEqual({
      ok: true,
      payload: {
        gameId: 'game-1',
        playerId: 'p2',
        sessionToken: 'token-2',
      },
    });
  });

  it('rejects blank game ids before emitting joins', () => {
    expect(joinGamePayload('   ', '', '')).toEqual({
      ok: false,
      error: 'Game ID is required',
    });
  });

  it('rejects incomplete player-session credentials before emitting joins', () => {
    expect(joinGamePayload('game-1', 'p1', '')).toEqual({
      ok: false,
      error: 'Player ID and session token must both be provided',
    });
    expect(joinGamePayload('game-1', '', 'token-1')).toEqual({
      ok: false,
      error: 'Player ID and session token must both be provided',
    });
  });

  it('rejects player-session joins for unsupported player seats', () => {
    expect(joinGamePayload('game-1', 'p5', 'token-5')).toEqual({
      ok: false,
      error: 'Player ID must be p1, p2, p3, or p4',
    });
  });
});
