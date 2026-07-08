import {describe, expect, it} from 'vitest';
import {gameSummariesFromPayload, gameSummaryLabel, listedGames} from '../src/client/roomListOptions';

describe('client room list options', () => {
  it('builds a compact game summary label', () => {
    expect(gameSummaryLabel({
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 3,
      era: 'rail',
      status: 'playing',
      currentPlayerId: 'p2',
    })).toBe('game-1: Ada, Ben (2p) - rail round 3 - turn p2');
    expect(gameSummaryLabel({
      id: 'game-2',
      playerNames: ['Cara', 'Dev'],
      playerCount: 2,
      roundNumber: 8,
      era: 'rail',
      status: 'ended',
      currentPlayerId: 'p1',
    })).toBe('game-2: Cara, Dev (2p) - ended');
    expect(gameSummaryLabel({
      id: 'game-3',
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      roundNumber: 2,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p1',
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    })).toBe('game-3: Ada, Ben, Cara (3p) - canal round 2 - pending p2: negative income');
    expect(gameSummaryLabel({
      id: 'game-4',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      pendingDecision: {type: 'merchant_develop', playerId: 'p1'},
    })).toBe('game-4: Ada, Ben (2p) - canal round 1 - pending p1: merchant develop');
  });

  it('filters malformed game list payload entries', () => {
    expect(gameSummariesFromPayload({
      games: [
        {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
        {id: 'missing-player-count', playerNames: ['Ada'], roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-player-count', playerNames: ['Ada'], playerCount: 5, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-player-names', playerNames: ['Ada', 2], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-status', playerNames: ['Ada'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'paused'},
        {id: 'bad-pending', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'sell', playerId: 'p1'}},
        null,
      ],
    })).toEqual([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
    ]);
  });

  it('returns no summaries when the payload is not a games list', () => {
    expect(gameSummariesFromPayload(null)).toEqual([]);
    expect(gameSummariesFromPayload({games: 'not-an-array'})).toEqual([]);
  });

  it('sanitizes listed game payloads to public summary fields', () => {
    const rawNames = ['Ada', 'Ben'];
    const summaries = gameSummariesFromPayload({
      games: [{
        id: 'game-1',
        playerNames: rawNames,
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
        pendingDecision: {
          type: 'negative_income',
          playerId: 'p2',
          amountOwed: 5,
        },
        sessions: [{playerId: 'p1', token: 'secret-token'}],
        players: {p1: {handCardIds: ['p1-secret-card']}},
        cardZones: {drawDeck: ['deck-secret-card']},
      }],
    });

    rawNames.push('Mutated');

    expect(summaries).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p1',
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    }]);
    expect(summaries[0]).not.toHaveProperty('sessions');
    expect(summaries[0]).not.toHaveProperty('players');
    expect(summaries[0]).not.toHaveProperty('cardZones');
    expect(JSON.stringify(summaries[0])).not.toContain('secret');
    expect(JSON.stringify(summaries[0])).not.toContain('amountOwed');
  });

  it('attaches saved local sessions to listed games', () => {
    expect(listedGames([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
      {id: 'game-2', playerNames: ['Cara', 'Dev'], playerCount: 2, roundNumber: 2, era: 'rail', status: 'ended'},
    ], (gameId) => gameId === 'game-2' ? [{playerId: 'p1', token: 'p1-token'}] : [])).toEqual([
      {
        id: 'game-1',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
        label: 'game-1: Ada, Ben (2p) - canal round 1 - turn p1',
        savedSessions: [],
      },
      {
        id: 'game-2',
        playerNames: ['Cara', 'Dev'],
        playerCount: 2,
        roundNumber: 2,
        era: 'rail',
        status: 'ended',
        label: 'game-2: Cara, Dev (2p) - ended',
        savedSessions: [{playerId: 'p1', token: 'p1-token'}],
      },
    ]);
  });
});
