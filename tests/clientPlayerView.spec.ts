import {describe, expect, it} from 'vitest';
import {getIncomeLevel} from '../src/common/income';
import {
  playerHandCardIdsForView,
  playerLabelForView,
  playerNameForView,
  playerTableRowForView,
} from '../src/client/playerView';
import {testGame} from './helpers';

describe('client player view helpers', () => {
  it('formats player names and labels from the game view', () => {
    const state = testGame();

    expect(playerNameForView(state, 'p1')).toBe('Ada');
    expect(playerLabelForView(state, 'p1')).toBe('Ada (p1)');
    expect(playerNameForView(state, 'ghost')).toBe('ghost');
    expect(playerLabelForView(state, 'ghost')).toBe('ghost');
  });

  it('filters malformed hand entries for display reads', () => {
    const state = testGame();
    (state.players.p1 as unknown as {handCardIds: unknown[]}).handCardIds = [
      'p2-location-birmingham-1',
      42,
      'hidden-card-1',
    ];

    expect(playerHandCardIdsForView(state, 'p1')).toEqual([
      'p2-location-birmingham-1',
      'hidden-card-1',
    ]);
  });

  it('treats missing hand data as an empty display hand', () => {
    const state = testGame();
    delete (state.players.p1 as Partial<typeof state.players.p1>).handCardIds;

    expect(playerHandCardIdsForView(state, 'p1')).toEqual([]);
    expect(playerTableRowForView(state, 'p1').handCount).toBe(0);
  });

  it('falls back to safe row values when a turn-order player is missing', () => {
    const state = testGame();

    expect(playerTableRowForView(state, 'ghost')).toEqual({
      id: 'ghost',
      name: 'ghost',
      cash: 0,
      incomeTrackPosition: 0,
      incomeLevel: getIncomeLevel(0),
      victoryPoints: 0,
      handCount: 0,
      spentThisRound: 0,
    });
  });
});
