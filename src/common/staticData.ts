import type {
  CardSpec,
  CitySpec,
  FarmBrewerySpec,
  IndustryTileSpec,
  IndustryType,
  LinkLineSpec,
  MerchantSpec,
  MerchantTileSpec,
  PlayerCount,
  StaticConfig,
} from './types';

const industryDisplayNames: Record<IndustryType, string> = {
  cotton_mill: 'Cotton Mill',
  coal_mine: 'Coal Mine',
  iron_works: 'Iron Works',
  manufacturer: 'Manufacturer',
  pottery: 'Pottery',
  brewery: 'Brewery',
};

interface IndustryTileInput {
  level: number;
  count: number;
  eras: Array<'canal' | 'rail'>;
  cash: number;
  coal: number;
  iron: number;
  beer?: number;
  vp: number;
  income: number;
  linkIcons: number;
  canDevelop: boolean;
  resources?: Partial<Record<'canal' | 'rail', number>>;
  lightbulb?: boolean;
}

const cityInput = {
  belper: {name: 'Belper', region: 'derbyshire', slots: [['cotton_mill', 'manufacturer'], ['coal_mine'], ['pottery']]},
  derby: {name: 'Derby', region: 'derbyshire', slots: [['cotton_mill', 'brewery'], ['cotton_mill', 'manufacturer'], ['iron_works']]},
  leek: {name: 'Leek', region: 'staffordshire', slots: [['cotton_mill', 'manufacturer'], ['cotton_mill', 'coal_mine']]},
  stokeOnTrent: {name: 'Stoke-on-Trent', region: 'staffordshire', slots: [['cotton_mill', 'manufacturer'], ['pottery', 'iron_works'], ['manufacturer']]},
  stone: {name: 'Stone', region: 'staffordshire', slots: [['cotton_mill', 'brewery'], ['manufacturer', 'coal_mine']]},
  uttoxeter: {name: 'Uttoxeter', region: 'staffordshire', slots: [['manufacturer', 'brewery'], ['cotton_mill', 'brewery']]},
  stafford: {name: 'Stafford', region: 'midlands', slots: [['manufacturer', 'brewery'], ['pottery']]},
  burtonOnTrent: {name: 'Burton-on-Trent', region: 'midlands', slots: [['manufacturer', 'coal_mine'], ['brewery']]},
  cannock: {name: 'Cannock', region: 'midlands', slots: [['manufacturer', 'coal_mine'], ['coal_mine']]},
  tamworth: {name: 'Tamworth', region: 'midlands', slots: [['cotton_mill', 'coal_mine'], ['cotton_mill', 'coal_mine']]},
  walsall: {name: 'Walsall', region: 'midlands', slots: [['iron_works', 'manufacturer'], ['manufacturer', 'brewery']]},
  wolverhampton: {name: 'Wolverhampton', region: 'blackCountry', slots: [['manufacturer'], ['manufacturer', 'coal_mine']]},
  coalbrookdale: {name: 'Coalbrookdale', region: 'blackCountry', slots: [['iron_works', 'brewery'], ['iron_works'], ['coal_mine']]},
  dudley: {name: 'Dudley', region: 'blackCountry', slots: [['coal_mine'], ['iron_works']]},
  kidderminster: {name: 'Kidderminster', region: 'blackCountry', slots: [['cotton_mill', 'coal_mine'], ['cotton_mill']]},
  worcester: {name: 'Worcester', region: 'blackCountry', slots: [['cotton_mill'], ['cotton_mill']]},
  birmingham: {name: 'Birmingham', region: 'birmingham', slots: [['cotton_mill', 'manufacturer'], ['manufacturer'], ['iron_works'], ['manufacturer']]},
  coventry: {name: 'Coventry', region: 'birmingham', slots: [['pottery'], ['manufacturer', 'coal_mine'], ['iron_works', 'manufacturer']]},
  nuneaton: {name: 'Nuneaton', region: 'birmingham', slots: [['manufacturer', 'brewery'], ['cotton_mill', 'coal_mine']]},
  redditch: {name: 'Redditch', region: 'birmingham', slots: [['manufacturer', 'coal_mine'], ['iron_works']]},
} satisfies Record<string, {name: string; region: string; slots: IndustryType[][]}>;

function makeCities(): Record<string, CitySpec> {
  return Object.fromEntries(Object.entries(cityInput).map(([id, city]) => [
    id,
    {
      id,
      name: city.name,
      kind: 'city',
      region: city.region,
      printedLinkIcons: 0,
      slots: city.slots.map((allowedIndustryTypes, index) => ({
        id: `${id}-${index}`,
        cityId: id,
        allowedIndustryTypes,
      })),
    },
  ]));
}

const farmBreweries: Record<string, FarmBrewerySpec> = {
  northern: {id: 'northern', name: 'Brewery (North)', kind: 'farm_brewery', printedLinkIcons: 0},
  southern: {id: 'southern', name: 'Brewery (South)', kind: 'farm_brewery', printedLinkIcons: 0},
};

const merchants: Record<string, MerchantSpec> = {
  shrewsbury: {
    id: 'shrewsbury',
    name: 'Shrewsbury',
    kind: 'merchant',
    printedLinkIcons: 2,
    minPlayers: 2,
    bonus: {type: 'victory_points', points: 4},
    spaces: [{id: 'shrewsbury-0', locationId: 'shrewsbury', minPlayers: 2}],
    providesCoalMarketConnection: true,
  },
  gloucester: {
    id: 'gloucester',
    name: 'Gloucester',
    kind: 'merchant',
    printedLinkIcons: 2,
    minPlayers: 2,
    bonus: {type: 'develop', count: 1},
    spaces: [
      {id: 'gloucester-0', locationId: 'gloucester', minPlayers: 2},
      {id: 'gloucester-1', locationId: 'gloucester', minPlayers: 2},
    ],
    providesCoalMarketConnection: true,
  },
  oxford: {
    id: 'oxford',
    name: 'Oxford',
    kind: 'merchant',
    printedLinkIcons: 2,
    minPlayers: 2,
    bonus: {type: 'income_spaces', spaces: 2},
    spaces: [
      {id: 'oxford-0', locationId: 'oxford', minPlayers: 2},
      {id: 'oxford-1', locationId: 'oxford', minPlayers: 2},
    ],
    providesCoalMarketConnection: true,
  },
  warrington: {
    id: 'warrington',
    name: 'Warrington',
    kind: 'merchant',
    printedLinkIcons: 2,
    minPlayers: 3,
    bonus: {type: 'cash', cash: 5},
    spaces: [
      {id: 'warrington-0', locationId: 'warrington', minPlayers: 3},
      {id: 'warrington-1', locationId: 'warrington', minPlayers: 3},
    ],
    providesCoalMarketConnection: true,
  },
  nottingham: {
    id: 'nottingham',
    name: 'Nottingham',
    kind: 'merchant',
    printedLinkIcons: 2,
    minPlayers: 4,
    bonus: {type: 'victory_points', points: 3},
    spaces: [
      {id: 'nottingham-0', locationId: 'nottingham', minPlayers: 4},
      {id: 'nottingham-1', locationId: 'nottingham', minPlayers: 4},
    ],
    providesCoalMarketConnection: true,
  },
};

const connectionInput = [
  ['belper-derby', 'belper', 'derby', true, true],
  ['belper-leek', 'belper', 'leek', false, true],
  ['birmingham-coventry', 'birmingham', 'coventry', true, true],
  ['birmingham-dudley', 'birmingham', 'dudley', true, true],
  ['birmingham-nuneaton', 'birmingham', 'nuneaton', false, true],
  ['birmingham-oxford', 'birmingham', 'oxford', true, true],
  ['birmingham-redditch', 'birmingham', 'redditch', false, true],
  ['birmingham-tamworth', 'birmingham', 'tamworth', true, true],
  ['birmingham-walsall', 'birmingham', 'walsall', true, true],
  ['birmingham-worcester', 'birmingham', 'worcester', true, true],
  ['burtonOnTrent-cannock', 'burtonOnTrent', 'cannock', false, true],
  ['burtonOnTrent-derby', 'burtonOnTrent', 'derby', true, true],
  ['burtonOnTrent-stone', 'burtonOnTrent', 'stone', true, true],
  ['burtonOnTrent-tamworth', 'burtonOnTrent', 'tamworth', true, true],
  ['burtonOnTrent-walsall', 'burtonOnTrent', 'walsall', true, false],
  ['cannock-stafford', 'cannock', 'stafford', true, true],
  ['cannock-northern', 'cannock', 'northern', true, true],
  ['cannock-walsall', 'cannock', 'walsall', true, true],
  ['cannock-wolverhampton', 'cannock', 'wolverhampton', true, true],
  ['coalbrookdale-kidderminster', 'coalbrookdale', 'kidderminster', true, true],
  ['coalbrookdale-shrewsbury', 'coalbrookdale', 'shrewsbury', true, true],
  ['coalbrookdale-wolverhampton', 'coalbrookdale', 'wolverhampton', true, true],
  ['coventry-nuneaton', 'coventry', 'nuneaton', false, true],
  ['derby-nottingham', 'derby', 'nottingham', true, true],
  ['derby-uttoxeter', 'derby', 'uttoxeter', false, true],
  ['dudley-kidderminster', 'dudley', 'kidderminster', true, true],
  ['dudley-wolverhampton', 'dudley', 'wolverhampton', true, true],
  ['gloucester-redditch', 'gloucester', 'redditch', true, true],
  ['gloucester-worcester', 'gloucester', 'worcester', true, true],
  ['kidderminster-worcester', 'kidderminster', 'worcester', true, true, 'southern'],
  ['leek-stokeOnTrent', 'leek', 'stokeOnTrent', true, true],
  ['nuneaton-tamworth', 'nuneaton', 'tamworth', true, true],
  ['redditch-oxford', 'redditch', 'oxford', true, true],
  ['stafford-stone', 'stafford', 'stone', true, true],
  ['stokeOnTrent-stone', 'stokeOnTrent', 'stone', true, true],
  ['stokeOnTrent-warrington', 'stokeOnTrent', 'warrington', true, true],
  ['stone-uttoxeter', 'stone', 'uttoxeter', false, true],
  ['tamworth-walsall', 'tamworth', 'walsall', false, true],
  ['walsall-wolverhampton', 'walsall', 'wolverhampton', true, true],
] as const;

function makeLinkLines(): Record<string, LinkLineSpec> {
  return Object.fromEntries(connectionInput.map(([id, endpointA, endpointB, canal, rail, viaFarmBreweryId]) => [
    id,
    {
      id,
      endpointA,
      endpointB,
      allowedLinkTypes: [
        ...(canal ? ['canal' as const] : []),
        ...(rail ? ['rail' as const] : []),
      ],
      viaFarmBreweryId,
    },
  ]));
}

const industryInput: Record<IndustryType, IndustryTileInput[]> = {
  brewery: [
    {level: 1, count: 2, eras: ['canal'], cash: 5, coal: 0, iron: 1, vp: 4, income: 4, linkIcons: 2, canDevelop: true, resources: {canal: 1}},
    {level: 2, count: 2, eras: ['canal', 'rail'], cash: 7, coal: 0, iron: 1, vp: 5, income: 5, linkIcons: 2, canDevelop: true, resources: {canal: 1, rail: 2}},
    {level: 3, count: 2, eras: ['canal', 'rail'], cash: 9, coal: 0, iron: 1, vp: 7, income: 5, linkIcons: 2, canDevelop: true, resources: {canal: 1, rail: 2}},
    {level: 4, count: 1, eras: ['rail'], cash: 9, coal: 0, iron: 1, vp: 10, income: 5, linkIcons: 2, canDevelop: true, resources: {rail: 2}},
  ],
  coal_mine: [
    {level: 1, count: 1, eras: ['canal'], cash: 5, coal: 0, iron: 0, vp: 1, income: 4, linkIcons: 2, canDevelop: true, resources: {canal: 2, rail: 2}},
    {level: 2, count: 2, eras: ['canal', 'rail'], cash: 7, coal: 0, iron: 0, vp: 2, income: 7, linkIcons: 1, canDevelop: true, resources: {canal: 3, rail: 3}},
    {level: 3, count: 2, eras: ['canal', 'rail'], cash: 8, coal: 0, iron: 1, vp: 3, income: 6, linkIcons: 1, canDevelop: true, resources: {canal: 4, rail: 4}},
    {level: 4, count: 2, eras: ['canal', 'rail'], cash: 10, coal: 0, iron: 1, vp: 4, income: 5, linkIcons: 1, canDevelop: true, resources: {canal: 5, rail: 5}},
  ],
  cotton_mill: [
    {level: 1, count: 3, eras: ['canal'], cash: 12, coal: 0, iron: 0, beer: 1, vp: 5, income: 5, linkIcons: 1, canDevelop: true},
    {level: 2, count: 2, eras: ['canal', 'rail'], cash: 14, coal: 1, iron: 0, beer: 1, vp: 5, income: 4, linkIcons: 2, canDevelop: true},
    {level: 3, count: 3, eras: ['canal', 'rail'], cash: 16, coal: 1, iron: 1, beer: 1, vp: 9, income: 3, linkIcons: 1, canDevelop: true},
    {level: 4, count: 3, eras: ['canal', 'rail'], cash: 18, coal: 1, iron: 1, beer: 1, vp: 12, income: 2, linkIcons: 1, canDevelop: true},
  ],
  iron_works: [
    {level: 1, count: 1, eras: ['canal'], cash: 5, coal: 1, iron: 0, vp: 3, income: 3, linkIcons: 1, canDevelop: true, resources: {canal: 4, rail: 4}},
    {level: 2, count: 1, eras: ['canal', 'rail'], cash: 7, coal: 1, iron: 0, vp: 5, income: 3, linkIcons: 1, canDevelop: true, resources: {canal: 4, rail: 4}},
    {level: 3, count: 1, eras: ['canal', 'rail'], cash: 9, coal: 1, iron: 0, vp: 7, income: 2, linkIcons: 1, canDevelop: true, resources: {canal: 5, rail: 5}},
    {level: 4, count: 1, eras: ['canal', 'rail'], cash: 12, coal: 1, iron: 0, vp: 9, income: 1, linkIcons: 1, canDevelop: true, resources: {canal: 6, rail: 6}},
  ],
  manufacturer: [
    {level: 1, count: 1, eras: ['canal'], cash: 8, coal: 1, iron: 0, beer: 1, vp: 3, income: 5, linkIcons: 2, canDevelop: true},
    {level: 2, count: 2, eras: ['canal', 'rail'], cash: 10, coal: 0, iron: 1, beer: 1, vp: 5, income: 1, linkIcons: 1, canDevelop: true},
    {level: 3, count: 1, eras: ['canal', 'rail'], cash: 12, coal: 2, iron: 0, beer: 0, vp: 4, income: 4, linkIcons: 0, canDevelop: true},
    {level: 4, count: 1, eras: ['canal', 'rail'], cash: 8, coal: 0, iron: 1, beer: 1, vp: 3, income: 6, linkIcons: 1, canDevelop: true},
    {level: 5, count: 2, eras: ['canal', 'rail'], cash: 16, coal: 1, iron: 0, beer: 2, vp: 8, income: 2, linkIcons: 2, canDevelop: true},
    {level: 6, count: 1, eras: ['canal', 'rail'], cash: 20, coal: 0, iron: 0, beer: 1, vp: 7, income: 6, linkIcons: 1, canDevelop: true},
    {level: 7, count: 1, eras: ['canal', 'rail'], cash: 16, coal: 1, iron: 1, beer: 0, vp: 9, income: 4, linkIcons: 0, canDevelop: true},
    {level: 8, count: 2, eras: ['canal', 'rail'], cash: 20, coal: 0, iron: 2, beer: 1, vp: 11, income: 1, linkIcons: 1, canDevelop: true},
  ],
  pottery: [
    {level: 1, count: 1, eras: ['canal', 'rail'], cash: 17, coal: 0, iron: 1, beer: 1, vp: 10, income: 5, linkIcons: 1, canDevelop: false, lightbulb: true},
    {level: 2, count: 1, eras: ['canal', 'rail'], cash: 0, coal: 1, iron: 0, beer: 1, vp: 1, income: 1, linkIcons: 1, canDevelop: true},
    {level: 3, count: 1, eras: ['canal', 'rail'], cash: 22, coal: 2, iron: 0, beer: 2, vp: 11, income: 5, linkIcons: 1, canDevelop: false, lightbulb: true},
    {level: 4, count: 1, eras: ['canal', 'rail'], cash: 0, coal: 1, iron: 0, beer: 1, vp: 1, income: 1, linkIcons: 1, canDevelop: true},
    {level: 5, count: 1, eras: ['rail'], cash: 24, coal: 2, iron: 0, beer: 2, vp: 20, income: 5, linkIcons: 1, canDevelop: true},
  ],
};

function makeIndustryTiles(): {
  specs: Record<string, IndustryTileSpec>;
  stackIds: Record<IndustryType, string[]>;
} {
  const specs: Record<string, IndustryTileSpec> = {};
  const stackIds = {} as Record<IndustryType, string[]>;
  for (const industryType of Object.keys(industryInput) as IndustryType[]) {
    stackIds[industryType] = [];
  }

  for (const [industryType, tiles] of Object.entries(industryInput) as Array<[IndustryType, IndustryTileInput[]]>) {
    let sequenceIndex = 0;
    for (const tile of tiles) {
      for (let copy = 1; copy <= tile.count; copy++) {
        const id = `${industryType}-${tile.level}-${copy}`;
        specs[id] = {
          id,
          industryType,
          level: tile.level,
          sequenceIndex,
          buildableEras: tile.eras,
          cost: {cash: tile.cash, coal: tile.coal, iron: tile.iron},
          flip: {
            trigger: industryType === 'coal_mine' || industryType === 'iron_works' || industryType === 'brewery' ? 'resource_depleted' : 'sell',
            incomeSpaces: tile.income,
            victoryPoints: tile.vp,
            linkIcons: tile.linkIcons,
          },
          resourcesWhenBuilt: tile.resources,
          beerRequiredToSell: tile.beer,
          canDevelop: tile.canDevelop,
          special: tile.lightbulb ? {lightbulbPottery: true} : undefined,
        };
        stackIds[industryType].push(id);
        sequenceIndex++;
      }
    }
  }

  return {specs, stackIds};
}

const cardDeckInput: Record<PlayerCount, {
  locations: Record<string, number>;
  industries: Partial<Record<IndustryType, number>>;
}> = {
  2: {
    locations: {
      stafford: 2, burtonOnTrent: 2, cannock: 2, tamworth: 1,
      walsall: 1, coalbrookdale: 3, dudley: 2, kidderminster: 2,
      wolverhampton: 2, worcester: 2, birmingham: 3, coventry: 3,
      nuneaton: 1, redditch: 1,
    },
    industries: {iron_works: 4, coal_mine: 2, pottery: 2, brewery: 5},
  },
  3: {
    locations: {
      leek: 2, stokeOnTrent: 3, stone: 2, uttoxeter: 1,
      stafford: 2, burtonOnTrent: 2, cannock: 2, tamworth: 1,
      walsall: 1, coalbrookdale: 3, dudley: 2, kidderminster: 2,
      wolverhampton: 2, worcester: 2, birmingham: 3, coventry: 3,
      nuneaton: 1, redditch: 1,
    },
    industries: {iron_works: 4, coal_mine: 2, cotton_mill: 3, manufacturer: 3, pottery: 2, brewery: 5},
  },
  4: {
    locations: {
      belper: 2, derby: 3, leek: 2, stokeOnTrent: 3, stone: 2,
      uttoxeter: 2, stafford: 2, burtonOnTrent: 2, cannock: 2,
      tamworth: 1, walsall: 1, coalbrookdale: 3, dudley: 2,
      kidderminster: 2, wolverhampton: 2, worcester: 2,
      birmingham: 3, coventry: 3, nuneaton: 1, redditch: 1,
    },
    industries: {iron_works: 4, coal_mine: 3, cotton_mill: 4, manufacturer: 4, pottery: 3, brewery: 5},
  },
};

function makeCardSpecs(): Record<string, CardSpec> {
  const cards: Record<string, CardSpec> = {};
  for (const playerCount of [2, 3, 4] as const) {
    const input = cardDeckInput[playerCount];
    for (const [locationId, count] of Object.entries(input.locations)) {
      for (let copy = 1; copy <= count; copy++) {
        const id = `p${playerCount}-location-${locationId}-${copy}`;
        cards[id] = {
          id,
          type: 'location',
          name: `${cityInput[locationId as keyof typeof cityInput]?.name ?? merchants[locationId]?.name ?? locationId} (${copy})`,
          locationId,
          minPlayers: playerCount,
        };
      }
    }
    for (const [industryType, count] of Object.entries(input.industries) as Array<[IndustryType, number]>) {
      for (let copy = 1; copy <= count; copy++) {
        const id = `p${playerCount}-industry-${industryType}-${copy}`;
        cards[id] = {
          id,
          type: 'industry',
          name: `${industryDisplayNames[industryType]} (${copy})`,
          industryType,
          minPlayers: playerCount,
        };
      }
    }
  }
  for (let copy = 1; copy <= 4; copy++) {
    cards[`wild-location-${copy}`] = {id: `wild-location-${copy}`, type: 'wild_location', name: `Wild Location ${copy}`};
    cards[`wild-industry-${copy}`] = {id: `wild-industry-${copy}`, type: 'wild_industry', name: `Wild Industry ${copy}`};
  }
  return cards;
}

const merchantTileSpecs: Record<string, MerchantTileSpec> = {
  'blank-2p': {id: 'blank-2p', minPlayers: 2, acceptedIndustryTypes: [], blank: true},
  'oxford-manufacturer': {id: 'oxford-manufacturer', minPlayers: 2, acceptedIndustryTypes: ['manufacturer'], blank: false},
  'oxford-cotton': {id: 'oxford-cotton', minPlayers: 2, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'gloucester-cotton': {id: 'gloucester-cotton', minPlayers: 2, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'gloucester-manufacturer': {id: 'gloucester-manufacturer', minPlayers: 2, acceptedIndustryTypes: ['manufacturer'], blank: false},
  'warrington-pottery': {id: 'warrington-pottery', minPlayers: 3, acceptedIndustryTypes: ['pottery'], blank: false},
  'blank-3p': {id: 'blank-3p', minPlayers: 3, acceptedIndustryTypes: [], blank: true},
  'nottingham-cotton': {id: 'nottingham-cotton', minPlayers: 4, acceptedIndustryTypes: ['cotton_mill'], blank: false},
  'nottingham-manufacturer': {id: 'nottingham-manufacturer', minPlayers: 4, acceptedIndustryTypes: ['manufacturer'], blank: false},
};

function makeIncomeTrack() {
  const positions = [];
  let position = 0;
  for (let incomeLevel = -10; incomeLevel <= 0; incomeLevel++) {
    positions.push({position: position++, incomeLevel});
  }
  for (let incomeLevel = 1; incomeLevel <= 10; incomeLevel++) {
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
  }
  for (let incomeLevel = 11; incomeLevel <= 20; incomeLevel++) {
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
  }
  for (let incomeLevel = 21; incomeLevel <= 30; incomeLevel++) {
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
    positions.push({position: position++, incomeLevel});
  }
  return {
    positions,
    startPosition: positions.find((entry) => entry.incomeLevel === 0)?.position ?? 10,
    minIncomeLevel: -10,
    maxIncomeLevel: 30,
  };
}

const industryTiles = makeIndustryTiles();

export const staticConfig: StaticConfig = {
  incomeTrack: makeIncomeTrack(),
  locations: {
    ...makeCities(),
    ...farmBreweries,
    ...merchants,
  },
  linkLines: makeLinkLines(),
  cardSpecs: makeCardSpecs(),
  merchantTileSpecs,
  industryTileSpecs: industryTiles.specs,
  industryStackSpecIds: industryTiles.stackIds,
  markets: {
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
  },
  rules: {
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
  },
};

export function getCardIdsForPlayerCount(playerCount: PlayerCount): string[] {
  return Object.values(staticConfig.cardSpecs)
    .filter((card) => card.type === 'location' || card.type === 'industry')
    .filter((card) => card.minPlayers === playerCount)
    .map((card) => card.id);
}

export function getWildLocationCardIds(): string[] {
  return Object.values(staticConfig.cardSpecs).filter((card) => card.type === 'wild_location').map((card) => card.id);
}

export function getWildIndustryCardIds(): string[] {
  return Object.values(staticConfig.cardSpecs).filter((card) => card.type === 'wild_industry').map((card) => card.id);
}
