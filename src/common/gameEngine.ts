import {advanceIncomeSpaces, getIncomeLevel, retreatIncomeLevels} from './income';
import {
  areConnected,
  connectedComponent,
  getActiveLinks,
  getActiveIndustries,
  getCurrentPlayerId,
  getIndustriesAtLocation,
  getLinkLineOrThrow,
  getLocationOrThrow,
  getNeighborLocations,
  getPlayerIndustriesAtLocation,
  hasAnyPlayerNetwork,
  hasCoalMarketAccess,
  isActiveIndustryInstance,
  isActiveLinkInstance,
  isInPlayerNetwork,
  linkLineTouchesLocation,
} from './selectors';
import {staticConfig} from './staticData';
import {SeededRandom, shuffle} from './random';
import type {
  BuildCommand,
  DevelopCommand,
  EraScoreBreakdown,
  GameCommand,
  GameEvent,
  GameState,
  IndustryInstance,
  IndustryTileSpec,
  IndustryType,
  LinkInstance,
  LinkLineSpec,
  LinkType,
  MerchantSpec,
  MarketState,
  NetworkCommand,
  ResolveMerchantDevelopCommand,
  ResourceSource,
  ResolveNegativeIncomeCommand,
  ScoutCommand,
  SellCommand,
  SellStep,
  ValidationResult,
} from './types';

interface ResourceCandidate {
  source: ResourceSource;
  distance: number;
  price: number;
}

interface ResourceSelectionResult {
  ok: boolean;
  errors: string[];
  sources: ResourceSource[];
  marketCash: number;
}

interface ResourceSelectionTracker {
  usedSources: Map<string, number>;
  marketConsumed: Record<'coal' | 'iron', number>;
}

interface BeerSelectionTracker {
  usedSources: Map<string, number>;
}

export interface SaleBeerSourceSelection {
  playerId: string;
  saleLocationId: string;
  merchantSpaceId: string;
  selectedSources: Array<ResourceSource | undefined>;
}

const SELLABLE_INDUSTRIES = new Set<IndustryType>(['cotton_mill', 'manufacturer', 'pottery']);
type ResourceAnchor = string | string[];
type IndustryRemovalReason = Extract<GameEvent, {type: 'industry_removed'}>['reason'];

function ok(): ValidationResult {
  return {ok: true, errors: []};
}

function fail(...errors: string[]): ValidationResult {
  return {ok: false, errors};
}

function pushEvent(state: GameState, event: GameEvent): void {
  state.eventLog.push(structuredClone(event) as GameEvent);
}

function nextInstanceId(state: GameState, prefix: string): string {
  const id = `${prefix}-${state.nextInstanceId}`;
  state.nextInstanceId++;
  return id;
}

function getPlayerOrError(state: GameState, playerId: string) {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player;
}

function validateActingPlayer(state: GameState, playerId: string): ValidationResult {
  if (state.status !== 'playing') {
    return fail('Game is not active');
  }
  if (state.pendingDecision) {
    return fail('Pending decision must be resolved first');
  }
  if (getCurrentPlayerId(state) !== playerId) {
    return fail(`It is ${getCurrentPlayerId(state)}'s turn`);
  }
  return ok();
}

function requireCardInHand(state: GameState, playerId: string, cardId: string): ValidationResult {
  const player = getPlayerOrError(state, playerId);
  if (!player.handCardIds.includes(cardId)) {
    return fail(`Player ${playerId} does not have card ${cardId}`);
  }
  return ok();
}

function requireKnownCardInHand(state: GameState, playerId: string, cardId: string): ValidationResult {
  const inHand = requireCardInHand(state, playerId, cardId);
  if (!inHand.ok) {
    return inHand;
  }
  if (!staticConfig.cardSpecs[cardId]) {
    return fail(`Unknown card: ${cardId}`);
  }
  return ok();
}

function getCard(cardId: string) {
  const card = staticConfig.cardSpecs[cardId];
  if (!card) {
    throw new Error(`Unknown card: ${cardId}`);
  }
  return card;
}

function discardCard(state: GameState, playerId: string, cardId: string): void {
  const player = getPlayerOrError(state, playerId);
  const card = getCard(cardId);
  player.handCardIds = player.handCardIds.filter((id) => id !== cardId);
  if (card.type === 'wild_location') {
    state.cardZones.wildLocationPool.push(cardId);
    pushEvent(state, {type: 'card_discarded', playerId, cardId, destination: 'wild_pool'});
  } else if (card.type === 'wild_industry') {
    state.cardZones.wildIndustryPool.push(cardId);
    pushEvent(state, {type: 'card_discarded', playerId, cardId, destination: 'wild_pool'});
  } else {
    player.discardCardIds.push(cardId);
    pushEvent(state, {type: 'card_discarded', playerId, cardId, destination: 'discard'});
  }
}

function spendCash(state: GameState, playerId: string, amount: number, reason: string): void {
  if (amount === 0) {
    return;
  }
  const player = getPlayerOrError(state, playerId);
  player.cash -= amount;
  player.spentThisRound += amount;
  pushEvent(state, {type: 'cash_changed', playerId, delta: -amount, reason});
}

function gainCash(state: GameState, playerId: string, amount: number, reason: string): void {
  if (amount === 0) {
    return;
  }
  const player = getPlayerOrError(state, playerId);
  player.cash += amount;
  pushEvent(state, {type: 'cash_changed', playerId, delta: amount, reason});
}

function gainVictoryPoints(state: GameState, playerId: string, amount: number, reason: string): void {
  if (amount === 0) {
    return;
  }
  const player = getPlayerOrError(state, playerId);
  player.victoryPoints += amount;
  pushEvent(state, {type: 'victory_points_changed', playerId, delta: amount, reason});
}

function payCashWithoutSpending(state: GameState, playerId: string, amount: number, reason: string): number {
  if (amount === 0) {
    return 0;
  }
  const player = getPlayerOrError(state, playerId);
  const paid = Math.min(player.cash, amount);
  if (paid > 0) {
    player.cash -= paid;
    pushEvent(state, {type: 'cash_changed', playerId, delta: -paid, reason});
  }
  return paid;
}

function changeIncomePosition(state: GameState, playerId: string, to: number, reason: string): void {
  const player = getPlayerOrError(state, playerId);
  const from = player.incomeTrackPosition;
  if (from === to) {
    return;
  }
  player.incomeTrackPosition = to;
  pushEvent(state, {type: 'income_position_changed', playerId, from, to, reason});
}

function currentTileSpec(state: GameState, playerId: string, industryType: IndustryType): IndustryTileSpec | undefined {
  const player = getPlayerOrError(state, playerId);
  const specId = player.industryTileStacks[industryType].availableSpecIdsInOrder[0];
  return specId ? staticConfig.industryTileSpecs[specId] : undefined;
}

function removeCurrentTileFromStack(state: GameState, playerId: string, industryType: IndustryType): string {
  const player = getPlayerOrError(state, playerId);
  const specId = player.industryTileStacks[industryType].availableSpecIdsInOrder.shift();
  if (!specId) {
    throw new Error(`No ${industryType} tile left for ${playerId}`);
  }
  return specId;
}

function removeBuiltIndustryReference(state: GameState, industry: IndustryInstance): void {
  const player = getPlayerOrError(state, industry.ownerPlayerId);
  const stack = player.industryTileStacks[industry.industryType];
  stack.builtInstanceIds = stack.builtInstanceIds.filter((id) => id !== industry.id);
}

function removeIndustryFromBoard(state: GameState, industry: IndustryInstance, reason: IndustryRemovalReason): void {
  industry.removedFromGame = true;
  industry.remainingResource = 0;
  removeBuiltIndustryReference(state, industry);
  if (state.board.slots[industry.slotId]?.occupiedBy === industry.id) {
    state.board.slots[industry.slotId] = {};
  }
  pushEvent(state, {type: 'industry_removed', industryInstanceId: industry.id, reason});
}

function flipIndustryIfDepleted(state: GameState, industry: IndustryInstance): void {
  if (industry.flipped || industry.remainingResource > 0) {
    return;
  }
  const spec = staticConfig.industryTileSpecs[industry.specId];
  if (spec.flip.trigger !== 'resource_depleted') {
    return;
  }
  industry.flipped = true;
  changeIncomePosition(
    state,
    industry.ownerPlayerId,
    advanceIncomeSpaces(state.players[industry.ownerPlayerId].incomeTrackPosition, spec.flip.incomeSpaces),
    `flipped ${industry.industryType}`,
  );
  pushEvent(state, {type: 'industry_flipped', industryInstanceId: industry.id, ownerPlayerId: industry.ownerPlayerId});
}

function getMarketPrice(state: GameState, marketName: 'coal' | 'iron'): number {
  const spec = staticConfig.markets[marketName];
  const market = state.markets[marketName];
  if (market.occupiedCount <= 0) {
    return spec.fallbackPriceWhenEmpty;
  }
  const index = spec.priceSlotsCheapestToMostExpensive.length - market.occupiedCount;
  return spec.priceSlotsCheapestToMostExpensive[index] ?? spec.fallbackPriceWhenEmpty;
}

function consumeMarket(state: GameState, marketName: 'coal' | 'iron'): number {
  const price = getMarketPrice(state, marketName);
  const market = state.markets[marketName];
  if (market.occupiedCount > 0) {
    market.occupiedCount--;
  }
  return price;
}

function marketHasSpace(market: MarketState, marketName: 'coal' | 'iron'): boolean {
  return market.occupiedCount < staticConfig.markets[marketName].priceSlotsCheapestToMostExpensive.length;
}

function sellResourceToMarket(state: GameState, playerId: string, marketName: 'coal' | 'iron', industryInstanceId: string): number {
  const market = state.markets[marketName];
  if (!marketHasSpace(market, marketName)) {
    return 0;
  }
  const priceIndex = staticConfig.markets[marketName].priceSlotsCheapestToMostExpensive.length - market.occupiedCount - 1;
  const price = staticConfig.markets[marketName].priceSlotsCheapestToMostExpensive[Math.max(0, priceIndex)];
  market.occupiedCount++;
  pushEvent(state, {type: 'resource_sold_to_market', industryInstanceId, market: marketName, cashReceived: price});
  gainCash(state, playerId, price, `sold ${marketName} to market`);
  return price;
}

function findIronCandidates(state: GameState): ResourceCandidate[] {
  const candidates: ResourceCandidate[] = [];
  for (const industry of getActiveIndustries(state)) {
    if (!industry.flipped && industry.industryType === 'iron_works' && industry.remainingResource > 0) {
      for (let count = 0; count < industry.remainingResource; count++) {
        candidates.push({
          source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'iron'},
          distance: 0,
          price: 0,
        });
      }
    }
  }
  candidates.push({
    source: {kind: 'market', market: 'iron', price: getMarketPrice(state, 'iron')},
    distance: 0,
    price: getMarketPrice(state, 'iron'),
  });
  return candidates;
}

function anchorLocationIds(anchor: ResourceAnchor): string[] {
  return Array.isArray(anchor) ? [...new Set(anchor)] : [anchor];
}

function linkDemandLocations(line: LinkLineSpec): string[] {
  return [line.endpointA, line.endpointB, line.viaFarmBreweryId].filter(Boolean) as string[];
}

function hasCoalMarketAccessFromAny(state: GameState, anchor: ResourceAnchor): boolean {
  return anchorLocationIds(anchor).some((locationId) => hasCoalMarketAccess(state, locationId));
}

function findCoalCandidates(state: GameState, anchorLocationId: ResourceAnchor): ResourceCandidate[] {
  const candidates: ResourceCandidate[] = [];
  const visited = new Set<string>();
  const queue: Array<{locationId: string; distance: number}> = anchorLocationIds(anchorLocationId)
    .map((locationId) => ({locationId, distance: 0}));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next.locationId)) {
      continue;
    }
    visited.add(next.locationId);

    for (const industry of getIndustriesAtLocation(state, next.locationId)) {
      if (!industry.removedFromGame && !industry.flipped && industry.industryType === 'coal_mine' && industry.remainingResource > 0) {
        for (let count = 0; count < industry.remainingResource; count++) {
          candidates.push({
            source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'coal'},
            distance: next.distance,
            price: 0,
          });
        }
      }
    }

    for (const link of getActiveLinks(state)) {
      const line = staticConfig.linkLines[link.linkLineId];
      for (const neighbor of getNeighborLocations(line, next.locationId)) {
        if (!visited.has(neighbor)) {
          queue.push({locationId: neighbor, distance: next.distance + 1});
        }
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance || a.price - b.price);
  if (hasCoalMarketAccessFromAny(state, anchorLocationId)) {
    candidates.push({
      source: {kind: 'market', market: 'coal', price: getMarketPrice(state, 'coal')},
      distance: Number.MAX_SAFE_INTEGER,
      price: getMarketPrice(state, 'coal'),
    });
  }
  return candidates;
}

function consumeResourceDemand(state: GameState, playerId: string, resource: 'coal' | 'iron', count: number, anchorLocationId: string, reason: string): number {
  const selection = selectResourceSources(state, resource, count, anchorLocationId, undefined);
  if (!selection.ok) {
    throw new Error(selection.errors.join('; '));
  }
  return consumeSelectedResourceSources(state, playerId, selection.sources, reason);
}

function sourceKey(source: ResourceSource): string {
  if (source.kind === 'industry_tile') {
    return `industry:${source.industryInstanceId}:${source.resourceType}`;
  }
  if (source.kind === 'merchant_beer') {
    return `merchant:${source.merchantSpaceId}:${source.merchantTileInstanceId}`;
  }
  return `market:${source.market}:${source.price}`;
}

function createResourceSelectionTracker(): ResourceSelectionTracker {
  return {
    usedSources: new Map(),
    marketConsumed: {coal: 0, iron: 0},
  };
}

function createBeerSelectionTracker(): BeerSelectionTracker {
  return {usedSources: new Map()};
}

function getMarketPriceForOccupiedCount(marketName: 'coal' | 'iron', occupiedCount: number): number {
  const spec = staticConfig.markets[marketName];
  if (occupiedCount <= 0) {
    return spec.fallbackPriceWhenEmpty;
  }
  const index = spec.priceSlotsCheapestToMostExpensive.length - occupiedCount;
  return spec.priceSlotsCheapestToMostExpensive[index] ?? spec.fallbackPriceWhenEmpty;
}

function filterConsumedIndustryCandidates(candidates: ResourceCandidate[], tracker: ResourceSelectionTracker): ResourceCandidate[] {
  const seen = new Map<string, number>();
  return candidates.filter((candidate) => {
    if (candidate.source.kind !== 'industry_tile') {
      return false;
    }
    const key = sourceKey(candidate.source);
    const seenCount = seen.get(key) ?? 0;
    seen.set(key, seenCount + 1);
    return seenCount >= (tracker.usedSources.get(key) ?? 0);
  });
}

function filterConsumedBeerCandidates(candidates: ResourceCandidate[], tracker: BeerSelectionTracker): ResourceCandidate[] {
  const seen = new Map<string, number>();
  return candidates.filter((candidate) => {
    const key = sourceKey(candidate.source);
    const seenCount = seen.get(key) ?? 0;
    seen.set(key, seenCount + 1);
    return seenCount >= (tracker.usedSources.get(key) ?? 0);
  });
}

function markBeerSourceUsed(tracker: BeerSelectionTracker, source: ResourceSource): void {
  const key = sourceKey(source);
  tracker.usedSources.set(key, (tracker.usedSources.get(key) ?? 0) + 1);
}

function resourceMarketCandidate(
  state: GameState,
  resource: 'coal' | 'iron',
  baseCandidates: ResourceCandidate[],
  tracker: ResourceSelectionTracker,
): ResourceCandidate | undefined {
  const marketAvailable = baseCandidates.some((candidate) => candidate.source.kind === 'market' && candidate.source.market === resource);
  if (!marketAvailable) {
    return undefined;
  }
  const occupiedCount = Math.max(0, state.markets[resource].occupiedCount - tracker.marketConsumed[resource]);
  const price = getMarketPriceForOccupiedCount(resource, occupiedCount);
  return {
    source: {kind: 'market', market: resource, price},
    distance: Number.MAX_SAFE_INTEGER,
    price,
  };
}

function availableResourceCandidates(
  state: GameState,
  resource: 'coal' | 'iron',
  anchorLocationId: ResourceAnchor,
  extraLinkLineIds: string[],
  tracker: ResourceSelectionTracker,
): ResourceCandidate[] {
  const baseCandidates = resource === 'coal'
    ? findCoalCandidatesWithExtraLinks(state, anchorLocationId, extraLinkLineIds)
    : findIronCandidates(state);
  const candidates = filterConsumedIndustryCandidates(baseCandidates, tracker);
  const marketCandidate = resourceMarketCandidate(state, resource, baseCandidates, tracker);
  if (marketCandidate) {
    candidates.push(marketCandidate);
  }
  return candidates;
}

function legalResourceCandidates(resource: 'coal' | 'iron', candidates: ResourceCandidate[]): ResourceCandidate[] {
  const industryCandidates = candidates.filter((candidate) => candidate.source.kind === 'industry_tile');
  if (industryCandidates.length === 0) {
    return candidates.filter((candidate) => candidate.source.kind === 'market');
  }
  if (resource === 'coal') {
    const nearestDistance = Math.min(...industryCandidates.map((candidate) => candidate.distance));
    return industryCandidates.filter((candidate) => candidate.distance === nearestDistance);
  }
  return industryCandidates;
}

function validateResourceSourceType(resource: 'coal' | 'iron', source: ResourceSource): string | undefined {
  if (source.kind === 'merchant_beer') {
    return `${resource} cannot come from merchant beer`;
  }
  if (source.kind === 'market' && source.market !== resource) {
    return `Selected market source is not ${resource}`;
  }
  if (source.kind === 'industry_tile' && source.resourceType !== resource) {
    return `Selected industry source is not ${resource}`;
  }
  return undefined;
}

function selectResourceSources(
  state: GameState,
  resource: 'coal' | 'iron',
  count: number,
  anchorLocationId: ResourceAnchor,
  requestedSources: ResourceSource[] | undefined,
  extraLinkLineIds: string[] = [],
  tracker = createResourceSelectionTracker(),
): ResourceSelectionResult {
  if (requestedSources !== undefined && requestedSources.length !== count) {
    return {
      ok: false,
      errors: [`${resource} source count does not match the requirement`],
      sources: [],
      marketCash: 0,
    };
  }

  const sources: ResourceSource[] = [];
  let marketCash = 0;
  for (let index = 0; index < count; index++) {
    const candidates = legalResourceCandidates(
      resource,
      availableResourceCandidates(state, resource, anchorLocationId, extraLinkLineIds, tracker),
    );
    const requestedSource = requestedSources?.[index];
    const typeError = requestedSource ? validateResourceSourceType(resource, requestedSource) : undefined;
    if (typeError) {
      return {ok: false, errors: [typeError], sources: [], marketCash: 0};
    }

    const candidate = requestedSource
      ? candidates.find((option) => sourceKey(option.source) === sourceKey(requestedSource))
      : candidates[0];
    if (!candidate) {
      return {
        ok: false,
        errors: [requestedSource ? `Selected ${resource} source is not available` : `No ${resource} source available`],
        sources: [],
        marketCash: 0,
      };
    }

    sources.push(candidate.source);
    if (candidate.source.kind === 'market') {
      tracker.marketConsumed[resource]++;
      marketCash += candidate.price;
    } else {
      const key = sourceKey(candidate.source);
      tracker.usedSources.set(key, (tracker.usedSources.get(key) ?? 0) + 1);
    }
  }

  return {ok: true, errors: [], sources, marketCash};
}

function markResourceSourceUsed(resource: 'coal' | 'iron', tracker: ResourceSelectionTracker, source: ResourceSource): void {
  if (source.kind === 'market') {
    tracker.marketConsumed[resource]++;
    return;
  }
  if (source.kind === 'industry_tile') {
    const key = sourceKey(source);
    tracker.usedSources.set(key, (tracker.usedSources.get(key) ?? 0) + 1);
  }
}

function trackSelectedResourceSource(
  state: GameState,
  resource: 'coal' | 'iron',
  anchorLocationId: ResourceAnchor,
  selectedSource: ResourceSource | undefined,
  extraLinkLineIds: string[],
  tracker: ResourceSelectionTracker,
): void {
  if (!selectedSource || validateResourceSourceType(resource, selectedSource)) {
    return;
  }
  const candidate = legalResourceCandidates(
    resource,
    availableResourceCandidates(state, resource, anchorLocationId, extraLinkLineIds, tracker),
  ).find((option) => sourceKey(option.source) === sourceKey(selectedSource));
  if (candidate) {
    markResourceSourceUsed(resource, tracker, candidate.source);
  }
}

export function legalResourceSourcesForSelect(
  state: GameState,
  resource: 'coal' | 'iron',
  anchorLocationId: ResourceAnchor,
  selectedSources: Array<ResourceSource | undefined>,
  index: number,
  extraLinkLineIds: string[] = [],
): ResourceSource[] {
  const tracker = createResourceSelectionTracker();
  for (let selectedIndex = 0; selectedIndex < index; selectedIndex++) {
    trackSelectedResourceSource(state, resource, anchorLocationId, selectedSources[selectedIndex], extraLinkLineIds, tracker);
  }

  return legalResourceCandidates(
    resource,
    availableResourceCandidates(state, resource, anchorLocationId, extraLinkLineIds, tracker),
  ).map((candidate) => candidate.source);
}

function networkCoalContext(linkLineIds: string[], index: number): {anchorLocationId: ResourceAnchor; extraLinkLineIds: string[]} | undefined {
  const linkLineId = linkLineIds[index];
  const line = linkLineId ? staticConfig.linkLines[linkLineId] : undefined;
  if (!line) {
    return undefined;
  }
  return {
    anchorLocationId: linkDemandLocations(line),
    extraLinkLineIds: linkLineIds.slice(0, index + 1),
  };
}

export function legalCoalSourcesForNetworkSelect(
  state: GameState,
  linkLineIds: string[],
  selectedSources: Array<ResourceSource | undefined>,
  index: number,
): ResourceSource[] {
  const tracker = createResourceSelectionTracker();
  for (let selectedIndex = 0; selectedIndex < index; selectedIndex++) {
    const context = networkCoalContext(linkLineIds, selectedIndex);
    if (context) {
      trackSelectedResourceSource(state, 'coal', context.anchorLocationId, selectedSources[selectedIndex], context.extraLinkLineIds, tracker);
    }
  }

  const context = networkCoalContext(linkLineIds, index);
  if (!context) {
    return [];
  }
  return legalResourceCandidates(
    'coal',
    availableResourceCandidates(state, 'coal', context.anchorLocationId, context.extraLinkLineIds, tracker),
  ).map((candidate) => candidate.source);
}

function consumeSelectedResourceSources(state: GameState, playerId: string, sources: ResourceSource[], reason: string): number {
  let marketCash = 0;
  for (const source of sources) {
    pushEvent(state, {type: 'resource_consumed', source, byPlayerId: playerId, reason});
    if (source.kind === 'industry_tile') {
      const industry = state.board.industryInstances[source.industryInstanceId];
      if (!industry || !isActiveIndustryInstance(state, industry) || industry.remainingResource <= 0 || industry.flipped) {
        throw new Error(`Selected ${source.resourceType} source is no longer available`);
      }
      industry.remainingResource--;
      flipIndustryIfDepleted(state, industry);
    } else if (source.kind === 'market') {
      marketCash += consumeMarket(state, source.market);
    } else {
      throw new Error('Merchant beer cannot be used as coal or iron');
    }
  }
  return marketCash;
}

function getMerchantSpecForSpace(merchantSpaceId: string): MerchantSpec | undefined {
  return Object.values(staticConfig.locations).find((location): location is MerchantSpec =>
    location.kind === 'merchant' && location.spaces.some((space) => space.id === merchantSpaceId),
  );
}

function getMerchantTileSpecId(merchantTileInstanceId: string): string {
  return merchantTileInstanceId.replace(/-\d+$/, '');
}

function getMerchantTarget(state: GameState, merchantSpaceId: string) {
  const space = state.board.merchantSpaces[merchantSpaceId];
  if (!space?.merchantTileInstanceId) {
    return undefined;
  }
  const specId = getMerchantTileSpecId(space.merchantTileInstanceId);
  const tileSpec = staticConfig.merchantTileSpecs[specId];
  const merchant = getMerchantSpecForSpace(merchantSpaceId);
  const spaceSpec = merchant?.spaces.find((candidate) => candidate.id === merchantSpaceId);
  if (
    !tileSpec ||
    !merchant ||
    !spaceSpec ||
    merchant.minPlayers > state.playerCount ||
    spaceSpec.minPlayers > state.playerCount ||
    tileSpec.minPlayers > state.playerCount
  ) {
    return undefined;
  }
  return {space, tileSpec, merchant};
}

function merchantAcceptsIndustry(state: GameState, merchantSpaceId: string, industryType: IndustryType): boolean {
  const target = getMerchantTarget(state, merchantSpaceId);
  if (!target) {
    return false;
  }
  return !target.tileSpec.blank && target.tileSpec.acceptedIndustryTypes.includes(industryType);
}

function findBeerCandidatesForSale(state: GameState, playerId: string, saleLocationId: string, merchantSpaceId: string): ResourceCandidate[] {
  const candidates: ResourceCandidate[] = [];
  const target = getMerchantTarget(state, merchantSpaceId);
  if (target?.space.beerPresent && target.space.merchantTileInstanceId) {
    candidates.push({
      source: {
        kind: 'merchant_beer',
        merchantSpaceId,
        merchantTileInstanceId: target.space.merchantTileInstanceId,
      },
      distance: 0,
      price: 0,
    });
  }

  for (const industry of getActiveIndustries(state)) {
    if (industry.flipped || industry.industryType !== 'brewery' || industry.remainingResource <= 0) {
      continue;
    }
    if (industry.ownerPlayerId === playerId) {
      for (let count = 0; count < industry.remainingResource; count++) {
        candidates.push({
          source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'beer'},
          distance: 0,
          price: 0,
        });
      }
    }
  }

  const component = connectedComponent(state, saleLocationId);
  for (const industry of getActiveIndustries(state)) {
    if (industry.flipped || industry.industryType !== 'brewery' || industry.remainingResource <= 0) {
      continue;
    }
    if (industry.ownerPlayerId !== playerId && component.has(industry.locationId)) {
      for (let count = 0; count < industry.remainingResource; count++) {
        candidates.push({
          source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'beer'},
          distance: 1,
          price: 0,
        });
      }
    }
  }

  return candidates;
}

function getConnectedLocationsWithExtraLinks(state: GameState, startLocationId: ResourceAnchor, extraLinkLineIds: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = anchorLocationIds(startLocationId);

  while (queue.length > 0) {
    const locationId = queue.shift();
    if (!locationId || visited.has(locationId)) {
      continue;
    }
    visited.add(locationId);

    for (const link of getActiveLinks(state)) {
      const line = staticConfig.linkLines[link.linkLineId];
      for (const neighbor of getNeighborLocations(line, locationId)) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    for (const linkLineId of extraLinkLineIds) {
      const line = staticConfig.linkLines[linkLineId];
      if (!line) {
        continue;
      }
      for (const neighbor of getNeighborLocations(line, locationId)) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return visited;
}

function isInPlayerNetworkWithPendingLinks(state: GameState, playerId: string, locationId: string, pendingLinkLineIds: string[]): boolean {
  if (isInPlayerNetwork(state, playerId, locationId)) {
    return true;
  }
  return pendingLinkLineIds.some((linkLineId) => {
    const line = staticConfig.linkLines[linkLineId];
    return line ? linkLineTouchesLocation(line, locationId) : false;
  });
}

function hasCoalMarketAccessWithExtraLinks(state: GameState, locationId: ResourceAnchor, extraLinkLineIds: string[]): boolean {
  const component = getConnectedLocationsWithExtraLinks(state, locationId, extraLinkLineIds);
  return [...component].some((id) => {
    const location = staticConfig.locations[id];
    return location?.kind === 'merchant' && location.providesCoalMarketConnection;
  });
}

function findCoalCandidatesWithExtraLinks(state: GameState, anchorLocationId: ResourceAnchor, extraLinkLineIds: string[]): ResourceCandidate[] {
  if (extraLinkLineIds.length === 0) {
    return findCoalCandidates(state, anchorLocationId);
  }

  const candidates: ResourceCandidate[] = [];
  const visited = new Set<string>();
  const queue: Array<{locationId: string; distance: number}> = anchorLocationIds(anchorLocationId)
    .map((locationId) => ({locationId, distance: 0}));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || visited.has(next.locationId)) {
      continue;
    }
    visited.add(next.locationId);

    for (const industry of getIndustriesAtLocation(state, next.locationId)) {
      if (!industry.removedFromGame && !industry.flipped && industry.industryType === 'coal_mine' && industry.remainingResource > 0) {
        for (let count = 0; count < industry.remainingResource; count++) {
          candidates.push({
            source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'coal'},
            distance: next.distance,
            price: 0,
          });
        }
      }
    }

    for (const link of getActiveLinks(state)) {
      const line = staticConfig.linkLines[link.linkLineId];
      for (const neighbor of getNeighborLocations(line, next.locationId)) {
        if (!visited.has(neighbor)) {
          queue.push({locationId: neighbor, distance: next.distance + 1});
        }
      }
    }

    for (const linkLineId of extraLinkLineIds) {
      const line = staticConfig.linkLines[linkLineId];
      if (!line) {
        continue;
      }
      for (const neighbor of getNeighborLocations(line, next.locationId)) {
        if (!visited.has(neighbor)) {
          queue.push({locationId: neighbor, distance: next.distance + 1});
        }
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance || a.price - b.price);
  if (hasCoalMarketAccessWithExtraLinks(state, anchorLocationId, extraLinkLineIds)) {
    candidates.push({
      source: {kind: 'market', market: 'coal', price: getMarketPrice(state, 'coal')},
      distance: Number.MAX_SAFE_INTEGER,
      price: getMarketPrice(state, 'coal'),
    });
  }
  return candidates;
}

function findBeerCandidatesForNetwork(state: GameState, playerId: string, linkLineIds: string[]): ResourceCandidate[] {
  const candidates: ResourceCandidate[] = [];
  const secondRailLine = staticConfig.linkLines[linkLineIds[1] ?? linkLineIds[0]];
  const opponentBeerConnectedLocations = new Set<string>();
  if (secondRailLine) {
    for (const locationId of [secondRailLine.endpointA, secondRailLine.endpointB, secondRailLine.viaFarmBreweryId].filter(Boolean) as string[]) {
      for (const connectedLocation of getConnectedLocationsWithExtraLinks(state, locationId, linkLineIds)) {
        opponentBeerConnectedLocations.add(connectedLocation);
      }
    }
  }

  for (const industry of getActiveIndustries(state)) {
    if (industry.flipped || industry.industryType !== 'brewery' || industry.remainingResource <= 0) {
      continue;
    }
    const canUse = industry.ownerPlayerId === playerId || opponentBeerConnectedLocations.has(industry.locationId);
    if (!canUse) {
      continue;
    }
    for (let count = 0; count < industry.remainingResource; count++) {
      candidates.push({
        source: {kind: 'industry_tile', industryInstanceId: industry.id, resourceType: 'beer'},
        distance: industry.ownerPlayerId === playerId ? 0 : 1,
        price: 0,
      });
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance);
}

export function legalBeerSourcesForNetwork(state: GameState, playerId: string, linkLineIds: string[]): ResourceSource[] {
  return findBeerCandidatesForNetwork(state, playerId, linkLineIds).map((candidate) => candidate.source);
}

function availableBeerCandidatesForSale(
  state: GameState,
  playerId: string,
  saleLocationId: string,
  merchantSpaceId: string,
  tracker: BeerSelectionTracker,
): ResourceCandidate[] {
  return filterConsumedBeerCandidates(findBeerCandidatesForSale(state, playerId, saleLocationId, merchantSpaceId), tracker);
}

function trackSelectedBeerSource(
  state: GameState,
  selection: SaleBeerSourceSelection,
  source: ResourceSource | undefined,
  tracker: BeerSelectionTracker,
): void {
  if (!source || source.kind === 'market') {
    return;
  }
  if (source.kind === 'merchant_beer' && source.merchantSpaceId !== selection.merchantSpaceId) {
    return;
  }
  const candidate = availableBeerCandidatesForSale(
    state,
    selection.playerId,
    selection.saleLocationId,
    selection.merchantSpaceId,
    tracker,
  ).find((option) => sourceKey(option.source) === sourceKey(source));
  if (candidate) {
    markBeerSourceUsed(tracker, candidate.source);
  }
}

export function legalBeerSourcesForSaleSelect(
  state: GameState,
  selections: SaleBeerSourceSelection[],
  selectionIndex: number,
  sourceIndex: number,
): ResourceSource[] {
  const tracker = createBeerSelectionTracker();
  for (let priorSelectionIndex = 0; priorSelectionIndex <= selectionIndex; priorSelectionIndex++) {
    const selection = selections[priorSelectionIndex];
    if (!selection) {
      continue;
    }
    const selectedSourceLimit = priorSelectionIndex === selectionIndex
      ? sourceIndex
      : selection.selectedSources.length;
    for (let selectedSourceIndex = 0; selectedSourceIndex < selectedSourceLimit; selectedSourceIndex++) {
      trackSelectedBeerSource(state, selection, selection.selectedSources[selectedSourceIndex], tracker);
    }
  }

  const selection = selections[selectionIndex];
  if (!selection) {
    return [];
  }
  return availableBeerCandidatesForSale(
    state,
    selection.playerId,
    selection.saleLocationId,
    selection.merchantSpaceId,
    tracker,
  ).map((candidate) => candidate.source);
}

function selectBeerSourcesForSale(
  state: GameState,
  playerId: string,
  saleLocationId: string,
  step: SellStep,
  beerRequired: number,
  tracker = createBeerSelectionTracker(),
): ResourceSource[] {
  const candidates = availableBeerCandidatesForSale(state, playerId, saleLocationId, step.merchantSpaceId, tracker);
  if (step.beerSources === undefined) {
    const sources = candidates.slice(0, beerRequired).map((candidate) => candidate.source);
    if (sources.length !== beerRequired) {
      throw new Error('Not enough beer available to sell');
    }
    for (const source of sources) {
      markBeerSourceUsed(tracker, source);
    }
    return sources;
  }

  if (step.beerSources.length !== beerRequired) {
    throw new Error('Beer source count does not match the industry requirement');
  }

  const available = new Map<string, ResourceCandidate[]>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate.source);
    const values = available.get(key) ?? [];
    values.push(candidate);
    available.set(key, values);
  }

  const sources = step.beerSources.map((source) => {
    const values = available.get(sourceKey(source));
    const candidate = values?.shift();
    if (!candidate) {
      throw new Error('Selected beer source is not available');
    }
    return candidate.source;
  });
  for (const source of sources) {
    markBeerSourceUsed(tracker, source);
  }
  return sources;
}

function validateBeerSourcesForSale(
  state: GameState,
  playerId: string,
  industry: IndustryInstance,
  step: SellStep,
  beerRequired: number,
  tracker: BeerSelectionTracker,
): ValidationResult {
  const candidates = availableBeerCandidatesForSale(state, playerId, industry.locationId, step.merchantSpaceId, tracker);
  if (step.beerSources === undefined) {
    if (candidates.length < beerRequired) {
      return fail('Not enough beer available to sell');
    }
    for (const candidate of candidates.slice(0, beerRequired)) {
      markBeerSourceUsed(tracker, candidate.source);
    }
    return ok();
  }
  if (step.beerSources.length !== beerRequired) {
    return fail('Beer source count does not match the industry requirement');
  }

  const available = new Map<string, number>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate.source);
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  const selectedSources: ResourceSource[] = [];
  for (const source of step.beerSources) {
    if (source.kind === 'market') {
      return fail('Beer cannot come from a market');
    }
    if (source.kind === 'merchant_beer' && source.merchantSpaceId !== step.merchantSpaceId) {
      return fail('Merchant beer must come from the selected merchant space');
    }
    const key = sourceKey(source);
    const remaining = available.get(key) ?? 0;
    if (remaining <= 0) {
      return fail('Selected beer source is not available');
    }
    available.set(key, remaining - 1);
    selectedSources.push(source);
  }
  for (const source of selectedSources) {
    markBeerSourceUsed(tracker, source);
  }

  return ok();
}

function consumeBeerSource(state: GameState, playerId: string, source: ResourceSource, reason: string): boolean {
  pushEvent(state, {type: 'resource_consumed', source, byPlayerId: playerId, reason});
  if (source.kind === 'merchant_beer') {
    const space = state.board.merchantSpaces[source.merchantSpaceId];
    if (!space?.beerPresent || space.merchantTileInstanceId !== source.merchantTileInstanceId) {
      throw new Error('Merchant beer source is no longer available');
    }
    space.beerPresent = false;
    return true;
  }
  if (source.kind === 'industry_tile') {
    const industry = state.board.industryInstances[source.industryInstanceId];
    if (
      source.resourceType !== 'beer' ||
      !industry ||
      !isActiveIndustryInstance(state, industry) ||
      industry.industryType !== 'brewery' ||
      industry.remainingResource <= 0 ||
      industry.flipped
    ) {
      throw new Error('Industry beer source is no longer available');
    }
    industry.remainingResource--;
    flipIndustryIfDepleted(state, industry);
    return false;
  }
  throw new Error('Invalid beer source');
}

function validateDevelopIndustryTypes(state: GameState, playerId: string, industryTypes: IndustryType[]): ValidationResult {
  const simulatedStackHeads = new Map<IndustryType, number>();
  for (const industryType of industryTypes) {
    const offset = simulatedStackHeads.get(industryType) ?? 0;
    const stack = state.players[playerId].industryTileStacks[industryType]?.availableSpecIdsInOrder;
    if (!stack) {
      return fail(`Unknown industry type: ${industryType}`);
    }
    const specId = stack[offset];
    if (!specId) {
      return fail(`No ${industryType} tile available to develop`);
    }
    const spec = staticConfig.industryTileSpecs[specId];
    if (!spec.canDevelop) {
      return fail(`${industryType} level ${spec.level} cannot be developed`);
    }
    simulatedStackHeads.set(industryType, offset + 1);
  }
  return ok();
}

function countAvailableMerchantDevelops(state: GameState, playerId: string, maxCount: number): number {
  const player = state.players[playerId];
  const simulatedStackHeads = new Map<IndustryType, number>();
  let count = 0;

  while (count < maxCount) {
    let selectedIndustryType: IndustryType | undefined;
    for (const industryType of Object.keys(player.industryTileStacks) as IndustryType[]) {
      const offset = simulatedStackHeads.get(industryType) ?? 0;
      const specId = player.industryTileStacks[industryType].availableSpecIdsInOrder[offset];
      if (specId && staticConfig.industryTileSpecs[specId]?.canDevelop) {
        selectedIndustryType = industryType;
        break;
      }
    }

    if (!selectedIndustryType) {
      return count;
    }

    simulatedStackHeads.set(selectedIndustryType, (simulatedStackHeads.get(selectedIndustryType) ?? 0) + 1);
    count++;
  }

  return count;
}

function developIndustryTiles(state: GameState, playerId: string, industryTypes: IndustryType[]): string[] {
  const specIds: string[] = [];
  for (const industryType of industryTypes) {
    const specId = removeCurrentTileFromStack(state, playerId, industryType);
    state.players[playerId].industryTileStacks[industryType].removedSpecIds.push(specId);
    specIds.push(specId);
  }
  return specIds;
}

function merchantDevelopSpaceIds(decision: {merchantSpaceId: string; merchantSpaceIds?: string[]}): string[] {
  return [...new Set([...(decision.merchantSpaceIds ?? [decision.merchantSpaceId]), decision.merchantSpaceId])];
}

function addMerchantDevelopDecision(state: GameState, playerId: string, merchantSpaceId: string, count: number): void {
  const current = state.pendingDecision;
  if (current?.type === 'merchant_develop' && current.playerId === playerId) {
    current.count += count;
    current.merchantSpaceIds = [...new Set([...merchantDevelopSpaceIds(current), merchantSpaceId])];
    return;
  }
  if (current) {
    throw new Error('Cannot start merchant develop while another decision is pending');
  }
  state.pendingDecision = {type: 'merchant_develop', playerId, count, merchantSpaceId, merchantSpaceIds: [merchantSpaceId]};
}

function applyMerchantBonus(state: GameState, playerId: string, merchantSpaceId: string): void {
  const merchant = getMerchantSpecForSpace(merchantSpaceId);
  if (!merchant) {
    throw new Error(`Unknown merchant space: ${merchantSpaceId}`);
  }

  switch (merchant.bonus.type) {
    case 'cash':
      gainCash(state, playerId, merchant.bonus.cash, 'merchant bonus');
      break;
    case 'victory_points':
      gainVictoryPoints(state, playerId, merchant.bonus.points, 'merchant bonus');
      break;
    case 'income_spaces':
      changeIncomePosition(
        state,
        playerId,
        advanceIncomeSpaces(state.players[playerId].incomeTrackPosition, merchant.bonus.spaces),
        'merchant bonus',
      );
      break;
    case 'develop':
      addMerchantDevelopDecision(state, playerId, merchantSpaceId, merchant.bonus.count);
      break;
  }
  pushEvent(state, {type: 'merchant_bonus_claimed', playerId, merchantSpaceId, bonus: merchant.bonus});
}

function isResourceGloballyDepleted(state: GameState, industryType: IndustryType): boolean {
  if (industryType === 'coal_mine' && state.markets.coal.occupiedCount > 0) {
    return false;
  }
  if (industryType === 'iron_works' && state.markets.iron.occupiedCount > 0) {
    return false;
  }
  const resourceType = industryType === 'coal_mine' ? 'coal_mine' : 'iron_works';
  return !getActiveIndustries(state).some((industry) =>
    !industry.flipped &&
    industry.industryType === resourceType &&
    industry.remainingResource > 0,
  );
}

function validateBuildCard(state: GameState, command: BuildCommand): ValidationResult {
  const card = getCard(command.cardId);
  const playerHasNoNetwork = !hasAnyPlayerNetwork(state, command.playerId);
  const location = getLocationOrThrow(command.locationId);

  if (location.kind === 'farm_brewery' && card.type !== 'industry' && card.type !== 'wild_industry') {
    return fail('Farm breweries require a Brewery industry card or Wild Industry');
  }

  if (card.type === 'location') {
    return card.locationId === command.locationId ? ok() : fail('Location card does not match the build location');
  }
  if (card.type === 'wild_location') {
    return ok();
  }
  if (card.type === 'industry') {
    if (card.industryType !== command.industryType) {
      return fail('Industry card does not match the selected industry');
    }
    return playerHasNoNetwork || isInPlayerNetwork(state, command.playerId, command.locationId)
      ? ok()
      : fail('Industry cards require building inside the player network');
  }
  if (card.type === 'wild_industry') {
    return playerHasNoNetwork || isInPlayerNetwork(state, command.playerId, command.locationId)
      ? ok()
      : fail('Wild Industry requires building inside the player network');
  }
  return fail('Unsupported build card');
}

function getBuildSlot(state: GameState, command: BuildCommand) {
  const location = getLocationOrThrow(command.locationId);
  if (location.kind === 'farm_brewery') {
    const slotId = `${location.id}-brewery`;
    return command.slotId === slotId
      ? {allowedIndustryTypes: ['brewery' as const], slotId, pureSlotsForIndustry: [slotId]}
      : undefined;
  }
  if (location.kind !== 'city') {
    return undefined;
  }
  const slot = location.slots.find((candidate) => candidate.id === command.slotId);
  if (!slot) {
    return undefined;
  }
  return {
    allowedIndustryTypes: slot.allowedIndustryTypes,
    slotId: slot.id,
    pureSlotsForIndustry: location.slots
      .filter((candidate) => candidate.allowedIndustryTypes.length === 1 && candidate.allowedIndustryTypes[0] === command.industryType)
      .map((candidate) => candidate.id),
  };
}

function canBuildOnOccupiedIndustry(
  state: GameState,
  playerId: string,
  industryType: IndustryType,
  spec: IndustryTileSpec,
  existing: IndustryInstance | undefined,
): boolean {
  if (!existing || existing.removedFromGame) {
    return false;
  }
  if (existing.ownerPlayerId === playerId) {
    return existing.industryType === industryType && existing.level < spec.level;
  }
  return (
    (existing.industryType === 'coal_mine' || existing.industryType === 'iron_works') &&
    existing.industryType === industryType &&
    existing.level < spec.level &&
    isResourceGloballyDepleted(state, existing.industryType)
  );
}

function canUseBuildSlotForSpec(
  state: GameState,
  playerId: string,
  slotId: string,
  industryType: IndustryType,
  spec: IndustryTileSpec,
): boolean {
  const occupiedBy = state.board.slots[slotId]?.occupiedBy;
  if (!occupiedBy) {
    return true;
  }
  const existing = state.board.industryInstances[occupiedBy];
  return Boolean(
    existing &&
    existing.slotId === slotId &&
    isActiveIndustryInstance(state, existing) &&
    canBuildOnOccupiedIndustry(state, playerId, industryType, spec, existing),
  );
}

export function validateBuild(state: GameState, command: BuildCommand): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  const card = requireKnownCardInHand(state, command.playerId, command.cardId);
  if (!card.ok) return card;
  const cardValidation = validateBuildCard(state, command);
  if (!cardValidation.ok) return cardValidation;

  const slot = getBuildSlot(state, command);
  if (!slot) {
    return fail('Invalid build slot');
  }
  if (!slot.allowedIndustryTypes.includes(command.industryType)) {
    return fail('Selected slot does not allow that industry');
  }

  const spec = currentTileSpec(state, command.playerId, command.industryType);
  if (!spec) {
    return fail('No industry tile left');
  }
  if (!spec.buildableEras.includes(state.era)) {
    return fail('The next tile is not buildable in this era');
  }
  const pureSlotAvailable = slot.pureSlotsForIndustry
    .filter((slotId) => slotId !== command.slotId)
    .some((slotId) => Boolean(state.board.slots[slotId] && !state.board.slots[slotId]?.occupiedBy));
  if (slot.allowedIndustryTypes.length > 1 && pureSlotAvailable) {
    return fail('A pure industry slot is available and must be used first');
  }

  const occupiedBy = state.board.slots[command.slotId]?.occupiedBy;
  if (occupiedBy) {
    const existing = state.board.industryInstances[occupiedBy];
    if (!existing || existing.slotId !== command.slotId || !isActiveIndustryInstance(state, existing)) {
      return fail('Selected slot occupation is stale');
    }
    if (existing.ownerPlayerId === command.playerId) {
      if (existing.industryType !== command.industryType || existing.level >= spec.level) {
        return fail('Own overbuild requires the same industry and a higher level');
      }
    } else {
      if (existing.industryType !== 'coal_mine' && existing.industryType !== 'iron_works') {
        return fail('Opponent overbuild is only allowed for coal mines or iron works');
      }
      if (existing.industryType !== command.industryType || existing.level >= spec.level) {
        return fail('Opponent overbuild requires the same industry and a higher level');
      }
      if (!isResourceGloballyDepleted(state, existing.industryType)) {
        return fail('Opponent overbuild is only allowed when that resource is globally depleted');
      }
    }
  }

  if (state.era === 'canal') {
    const ownAtLocation = getPlayerIndustriesAtLocation(state, command.playerId, command.locationId)
      .filter((industry) => industry.slotId !== command.slotId);
    if (ownAtLocation.length > 0) {
      return fail('Canal era allows only one industry per player per location');
    }
  }

  const coalSelection = selectResourceSources(state, 'coal', spec.cost.coal, command.locationId, command.coalSources);
  if (!coalSelection.ok) {
    return fail(...coalSelection.errors);
  }
  const ironSelection = selectResourceSources(state, 'iron', spec.cost.iron, command.locationId, command.ironSources);
  if (!ironSelection.ok) {
    return fail(...ironSelection.errors);
  }
  if (state.players[command.playerId].cash < spec.cost.cash + coalSelection.marketCash + ironSelection.marketCash) {
    return fail('Player cannot afford Build');
  }

  return ok();
}

export function executeBuild(state: GameState, command: BuildCommand): void {
  const validation = validateBuild(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  const specId = removeCurrentTileFromStack(state, command.playerId, command.industryType);
  const spec = staticConfig.industryTileSpecs[specId];
  const player = state.players[command.playerId];

  const coalSelection = selectResourceSources(state, 'coal', spec.cost.coal, command.locationId, command.coalSources);
  const ironSelection = selectResourceSources(state, 'iron', spec.cost.iron, command.locationId, command.ironSources);
  if (!coalSelection.ok || !ironSelection.ok) {
    throw new Error([...coalSelection.errors, ...ironSelection.errors].join('; '));
  }
  const marketCash =
    consumeSelectedResourceSources(state, command.playerId, coalSelection.sources, 'build') +
    consumeSelectedResourceSources(state, command.playerId, ironSelection.sources, 'build');
  spendCash(state, command.playerId, spec.cost.cash + marketCash, 'build');

  const occupiedBy = state.board.slots[command.slotId]?.occupiedBy;
  if (occupiedBy) {
    const existing = state.board.industryInstances[occupiedBy];
    removeIndustryFromBoard(state, existing, 'overbuild');
  }

  const resourcesWhenBuilt = spec.resourcesWhenBuilt?.[state.era] ?? 0;
  const instance: IndustryInstance = {
    id: nextInstanceId(state, 'industry'),
    specId,
    ownerPlayerId: command.playerId,
    industryType: command.industryType,
    level: spec.level,
    locationId: command.locationId,
    slotId: command.slotId,
    flipped: false,
    remainingResource: resourcesWhenBuilt,
    removedFromGame: false,
  };
  state.board.industryInstances[instance.id] = instance;
  state.board.slots[command.slotId] = {occupiedBy: instance.id};
  player.industryTileStacks[command.industryType].builtInstanceIds.push(instance.id);
  pushEvent(state, {type: 'industry_built', instance});

  if (command.industryType === 'iron_works') {
    while (instance.remainingResource > 0 && marketHasSpace(state.markets.iron, 'iron')) {
      sellResourceToMarket(state, command.playerId, 'iron', instance.id);
      instance.remainingResource--;
    }
  }
  if (command.industryType === 'coal_mine' && hasCoalMarketAccess(state, command.locationId)) {
    while (instance.remainingResource > 0 && marketHasSpace(state.markets.coal, 'coal')) {
      sellResourceToMarket(state, command.playerId, 'coal', instance.id);
      instance.remainingResource--;
    }
  }
  flipIndustryIfDepleted(state, instance);

  discardCard(state, command.playerId, command.cardId);
}

function validateNetworkLine(
  state: GameState,
  playerId: string,
  line: LinkLineSpec,
  linkType: LinkType,
  pendingLinkLineIds: string[],
): ValidationResult {
  const occupiedBy = state.board.linkLines[line.id]?.occupiedBy;
  if (occupiedBy) {
    const existing = state.board.linkInstances[occupiedBy];
    if (!existing || existing.linkLineId !== line.id || !isActiveLinkInstance(state, existing)) {
      return fail('Selected link occupation is stale');
    }
    return fail('Link line is already occupied');
  }
  if (!line.allowedLinkTypes.includes(linkType)) {
    return fail(`Link line does not support ${linkType}`);
  }
  if (state.players[playerId].remainingLinks[linkType] <= 0) {
    return fail(`Player has no ${linkType} links remaining`);
  }
  if (hasAnyPlayerNetwork(state, playerId) || pendingLinkLineIds.length > 0) {
    const touchesPlayerNetwork = linkDemandLocations(line)
      .some((locationId) => isInPlayerNetworkWithPendingLinks(state, playerId, locationId, pendingLinkLineIds));
    if (!touchesPlayerNetwork) {
      return fail('Network action must extend from the player network');
    }
  }
  return ok();
}

function validateDoubleRailBeer(state: GameState, command: NetworkCommand): ValidationResult {
  if (state.era !== 'rail' || command.linkLineIds.length !== 2) {
    return ok();
  }

  const candidates = findBeerCandidatesForNetwork(state, command.playerId, command.linkLineIds);
  const explicitSource = command.beerSourceForDoubleRail;
  if (!explicitSource) {
    return candidates.length >= staticConfig.rules.railDoubleBeer
      ? ok()
      : fail('Double rail Network requires beer');
  }
  if (explicitSource.kind !== 'industry_tile' || explicitSource.resourceType !== 'beer') {
    return fail('Double rail beer must come from a brewery');
  }

  const selectedKey = sourceKey(explicitSource);
  return candidates.some((candidate) => sourceKey(candidate.source) === selectedKey)
    ? ok()
    : fail('Selected double rail beer source is not available');
}

function selectBeerSourceForDoubleRail(state: GameState, command: NetworkCommand): ResourceSource | undefined {
  if (state.era !== 'rail' || command.linkLineIds.length !== 2) {
    return undefined;
  }
  const candidates = findBeerCandidatesForNetwork(state, command.playerId, command.linkLineIds);
  const explicitSource = command.beerSourceForDoubleRail;
  if (explicitSource) {
    if (explicitSource.kind !== 'industry_tile' || explicitSource.resourceType !== 'beer') {
      throw new Error('Double rail beer must come from a brewery');
    }
    const selected = candidates.find((candidate) => sourceKey(candidate.source) === sourceKey(explicitSource));
    if (!selected) {
      throw new Error('Selected double rail beer source is not available');
    }
    return selected.source;
  }
  const selected = candidates[0];
  if (!selected) {
    throw new Error('Double rail Network requires beer');
  }
  return selected.source;
}

export function validateNetwork(state: GameState, command: NetworkCommand): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  const card = requireKnownCardInHand(state, command.playerId, command.cardId);
  if (!card.ok) return card;
  if (command.linkLineIds.length < 1) {
    return fail('Network must include at least one link');
  }

  const linkType: LinkType = state.era === 'canal' ? 'canal' : 'rail';
  if (state.era === 'canal' && command.linkLineIds.length !== 1) {
    return fail('Canal era Network builds exactly one canal');
  }
  if (state.era === 'rail' && command.linkLineIds.length > 2) {
    return fail('Rail era Network builds at most two rails');
  }
  if (command.beerSourceForDoubleRail !== undefined && !(state.era === 'rail' && command.linkLineIds.length === 2)) {
    return fail('Double rail beer source is only valid when building two rails');
  }
  if (state.era === 'canal' && command.coalSources !== undefined && command.coalSources.length > 0) {
    return fail('Canal era Network does not consume coal');
  }
  if (state.era === 'rail' && command.coalSources !== undefined && command.coalSources.length !== command.linkLineIds.length) {
    return fail('Coal source count must match rail link count');
  }
  if (new Set(command.linkLineIds).size !== command.linkLineIds.length) {
    return fail('Network cannot build the same link line twice');
  }
  if (state.players[command.playerId].remainingLinks[linkType] < command.linkLineIds.length) {
    return fail(`Player has fewer than ${command.linkLineIds.length} ${linkType} links remaining`);
  }

  let totalCost = state.era === 'canal'
    ? staticConfig.rules.canalLinkCost
    : command.linkLineIds.length === 2
      ? staticConfig.rules.railDoubleLinkCost
      : staticConfig.rules.railSingleLinkCost;

  const pendingLinkLineIds: string[] = [];
  const coalTracker = createResourceSelectionTracker();
  for (const [index, linkLineId] of command.linkLineIds.entries()) {
    const line = getLinkLineOrThrow(linkLineId);
    const lineValidation = validateNetworkLine(state, command.playerId, line, linkType, pendingLinkLineIds);
    if (!lineValidation.ok) return lineValidation;
    if (state.era === 'rail') {
      const coalSelection = selectResourceSources(
        state,
        'coal',
        1,
        linkDemandLocations(line),
        command.coalSources ? [command.coalSources[index]] : undefined,
        [...pendingLinkLineIds, linkLineId],
        coalTracker,
      );
      if (!coalSelection.ok) {
        return fail(...coalSelection.errors);
      }
      totalCost += coalSelection.marketCash;
    }
    pendingLinkLineIds.push(linkLineId);
  }

  const beerValidation = validateDoubleRailBeer(state, command);
  if (!beerValidation.ok) {
    return beerValidation;
  }
  if (totalCost > state.players[command.playerId].cash) {
    return fail('Player cannot afford Network');
  }
  return ok();
}

export function executeNetwork(state: GameState, command: NetworkCommand): void {
  const validation = validateNetwork(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  const linkType: LinkType = state.era === 'canal' ? 'canal' : 'rail';
  const baseCost = state.era === 'canal'
    ? staticConfig.rules.canalLinkCost
    : command.linkLineIds.length === 2
      ? staticConfig.rules.railDoubleLinkCost
      : staticConfig.rules.railSingleLinkCost;
  const doubleRailBeerSource = selectBeerSourceForDoubleRail(state, command);
  let marketCash = 0;

  const pendingLinkLineIds: string[] = [];
  for (const [index, linkLineId] of command.linkLineIds.entries()) {
    const line = getLinkLineOrThrow(linkLineId);
    if (state.era === 'rail') {
      const coalSelection = selectResourceSources(
        state,
        'coal',
        1,
        linkDemandLocations(line),
        command.coalSources ? [command.coalSources[index]] : undefined,
        [...pendingLinkLineIds, linkLineId],
      );
      if (!coalSelection.ok) {
        throw new Error(coalSelection.errors.join('; '));
      }
      marketCash += consumeSelectedResourceSources(state, command.playerId, coalSelection.sources, 'network');
    }
    const instance: LinkInstance = {
      id: nextInstanceId(state, 'link'),
      ownerPlayerId: command.playerId,
      linkType,
      linkLineId,
    };
    state.board.linkInstances[instance.id] = instance;
    state.board.linkLines[linkLineId] = {occupiedBy: instance.id};
    state.players[command.playerId].remainingLinks[linkType]--;
    pushEvent(state, {type: 'link_built', instance});
    pendingLinkLineIds.push(linkLineId);
  }

  if (doubleRailBeerSource) {
    consumeBeerSource(state, command.playerId, doubleRailBeerSource, 'network');
  }
  spendCash(state, command.playerId, baseCost + marketCash, 'network');
  discardCard(state, command.playerId, command.cardId);
}

export function validateDevelop(state: GameState, command: DevelopCommand): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  const card = requireKnownCardInHand(state, command.playerId, command.cardId);
  if (!card.ok) return card;
  if (command.industryTypes.length < 1 || command.industryTypes.length > 2) {
    return fail('Develop removes one or two tiles');
  }

  const tileValidation = validateDevelopIndustryTypes(state, command.playerId, command.industryTypes);
  if (!tileValidation.ok) return tileValidation;

  const ironSelection = selectResourceSources(state, 'iron', command.industryTypes.length, getCurrentPlayerId(state), command.ironSources);
  if (!ironSelection.ok) {
    return fail(...ironSelection.errors);
  }
  const marketCash = ironSelection.marketCash;
  if (state.players[command.playerId].cash < marketCash) {
    return fail('Player cannot afford iron for Develop');
  }
  return ok();
}

export function executeDevelop(state: GameState, command: DevelopCommand): void {
  const validation = validateDevelop(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  const ironSelection = selectResourceSources(state, 'iron', command.industryTypes.length, getCurrentPlayerId(state), command.ironSources);
  if (!ironSelection.ok) {
    throw new Error(ironSelection.errors.join('; '));
  }
  const marketCash = consumeSelectedResourceSources(state, command.playerId, ironSelection.sources, 'develop');
  spendCash(state, command.playerId, marketCash, 'develop iron');

  developIndustryTiles(state, command.playerId, command.industryTypes);
  discardCard(state, command.playerId, command.cardId);
}

function validateSellStep(state: GameState, playerId: string, step: SellStep, beerTracker: BeerSelectionTracker): ValidationResult {
  const industry = state.board.industryInstances[step.industryInstanceId];
  if (!industry || !isActiveIndustryInstance(state, industry)) {
    return fail('Selected industry does not exist');
  }
  if (industry.ownerPlayerId !== playerId) {
    return fail('Cannot sell another player industry');
  }
  if (industry.flipped) {
    return fail('Selected industry is already flipped');
  }
  if (!SELLABLE_INDUSTRIES.has(industry.industryType)) {
    return fail('Selected industry cannot be sold');
  }

  const target = getMerchantTarget(state, step.merchantSpaceId);
  if (!target) {
    return fail('Selected merchant space has no merchant tile');
  }
  if (!merchantAcceptsIndustry(state, step.merchantSpaceId, industry.industryType)) {
    return fail('Merchant does not accept this industry type');
  }
  if (!connectedComponent(state, industry.locationId).has(target.merchant.id)) {
    return fail('Industry is not connected to the selected merchant');
  }

  const spec = staticConfig.industryTileSpecs[industry.specId];
  const beerRequired = spec.beerRequiredToSell ?? 0;
  return validateBeerSourcesForSale(state, playerId, industry, step, beerRequired, beerTracker);
}

export function validateSell(state: GameState, command: SellCommand): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  const card = requireKnownCardInHand(state, command.playerId, command.cardId);
  if (!card.ok) return card;
  if (command.sales.length < 1) {
    return fail('Sell requires at least one sale step');
  }

  const seenIndustries = new Set<string>();
  const beerTracker = createBeerSelectionTracker();
  for (const step of command.sales) {
    if (seenIndustries.has(step.industryInstanceId)) {
      return fail('Cannot sell the same industry twice in one action');
    }
    seenIndustries.add(step.industryInstanceId);
    const validation = validateSellStep(state, command.playerId, step, beerTracker);
    if (!validation.ok) {
      return validation;
    }
  }

  return ok();
}

export function executeSell(state: GameState, command: SellCommand): void {
  const validation = validateSell(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  for (const step of command.sales) {
    const industry = state.board.industryInstances[step.industryInstanceId];
    const spec = staticConfig.industryTileSpecs[industry.specId];
    const beerRequired = spec.beerRequiredToSell ?? 0;
    const beerSources = selectBeerSourcesForSale(state, command.playerId, industry.locationId, step, beerRequired);
    let usedMerchantBeer = false;
    for (const source of beerSources) {
      usedMerchantBeer = consumeBeerSource(state, command.playerId, source, 'sell') || usedMerchantBeer;
    }
    if (usedMerchantBeer) {
      applyMerchantBonus(state, command.playerId, step.merchantSpaceId);
    }

    industry.flipped = true;
    changeIncomePosition(
      state,
      industry.ownerPlayerId,
      advanceIncomeSpaces(state.players[industry.ownerPlayerId].incomeTrackPosition, spec.flip.incomeSpaces),
      `sold ${industry.industryType}`,
    );
    pushEvent(state, {type: 'industry_flipped', industryInstanceId: industry.id, ownerPlayerId: industry.ownerPlayerId});
    pushEvent(state, {type: 'industry_sold', industryInstanceId: industry.id, ownerPlayerId: industry.ownerPlayerId, merchantSpaceId: step.merchantSpaceId});
  }

  discardCard(state, command.playerId, command.cardId);
}

export function validateLoan(state: GameState, command: {type: 'loan'; playerId: string; cardId: string}): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  const card = requireKnownCardInHand(state, command.playerId, command.cardId);
  if (!card.ok) return card;
  const currentLevel = getIncomeLevel(state.players[command.playerId].incomeTrackPosition);
  if (currentLevel - staticConfig.rules.loanIncomeLevelPenalty < staticConfig.incomeTrack.minIncomeLevel) {
    return fail('Loan would move income below the minimum');
  }
  return ok();
}

export function executeLoan(state: GameState, command: {type: 'loan'; playerId: string; cardId: string}): void {
  const validation = validateLoan(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  gainCash(state, command.playerId, staticConfig.rules.loanCash, 'loan');
  changeIncomePosition(
    state,
    command.playerId,
    retreatIncomeLevels(state.players[command.playerId].incomeTrackPosition, staticConfig.rules.loanIncomeLevelPenalty),
    'loan',
  );
  discardCard(state, command.playerId, command.cardId);
  pushEvent(state, {type: 'loan_taken', playerId: command.playerId});
}

export function validateScout(state: GameState, command: ScoutCommand): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  if (command.cardIds.length !== 3 || new Set(command.cardIds).size !== 3) {
    return fail('Scout must discard three distinct cards');
  }
  for (const cardId of command.cardIds) {
    const card = requireKnownCardInHand(state, command.playerId, cardId);
    if (!card.ok) return card;
  }
  const player = state.players[command.playerId];
  const hasWild = player.handCardIds.some((cardId) => {
    const type = staticConfig.cardSpecs[cardId]?.type;
    return type === 'wild_location' || type === 'wild_industry';
  });
  if (hasWild) {
    return fail('Scout is not allowed while holding a wild card');
  }
  if (state.cardZones.wildLocationPool.length === 0 || state.cardZones.wildIndustryPool.length === 0) {
    return fail('Wild card pools are empty');
  }
  return ok();
}

export function executeScout(state: GameState, command: ScoutCommand): void {
  const validation = validateScout(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  for (const cardId of command.cardIds) {
    discardCard(state, command.playerId, cardId);
  }
  const wildLocation = state.cardZones.wildLocationPool.pop();
  const wildIndustry = state.cardZones.wildIndustryPool.pop();
  if (!wildLocation || !wildIndustry) {
    throw new Error('Wild card pool unexpectedly empty');
  }
  state.players[command.playerId].handCardIds.push(wildLocation, wildIndustry);
  pushEvent(state, {type: 'scouted', playerId: command.playerId});
}

export function validatePass(state: GameState, command: {type: 'pass'; playerId: string; cardId: string}): ValidationResult {
  const base = validateActingPlayer(state, command.playerId);
  if (!base.ok) return base;
  return requireKnownCardInHand(state, command.playerId, command.cardId);
}

export function executePass(state: GameState, command: {type: 'pass'; playerId: string; cardId: string}): void {
  const validation = validatePass(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  discardCard(state, command.playerId, command.cardId);
}

function drawToHandLimit(state: GameState, playerId: string): void {
  const player = state.players[playerId];
  while (player.handCardIds.length < staticConfig.rules.handSize && state.cardZones.drawDeck.length > 0) {
    player.handCardIds.push(state.cardZones.drawDeck.pop() as string);
  }
}

function createScoreRecord(state: GameState): Record<string, number> {
  return Object.fromEntries(Object.keys(state.players).map((playerId) => [playerId, 0]));
}

export function scoreCurrentEra(state: GameState): EraScoreBreakdown {
  if (state.status !== 'playing') {
    throw new Error('Game is not active');
  }
  if (state.pendingDecision) {
    throw new Error('Pending decision must be resolved first');
  }
  if (state.lastEraScore?.era === state.era) {
    throw new Error(`${state.era} era has already been scored`);
  }

  const score: EraScoreBreakdown = {
    era: state.era,
    linkVictoryPointsByPlayer: createScoreRecord(state),
    industryVictoryPointsByPlayer: createScoreRecord(state),
    totalVictoryPointsByPlayer: createScoreRecord(state),
  };

  for (const link of Object.values(state.board.linkInstances)) {
    if (!isActiveLinkInstance(state, link)) {
      continue;
    }
    const points = scoreLinkValue(state, link.linkLineId);
    gainVictoryPoints(state, link.ownerPlayerId, points, 'link scoring');
    score.linkVictoryPointsByPlayer[link.ownerPlayerId] += points;
    pushEvent(state, {type: 'link_scored', linkInstanceId: link.id, ownerPlayerId: link.ownerPlayerId, points});
  }

  for (const industry of getActiveIndustries(state)) {
    if (!industry.flipped) {
      continue;
    }
    const points = staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
    gainVictoryPoints(state, industry.ownerPlayerId, points, 'industry scoring');
    score.industryVictoryPointsByPlayer[industry.ownerPlayerId] += points;
    pushEvent(state, {type: 'industry_scored', industryInstanceId: industry.id, ownerPlayerId: industry.ownerPlayerId, points});
  }

  for (const playerId of Object.keys(state.players)) {
    score.totalVictoryPointsByPlayer[playerId] =
      score.linkVictoryPointsByPlayer[playerId] + score.industryVictoryPointsByPlayer[playerId];
  }

  state.lastEraScore = score;
  return score;
}

function liquidationValue(industry: IndustryInstance): number {
  return Math.floor(staticConfig.industryTileSpecs[industry.specId].cost.cash / 2);
}

function scoringLossIfRemoved(industry: IndustryInstance): number {
  if (!industry.flipped) {
    return 0;
  }
  return staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints;
}

function negativeIncomeLiquidationCandidates(state: GameState, playerId: string): IndustryInstance[] {
  return getActiveIndustries(state)
    .filter((industry) => industry.ownerPlayerId === playerId && liquidationValue(industry) > 0)
    .sort((a, b) =>
      scoringLossIfRemoved(a) - scoringLossIfRemoved(b) ||
      liquidationValue(b) - liquidationValue(a) ||
      a.id.localeCompare(b.id),
    );
}

function removeIndustryForNegativeIncome(state: GameState, industry: IndustryInstance): void {
  removeIndustryFromBoard(state, industry, 'negative_income');
  const cash = liquidationValue(industry);
  if (cash > 0) {
    gainCash(state, industry.ownerPlayerId, cash, 'negative income liquidation');
  }
}

function loseVictoryPoints(state: GameState, playerId: string, amount: number, reason: string): number {
  if (amount <= 0) {
    return 0;
  }
  const player = getPlayerOrError(state, playerId);
  const before = player.victoryPoints;
  player.victoryPoints = Math.max(0, before - amount);
  const loss = before - player.victoryPoints;
  if (loss > 0) {
    pushEvent(state, {type: 'victory_points_changed', playerId, delta: -loss, reason});
  }
  return loss;
}

function settleNegativeIncomePayment(state: GameState, playerId: string, amount: number): {paid: number; victoryPointLoss: number} {
  const paid = payCashWithoutSpending(state, playerId, amount, 'income');
  const victoryPointLoss = loseVictoryPoints(state, playerId, amount - paid, 'negative income shortfall');
  return {paid, victoryPointLoss};
}

function startNegativeIncomeDecision(state: GameState, playerId: string, amount: number, incomePlayerIndex: number): void {
  state.currentTurnIndex = incomePlayerIndex;
  state.actionIndexInTurn = 0;
  state.pendingDecision = {
    type: 'negative_income',
    playerId,
    amountOwed: amount,
    incomePlayerIndex,
  };
  pushEvent(state, {type: 'negative_income_started', playerId, amountOwed: amount, incomePlayerIndex});
}

function applyNegativeIncomeOrPause(state: GameState, playerId: string, amount: number, incomePlayerIndex: number): boolean {
  const player = getPlayerOrError(state, playerId);
  if (player.cash < amount && negativeIncomeLiquidationCandidates(state, playerId).length > 0) {
    startNegativeIncomeDecision(state, playerId, amount, incomePlayerIndex);
    return false;
  }

  settleNegativeIncomePayment(state, playerId, amount);
  return true;
}

function applyRoundIncomeFrom(state: GameState, startIndex: number): boolean {
  for (let index = startIndex; index < state.turnOrder.length; index++) {
    const playerId = state.turnOrder[index];
    const income = getIncomeLevel(state.players[playerId].incomeTrackPosition);
    if (income > 0) {
      gainCash(state, playerId, income, 'income');
    } else if (income < 0 && !applyNegativeIncomeOrPause(state, playerId, -income, index)) {
      return false;
    }
  }
  return true;
}

export function validateResolveNegativeIncome(state: GameState, command: ResolveNegativeIncomeCommand): ValidationResult {
  if (state.status !== 'playing') {
    return fail('Game is not active');
  }
  const decision = state.pendingDecision;
  if (!decision || decision.type !== 'negative_income') {
    return fail('No pending decision');
  }
  if (decision.playerId !== command.playerId) {
    return fail(`Pending negative income decision belongs to ${decision.playerId}`);
  }

  const player = state.players[command.playerId];
  if (!player) {
    return fail(`Unknown player: ${command.playerId}`);
  }

  const errors: string[] = [];
  const selectedIds = new Set<string>();
  let projectedCash = player.cash;

  for (const industryInstanceId of command.industryInstanceIds) {
    if (selectedIds.has(industryInstanceId)) {
      errors.push(`Industry ${industryInstanceId} selected more than once`);
      continue;
    }

    const industry = state.board.industryInstances[industryInstanceId];
    if (!industry) {
      errors.push(`Unknown industry: ${industryInstanceId}`);
      continue;
    }
    if (industry.ownerPlayerId !== command.playerId) {
      errors.push(`Industry ${industryInstanceId} is not owned by ${command.playerId}`);
      continue;
    }
    if (industry.removedFromGame) {
      errors.push(`Industry ${industryInstanceId} is already removed`);
      continue;
    }
    if (!isActiveIndustryInstance(state, industry)) {
      errors.push(`Industry ${industryInstanceId} is not active`);
      continue;
    }
    if (liquidationValue(industry) <= 0) {
      errors.push(`Industry ${industryInstanceId} cannot raise cash for negative income`);
      continue;
    }
    if (projectedCash >= decision.amountOwed) {
      errors.push('Cannot liquidate more industries after the debt is covered');
      continue;
    }

    selectedIds.add(industryInstanceId);
    projectedCash += liquidationValue(industry);
  }

  const remainingCandidates = negativeIncomeLiquidationCandidates(state, command.playerId)
    .filter((industry) => !selectedIds.has(industry.id));
  if (projectedCash < decision.amountOwed && remainingCandidates.length > 0) {
    errors.push('Negative income requires removing industries until the shortfall is covered or no industries remain');
  }

  return errors.length > 0 ? fail(...errors) : ok();
}

export function validateResolveMerchantDevelop(state: GameState, command: ResolveMerchantDevelopCommand): ValidationResult {
  if (state.status !== 'playing') {
    return fail('Game is not active');
  }
  const decision = state.pendingDecision;
  if (!decision || decision.type !== 'merchant_develop') {
    return fail('No pending decision');
  }
  if (decision.playerId !== command.playerId) {
    return fail(`Pending merchant develop decision belongs to ${decision.playerId}`);
  }
  if (command.industryTypes.length > decision.count) {
    return fail(`Merchant develop can remove at most ${decision.count} tile${decision.count === 1 ? '' : 's'}`);
  }
  const requiredCount = countAvailableMerchantDevelops(state, command.playerId, decision.count);
  if (command.industryTypes.length < requiredCount) {
    return fail(`Merchant develop must remove ${requiredCount} tile${requiredCount === 1 ? '' : 's'}`);
  }
  return validateDevelopIndustryTypes(state, command.playerId, command.industryTypes);
}

export function executeResolveMerchantDevelop(state: GameState, command: ResolveMerchantDevelopCommand): void {
  const validation = validateResolveMerchantDevelop(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  const decision = state.pendingDecision;
  if (!decision || decision.type !== 'merchant_develop') {
    throw new Error('No pending merchant develop decision');
  }

  const specIds = developIndustryTiles(state, command.playerId, command.industryTypes);
  state.pendingDecision = undefined;
  pushEvent(state, {
    type: 'merchant_develop_resolved',
    playerId: command.playerId,
    merchantSpaceId: decision.merchantSpaceId,
    merchantSpaceIds: merchantDevelopSpaceIds(decision),
    industryTypes: [...command.industryTypes],
    specIds,
  });
}

export function executeResolveNegativeIncome(state: GameState, command: ResolveNegativeIncomeCommand): void {
  const validation = validateResolveNegativeIncome(state, command);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }

  const decision = state.pendingDecision;
  if (!decision || decision.type !== 'negative_income') {
    throw new Error('No pending negative income decision');
  }

  for (const industryInstanceId of command.industryInstanceIds) {
    removeIndustryForNegativeIncome(state, state.board.industryInstances[industryInstanceId]);
  }

  const {paid, victoryPointLoss} = settleNegativeIncomePayment(state, command.playerId, decision.amountOwed);
  state.pendingDecision = undefined;
  pushEvent(state, {
    type: 'negative_income_resolved',
    playerId: command.playerId,
    amountOwed: decision.amountOwed,
    paid,
    victoryPointLoss,
    industryInstanceIds: [...command.industryInstanceIds],
  });

  if (applyRoundIncomeFrom(state, decision.incomePlayerIndex + 1)) {
    if (shouldEndEra(state)) {
      endCurrentEra(state, {turnOrderAlreadyUpdated: true});
      if (state.status === 'playing') {
        pushEvent(state, {type: 'turn_advanced', currentPlayerId: getCurrentPlayerId(state), roundNumber: state.roundNumber});
      }
      return;
    }
    finishRoundAfterIncome(state);
    advancePastEmptyHandPlayers(state);
    if (state.pendingDecision) {
      return;
    }
    pushEvent(state, {type: 'turn_advanced', currentPlayerId: getCurrentPlayerId(state), roundNumber: state.roundNumber});
  }
}

function updateTurnOrderAfterRound(state: GameState): void {
  const previousOrder = [...state.turnOrder];
  state.turnOrder = [...previousOrder].sort((a, b) => {
    const spentDelta = state.players[a].spentThisRound - state.players[b].spentThisRound;
    return spentDelta === 0 ? previousOrder.indexOf(a) - previousOrder.indexOf(b) : spentDelta;
  });
  for (const player of Object.values(state.players)) {
    player.spentThisRound = 0;
  }
  pushEvent(state, {type: 'turn_order_updated', order: [...state.turnOrder]});
}

function endRound(state: GameState): void {
  updateTurnOrderAfterRound(state);
  state.currentTurnIndex = 0;
  state.actionIndexInTurn = 0;
  if (!applyRoundIncomeFrom(state, 0)) {
    return;
  }
  finishRoundAfterIncome(state);
}

function finishRoundAfterIncome(state: GameState): void {
  state.roundNumber++;
  state.currentTurnIndex = 0;
  state.actionIndexInTurn = 0;
  state.actionsAllowedThisTurn = state.era === 'canal' && state.roundNumber === 1
    ? staticConfig.rules.firstCanalRoundActions
    : staticConfig.rules.normalActionsPerTurn;
}

function removeAllLinks(state: GameState): void {
  state.board.linkLines = Object.fromEntries(
    Object.keys(staticConfig.linkLines).map((linkLineId) => [linkLineId, {}]),
  );
  state.board.linkInstances = {};
}

function removeCanalEraIndustries(state: GameState): void {
  for (const industry of getActiveIndustries(state)) {
    if (industry.level !== 1) {
      continue;
    }
    removeIndustryFromBoard(state, industry, 'canal_cleanup');
  }
}

function restockMerchantBeer(state: GameState): void {
  for (const space of Object.values(state.board.merchantSpaces)) {
    if (!space.merchantTileInstanceId) {
      space.beerPresent = false;
      continue;
    }
    const specId = getMerchantTileSpecId(space.merchantTileInstanceId);
    const spec = staticConfig.merchantTileSpecs[specId];
    space.beerPresent = Boolean(spec && !spec.blank);
  }
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildRailDeckFromDiscards(state: GameState): string[] {
  const deck: string[] = [];
  for (const playerId of state.turnOrder) {
    deck.push(...state.players[playerId].discardCardIds);
    state.players[playerId].discardCardIds = [];
    state.players[playerId].faceDownDiscardCount = 0;
  }
  const seed = stableHash(`${state.id}:${state.roundNumber}:${state.nextInstanceId}:${deck.join('|')}`);
  return shuffle(deck, new SeededRandom(seed));
}

function determineWinners(state: GameState): string[] {
  const playerIds = Object.keys(state.players);
  const rankValue = (playerId: string) => {
    const player = state.players[playerId];
    return [player.victoryPoints, player.incomeTrackPosition, player.cash] as const;
  };
  const best = playerIds.reduce((leader, playerId) => {
    const leaderRank = rankValue(leader);
    const candidateRank = rankValue(playerId);
    for (let index = 0; index < leaderRank.length; index++) {
      if (candidateRank[index] !== leaderRank[index]) {
        return candidateRank[index] > leaderRank[index] ? playerId : leader;
      }
    }
    return leader;
  }, playerIds[0]);
  const bestRank = rankValue(best);
  return playerIds.filter((playerId) => {
    const rank = rankValue(playerId);
    return rank.every((value, index) => value === bestRank[index]);
  });
}

function shouldEndEra(state: GameState): boolean {
  return state.cardZones.drawDeck.length === 0 &&
    Object.values(state.players).every((player) => player.handCardIds.length === 0);
}

function advancePastEmptyHandPlayers(state: GameState): void {
  if (shouldEndEra(state)) {
    return;
  }

  let checkedPlayers = 0;
  while (checkedPlayers < state.turnOrder.length && state.players[getCurrentPlayerId(state)].handCardIds.length === 0) {
    state.actionIndexInTurn = 0;
    state.currentTurnIndex++;
    checkedPlayers++;
    if (state.currentTurnIndex >= state.turnOrder.length) {
      endRound(state);
      if (state.pendingDecision || shouldEndEra(state)) {
        return;
      }
      checkedPlayers = 0;
    }
  }
}

function settleCanalFinalRoundIncome(state: GameState): boolean {
  updateTurnOrderAfterRound(state);
  state.currentTurnIndex = 0;
  state.actionIndexInTurn = 0;
  return applyRoundIncomeFrom(state, 0);
}

export function endCurrentEra(state: GameState, options: {turnOrderAlreadyUpdated?: boolean} = {}): EraScoreBreakdown {
  if (state.status !== 'playing') {
    throw new Error('Game is not active');
  }
  if (state.pendingDecision) {
    throw new Error('Pending decision must be resolved first');
  }

  const endedEra = state.era;
  const score = scoreCurrentEra(state);
  removeAllLinks(state);
  if (!options.turnOrderAlreadyUpdated) {
    updateTurnOrderAfterRound(state);
  }
  state.currentTurnIndex = 0;
  state.actionIndexInTurn = 0;

  if (endedEra === 'canal') {
    removeCanalEraIndustries(state);
    restockMerchantBeer(state);
    state.cardZones.drawDeck = buildRailDeckFromDiscards(state);
    state.era = 'rail';
    state.roundNumber = 1;
    state.actionsAllowedThisTurn = staticConfig.rules.normalActionsPerTurn;
    for (const playerId of state.turnOrder) {
      drawToHandLimit(state, playerId);
    }
    pushEvent(state, {type: 'era_ended', era: endedEra, score});
    return score;
  }

  state.status = 'ended';
  pushEvent(state, {type: 'era_ended', era: endedEra, score});
  pushEvent(state, {type: 'game_ended', winners: determineWinners(state)});
  return score;
}

export function advanceTurnAfterAction(state: GameState): void {
  const playerId = getCurrentPlayerId(state);
  state.actionIndexInTurn++;
  if (state.actionIndexInTurn < state.actionsAllowedThisTurn && state.players[playerId].handCardIds.length > 0) {
    return;
  }

  if (shouldEndEra(state)) {
    if (state.era === 'canal' && !settleCanalFinalRoundIncome(state)) {
      return;
    }
    endCurrentEra(state, {turnOrderAlreadyUpdated: state.era === 'canal'});
    if (state.status === 'playing') {
      pushEvent(state, {type: 'turn_advanced', currentPlayerId: getCurrentPlayerId(state), roundNumber: state.roundNumber});
    }
    return;
  }

  drawToHandLimit(state, playerId);
  state.actionIndexInTurn = 0;
  state.currentTurnIndex++;
  if (state.currentTurnIndex >= state.turnOrder.length) {
    endRound(state);
    if (state.pendingDecision) {
      return;
    }
  }
  advancePastEmptyHandPlayers(state);
  if (state.pendingDecision) {
    return;
  }
  pushEvent(state, {type: 'turn_advanced', currentPlayerId: getCurrentPlayerId(state), roundNumber: state.roundNumber});
}

export function validateCommand(state: GameState, command: GameCommand): ValidationResult {
  switch (command.type) {
    case 'build':
      return validateBuild(state, command);
    case 'network':
      return validateNetwork(state, command);
    case 'develop':
      return validateDevelop(state, command);
    case 'sell':
      return validateSell(state, command);
    case 'resolve_negative_income':
      return validateResolveNegativeIncome(state, command);
    case 'resolve_merchant_develop':
      return validateResolveMerchantDevelop(state, command);
    case 'loan':
      return validateLoan(state, command);
    case 'scout':
      return validateScout(state, command);
    case 'pass':
      return validatePass(state, command);
    default:
      return fail('Unknown command');
  }
}

function replaceGameState(target: GameState, source: GameState): void {
  for (const key of Object.keys(target)) {
    delete (target as unknown as Record<string, unknown>)[key];
  }
  Object.assign(target, source);
}

function executeCommandUnchecked(state: GameState, command: GameCommand): void {
  switch (command.type) {
    case 'build':
      executeBuild(state, command);
      break;
    case 'network':
      executeNetwork(state, command);
      break;
    case 'develop':
      executeDevelop(state, command);
      break;
    case 'sell':
      executeSell(state, command);
      break;
    case 'resolve_negative_income':
      executeResolveNegativeIncome(state, command);
      return;
    case 'resolve_merchant_develop':
      executeResolveMerchantDevelop(state, command);
      advanceTurnAfterAction(state);
      return;
    case 'loan':
      executeLoan(state, command);
      break;
    case 'scout':
      executeScout(state, command);
      break;
    case 'pass':
      executePass(state, command);
      break;
    default:
      throw new Error('Unknown command');
  }
  if (!state.pendingDecision) {
    advanceTurnAfterAction(state);
  }
}

export function applyCommand(state: GameState, command: GameCommand): GameState {
  const commandSnapshot = structuredClone(command) as GameCommand;
  const candidate = structuredClone(state) as GameState;
  executeCommandUnchecked(candidate, commandSnapshot);
  replaceGameState(state, candidate);
  return state;
}

export function getConnectedLocationsForDebug(state: GameState, locationId: string): string[] {
  return [...connectedComponent(state, locationId)].sort();
}

export function canSellToMerchant(state: GameState, industry: IndustryInstance): boolean {
  return Object.values(state.board.merchantSpaces).some((space) => canSellToMerchantSpace(state, industry, space.id));
}

export function canSellToMerchantSpace(state: GameState, industry: IndustryInstance, merchantSpaceId: string): boolean {
  if (!isActiveIndustryInstance(state, industry) || industry.flipped || !SELLABLE_INDUSTRIES.has(industry.industryType)) {
    return false;
  }
  const spec = staticConfig.industryTileSpecs[industry.specId];
  const beerRequired = spec.beerRequiredToSell ?? 0;
  const target = getMerchantTarget(state, merchantSpaceId);
  if (!target) {
    return false;
  }
  const component = connectedComponent(state, industry.locationId);
  return component.has(target.merchant.id) &&
    merchantAcceptsIndustry(state, merchantSpaceId, industry.industryType) &&
    findBeerCandidatesForSale(state, industry.ownerPlayerId, industry.locationId, merchantSpaceId).length >= beerRequired;
}

export function scoreLinkValue(state: GameState, linkLineId: string): number {
  const line = staticConfig.linkLines[linkLineId];
  const endpointIds = [line.endpointA, line.endpointB, line.viaFarmBreweryId].filter(Boolean) as string[];
  return endpointIds.reduce((sum, locationId) => {
    const location = staticConfig.locations[locationId];
    const printed = location?.printedLinkIcons ?? 0;
    const flippedIcons = getIndustriesAtLocation(state, locationId)
      .filter((industry) => industry.flipped)
      .reduce((total, industry) => total + staticConfig.industryTileSpecs[industry.specId].flip.linkIcons, 0);
    return sum + printed + flippedIcons;
  }, 0);
}

export function isLocationConnectedToCoalMarket(state: GameState, locationId: string): boolean {
  return hasCoalMarketAccess(state, locationId);
}

export function areLocationsConnected(state: GameState, a: string, b: string): boolean {
  return areConnected(state, a, b);
}
