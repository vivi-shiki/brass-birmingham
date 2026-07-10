import {describe, expect, it} from 'vitest';
import {
  cashChangeReasonMatchesDelta,
  incomeChangeReasonMatchesMove,
  normalizeGameEventReason,
  resourceConsumptionReasonMatchesSource,
  victoryPointReasonMatchesDelta,
} from '../src/common/eventLogValidation';
import {advanceIncomeSpaces, retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';
import type {ResourceSource} from '../src/common/types';

describe('event log validation helpers', () => {
  it('normalizes fixed and industry-derived event reasons', () => {
    expect(normalizeGameEventReason(' build ')).toBe('build');
    expect(normalizeGameEventReason('\tsold cotton_mill\n')).toBe('sold cotton_mill');
    expect(normalizeGameEventReason('flipped brewery')).toBe('flipped brewery');
    expect(normalizeGameEventReason('sold brewery')).toBeUndefined();
    expect(normalizeGameEventReason('flipped cotton_mill')).toBeUndefined();
    expect(normalizeGameEventReason('secret-token')).toBeUndefined();
    expect(normalizeGameEventReason('')).toBeUndefined();
  });

  it('matches cash-change reasons to their legal delta direction', () => {
    expect(cashChangeReasonMatchesDelta('build', -5)).toBe(true);
    expect(cashChangeReasonMatchesDelta('build', 5)).toBe(false);
    expect(cashChangeReasonMatchesDelta('loan', 30)).toBe(true);
    expect(cashChangeReasonMatchesDelta('loan', 31)).toBe(false);
    expect(cashChangeReasonMatchesDelta('loan', -30)).toBe(false);
    expect(cashChangeReasonMatchesDelta('merchant bonus', 5)).toBe(true);
    expect(cashChangeReasonMatchesDelta('merchant bonus', 4)).toBe(false);
    expect(cashChangeReasonMatchesDelta('sold coal to market', 8)).toBe(true);
    expect(cashChangeReasonMatchesDelta('sold iron to market', 6)).toBe(true);
    expect(cashChangeReasonMatchesDelta('sold coal to market', 99)).toBe(false);
    expect(cashChangeReasonMatchesDelta('sold iron to market', 99)).toBe(false);
    expect(cashChangeReasonMatchesDelta('sold coal to market', -1)).toBe(false);
    expect(cashChangeReasonMatchesDelta('income', 5)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', -3)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', staticConfig.incomeTrack.maxIncomeLevel)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', staticConfig.incomeTrack.minIncomeLevel)).toBe(true);
    expect(cashChangeReasonMatchesDelta('income', staticConfig.incomeTrack.maxIncomeLevel + 1)).toBe(false);
    expect(cashChangeReasonMatchesDelta('income', staticConfig.incomeTrack.minIncomeLevel - 1)).toBe(false);
    expect(cashChangeReasonMatchesDelta('income', 0)).toBe(false);
    expect(cashChangeReasonMatchesDelta(
      'negative income liquidation',
      Math.floor(staticConfig.industryTileSpecs['pottery-5-1'].cost.cash / 2),
    )).toBe(true);
    expect(cashChangeReasonMatchesDelta(
      'negative income liquidation',
      Math.floor(staticConfig.industryTileSpecs['pottery-5-1'].cost.cash / 2) + 1,
    )).toBe(false);
  });

  it('matches income-change reasons to legal movement on the income track', () => {
    const start = staticConfig.incomeTrack.startPosition;
    const level12Positions = staticConfig.incomeTrack.positions
      .filter((entry) => entry.incomeLevel === 12)
      .map((entry) => entry.position);
    const level12HighestPosition = level12Positions[level12Positions.length - 1];
    const level9LowestPosition = staticConfig.incomeTrack.positions
      .find((entry) => entry.incomeLevel === 9)?.position;

    expect(incomeChangeReasonMatchesMove('sold cotton_mill', start, advanceIncomeSpaces(start, 5))).toBe(true);
    expect(incomeChangeReasonMatchesMove('sold cotton_mill', start, advanceIncomeSpaces(start, 1))).toBe(false);
    expect(incomeChangeReasonMatchesMove('flipped brewery', start, advanceIncomeSpaces(start, 4))).toBe(true);
    expect(incomeChangeReasonMatchesMove('flipped brewery', start, advanceIncomeSpaces(start, 3))).toBe(false);
    expect(incomeChangeReasonMatchesMove('sold brewery', start, advanceIncomeSpaces(start, 4))).toBe(false);
    expect(incomeChangeReasonMatchesMove('flipped cotton_mill', start, advanceIncomeSpaces(start, 5))).toBe(false);
    expect(incomeChangeReasonMatchesMove('merchant bonus', start, advanceIncomeSpaces(start, 2))).toBe(true);
    expect(incomeChangeReasonMatchesMove('merchant bonus', start, advanceIncomeSpaces(start, 1))).toBe(false);
    expect(incomeChangeReasonMatchesMove('loan', start, retreatIncomeLevels(start, staticConfig.rules.loanIncomeLevelPenalty))).toBe(true);
    expect(incomeChangeReasonMatchesMove(
      'loan',
      level12HighestPosition,
      retreatIncomeLevels(level12HighestPosition, staticConfig.rules.loanIncomeLevelPenalty),
    )).toBe(true);
    expect(incomeChangeReasonMatchesMove('loan', start, retreatIncomeLevels(start, 2))).toBe(false);
    expect(incomeChangeReasonMatchesMove('loan', level12HighestPosition, level9LowestPosition ?? -1)).toBe(false);
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
    expect(victoryPointReasonMatchesDelta('introductory income scoring', staticConfig.incomeTrack.maxIncomeLevel)).toBe(true);
    expect(victoryPointReasonMatchesDelta('introductory income scoring', staticConfig.incomeTrack.minIncomeLevel)).toBe(true);
    expect(victoryPointReasonMatchesDelta('introductory income scoring', staticConfig.incomeTrack.maxIncomeLevel + 1)).toBe(false);
    expect(victoryPointReasonMatchesDelta('introductory income scoring', staticConfig.incomeTrack.minIncomeLevel - 1)).toBe(false);
    expect(victoryPointReasonMatchesDelta('introductory money scoring', 15)).toBe(true);
    expect(victoryPointReasonMatchesDelta('introductory money scoring', 16)).toBe(false);
    expect(victoryPointReasonMatchesDelta(
      'introductory industry scoring',
      staticConfig.industryTileSpecs['manufacturer-3-1'].flip.victoryPoints,
    )).toBe(true);
    expect(victoryPointReasonMatchesDelta(
      'introductory industry scoring',
      staticConfig.industryTileSpecs['pottery-5-1'].flip.victoryPoints,
    )).toBe(false);
    expect(victoryPointReasonMatchesDelta('merchant bonus', 3)).toBe(true);
    expect(victoryPointReasonMatchesDelta('merchant bonus', 4)).toBe(true);
    expect(victoryPointReasonMatchesDelta('merchant bonus', 5)).toBe(false);
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
