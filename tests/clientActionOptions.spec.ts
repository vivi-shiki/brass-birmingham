import {describe, expect, it} from 'vitest';
import {
  canLoan,
  canScout,
  canSubmitLoan,
  canSubmitPass,
  canSubmitScout,
  normalizeScoutCardSelection,
  scoutCardOptionsForSelect,
} from '../src/client/actionOptions';
import {staticConfig} from '../src/common/staticData';
import {firstHandCard, setHand, testGame} from './helpers';

function incomeTrackPositionForLevel(incomeLevel: number): number {
  const position = staticConfig.incomeTrack.positions.find((entry) => entry.incomeLevel === incomeLevel)?.position;
  if (position === undefined) {
    throw new Error(`Missing income level ${incomeLevel}`);
  }
  return position;
}

describe('client action availability options', () => {
  it('allows Pass only with a current hand card', () => {
    const state = testGame();

    expect(canSubmitPass(state, 'p1', firstHandCard(state, 'p1'))).toBe(true);
    expect(canSubmitPass(state, 'p1', 'missing-card')).toBe(false);
  });

  it('disables Loan when the income penalty would go below the minimum income level', () => {
    const state = testGame();

    state.players.p1.incomeTrackPosition = incomeTrackPositionForLevel(-7);
    expect(canLoan(state, 'p1')).toBe(true);

    state.players.p1.incomeTrackPosition = incomeTrackPositionForLevel(-8);
    expect(canLoan(state, 'p1')).toBe(false);
  });

  it('allows Loan only when the selected card can be discarded for the action', () => {
    const state = testGame();

    expect(canSubmitLoan(state, 'p1', firstHandCard(state, 'p1'))).toBe(true);
    expect(canSubmitLoan(state, 'p1', 'missing-card')).toBe(false);
  });

  it('allows Loan when any hand card can be discarded', () => {
    const state = testGame();
    setHand(state, 'p1', ['p4-location-derby-1', 'p2-location-birmingham-1']);

    expect(canSubmitLoan(state, 'p1', 'p4-location-derby-1')).toBe(false);
    expect(canSubmitLoan(state, 'p1', 'p2-location-birmingham-1')).toBe(true);
    expect(canLoan(state, 'p1')).toBe(true);
  });

  it('disables Loan outside the active ordinary turn', () => {
    const state = testGame();

    expect(canLoan(state, 'p2')).toBe(false);
  });

  it('disables Loan while a pending decision blocks ordinary actions', () => {
    const state = testGame();
    state.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    expect(canLoan(state, 'p1')).toBe(false);
  });

  it('disables Loan when the player has no card to discard', () => {
    const state = testGame();
    setHand(state, 'p1', []);

    expect(canLoan(state, 'p1')).toBe(false);
  });

  it('treats missing hand data as no available Loan or Scout options', () => {
    const state = testGame();
    delete (state.players.p1 as Partial<typeof state.players.p1>).handCardIds;

    expect(() => canLoan(state, 'p1')).not.toThrow();
    expect(() => canScout(state, 'p1')).not.toThrow();
    expect(() => scoutCardOptionsForSelect(state, 'p1', ['', '', ''], 0)).not.toThrow();
    expect(canLoan(state, 'p1')).toBe(false);
    expect(canScout(state, 'p1')).toBe(false);
    expect(canSubmitScout(state, 'p1', ['p2-location-birmingham-1', 'p2-location-cannock-1', 'p2-location-dudley-1']))
      .toBe(false);
    expect(scoutCardOptionsForSelect(state, 'p1', ['', '', ''], 0)).toEqual([]);
  });

  it('allows Scout with three distinct non-wild hand cards', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);

    expect(canSubmitScout(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ])).toBe(true);
  });

  it('rejects Scout with duplicate selected cards', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);

    expect(canSubmitScout(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-birmingham-1',
      'p2-location-dudley-1',
    ])).toBe(false);
  });

  it('allows Scout when dirty hand data still has three unique non-wild cards', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
      'p2-location-worcester-1',
    ]);

    expect(canScout(state, 'p1')).toBe(true);
    expect(scoutCardOptionsForSelect(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ], 0)).toEqual([
      'p2-location-birmingham-1',
      'p2-location-worcester-1',
    ]);
  });

  it('disables Scout while the player holds a wild card', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1']);

    expect(canScout(state, 'p1')).toBe(false);
    expect(scoutCardOptionsForSelect(state, 'p1', ['', '', ''], 0)).toEqual([]);
  });

  it('disables Scout outside the active ordinary turn', () => {
    const state = testGame();
    setHand(state, 'p2', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);

    expect(canScout(state, 'p2')).toBe(false);
    expect(scoutCardOptionsForSelect(state, 'p2', ['', '', ''], 0)).toEqual([]);
  });

  it('disables Scout while a pending decision blocks ordinary actions', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);
    state.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    expect(canScout(state, 'p1')).toBe(false);
    expect(scoutCardOptionsForSelect(state, 'p1', ['', '', ''], 0)).toEqual([]);
  });

  it('disables Scout when either wild card pool is empty', () => {
    const state = testGame();

    state.cardZones.wildLocationPool = [];
    expect(canScout(state, 'p1')).toBe(false);

    state.cardZones.wildLocationPool = ['wild-location-1'];
    state.cardZones.wildIndustryPool = [];
    expect(canScout(state, 'p1')).toBe(false);
  });

  it('disables Scout when dirty wild card pools are missing', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);

    delete (state.cardZones as Partial<typeof state.cardZones>).wildLocationPool;
    expect(() => canScout(state, 'p1')).not.toThrow();
    expect(canScout(state, 'p1')).toBe(false);

    state.cardZones.wildLocationPool = ['wild-location-1'];
    delete (state as Partial<typeof state>).cardZones;
    expect(() => canScout(state, 'p1')).not.toThrow();
    expect(canScout(state, 'p1')).toBe(false);
    expect(scoutCardOptionsForSelect(state, 'p1', ['', '', ''], 0)).toEqual([]);
  });

  it('keeps Scout card selects distinct while preserving the current value', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
      'p2-location-worcester-1',
    ]);
    const selected = ['p2-location-birmingham-1', 'p2-location-cannock-1', 'p2-location-dudley-1'];

    expect(scoutCardOptionsForSelect(state, 'p1', selected, 0)).toEqual([
      'p2-location-birmingham-1',
      'p2-location-worcester-1',
    ]);
  });

  it('normalizes Scout selections to three unique visible hand cards', () => {
    const state = testGame();
    setHand(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
      'p2-location-worcester-1',
    ]);

    expect(normalizeScoutCardSelection(state, 'p1', ['', '', ''])).toEqual([
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);
    expect(normalizeScoutCardSelection(state, 'p1', [
      'p2-location-cannock-1',
      'p2-location-birmingham-1',
      'p2-location-dudley-1',
    ])).toEqual([
      'p2-location-cannock-1',
      'p2-location-birmingham-1',
      'p2-location-dudley-1',
    ]);
    expect(normalizeScoutCardSelection(state, 'p1', [
      'p2-location-cannock-1',
      'p2-location-cannock-1',
      'missing-card',
    ])).toEqual([
      'p2-location-cannock-1',
      'p2-location-birmingham-1',
      'p2-location-dudley-1',
    ]);
  });

  it('normalizes Scout selections to empty when Scout is unavailable', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1']);

    expect(normalizeScoutCardSelection(state, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'wild-location-1',
    ])).toEqual([]);
  });
});
