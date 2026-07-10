import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {createGame} from '../src/common/gameSetup';
import {isLinkLineActiveForPlayerCount} from '../src/common/selectors';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../src/common/staticData';
import type {CardSpec, IndustryType, MerchantBonus, PlayerCount, StaticConfig, StaticDataAuditArea, StaticDataAuditManifest} from '../src/common/types';

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

const expectedPhysicalComponentManifest: StaticConfig['components'] = {
  boardCount: 1,
  playerMatCount: 4,
  characterTileCount: 4,
  playerAidCount: 4,
  incomeMarkerCount: 4,
  victoryPointMarkerCount: 4,
  linkTilesPerPlayer: 14,
  industryTilesPerPlayer: 45,
  industryTilesTotal: 180,
  locationAndIndustryCardCount: 64,
  wildCards: {
    location: 4,
    industry: 4,
    total: 8,
  },
  merchantTileCount: 9,
  resourcePieces: {
    ironCubes: 18,
    coalCubes: 30,
    beerBarrels: 15,
    generalSupplyLimit: 'unlimited',
  },
  moneyTokens: 77,
  deluxeIronClays: 78,
  unusedBlankPunchboardTiles: 3,
};

const expectedStaticDataAuditManifest: StaticDataAuditManifest = {
  components: {
    status: 'manifest_locked',
    rulebookPages: [1, 4, 5],
    sourceRefs: ['official rulebook component list p1', 'official rulebook setup pp4-6'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/setup.spec.ts'],
    note: 'Physical counts and setup-facing component behavior are locked to manifest tests.',
  },
  setupAndTurnRules: {
    status: 'manifest_locked',
    rulebookPages: [4, 5, 6, 7],
    sourceRefs: ['official rulebook setup pp4-6', 'official rulebook action and era rules pp7-12'],
    coveredByTests: ['tests/setup.spec.ts', 'tests/era.spec.ts', 'tests/actions.spec.ts'],
    note: 'Initial cash, hand size, facedown discards, round counts, action counts, and core action constants are test-backed.',
  },
  locationsAndSlots: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [4, 5],
    sourceRefs: ['legacy js/gameData.js migration', 'official board face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/legacyStaticDataParity.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'City ids, regions, and slot manifests are locked; rulebook diagrams are partial, so final board-face icon review is still pending.',
  },
  linkLines: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [4, 5, 8, 11],
    sourceRefs: ['legacy js/gameData.js migration', 'official board face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/legacyStaticDataParity.spec.ts', 'tests/network.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'Endpoints, era support, player-count activation, and farm-brewery links are locked; rulebook diagrams are partial, so final printed-line review is still pending.',
  },
  regularCards: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [1, 4, 9],
    sourceRefs: ['legacy js/gameData.js migration', 'official card face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/legacyStaticDataParity.spec.ts', 'tests/setup.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'Location and industry card counts, player counts, ids, and deck sizes are locked; rulebook examples are partial, so final card-face review is still pending.',
  },
  wildCards: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [1, 4, 9, 12],
    sourceRefs: ['official rulebook component list p1', 'official card face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/actions.spec.ts', 'tests/setup.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'Wild card counts and pool behavior are locked; rulebook examples are partial, so final wild-card face review is still pending.',
  },
  industryTiles: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [1, 5, 8, 9, 11, 12],
    sourceRefs: ['legacy js/gameData.js migration', 'official player-board tile face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/legacyStaticDataParity.spec.ts', 'tests/actions.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'Tile economics, order, ids, resources, and develop restrictions are locked; rulebook thumbnails are partial, so final tile-face review is still pending.',
  },
  merchantTiles: {
    status: 'manifest_locked_face_audit_pending',
    rulebookPages: [1, 4, 10],
    sourceRefs: ['legacy js/gameData.js migration', 'official merchant tile face audit pending'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/setup.spec.ts', 'tests/sell.spec.ts', 'tests/faceAudit.spec.ts'],
    note: 'Merchant tile counts, player counts, industry icons, blanks, and rewards are locked; rulebook examples are partial, so final merchant-tile face review is still pending.',
  },
  markets: {
    status: 'manifest_locked',
    rulebookPages: [4],
    sourceRefs: ['official rulebook setup p4', 'legacy js/gameData.js migration'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/resourceSources.spec.ts', 'tests/setup.spec.ts'],
    note: 'Coal and iron market prices, initial occupancy, fallback prices, and connection behavior are test-backed.',
  },
  incomeTrack: {
    status: 'manifest_locked',
    rulebookPages: [4, 5, 11],
    sourceRefs: ['official board income track audit', 'rules data model income-track manifest'],
    coveredByTests: ['tests/staticData.spec.ts', 'tests/roundIncome.spec.ts'],
    note: 'Every income-track space is recorded and tested instead of inferred from formula-only logic.',
  },
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

const expectedInactiveLinkLinesByPlayerCount: Record<PlayerCount, string[]> = {
  2: ['derby-nottingham', 'stokeOnTrent-warrington'],
  3: ['derby-nottingham'],
  4: [],
};

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
    {level: 1, count: 1, buildableEras: ['canal'], cost: {cash: 5, coal: 0, iron: 0}, flip: {incomeSpaces: 4, victoryPoints: 1, linkIcons: 2}, resourcesWhenBuilt: {canal: 2}, canDevelop: true},
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
    {level: 1, count: 1, buildableEras: ['canal'], cost: {cash: 5, coal: 1, iron: 0}, flip: {incomeSpaces: 3, victoryPoints: 3, linkIcons: 1}, resourcesWhenBuilt: {canal: 4}, canDevelop: true},
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

function expectedRegularCardIdsForPlayerCount(playerCount: PlayerCount): string[] {
  const distribution = expectedCardDistributionByPlayerCount[playerCount];
  const locationIds = Object.entries(distribution.locations).flatMap(([locationId, count]) =>
    Array.from({length: count}, (_, index) => `p${playerCount}-location-${locationId}-${index + 1}`),
  );
  const industryIds = (Object.entries(distribution.industries) as Array<[IndustryType, number]>)
    .flatMap(([industryType, count]) =>
      Array.from({length: count}, (_, index) => `p${playerCount}-industry-${industryType}-${index + 1}`),
    );

  return [...locationIds, ...industryIds];
}

function locationCardRegions(cards: CardSpec[]): string[] {
  const regions = new Set<string>();
  for (const card of cards) {
    if (card.type !== 'location' || !card.locationId) {
      continue;
    }
    const location = staticConfig.locations[card.locationId];
    if (!location || location.kind !== 'city') {
      throw new Error(`Expected location card ${card.id} to reference a city`);
    }
    regions.add(location.region);
  }
  return [...regions].sort();
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

function auditGameForPlayerCount(playerCount: PlayerCount) {
  const playerIds = Array.from({length: playerCount}, (_, index) => `p${index + 1}`);
  return createGame({
    id: `static-data-audit-${playerCount}p`,
    playerNames: ['Ada', 'Ben', 'Cara', 'Dev'].slice(0, playerCount),
    seed: playerCount,
    initialTurnOrder: playerIds,
  });
}

describe('static rules data integrity', () => {
  it('tracks static-data audit coverage and the remaining face-audit boundary', () => {
    expect(staticConfig.audit).toEqual(expectedStaticDataAuditManifest);

    const auditEntries = Object.values(staticConfig.audit) as StaticDataAuditArea[];
    for (const entry of auditEntries) {
      expect(entry.rulebookPages.length).toBeGreaterThan(0);
      expect(entry.rulebookPages).toEqual([...new Set(entry.rulebookPages)].sort((a, b) => a - b));
      expect(entry.rulebookPages.every((page) => Number.isInteger(page) && page >= 1 && page <= 12)).toBe(true);
      expect(entry.sourceRefs.length).toBeGreaterThan(0);
      expect(entry.coveredByTests.length).toBeGreaterThan(0);
      expect(entry.note.trim()).toBe(entry.note);
      expect(entry.note.length).toBeGreaterThan(0);
    }

    const pendingFaceAuditKeys = Object.entries(staticConfig.audit)
      .filter(([, entry]) => entry.status === 'manifest_locked_face_audit_pending')
      .map(([key]) => key)
      .sort();

    expect(pendingFaceAuditKeys).toEqual([
      'industryTiles',
      'linkLines',
      'locationsAndSlots',
      'merchantTiles',
      'regularCards',
      'wildCards',
    ]);
  });

  it('keeps static-data audit test references resolvable to real Vitest specs', () => {
    const referencedTests = new Set<string>();

    for (const [area, entry] of Object.entries(staticConfig.audit)) {
      for (const testPath of entry.coveredByTests) {
        expect(testPath, `${area} audit test path should be a repo test spec`).toMatch(/^tests\/.+\.spec\.ts$/);
        referencedTests.add(testPath);
      }
    }

    for (const testPath of [...referencedTests].sort()) {
      expect(existsSync(testPath), `Missing audit-referenced test file: ${testPath}`).toBe(true);
      expect(readFileSync(testPath, 'utf8'), `${testPath} should contain Vitest tests`).toMatch(/\b(it|test|describe)\(/);
    }
  });

  it('keeps static-data audit statuses semantically tied to their remaining review work', () => {
    for (const [area, entry] of Object.entries(staticConfig.audit)) {
      const reviewText = [...entry.sourceRefs, entry.note].join(' ').toLowerCase();

      if (entry.status === 'manifest_locked_face_audit_pending') {
        expect(reviewText, `${area} should identify the unresolved face audit`).toContain('face audit pending');
        expect(reviewText, `${area} should identify the unfinished human review`).toContain('still pending');
        continue;
      }

      expect(reviewText, `${area} is locked and should not carry unresolved face-audit wording`)
        .not.toContain('face audit pending');
      expect(reviewText, `${area} is locked and should not carry unresolved review wording`)
        .not.toContain('still pending');
    }
  });

  it('matches the official component counts represented in rules data', () => {
    const expectedIndustryTilesPerPlayer: Record<IndustryType, number> = {
      cotton_mill: 11,
      coal_mine: 7,
      iron_works: 4,
      manufacturer: 11,
      pottery: 5,
      brewery: 7,
    };

    expect(staticConfig.components).toEqual(expectedPhysicalComponentManifest);

    for (const industryType of industryTypes) {
      expect(staticConfig.industryStackSpecIds[industryType]).toHaveLength(expectedIndustryTilesPerPlayer[industryType]);
    }

    const industryTilesPerPlayer = Object.values(staticConfig.industryStackSpecIds)
      .reduce((total, stack) => total + stack.length, 0);
    expect(industryTilesPerPlayer).toBe(staticConfig.components.industryTilesPerPlayer);
    expect(industryTilesPerPlayer * staticConfig.components.playerMatCount).toBe(staticConfig.components.industryTilesTotal);
    expect(staticConfig.rules.initialLinksPerType).toBe(staticConfig.components.linkTilesPerPlayer);
    expect(Object.keys(staticConfig.merchantTileSpecs)).toHaveLength(staticConfig.components.merchantTileCount);
    expect(getCardIdsForPlayerCount(4)).toHaveLength(staticConfig.components.locationAndIndustryCardCount);
    expect(getWildLocationCardIds()).toHaveLength(staticConfig.components.wildCards.location);
    expect(getWildIndustryCardIds()).toHaveLength(staticConfig.components.wildCards.industry);
    expect([...getWildLocationCardIds(), ...getWildIndustryCardIds()]).toHaveLength(staticConfig.components.wildCards.total);
    expect(staticConfig.components.resourcePieces.generalSupplyLimit).toBe('unlimited');
    expect(staticConfig.markets.coal.priceSlotsCheapestToMostExpensive).not.toHaveLength(staticConfig.components.resourcePieces.coalCubes);
    expect(staticConfig.markets.iron.priceSlotsCheapestToMostExpensive).not.toHaveLength(staticConfig.components.resourcePieces.ironCubes);
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

  it('matches audited player-count availability for map links', () => {
    const linkIds = Object.keys(staticConfig.linkLines).sort();

    for (const playerCount of [2, 3, 4] as const) {
      const state = auditGameForPlayerCount(playerCount);
      const inactiveIds = linkIds.filter((linkId) =>
        !isLinkLineActiveForPlayerCount(state, staticConfig.linkLines[linkId]),
      );

      expect(inactiveIds).toEqual(expectedInactiveLinkLinesByPlayerCount[playerCount]);
      expect(linkIds.filter((linkId) => !inactiveIds.includes(linkId))).toHaveLength(
        linkIds.length - expectedInactiveLinkLinesByPlayerCount[playerCount].length,
      );

      for (const inactiveId of inactiveIds) {
        const line = staticConfig.linkLines[inactiveId];
        const inactiveMerchantEndpoints = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
          .filter((locationId): locationId is string => Boolean(locationId))
          .filter((locationId) => {
            const location = staticConfig.locations[locationId];
            return location?.kind === 'merchant' && location.minPlayers > playerCount;
          });
        expect(inactiveMerchantEndpoints.length).toBeGreaterThan(0);
      }
    }
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

  it('matches the rulebook location-banner card eligibility by player count', () => {
    expect(locationCardRegions(cardsForPlayerCount(2))).toEqual(['birmingham', 'blackCountry', 'midlands']);
    expect(locationCardRegions(cardsForPlayerCount(3))).toEqual(['birmingham', 'blackCountry', 'midlands', 'staffordshire']);
    expect(locationCardRegions(cardsForPlayerCount(4))).toEqual(['birmingham', 'blackCountry', 'derbyshire', 'midlands', 'staffordshire']);
  });

  it('keeps generated regular decks isolated by exact player count and wild pool', () => {
    const playerCounts = [2, 3, 4] as const;
    const regularDeckIds = playerCounts.flatMap((playerCount) => getCardIdsForPlayerCount(playerCount));
    const wildLocationIds = getWildLocationCardIds();
    const wildIndustryIds = getWildIndustryCardIds();
    const wildIds = new Set([...wildLocationIds, ...wildIndustryIds]);

    assertUnique(regularDeckIds);
    expect(regularDeckIds.some((cardId) => wildIds.has(cardId))).toBe(false);
    expect(wildLocationIds.every((cardId) => /^wild-location-\d+$/.test(cardId))).toBe(true);
    expect(wildIndustryIds.every((cardId) => /^wild-industry-\d+$/.test(cardId))).toBe(true);

    for (const playerCount of playerCounts) {
      const deckIds = getCardIdsForPlayerCount(playerCount);
      expect(deckIds.every((cardId) => cardId.startsWith(`p${playerCount}-`))).toBe(true);

      for (const cardId of deckIds) {
        const card = staticConfig.cardSpecs[cardId];
        const match = /^p([234])-(location|industry)-/.exec(cardId);
        expect(match).not.toBeNull();
        expect(card.minPlayers).toBe(playerCount);
        expect(Number(match?.[1])).toBe(playerCount);
        expect(card.type).toBe(match?.[2]);
      }
    }
  });

  it('expands audited regular and wild card counts into contiguous physical card ids', () => {
    const expectedRegularIds: string[] = [];

    for (const playerCount of [2, 3, 4] as const) {
      const expectedIds = expectedRegularCardIdsForPlayerCount(playerCount);
      const actualIds = getCardIdsForPlayerCount(playerCount);

      expect([...actualIds].sort()).toEqual([...expectedIds].sort());
      expectedRegularIds.push(...expectedIds);

      for (const cardId of expectedIds) {
        const card = staticConfig.cardSpecs[cardId];
        const match = /^p([234])-(location|industry)-(.+)-(\d+)$/.exec(cardId);
        expect(match).not.toBeNull();
        expect(card.id).toBe(cardId);
        expect(card.minPlayers).toBe(playerCount);
        expect(card.name.endsWith(` (${match?.[4]})`)).toBe(true);
        if (match?.[2] === 'location') {
          expect(card.type).toBe('location');
          expect(card.locationId).toBe(match[3]);
          expect(card.industryType).toBeUndefined();
        } else {
          expect(card.type).toBe('industry');
          expect(card.industryType).toBe(match?.[3]);
          expect(card.locationId).toBeUndefined();
        }
      }
    }

    const expectedWildLocationIds = Array.from(
      {length: staticConfig.components.wildCards.location},
      (_, index) => `wild-location-${index + 1}`,
    );
    const expectedWildIndustryIds = Array.from(
      {length: staticConfig.components.wildCards.industry},
      (_, index) => `wild-industry-${index + 1}`,
    );
    const expectedAllCardIds = [
      ...expectedRegularIds,
      ...expectedWildLocationIds,
      ...expectedWildIndustryIds,
    ];

    expect(getWildLocationCardIds()).toEqual(expectedWildLocationIds);
    expect(getWildIndustryCardIds()).toEqual(expectedWildIndustryIds);
    expect([...expectedAllCardIds].sort()).toEqual(Object.keys(staticConfig.cardSpecs).sort());
  });

  it('defines card specs with only the fields allowed by each card type', () => {
    for (const card of Object.values(staticConfig.cardSpecs)) {
      expect(card.name.trim()).toBe(card.name);

      if (card.type === 'location') {
        expect(card.locationId).toBeDefined();
        expect(staticConfig.locations[card.locationId ?? '']?.kind).toBe('city');
        expect(card.industryType).toBeUndefined();
        expect([2, 3, 4]).toContain(card.minPlayers);
      } else if (card.type === 'industry') {
        expect(industryTypes).toContain(card.industryType);
        expect(card.locationId).toBeUndefined();
        expect([2, 3, 4]).toContain(card.minPlayers);
      } else {
        expect(card.locationId).toBeUndefined();
        expect(card.industryType).toBeUndefined();
        expect(card.minPlayers).toBeUndefined();
      }
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
        for (const era of Object.keys(spec.resourcesWhenBuilt ?? {})) {
          expect(spec.buildableEras).toContain(era);
        }
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

  it('expands audited industry tile counts into contiguous physical tile ids', () => {
    const allExpectedSpecIds: string[] = [];

    for (const industryType of industryTypes) {
      const expectedSpecIds = expectedIndustryLevelManifest[industryType].flatMap((entry) =>
        Array.from({length: entry.count}, (_, index) => `${industryType}-${entry.level}-${index + 1}`),
      );

      expect(staticConfig.industryStackSpecIds[industryType]).toEqual(expectedSpecIds);
      allExpectedSpecIds.push(...expectedSpecIds);

      expectedSpecIds.forEach((specId, sequenceIndex) => {
        const spec = staticConfig.industryTileSpecs[specId];
        expect(spec.id).toBe(specId);
        expect(spec.industryType).toBe(industryType);
        expect(spec.sequenceIndex).toBe(sequenceIndex);
      });
    }

    expect(allExpectedSpecIds).toHaveLength(staticConfig.components.industryTilesPerPlayer);
    expect([...allExpectedSpecIds].sort()).toEqual(Object.keys(staticConfig.industryTileSpecs).sort());
  });

  it('matches the rulebook Rail-era exception for level 1 pottery only', () => {
    const railBuildableLevelOneSpecs = Object.values(staticConfig.industryTileSpecs)
      .filter((spec) => spec.level === 1 && spec.buildableEras.includes('rail'))
      .map((spec) => spec.id)
      .sort();

    expect(railBuildableLevelOneSpecs).toEqual(['pottery-1-1']);
    expect(staticConfig.industryTileSpecs['pottery-1-1']).toMatchObject({
      industryType: 'pottery',
      level: 1,
      buildableEras: ['canal', 'rail'],
      canDevelop: false,
      special: {lightbulbPottery: true},
    });
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

  it('matches merchant tile ids to merchant locations and printed industry icons', () => {
    const industrySuffixes: Record<string, IndustryType> = {
      cotton: 'cotton_mill',
      manufacturer: 'manufacturer',
      pottery: 'pottery',
    };

    for (const [tileId, tile] of Object.entries(staticConfig.merchantTileSpecs)) {
      if (tile.blank) {
        const blankMatch = /^blank-([234])p$/.exec(tileId);
        expect(blankMatch).not.toBeNull();
        expect(tile.id).toBe(tileId);
        expect(tile.acceptedIndustryTypes).toEqual([]);
        expect(tile.minPlayers).toBe(Number(blankMatch?.[1]));
        continue;
      }

      const tileMatch = /^([a-z]+)-([a-z]+)$/.exec(tileId);
      expect(tileMatch).not.toBeNull();
      const [, merchantId, industrySuffix] = tileMatch ?? [];
      const merchantLocation = staticConfig.locations[merchantId ?? ''];

      expect(merchantLocation?.kind).toBe('merchant');
      if (!merchantLocation || merchantLocation.kind !== 'merchant') {
        throw new Error(`Merchant tile ${tileId} does not reference a merchant location`);
      }
      expect(tile.minPlayers).toBe(merchantLocation.minPlayers);
      expect(tile.acceptedIndustryTypes).toEqual([industrySuffixes[industrySuffix ?? '']]);
    }
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
