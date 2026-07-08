import {describe, expect, it} from 'vitest';
import {canSubmitSell} from '../src/client/sellOptions';
import {addIndustry, addLink, setHand, setMerchantSpace, testGame} from './helpers';

function prepareSellState() {
  const state = testGame();
  setHand(state, 'p1', ['p2-location-birmingham-1']);
  const cotton = addIndustry(state, {
    id: 'cotton-1',
    ownerPlayerId: 'p1',
    industryType: 'cotton_mill',
    specId: 'cotton_mill-1-1',
    locationId: 'birmingham',
    slotId: 'birmingham-0',
  });
  addLink(state, 'link-1', 'p1', 'birmingham-oxford');
  setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
  return {state, cotton};
}

describe('client sell options', () => {
  it('allows a valid sell submission to a connected matching merchant', () => {
    const {state, cotton} = prepareSellState();

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(true);
  });

  it('rejects sell submission with no sale steps', () => {
    const {state} = prepareSellState();

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [])).toBe(false);
  });

  it('rejects selling the same industry twice in one action', () => {
    const {state, cotton} = prepareSellState();

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(false);
  });

  it('rejects sell submission when no required beer source is available', () => {
    const {state, cotton} = prepareSellState();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(false);
  });

  it('rejects sell submission when the merchant does not accept the industry', () => {
    const {state, cotton} = prepareSellState();
    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(false);
  });

  it('rejects sell submission when the selected merchant is disconnected', () => {
    const {state, cotton} = prepareSellState();
    delete state.board.linkInstances['link-1'];
    state.board.linkLines['birmingham-oxford'] = {};

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(false);
  });
});
