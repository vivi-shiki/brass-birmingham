import {describe, expect, it} from 'vitest';
import {
  applyCommand,
  canSellToMerchant,
  canSellToMerchantSpace,
  endCurrentEra,
  executeSell,
  validateCommand,
  validateResolveMerchantDevelop,
  validateSell,
} from '../src/common/gameEngine';
import {retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';
import type {ResourceSource, SellCommand} from '../src/common/types';
import {addIndustry, addLink, setHand, setMerchantSpace, testGame} from './helpers';

function prepareCottonSale() {
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

function prepareEraEnd(state: ReturnType<typeof testGame>): void {
  for (const player of Object.values(state.players)) {
    player.discardCardIds.push(...player.handCardIds);
    player.handCardIds = [];
  }
  state.cardZones.drawDeck = [];
}

describe('sell action', () => {
  it('rejects empty sell actions', () => {
    const {state} = prepareCottonSale();

    const validation = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('at least one sale step');
  });

  it('sells to a connected merchant, consumes merchant beer, claims bonus, and flips the industry', () => {
    const {state, cotton} = prepareCottonSale();

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.startPosition + 7);
    expect(state.players.p1.discardCardIds).toContain('p2-location-birmingham-1');
    expect(state.eventLog.some((event) => event.type === 'merchant_bonus_claimed')).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'industry_sold')).toBe(true);
  });

  it('rejects explicit sell beer source count mismatches before mutating the game', () => {
    const {state, cotton} = prepareCottonSale();
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventCountBefore = state.eventLog.length;
    const incomeBefore = state.players.p1.incomeTrackPosition;

    expect(() =>
      applyCommand(state, {
        type: 'sell',
        playerId: 'p1',
        cardId: 'p2-location-birmingham-1',
        sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0', beerSources: []}],
      }),
    ).toThrow('Beer source count does not match the industry requirement');

    expect(state.board.industryInstances[cotton.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.players.p1.incomeTrackPosition).toBe(incomeBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('rejects malformed explicit sell beer sources before mutating the game', () => {
    const {state, cotton} = prepareCottonSale();
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventCountBefore = state.eventLog.length;
    const incomeBefore = state.players.p1.incomeTrackPosition;
    const command: SellCommand = {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: cotton.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [undefined] as unknown as ResourceSource[],
      }],
    };

    const result = validateSell(state, command);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected beer source is malformed');
    expect(() => applyCommand(state, command)).toThrow('Selected beer source is malformed');

    expect(state.board.industryInstances[cotton.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.players.p1.incomeTrackPosition).toBe(incomeBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.eventLog).toHaveLength(eventCountBefore);
  });

  it('defers sold industry victory points until era scoring', () => {
    const {state, cotton} = prepareCottonSale();
    const industryVp = staticConfig.industryTileSpecs[cotton.specId].flip.victoryPoints;

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.players.p1.victoryPoints).toBe(0);
    expect(state.eventLog.some((event) => event.type === 'industry_scored')).toBe(false);

    prepareEraEnd(state);
    const score = endCurrentEra(state);

    expect(score.industryVictoryPointsByPlayer.p1).toBe(industryVp);
    expect(state.players.p1.victoryPoints).toBeGreaterThanOrEqual(industryVp);
    expect(state.eventLog).toContainEqual({
      type: 'industry_scored',
      industryInstanceId: cotton.id,
      ownerPlayerId: 'p1',
      points: industryVp,
    });
  });

  it('does not log no-op income changes when the income track is already capped', () => {
    const {state, cotton} = prepareCottonSale();
    state.players.p1.incomeTrackPosition = staticConfig.incomeTrack.positions.length - 1;

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.positions.length - 1);
    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'oxford-0',
      bonus: {type: 'income_spaces', spaces: 2},
    });
    expect(state.eventLog.filter((event) => event.type === 'income_position_changed')).toEqual([]);
  });

  it('can use own brewery beer from anywhere without claiming merchant bonus when merchant beer is absent', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    expect(canSellToMerchant(state, cotton)).toBe(true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.eventLog.some((event) => event.type === 'merchant_bonus_claimed')).toBe(false);
  });

  it('honors an explicit own brewery beer source even when merchant beer is available', () => {
    const {state, cotton} = prepareCottonSale();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const breweryBeerSource = {
      kind: 'industry_tile' as const,
      industryInstanceId: brewery.id,
      resourceType: 'beer' as const,
    };

    const validation = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: cotton.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [breweryBeerSource],
      }],
    });

    expect(validation.ok).toBe(true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: cotton.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [breweryBeerSource],
      }],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: breweryBeerSource,
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(state.eventLog.some((event) => event.type === 'merchant_bonus_claimed')).toBe(false);
  });

  it('uses only connected opponent brewery beer for Sell', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;
    addLink(state, 'link-2', 'p1', 'birmingham-walsall');
    const connectedOpponentBrewery = addIndustry(state, {
      id: 'opponent-brewery-connected',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'walsall',
      slotId: 'walsall-1',
      remainingResource: 1,
    });
    const disconnectedOpponentBrewery = addIndustry(state, {
      id: 'opponent-brewery-disconnected',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-2',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });
    const disconnectedBeerSource = {
      kind: 'industry_tile' as const,
      industryInstanceId: disconnectedOpponentBrewery.id,
      resourceType: 'beer' as const,
    };
    const connectedBeerSource = {
      kind: 'industry_tile' as const,
      industryInstanceId: connectedOpponentBrewery.id,
      resourceType: 'beer' as const,
    };

    const disconnectedValidation = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: cotton.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [disconnectedBeerSource],
      }],
    });

    expect(disconnectedValidation.ok).toBe(false);
    expect(disconnectedValidation.errors).toContain('Selected beer source is not available');

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: cotton.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [connectedBeerSource],
      }],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[connectedOpponentBrewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[connectedOpponentBrewery.id].flipped).toBe(true);
    expect(state.board.industryInstances[disconnectedOpponentBrewery.id].remainingResource).toBe(1);
    expect(state.board.industryInstances[disconnectedOpponentBrewery.id].flipped).toBe(false);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: connectedBeerSource,
      byPlayerId: 'p1',
      reason: 'sell',
    });
  });

  it('sells a zero-beer manufacturer without consuming merchant beer or claiming its bonus', () => {
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
    const merchantBeer = {
      kind: 'merchant_beer' as const,
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-manufacturer-0',
    };
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(state, 'oxford-0', merchantBeer.merchantTileInstanceId, true);

    const explicitMerchantBeer = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: manufacturer.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [merchantBeer],
      }],
    });
    expect(explicitMerchantBeer.ok).toBe(false);
    expect(explicitMerchantBeer.errors.join(' ')).toContain('Beer source count');

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'merchant_bonus_claimed')).toBe(false);
    expect(state.eventLog.some((event) =>
      event.type === 'resource_consumed' &&
      event.source.kind === 'merchant_beer',
    )).toBe(false);
  });

  it('reports merchant-specific sell eligibility for client controls', () => {
    const {state, cotton} = prepareCottonSale();
    setMerchantSpace(state, 'oxford-1', 'oxford-manufacturer-0', true);
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    expect(canSellToMerchantSpace(state, cotton, 'oxford-0')).toBe(true);
    expect(canSellToMerchantSpace(state, cotton, 'oxford-1')).toBe(false);
    expect(canSellToMerchantSpace(state, cotton, 'gloucester-0')).toBe(false);
    expect(canSellToMerchantSpace(state, cotton, 'missing-space')).toBe(false);

    state.board.merchantSpaces['oxford-0'].beerPresent = false;
    expect(canSellToMerchantSpace(state, cotton, 'oxford-0')).toBe(false);
    expect(canSellToMerchant(state, cotton)).toBe(false);

    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    expect(canSellToMerchantSpace(state, cotton, 'oxford-0')).toBe(true);
    expect(canSellToMerchant(state, cotton)).toBe(true);
  });

  it('can sell multiple industries with separate merchant beers and bonuses in one action', () => {
    const {state, cotton} = prepareCottonSale();
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    setMerchantSpace(state, 'oxford-1', 'oxford-manufacturer-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
        {industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-1'},
      ],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.board.merchantSpaces['oxford-1'].beerPresent).toBe(false);
    expect(state.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.startPosition + 14);
    expect(state.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(2);
    expect(state.eventLog.filter((event) => event.type === 'industry_sold')).toHaveLength(2);
  });

  it('automatically uses separate own brewery beers across multiple sale steps', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;
    const secondCotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-2',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });
    const firstBrewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const secondBrewery = addIndustry(state, {
      id: 'brewery-2',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-2',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });
    addLink(state, 'link-2', 'p1', 'birmingham-worcester');

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
        {industryInstanceId: secondCotton.id, merchantSpaceId: 'oxford-0'},
      ],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[secondCotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[firstBrewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[secondBrewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[firstBrewery.id].flipped).toBe(true);
    expect(state.board.industryInstances[secondBrewery.id].flipped).toBe(true);
    expect(state.eventLog.filter((event) =>
      event.type === 'resource_consumed' &&
      event.reason === 'sell' &&
      event.source.kind === 'industry_tile' &&
      (event.source.industryInstanceId === firstBrewery.id || event.source.industryInstanceId === secondBrewery.id),
    )).toHaveLength(2);
    expect(state.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(0);
  });

  it('uses one target merchant beer plus brewery beer for a two-beer sale', () => {
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

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.board.industryInstances[brewery.id].remainingResource).toBe(0);
    expect(state.board.industryInstances[brewery.id].flipped).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {
        kind: 'merchant_beer',
        merchantSpaceId: 'oxford-0',
        merchantTileInstanceId: 'oxford-manufacturer-0',
      },
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(state.eventLog).toContainEqual({
      type: 'resource_consumed',
      source: {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
      byPlayerId: 'p1',
      reason: 'sell',
    });
    expect(state.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(1);
  });

  it('rejects reusing the target merchant beer within one two-beer sale', () => {
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
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');
    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);
    const merchantBeer = {
      kind: 'merchant_beer' as const,
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-manufacturer-0',
    };

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{
        industryInstanceId: manufacturer.id,
        merchantSpaceId: 'oxford-0',
        beerSources: [merchantBeer, merchantBeer],
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected beer source is not available');
    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
  });

  it('can sell more than two industries in one action', () => {
    const {state, cotton} = prepareCottonSale();
    const secondCotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-2',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    addLink(state, 'link-2', 'p1', 'birmingham-worcester');
    addLink(state, 'link-3', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);
    setMerchantSpace(state, 'gloucester-1', 'gloucester-manufacturer-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
        {industryInstanceId: secondCotton.id, merchantSpaceId: 'gloucester-0'},
        {industryInstanceId: manufacturer.id, merchantSpaceId: 'gloucester-1'},
      ],
    });

    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[secondCotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.board.merchantSpaces['gloucester-0'].beerPresent).toBe(false);
    expect(state.board.merchantSpaces['gloucester-1'].beerPresent).toBe(false);
    expect(state.eventLog.filter((event) => event.type === 'industry_sold')).toHaveLength(3);
    expect(state.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(3);
  });

  it('claims a cash merchant bonus when using Warrington merchant beer', () => {
    const state = testGame();
    state.playerCount = 3;
    const cardId = 'p3-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    const pottery = addIndustry(state, {
      id: 'pottery-1',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-1-1',
      locationId: 'stokeOnTrent',
      slotId: 'stokeOnTrent-1',
    });
    addLink(state, 'link-1', 'p1', 'stokeOnTrent-warrington');
    setMerchantSpace(state, 'warrington-0', 'warrington-pottery-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{industryInstanceId: pottery.id, merchantSpaceId: 'warrington-0'}],
    });

    expect(state.players.p1.cash).toBe(22);
    expect(state.board.industryInstances[pottery.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['warrington-0'].beerPresent).toBe(false);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'merchant bonus'});
    expect(state.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'warrington-0',
      bonus: {type: 'cash', cash: 5},
    });
  });

  it('does not count a cash merchant bonus as money spent for turn order', () => {
    const state = testGame();
    state.playerCount = 3;
    const cardId = 'p3-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    setHand(state, 'p2', ['p3-location-cannock-1']);
    const pottery = addIndustry(state, {
      id: 'pottery-1',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-1-1',
      locationId: 'stokeOnTrent',
      slotId: 'stokeOnTrent-1',
    });
    addLink(state, 'link-1', 'p1', 'stokeOnTrent-warrington');
    setMerchantSpace(state, 'warrington-0', 'warrington-pottery-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{industryInstanceId: pottery.id, merchantSpaceId: 'warrington-0'}],
    });

    expect(state.players.p1.cash).toBe(22);
    expect(state.players.p1.spentThisRound).toBe(0);

    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: state.players.p2.handCardIds[0]});

    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p1', 'p2']);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.players.p2.spentThisRound).toBe(0);
  });

  it('rejects inactive high-player-count merchant spaces even if stale state contains a tile', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const pottery = addIndustry(state, {
      id: 'pottery-1',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-1-1',
      locationId: 'stokeOnTrent',
      slotId: 'stokeOnTrent-1',
    });
    addLink(state, 'link-1', 'p1', 'stokeOnTrent-warrington');
    setMerchantSpace(state, 'warrington-0', 'warrington-pottery-0', true);

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: pottery.id, merchantSpaceId: 'warrington-0'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Selected merchant space has no merchant tile');
    expect(state.board.industryInstances[pottery.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['warrington-0'].beerPresent).toBe(true);
  });

  it('claims a victory point merchant bonus when using Nottingham merchant beer', () => {
    const state = testGame();
    state.playerCount = 4;
    const cardId = 'p4-location-birmingham-1';
    setHand(state, 'p1', [cardId]);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'derby',
      slotId: 'derby-0',
    });
    addLink(state, 'link-1', 'p1', 'derby-nottingham');
    setMerchantSpace(state, 'nottingham-0', 'nottingham-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId,
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'nottingham-0'}],
    });

    expect(state.players.p1.victoryPoints).toBe(3);
    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['nottingham-0'].beerPresent).toBe(false);
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 3, reason: 'merchant bonus'});
    expect(state.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'nottingham-0',
      bonus: {type: 'victory_points', points: 3},
    });
  });

  it('claims the Shrewsbury victory point bonus when a matching merchant tile is there', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-kidderminster-1']);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'kidderminster',
      slotId: 'kidderminster-1',
    });
    addLink(state, 'link-1', 'p1', 'coalbrookdale-kidderminster');
    addLink(state, 'link-2', 'p1', 'coalbrookdale-shrewsbury');
    setMerchantSpace(state, 'shrewsbury-0', 'oxford-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-kidderminster-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'shrewsbury-0'}],
    });

    expect(state.players.p1.victoryPoints).toBe(4);
    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['shrewsbury-0'].beerPresent).toBe(false);
    expect(state.eventLog).toContainEqual({type: 'victory_points_changed', playerId: 'p1', delta: 4, reason: 'merchant bonus'});
    expect(state.eventLog).toContainEqual({
      type: 'merchant_bonus_claimed',
      playerId: 'p1',
      merchantSpaceId: 'shrewsbury-0',
      bonus: {type: 'victory_points', points: 4},
    });
  });

  it('pauses for the player to choose a Gloucester merchant develop bonus', () => {
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
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    expect(state.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
    });
    expect(state.currentTurnIndex).toBe(0);
    expect(state.actionIndexInTurn).toBe(0);
    expect(state.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual([]);

    const blocked = validateCommand(state, {type: 'pass', playerId: 'p2', cardId: state.players.p2.handCardIds[0]});
    expect(blocked.ok).toBe(false);
    expect(blocked.errors).toContain('Pending decision must be resolved first');

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['manufacturer'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.currentTurnIndex).toBe(1);
    expect(state.actionIndexInTurn).toBe(0);
    expect(state.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['manufacturer'],
      specIds: ['manufacturer-1-1'],
    });
  });

  it('combines two Gloucester merchant develop bonuses from one Sell action', () => {
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
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });
    addLink(state, 'link-0', 'p1', 'birmingham-walsall');
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);
    setMerchantSpace(state, 'gloucester-1', 'gloucester-manufacturer-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'},
        {industryInstanceId: manufacturer.id, merchantSpaceId: 'gloucester-1'},
      ],
    });

    expect(state.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
    });
    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(true);
    expect(state.eventLog.filter((event) => event.type === 'merchant_bonus_claimed')).toHaveLength(2);

    const tooFew = validateResolveMerchantDevelop(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    });
    expect(tooFew.ok).toBe(false);
    expect(tooFew.errors).toContain('Merchant develop must remove 2 tiles');

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine', 'iron_works'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.iron_works.removedSpecIds).toEqual(['iron_works-1-1']);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      industryTypes: ['coal_mine', 'iron_works'],
      specIds: ['coal_mine-1-1', 'iron_works-1-1'],
    });
  });

  it('requires resolving an available Gloucester merchant develop tile', () => {
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
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    const result = validateResolveMerchantDevelop(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Merchant develop must remove 1 tile');
    expect(state.pendingDecision?.type).toBe('merchant_develop');
  });

  it('rejects an invalid second merchant develop selection before mutating the game', () => {
    const state = testGame();
    state.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
    };
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];
    const stackBefore = structuredClone(state.players.p1.industryTileStacks.coal_mine);
    const pendingBefore = structuredClone(state.pendingDecision);
    const eventLogBefore = structuredClone(state.eventLog);
    const turnBefore = state.currentTurnIndex;

    expect(() => applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine', 'coal_mine'],
    })).toThrow('No coal_mine tile available to develop');

    expect(state.pendingDecision).toEqual(pendingBefore);
    expect(state.currentTurnIndex).toBe(turnBefore);
    expect(state.players.p1.industryTileStacks.coal_mine).toEqual(stackBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('allows resolving a Gloucester merchant develop bonus with no tiles when no developable stack heads remain', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    for (const stack of Object.values(state.players.p1.industryTileStacks)) {
      stack.availableSpecIdsInOrder = [];
    }
    state.players.p1.industryTileStacks.pottery.availableSpecIdsInOrder = ['pottery-1-1'];
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    expect(state.pendingDecision?.type).toBe('merchant_develop');
    expect(validateResolveMerchantDevelop(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: [],
    }).ok).toBe(true);

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: [],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.industryTileStacks.pottery.removedSpecIds).toEqual([]);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: [],
      specIds: [],
    });
  });

  it('allows resolving combined Gloucester develop bonuses with only the remaining developable stack heads', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    for (const stack of Object.values(state.players.p1.industryTileStacks)) {
      stack.availableSpecIdsInOrder = [];
    }
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-1-1'];
    state.players.p1.industryTileStacks.pottery.availableSpecIdsInOrder = ['pottery-1-1'];
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
    addLink(state, 'link-0', 'p1', 'birmingham-walsall');
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);
    setMerchantSpace(state, 'gloucester-1', 'gloucester-manufacturer-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'},
        {industryInstanceId: manufacturer.id, merchantSpaceId: 'gloucester-1'},
      ],
    });

    expect(state.pendingDecision).toEqual({
      type: 'merchant_develop',
      playerId: 'p1',
      count: 2,
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
    });
    expect(validateResolveMerchantDevelop(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: [],
    }).errors).toContain('Merchant develop must remove 1 tile');
    expect(validateResolveMerchantDevelop(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    }).ok).toBe(true);

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.pottery.removedSpecIds).toEqual([]);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0', 'gloucester-1'],
      industryTypes: ['coal_mine'],
      specIds: ['coal_mine-1-1'],
    });
  });

  it('does not finish the round before a merchant develop decision is resolved', () => {
    const state = testGame();
    state.currentTurnIndex = 1;
    state.players.p1.incomeTrackPosition = staticConfig.incomeTrack.startPosition + 10;
    state.players.p2.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
    setHand(state, 'p2', ['p2-location-birmingham-1']);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p2',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(state, 'link-1', 'p2', 'birmingham-worcester');
    addLink(state, 'link-2', 'p2', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p2',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    expect(state.pendingDecision?.type).toBe('merchant_develop');
    expect(state.roundNumber).toBe(1);
    expect(state.currentTurnIndex).toBe(1);
    expect(state.players.p1.cash).toBe(17);
    expect(state.players.p2.cash).toBe(17);

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p2',
      industryTypes: ['manufacturer'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.currentTurnIndex).toBe(0);
    expect(state.players.p1.cash).toBe(22);
    expect(state.players.p2.cash).toBe(18);
  });

  it('waits to end the Canal era until a final-card merchant develop decision is resolved', () => {
    const state = testGame();
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(state, 'link-1', 'p1', 'birmingham-worcester');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    expect(state.pendingDecision?.type).toBe('merchant_develop');
    expect(state.era).toBe('canal');
    expect(state.eventLog.some((event) => event.type === 'era_ended')).toBe(false);

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['manufacturer'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.era).toBe('rail');
    expect(state.players.p1.industryTileStacks.manufacturer.removedSpecIds).toEqual(['manufacturer-1-1']);
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'canal')).toBe(true);
  });

  it('waits to end the game until a final-card Rail merchant develop decision is resolved', () => {
    const state = testGame();
    state.era = 'rail';
    state.actionsAllowedThisTurn = 2;
    state.cardZones.drawDeck = [];
    state.players.p1.discardCardIds = [];
    state.players.p2.discardCardIds = [];
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    setHand(state, 'p2', []);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    addLink(state, 'link-1', 'p1', 'birmingham-worcester', 'rail');
    addLink(state, 'link-2', 'p1', 'gloucester-worcester', 'rail');
    setMerchantSpace(state, 'gloucester-0', 'gloucester-cotton-0', true);

    applyCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'gloucester-0'}],
    });

    expect(state.pendingDecision?.type).toBe('merchant_develop');
    expect(state.status).toBe('playing');
    expect(state.eventLog.some((event) => event.type === 'game_ended')).toBe(false);

    applyCommand(state, {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['manufacturer'],
    });

    expect(state.pendingDecision).toBeUndefined();
    expect(state.status).toBe('ended');
    expect(state.eventLog.some((event) => event.type === 'era_ended' && event.era === 'rail')).toBe(true);
    expect(state.eventLog.some((event) => event.type === 'game_ended')).toBe(true);
  });

  it('rejects selling when no required beer source is available', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Not enough beer');
  });

  it('requires the selected merchant to accept the industry type', () => {
    const {state, cotton} = prepareCottonSale();
    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not accept');
  });

  it('requires the sold industry to be connected to the selected merchant', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.linkLines['birmingham-oxford'] = {};

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Industry is not connected to the selected merchant');
    expect(state.board.industryInstances[cotton.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
  });

  it('rejects selling to a blank merchant tile', () => {
    const {state, cotton} = prepareCottonSale();
    setMerchantSpace(state, 'oxford-0', 'blank-2p-0', false);

    expect(canSellToMerchant(state, cotton)).toBe(false);

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not accept');
  });

  it('rejects market resources submitted as explicit sell beer sources', () => {
    const {state, cotton} = prepareCottonSale();

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {
          industryInstanceId: cotton.id,
          merchantSpaceId: 'oxford-0',
          beerSources: [{kind: 'market', market: 'iron', price: 2}],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Beer cannot come from a market');
  });

  it('rejects merchant beer from a different merchant space', () => {
    const {state, cotton} = prepareCottonSale();
    setMerchantSpace(state, 'oxford-1', 'oxford-cotton-1', true);

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {
          industryInstanceId: cotton.id,
          merchantSpaceId: 'oxford-0',
          beerSources: [
            {
              kind: 'merchant_beer',
              merchantSpaceId: 'oxford-1',
              merchantTileInstanceId: 'oxford-cotton-1',
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('selected merchant space');
  });

  it('requires explicit sell beer source counts to match the industry requirement', () => {
    const {state, cotton} = prepareCottonSale();

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {
          industryInstanceId: cotton.id,
          merchantSpaceId: 'oxford-0',
          beerSources: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Beer source count');
  });

  it('snapshots Sell command payloads before validation and execution', () => {
    const {state, cotton} = prepareCottonSale();
    let salesReads = 0;
    const command = {
      type: 'sell' as const,
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      get sales() {
        salesReads++;
        return salesReads <= 2
          ? [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'}]
          : [{industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0', beerSources: []}];
      },
    } as unknown as SellCommand;

    applyCommand(state, command);

    expect(salesReads).toBe(1);
    expect(state.board.industryInstances[cotton.id].flipped).toBe(true);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(false);
    expect(state.players.p1.handCardIds).not.toContain('p2-location-birmingham-1');
    expect(state.eventLog.some((event) => event.type === 'industry_sold')).toBe(true);
  });

  it('does not sell the first step before later sale beer sources are rechecked during execution', () => {
    const {state, cotton} = prepareCottonSale();
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-1',
    });
    setMerchantSpace(state, 'oxford-1', 'oxford-manufacturer-0', true);
    const handBefore = [...state.players.p1.handCardIds];
    const discardBefore = [...state.players.p1.discardCardIds];
    const eventLogBefore = structuredClone(state.eventLog);
    const incomeBefore = state.players.p1.incomeTrackPosition;
    let salesReads = 0;
    const validSales = [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
      {industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-1'},
    ];
    const staleSales = [
      {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
      {industryInstanceId: manufacturer.id, merchantSpaceId: 'oxford-1', beerSources: []},
    ];
    const command = {
      type: 'sell' as const,
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      get sales() {
        salesReads++;
        return salesReads === 1 ? validSales : staleSales;
      },
    } as SellCommand;

    expect(() => executeSell(state, command)).toThrow('Beer source count does not match the industry requirement');

    expect(salesReads).toBe(2);
    expect(state.board.industryInstances[cotton.id].flipped).toBe(false);
    expect(state.board.industryInstances[manufacturer.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.board.merchantSpaces['oxford-1'].beerPresent).toBe(true);
    expect(state.players.p1.incomeTrackPosition).toBe(incomeBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.players.p1.discardCardIds).toEqual(discardBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('rejects selling the same industry twice in one action before consuming beer', () => {
    const {state, cotton} = prepareCottonSale();
    setMerchantSpace(state, 'oxford-1', 'oxford-cotton-1', true);

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-1'},
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Cannot sell the same industry twice in one action');
    expect(state.board.industryInstances[cotton.id].flipped).toBe(false);
    expect(state.board.merchantSpaces['oxford-0'].beerPresent).toBe(true);
    expect(state.board.merchantSpaces['oxford-1'].beerPresent).toBe(true);
    expect(state.players.p1.incomeTrackPosition).toBe(staticConfig.incomeTrack.startPosition);
  });

  it('rejects reusing the same merchant beer across two sale steps', () => {
    const {state, cotton} = prepareCottonSale();
    const secondCotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-2',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });
    addLink(state, 'link-2', 'p1', 'birmingham-worcester');
    const merchantBeer = {
      kind: 'merchant_beer' as const,
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    };

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0', beerSources: [merchantBeer]},
        {industryInstanceId: secondCotton.id, merchantSpaceId: 'oxford-0', beerSources: [merchantBeer]},
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Selected beer source is not available');
  });

  it('rejects a multi-sale action when one brewery beer cannot cover every sale', () => {
    const {state, cotton} = prepareCottonSale();
    state.board.merchantSpaces['oxford-0'].beerPresent = false;
    const secondCotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-2',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });
    addLink(state, 'link-2', 'p1', 'birmingham-worcester');
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    const result = validateSell(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {industryInstanceId: cotton.id, merchantSpaceId: 'oxford-0'},
        {industryInstanceId: secondCotton.id, merchantSpaceId: 'oxford-0'},
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Not enough beer');
  });
});
