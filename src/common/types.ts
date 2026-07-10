export type PlayerCount = 2 | 3 | 4;
export type Era = 'canal' | 'rail';

export type IndustryType =
  | 'cotton_mill'
  | 'coal_mine'
  | 'iron_works'
  | 'manufacturer'
  | 'pottery'
  | 'brewery';

export type ResourceType = 'coal' | 'iron' | 'beer';
export type ActionType = 'build' | 'network' | 'develop' | 'sell' | 'loan' | 'scout' | 'pass';
export type CardType = 'location' | 'industry' | 'wild_location' | 'wild_industry';
export type LocationKind = 'city' | 'merchant' | 'farm_brewery';
export type LinkType = 'canal' | 'rail';
export type GameVariant = 'introductory_canal_only';

export interface CitySlotSpec {
  id: string;
  cityId: string;
  allowedIndustryTypes: IndustryType[];
}

export interface CitySpec {
  id: string;
  name: string;
  kind: 'city';
  region: string;
  printedLinkIcons: number;
  slots: CitySlotSpec[];
}

export interface MerchantSpec {
  id: string;
  name: string;
  kind: 'merchant';
  printedLinkIcons: number;
  minPlayers: PlayerCount;
  bonus: MerchantBonus;
  spaces: MerchantSpaceSpec[];
  providesCoalMarketConnection: boolean;
}

export interface FarmBrewerySpec {
  id: string;
  name: string;
  kind: 'farm_brewery';
  printedLinkIcons: number;
}

export type LocationSpec = CitySpec | MerchantSpec | FarmBrewerySpec;

export interface MerchantSpaceSpec {
  id: string;
  locationId: string;
  minPlayers: PlayerCount;
}

export type MerchantBonus =
  | {type: 'develop'; count: 1}
  | {type: 'income_spaces'; spaces: number}
  | {type: 'victory_points'; points: number}
  | {type: 'cash'; cash: number};

export interface LinkLineSpec {
  id: string;
  endpointA: string;
  endpointB: string;
  allowedLinkTypes: LinkType[];
  viaFarmBreweryId?: string;
}

export interface IndustryTileSpec {
  id: string;
  industryType: IndustryType;
  level: number;
  sequenceIndex: number;
  buildableEras: Era[];
  cost: {
    cash: number;
    coal: number;
    iron: number;
  };
  flip: {
    trigger: 'sell' | 'resource_depleted';
    incomeSpaces: number;
    victoryPoints: number;
    linkIcons: number;
  };
  resourcesWhenBuilt?: Partial<Record<Era, number>>;
  beerRequiredToSell?: number;
  canDevelop: boolean;
  special?: {
    lightbulbPottery?: boolean;
  };
}

export interface CardSpec {
  id: string;
  type: CardType;
  name: string;
  locationId?: string;
  industryType?: IndustryType;
  minPlayers?: PlayerCount;
}

export interface MerchantTileSpec {
  id: string;
  minPlayers: PlayerCount;
  acceptedIndustryTypes: IndustryType[];
  blank: boolean;
}

export interface ResourceMarketSpec {
  resourceType: 'coal' | 'iron';
  priceSlotsCheapestToMostExpensive: number[];
  initialOccupiedCount: number;
  fallbackPriceWhenEmpty: number;
  requiresConnection: boolean;
}

export interface IncomeTrackPosition {
  position: number;
  incomeLevel: number;
}

export interface IncomeTrackConfig {
  positions: IncomeTrackPosition[];
  startPosition: number;
  minIncomeLevel: number;
  maxIncomeLevel: number;
}

export interface PhysicalComponentManifest {
  boardCount: 1;
  playerMatCount: 4;
  characterTileCount: 4;
  playerAidCount: 4;
  incomeMarkerCount: 4;
  victoryPointMarkerCount: 4;
  linkTilesPerPlayer: 14;
  industryTilesPerPlayer: 45;
  industryTilesTotal: 180;
  locationAndIndustryCardCount: 64;
  wildCards: {
    location: 4;
    industry: 4;
    total: 8;
  };
  merchantTileCount: 9;
  resourcePieces: {
    ironCubes: 18;
    coalCubes: 30;
    beerBarrels: 15;
    generalSupplyLimit: 'unlimited';
  };
  moneyTokens: 77;
  deluxeIronClays: 78;
  unusedBlankPunchboardTiles: 3;
}

export type StaticDataAuditStatus =
  | 'manifest_locked'
  | 'manifest_locked_face_audit_pending';

export interface StaticDataAuditArea {
  status: StaticDataAuditStatus;
  rulebookPages: number[];
  sourceRefs: string[];
  coveredByTests: string[];
  note: string;
}

export interface StaticDataAuditManifest {
  components: StaticDataAuditArea;
  setupAndTurnRules: StaticDataAuditArea;
  locationsAndSlots: StaticDataAuditArea;
  linkLines: StaticDataAuditArea;
  regularCards: StaticDataAuditArea;
  wildCards: StaticDataAuditArea;
  industryTiles: StaticDataAuditArea;
  merchantTiles: StaticDataAuditArea;
  markets: StaticDataAuditArea;
  incomeTrack: StaticDataAuditArea;
}

export interface StaticConfig {
  components: PhysicalComponentManifest;
  audit: StaticDataAuditManifest;
  incomeTrack: IncomeTrackConfig;
  locations: Record<string, LocationSpec>;
  linkLines: Record<string, LinkLineSpec>;
  cardSpecs: Record<string, CardSpec>;
  merchantTileSpecs: Record<string, MerchantTileSpec>;
  industryTileSpecs: Record<string, IndustryTileSpec>;
  industryStackSpecIds: Record<IndustryType, string[]>;
  markets: {
    coal: ResourceMarketSpec;
    iron: ResourceMarketSpec;
  };
  rules: {
    initialCash: 17;
    handSize: 8;
    firstCanalRoundActions: 1;
    normalActionsPerTurn: 2;
    initialLinksPerType: 14;
    wildCardsPerType: 4;
    loanCash: 30;
    loanIncomeLevelPenalty: 3;
    canalLinkCost: 3;
    railSingleLinkCost: 5;
    railDoubleLinkCost: 15;
    railCoalPerLink: 1;
    railDoubleBeer: 1;
  };
}

export interface PlayerIndustryStack {
  availableSpecIdsInOrder: string[];
  removedSpecIds: string[];
  builtInstanceIds: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  cash: number;
  victoryPoints: number;
  incomeTrackPosition: number;
  spentThisRound: number;
  handCardIds: string[];
  discardCardIds: string[];
  faceDownDiscardCount: number;
  industryTileStacks: Record<IndustryType, PlayerIndustryStack>;
  remainingLinks: Record<LinkType, number>;
}

export interface IndustryInstance {
  id: string;
  specId: string;
  ownerPlayerId: string;
  industryType: IndustryType;
  level: number;
  locationId: string;
  slotId: string;
  flipped: boolean;
  remainingResource: number;
  removedFromGame: boolean;
}

export interface LinkInstance {
  id: string;
  ownerPlayerId: string;
  linkType: LinkType;
  linkLineId: string;
}

export interface MerchantSpaceState {
  id: string;
  merchantTileInstanceId?: string;
  beerPresent: boolean;
}

export interface BoardState {
  industryInstances: Record<string, IndustryInstance>;
  linkInstances: Record<string, LinkInstance>;
  slots: Record<string, {occupiedBy?: string}>;
  linkLines: Record<string, {occupiedBy?: string}>;
  merchantSpaces: Record<string, MerchantSpaceState>;
}

export interface CardZones {
  drawDeck: string[];
  wildLocationPool: string[];
  wildIndustryPool: string[];
}

export interface MarketState {
  occupiedCount: number;
}

export interface EraScoreBreakdown {
  era: Era;
  linkVictoryPointsByPlayer: Record<string, number>;
  industryVictoryPointsByPlayer: Record<string, number>;
  totalVictoryPointsByPlayer: Record<string, number>;
}

export type PendingDecision = NegativeIncomeDecision | MerchantDevelopDecision;

export interface NegativeIncomeDecision {
  type: 'negative_income';
  playerId: string;
  amountOwed: number;
  incomePlayerIndex: number;
}

export interface MerchantDevelopDecision {
  type: 'merchant_develop';
  playerId: string;
  count: number;
  merchantSpaceId: string;
  merchantSpaceIds?: string[];
}

export interface GameState {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  playerCount: PlayerCount;
  era: Era;
  roundNumber: number;
  turnOrder: string[];
  currentTurnIndex: number;
  actionIndexInTurn: number;
  actionsAllowedThisTurn: 1 | 2;
  players: Record<string, PlayerState>;
  board: BoardState;
  cardZones: CardZones;
  markets: {
    coal: MarketState;
    iron: MarketState;
  };
  eventLog: GameEvent[];
  nextInstanceId: number;
  status: 'playing' | 'ended';
  variant?: GameVariant;
  pendingDecision?: PendingDecision;
  lastEraScore?: EraScoreBreakdown;
}

export type GameEvent =
  | {type: 'game_created'; gameId: string; playerIds: string[]}
  | {type: 'card_discarded'; playerId: string; cardId: string; destination: 'discard' | 'wild_pool'}
  | {type: 'cash_changed'; playerId: string; delta: number; reason: string}
  | {type: 'income_position_changed'; playerId: string; from: number; to: number; reason: string}
  | {type: 'industry_built'; instance: IndustryInstance}
  | {type: 'industry_removed'; industryInstanceId: string; reason: 'overbuild' | 'develop' | 'canal_cleanup' | 'negative_income'}
  | {type: 'industry_flipped'; industryInstanceId: string; ownerPlayerId: string}
  | {type: 'industry_sold'; industryInstanceId: string; ownerPlayerId: string; merchantSpaceId: string}
  | {type: 'resource_consumed'; source: ResourceSource; byPlayerId: string; reason: string}
  | {type: 'resource_sold_to_market'; industryInstanceId: string; market: 'coal' | 'iron'; cashReceived: number}
  | {type: 'link_built'; instance: LinkInstance}
  | {type: 'link_scored'; linkInstanceId: string; ownerPlayerId: string; points: number}
  | {type: 'industry_scored'; industryInstanceId: string; ownerPlayerId: string; points: number}
  | {type: 'merchant_bonus_claimed'; playerId: string; merchantSpaceId: string; bonus: MerchantBonus}
  | {type: 'merchant_develop_resolved'; playerId: string; merchantSpaceId: string; merchantSpaceIds?: string[]; industryTypes: IndustryType[]; specIds: string[]}
  | {type: 'turn_advanced'; currentPlayerId: string; roundNumber: number}
  | {type: 'turn_order_updated'; order: string[]}
  | {type: 'negative_income_started'; playerId: string; amountOwed: number; incomePlayerIndex: number}
  | {type: 'negative_income_resolved'; playerId: string; amountOwed: number; paid: number; victoryPointLoss: number; industryInstanceIds: string[]}
  | {type: 'victory_points_changed'; playerId: string; delta: number; reason: string}
  | {type: 'era_ended'; era: Era; score: EraScoreBreakdown}
  | {type: 'game_ended'; winners: string[]}
  | {type: 'loan_taken'; playerId: string}
  | {type: 'scouted'; playerId: string};

export type ResourceSource =
  | {kind: 'industry_tile'; industryInstanceId: string; resourceType: ResourceType}
  | {kind: 'market'; market: 'coal' | 'iron'; price: number}
  | {kind: 'merchant_beer'; merchantSpaceId: string; merchantTileInstanceId: string};

export type GameCommand =
  | BuildCommand
  | NetworkCommand
  | DevelopCommand
  | SellCommand
  | ResolveNegativeIncomeCommand
  | ResolveMerchantDevelopCommand
  | LoanCommand
  | ScoutCommand
  | PassCommand;

export interface BuildCommand {
  type: 'build';
  playerId: string;
  cardId: string;
  locationId: string;
  slotId: string;
  industryType: IndustryType;
  coalSources?: ResourceSource[];
  ironSources?: ResourceSource[];
}

export interface NetworkCommand {
  type: 'network';
  playerId: string;
  cardId: string;
  linkLineIds: string[];
  coalSources?: ResourceSource[];
  beerSourceForDoubleRail?: ResourceSource;
}

export interface DevelopCommand {
  type: 'develop';
  playerId: string;
  cardId: string;
  industryTypes: IndustryType[];
  ironSources?: ResourceSource[];
}

export interface SellCommand {
  type: 'sell';
  playerId: string;
  cardId: string;
  sales: SellStep[];
}

export interface SellStep {
  industryInstanceId: string;
  merchantSpaceId: string;
  beerSources?: ResourceSource[];
}

export interface ResolveNegativeIncomeCommand {
  type: 'resolve_negative_income';
  playerId: string;
  industryInstanceIds: string[];
}

export interface ResolveMerchantDevelopCommand {
  type: 'resolve_merchant_develop';
  playerId: string;
  industryTypes: IndustryType[];
}

export interface LoanCommand {
  type: 'loan';
  playerId: string;
  cardId: string;
}

export interface ScoutCommand {
  type: 'scout';
  playerId: string;
  cardIds: string[];
}

export interface PassCommand {
  type: 'pass';
  playerId: string;
  cardId: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
