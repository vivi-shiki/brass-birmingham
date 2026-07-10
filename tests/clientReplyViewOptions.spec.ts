import {describe, expect, it} from 'vitest';
import {viewerUpdateFromReply} from '../src/client/replyViewOptions';

describe('client reply view options', () => {
  it('uses single-session replies as player views', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      session: {playerId: ' p2 '},
    })).toEqual({kind: 'player', playerId: 'p2'});
  });

  it('uses the first valid create-game session as the player view', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p1: {id: 'p1'}, p2: {id: 'p2'}}},
      sessions: [{playerId: '   '}, {playerId: ' p1 '}],
    })).toEqual({kind: 'player', playerId: 'p1'});
  });

  it('ignores session player ids that are not present in the returned game', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1'},
      session: {playerId: 'p1'},
    })).toEqual({kind: 'observer'});
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      session: {playerId: 'p1'},
    })).toEqual({kind: 'observer'});
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p1: null}},
      session: {playerId: 'p1'},
    })).toEqual({kind: 'observer'});
  });

  it('skips invalid create-game sessions before applying a player view', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      sessions: [{playerId: 'p1'}, {playerId: ' p2 '}],
    })).toEqual({kind: 'player', playerId: 'p2'});
  });

  it('ignores unsupported player seats even when they are present in the returned game', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p5: {id: 'p5'}}},
      session: {playerId: 'p5'},
    })).toEqual({kind: 'observer'});
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p5: {id: 'p5'}, p2: {id: 'p2'}}},
      sessions: [{playerId: 'p5'}, {playerId: 'p2'}],
    })).toEqual({kind: 'player', playerId: 'p2'});
  });

  it('clears stale player views for observer replies', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1'},
    })).toEqual({kind: 'observer'});
  });

  it('can preserve the current view for command ACKs without session data', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1'},
    }, {preserveViewerWithoutSession: true})).toEqual({kind: 'unchanged'});
  });

  it('still applies acknowledged player views when viewer preservation is enabled', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      session: {playerId: ' p2 '},
    }, {preserveViewerWithoutSession: true})).toEqual({kind: 'player', playerId: 'p2'});
  });

  it('preserves the current view for invalid player sessions when requested', () => {
    expect(viewerUpdateFromReply({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      session: {playerId: 'p1'},
    }, {preserveViewerWithoutSession: true})).toEqual({kind: 'unchanged'});
  });

  it('does not change the viewer for failed replies or replies without game state', () => {
    expect(viewerUpdateFromReply({ok: false})).toEqual({kind: 'unchanged'});
    expect(viewerUpdateFromReply({ok: true, session: {playerId: 'p1'}})).toEqual({kind: 'unchanged'});
  });
});
