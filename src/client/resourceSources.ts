import {staticConfig} from '../common/staticData';
import type {GameState, ResourceSource} from '../common/types';

export type ResourceOption = {
  value: string;
  label: string;
};

type MarketName = 'coal' | 'iron';

export function encodeSource(source: ResourceSource): string {
  return JSON.stringify(source);
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMarketName(value: unknown): value is MarketName {
  return value === 'coal' || value === 'iron';
}

function isConfiguredMarketPrice(marketName: MarketName, price: number): boolean {
  const spec = staticConfig.markets[marketName];
  return spec.priceSlotsCheapestToMostExpensive.includes(price) || spec.fallbackPriceWhenEmpty === price;
}

function isResourceSource(value: unknown): value is ResourceSource {
  if (!isObjectMap(value)) {
    return false;
  }

  if (value.kind === 'industry_tile') {
    return nonEmptyString(value.industryInstanceId) &&
      (value.resourceType === 'coal' || value.resourceType === 'iron' || value.resourceType === 'beer');
  }

  if (value.kind === 'market') {
    if (
      !isMarketName(value.market) ||
      typeof value.price !== 'number' ||
      !Number.isFinite(value.price) ||
      !Number.isInteger(value.price) ||
      value.price < 0
    ) {
      return false;
    }
    return isConfiguredMarketPrice(value.market, value.price);
  }

  if (value.kind === 'merchant_beer') {
    return nonEmptyString(value.merchantSpaceId) && nonEmptyString(value.merchantTileInstanceId);
  }

  return false;
}

export function decodeSource(value: string): ResourceSource {
  const source = JSON.parse(value) as unknown;
  if (!isResourceSource(source)) {
    throw new Error('Invalid resource source');
  }
  if (source.kind === 'industry_tile') {
    return {
      kind: 'industry_tile',
      industryInstanceId: source.industryInstanceId.trim(),
      resourceType: source.resourceType,
    };
  }
  if (source.kind === 'merchant_beer') {
    return {
      kind: 'merchant_beer',
      merchantSpaceId: source.merchantSpaceId.trim(),
      merchantTileInstanceId: source.merchantTileInstanceId.trim(),
    };
  }
  return {
    kind: 'market',
    market: source.market,
    price: source.price,
  };
}

export function optionalSources(values: string[], requiredCount: number): ResourceSource[] | undefined {
  if (requiredCount <= 0) {
    return undefined;
  }
  const selected = values.slice(0, requiredCount);
  if (selected.length !== requiredCount) {
    return undefined;
  }
  if (!selected.every(Boolean)) {
    return undefined;
  }

  const sources = selected.map((value) => {
    try {
      return decodeSource(value);
    } catch {
      return undefined;
    }
  });
  return sources.every((source): source is ResourceSource => Boolean(source)) ? sources : undefined;
}

export function marketOccupiedCount(game: GameState, marketName: MarketName): number {
  const spec = staticConfig.markets[marketName];
  const market = (game as unknown as {
    markets?: Partial<Record<MarketName, {occupiedCount?: unknown} | null>>;
  }).markets?.[marketName];
  const occupiedCount = market?.occupiedCount;
  if (typeof occupiedCount !== 'number' || !Number.isInteger(occupiedCount) || occupiedCount < 0) {
    return spec.initialOccupiedCount;
  }
  return Math.min(occupiedCount, spec.priceSlotsCheapestToMostExpensive.length);
}

export function marketPrice(game: GameState, marketName: MarketName, purchaseOffset = 0): number {
  const spec = staticConfig.markets[marketName];
  const occupiedCount = Math.max(0, marketOccupiedCount(game, marketName) - purchaseOffset);
  if (occupiedCount <= 0) {
    return spec.fallbackPriceWhenEmpty;
  }
  const index = spec.priceSlotsCheapestToMostExpensive.length - occupiedCount;
  return spec.priceSlotsCheapestToMostExpensive[index] ?? spec.fallbackPriceWhenEmpty;
}

function selectedSource(value: string): ResourceSource | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeSource(value);
  } catch {
    return undefined;
  }
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

export function optionalSource(value: string): ResourceSource | undefined {
  return selectedSource(value);
}

export function resourceSourcesForBuildSlot(
  game: GameState,
  slotId: string,
  sources: ResourceSource[],
): ResourceSource[] {
  const occupiedBy = game.board.slots[slotId]?.occupiedBy;
  if (!occupiedBy) {
    return sources;
  }

  return sources.filter((source) => source.kind !== 'industry_tile' || source.industryInstanceId !== occupiedBy);
}

export function normalizeResourceSelection(value: string, options: ResourceOption[]): string {
  if (!value) {
    return '';
  }
  if (options.some((option) => option.value === value)) {
    return value;
  }

  const source = selectedSource(value);
  if (!source) {
    return '';
  }
  const key = sourceKey(source);
  return options.find((option) => {
    const optionSource = selectedSource(option.value);
    return optionSource ? sourceKey(optionSource) === key : false;
  })?.value ?? '';
}

function selectedSourceCount(values: string[], source: ResourceSource, exceptIndex: number): number {
  const key = sourceKey(source);
  return values.filter((value, index) => {
    if (index === exceptIndex) {
      return false;
    }
    const selected = selectedSource(value);
    return selected ? sourceKey(selected) === key : false;
  }).length;
}

function optionHasRemainingCapacity(game: GameState, option: ResourceOption, selectedValues: string[], index: number): boolean {
  const source = selectedSource(option.value);
  if (!source || source.kind === 'market') {
    return true;
  }

  const usedElsewhere = selectedSourceCount(selectedValues, source, index);
  if (source.kind === 'merchant_beer') {
    return usedElsewhere < 1;
  }

  const industry = game.board.industryInstances[source.industryInstanceId];
  return Boolean(industry && usedElsewhere < industry.remainingResource);
}

export function marketPurchaseOffsetBefore(values: string[], index: number, marketName: MarketName): number {
  return values
    .slice(0, index)
    .filter((value) => {
      const source = selectedSource(value);
      return source?.kind === 'market' && source.market === marketName;
    })
    .length;
}

function sourceOption(game: GameState, source: ResourceSource, selectedValues: string[], index: number): ResourceOption {
  if (source.kind === 'market') {
    const purchaseNumber = marketPurchaseOffsetBefore(selectedValues, index, source.market) + 1;
    return {
      value: encodeSource(source),
      label: `${source.market} market purchase ${purchaseNumber} (${source.price})`,
    };
  }
  if (source.kind === 'merchant_beer') {
    return {
      value: encodeSource(source),
      label: `${source.merchantSpaceId}: merchant beer`,
    };
  }

  const industry = game.board.industryInstances[source.industryInstanceId];
  return {
    value: encodeSource(source),
    label: `${industry?.id ?? source.industryInstanceId}: ${industry?.ownerPlayerId ?? '?'} ${source.resourceType} at ${industry?.locationId ?? '?'} (${industry?.remainingResource ?? '?'})`,
  };
}

export function resourceOptionsFromSources(
  game: GameState,
  sources: ResourceSource[],
  selectedValues: string[],
  index: number,
): ResourceOption[] {
  const options: ResourceOption[] = [];
  const seenValues = new Set<string>();
  for (const source of sources) {
    const option = sourceOption(game, source, selectedValues, index);
    if (seenValues.has(option.value) || !optionHasRemainingCapacity(game, option, selectedValues, index)) {
      continue;
    }
    seenValues.add(option.value);
    options.push(option);
  }
  return options;
}
