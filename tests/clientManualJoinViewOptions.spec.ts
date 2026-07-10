import {describe, expect, it} from 'vitest';
import {manualJoinViewerUpdate} from '../src/client/manualJoinViewOptions';

describe('client manual join view options', () => {
  it('applies player views only after successful join ACKs with game state', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
      session: {playerId: ' p2 '},
    }, ' p2 ')).toEqual({
      apply: true,
      playerId: 'p2',
    });
  });

  it('applies observer views only after successful observer join ACKs with game state', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1'},
    })).toEqual({
      apply: true,
      playerId: undefined,
    });
  });

  it('does not override acknowledged player sessions with mismatched manual player requests', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p1: {id: 'p1'}, p2: {id: 'p2'}}},
      session: {playerId: 'p1'},
    }, 'p2')).toEqual({apply: false});
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
    }, 'p2')).toEqual({apply: false});
  });

  it('does not override acknowledged player sessions with observer manual views', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p1: {id: 'p1'}}},
      session: {playerId: 'p1'},
    })).toEqual({apply: false});
  });

  it('does not apply manual views before failed join ACKs', () => {
    expect(manualJoinViewerUpdate({
      ok: false,
    }, 'p1')).toEqual({apply: false});
  });

  it('does not apply manual views for ACKs without game state', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
    }, 'p1')).toEqual({apply: false});
  });

  it('does not apply player views for ACKs without the requested player', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1'},
    }, 'p1')).toEqual({apply: false});
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p2: {id: 'p2'}}},
    }, 'p1')).toEqual({apply: false});
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p1: null}},
    }, 'p1')).toEqual({apply: false});
  });

  it('does not apply player views for unsupported player seats even when ACKed', () => {
    expect(manualJoinViewerUpdate({
      ok: true,
      game: {id: 'game-1', players: {p5: {id: 'p5'}}},
      session: {playerId: 'p5'},
    }, 'p5')).toEqual({apply: false});
  });
});
