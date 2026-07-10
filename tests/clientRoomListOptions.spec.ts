import {describe, expect, it} from 'vitest';
import {gameSummariesFromPayload, gameSummaryLabel, listedGames, savedSessionLabel} from '../src/client/roomListOptions';

describe('client room list options', () => {
  it('builds a compact game summary label', () => {
    expect(gameSummaryLabel({
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 3,
      era: 'rail',
      status: 'playing',
      updatedAt: '2026-01-01T00:00:02.000Z',
      connectedClientCount: 2,
      connectedPlayerIds: ['p2'],
      currentPlayerId: 'p2',
    })).toBe('game-1: Ada, Ben (2p) - rail round 3 - updated 2026-01-01T00:00:02.000Z - 2 connected - online p2 - turn p2');
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
        {id: 'bad-pending-null', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: null},
        {id: 'bad-pending-array', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: [{type: 'negative_income', playerId: 'p1'}]},
        {id: 'bad-pending-player', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'negative_income', playerId: '   '}},
        {id: 'bad-pending-player-seat', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'negative_income', playerId: 'p4'}},
        {id: 'bad-created-at', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', createdAt: '2026-01-01'},
        {id: 'bad-updated-at', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', updatedAt: '2026-01-01T00:00:00.000+09:00'},
        {id: 'bad-connected-player-ids', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', connectedPlayerIds: 'p1'},
        {id: 'bad-ended-winner', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 8, era: 'rail', status: 'ended', winners: ['p3']},
        {id: 'bad-ended-score', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 8, era: 'rail', status: 'ended', victoryPointsByPlayer: {p1: 1}},
        {id: 'unknown-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'secret_variant'},
        {id: 'intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'introductory_canal_only'},
        {id: 'rail-intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'rail', status: 'playing', variant: 'introductory_canal_only'},
        null,
      ],
    })).toEqual([
      {id: 'game-1', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
      {id: 'bad-created-at', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'bad-updated-at', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'bad-connected-player-ids', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'unknown-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing'},
      {id: 'intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', variant: 'introductory_canal_only'},
      {id: 'rail-intro-variant', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'rail', status: 'playing'},
    ]);
  });

  it('keeps parsing room lists after malformed pending-decision objects', () => {
    expect(gameSummariesFromPayload({
      games: [
        {id: 'bad-pending-null', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: null},
        {id: 'bad-pending-number', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: 7},
        {id: 'good-game', playerNames: ['Ada', 'Ben'], playerCount: 2, roundNumber: 1, era: 'canal', status: 'playing', pendingDecision: {type: 'negative_income', playerId: 'p2'}},
      ],
    })).toEqual([{
      id: 'good-game',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      pendingDecision: {type: 'negative_income', playerId: 'p2'},
    }]);
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
        connectedPlayerIds: [' p2 ', 'p2', 'p3', ''],
        currentPlayerId: ' p1 ',
      }, {
        id: '\tgame-2\n',
        playerNames: [' Cara ', ' Dev '],
        playerCount: 2,
        roundNumber: 2,
        era: 'rail',
        status: 'playing',
        pendingDecision: {type: 'merchant_develop', playerId: ' p2 '},
        connectedPlayerIds: ['p2', 'p1'],
      }],
    })).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedClientCount: 3,
      connectedPlayerIds: ['p2'],
      currentPlayerId: 'p1',
    }, {
      id: 'game-2',
      playerNames: ['Cara', 'Dev'],
      playerCount: 2,
      roundNumber: 2,
      era: 'rail',
      status: 'playing',
      connectedPlayerIds: ['p1', 'p2'],
      pendingDecision: {type: 'merchant_develop', playerId: 'p2'},
    }]);
  });

  it('keeps public online player seats without leaking session data', () => {
    const summaries = gameSummariesFromPayload({
      games: [{
        id: 'game-1',
        playerNames: ['Ada', 'Ben', 'Cara'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 4,
        connectedPlayerIds: ['p3', 'p1', 'p3', 'p4', ' observer ', 'p2'],
        sessions: [{playerId: 'p1', token: 'secret-token'}],
      }],
    });

    expect(summaries).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedClientCount: 4,
      connectedPlayerIds: ['p1', 'p2', 'p3'],
    }]);
    expect(gameSummaryLabel(summaries[0])).toBe('game-1: Ada, Ben, Cara (3p) - canal round 1 - 4 connected - online p1, p2, p3');
    expect(JSON.stringify(summaries[0])).not.toContain('secret-token');
  });

  it('drops impossible online player seats while keeping public connection counts', () => {
    const summaries = gameSummariesFromPayload({
      games: [{
        id: 'empty-game',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 0,
        connectedPlayerIds: ['p1'],
      }, {
        id: 'one-client-many-seats',
        playerNames: ['Cara', 'Dev', 'Eli'],
        playerCount: 3,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedClientCount: 1,
        connectedPlayerIds: ['p1', 'p2'],
      }, {
        id: 'unknown-count',
        playerNames: ['Fay', 'Gia'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        connectedPlayerIds: ['p2'],
      }],
    });

    expect(summaries).toEqual([{
      id: 'empty-game',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedClientCount: 0,
    }, {
      id: 'one-client-many-seats',
      playerNames: ['Cara', 'Dev', 'Eli'],
      playerCount: 3,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedClientCount: 1,
    }, {
      id: 'unknown-count',
      playerNames: ['Fay', 'Gia'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      connectedPlayerIds: ['p2'],
    }]);
    expect(gameSummaryLabel(summaries[0])).toBe('empty-game: Ada, Ben (2p) - canal round 1 - 0 connected');
    expect(gameSummaryLabel(summaries[1])).toBe('one-client-many-seats: Cara, Dev, Eli (3p) - canal round 1 - 1 connected');
    expect(gameSummaryLabel(summaries[2])).toBe('unknown-count: Fay, Gia (2p) - canal round 1 - online p2');
  });

  it('keeps strict ISO activity timestamps from public summaries', () => {
    expect(gameSummariesFromPayload({
      games: [{
        id: 'game-1',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:02.000Z',
      }],
    })).toEqual([{
      id: 'game-1',
      playerNames: ['Ada', 'Ben'],
      playerCount: 2,
      roundNumber: 1,
      era: 'canal',
      status: 'playing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:02.000Z',
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

  it('orders listed games by latest activity when timestamps are available', () => {
    expect(listedGames([
      {
        id: 'old-game',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'untimed-game',
        playerNames: ['Cara', 'Dev'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
      },
      {
        id: 'fresh-game',
        playerNames: ['Eli', 'Fay'],
        playerCount: 2,
        roundNumber: 2,
        era: 'canal',
        status: 'playing',
        updatedAt: '2026-01-01T00:00:02.000Z',
      },
    ], (gameId) => gameId === 'fresh-game' ? [{playerId: 'p2', token: 'fresh-token'}] : [])).toEqual([
      {
        id: 'fresh-game',
        playerNames: ['Eli', 'Fay'],
        playerCount: 2,
        roundNumber: 2,
        era: 'canal',
        status: 'playing',
        updatedAt: '2026-01-01T00:00:02.000Z',
        label: 'fresh-game: Eli, Fay (2p) - canal round 2 - updated 2026-01-01T00:00:02.000Z',
        savedSessions: [{playerId: 'p2', token: 'fresh-token'}],
      },
      {
        id: 'old-game',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        updatedAt: '2026-01-01T00:00:00.000Z',
        label: 'old-game: Ada, Ben (2p) - canal round 1 - updated 2026-01-01T00:00:00.000Z',
        savedSessions: [],
      },
      {
        id: 'untimed-game',
        playerNames: ['Cara', 'Dev'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        label: 'untimed-game: Cara, Dev (2p) - canal round 1',
        savedSessions: [],
      },
    ]);
  });

  it('orders listed games by creation time and id when update timestamps are unavailable', () => {
    expect(listedGames([
      {
        id: 'z-created-tie',
        playerNames: ['Ada', 'Ben'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'untimed-game',
        playerNames: ['Cara', 'Dev'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
      },
      {
        id: 'old-created-game',
        playerNames: ['Eli', 'Fay'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'fresh-created-game',
        playerNames: ['Gia', 'Hal'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      {
        id: 'a-created-tie',
        playerNames: ['Ivy', 'Jay'],
        playerCount: 2,
        roundNumber: 1,
        era: 'canal',
        status: 'playing',
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ], () => []).map((game) => game.id)).toEqual([
      'fresh-created-game',
      'a-created-tie',
      'z-created-tie',
      'old-created-game',
      'untimed-game',
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

  it('drops duplicate saved-session tokens from listed games', () => {
    expect(listedGames([
      {id: 'game-1', playerNames: ['Ada', 'Ben', 'Cara'], playerCount: 3, roundNumber: 1, era: 'canal', status: 'playing', currentPlayerId: 'p1'},
    ], () => [
      {playerId: 'p2', token: 'shared-token'},
      {playerId: 'p1', token: ' shared-token '},
      {playerId: 'p3', token: 'unique-token'},
    ])[0].savedSessions).toEqual([
      {playerId: 'p1', token: 'shared-token'},
      {playerId: 'p3', token: 'unique-token'},
    ]);
  });

  it('labels saved-session joins with public player names when available', () => {
    const game = {
      id: 'game-1',
      playerNames: ['Ada', 'Ben', 'Cara'],
      playerCount: 3,
      roundNumber: 1,
      era: 'canal' as const,
      status: 'playing' as const,
      currentPlayerId: 'p1',
    };

    expect(savedSessionLabel(game, {playerId: ' p2 ', token: 'token-2'}))
      .toBe('Join game-1 as Ben (p2)');
    expect(savedSessionLabel({...game, playerNames: ['Ada', '   ', 'Cara']}, {playerId: 'p2', token: 'token-2'}))
      .toBe('Join game-1 as p2');
    expect(savedSessionLabel(game, {playerId: 'observer', token: 'token'}))
      .toBe('Join game-1 as observer');
  });
});
