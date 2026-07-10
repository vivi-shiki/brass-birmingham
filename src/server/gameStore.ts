import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  cashChangeReasonMatchesDelta,
  incomeChangeReasonMatchesMove,
  normalizeGameEventReason,
  resourceConsumptionReasonMatchesSource,
  victoryPointReasonMatchesDelta,
} from '../common/eventLogValidation';
import {applyCommand, determineWinners, validateCommand} from '../common/gameEngine';
import {createGame, INDUSTRY_TYPES, LINK_TYPES, validateGameSeed} from '../common/gameSetup';
import {advanceIncomeSpaces, retreatIncomeLevels} from '../common/income';
import {isLinkLineActiveForPlayerCount} from '../common/selectors';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../common/staticData';
import type {BoardState, GameCommand, GameEvent, GameState, IndustryInstance, IndustryTileSpec, IndustryType, LinkInstance, LinkType, MerchantBonus, PlayerCount, ResourceSource, ResourceType} from '../common/types';

export interface CreateStoredGameInput {
  playerNames: string[];
  seed?: number;
  introductoryCanalOnly?: boolean;
}

export interface CommandResult {
  ok: boolean;
  state?: GameState;
  errors?: string[];
}

export interface PlayerSession {
  playerId: string;
  token: string;
}

export interface ListedPendingDecision {
  type: NonNullable<GameState['pendingDecision']>['type'];
  playerId: string;
}

export interface GameSummary {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  playerNames: string[];
  playerCount: PlayerCount;
  roundNumber: number;
  era: GameState['era'];
  status: GameState['status'];
  variant?: GameState['variant'];
  connectedClientCount?: number;
  connectedPlayerIds?: string[];
  currentPlayerId?: string;
  pendingDecision?: ListedPendingDecision;
  winners?: string[];
  victoryPointsByPlayer?: Record<string, number>;
}

export interface GameStoreOptions {
  storagePath?: string;
}

interface PersistedGameStore {
  version: 1;
  games: GameState[];
  sessions?: Record<string, PlayerSession[]>;
}

type CommandPayload = {type: string; playerId: string} & Record<string, unknown>;

const MAX_MERCHANT_DEVELOP_REMOVALS = Object.values(staticConfig.locations).reduce((max, location) =>
  location.kind === 'merchant' && location.bonus.type === 'develop'
    ? Math.max(max, location.spaces.length * location.bonus.count)
    : max,
  0,
);

const GAME_EVENT_TYPES = [
  'game_created',
  'card_discarded',
  'cash_changed',
  'income_position_changed',
  'industry_built',
  'industry_removed',
  'industry_flipped',
  'industry_sold',
  'resource_consumed',
  'resource_sold_to_market',
  'link_built',
  'link_scored',
  'industry_scored',
  'merchant_bonus_claimed',
  'merchant_develop_resolved',
  'turn_advanced',
  'turn_order_updated',
  'negative_income_started',
  'negative_income_resolved',
  'victory_points_changed',
  'era_ended',
  'game_ended',
  'loan_taken',
  'scouted',
] as const satisfies readonly GameEvent['type'][];

const KNOWN_GAME_EVENT_TYPES = new Set<string>(GAME_EVENT_TYPES);

function isKnownGameEventType(type: string): type is GameEvent['type'] {
  return KNOWN_GAME_EVENT_TYPES.has(type);
}

const INDUSTRY_REMOVAL_REASONS = [
  'overbuild',
  'develop',
  'canal_cleanup',
  'negative_income',
] as const satisfies readonly Extract<GameEvent, {type: 'industry_removed'}>['reason'][];

const MARKETS = ['coal', 'iron'] as const;

const validIndustryTypes = new Set<string>(INDUSTRY_TYPES);
const supportedPlayerIds = ['p1', 'p2', 'p3', 'p4'] as const;
const supportedPlayerIdSet = new Set<string>(supportedPlayerIds);

type MerchantBonusValueChangeEvent = Extract<GameEvent, {type: 'cash_changed' | 'income_position_changed' | 'victory_points_changed'}>;
type MerchantBonusClaimedEvent = Extract<GameEvent, {type: 'merchant_bonus_claimed'}>;
type IndustryFlipIncomeChangeEvent = Extract<GameEvent, {type: 'income_position_changed'}>;
type IndustryFlippedEvent = Extract<GameEvent, {type: 'industry_flipped'}>;
type ScoringVictoryPointChangeEvent = Extract<GameEvent, {type: 'victory_points_changed'}>;
type LinkScoredEvent = Extract<GameEvent, {type: 'link_scored'}>;
type IndustryScoredEvent = Extract<GameEvent, {type: 'industry_scored'}>;
type ActionSpendReason = 'build' | 'network' | 'develop iron';
type ActionSpendCashEvent = Extract<GameEvent, {type: 'cash_changed'}>;

interface PendingIndustryFlipIncomeChange {
  event: IndustryFlipIncomeChangeEvent;
  industryType: IndustryType;
}

interface PendingScoringVictoryPointChange {
  event: ScoringVictoryPointChangeEvent;
  reason: 'link scoring' | 'industry scoring';
}

interface PendingBuildSpendCash {
  event: ActionSpendCashEvent;
  marketCost: number;
}

interface PendingBuildSpendResources {
  playerId: string;
  marketCost: number;
}

interface PendingNetworkSpendEvidence {
  playerId: string;
  marketCost: number;
  linkCount: number;
  linkType?: LinkType;
}

interface PendingDevelopSpendEvidence {
  playerId: string;
  marketCost: number;
}

function isPlayerCount(value: unknown): value is PlayerCount {
  return value === 2 || value === 3 || value === 4;
}

function expectedPlayerIdsForCount(playerCount: PlayerCount): string[] {
  return supportedPlayerIds.slice(0, playerCount);
}

function playerIdsInSeatOrder(game: GameState): string[] {
  return Object.keys(game.players).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
}

function normalizedEventPlayerId(value: unknown, validPlayerIds: ReadonlySet<string>): string | undefined {
  const playerId = trimmedNonEmptyString(value);
  return playerId !== undefined && validPlayerIds.has(playerId) ? playerId : undefined;
}

function normalizedEventPlayerIds(value: unknown, validPlayerIds: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const playerIds: string[] = [];
  for (const item of value) {
    const playerId = normalizedEventPlayerId(item, validPlayerIds);
    if (playerId !== undefined && !playerIds.includes(playerId)) {
      playerIds.push(playerId);
    }
  }
  return playerIds.length > 0 ? playerIds : undefined;
}

function playerIdSetsMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((playerId) => right.includes(playerId));
}

function normalizedGameEndedWinners(value: unknown, game: GameState, validPlayerIds: ReadonlySet<string>): string[] | undefined {
  const winners = normalizedEventPlayerIds(value, validPlayerIds);
  if (winners === undefined || game.status !== 'ended') {
    return undefined;
  }
  const expectedWinners = determineWinners(game);
  return playerIdSetsMatch(winners, expectedWinners) ? expectedWinners : undefined;
}

function positiveIntegerEventValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function integerEventValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function nonNegativeIntegerEventValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isCompletePlayerOrder(order: string[], playerIds: string[]): boolean {
  return order.length === playerIds.length && playerIds.every((playerId) => order.includes(playerId));
}

function normalizedEventCardId(value: unknown): string | undefined {
  const cardId = trimmedNonEmptyString(value);
  return cardId !== undefined && staticConfig.cardSpecs[cardId] !== undefined ? cardId : undefined;
}

function discardDestinationForCard(cardId: string): Extract<GameEvent, {type: 'card_discarded'}>['destination'] {
  const cardType = staticConfig.cardSpecs[cardId]?.type;
  return cardType === 'wild_location' || cardType === 'wild_industry' ? 'wild_pool' : 'discard';
}

function normalizedEventReason(value: unknown): string | undefined {
  return normalizeGameEventReason(value);
}

function normalizedEventIndustryType(value: unknown): IndustryType | undefined {
  const industryType = trimmedNonEmptyString(value);
  return industryType !== undefined && validIndustryTypes.has(industryType) ? industryType as IndustryType : undefined;
}

function normalizedEventLinkType(value: unknown): LinkType | undefined {
  const linkType = trimmedNonEmptyString(value);
  return linkType !== undefined && (LINK_TYPES as readonly string[]).includes(linkType) ? linkType as LinkType : undefined;
}

function normalizedEventMarket(value: unknown): 'coal' | 'iron' | undefined {
  const market = trimmedNonEmptyString(value);
  return market !== undefined && (MARKETS as readonly string[]).includes(market) ? market as 'coal' | 'iron' : undefined;
}

function normalizedIndustryRemovalReason(value: unknown): Extract<GameEvent, {type: 'industry_removed'}>['reason'] | undefined {
  const reason = trimmedNonEmptyString(value);
  return reason !== undefined && (INDUSTRY_REMOVAL_REASONS as readonly string[]).includes(reason)
    ? reason as Extract<GameEvent, {type: 'industry_removed'}>['reason']
    : undefined;
}

function isGeneratedEventInstanceId(id: string, prefix: 'industry' | 'link'): boolean {
  return new RegExp(`^${prefix}-\\d+$`).test(id);
}

function maxResourceCapacityForIndustrySpec(spec: IndustryTileSpec): number {
  return Math.max(
    resourceCapacityForIndustrySpec(spec, 'canal'),
    resourceCapacityForIndustrySpec(spec, 'rail'),
  );
}

function normalizedEventIndustryInstance(value: unknown, validPlayerIds: ReadonlySet<string>): IndustryInstance | undefined {
  if (!isObjectMap(value)) {
    return undefined;
  }

  const id = trimmedNonEmptyString(value.id);
  const ownerPlayerId = normalizedEventPlayerId(value.ownerPlayerId, validPlayerIds);
  const industryType = normalizedEventIndustryType(value.industryType);
  const specId = trimmedNonEmptyString(value.specId);
  const locationId = trimmedNonEmptyString(value.locationId);
  const slotId = trimmedNonEmptyString(value.slotId);
  const remainingResource = nonNegativeIntegerEventValue(value.remainingResource);
  const flipped = typeof value.flipped === 'boolean' ? value.flipped : undefined;
  const removedFromGame = typeof value.removedFromGame === 'boolean' ? value.removedFromGame : false;
  const spec = specId === undefined ? undefined : staticConfig.industryTileSpecs[specId];
  const slot = slotId === undefined ? undefined : expectedBoardSlots()[slotId];

  if (
    id === undefined ||
    !isGeneratedEventInstanceId(id, 'industry') ||
    ownerPlayerId === undefined ||
    industryType === undefined ||
    specId === undefined ||
    spec === undefined ||
    spec.industryType !== industryType ||
    locationId === undefined ||
    slotId === undefined ||
    slot === undefined ||
    slot.locationId !== locationId ||
    !slot.allowedIndustryTypes.includes(industryType) ||
    remainingResource === undefined ||
    flipped === undefined
  ) {
    return undefined;
  }

  return {
    id,
    specId,
    ownerPlayerId,
    industryType,
    level: spec.level,
    locationId,
    slotId,
    flipped,
    remainingResource: flipped ? 0 : Math.min(remainingResource, maxResourceCapacityForIndustrySpec(spec)),
    removedFromGame,
  };
}

function normalizedEventLinkInstance(value: unknown, validPlayerIds: ReadonlySet<string>, game: GameState): LinkInstance | undefined {
  if (!isObjectMap(value)) {
    return undefined;
  }

  const id = trimmedNonEmptyString(value.id);
  const ownerPlayerId = normalizedEventPlayerId(value.ownerPlayerId, validPlayerIds);
  const linkType = normalizedEventLinkType(value.linkType);
  const linkLineId = trimmedNonEmptyString(value.linkLineId);
  const line = linkLineId === undefined ? undefined : staticConfig.linkLines[linkLineId];

  if (
    id === undefined ||
    !isGeneratedEventInstanceId(id, 'link') ||
    ownerPlayerId === undefined ||
    linkType === undefined ||
    linkLineId === undefined ||
    line === undefined ||
    !line.allowedLinkTypes.includes(linkType) ||
    !isLinkLineActiveForPlayerCount(game, line)
  ) {
    return undefined;
  }

  return {id, ownerPlayerId, linkType, linkLineId};
}

function normalizedKnownIndustryInstanceId(
  value: unknown,
  game: GameState,
  ownerPlayerId?: string,
): string | undefined {
  const industryInstanceId = trimmedNonEmptyString(value);
  const industry = industryInstanceId === undefined
    ? undefined
    : game.board.industryInstances[industryInstanceId];
  return industry !== undefined && (ownerPlayerId === undefined || industry.ownerPlayerId === ownerPlayerId)
    ? industryInstanceId
    : undefined;
}

function normalizedOwnedIndustryEventIds(value: unknown, game: GameState, playerId: string): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const industryInstanceIds: string[] = [];
  for (const item of value) {
    const industryInstanceId = trimmedNonEmptyString(item);
    const industry = industryInstanceId === undefined
      ? undefined
      : game.board.industryInstances[industryInstanceId];
    if (industryInstanceId === undefined || industry?.ownerPlayerId !== playerId) {
      return undefined;
    }
    if (!industryInstanceIds.includes(industryInstanceId)) {
      industryInstanceIds.push(industryInstanceId);
    }
  }
  return industryInstanceIds;
}

function normalizedKnownMerchantSpaceId(value: unknown, game: GameState): string | undefined {
  const merchantSpaceId = trimmedNonEmptyString(value);
  return merchantSpaceId !== undefined && game.board.merchantSpaces[merchantSpaceId]
    ? merchantSpaceId
    : undefined;
}

function normalizedKnownMerchantSpaceIds(value: unknown, game: GameState, requiredMerchantSpaceId: string): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const merchantSpaceIds = [requiredMerchantSpaceId];
  for (const item of value) {
    const merchantSpaceId = normalizedKnownMerchantSpaceId(item, game);
    if (merchantSpaceId === undefined) {
      return undefined;
    }
    if (!merchantSpaceIds.includes(merchantSpaceId)) {
      merchantSpaceIds.push(merchantSpaceId);
    }
  }
  return merchantSpaceIds;
}

function merchantSpaceAcceptsIndustry(game: GameState, merchantSpaceId: string, industryType: IndustryType): boolean {
  const merchantTileInstanceId = game.board.merchantSpaces[merchantSpaceId]?.merchantTileInstanceId;
  const specId = typeof merchantTileInstanceId === 'string'
    ? merchantTileSpecId(merchantTileInstanceId.trim())
    : undefined;
  const spec = specId === undefined ? undefined : staticConfig.merchantTileSpecs[specId];
  return Boolean(spec && !spec.blank && spec.acceptedIndustryTypes.includes(industryType));
}

function merchantSpaceHasNonBlankTile(game: GameState, merchantSpaceId: string, merchantTileInstanceId: string): boolean {
  const specId = merchantTileSpecId(merchantTileInstanceId.trim());
  const spec = staticConfig.merchantTileSpecs[specId];
  return Boolean(
    spec &&
    !spec.blank &&
    game.board.merchantSpaces[merchantSpaceId]?.merchantTileInstanceId === merchantTileInstanceId,
  );
}

function resourceTypeMatchesIndustry(resourceType: ResourceType, industry: IndustryInstance): boolean {
  return (
    (resourceType === 'coal' && industry.industryType === 'coal_mine') ||
    (resourceType === 'iron' && industry.industryType === 'iron_works') ||
    (resourceType === 'beer' && industry.industryType === 'brewery')
  );
}

function normalizedEventResourceSource(value: unknown, game: GameState): ResourceSource | undefined {
  if (!isObjectMap(value)) {
    return undefined;
  }

  const kind = trimmedNonEmptyString(value.kind);
  if (kind === 'industry_tile') {
    const industryInstanceId = trimmedNonEmptyString(value.industryInstanceId);
    const resourceType = trimmedNonEmptyString(value.resourceType);
    const industry = industryInstanceId === undefined
      ? undefined
      : game.board.industryInstances[industryInstanceId];
    if (
      industryInstanceId === undefined ||
      industry === undefined ||
      (resourceType !== 'coal' && resourceType !== 'iron' && resourceType !== 'beer') ||
      !resourceTypeMatchesIndustry(resourceType, industry)
    ) {
      return undefined;
    }
    return {kind: 'industry_tile', industryInstanceId, resourceType};
  }

  if (kind === 'market') {
    const market = normalizedEventMarket(value.market);
    const price = nonNegativeIntegerEventValue(value.price);
    if (market === undefined || price === undefined || !isMarketPrice(market, price)) {
      return undefined;
    }
    return {kind: 'market', market, price};
  }

  if (kind === 'merchant_beer') {
    const merchantSpaceId = normalizedKnownMerchantSpaceId(value.merchantSpaceId, game);
    const merchantTileInstanceId = trimmedNonEmptyString(value.merchantTileInstanceId);
    const merchantSpace = merchantSpaceId === undefined
      ? undefined
      : game.board.merchantSpaces[merchantSpaceId];
    if (
      merchantSpaceId === undefined ||
      merchantTileInstanceId === undefined ||
      merchantSpace?.merchantTileInstanceId !== merchantTileInstanceId ||
      !merchantSpaceHasNonBlankTile(game, merchantSpaceId, merchantTileInstanceId)
    ) {
      return undefined;
    }
    return {kind: 'merchant_beer', merchantSpaceId, merchantTileInstanceId};
  }

  return undefined;
}

function normalizedMerchantBonus(value: unknown): MerchantBonus | undefined {
  if (!isObjectMap(value)) {
    return undefined;
  }

  const type = trimmedNonEmptyString(value.type);
  if (type === 'develop') {
    return value.count === 1 ? {type: 'develop', count: 1} : undefined;
  }

  if (type === 'income_spaces') {
    const spaces = positiveIntegerEventValue(value.spaces);
    return spaces === undefined ? undefined : {type: 'income_spaces', spaces};
  }

  if (type === 'victory_points') {
    const points = positiveIntegerEventValue(value.points);
    return points === undefined ? undefined : {type: 'victory_points', points};
  }

  if (type === 'cash') {
    const cash = positiveIntegerEventValue(value.cash);
    return cash === undefined ? undefined : {type: 'cash', cash};
  }

  return undefined;
}

function merchantBonusForSpace(merchantSpaceId: string): MerchantBonus | undefined {
  const merchant = Object.values(staticConfig.locations).find((location) =>
    location.kind === 'merchant' && location.spaces.some((space) => space.id === merchantSpaceId),
  );
  return merchant?.kind === 'merchant' ? merchant.bonus : undefined;
}

function merchantBonusesMatch(actual: MerchantBonus, expected: MerchantBonus): boolean {
  switch (expected.type) {
    case 'develop':
      return actual.type === 'develop' && actual.count === expected.count;
    case 'income_spaces':
      return actual.type === 'income_spaces' && actual.spaces === expected.spaces;
    case 'victory_points':
      return actual.type === 'victory_points' && actual.points === expected.points;
    case 'cash':
      return actual.type === 'cash' && actual.cash === expected.cash;
  }
}

function merchantBonusMatchesSpace(merchantSpaceId: string, bonus: MerchantBonus): boolean {
  const expected = merchantBonusForSpace(merchantSpaceId);
  return expected !== undefined && merchantBonusesMatch(bonus, expected);
}

function isMerchantBonusValueChangeEvent(event: GameEvent): event is MerchantBonusValueChangeEvent {
  return (
    event.type === 'cash_changed' ||
    event.type === 'income_position_changed' ||
    event.type === 'victory_points_changed'
  ) && event.reason === 'merchant bonus';
}

function merchantBonusValueChangeMatchesClaim(
  valueChange: MerchantBonusValueChangeEvent,
  claimedEvent: MerchantBonusClaimedEvent,
): boolean {
  if (valueChange.playerId !== claimedEvent.playerId) {
    return false;
  }

  switch (claimedEvent.bonus.type) {
    case 'cash':
      return valueChange.type === 'cash_changed' && valueChange.delta === claimedEvent.bonus.cash;
    case 'income_spaces':
      return valueChange.type === 'income_position_changed' &&
        valueChange.to === advanceIncomeSpaces(valueChange.from, claimedEvent.bonus.spaces);
    case 'victory_points':
      return valueChange.type === 'victory_points_changed' && valueChange.delta === claimedEvent.bonus.points;
    case 'develop':
      return false;
  }
}

function industryFlipIncomeReason(reason: string): {industryType: IndustryType} | undefined {
  for (const industryType of INDUSTRY_TYPES) {
    if (reason === `flipped ${industryType}` || reason === `sold ${industryType}`) {
      return {industryType};
    }
  }
  return undefined;
}

function industryFlipIncomeChangeForEvent(event: GameEvent): PendingIndustryFlipIncomeChange | undefined {
  if (event.type !== 'income_position_changed') {
    return undefined;
  }

  const reason = industryFlipIncomeReason(event.reason);
  return reason === undefined ? undefined : {event, industryType: reason.industryType};
}

function industryFlipIncomeChangeMatchesFlip(
  incomeChange: PendingIndustryFlipIncomeChange,
  flippedEvent: IndustryFlippedEvent,
  game: GameState,
): boolean {
  const industry = game.board.industryInstances[flippedEvent.industryInstanceId];
  const spec = industry === undefined ? undefined : staticConfig.industryTileSpecs[industry.specId];
  const expectedTo = spec === undefined
    ? undefined
    : advanceIncomeSpaces(incomeChange.event.from, spec.flip.incomeSpaces);
  return industry !== undefined &&
    expectedTo !== undefined &&
    flippedEvent.ownerPlayerId === incomeChange.event.playerId &&
    industry.industryType === incomeChange.industryType &&
    incomeChange.event.to === expectedTo;
}

function scoringVictoryPointChangeForEvent(event: GameEvent): PendingScoringVictoryPointChange | undefined {
  if (
    event.type !== 'victory_points_changed' ||
    (event.reason !== 'link scoring' && event.reason !== 'industry scoring')
  ) {
    return undefined;
  }

  return {event, reason: event.reason};
}

function scoringVictoryPointChangeMatchesScore(
  change: PendingScoringVictoryPointChange,
  scoredEvent: LinkScoredEvent | IndustryScoredEvent,
): boolean {
  if (change.reason === 'link scoring') {
    return scoredEvent.type === 'link_scored' &&
      change.event.playerId === scoredEvent.ownerPlayerId &&
      change.event.delta === scoredEvent.points;
  }

  return scoredEvent.type === 'industry_scored' &&
    change.event.playerId === scoredEvent.ownerPlayerId &&
    change.event.delta === scoredEvent.points;
}

function isActionSpendCashEvent(event: GameEvent): event is ActionSpendCashEvent {
  return event.type === 'cash_changed' &&
    (event.reason === 'build' || event.reason === 'network' || event.reason === 'develop iron');
}

function isNegativeIncomePendingEvidenceEvent(
  event: GameEvent,
  game: GameState,
  pending: Extract<GameEvent, {type: 'negative_income_started'}>,
): boolean {
  if (event.type === 'negative_income_started') {
    return event.playerId === pending.playerId && event.amountOwed === pending.amountOwed;
  }

  if (event.type === 'industry_removed') {
    const industry = game.board.industryInstances[event.industryInstanceId];
    return event.reason === 'negative_income' && industry?.ownerPlayerId === pending.playerId;
  }

  if (event.type === 'cash_changed') {
    return event.playerId === pending.playerId &&
      (event.reason === 'negative income liquidation' || event.reason === 'income');
  }

  if (event.type === 'victory_points_changed') {
    return event.playerId === pending.playerId && event.reason === 'negative income shortfall';
  }

  return false;
}

function isLifecycleBoundaryEvent(event: GameEvent): boolean {
  return event.type === 'turn_advanced' ||
    event.type === 'turn_order_updated' ||
    event.type === 'era_ended' ||
    event.type === 'game_ended';
}

function resourceMarketCostForActionSpend(event: Extract<GameEvent, {type: 'resource_consumed'}>): number {
  return event.source.kind === 'market' ? event.source.price : 0;
}

function networkBaseSpend(linkCount: number, linkType: LinkType | undefined): number | undefined {
  if (linkType === 'canal' && linkCount === 1) {
    return staticConfig.rules.canalLinkCost;
  }
  if (linkType === 'rail' && linkCount === 1) {
    return staticConfig.rules.railSingleLinkCost;
  }
  if (linkType === 'rail' && linkCount === 2) {
    return staticConfig.rules.railDoubleLinkCost;
  }
  return undefined;
}

function buildSpendCashMatchesIndustry(
  pendingCash: PendingBuildSpendCash,
  builtEvent: Extract<GameEvent, {type: 'industry_built'}>,
): boolean {
  const spec = staticConfig.industryTileSpecs[builtEvent.instance.specId];
  return spec !== undefined &&
    builtEvent.instance.ownerPlayerId === pendingCash.event.playerId &&
    pendingCash.event.delta === -(spec.cost.cash + pendingCash.marketCost);
}

function merchantBonusClaimKey(playerId: string, merchantSpaceId: string): string {
  return `${playerId}:${merchantSpaceId}`;
}

function resourceSoldToMarketLimit(industry: IndustryInstance): number {
  const spec = staticConfig.industryTileSpecs[industry.specId];
  return spec === undefined ? 0 : maxResourceCapacityForIndustrySpec(spec);
}

function industryResourceConsumptionLimit(game: GameState, industryInstanceId: string): number {
  const industry = game.board.industryInstances[industryInstanceId];
  return industry === undefined ? 0 : resourceSoldToMarketLimit(industry);
}

function merchantBeerConsumptionKey(source: Extract<ResourceSource, {kind: 'merchant_beer'}>): string {
  return `${source.merchantSpaceId}:${source.merchantTileInstanceId}`;
}

function industryIsFlipped(game: GameState, industryInstanceId: string): boolean {
  return game.board.industryInstances[industryInstanceId]?.flipped === true;
}

function industryIsRemoved(game: GameState, industryInstanceId: string): boolean {
  return game.board.industryInstances[industryInstanceId]?.removedFromGame === true;
}

function negativeIncomeResolutionMatchesRules(
  game: GameState,
  industryInstanceIds: readonly string[],
  amountOwed: number,
  paid: number,
  victoryPointLoss: number,
): boolean {
  const selectedLiquidationValue = [...new Set(industryInstanceIds)]
    .reduce((sum, industryInstanceId) => {
      const industry = game.board.industryInstances[industryInstanceId];
      const cashCost = industry === undefined
        ? undefined
        : staticConfig.industryTileSpecs[industry.specId]?.cost.cash;
      return sum + Math.floor((cashCost ?? 0) / 2);
    }, 0);
  const minimumPaidFromLiquidations = Math.min(amountOwed, selectedLiquidationValue);
  return paid + victoryPointLoss === amountOwed &&
    paid >= minimumPaidFromLiquidations &&
    industryInstanceIds.every((industryInstanceId) => industryIsRemoved(game, industryInstanceId));
}

function industryScoreMatchesRules(game: GameState, industryInstanceId: string, points: number): boolean {
  const industry = game.board.industryInstances[industryInstanceId];
  const expectedPoints = industry === undefined
    ? undefined
    : staticConfig.industryTileSpecs[industry.specId]?.flip.victoryPoints;
  return expectedPoints === points && (industry?.removedFromGame === true || industry?.flipped === true);
}

function normalizedEventIndustryTypes(value: unknown): IndustryType[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const industryTypes: IndustryType[] = [];
  for (const item of value) {
    const industryType = normalizedEventIndustryType(item);
    if (industryType === undefined) {
      return undefined;
    }
    industryTypes.push(industryType);
  }
  return industryTypes;
}

function normalizedEventSpecIdsForIndustryTypes(value: unknown, industryTypes: readonly IndustryType[]): string[] | undefined {
  if (!Array.isArray(value) || value.length !== industryTypes.length) {
    return undefined;
  }

  const specIds: string[] = [];
  for (const [index, item] of value.entries()) {
    const specId = trimmedNonEmptyString(item);
    const spec = specId === undefined ? undefined : staticConfig.industryTileSpecs[specId];
    if (specId === undefined || spec?.industryType !== industryTypes[index]) {
      return undefined;
    }
    specIds.push(specId);
  }
  return specIds;
}

function merchantDevelopResolutionMatchesPlayerStacks(
  game: GameState,
  playerId: string,
  industryTypes: readonly IndustryType[],
  specIds: readonly string[],
): boolean {
  const player = game.players[playerId];
  return player !== undefined && specIds.every((specId, index) => {
    const industryType = industryTypes[index];
    return player.industryTileStacks[industryType]?.removedSpecIds.includes(specId) === true;
  });
}

interface HistoricalLinkReference {
  ownerPlayerId: string;
  linkLineId: string;
  signature: string;
}

type HistoricalLinkReferenceEntry = HistoricalLinkReference | null;

function historicalLinkSignature(instance: LinkInstance): string {
  return `${instance.ownerPlayerId}|${instance.linkType}|${instance.linkLineId}`;
}

function recordHistoricalLinkReference(
  references: Map<string, HistoricalLinkReferenceEntry>,
  instance: LinkInstance,
): void {
  const reference = {
    ownerPlayerId: instance.ownerPlayerId,
    linkLineId: instance.linkLineId,
    signature: historicalLinkSignature(instance),
  };
  if (!references.has(instance.id)) {
    references.set(instance.id, reference);
    return;
  }

  const existingReference = references.get(instance.id);
  if (
    existingReference !== undefined &&
    existingReference !== null &&
    (existingReference.ownerPlayerId !== reference.ownerPlayerId ||
      existingReference.signature !== reference.signature)
  ) {
    references.set(instance.id, null);
  }
}

function normalizedKnownLinkOwner(
  linkInstanceId: string,
  ownerPlayerId: string,
  game: GameState,
  historicalLinkReferences: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
): boolean {
  const link = game.board.linkInstances[linkInstanceId];
  if (link?.ownerPlayerId === ownerPlayerId) {
    return true;
  }
  const reference = historicalLinkReferences.get(linkInstanceId);
  return reference !== undefined && reference !== null && reference.ownerPlayerId === ownerPlayerId;
}

function knownLinkLineIdForScoredLink(
  game: GameState,
  linkInstanceId: string,
  historicalLinkReferences: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
): string | undefined {
  const linkLineId = game.board.linkInstances[linkInstanceId]?.linkLineId;
  if (linkLineId !== undefined) {
    return linkLineId;
  }
  const reference = historicalLinkReferences.get(linkInstanceId);
  return reference === undefined || reference === null ? undefined : reference.linkLineId;
}

function linkScoreValueForBoard(game: GameState, linkLineId: string): number | undefined {
  const line = staticConfig.linkLines[linkLineId];
  if (!line) {
    return undefined;
  }
  const endpointIds = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId));
  return endpointIds.reduce((sum, locationId) => {
    const location = staticConfig.locations[locationId];
    const printed = location?.printedLinkIcons ?? 0;
    const industryIcons = Object.values(game.board.industryInstances)
      .filter((industry) => industry.locationId === locationId && industry.flipped)
      .reduce((total, industry) => total + (staticConfig.industryTileSpecs[industry.specId]?.flip.linkIcons ?? 0), 0);
    return sum + printed + industryIcons;
  }, 0);
}

function linkScoreMatchesRules(
  game: GameState,
  linkInstanceId: string,
  points: number,
  historicalLinkReferences: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
): boolean {
  const linkLineId = knownLinkLineIdForScoredLink(game, linkInstanceId, historicalLinkReferences);
  const expectedPoints = linkLineId === undefined ? undefined : linkScoreValueForBoard(game, linkLineId);
  return expectedPoints === points;
}

function isCommandEnvelope(command: unknown): command is CommandPayload {
  return isObjectMap(command) &&
    typeof command.type === 'string' &&
    typeof command.playerId === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function trimmedNonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function normalizeStringProperty(record: Record<string, unknown>, field: string): string | undefined {
  const value = trimmedNonEmptyString(record[field]);
  if (value !== undefined) {
    record[field] = value;
  }
  return value;
}

function normalizeCommandValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCommandValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeCommandValue(item)]),
    );
  }
  return value;
}

function normalizeCommandEnvelope(command: CommandPayload): CommandPayload {
  return normalizeCommandValue(command) as CommandPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicTurnOrder(game: GameState): string[] {
  const playerIds = playerIdsInSeatOrder(game);
  const turnOrder: string[] = [];
  const rawTurnOrder = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  for (const rawPlayerId of rawTurnOrder) {
    const playerId = trimmedNonEmptyString(rawPlayerId);
    if (playerId !== undefined && playerIds.includes(playerId) && !turnOrder.includes(playerId)) {
      turnOrder.push(playerId);
    }
  }
  for (const playerId of playerIds) {
    if (!turnOrder.includes(playerId)) {
      turnOrder.push(playerId);
    }
  }
  return turnOrder;
}

function publicPlayerCount(game: GameState): PlayerCount {
  const playerCount = playerIdsInSeatOrder(game).length;
  return isPlayerCount(playerCount)
    ? playerCount
    : isPlayerCount(game.playerCount) ? game.playerCount : 2;
}

function publicRoundNumber(game: GameState): number {
  return nonNegativeInteger(game.roundNumber, 1) || 1;
}

function publicEra(game: GameState): GameState['era'] {
  const era = trimmedNonEmptyString(game.era);
  return era === 'canal' || era === 'rail' ? era : 'canal';
}

function publicStatus(game: GameState): GameState['status'] {
  const status = trimmedNonEmptyString(game.status);
  return status === 'playing' || status === 'ended' ? status : 'playing';
}

function publicPlayerName(playerId: string, player: GameState['players'][string]): string {
  const name = trimmedNonEmptyString((player as {name?: unknown}).name);
  if (name !== undefined) {
    return name;
  }
  const seat = /^p(\d+)$/.exec(playerId)?.[1];
  return seat ? `Player ${seat}` : 'Player';
}

function publicPlayerIdAtTurnIndex(game: GameState, turnIndex: unknown): string | undefined {
  if (
    !Array.isArray(game.turnOrder) ||
    typeof turnIndex !== 'number' ||
    !Number.isInteger(turnIndex) ||
    turnIndex < 0 ||
    turnIndex >= game.turnOrder.length
  ) {
    return undefined;
  }
  const playerId = trimmedNonEmptyString(game.turnOrder[turnIndex]);
  return playerId !== undefined && game.players[playerId] ? playerId : undefined;
}

function publicTurnIndex(game: GameState, turnIndex: unknown): number | undefined {
  const turnOrder = publicTurnOrder(game);
  if (turnOrder.length === 0) {
    return undefined;
  }
  const currentPlayerId = publicPlayerIdAtTurnIndex(game, turnIndex);
  if (currentPlayerId !== undefined) {
    return turnOrder.indexOf(currentPlayerId);
  }
  return typeof turnIndex === 'number' && Number.isInteger(turnIndex) && turnIndex >= 0 && turnIndex < turnOrder.length
    ? turnIndex
    : 0;
}

function publicCurrentPlayerId(game: GameState): string | undefined {
  if (publicStatus(game) !== 'playing') {
    return undefined;
  }
  const turnOrder = publicTurnOrder(game);
  const turnIndex = publicTurnIndex(game, (game as {currentTurnIndex?: unknown}).currentTurnIndex);
  return turnIndex === undefined ? undefined : turnOrder[turnIndex];
}

function publicPendingDecisionSummary(game: GameState): ListedPendingDecision | undefined {
  if (publicStatus(game) !== 'playing') {
    return undefined;
  }
  const decision = (game as Partial<GameState>).pendingDecision;
  if (!isRecord(decision)) {
    return undefined;
  }
  const playerId = trimmedNonEmptyString(decision.playerId);
  if (playerId === undefined || !game.players[playerId]) {
    return undefined;
  }

  if (decision.type === 'negative_income') {
    const amountOwed = decision.amountOwed;
    const incomePlayerIndex = decision.incomePlayerIndex;
    const turnOrder = publicTurnOrder(game);
    if (
      typeof amountOwed !== 'number' ||
      !Number.isFinite(amountOwed) ||
      Math.floor(amountOwed) <= 0 ||
      typeof incomePlayerIndex !== 'number' ||
      !Number.isInteger(incomePlayerIndex) ||
      incomePlayerIndex < 0 ||
      incomePlayerIndex >= turnOrder.length ||
      turnOrder[incomePlayerIndex] !== playerId
    ) {
      return undefined;
    }
    return {type: 'negative_income', playerId};
  }

  if (decision.type === 'merchant_develop') {
    const count = decision.count;
    const merchantSpaceId = trimmedNonEmptyString(decision.merchantSpaceId);
    if (
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      Math.floor(count) <= 0 ||
      merchantSpaceId === undefined ||
      !game.board.merchantSpaces[merchantSpaceId] ||
      !merchantSpaceHasDevelopBonus(merchantSpaceId)
    ) {
      return undefined;
    }
    return {type: 'merchant_develop', playerId};
  }

  return undefined;
}

function publicVictoryPointsByPlayer(game: GameState): Record<string, number> | undefined {
  if (publicStatus(game) !== 'ended') {
    return undefined;
  }
  const entries = playerIdsInSeatOrder(game).flatMap((playerId) => {
    const player = game.players[playerId];
    const victoryPoints = player ? nonNegativeInteger(player.victoryPoints, 0) : undefined;
    return victoryPoints === undefined ? [] : [[playerId, victoryPoints] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function publicGameWinners(game: GameState): string[] | undefined {
  if (publicStatus(game) !== 'ended') {
    return undefined;
  }
  const victoryPointsByPlayer = publicVictoryPointsByPlayer(game);
  if (!victoryPointsByPlayer) {
    return undefined;
  }
  const validPlayerIds = new Set(Object.keys(victoryPointsByPlayer));
  const endedEvents = Array.isArray(game.eventLog)
    ? game.eventLog.filter((event): event is Extract<GameEvent, {type: 'game_ended'}> => event.type === 'game_ended')
    : [];
  for (let index = endedEvents.length - 1; index >= 0; index--) {
    const winners = normalizedGameEndedWinners(endedEvents[index].winners, game, validPlayerIds);
    if (winners !== undefined) {
      return winners;
    }
  }
  return determineWinners(game);
}

function validateStringField(command: CommandPayload, field: string, errors: string[]): void {
  const value = command[field];
  if (typeof value !== 'string') {
    errors.push(`${command.type} command requires ${field}`);
    return;
  }
  if (!isNonEmptyString(value)) {
    errors.push(`${command.type} command field ${field} must be a non-empty string`);
  }
}

function validateCommandEnvelopeFields(command: CommandPayload): string[] {
  const errors: string[] = [];
  if (!isNonEmptyString(command.type)) {
    errors.push('Command type must be a non-empty string');
  }
  if (!isNonEmptyString(command.playerId)) {
    errors.push('Command playerId must be a non-empty string');
  }
  return errors;
}

function validateIndustryTypeField(command: CommandPayload, field: string, errors: string[]): void {
  const value = command[field];
  if (typeof value !== 'string') {
    errors.push(`${command.type} command requires ${field}`);
    return;
  }
  if (!validIndustryTypes.has(value)) {
    errors.push(`${command.type} command field ${field} must be a valid industry type`);
  }
}

function isMarketPrice(market: 'coal' | 'iron', price: number): boolean {
  const config = staticConfig.markets[market];
  return config.priceSlotsCheapestToMostExpensive.includes(price) || config.fallbackPriceWhenEmpty === price;
}

function isMarketSlotPrice(market: 'coal' | 'iron', price: number): boolean {
  return staticConfig.markets[market].priceSlotsCheapestToMostExpensive.includes(price);
}

type ArrayLengthRule =
  | {exactly: number}
  | {min: number; max?: number};

function entryLabel(count: number): string {
  return count === 1 ? 'entry' : 'entries';
}

function validateArrayLength(
  command: CommandPayload,
  field: string,
  value: unknown[],
  errors: string[],
  rule?: ArrayLengthRule,
): void {
  if (!rule) {
    return;
  }
  if ('exactly' in rule) {
    if (value.length !== rule.exactly) {
      errors.push(`${command.type} command field ${field} must contain exactly ${rule.exactly} ${entryLabel(rule.exactly)}`);
    }
    return;
  }
  if (value.length < rule.min) {
    errors.push(`${command.type} command field ${field} must contain at least ${rule.min} ${entryLabel(rule.min)}`);
    return;
  }
  if (rule.max !== undefined && value.length > rule.max) {
    errors.push(`${command.type} command field ${field} must contain at most ${rule.max} ${entryLabel(rule.max)}`);
  }
}

function validateStringArrayField(command: CommandPayload, field: string, errors: string[], rule?: ArrayLengthRule): void {
  const value = command[field];
  if (!isStringArray(value)) {
    errors.push(`${command.type} command requires ${field} as a string array`);
    return;
  }
  validateArrayLength(command, field, value, errors, rule);
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      errors.push(`${command.type} command field ${field}[${index}] must be a non-empty string`);
    }
  }
}

function validateIndustryTypeArrayField(command: CommandPayload, field: string, errors: string[], rule?: ArrayLengthRule): void {
  const value = command[field];
  if (!isStringArray(value)) {
    errors.push(`${command.type} command requires ${field} as a string array`);
    return;
  }
  validateArrayLength(command, field, value, errors, rule);
  for (const [index, industryType] of value.entries()) {
    if (!validIndustryTypes.has(industryType)) {
      errors.push(`${command.type} command field ${field}[${index}] must be a valid industry type`);
    }
  }
}

function validateResourceSource(value: unknown, pathName: string, errors: string[], expectedResource?: ResourceType): void {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    errors.push(`${pathName} must be a resource source`);
    return;
  }

  if (value.kind === 'industry_tile') {
    if (typeof value.industryInstanceId !== 'string') {
      errors.push(`${pathName}.industryInstanceId must be a string`);
    } else if (!isNonEmptyString(value.industryInstanceId)) {
      errors.push(`${pathName}.industryInstanceId must be a non-empty string`);
    }
    if (value.resourceType !== 'coal' && value.resourceType !== 'iron' && value.resourceType !== 'beer') {
      errors.push(`${pathName}.resourceType must be coal, iron, or beer`);
    } else if (expectedResource !== undefined && value.resourceType !== expectedResource) {
      errors.push(`${pathName}.resourceType must be ${expectedResource}`);
    }
    return;
  }

  if (value.kind === 'market') {
    if (value.market !== 'coal' && value.market !== 'iron') {
      errors.push(`${pathName}.market must be coal or iron`);
    } else if (expectedResource === 'beer') {
      errors.push(`${pathName} cannot be a market source for beer`);
    } else if (expectedResource !== undefined && value.market !== expectedResource) {
      errors.push(`${pathName}.market must be ${expectedResource}`);
    }
    if (typeof value.price !== 'number' || !Number.isFinite(value.price)) {
      errors.push(`${pathName}.price must be a finite number`);
    } else if (!Number.isInteger(value.price) || value.price < 0) {
      errors.push(`${pathName}.price must be a non-negative integer`);
    } else if ((value.market === 'coal' || value.market === 'iron') && !isMarketPrice(value.market, value.price)) {
      errors.push(`${pathName}.price must match a ${value.market} market price`);
    }
    return;
  }

  if (value.kind === 'merchant_beer') {
    if (expectedResource !== undefined && expectedResource !== 'beer') {
      errors.push(`${pathName}.kind cannot supply ${expectedResource}`);
    }
    if (typeof value.merchantSpaceId !== 'string') {
      errors.push(`${pathName}.merchantSpaceId must be a string`);
    } else if (!isNonEmptyString(value.merchantSpaceId)) {
      errors.push(`${pathName}.merchantSpaceId must be a non-empty string`);
    }
    if (typeof value.merchantTileInstanceId !== 'string') {
      errors.push(`${pathName}.merchantTileInstanceId must be a string`);
    } else if (!isNonEmptyString(value.merchantTileInstanceId)) {
      errors.push(`${pathName}.merchantTileInstanceId must be a non-empty string`);
    }
    return;
  }

  errors.push(`${pathName}.kind must be industry_tile, market, or merchant_beer`);
}

function validateOptionalResourceSources(
  command: CommandPayload,
  field: string,
  errors: string[],
  rule?: ArrayLengthRule,
  expectedResource?: ResourceType,
): void {
  const value = command[field];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${command.type} command field ${field} must be an array`);
    return;
  }
  validateArrayLength(command, field, value, errors, rule);
  for (const [index, source] of value.entries()) {
    validateResourceSource(source, `${command.type} command field ${field}[${index}]`, errors, expectedResource);
  }
}

function validateSellSteps(command: CommandPayload, errors: string[]): void {
  if (!Array.isArray(command.sales)) {
    errors.push('sell command requires sales as an array');
    return;
  }
  validateArrayLength(command, 'sales', command.sales, errors, {min: 1});
  for (const [index, step] of command.sales.entries()) {
    if (typeof step !== 'object' || step === null) {
      errors.push(`sell command sales[${index}] must be an object`);
      continue;
    }
    const sale = step as Record<string, unknown>;
    if (typeof sale.industryInstanceId !== 'string') {
      errors.push(`sell command sales[${index}] requires industryInstanceId`);
    } else if (!isNonEmptyString(sale.industryInstanceId)) {
      errors.push(`sell command sales[${index}].industryInstanceId must be a non-empty string`);
    }
    if (typeof sale.merchantSpaceId !== 'string') {
      errors.push(`sell command sales[${index}] requires merchantSpaceId`);
    } else if (!isNonEmptyString(sale.merchantSpaceId)) {
      errors.push(`sell command sales[${index}].merchantSpaceId must be a non-empty string`);
    }
    if (sale.beerSources !== undefined && !Array.isArray(sale.beerSources)) {
      errors.push(`sell command sales[${index}] field beerSources must be an array`);
    } else if (Array.isArray(sale.beerSources)) {
      validateArrayLength(command, `sales[${index}].beerSources`, sale.beerSources, errors, {min: 0, max: 2});
      for (const [sourceIndex, source] of sale.beerSources.entries()) {
        validateResourceSource(source, `sell command sales[${index}].beerSources[${sourceIndex}]`, errors, 'beer');
      }
    }
  }
}

function validateCommandPayloadShape(command: CommandPayload): string[] {
  const errors: string[] = [];
  switch (command.type) {
    case 'build':
      validateStringField(command, 'cardId', errors);
      validateStringField(command, 'locationId', errors);
      validateStringField(command, 'slotId', errors);
      validateIndustryTypeField(command, 'industryType', errors);
      validateOptionalResourceSources(command, 'coalSources', errors, {min: 0, max: 2}, 'coal');
      validateOptionalResourceSources(command, 'ironSources', errors, {min: 0, max: 2}, 'iron');
      break;
    case 'network':
      validateStringField(command, 'cardId', errors);
      validateStringArrayField(command, 'linkLineIds', errors, {min: 1, max: 2});
      validateOptionalResourceSources(command, 'coalSources', errors, {min: 0, max: 2}, 'coal');
      if (command.beerSourceForDoubleRail !== undefined) {
        validateResourceSource(command.beerSourceForDoubleRail, 'network command field beerSourceForDoubleRail', errors, 'beer');
      }
      break;
    case 'develop':
      validateStringField(command, 'cardId', errors);
      validateIndustryTypeArrayField(command, 'industryTypes', errors, {min: 1, max: 2});
      validateOptionalResourceSources(command, 'ironSources', errors, {min: 0, max: 2}, 'iron');
      break;
    case 'sell':
      validateStringField(command, 'cardId', errors);
      validateSellSteps(command, errors);
      break;
    case 'resolve_negative_income':
      validateStringArrayField(command, 'industryInstanceIds', errors, {
        min: 0,
        max: staticConfig.components.industryTilesPerPlayer,
      });
      break;
    case 'resolve_merchant_develop':
      validateIndustryTypeArrayField(command, 'industryTypes', errors, {
        min: 0,
        max: MAX_MERCHANT_DEVELOP_REMOVALS,
      });
      break;
    case 'loan':
    case 'pass':
      validateStringField(command, 'cardId', errors);
      break;
    case 'scout':
      validateStringArrayField(command, 'cardIds', errors, {exactly: 3});
      break;
  }
  return errors;
}

function snapshotCommandPayload(command: unknown): CommandPayload | undefined {
  try {
    const snapshot = structuredClone(command) as unknown;
    return isCommandEnvelope(snapshot) ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function parsePersistedGameStore(raw: string, storagePath: string): Partial<PersistedGameStore> {
  try {
    return JSON.parse(raw) as Partial<PersistedGameStore>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse game store file ${storagePath}: ${detail}`);
  }
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function normalizedTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : undefined;
}

function compareTimestampsDesc(left: string | undefined, right: string | undefined): number {
  return Date.parse(right ?? '') - Date.parse(left ?? '');
}

function latestTimestamp(...values: Array<string | undefined>): string {
  let latest = currentTimestamp();
  for (const value of values) {
    const timestamp = normalizedTimestamp(value);
    if (timestamp !== undefined && Date.parse(timestamp) > Date.parse(latest)) {
      latest = timestamp;
    }
  }
  return latest;
}

interface ExpectedBoardSlot {
  id: string;
  locationId: string;
  allowedIndustryTypes: IndustryType[];
}

function expectedBoardSlots(): Record<string, ExpectedBoardSlot> {
  const slots: Record<string, ExpectedBoardSlot> = {};

  for (const location of Object.values(staticConfig.locations)) {
    if (location.kind === 'city') {
      for (const slot of location.slots) {
        slots[slot.id] = {
          id: slot.id,
          locationId: location.id,
          allowedIndustryTypes: [...slot.allowedIndustryTypes],
        };
      }
      continue;
    }

    if (location.kind === 'farm_brewery') {
      const slotId = `${location.id}-brewery`;
      slots[slotId] = {
        id: slotId,
        locationId: location.id,
        allowedIndustryTypes: ['brewery'],
      };
    }
  }

  return slots;
}

function createEmptyBoardState(): BoardState {
  return {
    industryInstances: {},
    linkInstances: {},
    slots: {},
    linkLines: {},
    merchantSpaces: {},
  };
}

function resourceCapacityForIndustrySpec(spec: IndustryTileSpec, era: GameState['era']): number {
  const eraCapacity = spec.resourcesWhenBuilt?.[era];
  if (typeof eraCapacity === 'number' && Number.isFinite(eraCapacity)) {
    return Math.max(0, Math.floor(eraCapacity));
  }
  if (era === 'canal') {
    return 0;
  }
  return Math.max(
    0,
    ...Object.values(spec.resourcesWhenBuilt ?? {})
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );
}

function activeMerchantSpaceIds(playerCount: GameState['playerCount']): string[] {
  return Object.values(staticConfig.locations)
    .filter((location) => location.kind === 'merchant' && location.minPlayers <= playerCount)
    .flatMap((location) => location.kind === 'merchant'
      ? location.spaces
        .filter((space) => space.minPlayers <= playerCount)
        .map((space) => space.id)
      : []);
}

function merchantTileSpecId(merchantTileInstanceId: string): string {
  return merchantTileInstanceId.replace(/-\d+$/, '');
}

function nextMerchantTileInstanceId(specId: string, usedInstanceIds: Set<string>): string {
  let suffix = 0;
  let instanceId = `${specId}-${suffix}`;
  while (usedInstanceIds.has(instanceId)) {
    suffix++;
    instanceId = `${specId}-${suffix}`;
  }
  usedInstanceIds.add(instanceId);
  return instanceId;
}

function normalizeMerchantSpaces(game: GameState): void {
  const legacySpaces = isObjectMap(game.board.merchantSpaces) ? game.board.merchantSpaces : {};
  const activeSpaceIds = activeMerchantSpaceIds(game.playerCount);
  const usedInstanceIds = new Set<string>();
  const usedSpecIds = new Set<string>();
  const normalizedSpaces: BoardState['merchantSpaces'] = {};

  for (const spaceId of activeSpaceIds) {
    const legacySpace = legacySpaces[spaceId];
    const merchantTileInstanceId = isObjectMap(legacySpace)
      ? trimmedNonEmptyString(legacySpace.merchantTileInstanceId)
      : undefined;
    if (isObjectMap(legacySpace) && merchantTileInstanceId !== undefined) {
      const specId = merchantTileSpecId(merchantTileInstanceId);
      const spec = staticConfig.merchantTileSpecs[specId];
      if (spec && spec.minPlayers <= game.playerCount && !usedSpecIds.has(specId) && !usedInstanceIds.has(merchantTileInstanceId)) {
        normalizedSpaces[spaceId] = {
          id: spaceId,
          merchantTileInstanceId,
          beerPresent: typeof legacySpace.beerPresent === 'boolean' ? legacySpace.beerPresent : !spec.blank,
        };
        usedInstanceIds.add(merchantTileInstanceId);
        usedSpecIds.add(specId);
        continue;
      }
    }

    normalizedSpaces[spaceId] = {id: spaceId, beerPresent: false};
  }

  const availableSpecIds = Object.values(staticConfig.merchantTileSpecs)
    .filter((spec) => spec.minPlayers <= game.playerCount && !usedSpecIds.has(spec.id))
    .map((spec) => spec.id)
    .sort((a, b) => a.localeCompare(b));

  for (const space of Object.values(normalizedSpaces)) {
    if (space.merchantTileInstanceId) {
      continue;
    }
    const specId = availableSpecIds.shift();
    if (!specId) {
      continue;
    }
    const spec = staticConfig.merchantTileSpecs[specId];
    space.merchantTileInstanceId = nextMerchantTileInstanceId(specId, usedInstanceIds);
    space.beerPresent = !spec.blank;
    usedSpecIds.add(specId);
  }

  game.board.merchantSpaces = normalizedSpaces;
}

function normalizeBoardOccupancy(game: GameState): Set<string> {
  const invalidActiveIndustryIds = new Set<string>();
  if (!isObjectMap((game as Partial<GameState>).board)) {
    game.board = createEmptyBoardState();
  }
  if (!isObjectMap(game.board.industryInstances)) {
    game.board.industryInstances = {};
  }
  if (!isObjectMap(game.board.linkInstances)) {
    game.board.linkInstances = {};
  }
  if (!isObjectMap(game.board.slots)) {
    game.board.slots = {};
  }
  if (!isObjectMap(game.board.linkLines)) {
    game.board.linkLines = {};
  }
  normalizeMerchantSpaces(game);

  const expectedSlots = expectedBoardSlots();
  game.board.slots = Object.fromEntries(
    Object.keys(expectedSlots).map((slotId) => [slotId, {}]),
  );
  game.board.linkLines = Object.fromEntries(
    Object.keys(staticConfig.linkLines).map((linkLineId) => [linkLineId, {}]),
  );
  const normalizedIndustryInstances: BoardState['industryInstances'] = {};
  for (const [mapId, rawIndustry] of Object.entries(game.board.industryInstances)) {
    if (!isObjectMap(rawIndustry)) {
      continue;
    }
    const industry = rawIndustry as Partial<IndustryInstance> as IndustryInstance;
    const industryRecord = industry as unknown as Record<string, unknown>;
    const industryId = normalizeStringProperty(industryRecord, 'id') ?? trimmedNonEmptyString(mapId);
    if (!industryId) {
      continue;
    }
    industry.id = industryId;
    normalizeStringProperty(industryRecord, 'ownerPlayerId');
    normalizeStringProperty(industryRecord, 'industryType');
    normalizeStringProperty(industryRecord, 'specId');
    normalizeStringProperty(industryRecord, 'locationId');
    normalizeStringProperty(industryRecord, 'slotId');
    industry.removedFromGame = typeof industry.removedFromGame === 'boolean' ? industry.removedFromGame : false;
    normalizedIndustryInstances[industry.id] = industry;
  }
  game.board.industryInstances = normalizedIndustryInstances;

  const activeIndustries = Object.values(game.board.industryInstances)
    .filter((industry) => !industry.removedFromGame)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const industry of activeIndustries) {
    const slotSpec = expectedSlots[industry.slotId];
    const slot = slotSpec ? game.board.slots[industry.slotId] : undefined;
    const spec = staticConfig.industryTileSpecs[industry.specId];
    const validExceptEra = Boolean(
      slotSpec &&
      slot &&
      game.players[industry.ownerPlayerId] &&
      spec &&
      spec.industryType === industry.industryType &&
      industry.locationId === slotSpec.locationId &&
      slotSpec.allowedIndustryTypes.includes(industry.industryType) &&
      !slot.occupiedBy
    );
    const eraMismatch = Boolean(spec && !spec.buildableEras.includes(game.era));
    if (!validExceptEra || eraMismatch) {
      industry.removedFromGame = true;
      // Canal-only tiles found in otherwise valid Rail slots likely represent
      // missed cleanup of tiles that were actually built. Other invalid active
      // entries are ghosts and should not consume player stack tiles.
      const missedCanalCleanup = game.era === 'rail' && eraMismatch && validExceptEra;
      if (!missedCanalCleanup) {
        invalidActiveIndustryIds.add(industry.id);
      }
      continue;
    }
    if (!slot || !spec) {
      continue;
    }

    industry.level = spec.level;
    industry.flipped = typeof industry.flipped === 'boolean' ? industry.flipped : false;
    industry.remainingResource = integerInRange(
      industry.remainingResource,
      0,
      0,
      resourceCapacityForIndustrySpec(spec, game.era),
    );
    if (industry.flipped || (spec.flip.trigger === 'resource_depleted' && industry.remainingResource === 0)) {
      industry.flipped = true;
      industry.remainingResource = 0;
    }

    slot.occupiedBy = industry.id;
  }
  for (const industry of Object.values(game.board.industryInstances)) {
    if (industry.removedFromGame) {
      industry.remainingResource = 0;
    }
  }

  const normalizedLinkInstances: BoardState['linkInstances'] = {};
  for (const [mapId, rawLink] of Object.entries(game.board.linkInstances)) {
    if (!isObjectMap(rawLink)) {
      continue;
    }
    const link = rawLink as Partial<LinkInstance> as LinkInstance;
    const linkRecord = link as unknown as Record<string, unknown>;
    const linkId = normalizeStringProperty(linkRecord, 'id') ?? trimmedNonEmptyString(mapId);
    if (!linkId) {
      continue;
    }
    link.id = linkId;
    normalizeStringProperty(linkRecord, 'ownerPlayerId');
    normalizeStringProperty(linkRecord, 'linkType');
    normalizeStringProperty(linkRecord, 'linkLineId');
    normalizedLinkInstances[link.id] = link;
  }
  game.board.linkInstances = normalizedLinkInstances;

  const activeLinks = Object.values(game.board.linkInstances)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const link of activeLinks) {
    const lineState = game.board.linkLines[link.linkLineId];
    const lineSpec = staticConfig.linkLines[link.linkLineId];
    if (
      !lineState ||
      !lineSpec ||
      !game.players[link.ownerPlayerId] ||
      link.linkType !== game.era ||
      !lineSpec.allowedLinkTypes.includes(link.linkType) ||
      !isLinkLineActiveForPlayerCount(game, lineSpec) ||
      lineState.occupiedBy
    ) {
      delete game.board.linkInstances[link.id];
      continue;
    }

    lineState.occupiedBy = link.id;
  }

  return invalidActiveIndustryIds;
}

function normalizeCardZones(game: GameState): void {
  if (!isObjectMap((game as Partial<GameState>).cardZones)) {
    game.cardZones = {
      drawDeck: [],
      wildLocationPool: [],
      wildIndustryPool: [],
    };
  }

  const regularCardIds = new Set(getCardIdsForPlayerCount(game.playerCount));
  const wildLocationIds = new Set(getWildLocationCardIds());
  const wildIndustryIds = new Set(getWildIndustryCardIds());
  const claimed = new Set<string>();

  const normalizeCardList = (value: unknown, acceptsCard: (cardId: string) => boolean): string[] => {
    const normalized: string[] = [];
    if (!Array.isArray(value)) {
      return normalized;
    }

    for (const cardId of value) {
      if (typeof cardId !== 'string' || !acceptsCard(cardId) || claimed.has(cardId)) {
        continue;
      }
      claimed.add(cardId);
      normalized.push(cardId);
    }
    return normalized;
  };

  for (const playerId of playerIdsInSeatOrder(game)) {
    const player = game.players[playerId];
    player.handCardIds = normalizeCardList(
      player.handCardIds,
      (cardId) => regularCardIds.has(cardId) || wildLocationIds.has(cardId) || wildIndustryIds.has(cardId),
    );
  }

  for (const playerId of playerIdsInSeatOrder(game)) {
    const player = game.players[playerId];
    player.discardCardIds = normalizeCardList(player.discardCardIds, (cardId) => regularCardIds.has(cardId));
  }

  game.cardZones.drawDeck = normalizeCardList(game.cardZones.drawDeck, (cardId) => regularCardIds.has(cardId));
  game.cardZones.wildLocationPool = normalizeCardList(game.cardZones.wildLocationPool, (cardId) => wildLocationIds.has(cardId));
  game.cardZones.wildIndustryPool = normalizeCardList(game.cardZones.wildIndustryPool, (cardId) => wildIndustryIds.has(cardId));

  for (const cardId of [...regularCardIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.drawDeck.push(cardId);
    }
  }
  for (const cardId of [...wildLocationIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.wildLocationPool.push(cardId);
    }
  }
  for (const cardId of [...wildIndustryIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.wildIndustryPool.push(cardId);
    }
  }
}

interface TurnStateNormalization {
  loadedActionIndexWasValid: boolean;
}

function normalizeTurnState(game: GameState): TurnStateNormalization {
  const playerIds = playerIdsInSeatOrder(game);
  const validPlayerIds = new Set(playerIds);
  const normalizedTurnOrder: string[] = [];
  const seenPlayerIds = new Set<string>();
  const loadedTurnOrder = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  const loadedTurnIndex = (game as {currentTurnIndex?: unknown}).currentTurnIndex;
  const loadedCurrentPlayerId = typeof loadedTurnIndex === 'number' &&
    Number.isFinite(loadedTurnIndex) &&
    Math.floor(loadedTurnIndex) === loadedTurnIndex &&
    loadedTurnIndex >= 0 &&
    loadedTurnIndex < loadedTurnOrder.length
    ? trimmedNonEmptyString(loadedTurnOrder[loadedTurnIndex])
    : undefined;

  for (const loadedPlayerId of loadedTurnOrder) {
    const playerId = trimmedNonEmptyString(loadedPlayerId);
    if (playerId === undefined || !validPlayerIds.has(playerId) || seenPlayerIds.has(playerId)) {
      continue;
    }
    seenPlayerIds.add(playerId);
    normalizedTurnOrder.push(playerId);
  }

  for (const playerId of playerIds) {
    if (!seenPlayerIds.has(playerId)) {
      normalizedTurnOrder.push(playerId);
    }
  }

  game.turnOrder = normalizedTurnOrder;
  if (game.turnOrder.length === 0) {
    game.currentTurnIndex = 0;
    game.actionIndexInTurn = 0;
    return {loadedActionIndexWasValid: false};
  }

  const restoredCurrentIndex = typeof loadedCurrentPlayerId === 'string' && validPlayerIds.has(loadedCurrentPlayerId)
    ? game.turnOrder.indexOf(loadedCurrentPlayerId)
    : -1;
  game.currentTurnIndex = restoredCurrentIndex >= 0
    ? restoredCurrentIndex
    : typeof loadedTurnIndex === 'number' &&
    Number.isFinite(loadedTurnIndex) &&
    Math.floor(loadedTurnIndex) === loadedTurnIndex &&
    loadedTurnIndex >= 0 &&
    loadedTurnIndex < game.turnOrder.length
    ? loadedTurnIndex
    : 0;

  game.actionsAllowedThisTurn = game.era === 'canal' && game.roundNumber === 1
    ? staticConfig.rules.firstCanalRoundActions
    : staticConfig.rules.normalActionsPerTurn;

  const loadedActionIndex = (game as {actionIndexInTurn?: unknown}).actionIndexInTurn;
  const loadedActionIndexWasValid =
    typeof loadedActionIndex === 'number' &&
    Number.isFinite(loadedActionIndex) &&
    Number.isInteger(loadedActionIndex) &&
    loadedActionIndex >= 0 &&
    loadedActionIndex < game.actionsAllowedThisTurn;
  game.actionIndexInTurn = typeof loadedActionIndex === 'number' && Number.isFinite(loadedActionIndex)
    ? Math.max(0, Math.min(Math.floor(loadedActionIndex), game.actionsAllowedThisTurn - 1))
    : 0;
  return {loadedActionIndexWasValid};
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.floor(value), max));
}

function marketOccupiedCount(value: unknown, marketName: 'coal' | 'iron'): number {
  const config = staticConfig.markets[marketName];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return config.initialOccupiedCount;
  }
  return Math.min(value, config.priceSlotsCheapestToMostExpensive.length);
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function numericBoardInstanceSuffix(id: string): number | undefined {
  const match = /^(?:industry|link)-(\d+)$/.exec(id);
  if (!match) {
    return undefined;
  }
  const suffix = Number(match[1]);
  return Number.isSafeInteger(suffix) ? suffix : undefined;
}

function normalizeNextInstanceIdFromBoard(game: GameState): void {
  let nextInstanceId = game.nextInstanceId;
  for (const id of [
    ...Object.keys(game.board.industryInstances),
    ...Object.keys(game.board.linkInstances),
  ]) {
    const suffix = numericBoardInstanceSuffix(id);
    if (suffix !== undefined) {
      nextInstanceId = Math.max(nextInstanceId, suffix + 1);
    }
  }
  game.nextInstanceId = nextInstanceId;
}

function normalizeVariantState(game: GameState): void {
  if ((game as Partial<GameState>).variant !== 'introductory_canal_only' || game.era !== 'canal') {
    delete (game as Partial<GameState>).variant;
  }
}

function normalizeNumericState(game: GameState): void {
  if (game.era !== 'canal' && game.era !== 'rail') {
    game.era = 'canal';
  }
  if (game.status !== 'playing' && game.status !== 'ended') {
    game.status = 'playing';
  }
  normalizeVariantState(game);
  game.roundNumber = nonNegativeInteger(game.roundNumber, 1) || 1;
  game.nextInstanceId = nonNegativeInteger(game.nextInstanceId, 1) || 1;

  if (!isObjectMap((game as Partial<GameState>).markets)) {
    game.markets = {
      coal: {occupiedCount: staticConfig.markets.coal.initialOccupiedCount},
      iron: {occupiedCount: staticConfig.markets.iron.initialOccupiedCount},
    };
  }
  for (const marketName of ['coal', 'iron'] as const) {
    const market = isObjectMap(game.markets[marketName])
      ? game.markets[marketName]
      : {occupiedCount: staticConfig.markets[marketName].initialOccupiedCount};
    market.occupiedCount = marketOccupiedCount((market as {occupiedCount?: unknown}).occupiedCount, marketName);
    game.markets[marketName] = market;
  }

  for (const player of Object.values(game.players)) {
    player.cash = nonNegativeInteger(player.cash, staticConfig.rules.initialCash);
    player.victoryPoints = nonNegativeInteger(player.victoryPoints, 0);
    player.incomeTrackPosition = integerInRange(
      player.incomeTrackPosition,
      staticConfig.incomeTrack.startPosition,
      0,
      staticConfig.incomeTrack.positions.length - 1,
    );
    player.spentThisRound = nonNegativeInteger(player.spentThisRound, 0);

    if (!isObjectMap(player.remainingLinks)) {
      player.remainingLinks = {
        canal: staticConfig.rules.initialLinksPerType,
        rail: staticConfig.rules.initialLinksPerType,
      };
    }
    for (const linkType of ['canal', 'rail'] as const) {
      player.remainingLinks[linkType] = integerInRange(
        player.remainingLinks[linkType],
        staticConfig.rules.initialLinksPerType,
        0,
        staticConfig.rules.initialLinksPerType,
      );
    }
  }
}

function normalizeRemainingLinksFromBoard(game: GameState): void {
  const builtCounts = new Map<string, Record<LinkType, number>>();
  for (const playerId of Object.keys(game.players)) {
    builtCounts.set(playerId, {canal: 0, rail: 0});
  }

  for (const link of Object.values(game.board.linkInstances)) {
    const counts = builtCounts.get(link.ownerPlayerId);
    if (!counts) {
      continue;
    }
    counts[link.linkType]++;
  }

  for (const [playerId, player] of Object.entries(game.players)) {
    const counts = builtCounts.get(playerId) ?? {canal: 0, rail: 0};
    for (const linkType of ['canal', 'rail'] as const) {
      player.remainingLinks[linkType] = Math.max(0, staticConfig.rules.initialLinksPerType - counts[linkType]);
    }
  }
}

function normalizeScoreRecord(value: unknown, playerIds: string[]): Record<string, number> {
  const source = isObjectMap(value) ? value : {};
  const normalizedSource: Record<string, unknown> = {};
  for (const [rawPlayerId, score] of Object.entries(source)) {
    const playerId = trimmedNonEmptyString(rawPlayerId);
    if (playerId !== undefined && normalizedSource[playerId] === undefined) {
      normalizedSource[playerId] = score;
    }
  }
  return Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    nonNegativeInteger(normalizedSource[playerId], 0),
  ]));
}

function scoreBreakdownTotalsMatch(
  score: Pick<NonNullable<GameState['lastEraScore']>, 'linkVictoryPointsByPlayer' | 'industryVictoryPointsByPlayer' | 'totalVictoryPointsByPlayer'>,
  playerIds: readonly string[],
): boolean {
  return playerIds.every((playerId) =>
    score.totalVictoryPointsByPlayer[playerId] ===
    score.linkVictoryPointsByPlayer[playerId] + score.industryVictoryPointsByPlayer[playerId],
  );
}

function normalizeEventEraScore(value: unknown, playerIds: string[]): NonNullable<GameState['lastEraScore']> | undefined {
  const era = isObjectMap(value) ? trimmedNonEmptyString(value.era) : undefined;
  if (!isObjectMap(value) || (era !== 'canal' && era !== 'rail')) {
    return undefined;
  }
  const score: NonNullable<GameState['lastEraScore']> = {
    era,
    linkVictoryPointsByPlayer: normalizeScoreRecord(value.linkVictoryPointsByPlayer, playerIds),
    industryVictoryPointsByPlayer: normalizeScoreRecord(value.industryVictoryPointsByPlayer, playerIds),
    totalVictoryPointsByPlayer: normalizeScoreRecord(value.totalVictoryPointsByPlayer, playerIds),
  };
  return scoreBreakdownTotalsMatch(score, playerIds) ? score : undefined;
}

function normalizeLastEraScore(game: GameState): void {
  const score = (game as Partial<GameState>).lastEraScore;
  if (!isObjectMap(score) || (score.era !== 'canal' && score.era !== 'rail')) {
    game.lastEraScore = undefined;
    return;
  }

  const canKeepScore = game.status === 'ended'
    ? score.era === game.era
    : game.era === 'rail' && score.era === 'canal';
  if (!canKeepScore) {
    game.lastEraScore = undefined;
    return;
  }

  const playerIds = Object.keys(game.players);
  const normalizedScore: NonNullable<GameState['lastEraScore']> = {
    era: score.era,
    linkVictoryPointsByPlayer: normalizeScoreRecord(score.linkVictoryPointsByPlayer, playerIds),
    industryVictoryPointsByPlayer: normalizeScoreRecord(score.industryVictoryPointsByPlayer, playerIds),
    totalVictoryPointsByPlayer: normalizeScoreRecord(score.totalVictoryPointsByPlayer, playerIds),
  };
  game.lastEraScore = scoreBreakdownTotalsMatch(normalizedScore, playerIds)
    ? normalizedScore
    : undefined;
}

function normalizePlayersAndCount(game: GameState): void {
  const loadedPlayers = isObjectMap((game as Partial<GameState>).players) ? game.players : {};
  const normalizedPlayers: GameState['players'] = {};
  const entries: Array<[string, Record<string, unknown>]> = [];
  for (const [rawPlayerId, player] of Object.entries(loadedPlayers)) {
    const playerId = trimmedNonEmptyString(rawPlayerId);
    if (playerId === undefined || !supportedPlayerIdSet.has(playerId) || !isObjectMap(player)) {
      continue;
    }
    entries.push([playerId, player]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}));

  for (const [playerId, loadedPlayer] of entries) {
    if (normalizedPlayers[playerId]) {
      continue;
    }
    const player = loadedPlayer as unknown as GameState['players'][string];
    player.id = playerId;
    player.name = typeof player.name === 'string' && player.name.trim().length > 0
      ? player.name.trim()
      : `Player ${Number(playerId.slice(1))}`;
    player.handCardIds = Array.isArray(player.handCardIds) ? player.handCardIds : [];
    player.discardCardIds = Array.isArray(player.discardCardIds) ? player.discardCardIds : [];
    normalizedPlayers[playerId] = player;
    if (Object.keys(normalizedPlayers).length >= 4) {
      break;
    }
  }

  game.players = normalizedPlayers;
  const playerCount = Object.keys(game.players).length;
  game.playerCount = isPlayerCount(playerCount)
    ? playerCount
    : isPlayerCount(game.playerCount) ? game.playerCount : 2;
}

function merchantSpaceHasDevelopBonus(merchantSpaceId: string): boolean {
  return Object.values(staticConfig.locations).some((location) =>
    location.kind === 'merchant' &&
    location.bonus.type === 'develop' &&
    location.spaces.some((space) => space.id === merchantSpaceId),
  );
}

function merchantDevelopBonusCount(merchantSpaceId: string): number {
  const merchant = Object.values(staticConfig.locations).find((location) =>
    location.kind === 'merchant' &&
    location.spaces.some((space) => space.id === merchantSpaceId),
  );
  return merchant?.kind === 'merchant' && merchant.bonus.type === 'develop'
    ? merchant.bonus.count
    : 0;
}

function merchantDevelopBonusCapacity(merchantSpaceIds: readonly string[]): number {
  return merchantSpaceIds.reduce((sum, merchantSpaceId) => sum + merchantDevelopBonusCount(merchantSpaceId), 0);
}

function normalizeMerchantDevelopSpaceIds(game: GameState, decision: Record<string, unknown>, fallbackSpaceId: string): string[] {
  const candidateSpaceIds = [
    fallbackSpaceId,
    ...(Array.isArray(decision.merchantSpaceIds) ? decision.merchantSpaceIds : []),
  ];
  return [...new Set(candidateSpaceIds.map(trimmedNonEmptyString).filter((spaceId): spaceId is string =>
    spaceId !== undefined &&
    Boolean(game.board.merchantSpaces[spaceId]) &&
    merchantSpaceHasDevelopBonus(spaceId),
  ))];
}

function normalizePendingDecision(game: GameState, turnState: TurnStateNormalization): void {
  if (game.status !== 'playing') {
    game.pendingDecision = undefined;
    return;
  }

  const decision = (game as Partial<GameState>).pendingDecision;
  if (!isRecord(decision) || typeof decision.type !== 'string') {
    game.pendingDecision = undefined;
    return;
  }

  if (decision.type === 'negative_income') {
    const playerId = trimmedNonEmptyString(decision.playerId);
    const amountOwed = decision.amountOwed;
    if (playerId === undefined || !game.players[playerId] || typeof amountOwed !== 'number' || !Number.isFinite(amountOwed)) {
      game.pendingDecision = undefined;
      return;
    }

    const incomePlayerIndex = game.turnOrder.indexOf(playerId);
    const normalizedAmount = Math.floor(amountOwed);
    if (incomePlayerIndex < 0 || normalizedAmount <= 0) {
      game.pendingDecision = undefined;
      return;
    }

    game.currentTurnIndex = incomePlayerIndex;
    game.actionIndexInTurn = 0;
    game.pendingDecision = {
      type: 'negative_income',
      playerId,
      amountOwed: normalizedAmount,
      incomePlayerIndex,
    };
    return;
  }

  if (decision.type === 'merchant_develop') {
    const playerId = trimmedNonEmptyString(decision.playerId);
    const merchantSpaceId = trimmedNonEmptyString(decision.merchantSpaceId);
    const count = decision.count;
    if (
      playerId === undefined ||
      !game.players[playerId] ||
      merchantSpaceId === undefined ||
      !game.board.merchantSpaces[merchantSpaceId] ||
      !merchantSpaceHasDevelopBonus(merchantSpaceId) ||
      typeof count !== 'number' ||
      !Number.isFinite(count)
    ) {
      game.pendingDecision = undefined;
      return;
    }

    const currentTurnIndex = game.turnOrder.indexOf(playerId);
    const merchantSpaceIds = normalizeMerchantDevelopSpaceIds(game, decision, merchantSpaceId);
    const normalizedCount = Math.min(
      MAX_MERCHANT_DEVELOP_REMOVALS,
      merchantDevelopBonusCapacity(merchantSpaceIds),
      Math.floor(count),
    );
    if (currentTurnIndex < 0 || normalizedCount <= 0) {
      game.pendingDecision = undefined;
      return;
    }

    game.currentTurnIndex = currentTurnIndex;
    if (!turnState.loadedActionIndexWasValid) {
      game.actionIndexInTurn = 0;
    }
    game.pendingDecision = {
      type: 'merchant_develop',
      playerId,
      count: normalizedCount,
      merchantSpaceId,
      merchantSpaceIds,
    };
    return;
  }

  game.pendingDecision = undefined;
}

function stringSetFromArray(value: unknown): Set<string> {
  return new Set(Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []);
}

function consumedIndustrySpecIds(
  game: GameState,
  playerId: string,
  industryType: IndustryType,
  invalidActiveIndustryIds: Set<string>,
): Set<string> {
  const consumed = new Set<string>();
  for (const industry of Object.values(game.board.industryInstances)) {
    if (invalidActiveIndustryIds.has(industry.id)) {
      continue;
    }
    const spec = staticConfig.industryTileSpecs[industry.specId];
    if (
      industry.ownerPlayerId === playerId &&
      industry.industryType === industryType &&
      spec?.industryType === industryType
    ) {
      consumed.add(industry.specId);
    }
  }
  return consumed;
}

function normalizeEventLog(game: GameState): void {
  const normalizedEvents: GameState['eventLog'] = [];
  const playerIds = playerIdsInSeatOrder(game);
  const validPlayerIds = new Set(playerIds);
  const historicalLinkReferences = new Map<string, HistoricalLinkReferenceEntry>();
  let hasCreatedGameEvent = false;
  const endedEraEvents = new Set<GameState['era']>();
  let hasEndedGameEvent = false;
  const terminalEra = game.status === 'ended'
    ? game.variant === 'introductory_canal_only' ? 'canal' : 'rail'
    : undefined;
  let hasSeenTerminalEraEnd = terminalEra === undefined;
  let waitingForGameEndAfterTerminalEra = false;
  const discardedRegularCardKeys = new Set<string>();
  const builtIndustryInstanceIds = new Set<string>();
  const removedIndustryInstanceIds = new Set<string>();
  const flippedIndustryInstanceIds = new Set<string>();
  const soldIndustryInstanceIds = new Set<string>();
  const industryResourceConsumptionCounts = new Map<string, number>();
  const merchantBeerConsumptionCounts = new Map<string, number>();
  const resourceSoldToMarketCounts = new Map<string, number>();
  const builtLinkInstanceIds = new Set<string>();
  const scoredLinkKeys = new Set<string>();
  const scoredIndustryInstanceIdsThisEra = new Set<string>();
  const advancedTurnKeysThisEra = new Set<string>();
  let lastAdvancedRoundNumber = 0;
  const pendingMerchantBeerBonuses = new Map<string, number>();
  const pendingMerchantDevelopBonuses = new Map<string, number>();
  const claimedMerchantDevelopSpecIdsByPlayer = new Map<string, Set<string>>();
  let pendingMerchantBonusValueChange: MerchantBonusValueChangeEvent | undefined;
  let pendingIndustryFlipIncomeChange: PendingIndustryFlipIncomeChange | undefined;
  let pendingScoringVictoryPointChange: PendingScoringVictoryPointChange | undefined;
  let pendingBuildSpendResources: PendingBuildSpendResources | undefined;
  let pendingBuildSpendCash: PendingBuildSpendCash | undefined;
  let pendingNetworkSpendEvidence: PendingNetworkSpendEvidence | undefined;
  let pendingDevelopSpendEvidence: PendingDevelopSpendEvidence | undefined;
  let pendingLoanCashPlayerId: string | undefined;
  let pendingLoanIncomePlayerId: string | undefined;
  let pendingLoanDiscardPlayerId: string | undefined;
  let consecutiveScoutDiscards: Extract<GameEvent, {type: 'card_discarded'}>[] = [];
  let pendingNegativeIncomeStart:
    | {
      event: Extract<GameEvent, {type: 'negative_income_started'}>;
      normalizedEventIndex: number;
    }
    | undefined;
  const clearPendingLoanEvidence = () => {
    pendingLoanCashPlayerId = undefined;
    pendingLoanIncomePlayerId = undefined;
    pendingLoanDiscardPlayerId = undefined;
  };
  const clearScoutEvidence = () => {
    consecutiveScoutDiscards = [];
  };
  const clearActionSpendEvidence = () => {
    pendingBuildSpendResources = undefined;
    pendingNetworkSpendEvidence = undefined;
    pendingDevelopSpendEvidence = undefined;
  };
  const clearPendingBuildSpendCash = () => {
    pendingBuildSpendCash = undefined;
  };
  const clearPendingNegativeIncomeStart = () => {
    if (pendingNegativeIncomeStart !== undefined) {
      normalizedEvents.splice(pendingNegativeIncomeStart.normalizedEventIndex, 1);
      pendingNegativeIncomeStart = undefined;
    }
  };
  const appendActionSpendResourceCost = (event: Extract<GameEvent, {type: 'resource_consumed'}>) => {
    const marketCost = resourceMarketCostForActionSpend(event);
    if (event.reason === 'build') {
      pendingNetworkSpendEvidence = undefined;
      pendingDevelopSpendEvidence = undefined;
      pendingBuildSpendResources = pendingBuildSpendResources?.playerId === event.byPlayerId
        ? {playerId: event.byPlayerId, marketCost: pendingBuildSpendResources.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost};
      return;
    }
    if (event.reason === 'network') {
      pendingBuildSpendResources = undefined;
      pendingDevelopSpendEvidence = undefined;
      pendingNetworkSpendEvidence = pendingNetworkSpendEvidence?.playerId === event.byPlayerId
        ? {...pendingNetworkSpendEvidence, marketCost: pendingNetworkSpendEvidence.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost, linkCount: 0};
      return;
    }
    if (event.reason === 'develop' || event.reason === 'develop iron') {
      pendingBuildSpendResources = undefined;
      pendingNetworkSpendEvidence = undefined;
      pendingDevelopSpendEvidence = pendingDevelopSpendEvidence?.playerId === event.byPlayerId
        ? {playerId: event.byPlayerId, marketCost: pendingDevelopSpendEvidence.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost};
      return;
    }
    clearActionSpendEvidence();
  };
  const appendNetworkSpendLink = (event: Extract<GameEvent, {type: 'link_built'}>) => {
    const {ownerPlayerId, linkType} = event.instance;
    pendingBuildSpendResources = undefined;
    pendingDevelopSpendEvidence = undefined;
    pendingNetworkSpendEvidence = pendingNetworkSpendEvidence?.playerId === ownerPlayerId
      ? {
        playerId: ownerPlayerId,
        marketCost: pendingNetworkSpendEvidence.marketCost,
        linkCount: pendingNetworkSpendEvidence.linkCount + 1,
        linkType: pendingNetworkSpendEvidence.linkType ?? linkType,
      }
      : {playerId: ownerPlayerId, marketCost: 0, linkCount: 1, linkType};
    if (pendingNetworkSpendEvidence.linkType !== linkType) {
      pendingNetworkSpendEvidence = undefined;
    }
  };
  const recordActionEvidence = (event: GameEvent) => {
    if (event.type === 'cash_changed') {
      clearScoutEvidence();
      if (event.reason === 'loan' && event.delta === staticConfig.rules.loanCash) {
        pendingLoanCashPlayerId = event.playerId;
        pendingLoanIncomePlayerId = undefined;
        pendingLoanDiscardPlayerId = undefined;
      } else {
        clearPendingLoanEvidence();
      }
      return;
    }

    if (event.type === 'income_position_changed') {
      clearScoutEvidence();
      if (
        event.reason === 'loan' &&
        pendingLoanCashPlayerId === event.playerId &&
        event.to === retreatIncomeLevels(event.from, staticConfig.rules.loanIncomeLevelPenalty)
      ) {
        pendingLoanCashPlayerId = undefined;
        pendingLoanIncomePlayerId = event.playerId;
        pendingLoanDiscardPlayerId = undefined;
      } else {
        clearPendingLoanEvidence();
      }
      return;
    }

    if (event.type === 'card_discarded') {
      if (pendingLoanIncomePlayerId === event.playerId) {
        pendingLoanCashPlayerId = undefined;
        pendingLoanIncomePlayerId = undefined;
        pendingLoanDiscardPlayerId = event.playerId;
      } else {
        clearPendingLoanEvidence();
      }

      if (event.destination === 'discard') {
        consecutiveScoutDiscards = [...consecutiveScoutDiscards, event];
      } else {
        clearScoutEvidence();
      }
      return;
    }

    clearPendingLoanEvidence();
    clearScoutEvidence();
  };
  if (Array.isArray(game.eventLog)) {
    for (const event of game.eventLog) {
      if (!isRecord(event) || typeof event.type !== 'string') {
        continue;
      }
      const rawEvent = event as Record<string, unknown>;
      const type = event.type.trim();
      if (!isKnownGameEventType(type)) {
        continue;
      }

      let normalizedEvent: GameEvent | undefined;
      if (type === 'game_created') {
        if (hasCreatedGameEvent) {
          continue;
        }
        hasCreatedGameEvent = true;
        normalizedEvent = {type: 'game_created', gameId: game.id, playerIds};
      } else if (type === 'card_discarded') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const cardId = normalizedEventCardId(rawEvent.cardId);
        const destination = cardId === undefined ? undefined : discardDestinationForCard(cardId);
        const discardKey = playerId === undefined || cardId === undefined ? undefined : `${playerId}:${cardId}`;
        if (
          playerId === undefined ||
          cardId === undefined ||
          destination === undefined ||
          (
            destination === 'discard' &&
            discardKey !== undefined &&
            discardedRegularCardKeys.has(discardKey)
          )
        ) {
          continue;
        }
        if (destination === 'discard' && discardKey !== undefined) {
          discardedRegularCardKeys.add(discardKey);
        }
        normalizedEvent = {type: 'card_discarded', playerId, cardId, destination};
      } else if (type === 'cash_changed') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const delta = integerEventValue(rawEvent.delta);
        const reason = normalizedEventReason(rawEvent.reason);
        if (
          playerId === undefined ||
          delta === undefined ||
          reason === undefined ||
          !cashChangeReasonMatchesDelta(reason, delta)
        ) {
          continue;
        }
        normalizedEvent = {type: 'cash_changed', playerId, delta, reason};
      } else if (type === 'income_position_changed') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const from = integerEventValue(rawEvent.from);
        const to = integerEventValue(rawEvent.to);
        const reason = normalizedEventReason(rawEvent.reason);
        if (
          playerId === undefined ||
          from === undefined ||
          to === undefined ||
          reason === undefined ||
          !incomeChangeReasonMatchesMove(reason, from, to)
        ) {
          continue;
        }
        normalizedEvent = {type: 'income_position_changed', playerId, from, to, reason};
      } else if (type === 'industry_built') {
        const instance = normalizedEventIndustryInstance(rawEvent.instance, validPlayerIds);
        if (instance === undefined || builtIndustryInstanceIds.has(instance.id)) {
          continue;
        }
        builtIndustryInstanceIds.add(instance.id);
        normalizedEvent = {type: 'industry_built', instance};
      } else if (type === 'industry_removed') {
        const industryInstanceId = normalizedKnownIndustryInstanceId(rawEvent.industryInstanceId, game);
        const reason = normalizedIndustryRemovalReason(rawEvent.reason);
        if (
          industryInstanceId === undefined ||
          reason === undefined ||
          !industryIsRemoved(game, industryInstanceId) ||
          removedIndustryInstanceIds.has(industryInstanceId)
        ) {
          continue;
        }
        removedIndustryInstanceIds.add(industryInstanceId);
        normalizedEvent = {type: 'industry_removed', industryInstanceId, reason};
      } else if (type === 'industry_flipped') {
        const ownerPlayerId = normalizedEventPlayerId(rawEvent.ownerPlayerId, validPlayerIds);
        const industryInstanceId = ownerPlayerId === undefined
          ? undefined
          : normalizedKnownIndustryInstanceId(rawEvent.industryInstanceId, game, ownerPlayerId);
        if (
          industryInstanceId === undefined ||
          ownerPlayerId === undefined ||
          !industryIsFlipped(game, industryInstanceId) ||
          flippedIndustryInstanceIds.has(industryInstanceId)
        ) {
          continue;
        }
        flippedIndustryInstanceIds.add(industryInstanceId);
        normalizedEvent = {type: 'industry_flipped', industryInstanceId, ownerPlayerId};
      } else if (type === 'industry_sold') {
        const ownerPlayerId = normalizedEventPlayerId(rawEvent.ownerPlayerId, validPlayerIds);
        const industryInstanceId = ownerPlayerId === undefined
          ? undefined
          : normalizedKnownIndustryInstanceId(rawEvent.industryInstanceId, game, ownerPlayerId);
        const merchantSpaceId = normalizedKnownMerchantSpaceId(rawEvent.merchantSpaceId, game);
        const industry = industryInstanceId === undefined
          ? undefined
          : game.board.industryInstances[industryInstanceId];
        if (
          industryInstanceId === undefined ||
          ownerPlayerId === undefined ||
          merchantSpaceId === undefined ||
          industry === undefined ||
          !industryIsFlipped(game, industryInstanceId) ||
          !merchantSpaceAcceptsIndustry(game, merchantSpaceId, industry.industryType) ||
          soldIndustryInstanceIds.has(industryInstanceId)
        ) {
          continue;
        }
        soldIndustryInstanceIds.add(industryInstanceId);
        normalizedEvent = {type: 'industry_sold', industryInstanceId, ownerPlayerId, merchantSpaceId};
      } else if (type === 'resource_consumed') {
        const source = normalizedEventResourceSource(rawEvent.source, game);
        const byPlayerId = normalizedEventPlayerId(rawEvent.byPlayerId, validPlayerIds);
        const reason = normalizedEventReason(rawEvent.reason);
        const industryResourceConsumptionCount = source?.kind === 'industry_tile'
          ? industryResourceConsumptionCounts.get(source.industryInstanceId) ?? 0
          : 0;
        const industryResourceLimit = source?.kind === 'industry_tile'
          ? industryResourceConsumptionLimit(game, source.industryInstanceId)
          : 0;
        const merchantBeerKey = source?.kind === 'merchant_beer'
          ? merchantBeerConsumptionKey(source)
          : undefined;
        const merchantBeerConsumptionCount = merchantBeerKey === undefined
          ? 0
          : merchantBeerConsumptionCounts.get(merchantBeerKey) ?? 0;
        if (
          source === undefined ||
          byPlayerId === undefined ||
          reason === undefined ||
          !resourceConsumptionReasonMatchesSource(source, reason) ||
          (source.kind === 'industry_tile' && industryResourceConsumptionCount >= industryResourceLimit) ||
          (merchantBeerKey !== undefined && merchantBeerConsumptionCount >= 1)
        ) {
          continue;
        }
        if (source.kind === 'industry_tile') {
          industryResourceConsumptionCounts.set(source.industryInstanceId, industryResourceConsumptionCount + 1);
        } else if (merchantBeerKey !== undefined) {
          merchantBeerConsumptionCounts.set(merchantBeerKey, merchantBeerConsumptionCount + 1);
        }
        normalizedEvent = {type: 'resource_consumed', source, byPlayerId, reason};
      } else if (type === 'resource_sold_to_market') {
        const industryInstanceId = normalizedKnownIndustryInstanceId(rawEvent.industryInstanceId, game);
        const market = normalizedEventMarket(rawEvent.market);
        const cashReceived = nonNegativeIntegerEventValue(rawEvent.cashReceived);
        const industry = industryInstanceId === undefined
          ? undefined
          : game.board.industryInstances[industryInstanceId];
        const soldCount = industryInstanceId === undefined
          ? 0
          : resourceSoldToMarketCounts.get(industryInstanceId) ?? 0;
        if (
          industryInstanceId === undefined ||
          market === undefined ||
          cashReceived === undefined ||
          industry === undefined ||
          !isMarketSlotPrice(market, cashReceived) ||
          !resourceTypeMatchesIndustry(market, industry) ||
          soldCount >= resourceSoldToMarketLimit(industry)
        ) {
          continue;
        }
        resourceSoldToMarketCounts.set(industryInstanceId, soldCount + 1);
        normalizedEvent = {type: 'resource_sold_to_market', industryInstanceId, market, cashReceived};
      } else if (type === 'link_built') {
        const instance = normalizedEventLinkInstance(rawEvent.instance, validPlayerIds, game);
        if (instance === undefined || builtLinkInstanceIds.has(instance.id)) {
          continue;
        }
        builtLinkInstanceIds.add(instance.id);
        normalizedEvent = {type: 'link_built', instance};
      } else if (type === 'link_scored') {
        const linkInstanceId = trimmedNonEmptyString(rawEvent.linkInstanceId);
        const ownerPlayerId = normalizedEventPlayerId(rawEvent.ownerPlayerId, validPlayerIds);
        const points = nonNegativeIntegerEventValue(rawEvent.points);
        if (
          linkInstanceId === undefined ||
          !isGeneratedEventInstanceId(linkInstanceId, 'link') ||
          ownerPlayerId === undefined ||
          points === undefined ||
          !normalizedKnownLinkOwner(linkInstanceId, ownerPlayerId, game, historicalLinkReferences) ||
          !linkScoreMatchesRules(game, linkInstanceId, points, historicalLinkReferences) ||
          scoredLinkKeys.has(`${linkInstanceId}:${ownerPlayerId}`)
        ) {
          continue;
        }
        scoredLinkKeys.add(`${linkInstanceId}:${ownerPlayerId}`);
        normalizedEvent = {type: 'link_scored', linkInstanceId, ownerPlayerId, points};
      } else if (type === 'industry_scored') {
        const ownerPlayerId = normalizedEventPlayerId(rawEvent.ownerPlayerId, validPlayerIds);
        const industryInstanceId = ownerPlayerId === undefined
          ? undefined
          : normalizedKnownIndustryInstanceId(rawEvent.industryInstanceId, game, ownerPlayerId);
        const points = nonNegativeIntegerEventValue(rawEvent.points);
        if (
          industryInstanceId === undefined ||
          ownerPlayerId === undefined ||
          points === undefined ||
          !industryScoreMatchesRules(game, industryInstanceId, points) ||
          scoredIndustryInstanceIdsThisEra.has(industryInstanceId)
        ) {
          continue;
        }
        scoredIndustryInstanceIdsThisEra.add(industryInstanceId);
        normalizedEvent = {type: 'industry_scored', industryInstanceId, ownerPlayerId, points};
      } else if (type === 'merchant_bonus_claimed') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const merchantSpaceId = normalizedKnownMerchantSpaceId(rawEvent.merchantSpaceId, game);
        const bonus = normalizedMerchantBonus(rawEvent.bonus);
        const pendingMerchantBeerBonusCount = playerId === undefined || merchantSpaceId === undefined
          ? 0
          : pendingMerchantBeerBonuses.get(merchantBonusClaimKey(playerId, merchantSpaceId)) ?? 0;
        if (
          playerId === undefined ||
          merchantSpaceId === undefined ||
          bonus === undefined ||
          !merchantBonusMatchesSpace(merchantSpaceId, bonus) ||
          pendingMerchantBeerBonusCount <= 0
        ) {
          continue;
        }
        pendingMerchantBeerBonuses.set(
          merchantBonusClaimKey(playerId, merchantSpaceId),
          pendingMerchantBeerBonusCount - 1,
        );
        if (bonus.type === 'develop') {
          pendingMerchantDevelopBonuses.set(
            merchantBonusClaimKey(playerId, merchantSpaceId),
            (pendingMerchantDevelopBonuses.get(merchantBonusClaimKey(playerId, merchantSpaceId)) ?? 0) + bonus.count,
          );
        }
        normalizedEvent = {type: 'merchant_bonus_claimed', playerId, merchantSpaceId, bonus};
      } else if (type === 'merchant_develop_resolved') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const merchantSpaceId = normalizedKnownMerchantSpaceId(rawEvent.merchantSpaceId, game);
        const industryTypes = normalizedEventIndustryTypes(rawEvent.industryTypes);
        const specIds = industryTypes === undefined
          ? undefined
          : normalizedEventSpecIdsForIndustryTypes(rawEvent.specIds, industryTypes);
        const merchantSpaceIds = merchantSpaceId === undefined
          ? undefined
          : rawEvent.merchantSpaceIds === undefined
            ? [merchantSpaceId]
            : normalizedKnownMerchantSpaceIds(rawEvent.merchantSpaceIds, game, merchantSpaceId);
        const availableDevelopCount = playerId === undefined || merchantSpaceIds === undefined
          ? 0
          : merchantSpaceIds.reduce(
            (sum, candidateMerchantSpaceId) =>
              sum + (pendingMerchantDevelopBonuses.get(merchantBonusClaimKey(playerId, candidateMerchantSpaceId)) ?? 0),
            0,
          );
        const claimedMerchantDevelopSpecIds = playerId === undefined
          ? undefined
          : claimedMerchantDevelopSpecIdsByPlayer.get(playerId) ?? new Set<string>();
        const hasDuplicateMerchantDevelopSpecId = specIds === undefined || claimedMerchantDevelopSpecIds === undefined ||
          specIds.some((specId, index) => specIds.indexOf(specId) !== index || claimedMerchantDevelopSpecIds.has(specId));
        if (
          playerId === undefined ||
          merchantSpaceId === undefined ||
          !merchantSpaceHasDevelopBonus(merchantSpaceId) ||
          merchantSpaceIds === undefined ||
          industryTypes === undefined ||
          specIds === undefined ||
          claimedMerchantDevelopSpecIds === undefined ||
          !merchantDevelopResolutionMatchesPlayerStacks(game, playerId, industryTypes, specIds) ||
          hasDuplicateMerchantDevelopSpecId ||
          availableDevelopCount <= 0 ||
          industryTypes.length > availableDevelopCount ||
          (rawEvent.merchantSpaceIds !== undefined && !merchantSpaceIds.every(merchantSpaceHasDevelopBonus))
        ) {
          continue;
        }
        for (const specId of specIds) {
          claimedMerchantDevelopSpecIds.add(specId);
        }
        claimedMerchantDevelopSpecIdsByPlayer.set(playerId, claimedMerchantDevelopSpecIds);
        for (const candidateMerchantSpaceId of merchantSpaceIds) {
          pendingMerchantDevelopBonuses.delete(merchantBonusClaimKey(playerId, candidateMerchantSpaceId));
        }
        normalizedEvent = {
          type: 'merchant_develop_resolved',
          playerId,
          merchantSpaceId,
          merchantSpaceIds,
          industryTypes,
          specIds,
        };
      } else if (type === 'turn_advanced') {
        const currentPlayerId = normalizedEventPlayerId(rawEvent.currentPlayerId, validPlayerIds);
        const roundNumber = positiveIntegerEventValue(rawEvent.roundNumber);
        const turnKey = currentPlayerId === undefined || roundNumber === undefined
          ? undefined
          : `${roundNumber}:${currentPlayerId}`;
        if (
          currentPlayerId === undefined ||
          roundNumber === undefined ||
          roundNumber < lastAdvancedRoundNumber ||
          (turnKey !== undefined && advancedTurnKeysThisEra.has(turnKey))
        ) {
          continue;
        }
        lastAdvancedRoundNumber = roundNumber;
        if (turnKey !== undefined) {
          advancedTurnKeysThisEra.add(turnKey);
        }
        normalizedEvent = {type: 'turn_advanced', currentPlayerId, roundNumber};
      } else if (type === 'turn_order_updated') {
        const order = normalizedEventPlayerIds(rawEvent.order, validPlayerIds);
        if (order === undefined || !isCompletePlayerOrder(order, playerIds)) {
          continue;
        }
        normalizedEvent = {type: 'turn_order_updated', order};
      } else if (type === 'loan_taken') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        if (playerId === undefined || pendingLoanDiscardPlayerId !== playerId) {
          clearPendingLoanEvidence();
          clearScoutEvidence();
          continue;
        }
        normalizedEvent = {type: 'loan_taken', playerId};
      } else if (type === 'scouted') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        if (
          playerId === undefined ||
          consecutiveScoutDiscards.length !== 3 ||
          !consecutiveScoutDiscards.every((discardedEvent) => discardedEvent.playerId === playerId)
        ) {
          clearPendingLoanEvidence();
          clearScoutEvidence();
          continue;
        }
        normalizedEvent = {type: 'scouted', playerId};
      } else if (type === 'negative_income_started') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const amountOwed = positiveIntegerEventValue(rawEvent.amountOwed);
        const incomePlayerIndex = nonNegativeIntegerEventValue(rawEvent.incomePlayerIndex);
        if (
          playerId === undefined ||
          amountOwed === undefined ||
          incomePlayerIndex === undefined ||
          incomePlayerIndex >= game.turnOrder.length ||
          game.turnOrder[incomePlayerIndex] !== playerId ||
          pendingNegativeIncomeStart !== undefined
        ) {
          continue;
        }
        normalizedEvent = {type: 'negative_income_started', playerId, amountOwed, incomePlayerIndex};
        pendingNegativeIncomeStart = {event: normalizedEvent, normalizedEventIndex: normalizedEvents.length};
      } else if (type === 'negative_income_resolved') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const amountOwed = positiveIntegerEventValue(rawEvent.amountOwed);
        const paid = nonNegativeIntegerEventValue(rawEvent.paid);
        const victoryPointLoss = nonNegativeIntegerEventValue(rawEvent.victoryPointLoss);
        const industryInstanceIds = playerId === undefined
          ? undefined
          : normalizedOwnedIndustryEventIds(rawEvent.industryInstanceIds, game, playerId);
        if (
          playerId === undefined ||
          amountOwed === undefined ||
          paid === undefined ||
          victoryPointLoss === undefined ||
          industryInstanceIds === undefined ||
          pendingNegativeIncomeStart === undefined ||
          pendingNegativeIncomeStart.event.playerId !== playerId ||
          pendingNegativeIncomeStart.event.amountOwed !== amountOwed ||
          !negativeIncomeResolutionMatchesRules(game, industryInstanceIds, amountOwed, paid, victoryPointLoss)
        ) {
          continue;
        }
        normalizedEvent = {
          type: 'negative_income_resolved',
          playerId,
          amountOwed,
          paid,
          victoryPointLoss,
          industryInstanceIds,
        };
        pendingNegativeIncomeStart = undefined;
      } else if (type === 'victory_points_changed') {
        const playerId = normalizedEventPlayerId(rawEvent.playerId, validPlayerIds);
        const delta = integerEventValue(rawEvent.delta);
        const reason = normalizedEventReason(rawEvent.reason);
        if (
          playerId === undefined ||
          delta === undefined ||
          reason === undefined ||
          !victoryPointReasonMatchesDelta(reason, delta)
        ) {
          continue;
        }
        normalizedEvent = {type: 'victory_points_changed', playerId, delta, reason};
      } else if (type === 'era_ended') {
        const era = trimmedNonEmptyString(rawEvent.era);
        const score = normalizeEventEraScore(rawEvent.score, playerIds);
        if (
          (era !== 'canal' && era !== 'rail') ||
          score === undefined ||
          score.era !== era ||
          endedEraEvents.has(era)
        ) {
          continue;
        }
        endedEraEvents.add(era);
        normalizedEvent = {type: 'era_ended', era, score};
      } else if (type === 'game_ended') {
        const winners = normalizedGameEndedWinners(rawEvent.winners, game, validPlayerIds);
        if (winners === undefined || hasEndedGameEvent || !hasSeenTerminalEraEnd) {
          continue;
        }
        hasEndedGameEvent = true;
        normalizedEvent = {type: 'game_ended', winners};
      }

      if (normalizedEvent === undefined) {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        clearPendingBuildSpendCash();
        clearActionSpendEvidence();
        continue;
      }

      if (waitingForGameEndAfterTerminalEra && normalizedEvent.type !== 'game_ended') {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        clearPendingBuildSpendCash();
        clearActionSpendEvidence();
        continue;
      }

      if (
        pendingNegativeIncomeStart !== undefined &&
        !isNegativeIncomePendingEvidenceEvent(normalizedEvent, game, pendingNegativeIncomeStart.event)
      ) {
        clearPendingNegativeIncomeStart();
      }

      if (isLifecycleBoundaryEvent(normalizedEvent)) {
        pendingMerchantBeerBonuses.clear();
        pendingMerchantDevelopBonuses.clear();
      }

      if (
        pendingBuildSpendCash !== undefined &&
        normalizedEvent.type !== 'industry_built' &&
        !(normalizedEvent.type === 'industry_removed' && normalizedEvent.reason === 'overbuild')
      ) {
        clearPendingBuildSpendCash();
      }

      if (normalizedEvent.type === 'resource_consumed') {
        clearPendingBuildSpendCash();
        appendActionSpendResourceCost(normalizedEvent);
      } else if (normalizedEvent.type === 'link_built') {
        clearPendingBuildSpendCash();
        appendNetworkSpendLink(normalizedEvent);
      } else if (isActionSpendCashEvent(normalizedEvent)) {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        if (normalizedEvent.reason === 'build') {
          pendingBuildSpendCash = {
            event: normalizedEvent,
            marketCost: pendingBuildSpendResources?.playerId === normalizedEvent.playerId
              ? pendingBuildSpendResources.marketCost
              : 0,
          };
          clearActionSpendEvidence();
          continue;
        }
        if (normalizedEvent.reason === 'network') {
          const baseSpend = pendingNetworkSpendEvidence?.playerId === normalizedEvent.playerId
            ? networkBaseSpend(pendingNetworkSpendEvidence.linkCount, pendingNetworkSpendEvidence.linkType)
            : undefined;
          const totalSpend = baseSpend === undefined
            ? undefined
            : baseSpend + (pendingNetworkSpendEvidence?.marketCost ?? 0);
          clearActionSpendEvidence();
          if (totalSpend === undefined || normalizedEvent.delta !== -totalSpend) {
            continue;
          }
        } else {
          const marketCost = pendingDevelopSpendEvidence?.playerId === normalizedEvent.playerId
            ? pendingDevelopSpendEvidence.marketCost
            : undefined;
          clearActionSpendEvidence();
          if (marketCost === undefined || marketCost <= 0 || normalizedEvent.delta !== -marketCost) {
            continue;
          }
        }
      } else if (normalizedEvent.type === 'industry_built') {
        if (
          pendingBuildSpendCash !== undefined &&
          buildSpendCashMatchesIndustry(pendingBuildSpendCash, normalizedEvent)
        ) {
          normalizedEvents.push(pendingBuildSpendCash.event);
          recordActionEvidence(pendingBuildSpendCash.event);
        }
        clearPendingBuildSpendCash();
        clearActionSpendEvidence();
      } else if (!(normalizedEvent.type === 'industry_removed' && normalizedEvent.reason === 'overbuild')) {
        clearActionSpendEvidence();
      }

      if (isMerchantBonusValueChangeEvent(normalizedEvent)) {
        pendingMerchantBonusValueChange = normalizedEvent;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        continue;
      }

      const industryFlipIncomeChange = industryFlipIncomeChangeForEvent(normalizedEvent);
      if (industryFlipIncomeChange !== undefined) {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = industryFlipIncomeChange;
        pendingScoringVictoryPointChange = undefined;
        continue;
      }

      const scoringVictoryPointChange = scoringVictoryPointChangeForEvent(normalizedEvent);
      if (scoringVictoryPointChange !== undefined) {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = scoringVictoryPointChange;
        continue;
      }

      if (normalizedEvent.type === 'merchant_bonus_claimed') {
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        if (
          pendingMerchantBonusValueChange !== undefined &&
          merchantBonusValueChangeMatchesClaim(pendingMerchantBonusValueChange, normalizedEvent)
        ) {
          normalizedEvents.push(pendingMerchantBonusValueChange);
          recordActionEvidence(pendingMerchantBonusValueChange);
        }
        pendingMerchantBonusValueChange = undefined;
      } else if (normalizedEvent.type === 'industry_flipped') {
        pendingMerchantBonusValueChange = undefined;
        pendingScoringVictoryPointChange = undefined;
        if (
          pendingIndustryFlipIncomeChange !== undefined &&
          industryFlipIncomeChangeMatchesFlip(pendingIndustryFlipIncomeChange, normalizedEvent, game)
        ) {
          normalizedEvents.push(pendingIndustryFlipIncomeChange.event);
          recordActionEvidence(pendingIndustryFlipIncomeChange.event);
        }
        pendingIndustryFlipIncomeChange = undefined;
      } else if (normalizedEvent.type === 'link_scored' || normalizedEvent.type === 'industry_scored') {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        if (
          pendingScoringVictoryPointChange !== undefined &&
          scoringVictoryPointChangeMatchesScore(pendingScoringVictoryPointChange, normalizedEvent)
        ) {
          normalizedEvents.push(pendingScoringVictoryPointChange.event);
          recordActionEvidence(pendingScoringVictoryPointChange.event);
        }
        pendingScoringVictoryPointChange = undefined;
      } else {
        pendingMerchantBonusValueChange = undefined;
        pendingIndustryFlipIncomeChange = undefined;
        pendingScoringVictoryPointChange = undefined;
      }

      normalizedEvents.push(normalizedEvent);
      recordActionEvidence(normalizedEvent);
      if (normalizedEvent.type === 'link_built') {
        recordHistoricalLinkReference(historicalLinkReferences, normalizedEvent.instance);
      } else if (normalizedEvent.type === 'game_ended') {
        break;
      } else if (normalizedEvent.type === 'era_ended') {
        pendingMerchantBeerBonuses.clear();
        pendingMerchantDevelopBonuses.clear();
        if (normalizedEvent.era === 'canal') {
          discardedRegularCardKeys.clear();
          scoredIndustryInstanceIdsThisEra.clear();
          advancedTurnKeysThisEra.clear();
          lastAdvancedRoundNumber = 0;
          merchantBeerConsumptionCounts.clear();
        }
        if (normalizedEvent.era === terminalEra) {
          hasSeenTerminalEraEnd = true;
          waitingForGameEndAfterTerminalEra = true;
        }
      } else if (
        normalizedEvent.type === 'resource_consumed' &&
        normalizedEvent.source.kind === 'merchant_beer'
      ) {
        const key = merchantBonusClaimKey(normalizedEvent.byPlayerId, normalizedEvent.source.merchantSpaceId);
        pendingMerchantBeerBonuses.set(key, (pendingMerchantBeerBonuses.get(key) ?? 0) + 1);
      }
    }
  }
  game.eventLog = normalizedEvents;
}

function isRecoverableLoadedGame(value: unknown): value is GameState {
  return isObjectMap(value) && typeof value.id === 'string' && value.id.trim().length > 0;
}

function hasSupportedPlayerSet(game: GameState): boolean {
  const playerIds = playerIdsInSeatOrder(game);
  return isPlayerCount(playerIds.length) &&
    playerIds.join('|') === expectedPlayerIdsForCount(playerIds.length).join('|');
}

function normalizeLoadedGame(game: GameState): GameState {
  game.id = game.id.trim();
  normalizePlayersAndCount(game);
  normalizeNumericState(game);
  const invalidActiveIndustryIds = normalizeBoardOccupancy(game);
  normalizeNextInstanceIdFromBoard(game);
  normalizeRemainingLinksFromBoard(game);
  normalizeCardZones(game);
  const turnState = normalizeTurnState(game);
  normalizePendingDecision(game, turnState);
  normalizeEventLog(game);
  normalizeLastEraScore(game);

  for (const [playerId, player] of Object.entries(game.players)) {
    if (!isObjectMap(player.industryTileStacks)) {
      player.industryTileStacks = {} as GameState['players'][string]['industryTileStacks'];
    }
    for (const industryType of INDUSTRY_TYPES) {
      const staticSpecIds = staticConfig.industryStackSpecIds[industryType];
      const loadedStack = isObjectMap(player.industryTileStacks[industryType])
        ? player.industryTileStacks[industryType]
        : undefined;
      const availableSource = Array.isArray(loadedStack?.availableSpecIdsInOrder)
        ? stringSetFromArray(loadedStack.availableSpecIdsInOrder)
        : new Set(staticSpecIds);
      const removedSource = stringSetFromArray(loadedStack?.removedSpecIds);
      const consumedSpecIds = consumedIndustrySpecIds(game, playerId, industryType, invalidActiveIndustryIds);

      player.industryTileStacks[industryType] = {
        availableSpecIdsInOrder: staticSpecIds.filter((specId) =>
          availableSource.has(specId) && !removedSource.has(specId) && !consumedSpecIds.has(specId),
        ),
        removedSpecIds: staticSpecIds.filter((specId) => removedSource.has(specId) && !consumedSpecIds.has(specId)),
        builtInstanceIds: [],
      };
    }

    const maxFaceDownDiscards = game.era === 'canal' ? Math.min(1, player.discardCardIds.length) : 0;
    const loadedCount = (player as {faceDownDiscardCount?: unknown}).faceDownDiscardCount;
    player.faceDownDiscardCount = typeof loadedCount === 'number' && Number.isFinite(loadedCount)
      ? Math.max(0, Math.min(Math.floor(loadedCount), maxFaceDownDiscards))
      : maxFaceDownDiscards;
  }

  for (const industry of Object.values(game.board.industryInstances)) {
    if (industry.removedFromGame) {
      continue;
    }
    const owner = game.players[industry.ownerPlayerId];
    const stack = owner?.industryTileStacks[industry.industryType];
    if (stack) {
      stack.builtInstanceIds.push(industry.id);
    }
  }
  return game;
}

function cloneGame(game: GameState): GameState {
  return structuredClone(game) as GameState;
}

function normalizeRuntimeState(game: GameState, gameId: string): void {
  game.id = gameId;
  const createdAt = normalizedTimestamp((game as {createdAt?: unknown}).createdAt) ?? currentTimestamp();
  const updatedAt = normalizedTimestamp((game as {updatedAt?: unknown}).updatedAt) ?? createdAt;
  game.createdAt = createdAt;
  game.updatedAt = Date.parse(updatedAt) < Date.parse(createdAt) ? createdAt : updatedAt;
  normalizeVariantState(game);
  const turnState = normalizeTurnState(game);
  normalizePendingDecision(game, turnState);
}

export class GameStore {
  private readonly games = new Map<string, GameState>();
  private readonly sessions = new Map<string, Map<string, string>>();
  private readonly storagePath?: string;

  constructor(options: GameStoreOptions = {}) {
    this.storagePath = options.storagePath;
    this.load();
  }

  create(input: CreateStoredGameInput): GameState {
    const seed = validateGameSeed(input.seed);
    const game = createGame({
      id: randomUUID(),
      playerNames: input.playerNames.map((name, index) => name.trim() || `Player ${index + 1}`),
      seed,
      introductoryCanalOnly: input.introductoryCanalOnly,
    });
    const createdAt = currentTimestamp();
    game.createdAt = createdAt;
    game.updatedAt = createdAt;
    this.games.set(game.id, game);
    this.sessions.set(game.id, this.createSessionsForGame(game));
    try {
      this.persist();
    } catch (error) {
      this.games.delete(game.id);
      this.sessions.delete(game.id);
      throw error;
    }
    return game;
  }

  get(id: string): GameState | undefined {
    const gameId = trimmedNonEmptyString(id);
    if (!gameId) {
      return undefined;
    }
    const game = this.games.get(gameId);
    if (game) {
      normalizeRuntimeState(game, gameId);
    }
    return game;
  }

  getPlayerSessions(gameId: string): PlayerSession[] {
    const normalizedGameId = trimmedNonEmptyString(gameId);
    const game = normalizedGameId ? this.games.get(normalizedGameId) : undefined;
    const sessions = normalizedGameId ? this.sessions.get(normalizedGameId) : undefined;
    if (!game || !sessions) {
      return [];
    }
    return playerIdsInSeatOrder(game).flatMap((playerId) => {
      const token = trimmedNonEmptyString(sessions.get(playerId));
      return token ? [{playerId, token}] : [];
    });
  }

  getPlayerSession(gameId: string, playerId: string): PlayerSession | undefined {
    const normalizedGameId = trimmedNonEmptyString(gameId);
    const normalizedPlayerId = trimmedNonEmptyString(playerId);
    const game = normalizedGameId ? this.games.get(normalizedGameId) : undefined;
    if (!normalizedGameId || !normalizedPlayerId || !game || !playerIdsInSeatOrder(game).includes(normalizedPlayerId)) {
      return undefined;
    }
    const token = trimmedNonEmptyString(this.sessions.get(normalizedGameId)?.get(normalizedPlayerId));
    return token ? {playerId: normalizedPlayerId, token} : undefined;
  }

  verifyPlayerSession(gameId: string, playerId: string, token: string | undefined): boolean {
    const session = this.getPlayerSession(gameId, playerId);
    const normalizedToken = trimmedNonEmptyString(token);
    return Boolean(normalizedToken && session?.token === normalizedToken);
  }

  list(): GameSummary[] {
    return [...this.games.entries()].map(([storedGameId, game]) => {
      normalizeRuntimeState(game, storedGameId);
      const currentPlayerId = publicCurrentPlayerId(game);
      const pendingDecision = publicPendingDecisionSummary(game);
      const winners = publicGameWinners(game);
      const victoryPointsByPlayer = publicVictoryPointsByPlayer(game);
      const era = publicEra(game);
      const status = publicStatus(game);
      const variant = game.variant === 'introductory_canal_only' && era === 'canal'
        ? game.variant
        : undefined;
      return {
        id: storedGameId,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        playerNames: playerIdsInSeatOrder(game).map((playerId) => publicPlayerName(playerId, game.players[playerId])),
        playerCount: publicPlayerCount(game),
        roundNumber: publicRoundNumber(game),
        era,
        status,
        ...(variant ? {variant} : {}),
        ...(currentPlayerId ? {currentPlayerId} : {}),
        ...(pendingDecision ? {pendingDecision} : {}),
        ...(winners ? {winners} : {}),
        ...(victoryPointsByPlayer ? {victoryPointsByPlayer} : {}),
      };
    }).sort((left, right) =>
      compareTimestampsDesc(this.games.get(left.id)?.updatedAt, this.games.get(right.id)?.updatedAt) ||
      compareTimestampsDesc(this.games.get(left.id)?.createdAt, this.games.get(right.id)?.createdAt) ||
      left.id.localeCompare(right.id),
    );
  }

  apply(gameId: string, command: unknown, token?: string): CommandResult {
    const normalizedGameId = trimmedNonEmptyString(gameId);
    if (!normalizedGameId) {
      return {ok: false, errors: [`Unknown game: ${gameId}`]};
    }
    const game = this.games.get(normalizedGameId);
    if (!game) {
      return {ok: false, errors: [`Unknown game: ${gameId}`]};
    }
    const commandSnapshot = snapshotCommandPayload(command);
    if (!commandSnapshot) {
      return {ok: false, errors: ['Malformed command']};
    }
    const normalizedCommand = normalizeCommandEnvelope(commandSnapshot);
    const envelopeErrors = validateCommandEnvelopeFields(normalizedCommand);
    if (envelopeErrors.length > 0) {
      return {ok: false, errors: envelopeErrors};
    }
    if (!this.verifyPlayerSession(normalizedGameId, normalizedCommand.playerId, token)) {
      return {ok: false, errors: [`Invalid session for ${normalizedCommand.playerId}`]};
    }
    const shapeErrors = validateCommandPayloadShape(normalizedCommand);
    if (shapeErrors.length > 0) {
      return {ok: false, errors: shapeErrors};
    }

    try {
      const gameCommand = normalizedCommand as unknown as GameCommand;
      const candidate = cloneGame(game);
      normalizeRuntimeState(candidate, normalizedGameId);
      const validation = validateCommand(candidate, gameCommand);
      if (!validation.ok) {
        return {ok: false, errors: validation.errors};
      }

      applyCommand(candidate, gameCommand);
      candidate.updatedAt = latestTimestamp(candidate.updatedAt, candidate.createdAt);
      this.games.set(normalizedGameId, candidate);
      try {
        this.persist();
      } catch (error) {
        this.games.set(normalizedGameId, game);
        throw error;
      }
      return {ok: true, state: candidate};
    } catch (error) {
      return {ok: false, errors: [error instanceof Error ? error.message : String(error)]};
    }
  }

  private createSessionsForGame(game: GameState): Map<string, string> {
    return new Map(playerIdsInSeatOrder(game).map((playerId) => [playerId, randomUUID()]));
  }

  private normalizeSessionsForGame(game: GameState, persistedSessions: unknown): Map<string, string> {
    const playerIds = playerIdsInSeatOrder(game);
    if (!Array.isArray(persistedSessions)) {
      return this.createSessionsForGame(game);
    }

    const loadedSessions = new Map<string, string>();
    const loadedTokens = new Set<string>();
    const validPlayerIds = new Set(playerIds);
    for (const session of persistedSessions) {
      const playerId = isObjectMap(session) && typeof session.playerId === 'string'
        ? session.playerId.trim()
        : undefined;
      const token = isObjectMap(session) && typeof session.token === 'string' && session.token.trim().length > 0
        ? session.token.trim()
        : undefined;
      if (
        playerId &&
        token &&
        validPlayerIds.has(playerId) &&
        !loadedSessions.has(playerId) &&
        !loadedTokens.has(token)
      ) {
        loadedSessions.set(playerId, token);
        loadedTokens.add(token);
      }
    }

    const sessions = new Map<string, string>();
    for (const playerId of playerIds) {
      sessions.set(playerId, loadedSessions.get(playerId) ?? randomUUID());
    }
    return sessions;
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }
    const raw = fs.readFileSync(this.storagePath, 'utf8');
    const parsed = parsePersistedGameStore(raw, this.storagePath);
    if (parsed.version !== 1 || !Array.isArray(parsed.games)) {
      throw new Error(`Unsupported game store file: ${this.storagePath}`);
    }
    this.games.clear();
    this.sessions.clear();
    for (const loadedGame of parsed.games) {
      if (!isRecoverableLoadedGame(loadedGame)) {
        continue;
      }
      const loadedGameId = loadedGame.id;
      const game = normalizeLoadedGame(loadedGame);
      if (!hasSupportedPlayerSet(game)) {
        continue;
      }
      if (this.games.has(game.id)) {
        continue;
      }
      const persistedSessions = parsed.sessions?.[loadedGameId] ?? parsed.sessions?.[game.id];
      this.games.set(game.id, game);
      this.sessions.set(game.id, this.normalizeSessionsForGame(game, persistedSessions));
    }
  }

  private persist(): void {
    if (!this.storagePath) {
      return;
    }
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, {recursive: true});
    const payload: PersistedGameStore = {
      version: 1,
      games: [...this.games.entries()].map(([gameId, game]) => {
        const persistedGame = cloneGame(game);
        normalizeRuntimeState(persistedGame, gameId);
        return persistedGame;
      }),
      sessions: Object.fromEntries([...this.games.keys()].map((gameId) => [
        gameId,
        this.getPlayerSessions(gameId),
      ])),
    };
    const temporaryPath = `${this.storagePath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2));
      fs.renameSync(temporaryPath, this.storagePath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, {force: true});
      } catch {
        // Preserve the original persistence error for callers.
      }
      throw error;
    }
  }
}

export const gameStore = new GameStore({
  storagePath: process.env.BRASS_GAME_STORE_PATH ?? path.join(process.cwd(), 'data', 'games.json'),
});
