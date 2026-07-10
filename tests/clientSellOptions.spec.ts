import {describe, expect, it} from 'vitest';
import {
  addSellStepDraft,
  canSubmitSell,
  merchantSpacesForSellIndustry,
  normalizeSellStepDrafts,
  sellableIndustriesForPlayer,
  sellableIndustriesForSellStep,
  type SellStepDraft,
} from '../src/client/sellOptions';
import {applyCommand} from '../src/common/gameEngine';
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

function prepareMultiSellState() {
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
  const manufacturer = addIndustry(state, {
    id: 'manufacturer-3',
    ownerPlayerId: 'p1',
    industryType: 'manufacturer',
    specId: 'manufacturer-3-1',
    locationId: 'birmingham',
    slotId: 'birmingham-1',
  });
  addIndustry(state, {
    id: 'opponent-cotton',
    ownerPlayerId: 'p2',
    industryType: 'cotton_mill',
    specId: 'cotton_mill-1-2',
    locationId: 'worcester',
    slotId: 'worcester-0',
  });
  addIndustry(state, {
    id: 'flipped-pottery',
    ownerPlayerId: 'p1',
    industryType: 'pottery',
    specId: 'pottery-1-1',
    locationId: 'coventry',
    slotId: 'coventry-0',
    flipped: true,
  });
  addLink(state, 'link-1', 'p1', 'birmingham-oxford');
  setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
  setMerchantSpace(state, 'oxford-1', 'oxford-manufacturer-0', false);
  return {state, cotton, manufacturer};
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

  it('rejects sell submission while a pending decision blocks normal actions', () => {
    const {state, cotton} = prepareSellState();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0};

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(false);
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

  it('rejects explicit beer source count mismatches', () => {
    const {state, cotton} = prepareSellState();

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0', beerSources: []},
    ])).toBe(false);
  });

  it('allows zero-beer manufacturer sales without selecting beer', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-3',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-3-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-0'},
    ])).toBe(true);
    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [
      {
        industryInstanceId: manufacturer.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [{
          kind: 'merchant_beer',
          merchantSpaceId: 'oxford-0',
          merchantTileInstanceId: 'oxford-manufacturer-0',
        }],
      },
    ])).toBe(false);
  });

  it('allows two-beer sales only after selecting both beer sources', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-5',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-5-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);
    const merchantBeer = {
      kind: 'merchant_beer' as const,
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-manufacturer-0',
    };
    const breweryBeer = {
      kind: 'industry_tile' as const,
      industryInstanceId: brewery.id,
      resourceType: 'beer' as const,
    };
    const sale = {
      industryInstanceId: manufacturer.id,
      merchantSpaceId: 'oxford-0',
      beerSources: [merchantBeer, breweryBeer],
    };

    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [{
      ...sale,
      beerSources: [merchantBeer],
    }])).toBe(false);
    expect(canSubmitSell(state, 'p1', 'p2-location-birmingham-1', [sale])).toBe(true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [sale],
    });

    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: merchantBeer,
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: breweryBeer,
      byPlayerId: 'p1',
      reason: 'sell',
    });
  });

  it('lists only active own industries with a legal merchant target', () => {
    const {state, cotton, manufacturer} = prepareMultiSellState();

    expect(sellableIndustriesForPlayer(state, 'p1').map((industry) => industry.id)).toEqual([
      cotton.id,
      manufacturer.id,
    ]);
    expect(merchantSpacesForSellIndustry(state, cotton.id).map((space) => space.id)).toEqual(['oxford-0']);
    expect(merchantSpacesForSellIndustry(state, manufacturer.id).map((space) => space.id)).toEqual(['oxford-1']);
  });

  it('keeps the current sale industry selectable while excluding industries selected by other sale steps', () => {
    const {state, cotton, manufacturer} = prepareMultiSellState();
    const sellableIndustries = sellableIndustriesForPlayer(state, 'p1');
    const steps: SellStepDraft[] = [
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: '', beerTwo: ''},
      {industryId: manufacturer.id, merchantSpaceId: 'oxford-1', beerOne: '', beerTwo: ''},
    ];

    expect(sellableIndustriesForSellStep(sellableIndustries, steps, 0).map((industry) => industry.id)).toEqual([cotton.id]);
    expect(sellableIndustriesForSellStep(sellableIndustries, steps, 1).map((industry) => industry.id)).toEqual([manufacturer.id]);
  });

  it('normalizes stale or duplicate sale drafts to valid industry and merchant choices', () => {
    const {state, cotton, manufacturer} = prepareMultiSellState();
    const steps: SellStepDraft[] = [
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: 'kept', beerTwo: ''},
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: '', beerTwo: ''},
      {industryId: 'stale-industry', merchantSpaceId: 'stale-merchant', beerOne: '', beerTwo: ''},
    ];

    expect(normalizeSellStepDrafts(state, 'p1', steps)).toEqual([
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: 'kept', beerTwo: ''},
      {industryId: manufacturer.id, merchantSpaceId: 'oxford-1', beerOne: '', beerTwo: ''},
    ]);
  });

  it('clears beer sources when normalizing a sale draft to a different target', () => {
    const {state, cotton, manufacturer} = prepareMultiSellState();
    const staleBeerOne = JSON.stringify({
      kind: 'merchant_beer',
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    });
    const staleBeerTwo = JSON.stringify({
      kind: 'industry_tile',
      industryInstanceId: 'brewery-1',
      resourceType: 'beer',
    });
    const steps: SellStepDraft[] = [
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: staleBeerOne, beerTwo: ''},
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: staleBeerOne, beerTwo: staleBeerTwo},
    ];

    expect(normalizeSellStepDrafts(state, 'p1', steps)).toEqual([
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: staleBeerOne, beerTwo: ''},
      {industryId: manufacturer.id, merchantSpaceId: 'oxford-1', beerOne: '', beerTwo: ''},
    ]);
  });

  it('clears beer sources when normalizing a stale merchant choice', () => {
    const {state, cotton} = prepareMultiSellState();
    const staleBeer = JSON.stringify({
      kind: 'merchant_beer',
      merchantSpaceId: 'oxford-1',
      merchantTileInstanceId: 'oxford-manufacturer-0',
    });
    const steps: SellStepDraft[] = [
      {industryId: cotton.id, merchantSpaceId: 'oxford-1', beerOne: staleBeer, beerTwo: ''},
    ];

    expect(normalizeSellStepDrafts(state, 'p1', steps)).toEqual([
      {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: '', beerTwo: ''},
    ]);
  });

  it('clears beer sources from blank sale drafts', () => {
    const state = testGame();
    const steps: SellStepDraft[] = [{
      industryId: '',
      merchantSpaceId: '',
      beerOne: JSON.stringify({
        kind: 'merchant_beer',
        merchantSpaceId: 'oxford-0',
        merchantTileInstanceId: 'oxford-cotton-0',
      }),
      beerTwo: JSON.stringify({
        kind: 'industry_tile',
        industryInstanceId: 'brewery-1',
        resourceType: 'beer',
      }),
    }];

    expect(normalizeSellStepDrafts(state, 'p1', steps)).toEqual([{
      industryId: '',
      merchantSpaceId: '',
      beerOne: '',
      beerTwo: '',
    }]);
  });

  it('adds the next unsold sale draft with the first matching merchant', () => {
    const {state, cotton, manufacturer} = prepareMultiSellState();
    const firstStep: SellStepDraft = {industryId: cotton.id, merchantSpaceId: 'oxford-0', beerOne: '', beerTwo: ''};
    const fullSteps = [
      firstStep,
      {industryId: manufacturer.id, merchantSpaceId: 'oxford-1', beerOne: '', beerTwo: ''},
    ];

    expect(addSellStepDraft(state, 'p1', [firstStep])).toEqual(fullSteps);
    expect(addSellStepDraft(state, 'p1', fullSteps)).toBe(fullSteps);
  });
});
