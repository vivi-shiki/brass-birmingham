import {describe, expect, it} from 'vitest';
import {gameStatePushOptions, type PushPlayerSession} from '../src/client/gameStatePushOptions';
import {playerSessionHash} from '../src/client/sessionLinks';

describe('client game state push options', () => {
  it('preserves player-session hashes for same-game state pushes', () => {
    const hash = playerSessionHash('game-1', {playerId: 'p2', token: 'token-2'});

    expect(gameStatePushOptions(' game-1 ', hash, () => [])).toEqual({
      ok: true,
      hash,
      sessions: [],
    });
  });

  it('falls back to observer hashes for different pushed games', () => {
    expect(gameStatePushOptions(' game-2 ', playerSessionHash('game-1', {
      playerId: 'p1',
      token: 'token-1',
    }), () => [])).toEqual({
      ok: true,
      hash: '#game-2',
      sessions: [],
    });
  });

  it('loads sessions with the normalized pushed game id', () => {
    const requestedGameIds: string[] = [];
    const sessionsForGame = (gameId: string): PushPlayerSession[] => {
      requestedGameIds.push(gameId);
      return [{playerId: ' p1 ', token: ' token-1 '}];
    };

    expect(gameStatePushOptions(' game-1 ', '#game-1', sessionsForGame)).toEqual({
      ok: true,
      hash: '#game-1',
      sessions: [{playerId: 'p1', token: 'token-1'}],
    });
    expect(requestedGameIds).toEqual(['game-1']);
  });

  it('filters duplicate and malformed pushed sessions before updating local state', () => {
    expect(gameStatePushOptions('game-1', '#game-1', () => [
      {playerId: 'p2', token: 'shared-token'},
      {playerId: ' p1 ', token: ' shared-token '},
      {playerId: 'p3', token: ' token-3 '},
      {playerId: ' ', token: 'ghost-token'},
      {playerId: 'p4', token: '   '},
      {playerId: 'p5', token: 'token-5'},
      {playerId: 'observer', token: 'observer-token'},
    ])).toEqual({
      ok: true,
      hash: '#game-1',
      sessions: [
        {playerId: 'p1', token: 'shared-token'},
        {playerId: 'p3', token: 'token-3'},
      ],
    });
  });

  it('does not update local state for blank pushed game ids', () => {
    expect(gameStatePushOptions('   ', '#game-1', () => [])).toEqual({
      ok: false,
      error: 'Game ID is required',
    });
  });

  it('treats session storage failures as an empty session list', () => {
    expect(gameStatePushOptions('game-1', '#game-1', () => {
      throw new Error('storage failed');
    })).toEqual({
      ok: true,
      hash: '#game-1',
      sessions: [],
    });
  });
});
