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

  it('ignores malformed query hashes instead of preserving broken join credentials', () => {
    expect(parseGameJoinHash('#gameId=bad%hash&playerId=p1&sessionToken=token')).toBeUndefined();
    expect(parseGameJoinHash('#gameId=%E0%A4%A&playerId=p1&sessionToken=token')).toBeUndefined();
    expect(hashForGameState('game-123', '#gameId=%E0%A4%A&playerId=p1&sessionToken=token')).toBe('#game-123');
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

  it('drops unsupported player seats from session hash fragments', () => {
    expect(parseGameJoinHash('#gameId=game-123&playerId=p5&sessionToken=token-5')).toEqual({gameId: 'game-123'});
    expect(parseGameJoinHash(playerSessionHash('game-123', {playerId: 'p5', token: 'token-5'}))).toEqual({gameId: 'game-123'});
    expect(hashForGameState('game-123', '#gameId=game-123&playerId=p5&sessionToken=token-5')).toBe('#game-123');
  });

  it('uses the first non-empty repeated query value and drops unrelated params', () => {
    const noisyHash = '#utm=share&gameId=%20&gameId=game-123&playerId=%20&playerId=p2&sessionToken=%20&sessionToken=token-2';

    expect(parseGameJoinHash(noisyHash)).toEqual({
      gameId: 'game-123',
      playerId: 'p2',
      sessionToken: 'token-2',
    });
    expect(hashForGameState(' game-123 ', noisyHash)).toBe('#gameId=game-123&playerId=p2&sessionToken=token-2');
  });

  it('normalizes generated hashes before storing or sharing join links', () => {
    const hash = playerSessionHash(' game-123 ', {playerId: ' p2 ', token: ' token with spaces '});

    expect(hash).toBe('#gameId=game-123&playerId=p2&sessionToken=token+with+spaces');
    expect(parseGameJoinHash(hash)).toEqual({
      gameId: 'game-123',
      playerId: 'p2',
      sessionToken: 'token with spaces',
    });
    expect(parseGameJoinHash(playerSessionHash('game-123', {playerId: 'p2', token: '   '}))).toEqual({gameId: 'game-123'});
  });

  it('does not generate join hashes for blank game ids', () => {
    expect(gameHash('   ')).toBe('');
    expect(playerSessionHash('   ', {playerId: 'p1', token: 'token-1'})).toBe('');
    expect(playerSessionUrl('http://127.0.0.1:5173/play#old-game', '   ', {
      playerId: 'p1',
      token: 'token-1',
    })).toBe('http://127.0.0.1:5173/play');
    expect(hashForGameState('   ', playerSessionHash('game-123', {playerId: 'p1', token: 'token-1'}))).toBe('');
  });

  it('builds shareable session urls by replacing any existing hash', () => {
    const url = playerSessionUrl('http://127.0.0.1:5173/play#old-game', ' game 123 ', {
      playerId: ' p1 ',
      token: ' token&with=symbols ',
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
    expect(hashForGameState(' game-123 ', 'gameId= game-123 &playerId= p2 &sessionToken= token-2 ')).toBe(hash);
    expect(hashForGameState('other-game', hash)).toBe('#other-game');
    expect(hashForGameState('game-123', '#game-123')).toBe('#game-123');
  });
});
