import {describe, expect, it} from 'vitest';
import {
  readStoredSessions,
  rememberSessions,
  sessionStorageKey,
  sessionsForGame,
  writeStoredSessions,
  type SessionStorageAdapter,
} from '../src/client/playerSessionStore';

class MemoryStorage implements SessionStorageAdapter {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements SessionStorageAdapter {
  getItem(): string | null {
    throw new Error('storage disabled');
  }

  setItem(): void {
    throw new Error('storage disabled');
  }
}

describe('client player session store', () => {
  it('returns no sessions when storage is unavailable or malformed', () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionStorageKey, '{not-json');

    expect(readStoredSessions(undefined)).toEqual({});
    expect(readStoredSessions(storage)).toEqual({});
    expect(sessionsForGame('game-1', storage)).toEqual([]);
    expect(sessionsForGame('game-1', new ThrowingStorage())).toEqual([]);
  });

  it('filters corrupted stored session entries before exposing them to the room list', () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionStorageKey, JSON.stringify({
      ' game-1 ': {
        ' p1 ': ' token-1 ',
        p2: '   ',
        p3: 42,
        ' ': 'ghost-token',
      },
      ' ': {p1: 'ignored-token'},
      'game-2': null,
    }));

    expect(readStoredSessions(storage)).toEqual({
      'game-1': {p1: 'token-1'},
    });
    expect(sessionsForGame(' game-1 ', storage)).toEqual([
      {playerId: 'p1', token: 'token-1'},
    ]);
  });

  it('merges duplicated stored game ids after trimming legacy storage keys', () => {
    const storage = new MemoryStorage();
    storage.setItem(sessionStorageKey, JSON.stringify({
      'game-10': {
        p10: 'token-10',
        p2: 'token-2',
      },
      ' game-1 ': {
        ' p2 ': ' token-2 ',
      },
      'game-1': {
        p1: 'token-1',
      },
    }));

    expect(readStoredSessions(storage)).toEqual({
      'game-1': {p1: 'token-1', p2: 'token-2'},
      'game-10': {p2: 'token-2', p10: 'token-10'},
    });
    expect(sessionsForGame('game-1', storage)).toEqual([
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p2', token: 'token-2'},
    ]);
    expect(sessionsForGame('game-10', storage)).toEqual([
      {playerId: 'p2', token: 'token-2'},
      {playerId: 'p10', token: 'token-10'},
    ]);
  });

  it('merges new valid sessions with existing stored sessions', () => {
    const storage = new MemoryStorage();
    writeStoredSessions({
      'game-1': {p2: 'old-token-2'},
    }, storage);

    expect(rememberSessions(' game-1 ', [
      {playerId: 'p1', token: ' token-1 '},
      {playerId: 'p3', token: '   '},
      {playerId: ' ', token: 'ghost-token'},
    ], storage)).toEqual([
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p2', token: 'old-token-2'},
    ]);
    expect(JSON.parse(storage.getItem(sessionStorageKey) ?? '{}')).toEqual({
      'game-1': {p1: 'token-1', p2: 'old-token-2'},
    });
  });

  it('preserves existing sessions when remembering only invalid entries', () => {
    const storage = new MemoryStorage();
    writeStoredSessions({
      'game-1': {p1: 'token-1', p2: 'token-2'},
    }, storage);

    expect(rememberSessions(' game-1 ', [
      {playerId: ' p1 ', token: '   '},
      {playerId: ' ', token: 'new-token'},
    ], storage)).toEqual([
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p2', token: 'token-2'},
    ]);
    expect(sessionsForGame('game-1', storage)).toEqual([
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p2', token: 'token-2'},
    ]);
    expect(JSON.parse(storage.getItem(sessionStorageKey) ?? '{}')).toEqual({
      'game-1': {p1: 'token-1', p2: 'token-2'},
    });
  });

  it('does not throw when writes fail', () => {
    expect(() => writeStoredSessions({'game-1': {p1: 'token-1'}}, new ThrowingStorage())).not.toThrow();
    expect(rememberSessions('game-1', [{playerId: 'p1', token: 'token-1'}], new ThrowingStorage())).toEqual([
      {playerId: 'p1', token: 'token-1'},
    ]);
  });
});
