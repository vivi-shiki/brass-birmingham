import {INDUSTRY_TYPES} from './gameSetup';
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

const CASH_GAIN_REASONS = new Set([
  'loan',
  'merchant bonus',
  'negative income liquidation',
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
  return INDUSTRY_TYPES.some((industryType) =>
    reason === `flipped ${industryType}` || reason === `sold ${industryType}`,
  );
}

export function cashChangeReasonMatchesDelta(reason: string, delta: number): boolean {
  if (delta === 0) {
    return false;
  }
  if (reason === 'income') {
    return true;
  }
  if (reason === 'loan') {
    return delta === staticConfig.rules.loanCash;
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
    return to < from;
  }
  return reason === 'merchant bonus' || isIndustryIncomeGainReason(reason)
    ? to > from
    : false;
}

export function victoryPointReasonMatchesDelta(reason: string, delta: number): boolean {
  if (delta === 0) {
    return false;
  }
  if (reason === 'introductory income scoring') {
    return true;
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
