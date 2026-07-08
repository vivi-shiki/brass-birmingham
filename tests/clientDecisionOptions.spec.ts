import {describe, expect, it} from 'vitest';
import {
  canSubmitResolveMerchantDevelop,
  canSubmitResolveNegativeIncome,
  industryLiquidationValue,
  merchantDevelopSourceLabel,
  negativeIncomeIndustryOptions,
  resolveMerchantDevelopDecisionReason,
  resolveNegativeIncomeDecisionReason,
} from '../src/client/decisionOptions';
import {addIndustry, testGame} from './helpers';

describe('client pending decision options', () => {
  it('labels merchant develop sources from legacy and multi-space decisions', () => {
    expect(merchantDevelopSourceLabel({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
    })).toBe('gloucester-0');
    expect(merchantDevelopSourceLabel({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1', 'gloucester-0'],
    })).toBe('gloucester-0, gloucester-1');
  });

  it('allows resolving a merchant develop decision with a valid develop selection', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};

    expect(canSubmitResolveMerchantDevelop(state, 'p1', ['coal_mine'])).toBe(true);
    expect(resolveMerchantDevelopDecisionReason(state, 'p1', ['coal_mine'])).toBeUndefined();
  });

  it('rejects resolving a merchant develop decision for the wrong player', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p2', count: 1, merchantSpaceId: 'gloucester-0'};

    expect(canSubmitResolveMerchantDevelop(state, 'p1', ['coal_mine'])).toBe(false);
    expect(resolveMerchantDevelopDecisionReason(state, 'p1', ['coal_mine']))
      .toBe('Pending merchant develop decision belongs to p2');
  });

  it('rejects resolving merchant develop with too few selections while developable tiles remain', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};

    expect(canSubmitResolveMerchantDevelop(state, 'p1', [])).toBe(false);
    expect(resolveMerchantDevelopDecisionReason(state, 'p1', [])).toBe('Merchant develop must remove 1 tile');
  });

  it('allows resolving merchant develop with no selections when no developable stack heads remain', () => {
    const state = testGame();
    for (const stack of Object.values(state.players.p1.industryTileStacks)) {
      stack.availableSpecIdsInOrder = [];
    }
    state.players.p1.industryTileStacks.pottery.availableSpecIdsInOrder = ['pottery-1-1'];
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};

    expect(canSubmitResolveMerchantDevelop(state, 'p1', [])).toBe(true);
  });

  it('allows resolving negative income without liquidation when cash covers the debt', () => {
    const state = testGame();
    state.players.p1.cash = 5;
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0};

    expect(canSubmitResolveNegativeIncome(state, 'p1', [])).toBe(true);
    expect(resolveNegativeIncomeDecisionReason(state, 'p1', [])).toBeUndefined();
  });

  it('rejects resolving negative income for the wrong player', () => {
    const state = testGame();
    state.players.p1.cash = 5;
    state.players.p2.cash = 5;
    state.pendingDecision = {type: 'negative_income', playerId: 'p2', amountOwed: 5, incomePlayerIndex: 1};

    expect(canSubmitResolveNegativeIncome(state, 'p1', [])).toBe(false);
    expect(resolveNegativeIncomeDecisionReason(state, 'p1', []))
      .toBe('Pending negative income decision belongs to p2');
  });

  it('rejects resolving negative income before enough available industries are selected', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 999, incomePlayerIndex: 0};
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });

    expect(canSubmitResolveNegativeIncome(state, 'p1', [cotton.id])).toBe(false);
    expect(resolveNegativeIncomeDecisionReason(state, 'p1', [cotton.id]))
      .toBe('Negative income requires removing industries until the shortfall is covered or no industries remain');
  });

  it('allows resolving negative income after all available industries are selected', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 999, incomePlayerIndex: 0};
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });

    expect(canSubmitResolveNegativeIncome(state, 'p1', [cotton.id, manufacturer.id])).toBe(true);
  });

  it('rejects resolving negative income with duplicate industry selections', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 999, incomePlayerIndex: 0};
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    expect(canSubmitResolveNegativeIncome(state, 'p1', [cotton.id, cotton.id])).toBe(false);
    expect(resolveNegativeIncomeDecisionReason(state, 'p1', [cotton.id, cotton.id]))
      .toContain('selected more than once');
  });

  it('lists only positive-value industries for negative-income liquidation controls', () => {
    const state = testGame();
    const zeroValuePottery = addIndustry(state, {
      id: 'pottery-2',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-1',
    });
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addIndustry(state, {
      id: 'opponent-cotton',
      ownerPlayerId: 'p2',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });

    expect(industryLiquidationValue(zeroValuePottery)).toBe(0);
    expect(industryLiquidationValue(cotton)).toBe(6);
    expect(negativeIncomeIndustryOptions(state, 'p1').map((industry) => industry.id)).toEqual([cotton.id]);
  });

  it('orders negative-income liquidation controls by least scoring loss and highest cash raised', () => {
    const state = testGame();
    const flippedCotton = addIndustry(state, {
      id: 'z-flipped-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    const coal = addIndustry(state, {
      id: 'a-coal',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
    });
    const manufacturer = addIndustry(state, {
      id: 'm-manufacturer',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });

    expect(negativeIncomeIndustryOptions(state, 'p1').map((industry) => industry.id)).toEqual([
      manufacturer.id,
      coal.id,
      flippedCotton.id,
    ]);
  });
});
