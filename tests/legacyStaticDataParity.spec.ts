import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {getCardIdsForPlayerCount, staticConfig} from '../src/common/staticData';
import type {CardSpec, IndustryType, PlayerCount} from '../src/common/types';

type LegacyIndustryType =
  | 'cottonMill'
  | 'coalMine'
  | 'ironWorks'
  | 'manufacturer'
  | 'pottery'
  | 'brewery';

interface LegacyIndustryTile {
  level: number;
  count: number;
  canalEra: boolean;
  railEra: boolean;
  cost: number;
  costCoal: number;
  costIron: number;
  beersToSell: number | null;
  vp: number;
  income: number;
  linkVP: number;
  canDevelop: boolean;
}

interface LegacyCity {
  name: string;
  region: string;
  slots: LegacyIndustryType[][];
}

interface LegacyMerchant {
  name: string;
  slots: number;
  minPlayers: PlayerCount;
  bonusType: 'vp' | 'develop' | 'income' | 'money';
  bonusAmount: number;
}

interface LegacyConnection {
  id: string;
  cities: [string, string];
  canal: boolean;
  rail: boolean;
  viaBrewery?: string;
}

interface LegacyDeck {
  locations: Record<string, number>;
  industries: Partial<Record<LegacyIndustryType, number>>;
}

interface LegacyData {
  INDUSTRY_DATA: Record<LegacyIndustryType, LegacyIndustryTile[]>;
  CITIES: Record<string, LegacyCity>;
  BREWERY_FARMS: Record<string, {name: string}>;
  MERCHANTS: Record<string, LegacyMerchant>;
  CONNECTIONS: LegacyConnection[];
  CARD_DECK: Record<PlayerCount, LegacyDeck>;
  COAL_MARKET_PRICES: number[];
  COAL_MARKET_INITIAL: number;
  IRON_MARKET_PRICES: number[];
  IRON_MARKET_INITIAL: number;
}

const legacyToStaticIndustryType: Record<LegacyIndustryType, IndustryType> = {
  cottonMill: 'cotton_mill',
  coalMine: 'coal_mine',
  ironWorks: 'iron_works',
  manufacturer: 'manufacturer',
  pottery: 'pottery',
  brewery: 'brewery',
};

function loadLegacyData(): LegacyData {
  const source = fs.readFileSync(path.join(process.cwd(), 'js', 'gameData.js'), 'utf8');
  const factory = new Function(`${source}
return {
  INDUSTRY_DATA,
  CITIES,
  BREWERY_FARMS,
  MERCHANTS,
  CONNECTIONS,
  CARD_DECK,
  COAL_MARKET_PRICES,
  COAL_MARKET_INITIAL,
  IRON_MARKET_PRICES,
  IRON_MARKET_INITIAL,
};`);
  return factory() as LegacyData;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeLegacySlot(slot: LegacyIndustryType[]): IndustryType[] {
  return slot.map((industryType) => legacyToStaticIndustryType[industryType]);
}

function staticCityManifest() {
  return sortedRecord(Object.fromEntries(Object.entries(staticConfig.locations)
    .filter(([, location]) => location.kind === 'city')
    .map(([id, location]) => {
      if (location.kind !== 'city') {
        throw new Error(`Expected city ${id}`);
      }
      return [id, {
        name: location.name,
        region: location.region,
        slots: location.slots.map((slot) => slot.allowedIndustryTypes),
      }];
    })));
}

function legacyCityManifest(legacy: LegacyData) {
  return sortedRecord(Object.fromEntries(Object.entries(legacy.CITIES).map(([id, city]) => [id, {
    name: city.name,
    region: city.region,
    slots: city.slots.map(normalizeLegacySlot),
  }])));
}

function staticMerchantManifest() {
  return sortedRecord(Object.fromEntries(Object.entries(staticConfig.locations)
    .filter(([, location]) => location.kind === 'merchant')
    .map(([id, location]) => {
      if (location.kind !== 'merchant') {
        throw new Error(`Expected merchant ${id}`);
      }
      return [id, {
        name: location.name,
        slots: location.spaces.length,
        minPlayers: location.minPlayers,
        bonus: location.bonus,
      }];
    })));
}

function legacyMerchantBonus(merchant: LegacyMerchant) {
  switch (merchant.bonusType) {
    case 'vp':
      return {type: 'victory_points' as const, points: merchant.bonusAmount};
    case 'develop':
      return {type: 'develop' as const, count: 1 as const};
    case 'income':
      return {type: 'income_spaces' as const, spaces: merchant.bonusAmount};
    case 'money':
      return {type: 'cash' as const, cash: merchant.bonusAmount};
  }
}

function legacyMerchantManifest(legacy: LegacyData) {
  return sortedRecord(Object.fromEntries(Object.entries(legacy.MERCHANTS).map(([id, merchant]) => [id, {
    name: merchant.name,
    slots: merchant.slots,
    minPlayers: merchant.minPlayers,
    bonus: legacyMerchantBonus(merchant),
  }])));
}

function staticLinkManifest() {
  return Object.values(staticConfig.linkLines)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((line) => ({
      id: line.id,
      endpoints: [line.endpointA, line.endpointB],
      canal: line.allowedLinkTypes.includes('canal'),
      rail: line.allowedLinkTypes.includes('rail'),
      ...(line.viaFarmBreweryId ? {viaBrewery: line.viaFarmBreweryId} : {}),
    }));
}

function legacyLinkManifest(legacy: LegacyData) {
  return legacy.CONNECTIONS
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((line) => ({
      id: line.id,
      endpoints: line.cities,
      canal: line.canal,
      rail: line.rail,
      ...(line.viaBrewery ? {viaBrewery: line.viaBrewery} : {}),
    }));
}

function cardDistribution(playerCount: PlayerCount) {
  const locations: Record<string, number> = {};
  const industries: Partial<Record<IndustryType, number>> = {};
  for (const cardId of getCardIdsForPlayerCount(playerCount)) {
    const card: CardSpec = staticConfig.cardSpecs[cardId];
    if (card.type === 'location' && card.locationId) {
      locations[card.locationId] = (locations[card.locationId] ?? 0) + 1;
    }
    if (card.type === 'industry' && card.industryType) {
      industries[card.industryType] = (industries[card.industryType] ?? 0) + 1;
    }
  }
  return {
    locations: sortedRecord(locations),
    industries: sortedRecord(industries as Record<string, number>),
  };
}

function legacyCardDistribution(legacy: LegacyData, playerCount: PlayerCount) {
  const deck = legacy.CARD_DECK[playerCount];
  const industries: Partial<Record<IndustryType, number>> = {};
  for (const [industryType, count] of Object.entries(deck.industries) as Array<[LegacyIndustryType, number]>) {
    industries[legacyToStaticIndustryType[industryType]] = count;
  }
  return {
    locations: sortedRecord(deck.locations),
    industries: sortedRecord(industries as Record<string, number>),
  };
}

function staticIndustryManifest(industryType: IndustryType) {
  return staticConfig.industryStackSpecIds[industryType].reduce<Array<{
    level: number;
    count: number;
    buildableEras: string[];
    cost: {cash: number; coal: number; iron: number};
    beerRequiredToSell?: number;
    flip: {incomeSpaces: number; victoryPoints: number; linkIcons: number};
    canDevelop: boolean;
  }>>((manifest, specId) => {
    const spec = staticConfig.industryTileSpecs[specId];
    const entry = {
      level: spec.level,
      count: 1,
      buildableEras: spec.buildableEras,
      cost: spec.cost,
      ...(spec.beerRequiredToSell === undefined ? {} : {beerRequiredToSell: spec.beerRequiredToSell}),
      flip: {
        incomeSpaces: spec.flip.incomeSpaces,
        victoryPoints: spec.flip.victoryPoints,
        linkIcons: spec.flip.linkIcons,
      },
      canDevelop: spec.canDevelop,
    };
    const current = manifest[manifest.length - 1];
    if (current && JSON.stringify({...current, count: 1}) === JSON.stringify(entry)) {
      current.count++;
      return manifest;
    }
    manifest.push(entry);
    return manifest;
  }, []);
}

function legacyIndustryManifest(legacy: LegacyData, industryType: LegacyIndustryType) {
  return legacy.INDUSTRY_DATA[industryType].map((tile) => ({
    level: tile.level,
    count: tile.count,
    buildableEras: [
      ...(tile.canalEra ? ['canal'] : []),
      ...(tile.railEra ? ['rail'] : []),
    ],
    cost: {
      cash: tile.cost,
      coal: tile.costCoal,
      iron: tile.costIron,
    },
    ...(tile.beersToSell === null ? {} : {beerRequiredToSell: tile.beersToSell}),
    flip: {
      incomeSpaces: tile.income,
      victoryPoints: tile.vp,
      linkIcons: tile.linkVP,
    },
    canDevelop: tile.canDevelop,
  }));
}

describe('legacy static data parity', () => {
  const legacy = loadLegacyData();

  it('matches the migrated city, merchant, link, market, and deck manifests', () => {
    expect(staticCityManifest()).toEqual(legacyCityManifest(legacy));
    expect(Object.keys(staticConfig.locations).filter((id) => staticConfig.locations[id].kind === 'farm_brewery').sort())
      .toEqual(Object.keys(legacy.BREWERY_FARMS).sort());
    expect(staticMerchantManifest()).toEqual(legacyMerchantManifest(legacy));
    expect(staticLinkManifest()).toEqual(legacyLinkManifest(legacy));
    expect(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive).toEqual(legacy.COAL_MARKET_PRICES);
    expect(staticConfig.markets.coal.initialOccupiedCount).toBe(legacy.COAL_MARKET_INITIAL);
    expect(staticConfig.markets.iron.priceSlotsCheapestToMostExpensive).toEqual(legacy.IRON_MARKET_PRICES);
    expect(staticConfig.markets.iron.initialOccupiedCount).toBe(legacy.IRON_MARKET_INITIAL);

    for (const playerCount of [2, 3, 4] as const) {
      expect(cardDistribution(playerCount)).toEqual(legacyCardDistribution(legacy, playerCount));
    }
  });

  it('matches legacy industry tile economics except era-specific resource placement handled by the new engine', () => {
    for (const [legacyIndustryType, staticIndustryType] of Object.entries(legacyToStaticIndustryType) as Array<[LegacyIndustryType, IndustryType]>) {
      expect(staticIndustryManifest(staticIndustryType)).toEqual(legacyIndustryManifest(legacy, legacyIndustryType));
    }
  });
});
