import {describe, expect, it} from 'vitest';
import {
  legalBeerSourcesForNetwork,
  legalBeerSourcesForSaleSelect,
  legalCoalSourcesForNetworkSelect,
  legalResourceSourcesForSelect,
  type SaleBeerSourceSelection,
} from '../src/common/gameEngine';
import {staticConfig} from '../src/common/staticData';
import {
  decodeSource,
  marketOccupiedCount,
  marketPrice,
  normalizeResourceSelection,
  optionalSource,
  optionalSources,
  resourceSourcesForBuildSlot,
  resourceOptionsFromSources,
} from '../src/client/resourceSources';
import {addIndustry, addLink, setMerchantSpace, testGame} from './helpers';

function marketOption(options: Array<{value: string; label: string}>, marketName: 'coal' | 'iron') {
  const option = options.find((candidate) => candidate.label.startsWith(`${marketName} market`));
  if (!option) {
    throw new Error(`Missing ${marketName} market option`);
  }
  return option;
}

describe('client resource source options', () => {
  it('keeps only currently legal resource selections', () => {
    const state = testGame();
    const options = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'coal', 'shrewsbury', [], 0),
      [''],
      0,
    );
    const current = marketOption(options, 'coal').value;
    const currentWithExtraFields = JSON.stringify({kind: 'market', market: 'coal', price: 1, sessionToken: 'secret-token'});
    const stale = JSON.stringify({kind: 'market', market: 'coal', price: 99});

    expect(normalizeResourceSelection(current, options)).toBe(current);
    expect(normalizeResourceSelection(currentWithExtraFields, options)).toBe(current);
    expect(normalizeResourceSelection(stale, options)).toBe('');
    expect(normalizeResourceSelection('', options)).toBe('');
  });

  it('advances the market price option after an earlier market selection', () => {
    const state = testGame();
    const firstOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'coal', 'shrewsbury', [], 0),
      ['', ''],
      0,
    );
    const firstMarket = marketOption(firstOptions, 'coal');
    const firstSource = decodeSource(firstMarket.value);
    const secondOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'coal', 'shrewsbury', [firstSource, undefined], 1),
      [firstMarket.value, ''],
      1,
    );
    const secondMarket = marketOption(secondOptions, 'coal');

    expect(decodeSource(firstMarket.value)).toEqual({kind: 'market', market: 'coal', price: 1});
    expect(decodeSource(secondMarket.value)).toEqual({kind: 'market', market: 'coal', price: 2});
    expect(optionalSources([firstMarket.value, secondMarket.value], 2)).toEqual([
      {kind: 'market', market: 'coal', price: 1},
      {kind: 'market', market: 'coal', price: 2},
    ]);
  });

  it('uses initial market pricing when markets are missing', () => {
    const state = testGame();
    delete (state as Partial<typeof state>).markets;

    expect(marketOccupiedCount(state, 'coal')).toBe(staticConfig.markets.coal.initialOccupiedCount);
    expect(marketOccupiedCount(state, 'iron')).toBe(staticConfig.markets.iron.initialOccupiedCount);
    expect(marketPrice(state, 'coal')).toBe(1);
    expect(marketPrice(state, 'iron')).toBe(2);

    const options = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'coal', 'shrewsbury', [], 0),
      [''],
      0,
    );

    expect(decodeSource(marketOption(options, 'coal').value)).toEqual({
      kind: 'market',
      market: 'coal',
      price: 1,
    });
  });

  it('treats malformed encoded sources as empty optional selections', () => {
    const valid = JSON.stringify({kind: 'market', market: 'coal', price: 1});
    const invalidShape = JSON.stringify({kind: 'market', market: 'gold', price: 1});

    expect(optionalSource('not-json')).toBeUndefined();
    expect(optionalSource(invalidShape)).toBeUndefined();
    expect(optionalSources(['not-json'], 1)).toBeUndefined();
    expect(optionalSources([invalidShape], 1)).toBeUndefined();
    expect(optionalSources([], 1)).toBeUndefined();
    expect(optionalSources([valid], 2)).toBeUndefined();
    expect(optionalSources([valid, 'not-json'], 2)).toBeUndefined();
    expect(optionalSources([valid, ''], 2)).toBeUndefined();
    expect(optionalSources([valid, 'not-json'], 1)).toEqual([{kind: 'market', market: 'coal', price: 1}]);
  });

  it('rejects decoded resource sources that do not match the command payload shape', () => {
    const invalidSources = [
      {kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'coal'},
      {kind: 'industry_tile', industryInstanceId: 'coal-1', resourceType: 'money'},
      {kind: 'market', market: 'coal', price: -1},
      {kind: 'market', market: 'coal', price: 1.5},
      {kind: 'market', market: 'coal', price: 99},
      {kind: 'market', market: 'gold', price: 1},
      {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: ''},
      {kind: 'merchant_beer', merchantSpaceId: 1, merchantTileInstanceId: 'oxford-cotton-0'},
      {kind: 'future_source', id: 'secret'},
    ];

    for (const source of invalidSources) {
      const encoded = JSON.stringify(source);
      expect(() => decodeSource(encoded)).toThrow('Invalid resource source');
      expect(optionalSource(encoded)).toBeUndefined();
    }
  });

  it('accepts decoded market sources at configured market prices', () => {
    const validSources = [
      {kind: 'market' as const, market: 'coal' as const, price: staticConfig.markets.coal.priceSlotsCheapestToMostExpensive[0]},
      {kind: 'market' as const, market: 'coal' as const, price: staticConfig.markets.coal.fallbackPriceWhenEmpty},
      {kind: 'market' as const, market: 'iron' as const, price: staticConfig.markets.iron.priceSlotsCheapestToMostExpensive[0]},
      {kind: 'market' as const, market: 'iron' as const, price: staticConfig.markets.iron.fallbackPriceWhenEmpty},
    ];

    for (const source of validSources) {
      expect(decodeSource(JSON.stringify(source))).toEqual(source);
    }
  });

  it('normalizes decoded resource source identifiers before command submission', () => {
    expect(decodeSource(JSON.stringify({
      kind: 'industry_tile',
      industryInstanceId: ' iron-1 ',
      resourceType: 'iron',
      sessionToken: 'secret-token',
    }))).toEqual({
      kind: 'industry_tile',
      industryInstanceId: 'iron-1',
      resourceType: 'iron',
    });
    expect(optionalSource(JSON.stringify({
      kind: 'merchant_beer',
      merchantSpaceId: ' oxford-0 ',
      merchantTileInstanceId: ' oxford-cotton-0 ',
      sessionToken: 'secret-token',
    }))).toEqual({
      kind: 'merchant_beer',
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    });
    expect(decodeSource(JSON.stringify({
      kind: 'market',
      market: 'coal',
      price: 1,
      sessionToken: 'secret-token',
    }))).toEqual({
      kind: 'market',
      market: 'coal',
      price: 1,
    });
  });

  it('removes an industry resource option once other selects use all remaining cubes', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const firstOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0),
      ['', ''],
      0,
    );
    const industryOption = firstOptions.find((option) => decodeSource(option.value).kind === 'industry_tile');
    if (!industryOption) {
      throw new Error('Missing industry iron option');
    }
    const industrySource = decodeSource(industryOption.value);

    const secondOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'iron', 'birmingham', [industrySource, undefined], 1),
      [industryOption.value, ''],
      1,
    );

    expect(secondOptions.some((option) => option.value === industryOption.value)).toBe(false);
  });

  it('keeps an industry resource option while unused cubes remain', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 2,
    });
    const firstOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0),
      ['', ''],
      0,
    );
    const industryOption = firstOptions.find((option) => decodeSource(option.value).kind === 'industry_tile');
    if (!industryOption) {
      throw new Error('Missing industry iron option');
    }
    const industrySource = decodeSource(industryOption.value);

    const secondOptions = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'iron', 'birmingham', [industrySource, undefined], 1),
      [industryOption.value, ''],
      1,
    );

    expect(secondOptions.some((option) => option.value === industryOption.value)).toBe(true);
  });

  it('deduplicates multi-cube industry resource options within one select', () => {
    const state = testGame();
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 2,
    });
    const expectedSource = {
      kind: 'industry_tile' as const,
      industryInstanceId: iron.id,
      resourceType: 'iron' as const,
    };

    const options = resourceOptionsFromSources(
      state,
      legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0),
      ['', ''],
      0,
    );

    expect(options.map((option) => decodeSource(option.value)).filter((source) =>
      source.kind === 'industry_tile' && source.industryInstanceId === iron.id
    )).toEqual([expectedSource]);
  });

  it('removes the occupied Build slot industry from payment source options', () => {
    const state = testGame();
    const overbuiltCoal = addIndustry(state, {
      id: 'coal-overbuilt',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      remainingResource: 1,
    });
    const otherCoal = addIndustry(state, {
      id: 'coal-other',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    const sources = [
      {kind: 'industry_tile' as const, industryInstanceId: overbuiltCoal.id, resourceType: 'coal' as const},
      {kind: 'industry_tile' as const, industryInstanceId: otherCoal.id, resourceType: 'coal' as const},
      {kind: 'market' as const, market: 'coal' as const, price: 1},
    ];

    const filteredSources = resourceSourcesForBuildSlot(state, 'birmingham-0', sources);
    const options = resourceOptionsFromSources(state, filteredSources, [''], 0);

    expect(filteredSources).not.toContainEqual({
      kind: 'industry_tile',
      industryInstanceId: overbuiltCoal.id,
      resourceType: 'coal',
    });
    expect(options.map((option) => decodeSource(option.value))).toEqual([
      {kind: 'industry_tile', industryInstanceId: otherCoal.id, resourceType: 'coal'},
      {kind: 'market', market: 'coal', price: 1},
    ]);
  });

  it('keeps iron source options independent of the selected anchor location', () => {
    const state = testGame();
    const iron = addIndustry(state, {
      id: 'iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-2-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    const expectedIndustrySource = {
      kind: 'industry_tile' as const,
      industryInstanceId: iron.id,
      resourceType: 'iron' as const,
    };

    const birminghamSources = legalResourceSourcesForSelect(state, 'iron', 'birmingham', [], 0);
    const leekSources = legalResourceSourcesForSelect(state, 'iron', 'leek', [], 0);

    expect(birminghamSources).toEqual(leekSources);
    expect(birminghamSources).toContainEqual(expectedIndustrySource);
  });

  it('filters sell beer options already selected in another beer select', () => {
    const state = testGame();
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const initialSelection: SaleBeerSourceSelection = {
      playerId: 'p1',
      saleLocationId: 'coalbrookdale',
      merchantSpaceId: 'oxford-0',
      selectedSources: [undefined, undefined],
    };
    const options = resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, [initialSelection], 0, 0),
      ['', ''],
      0,
    );
    const merchantOption = options.find((option) => decodeSource(option.value).kind === 'merchant_beer');
    const breweryOption = options.find((option) => {
      const source = decodeSource(option.value);
      return source.kind === 'industry_tile' && source.industryInstanceId === brewery.id;
    });
    if (!merchantOption || !breweryOption) {
      throw new Error('Missing sell beer options');
    }
    const merchantSelection: SaleBeerSourceSelection = {
      ...initialSelection,
      selectedSources: [decodeSource(merchantOption.value), undefined],
    };
    const brewerySelection: SaleBeerSourceSelection = {
      ...initialSelection,
      selectedSources: [decodeSource(breweryOption.value), undefined],
    };

    expect(resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, [merchantSelection], 0, 1),
      [merchantOption.value, ''],
      1,
    ).some((option) => option.value === merchantOption.value)).toBe(false);
    expect(resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, [brewerySelection], 0, 1),
      [breweryOption.value, ''],
      1,
    ).some((option) => option.value === breweryOption.value)).toBe(false);
  });

  it('filters sell beer options already selected by an earlier sale step', () => {
    const state = testGame();
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const merchantBeer = {
      kind: 'merchant_beer' as const,
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    };
    const breweryBeer = {
      kind: 'industry_tile' as const,
      industryInstanceId: brewery.id,
      resourceType: 'beer' as const,
    };

    const secondSaleAfterMerchantBeer: SaleBeerSourceSelection[] = [
      {
        playerId: 'p1',
        saleLocationId: 'birmingham',
        merchantSpaceId: 'oxford-0',
        selectedSources: [merchantBeer, undefined],
      },
      {
        playerId: 'p1',
        saleLocationId: 'worcester',
        merchantSpaceId: 'oxford-0',
        selectedSources: [undefined, undefined],
      },
    ];
    const secondSaleAfterBreweryBeer: SaleBeerSourceSelection[] = [
      {
        playerId: 'p1',
        saleLocationId: 'birmingham',
        merchantSpaceId: 'oxford-0',
        selectedSources: [breweryBeer, undefined],
      },
      {
        playerId: 'p1',
        saleLocationId: 'worcester',
        merchantSpaceId: 'oxford-0',
        selectedSources: [undefined, undefined],
      },
    ];

    expect(resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, secondSaleAfterMerchantBeer, 1, 0),
      ['', ''],
      0,
    ).map((option) => decodeSource(option.value))).not.toContainEqual(merchantBeer);
    expect(resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, secondSaleAfterBreweryBeer, 1, 0),
      ['', ''],
      0,
    ).map((option) => decodeSource(option.value))).not.toContainEqual(breweryBeer);
  });

  it('limits Build coal options to nearest legal coal sources for the build location', () => {
    const state = testGame();
    state.era = 'rail';
    const nearCoal = addIndustry(state, {
      id: 'coal-near',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'tamworth',
      slotId: 'tamworth-0',
      remainingResource: 1,
    });
    const farCoal = addIndustry(state, {
      id: 'coal-far',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });
    addLink(state, 'near-link', 'p2', 'birmingham-tamworth', 'rail');
    addLink(state, 'far-link-1', 'p2', 'birmingham-walsall', 'rail');
    addLink(state, 'far-link-2', 'p2', 'cannock-walsall', 'rail');
    addLink(state, 'market-link', 'p2', 'birmingham-oxford', 'rail');

    const sources = legalResourceSourcesForSelect(state, 'coal', 'birmingham', [], 0);
    const options = resourceOptionsFromSources(state, sources, [''], 0);

    expect(options.map((option) => decodeSource(option.value))).toContainEqual({
      kind: 'industry_tile',
      industryInstanceId: nearCoal.id,
      resourceType: 'coal',
    });
    expect(options.map((option) => decodeSource(option.value))).not.toContainEqual({
      kind: 'industry_tile',
      industryInstanceId: farCoal.id,
      resourceType: 'coal',
    });
    expect(options.some((option) => decodeSource(option.value).kind === 'market')).toBe(false);
  });

  it('uses rail link order when listing Network coal options', () => {
    const state = testGame();
    state.era = 'rail';
    const coal = addIndustry(state, {
      id: 'coal-stone',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'stone',
      slotId: 'stone-1',
      remainingResource: 1,
    });
    const linkLineIds = ['cannock-stafford', 'stafford-stone'];
    const selectedSources = [undefined, undefined];

    const firstOptions = resourceOptionsFromSources(
      state,
      legalCoalSourcesForNetworkSelect(state, linkLineIds, selectedSources, 0),
      ['', ''],
      0,
    );
    const secondOptions = resourceOptionsFromSources(
      state,
      legalCoalSourcesForNetworkSelect(state, linkLineIds, selectedSources, 1),
      ['', ''],
      1,
    );

    const coalSource = {kind: 'industry_tile' as const, industryInstanceId: coal.id, resourceType: 'coal' as const};
    expect(firstOptions.map((option) => decodeSource(option.value))).not.toContainEqual(coalSource);
    expect(secondOptions.map((option) => decodeSource(option.value))).toContainEqual(coalSource);
  });

  it('limits double-rail beer options to own breweries and opponent breweries connected to the second rail', () => {
    const state = testGame();
    state.era = 'rail';
    const ownBrewery = addIndustry(state, {
      id: 'own-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    const connectedOpponentBrewery = addIndustry(state, {
      id: 'connected-opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'nuneaton',
      slotId: 'nuneaton-0',
      remainingResource: 1,
    });
    const firstRailOnlyOpponentBrewery = addIndustry(state, {
      id: 'first-rail-only-opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-0',
      remainingResource: 1,
    });
    const disconnectedOpponentBrewery = addIndustry(state, {
      id: 'disconnected-opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'burtonOnTrent',
      slotId: 'burtonOnTrent-1',
      remainingResource: 1,
    });
    addLink(state, 'second-rail-connection', 'p2', 'birmingham-nuneaton', 'rail');

    const options = resourceOptionsFromSources(
      state,
      legalBeerSourcesForNetwork(state, 'p1', ['cannock-stafford', 'birmingham-dudley']),
      [''],
      0,
    );
    const sources = options.map((option) => decodeSource(option.value));

    expect(sources).toContainEqual({kind: 'industry_tile', industryInstanceId: ownBrewery.id, resourceType: 'beer'});
    expect(sources).toContainEqual({kind: 'industry_tile', industryInstanceId: connectedOpponentBrewery.id, resourceType: 'beer'});
    expect(sources).not.toContainEqual({kind: 'industry_tile', industryInstanceId: firstRailOnlyOpponentBrewery.id, resourceType: 'beer'});
    expect(sources).not.toContainEqual({kind: 'industry_tile', industryInstanceId: disconnectedOpponentBrewery.id, resourceType: 'beer'});
  });

  it('does not offer Network beer options outside valid Rail double-link selections', () => {
    const state = testGame();
    const brewery = addIndustry(state, {
      id: 'own-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });

    expect(legalBeerSourcesForNetwork(state, 'p1', ['birmingham-walsall', 'walsall-wolverhampton'])).toEqual([]);

    state.era = 'rail';
    expect(legalBeerSourcesForNetwork(state, 'p1', ['birmingham-walsall'])).toEqual([]);
    expect(legalBeerSourcesForNetwork(state, 'p1', ['birmingham-walsall', 'missing-link-line'])).toEqual([]);
    expect(legalBeerSourcesForNetwork(state, 'p1', ['burtonOnTrent-walsall', 'birmingham-walsall'])).toEqual([]);
    expect(legalBeerSourcesForNetwork(state, 'p1', ['birmingham-walsall', 'walsall-wolverhampton'])).toEqual([
      {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
    ]);
  });

  it('limits Sell beer options to the selected merchant and legal brewery connections', () => {
    const state = testGame();
    state.era = 'rail';
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const ownBrewery = addIndustry(state, {
      id: 'own-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });
    const connectedOpponentBrewery = addIndustry(state, {
      id: 'connected-opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'nuneaton',
      slotId: 'nuneaton-0',
      remainingResource: 1,
    });
    const disconnectedOpponentBrewery = addIndustry(state, {
      id: 'disconnected-opponent-brewery',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'leek',
      slotId: 'leek-0',
      remainingResource: 1,
    });
    addLink(state, 'merchant-link', 'p1', 'birmingham-oxford', 'rail');
    addLink(state, 'connected-link', 'p2', 'birmingham-nuneaton', 'rail');
    const selections: SaleBeerSourceSelection[] = [{
      playerId: 'p1',
      industryInstanceId: cotton.id,
      saleLocationId: 'birmingham',
      merchantSpaceId: 'oxford-0',
      selectedSources: [undefined, undefined],
    }];

    const options = resourceOptionsFromSources(
      state,
      legalBeerSourcesForSaleSelect(state, selections, 0, 0),
      ['', ''],
      0,
    );
    const sources = options.map((option) => decodeSource(option.value));

    expect(sources).toContainEqual({
      kind: 'merchant_beer',
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    });
    expect(sources).toContainEqual({kind: 'industry_tile', industryInstanceId: ownBrewery.id, resourceType: 'beer'});
    expect(sources).toContainEqual({kind: 'industry_tile', industryInstanceId: connectedOpponentBrewery.id, resourceType: 'beer'});
    expect(sources).not.toContainEqual({kind: 'industry_tile', industryInstanceId: disconnectedOpponentBrewery.id, resourceType: 'beer'});
  });

  it('hides Sell beer options when the selected industry cannot sell to that merchant', () => {
    const state = testGame();
    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const brewery = addIndustry(state, {
      id: 'own-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });
    addLink(state, 'merchant-link', 'p1', 'birmingham-oxford');
    const validSelection: SaleBeerSourceSelection = {
      playerId: 'p1',
      industryInstanceId: cotton.id,
      saleLocationId: 'birmingham',
      merchantSpaceId: 'oxford-0',
      selectedSources: [undefined],
    };

    expect(legalBeerSourcesForSaleSelect(state, [validSelection], 0, 0)).toContainEqual({
      kind: 'industry_tile',
      industryInstanceId: brewery.id,
      resourceType: 'beer',
    });

    setMerchantSpace(state, 'oxford-0', 'oxford-manufacturer-0', true);
    expect(legalBeerSourcesForSaleSelect(state, [validSelection], 0, 0)).toEqual([]);

    setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
    state.board.linkLines['birmingham-oxford'] = {};
    expect(legalBeerSourcesForSaleSelect(state, [validSelection], 0, 0)).toEqual([]);

    expect(legalBeerSourcesForSaleSelect(state, [{
      ...validSelection,
      saleLocationId: 'worcester',
    }], 0, 0)).toEqual([]);
  });
});
