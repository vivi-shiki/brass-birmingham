import {describe, expect, it} from 'vitest';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../src/common/staticData';
import type {CardSpec, IndustryType, MerchantBonus, PlayerCount, StaticConfig} from '../src/common/types';

const industryTypes: IndustryType[] = [
  'cotton_mill',
  'coal_mine',
  'iron_works',
  'manufacturer',
  'pottery',
  'brewery',
];

const expectedCitySlotManifest = {
  belper: {
    name: 'Belper',
    region: 'derbyshire',
    slots: [['cotton_mill', 'manufacturer'], ['coal_mine'], ['pottery']],
  },
  birmingham: {
    name: 'Birmingham',
    region: 'birmingham',
    slots: [['cotton_mill', 'manufacturer'], ['manufacturer'], ['iron_works'], ['manufacturer']],
  },
  burtonOnTrent: {
    name: 'Burton-on-Trent',
    region: 'midlands',
    slots: [['manufacturer', 'coal_mine'], ['brewery']],
  },
  cannock: {
    name: 'Cannock',
    region: 'midlands',
    slots: [['manufacturer', 'coal_mine'], ['coal_mine']],
  },
  coalbrookdale: {
    name: 'Coalbrookdale',
    region: 'blackCountry',
    slots: [['iron_works', 'brewery'], ['iron_works'], ['coal_mine']],
  },
  coventry: {
    name: 'Coventry',
    region: 'birmingham',
    slots: [['pottery'], ['manufacturer', 'coal_mine'], ['iron_works', 'manufacturer']],
  },
  derby: {
    name: 'Derby',
    region: 'derbyshire',
    slots: [['cotton_mill', 'brewery'], ['cotton_mill', 'manufacturer'], ['iron_works']],
  },
  dudley: {
    name: 'Dudley',
    region: 'blackCountry',
    slots: [['coal_mine'], ['iron_works']],
  },
  kidderminster: {
    name: 'Kidderminster',
    region: 'blackCountry',
    slots: [['cotton_mill', 'coal_mine'], ['cotton_mill']],
  },
  leek: {
    name: 'Leek',
    region: 'staffordshire',
    slots: [['cotton_mill', 'manufacturer'], ['cotton_mill', 'coal_mine']],
  },
  nuneaton: {
    name: 'Nuneaton',
    region: 'birmingham',
    slots: [['manufacturer', 'brewery'], ['cotton_mill', 'coal_mine']],
  },
  redditch: {
    name: 'Redditch',
    region: 'birmingham',
    slots: [['manufacturer', 'coal_mine'], ['iron_works']],
  },
  stafford: {
    name: 'Stafford',
    region: 'midlands',
    slots: [['manufacturer', 'brewery'], ['pottery']],
  },
  stokeOnTrent: {
    name: 'Stoke-on-Trent',
    region: 'staffordshire',
    slots: [['cotton_mill', 'manufacturer'], ['pottery', 'iron_works'], ['manufacturer']],
  },
  stone: {
    name: 'Stone',
    region: 'staffordshire',
    slots: [['cotton_mill', 'brewery'], ['manufacturer', 'coal_mine']],
  },
  tamworth: {
    name: 'Tamworth',
    region: 'midlands',
    slots: [['cotton_mill', 'coal_mine'], ['cotton_mill', 'coal_mine']],
  },
  uttoxeter: {
    name: 'Uttoxeter',
    region: 'staffordshire',
    slots: [['manufacturer', 'brewery'], ['cotton_mill', 'brewery']],
  },
  walsall: {
    name: 'Walsall',
    region: 'midlands',
    slots: [['iron_works', 'manufacturer'], ['manufacturer', 'brewery']],
  },
  wolverhampton: {
    name: 'Wolverhampton',
    region: 'blackCountry',
    slots: [['manufacturer'], ['manufacturer', 'coal_mine']],
  },
  worcester: {
    name: 'Worcester',
    region: 'blackCountry',
    slots: [['cotton_mill'], ['cotton_mill']],
  },
} satisfies Record<string, {name: string; region: string; slots: IndustryType[][]}>;

const expectedFarmBreweryManifest = {
  northern: {name: 'Brewery (North)', printedLinkIcons: 0},
  southern: {name: 'Brewery (South)', printedLinkIcons: 0},
} satisfies Record<string, {name: string; printedLinkIcons: number}>;

const expectedMerchantLocationManifest = {
  gloucester: {
    name: 'Gloucester',
    minPlayers: 2,
    printedLinkIcons: 2,
    bonus: {type: 'develop', count: 1},
    spaces: [
      {id: 'gloucester-0', minPlayers: 2},
      {id: 'gloucester-1', minPlayers: 2},
    ],
    providesCoalMarketConnection: true,
  },
  nottingham: {
    name: 'Nottingham',
    minPlayers: 4,
    printedLinkIcons: 2,
    bonus: {type: 'victory_points', points: 3},
    spaces: [
      {id: 'nottingham-0', minPlayers: 4},
      {id: 'nottingham-1', minPlayers: 4},
    ],
    providesCoalMarketConnection: true,
  },
  oxford: {
    name: 'Oxford',
    minPlayers: 2,
    printedLinkIcons: 2,
    bonus: {type: 'income_spaces', spaces: 2},
    spaces: [
      {id: 'oxford-0', minPlayers: 2},
      {id: 'oxford-1', minPlayers: 2},
    ],
    providesCoalMarketConnection: true,
  },
  shrewsbury: {
    name: 'Shrewsbury',
    minPlayers: 2,
    printedLinkIcons: 2,
    bonus: {type: 'victory_points', points: 4},
    spaces: [
      {id: 'shrewsbury-0', minPlayers: 2},
    ],
    providesCoalMarketConnection: true,
  },
  warrington: {
    name: 'Warrington',
    minPlayers: 3,
    printedLinkIcons: 2,
    bonus: {type: 'cash', cash: 5},
    spaces: [
      {id: 'warrington-0', minPlayers: 3},
      {id: 'warrington-1', minPlayers: 3},
    ],
    providesCoalMarketConnection: true,
  },
} satisfies Record<string, {
  name: string;
  minPlayers: PlayerCount;
  printedLinkIcons: number;
  bonus: MerchantBonus;
  spaces: Array<{id: string; minPlayers: PlayerCount}>;
  providesCoalMarketConnection: boolean;
}>;

const expectedMarketManifest = {
  coal: {
    resourceType: 'coal',
    priceSlotsCheapestToMostExpensive: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8],
    initialOccupiedCount: 13,
    fallbackPriceWhenEmpty: 8,
    requiresConnection: true,
  },
  iron: {
    resourceType: 'iron',
    priceSlotsCheapestToMostExpensive: [1, 1, 2, 2, 3, 3, 4, 5, 6, 6],
    initialOccupiedCount: 8,
    fallbackPriceWhenEmpty: 6,
    requiresConnection: false,
  },
} as const;

const expectedRulesManifest: StaticConfig['rules'] = {
  initialCash: 17,
  handSize: 8,
  firstCanalRoundActions: 1,
  normalActionsPerTurn: 2,
  initialLinksPerType: 14,
  wildCardsPerType: 4,
  loanCash: 30,
  loanIncomeLevelPenalty: 3,
  canalLinkCost: 3,
  railSingleLinkCost: 5,
  railDoubleLinkCost: 15,
  railCoalPerLink: 1,
  railDoubleBeer: 1,
};

const expectedIncomeTrackManifest = {
  minIncomeLevel: -10,
  maxIncomeLevel: 30,
  startPosition: 10,
  levelCounts: [
    [-10, 1],
    [-9, 1],
    [-8, 1],
    [-7, 1],
    [-6, 1],
    [-5, 1],
    [-4, 1],
    [-3, 1],
    [-2, 1],
    [-1, 1],
    [0, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 2],
    [6, 2],
    [7, 2],
    [8, 2],
    [9, 2],
    [10, 2],
    [11, 3],
    [12, 3],
    [13, 3],
    [14, 3],
    [15, 3],
    [16, 3],
    [17, 3],
    [18, 3],
    [19, 3],
    [20, 3],
    [21, 4],
    [22, 4],
    [23, 4],
    [24, 4],
    [25, 4],
    [26, 4],
    [27, 4],
    [28, 4],
    [29, 4],
    [30, 4],
  ],
} as const;

const expectedCardDistributionByPlayerCount: Record<PlayerCount, {
  locations: Record<string, number>;
  industries: Partial<Record<IndustryType, number>>;
}> = {
  2: {
    locations: {
      birmingham: 3,
      burtonOnTrent: 2,
      cannock: 2,
      coalbrookdale: 3,
      coventry: 3,
      dudley: 2,
      kidderminster: 2,
      nuneaton: 1,
      redditch: 1,
      stafford: 2,
      tamworth: 1,
      walsall: 1,
      wolverhampton: 2,
      worcester: 2,
    },
    industries: {
      brewery: 5,
      coal_mine: 2,
      iron_works: 4,
      pottery: 2,
    },
  },
  3: {
    locations: {
      birmingham: 3,
      burtonOnTrent: 2,
      cannock: 2,
      coalbrookdale: 3,
      coventry: 3,
      dudley: 2,
      kidderminster: 2,
      leek: 2,
      nuneaton: 1,
      redditch: 1,
      stafford: 2,
      stokeOnTrent: 3,
      stone: 2,
      tamworth: 1,
      uttoxeter: 1,
      walsall: 1,
      wolverhampton: 2,
      worcester: 2,
    },
    industries: {
      brewery: 5,
      coal_mine: 2,
      cotton_mill: 3,
      iron_works: 4,
      manufacturer: 3,
      pottery: 2,
    },
  },
  4: {
    locations: {
      belper: 2,
      birmingham: 3,
      burtonOnTrent: 2,
      cannock: 2,
      coalbrookdale: 3,
      coventry: 3,
      derby: 3,
      dudley: 2,
      kidderminster: 2,
      leek: 2,
      nuneaton: 1,
      redditch: 1,
      stafford: 2,
      stokeOnTrent: 3,
      stone: 2,
      tamworth: 1,
      uttoxeter: 2,
      walsall: 1,
      wolverhampton: 2,
      worcester: 2,
    },
    industries: {
      brewery: 5,
      coal_mine: 3,
      cotton_mill: 4,
      iron_works: 4,
      manufacturer: 4,
      pottery: 3,
    },
  },
};

const expectedMerchantTileManifest = {
  'blank-2p': {minPlayers: 2, acceptedIndustryTypes: [], blank: true},
  'blank-3p': {minPlayers: 3, acceptedIndustryTypes: [], blank: true},
  'gloucester-cotton': {minPlayers: 2, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'gloucester-manufacturer': {minPlayers: 2, acceptedIndustryTypes: ['manufacturer'], blank: false},
  'nottingham-cotton': {minPlayers: 4, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'nottingham-manufacturer': {minPlayers: 4, acceptedIndustryTypes: ['manufacturer'], blank: false},
  'oxford-cotton': {minPlayers: 2, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'oxford-manufacturer': {minPlayers: 2, acceptedIndustryTypes: ['manufacturer'], blank: false},
  'warrington-pottery': {minPlayers: 3, acceptedIndustryTypes: ['pottery'], blank: false},
};

const expectedLinkSupport = [
  ['belper-derby', 'belper', 'derby', ['canal', 'rail']],
  ['belper-leek', 'belper', 'leek', ['rail']],
  ['birmingham-coventry', 'birmingham', 'coventry', ['canal', 'rail']],
  ['birmingham-dudley', 'birmingham', 'dudley', ['canal', 'rail']],
  ['birmingham-nuneaton', 'birmingham', 'nuneaton', ['rail']],
  ['birmingham-oxford', 'birmingham', 'oxford', ['canal', 'rail']],
  ['birmingham-redditch', 'birmingham', 'redditch', ['rail']],
  ['birmingham-tamworth', 'birmingham', 'tamworth', ['canal', 'rail']],
  ['birmingham-walsall', 'birmingham', 'walsall', ['canal', 'rail']],
  ['birmingham-worcester', 'birmingham', 'worcester', ['canal', 'rail']],
  ['burtonOnTrent-cannock', 'burtonOnTrent', 'cannock', ['rail']],
  ['burtonOnTrent-derby', 'burtonOnTrent', 'derby', ['canal', 'rail']],
  ['burtonOnTrent-stone', 'burtonOnTrent', 'stone', ['canal', 'rail']],
  ['burtonOnTrent-tamworth', 'burtonOnTrent', 'tamworth', ['canal', 'rail']],
  ['burtonOnTrent-walsall', 'burtonOnTrent', 'walsall', ['canal']],
  ['cannock-northern', 'cannock', 'northern', ['canal', 'rail']],
  ['cannock-stafford', 'cannock', 'stafford', ['canal', 'rail']],
  ['cannock-walsall', 'cannock', 'walsall', ['canal', 'rail']],
  ['cannock-wolverhampton', 'cannock', 'wolverhampton', ['canal', 'rail']],
  ['coalbrookdale-kidderminster', 'coalbrookdale', 'kidderminster', ['canal', 'rail']],
  ['coalbrookdale-shrewsbury', 'coalbrookdale', 'shrewsbury', ['canal', 'rail']],
  ['coalbrookdale-wolverhampton', 'coalbrookdale', 'wolverhampton', ['canal', 'rail']],
  ['coventry-nuneaton', 'coventry', 'nuneaton', ['rail']],
  ['derby-nottingham', 'derby', 'nottingham', ['canal', 'rail']],
  ['derby-uttoxeter', 'derby', 'uttoxeter', ['rail']],
  ['dudley-kidderminster', 'dudley', 'kidderminster', ['canal', 'rail']],
  ['dudley-wolverhampton', 'dudley', 'wolverhampton', ['canal', 'rail']],
  ['gloucester-redditch', 'gloucester', 'redditch', ['canal', 'rail']],
  ['gloucester-worcester', 'gloucester', 'worcester', ['canal', 'rail']],
  ['kidderminster-worcester', 'kidderminster', 'worcester', ['canal', 'rail'], 'southern'],
  ['leek-stokeOnTrent', 'leek', 'stokeOnTrent', ['canal', 'rail']],
  ['nuneaton-tamworth', 'nuneaton', 'tamworth', ['canal', 'rail']],
  ['redditch-oxford', 'redditch', 'oxford', ['canal', 'rail']],
  ['stafford-stone', 'stafford', 'stone', ['canal', 'rail']],
  ['stokeOnTrent-stone', 'stokeOnTrent', 'stone', ['canal', 'rail']],
  ['stokeOnTrent-warrington', 'stokeOnTrent', 'warrington', ['canal', 'rail']],
  ['stone-uttoxeter', 'stone', 'uttoxeter', ['rail']],
  ['tamworth-walsall', 'tamworth', 'walsall', ['rail']],
  ['walsall-wolverhampton', 'walsall', 'wolverhampton', ['canal', 'rail']],
] as const;

const expectedIndustryLevelManifest: Record<IndustryType, Array<{
  level: number;
  count: number;
  buildableEras: string[];
  cost: {cash: number; coal: number; iron: number};
  beerRequiredToSell?: number;
  flip: {incomeSpaces: number; victoryPoints: number; linkIcons: number};
  resourcesWhenBuilt?: Record<string, number>;
  canDevelop: boolean;
  lightbulbPottery?: boolean;
}>> = {
  brewery: [
    {level: 1, count: 2, buildableEras: ['canal'], cost: {cash: 5, coal: 0, iron: 1}, flip: {incomeSpaces: 4, victoryPoints: 4, linkIcons: 2}, resourcesWhenBuilt: {canal: 1}, canDevelop: true},
    {level: 2, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 7, coal: 0, iron: 1}, flip: {incomeSpaces: 5, victoryPoints: 5, linkIcons: 2}, resourcesWhenBuilt: {canal: 1, rail: 2}, canDevelop: true},
    {level: 3, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 9, coal: 0, iron: 1}, flip: {incomeSpaces: 5, victoryPoints: 7, linkIcons: 2}, resourcesWhenBuilt: {canal: 1, rail: 2}, canDevelop: true},
    {level: 4, count: 1, buildableEras: ['rail'], cost: {cash: 9, coal: 0, iron: 1}, flip: {incomeSpaces: 5, victoryPoints: 10, linkIcons: 2}, resourcesWhenBuilt: {rail: 2}, canDevelop: true},
  ],
  coal_mine: [
    {level: 1, count: 1, buildableEras: ['canal'], cost: {cash: 5, coal: 0, iron: 0}, flip: {incomeSpaces: 4, victoryPoints: 1, linkIcons: 2}, resourcesWhenBuilt: {canal: 2, rail: 2}, canDevelop: true},
    {level: 2, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 7, coal: 0, iron: 0}, flip: {incomeSpaces: 7, victoryPoints: 2, linkIcons: 1}, resourcesWhenBuilt: {canal: 3, rail: 3}, canDevelop: true},
    {level: 3, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 8, coal: 0, iron: 1}, flip: {incomeSpaces: 6, victoryPoints: 3, linkIcons: 1}, resourcesWhenBuilt: {canal: 4, rail: 4}, canDevelop: true},
    {level: 4, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 10, coal: 0, iron: 1}, flip: {incomeSpaces: 5, victoryPoints: 4, linkIcons: 1}, resourcesWhenBuilt: {canal: 5, rail: 5}, canDevelop: true},
  ],
  cotton_mill: [
    {level: 1, count: 3, buildableEras: ['canal'], cost: {cash: 12, coal: 0, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 5, victoryPoints: 5, linkIcons: 1}, canDevelop: true},
    {level: 2, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 14, coal: 1, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 4, victoryPoints: 5, linkIcons: 2}, canDevelop: true},
    {level: 3, count: 3, buildableEras: ['canal', 'rail'], cost: {cash: 16, coal: 1, iron: 1}, beerRequiredToSell: 1, flip: {incomeSpaces: 3, victoryPoints: 9, linkIcons: 1}, canDevelop: true},
    {level: 4, count: 3, buildableEras: ['canal', 'rail'], cost: {cash: 18, coal: 1, iron: 1}, beerRequiredToSell: 1, flip: {incomeSpaces: 2, victoryPoints: 12, linkIcons: 1}, canDevelop: true},
  ],
  iron_works: [
    {level: 1, count: 1, buildableEras: ['canal'], cost: {cash: 5, coal: 1, iron: 0}, flip: {incomeSpaces: 3, victoryPoints: 3, linkIcons: 1}, resourcesWhenBuilt: {canal: 4, rail: 4}, canDevelop: true},
    {level: 2, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 7, coal: 1, iron: 0}, flip: {incomeSpaces: 3, victoryPoints: 5, linkIcons: 1}, resourcesWhenBuilt: {canal: 4, rail: 4}, canDevelop: true},
    {level: 3, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 9, coal: 1, iron: 0}, flip: {incomeSpaces: 2, victoryPoints: 7, linkIcons: 1}, resourcesWhenBuilt: {canal: 5, rail: 5}, canDevelop: true},
    {level: 4, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 12, coal: 1, iron: 0}, flip: {incomeSpaces: 1, victoryPoints: 9, linkIcons: 1}, resourcesWhenBuilt: {canal: 6, rail: 6}, canDevelop: true},
  ],
  manufacturer: [
    {level: 1, count: 1, buildableEras: ['canal'], cost: {cash: 8, coal: 1, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 5, victoryPoints: 3, linkIcons: 2}, canDevelop: true},
    {level: 2, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 10, coal: 0, iron: 1}, beerRequiredToSell: 1, flip: {incomeSpaces: 1, victoryPoints: 5, linkIcons: 1}, canDevelop: true},
    {level: 3, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 12, coal: 2, iron: 0}, beerRequiredToSell: 0, flip: {incomeSpaces: 4, victoryPoints: 4, linkIcons: 0}, canDevelop: true},
    {level: 4, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 8, coal: 0, iron: 1}, beerRequiredToSell: 1, flip: {incomeSpaces: 6, victoryPoints: 3, linkIcons: 1}, canDevelop: true},
    {level: 5, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 16, coal: 1, iron: 0}, beerRequiredToSell: 2, flip: {incomeSpaces: 2, victoryPoints: 8, linkIcons: 2}, canDevelop: true},
    {level: 6, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 20, coal: 0, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 6, victoryPoints: 7, linkIcons: 1}, canDevelop: true},
    {level: 7, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 16, coal: 1, iron: 1}, beerRequiredToSell: 0, flip: {incomeSpaces: 4, victoryPoints: 9, linkIcons: 0}, canDevelop: true},
    {level: 8, count: 2, buildableEras: ['canal', 'rail'], cost: {cash: 20, coal: 0, iron: 2}, beerRequiredToSell: 1, flip: {incomeSpaces: 1, victoryPoints: 11, linkIcons: 1}, canDevelop: true},
  ],
  pottery: [
    {level: 1, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 17, coal: 0, iron: 1}, beerRequiredToSell: 1, flip: {incomeSpaces: 5, victoryPoints: 10, linkIcons: 1}, canDevelop: false, lightbulbPottery: true},
    {level: 2, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 0, coal: 1, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 1, victoryPoints: 1, linkIcons: 1}, canDevelop: true},
    {level: 3, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 22, coal: 2, iron: 0}, beerRequiredToSell: 2, flip: {incomeSpaces: 5, victoryPoints: 11, linkIcons: 1}, canDevelop: false, lightbulbPottery: true},
    {level: 4, count: 1, buildableEras: ['canal', 'rail'], cost: {cash: 0, coal: 1, iron: 0}, beerRequiredToSell: 1, flip: {incomeSpaces: 1, victoryPoints: 1, linkIcons: 1}, canDevelop: true},
    {level: 5, count: 1, buildableEras: ['rail'], cost: {cash: 24, coal: 2, iron: 0}, beerRequiredToSell: 2, flip: {incomeSpaces: 5, victoryPoints: 20, linkIcons: 1}, canDevelop: true},
  ],
};

function cardsForPlayerCount(playerCount: PlayerCount): CardSpec[] {
  return getCardIdsForPlayerCount(playerCount).map((cardId) => staticConfig.cardSpecs[cardId]);
}

function assertUnique(values: string[]): void {
  expect(new Set(values).size).toBe(values.length);
}

function cardDistribution(cards: CardSpec[]) {
  const locations: Record<string, number> = {};
  const industries: Partial<Record<IndustryType, number>> = {};

  for (const card of cards) {
    if (card.type === 'location' && card.locationId) {
      locations[card.locationId] = (locations[card.locationId] ?? 0) + 1;
    }
    if (card.type === 'industry' && card.industryType) {
      industries[card.industryType] = (industries[card.industryType] ?? 0) + 1;
    }
  }

  return {locations, industries};
}

function industryLevelManifest(industryType: IndustryType) {
  return staticConfig.industryStackSpecIds[industryType].reduce<Array<{
    level: number;
    count: number;
    buildableEras: string[];
    cost: {cash: number; coal: number; iron: number};
    beerRequiredToSell?: number;
    flip: {incomeSpaces: number; victoryPoints: number; linkIcons: number};
    resourcesWhenBuilt?: Record<string, number>;
    canDevelop: boolean;
    lightbulbPottery?: boolean;
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
      ...(spec.resourcesWhenBuilt === undefined ? {} : {resourcesWhenBuilt: spec.resourcesWhenBuilt}),
      canDevelop: spec.canDevelop,
      ...(spec.special?.lightbulbPottery === undefined ? {} : {lightbulbPottery: spec.special.lightbulbPottery}),
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

function incomeTrackLevelCounts(): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const entry of staticConfig.incomeTrack.positions) {
    counts.set(entry.incomeLevel, (counts.get(entry.incomeLevel) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort(([a], [b]) => a - b);
}

describe('static rules data integrity', () => {
  it('matches the official component counts represented in rules data', () => {
    const expectedIndustryTilesPerPlayer: Record<IndustryType, number> = {
      cotton_mill: 11,
      coal_mine: 7,
      iron_works: 4,
      manufacturer: 11,
      pottery: 5,
      brewery: 7,
    };

    for (const industryType of industryTypes) {
      expect(staticConfig.industryStackSpecIds[industryType]).toHaveLength(expectedIndustryTilesPerPlayer[industryType]);
    }

    const industryTilesPerPlayer = Object.values(staticConfig.industryStackSpecIds)
      .reduce((total, stack) => total + stack.length, 0);
    expect(industryTilesPerPlayer).toBe(45);
    expect(industryTilesPerPlayer * 4).toBe(180);
    expect(Object.keys(staticConfig.merchantTileSpecs)).toHaveLength(9);
    expect(getCardIdsForPlayerCount(4)).toHaveLength(64);
    expect([...getWildLocationCardIds(), ...getWildIndustryCardIds()]).toHaveLength(8);
  });

  it('defines the expected location graph shape', () => {
    const locations = Object.values(staticConfig.locations);
    expect(locations.filter((location) => location.kind === 'city')).toHaveLength(20);
    expect(locations.filter((location) => location.kind === 'farm_brewery')).toHaveLength(2);
    expect(locations.filter((location) => location.kind === 'merchant')).toHaveLength(5);

    const slotIds = locations.flatMap((location) => location.kind === 'city' ? location.slots.map((slot) => slot.id) : []);
    assertUnique(slotIds);
    for (const location of locations) {
      if (location.kind === 'city') {
        expect(location.slots.length).toBeGreaterThan(0);
        for (const slot of location.slots) {
          expect(slot.cityId).toBe(location.id);
          expect(slot.allowedIndustryTypes.length).toBeGreaterThan(0);
          for (const industryType of slot.allowedIndustryTypes) {
            expect(industryTypes).toContain(industryType);
          }
        }
      }
    }
  });

  it('defines valid link lines with resolvable endpoints and era support', () => {
    const links = Object.values(staticConfig.linkLines);
    expect(links).toHaveLength(39);

    for (const link of links) {
      expect(staticConfig.locations[link.endpointA]).toBeDefined();
      expect(staticConfig.locations[link.endpointB]).toBeDefined();
      expect(link.endpointA).not.toBe(link.endpointB);
      expect(link.allowedLinkTypes.length).toBeGreaterThan(0);
      expect(new Set(link.allowedLinkTypes).size).toBe(link.allowedLinkTypes.length);
      if (link.viaFarmBreweryId) {
        expect(staticConfig.locations[link.viaFarmBreweryId]?.kind).toBe('farm_brewery');
      }
    }

    expect(staticConfig.linkLines['kidderminster-worcester'].viaFarmBreweryId).toBe('southern');
    expect(staticConfig.linkLines['cannock-northern'].endpointB).toBe('northern');
  });

  it('matches the audited city slot manifest', () => {
    const actual = Object.fromEntries(Object.entries(staticConfig.locations)
      .filter(([, location]) => location.kind === 'city')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, location]) => {
        if (location.kind !== 'city') {
          throw new Error(`Expected city location ${id}`);
        }
        return [id, {
          name: location.name,
          region: location.region,
          slots: location.slots.map((slot, index) => {
            expect(slot.id).toBe(`${id}-${index}`);
            expect(slot.cityId).toBe(id);
            return slot.allowedIndustryTypes;
          }),
        }];
      }));

    expect(actual).toEqual(expectedCitySlotManifest);
  });

  it('matches the audited merchant and farm brewery location manifests', () => {
    const farmBreweries = Object.fromEntries(Object.entries(staticConfig.locations)
      .filter(([, location]) => location.kind === 'farm_brewery')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, location]) => {
        if (location.kind !== 'farm_brewery') {
          throw new Error(`Expected farm brewery location ${id}`);
        }
        return [id, {
          name: location.name,
          printedLinkIcons: location.printedLinkIcons,
        }];
      }));

    const merchants = Object.fromEntries(Object.entries(staticConfig.locations)
      .filter(([, location]) => location.kind === 'merchant')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, location]) => {
        if (location.kind !== 'merchant') {
          throw new Error(`Expected merchant location ${id}`);
        }
        return [id, {
          name: location.name,
          minPlayers: location.minPlayers,
          printedLinkIcons: location.printedLinkIcons,
          bonus: location.bonus,
          spaces: location.spaces.map((space, index) => {
            expect(space.id).toBe(`${id}-${index}`);
            expect(space.locationId).toBe(id);
            return {
              id: space.id,
              minPlayers: space.minPlayers,
            };
          }),
          providesCoalMarketConnection: location.providesCoalMarketConnection,
        }];
      }));

    expect(farmBreweries).toEqual(expectedFarmBreweryManifest);
    expect(merchants).toEqual(expectedMerchantLocationManifest);
  });

  it('matches the audited map link manifest including canal/rail support', () => {
    const actual = Object.values(staticConfig.linkLines)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((link) => [
        link.id,
        link.endpointA,
        link.endpointB,
        link.allowedLinkTypes,
        ...(link.viaFarmBreweryId ? [link.viaFarmBreweryId] : []),
      ]);

    expect(actual).toEqual(expectedLinkSupport);
  });

  it('builds player-count decks sized for the exact number of era actions plus facedown discards', () => {
    const expectedRoundsByPlayerCount: Record<PlayerCount, number> = {2: 10, 3: 9, 4: 8};
    const expectedDeckSizes: Record<PlayerCount, number> = {2: 40, 3: 54, 4: 64};

    for (const playerCount of [2, 3, 4] as const) {
      const cards = cardsForPlayerCount(playerCount);
      const expectedCards = playerCount * expectedRoundsByPlayerCount[playerCount] * staticConfig.rules.normalActionsPerTurn;
      expect(cards).toHaveLength(expectedDeckSizes[playerCount]);
      expect(cards).toHaveLength(expectedCards);
      assertUnique(cards.map((card) => card.id));
      for (const card of cards) {
        expect(card.minPlayers).toBe(playerCount);
        if (card.type === 'location') {
          expect(staticConfig.locations[card.locationId ?? '']).toBeDefined();
        }
        if (card.type === 'industry') {
          expect(industryTypes).toContain(card.industryType);
        }
      }
    }

    expect(getWildLocationCardIds()).toHaveLength(staticConfig.rules.wildCardsPerType);
    expect(getWildIndustryCardIds()).toHaveLength(staticConfig.rules.wildCardsPerType);
  });

  it('matches the audited location and industry card distribution by player count', () => {
    for (const playerCount of [2, 3, 4] as const) {
      expect(cardDistribution(cardsForPlayerCount(playerCount))).toEqual(expectedCardDistributionByPlayerCount[playerCount]);
    }
  });

  it('defines complete ordered industry stacks and tile specs', () => {
    const allStackedSpecIds = new Set<string>();
    for (const industryType of industryTypes) {
      const stack = staticConfig.industryStackSpecIds[industryType];
      expect(stack.length).toBeGreaterThan(0);
      let previousSequence = -1;
      for (const specId of stack) {
        const spec = staticConfig.industryTileSpecs[specId];
        expect(spec).toBeDefined();
        expect(spec.industryType).toBe(industryType);
        expect(spec.sequenceIndex).toBeGreaterThan(previousSequence);
        expect(spec.buildableEras.length).toBeGreaterThan(0);
        expect(spec.cost.cash).toBeGreaterThanOrEqual(0);
        expect(spec.cost.coal).toBeGreaterThanOrEqual(0);
        expect(spec.cost.iron).toBeGreaterThanOrEqual(0);
        expect(spec.flip.incomeSpaces).toBeGreaterThanOrEqual(0);
        expect(spec.flip.victoryPoints).toBeGreaterThanOrEqual(0);
        expect(spec.flip.linkIcons).toBeGreaterThanOrEqual(0);
        previousSequence = spec.sequenceIndex;
        allStackedSpecIds.add(specId);
      }
    }

    expect(allStackedSpecIds).toEqual(new Set(Object.keys(staticConfig.industryTileSpecs)));
    for (const spec of Object.values(staticConfig.industryTileSpecs)) {
      if (spec.industryType === 'coal_mine' || spec.industryType === 'iron_works' || spec.industryType === 'brewery') {
        expect(spec.flip.trigger).toBe('resource_depleted');
        expect(spec.resourcesWhenBuilt).toBeDefined();
      } else {
        expect(spec.flip.trigger).toBe('sell');
        expect(spec.beerRequiredToSell).toBeGreaterThanOrEqual(0);
      }
      if (spec.special?.lightbulbPottery) {
        expect(spec.industryType).toBe('pottery');
        expect(spec.canDevelop).toBe(false);
      }
    }
  });

  it('matches the audited industry tile level manifest', () => {
    for (const industryType of industryTypes) {
      expect(industryLevelManifest(industryType)).toEqual(expectedIndustryLevelManifest[industryType]);
    }
  });

  it('matches brewery beer placement by era', () => {
    const brewerySpecs = Object.values(staticConfig.industryTileSpecs)
      .filter((spec) => spec.industryType === 'brewery');

    for (const spec of brewerySpecs) {
      expect(spec.resourcesWhenBuilt?.canal).toBe(spec.buildableEras.includes('canal') ? 1 : undefined);
      expect(spec.resourcesWhenBuilt?.rail).toBe(spec.buildableEras.includes('rail') ? 2 : undefined);
    }
  });

  it('defines merchant spaces and merchant tiles consistently by player count', () => {
    const merchantSpaceIds = new Set<string>();
    for (const location of Object.values(staticConfig.locations)) {
      if (location.kind !== 'merchant') {
        continue;
      }
      expect(location.providesCoalMarketConnection).toBe(true);
      expect(location.printedLinkIcons).toBeGreaterThan(0);
      for (const space of location.spaces) {
        expect(space.locationId).toBe(location.id);
        expect(space.minPlayers).toBeGreaterThanOrEqual(location.minPlayers);
        merchantSpaceIds.add(space.id);
      }
    }

    for (const tile of Object.values(staticConfig.merchantTileSpecs)) {
      expect(tile.minPlayers).toBeGreaterThanOrEqual(2);
      expect(tile.minPlayers).toBeLessThanOrEqual(4);
      if (tile.blank) {
        expect(tile.acceptedIndustryTypes).toHaveLength(0);
      } else {
        expect(tile.acceptedIndustryTypes.length).toBeGreaterThan(0);
        for (const industryType of tile.acceptedIndustryTypes) {
          expect(['cotton_mill', 'manufacturer', 'pottery']).toContain(industryType);
        }
      }
    }

    const expectedMerchantTileCounts: Record<PlayerCount, number> = {2: 5, 3: 7, 4: 9};
    const expectedBlankMerchantTileCounts: Record<PlayerCount, number> = {2: 1, 3: 2, 4: 2};
    for (const playerCount of [2, 3, 4] as const) {
      const activeMerchantSpaceCount = Object.values(staticConfig.locations)
        .filter((location) => location.kind === 'merchant' && location.minPlayers <= playerCount)
        .flatMap((location) => location.kind === 'merchant'
          ? location.spaces.filter((space) => space.minPlayers <= playerCount)
          : [])
        .length;
      const merchantTiles = Object.values(staticConfig.merchantTileSpecs)
        .filter((tile) => tile.minPlayers <= playerCount);

      expect(merchantTiles).toHaveLength(activeMerchantSpaceCount);
      expect(merchantTiles).toHaveLength(expectedMerchantTileCounts[playerCount]);
      expect(merchantTiles.filter((tile) => tile.blank)).toHaveLength(expectedBlankMerchantTileCounts[playerCount]);
    }

    expect(staticConfig.merchantTileSpecs['blank-2p']).toMatchObject({minPlayers: 2, acceptedIndustryTypes: [], blank: true});
    expect(staticConfig.merchantTileSpecs['blank-3p']).toMatchObject({minPlayers: 3, acceptedIndustryTypes: [], blank: true});
    expect(merchantSpaceIds.size).toBe(9);
  });

  it('matches the audited merchant tile manifest', () => {
    const actual = Object.fromEntries(Object.entries(staticConfig.merchantTileSpecs).map(([id, spec]) => {
      expect(spec.id).toBe(id);
      return [id, {
        minPlayers: spec.minPlayers,
        acceptedIndustryTypes: spec.acceptedIndustryTypes,
        blank: spec.blank,
      }];
    }));

    expect(actual).toEqual(expectedMerchantTileManifest);
  });

  it('matches the audited resource market manifest', () => {
    expect(staticConfig.markets).toEqual(expectedMarketManifest);
  });

  it('matches the audited core rules manifest', () => {
    expect(staticConfig.rules).toEqual(expectedRulesManifest);
  });

  it('matches the audited income track manifest', () => {
    expect({
      minIncomeLevel: staticConfig.incomeTrack.minIncomeLevel,
      maxIncomeLevel: staticConfig.incomeTrack.maxIncomeLevel,
      startPosition: staticConfig.incomeTrack.startPosition,
      levelCounts: incomeTrackLevelCounts(),
    }).toEqual(expectedIncomeTrackManifest);
    expect(staticConfig.incomeTrack.positions).toHaveLength(
      expectedIncomeTrackManifest.levelCounts.reduce((total, [, count]) => total + count, 0),
    );
  });

  it('defines monotonic markets and a continuous income track', () => {
    for (const market of Object.values(staticConfig.markets)) {
      expect(market.initialOccupiedCount).toBeGreaterThan(0);
      expect(market.initialOccupiedCount).toBeLessThanOrEqual(market.priceSlotsCheapestToMostExpensive.length);
      expect(market.fallbackPriceWhenEmpty).toBeGreaterThanOrEqual(Math.max(...market.priceSlotsCheapestToMostExpensive));
      for (let index = 1; index < market.priceSlotsCheapestToMostExpensive.length; index++) {
        expect(market.priceSlotsCheapestToMostExpensive[index]).toBeGreaterThanOrEqual(market.priceSlotsCheapestToMostExpensive[index - 1]);
      }
    }

    const positions = staticConfig.incomeTrack.positions;
    expect(positions[0]).toEqual({position: 0, incomeLevel: staticConfig.incomeTrack.minIncomeLevel});
    expect(positions[staticConfig.incomeTrack.startPosition].incomeLevel).toBe(0);
    expect(positions[positions.length - 1].incomeLevel).toBe(staticConfig.incomeTrack.maxIncomeLevel);
    for (let index = 0; index < positions.length; index++) {
      expect(positions[index].position).toBe(index);
      if (index > 0) {
        expect(positions[index].incomeLevel).toBeGreaterThanOrEqual(positions[index - 1].incomeLevel);
      }
    }
  });
});
