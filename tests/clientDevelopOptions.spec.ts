import {describe, expect, it} from 'vitest';
import {canSubmitDevelop, developOptionsForSelect, normalizeDevelopSelections} from '../src/client/developOptions';
import {addIndustry, firstHandCard, testGame} from './helpers';

describe('client develop options', () => {
  it('filters out stack heads that cannot be developed', () => {
    const state = testGame();

    expect(developOptionsForSelect(state.players.p1, [], 0)).not.toContain('pottery');
  });

  it('allows developing the same industry twice when the next stack head is developable', () => {
    const state = testGame();

    expect(developOptionsForSelect(state.players.p1, ['coal_mine'], 1)).toContain('coal_mine');
  });

  it('removes a repeated industry option when no second developable tile remains', () => {
    const state = testGame();
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];

    expect(developOptionsForSelect(state.players.p1, ['coal_mine'], 1)).not.toContain('coal_mine');
  });

  it('normalizes merchant develop selections to legal sequential stack heads', () => {
    const state = testGame();
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];

    const normalized = normalizeDevelopSelections(state.players.p1, ['pottery', 'coal_mine'], 2);

    expect(normalized).toHaveLength(2);
    expect(normalized).not.toContain('pottery');
    expect(normalized.filter((industryType) => industryType === 'coal_mine')).toHaveLength(1);
  });

  it('allows a valid develop command with an available card and market iron', () => {
    const state = testGame();

    expect(canSubmitDevelop(state, 'p1', firstHandCard(state, 'p1'), ['coal_mine'])).toBe(true);
  });

  it('rejects develop when the player cannot afford required market iron', () => {
    const state = testGame();
    state.players.p1.cash = 0;

    expect(canSubmitDevelop(state, 'p1', firstHandCard(state, 'p1'), ['coal_mine'])).toBe(false);
  });

  it('allows develop with no cash when a selected free iron source is available', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    const iron = addIndustry(state, {
      id: 'free-iron',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });

    expect(canSubmitDevelop(state, 'p1', firstHandCard(state, 'p1'), ['coal_mine'], [
      {kind: 'industry_tile', industryInstanceId: iron.id, resourceType: 'iron'},
    ])).toBe(true);
  });

  it('rejects develop for a stack head that cannot be developed', () => {
    const state = testGame();

    expect(canSubmitDevelop(state, 'p1', firstHandCard(state, 'p1'), ['pottery'])).toBe(false);
  });
});
