import {advanceIncomeSpaces, retreatIncomeLevels} from './income';
import {staticConfig} from './staticData';
import type {ResourceSource, ResourceType} from './types';

const GAME_EVENT_REASONS = new Set([
  'build',
  'network',
  'develop',
  'develop iron',
  'sell',
  'loan',
  'income',
  'merchant bonus',
  'link scoring',
  'industry scoring',
  'negative income liquidation',
  'negative income shortfall',
  'introductory money scoring',
  'introductory income scoring',
  'introductory industry scoring',
  'sold coal to market',
  'sold iron to market',
]);

const VALID_INCOME_TRACK_POSITIONS = new Set(staticConfig.incomeTrack.positions.map((entry) => entry.position));
const VALID_INCOME_LEVELS = new Set(staticConfig.incomeTrack.positions.map((entry) => entry.incomeLevel));
const INTRODUCTORY_MONEY_SCORING_VICTORY_POINT_DELTAS = new Set(
  Array.from({length: 15}, (_, index) => index + 1),
);
const INTRODUCTORY_INDUSTRY_SCORING_VICTORY_POINT_DELTAS = new Set(Object.values(staticConfig.industryTileSpecs)
  .filter((spec) => spec.level >= 2 && spec.buildableEras.includes('canal'))
  .map((spec) => spec.flip.victoryPoints));
const NEGATIVE_INCOME_LIQUIDATION_CASH_DELTAS = new Set(Object.values(staticConfig.industryTileSpecs)
  .map((spec) => Math.floor(spec.cost.cash / 2))
  .filter((value) => value > 0));
const MERCHANT_BONUSES = Object.values(staticConfig.locations)
  .filter((location) => location.kind === 'merchant')
  .map((location) => location.bonus);
const MERCHANT_CASH_BONUSES = new Set(MERCHANT_BONUSES
  .filter((bonus) => bonus.type === 'cash')
  .map((bonus) => bonus.cash));
const MERCHANT_INCOME_SPACE_BONUSES = new Set(MERCHANT_BONUSES
  .filter((bonus) => bonus.type === 'income_spaces')
  .map((bonus) => bonus.spaces));
const MERCHANT_VICTORY_POINT_BONUSES = new Set(MERCHANT_BONUSES
  .filter((bonus) => bonus.type === 'victory_points')
  .map((bonus) => bonus.points));
const INDUSTRY_INCOME_SPACES_BY_REASON = new Map<string, Set<number>>();

for (const spec of Object.values(staticConfig.industryTileSpecs)) {
  const reasonPrefix = spec.flip.trigger === 'resource_depleted' ? 'flipped' : 'sold';
  const reason = `${reasonPrefix} ${spec.industryType}`;
  const incomeSpaces = INDUSTRY_INCOME_SPACES_BY_REASON.get(reason) ?? new Set<number>();
  incomeSpaces.add(spec.flip.incomeSpaces);
  INDUSTRY_INCOME_SPACES_BY_REASON.set(reason, incomeSpaces);
}

const CASH_GAIN_REASONS = new Set([
  'loan',
  'merchant bonus',
  'sold coal to market',
  'sold iron to market',
]);

const CASH_SPEND_REASONS = new Set([
  'build',
  'network',
  'develop iron',
]);

const VICTORY_POINT_GAIN_REASONS = new Set([
  'merchant bonus',
  'link scoring',
  'industry scoring',
  'introductory money scoring',
  'introductory industry scoring',
]);

const VICTORY_POINT_LOSS_REASONS = new Set([
  'negative income shortfall',
]);

export function normalizeGameEventReason(value: unknown): string | undefined {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) {
    return undefined;
  }
  if (GAME_EVENT_REASONS.has(reason)) {
    return reason;
  }
  return isIndustryIncomeGainReason(reason) ? reason : undefined;
}

function isIndustryIncomeGainReason(reason: string): boolean {
  return INDUSTRY_INCOME_SPACES_BY_REASON.has(reason);
}

export function cashChangeReasonMatchesDelta(reason: string, delta: number): boolean {
  if (delta === 0) {
    return false;
  }
  if (reason === 'income') {
    return VALID_INCOME_LEVELS.has(delta);
  }
  if (reason === 'loan') {
    return delta === staticConfig.rules.loanCash;
  }
  if (reason === 'merchant bonus') {
    return MERCHANT_CASH_BONUSES.has(delta);
  }
  if (reason === 'sold coal to market') {
    return staticConfig.markets.coal.priceSlotsCheapestToMostExpensive.includes(delta);
  }
  if (reason === 'sold iron to market') {
    return staticConfig.markets.iron.priceSlotsCheapestToMostExpensive.includes(delta);
  }
  if (reason === 'negative income liquidation') {
    return NEGATIVE_INCOME_LIQUIDATION_CASH_DELTAS.has(delta);
  }
  if (CASH_GAIN_REASONS.has(reason)) {
    return delta > 0;
  }
  if (CASH_SPEND_REASONS.has(reason)) {
    return delta < 0;
  }
  return false;
}

export function incomeChangeReasonMatchesMove(reason: string, from: number, to: number): boolean {
  if (!VALID_INCOME_TRACK_POSITIONS.has(from) || !VALID_INCOME_TRACK_POSITIONS.has(to) || from === to) {
    return false;
  }
  if (reason === 'loan') {
    return to === retreatIncomeLevels(from, staticConfig.rules.loanIncomeLevelPenalty);
  }
  if (reason === 'merchant bonus') {
    return [...MERCHANT_INCOME_SPACE_BONUSES].some((spaces) => to === advanceIncomeSpaces(from, spaces));
  }
  const industryIncomeSpaces = INDUSTRY_INCOME_SPACES_BY_REASON.get(reason);
  return industryIncomeSpaces === undefined
    ? false
    : [...industryIncomeSpaces].some((spaces) => to === advanceIncomeSpaces(from, spaces));
}

export function victoryPointReasonMatchesDelta(reason: string, delta: number): boolean {
  if (delta === 0) {
    return false;
  }
  if (reason === 'introductory money scoring') {
    return INTRODUCTORY_MONEY_SCORING_VICTORY_POINT_DELTAS.has(delta);
  }
  if (reason === 'introductory income scoring') {
    return VALID_INCOME_LEVELS.has(delta);
  }
  if (reason === 'introductory industry scoring') {
    return INTRODUCTORY_INDUSTRY_SCORING_VICTORY_POINT_DELTAS.has(delta);
  }
  if (reason === 'merchant bonus') {
    return MERCHANT_VICTORY_POINT_BONUSES.has(delta);
  }
  if (VICTORY_POINT_GAIN_REASONS.has(reason)) {
    return delta > 0;
  }
  if (VICTORY_POINT_LOSS_REASONS.has(reason)) {
    return delta < 0;
  }
  return false;
}

function resourceTypeForConsumedSource(source: ResourceSource): ResourceType {
  if (source.kind === 'merchant_beer') {
    return 'beer';
  }
  if (source.kind === 'market') {
    return source.market;
  }
  return source.resourceType;
}

export function resourceConsumptionReasonMatchesSource(source: ResourceSource, reason: string): boolean {
  if (source.kind === 'merchant_beer') {
    return reason === 'sell';
  }
  switch (resourceTypeForConsumedSource(source)) {
    case 'coal':
      return reason === 'build' || reason === 'network';
    case 'iron':
      return reason === 'build' || reason === 'develop' || reason === 'develop iron';
    case 'beer':
      return reason === 'sell' || reason === 'network';
  }
}
