import {staticConfig} from '../common/staticData';
import type {GameState, ResourceSource} from '../common/types';

export type ResourceOption = {
  value: string;
  label: string;
};

export function encodeSource(source: ResourceSource): string {
  return JSON.stringify(source);
}

export function decodeSource(value: string): ResourceSource {
  return JSON.parse(value) as ResourceSource;
}

export function optionalSources(values: string[], requiredCount: number): ResourceSource[] | undefined {
  if (requiredCount <= 0) {
    return undefined;
  }
  const selected = values.slice(0, requiredCount);
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

export function marketPrice(game: GameState, marketName: 'coal' | 'iron', purchaseOffset = 0): number {
  const spec = staticConfig.markets[marketName];
  const occupiedCount = Math.max(0, game.markets[marketName].occupiedCount - purchaseOffset);
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

export function normalizeResourceSelection(value: string, options: ResourceOption[]): string {
  if (!value) {
    return '';
  }
  return options.some((option) => option.value === value) ? value : '';
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

export function marketPurchaseOffsetBefore(values: string[], index: number, marketName: 'coal' | 'iron'): number {
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
  return sources
    .map((source) => sourceOption(game, source, selectedValues, index))
    .filter((option) => optionHasRemainingCapacity(game, option, selectedValues, index));
}
