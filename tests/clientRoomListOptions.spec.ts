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
      connectedClientCount: 2,
      currentPlayerId: 'p2',
    })).toBe('game-1: Ada, Ben (2p) - rail round 3 - 2 connected - turn p2');
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
      id: 'game-2',
      playerNames: ['Cara', 'Dev'],
      playerCount: 2,
      roundNumber: 8,
      era: 'rail',
      status: 'ended',
      winners: ['p2'],
      connectedClientCount: 0,
      victoryPointsByPlayer: {p1: 92, p2: 97},
    })).toBe('game-2: Cara, Dev (2p) - ended - 0 connected - winner p2 - VP p1 92, p2 97');
    expect(gameSummaryLabel({
      id: 'game-2',
      playerNames: ['Cara', 'Dev'],
      playerCount: 2,
      roundNumber: 8,
      era: 'rail',
      status: 'ended',
      winners: ['p1', 'p2'],
      victoryPointsByPlayer: {p1: 97, p2: 97},
    })).toBe('game-2: Cara, Dev (2p) - ended - winners p1, p2 - VP p1 97, p2 97');
    expect(gameSummaryLabel({
      id: 'game-2',
      playerNames: ['Cara', 'Dev', 'Eli'],
      playerCount: 3,
      roundNumber: 9,
      era: 'rail',
      status: 'ended',
      victoryPointsByPlayer: {p1: 84, p2: 101, p3: 99},
    })).toBe('game-2: Cara, Dev, Eli (3p) - ended - VP p1 84, p2 101, p3 99');
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
    expect(gameSummaryLabel({
      id: 'game-5',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 8,
      era: 'canal',
      status: 'playing',
      variant: 'introductory_canal_only',
      currentPlayerId: 'p2',
    })).toBe('game-5: Ada, Ben (2p intro) - canal round 8 - turn p2');
  });

  it('filters malformed game list payload entries', () => {
    expect(gameSummariesFromPayload({
      games: [
        {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
        {id: '   ', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'missing-player-count', playerNames: ['Ada'], roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-player-count', playerNames: ['Ada'], playerCount: 5, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-player-name-count', playerNames: ['Ada'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-player-names', playerNames: ['Ada', 2], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-blank-player-name', playerNames: ['Ada', '   '], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
        {id: 'bad-era', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'future', status: 'playing'},
        {id: 'bad-round-zero', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 0, era: 'canal', status: 'playing'},
        {id: 'bad-round-fraction', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1.5, era: 'canal', status: 'playing'},
        {id: 'bad-status', playerNames: ['Ada'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'paused'},
        {id: 'bad-current-player', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: '   '},
        {id: 'bad-current-player-seat', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p3'},
        {id: 'bad-pending', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'sell', playerId: 'p1'}},
        {id: 'bad-pending-player', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'negative_income', playerId: '   '}},
        {id: 'bad-pending-player-seat', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'negative_income', playerId: 'p4'}},
        {id: 'bad-ended-winner', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 8, era: 'rail', status: 'ended', winners: ['p3']},
        {id: 'bad-ended-score', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 8, era: 'rail', status: 'ended', victoryPointsByPlayer: {p1: 1}},
        {id: 'unknown-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'secret_variant'},
        {id: 'intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'introductory_canal_only'},
        null,
      ],
    })).toEqual([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
      {id: 'unknown-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'introductory_canal_only'},
    ]);
  });

  it('trims public game summary text fields', () => {
    expect(gameSummariesFromPayload({
      games: [{
        id: ' game-1 ',
        playerNames: [' Ada ', ' Ben '],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 3,
        currentPlayerId: ' p1 ',
      }, {
        id: '\tgame-2\n',
        playerNames: [' Cara ', ' Dev '],
        playerCount: 2,
        roundNumber: 2,
        era: 'rail',
        status: 'playing',
        pendingDecision: {type: 'merchant_develop', playerId: ' p2 '},
      }],
    })).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedClientCount: 3,
      currentPlayerId: 'p1',
    }, {
      id: 'game-2',
      playerNames: ['Cara', 'Dev'],
      playerCount: 2,
      roundNumber: 2,
      era: 'rail',
      status: 'playing',
      pendingDecision: {type: 'merchant_develop', playerId: 'p2'},
    }]);
  });

  it('drops stale active-player and pending-decision fields from ended summaries', () => {
    expect(gameSummariesFromPayload({
      games: [{
        id: ' ended-game ',
        playerNames: [' Ada ', ' Ben '],
        playerCount: 2,
        roundNumber: 8,
        era: 'rail',
        status: 'ended',
        currentPlayerId: 'ghost-player',
        winners: [' p2 ', 'p2'],
        victoryPointsByPlayer: {p1: 78, p2: 91, ghost: 1000},
        pendingDecision: {type: 'secret_decision', playerId: 'ghost-player'},
      }],
    })).toEqual([{
      id: 'ended-game',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 8,
      era: 'rail',
      status: 'ended',
      winners: ['p2'],
      victoryPointsByPlayer: {p1: 78, p2: 91},
    }]);
  });

  it('drops stale result fields from playing summaries', () => {
    expect(gameSummariesFromPayload({
      games: [{
        id: 'playing-game',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
        winners: ['p2'],
        victoryPointsByPlayer: {p1: 5, p2: 7},
      }],
    })).toEqual([{
      id: 'playing-game',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p1',
    }]);
  });

  it('drops malformed connected-client counts from public summaries', () => {
    expect(gameSummariesFromPayload({
      games: [{
        id: 'negative-count',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: -1,
      }, {
        id: 'fractional-count',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 1.5,
      }, {
        id: 'string-count',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: '2',
      }, {
        id: 'valid-count',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 2,
      }],
    })).toEqual([
      {id: 'negative-count', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'fractional-count', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'string-count', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'valid-count', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', connectedClientCount: 2},
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
        variant: 'introductory_canal_only',
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
      variant: 'introductory_canal_only',
      currentPlayerId: 'p1',
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    }]);
    expect(summaries[0]).not.toHaveProperty('sessions');
    expect(summaries[0]).not.toHaveProperty('players');
    expect(summaries[0]).not.toHaveProperty('cardZones');
    expect(JSON.stringify(summaries[0])).not.toContain('secret');
    expect(JSON.stringify(summaries[0])).not.toContain('amountOwed');
  });

  it('sanitizes merchant develop summaries without merchant-space details', () => {
    const summaries = gameSummariesFromPayload({
      games: [{
        id: 'game-1',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
        pendingDecision: {
          type: 'merchant_develop',
          playerId: 'p1',
          count: 2,
          merchantSpaceId: 'gloucester-0',
          merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
          sessionToken: 'secret-token',
        },
        sessions: [{playerId: 'p1', token: 'secret-token'}],
      }],
    });

    expect(summaries).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      currentPlayerId: 'p1',
      pendingDecision: {type: 'merchant_develop', playerId: 'p1'},
    }]);
    const pendingDecision = summaries[0]?.pendingDecision as Record<string, unknown>;
    expect(pendingDecision).not.toHaveProperty('count');
    expect(pendingDecision).not.toHaveProperty('merchantSpaceId');
    expect(pendingDecision).not.toHaveProperty('merchantSpaceIds');
    expect(JSON.stringify(summaries[0])).not.toContain('gloucester-0');
    expect(JSON.stringify(summaries[0])).not.toContain('secret-token');
  });

  it('attaches saved local sessions to listed games', () => {
    expect(listedGames([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
      {id: 'game-2', playerNames: ['Cara', 'Dev'], playerCount: 2, roundNumber: 2, era: 'canal', status: 'ended', variant: 'introductory_canal_only'},
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
        era: 'canal',
        status: 'ended',
        variant: 'introductory_canal_only',
        label: 'game-2: Cara, Dev (2p intro) - ended',
        savedSessions: [{playerId: 'p1', token: 'p1-token'}],
      },
    ]);
  });

  it('filters saved local sessions to valid players for each listed game', () => {
    expect(listedGames([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
      {id: 'game-2', playerNames: ['Ada', 'Ben', 'Cara'], playerCount: 3, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p3'},
    ], (gameId) => gameId === 'game-1'
      ? [
          {playerId: ' p1 ', token: ' token-1 '},
          {playerId: 'p1', token: 'new-token-1'},
          {playerId: 'p3', token: 'wrong-game-player'},
          {playerId: 'p2', token: '   '},
          null as unknown as {playerId: string; token: string},
        ]
      : [
          {playerId: 'p3', token: 'token-3'},
          {playerId: 'p4', token: 'wrong-game-player'},
        ])).toEqual([
      {
        id: 'game-1',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p1',
        label: 'game-1: Ada, Ben (2p) - canal round 1 - turn p1',
        savedSessions: [{playerId: 'p1', token: 'new-token-1'}],
      },
      {
        id: 'game-2',
        playerNames: ['Ada', 'Ben', 'Cara'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        currentPlayerId: 'p3',
        label: 'game-2: Ada, Ben, Cara (3p) - canal round 1 - turn p3',
        savedSessions: [{playerId: 'p3', token: 'token-3'}],
      },
    ]);
  });

  it('orders saved local sessions by player seat instead of storage insertion order', () => {
    expect(listedGames([
      {id: 'game-1', playerNames: ['Ada', 'Ben', 'Cara', 'Dev'], playerCount: 4, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
    ], () => [
      {playerId: 'p3', token: 'token-3'},
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p4', token: 'token-4'},
      {playerId: 'p2', token: 'token-2'},
    ])[0].savedSessions).toEqual([
      {playerId: 'p1', token: 'token-1'},
      {playerId: 'p2', token: 'token-2'},
      {playerId: 'p3', token: 'token-3'},
      {playerId: 'p4', token: 'token-4'},
    ]);
  });
});
