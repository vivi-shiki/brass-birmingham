import {describe, expect, it} from 'vitest';
import {
  cashChangeReasonMatchesDelta,
  incomeChangeReasonMatchesMove,
  normalizeGameEventReason,
  resourceConsumptionReasonMatchesSource,
  victoryPointReasonMatchesDelta,
} from '../src/common/eventLogValidation';
import {staticConfig} from '../src/common/staticData';
import type {ResourceSource} from '../src/common/types';

describe('event log validation helpers', () => {
  it('normalizes fixed and industry-derived event reasons', () => {
    expect(normalizeGameEventReason(' build ')).toBe('build');
    expect(normalizeGameEventReason('\tsold cotton_mill\n')).toBe('sold cotton_mill');
    expect(normalizeGameEventReason('flipped brewery')).toBe('flipped brewery');
    expect(normalizeGameEventReason('secret-token')).toBeUndefined();
    expect(normalizeGameEventReason('')).toBeUndefined();
  });

  it('matches cash-change reasons to their legal delta direction', () => {
    expect(cashChangeReasonMatchesDelta('build', -5)).toBe(true);
    expect(cashChangeReasonMatchesDelta('build', 5)).toBe(false);
    expect(cashChangeReasonMatchesDelta('loan', 30)).toBe(true);
    expect(cashChangeReasonMatchesDelta('loan', 31)).toBe(false);
    expect(cashChangeReasonMatchesDelta('loan', -30)).toBe(false);
    expect(cashChangeReasonMatchesDelta('income', 5)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', -3)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', 0)).toBe(false);
  });

  it('matches income-change reasons to legal movement on the income track', () => {
    const start = staticConfig.incomeTrack.startPosition;

    expect(incomeChangeReasonMatchesMove('sold cotton_mill', start, start + 1)).toBe(true);
    expect(incomeChangeReasonMatchesMove('sold cotton_mill', start + 1, start)).toBe(false);
    expect(incomeChangeReasonMatchesMove('merchant bonus', start, start + 2)).toBe(true);
    expect(incomeChangeReasonMatchesMove('loan', start, start - 3)).toBe(true);
    expect(incomeChangeReasonMatchesMove('loan', start, start + 3)).toBe(false);
    expect(incomeChangeReasonMatchesMove('sold cotton_mill', start, start)).toBe(false);
    expect(incomeChangeReasonMatchesMove('sold cotton_mill', -1, start)).toBe(false);
  });

  it('matches victory-point reasons to their legal delta direction', () => {
    expect(victoryPointReasonMatchesDelta('link scoring', 3)).toBe(true);
    expect(victoryPointReasonMatchesDelta('link scoring', -3)).toBe(false);
    expect(victoryPointReasonMatchesDelta('negative income shortfall', -2)).toBe(true);
    expect(victoryPointReasonMatchesDelta('negative income shortfall', 2)).toBe(false);
    expect(victoryPointReasonMatchesDelta('introductory income scoring', 2)).toBe(true);
    expect(victoryPointReasonMatchesDelta('introductory income scoring', -2)).toBe(true);
    expect(victoryPointReasonMatchesDelta('merchant bonus', 0)).toBe(false);
  });

  it('matches resource-consumption reasons to source resource types', () => {
    const coalMarket: ResourceSource = {kind: 'market', market: 'coal', price: 2};
    const ironMarket: ResourceSource = {kind: 'market', market: 'iron', price: 2};
    const breweryBeer: ResourceSource = {kind: 'industry_tile', industryInstanceId: 'brewery-1', resourceType: 'beer'};
    const merchantBeer: ResourceSource = {
      kind: 'merchant_beer',
      merchantSpaceId: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
    };

    expect(resourceConsumptionReasonMatchesSource(coalMarket, 'network')).toBe(true);
    expect(resourceConsumptionReasonMatchesSource(coalMarket, 'sell')).toBe(false);
    expect(resourceConsumptionReasonMatchesSource(ironMarket, 'develop')).toBe(true);
    expect(resourceConsumptionReasonMatchesSource(ironMarket, 'network')).toBe(false);
    expect(resourceConsumptionReasonMatchesSource(breweryBeer, 'network')).toBe(true);
    expect(resourceConsumptionReasonMatchesSource(breweryBeer, 'develop')).toBe(false);
    expect(resourceConsumptionReasonMatchesSource(merchantBeer, 'sell')).toBe(true);
    expect(resourceConsumptionReasonMatchesSource(merchantBeer, 'network')).toBe(false);
  });
});
