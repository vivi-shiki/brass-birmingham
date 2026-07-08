import {describe, expect, it} from 'vitest';
import {
  canSubmitForActivePlayerView,
  handPlayerIdForView,
  sessionForPlayer,
  sessionNeededForActivePlayerView,
} from '../src/client/sessionOptions';
import {testGame} from './helpers';

describe('client session options', () => {
  it('finds a saved session by player id', () => {
    expect(sessionForPlayer([
      {playerId: 'p1', token: 'p1-token'},
      {playerId: 'p2', token: 'p2-token'},
    ], 'p2')).toEqual({playerId: 'p2', token: 'p2-token'});
  });

  it('returns undefined when no saved session matches the player id', () => {
    expect(sessionForPlayer([{playerId: 'p1', token: 'p1-token'}], 'p2')).toBeUndefined();
  });

  it('uses the viewer player id for the visible hand when it exists', () => {
    expect(handPlayerIdForView(testGame(), 'p2')).toBe('p2');
  });

  it('falls back to the active player for the visible hand when the viewer is missing', () => {
    expect(handPlayerIdForView(testGame(), 'missing-player')).toBe('p1');
  });

  it('does not request a session switch when the active player hand is already visible', () => {
    const state = testGame();

    expect(sessionNeededForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBeUndefined();
  });

  it('requests the active player session when the active hand is redacted and the token is known', () => {
    const state = testGame();
    state.players.p1.handCardIds = ['hidden-card-1', 'hidden-card-2'];

    expect(sessionNeededForActivePlayerView(state, [
      {playerId: 'p1', token: 'p1-token'},
      {playerId: 'p2', token: 'p2-token'},
    ])).toEqual({playerId: 'p1', token: 'p1-token'});
  });

  it('does not request the active player session when auto-follow is disabled', () => {
    const state = testGame();
    state.players.p1.handCardIds = ['hidden-card-1', 'hidden-card-2'];

    expect(sessionNeededForActivePlayerView(state, [
      {playerId: 'p1', token: 'p1-token'},
      {playerId: 'p2', token: 'p2-token'},
    ], {autoFollowActivePlayer: false})).toBeUndefined();
  });

  it('does not request a session switch when the active hand is redacted but no token is known', () => {
    const state = testGame();
    state.players.p1.handCardIds = ['hidden-card-1', 'hidden-card-2'];

    expect(sessionNeededForActivePlayerView(state, [{playerId: 'p2', token: 'p2-token'}])).toBeUndefined();
  });

  it('uses the pending decision player instead of the turn player', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p2', count: 1, merchantSpaceId: 'gloucester-0'};
    state.players.p2.handCardIds = ['hidden-card-1'];

    expect(sessionNeededForActivePlayerView(state, [
      {playerId: 'p1', token: 'p1-token'},
      {playerId: 'p2', token: 'p2-token'},
    ])).toEqual({playerId: 'p2', token: 'p2-token'});
  });

  it('does not request a session switch after the game has ended', () => {
    const state = testGame();
    state.status = 'ended';
    state.players.p1.handCardIds = ['hidden-card-1'];

    expect(sessionNeededForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBeUndefined();
  });

  it('allows normal action submission when the active hand is visible and the session is known', () => {
    const state = testGame();

    expect(canSubmitForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBe(true);
  });

  it('blocks normal action submission when the active hand is redacted', () => {
    const state = testGame();
    state.players.p1.handCardIds = ['hidden-card-1'];

    expect(canSubmitForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBe(false);
  });

  it('allows pending decision submission with a saved session even when the hand is redacted', () => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1};
    state.players.p2.handCardIds = ['hidden-card-1'];

    expect(canSubmitForActivePlayerView(state, [
      {playerId: 'p1', token: 'p1-token'},
      {playerId: 'p2', token: 'p2-token'},
    ])).toBe(true);
  });

  it('blocks pending decision submission when no session is known for the decision player', () => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1};

    expect(canSubmitForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBe(false);
  });

  it('blocks submission after the game has ended', () => {
    const state = testGame();
    state.status = 'ended';

    expect(canSubmitForActivePlayerView(state, [{playerId: 'p1', token: 'p1-token'}])).toBe(false);
  });
});
