import {describe, expect, it} from 'vitest';
import {gameHash, hashForGameState, parseGameJoinHash, playerSessionHash, playerSessionUrl} from '../src/client/sessionLinks';

describe('client session join links', () => {
  it('parses legacy game-only hash fragments', () => {
    expect(parseGameJoinHash('#game-123')).toEqual({gameId: 'game-123'});
    expect(parseGameJoinHash(gameHash('game with spaces'))).toEqual({gameId: 'game with spaces'});
  });

  it('ignores malformed legacy game-only hashes instead of throwing', () => {
    expect(parseGameJoinHash('#bad%hash')).toBeUndefined();
    expect(parseGameJoinHash('#%E0%A4%A')).toBeUndefined();
    expect(parseGameJoinHash('#%20%20')).toBeUndefined();
    expect(hashForGameState('game-123', '#bad%hash')).toBe('#game-123');
  });

  it('parses player session hash fragments for direct player joins', () => {
    const hash = playerSessionHash('game-123', {playerId: 'p2', token: 'token&with=symbols'});

    expect(parseGameJoinHash(hash)).toEqual({
      gameId: 'game-123',
      playerId: 'p2',
      sessionToken: 'token&with=symbols',
    });
  });

  it('falls back to observer joins when a session hash is incomplete', () => {
    expect(parseGameJoinHash('#gameId=game-123&playerId=p2')).toEqual({gameId: 'game-123'});
    expect(parseGameJoinHash('#gameId=game-123&sessionToken=token')).toEqual({gameId: 'game-123'});
    expect(parseGameJoinHash('#playerId=p2&sessionToken=token')).toBeUndefined();
  });

  it('builds shareable session urls by replacing any existing hash', () => {
    const url = playerSessionUrl('http://127.0.0.1:5173/play#old-game', 'game 123', {
      playerId: 'p1',
      token: 'token&with=symbols',
    });

    expect(url).toBe('http://127.0.0.1:5173/play#gameId=game+123&playerId=p1&sessionToken=token%26with%3Dsymbols');
    expect(parseGameJoinHash(url.split('#')[1] ?? '')).toEqual({
      gameId: 'game 123',
      playerId: 'p1',
      sessionToken: 'token&with=symbols',
    });
  });

  it('preserves the current player session hash when receiving game state for the same game', () => {
    const hash = playerSessionHash('game-123', {playerId: 'p2', token: 'token-2'});

    expect(hashForGameState('game-123', hash)).toBe(hash);
    expect(hashForGameState('other-game', hash)).toBe('#other-game');
    expect(hashForGameState('game-123', '#game-123')).toBe('#game-123');
  });
});
