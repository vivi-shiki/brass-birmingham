import {validateResolveMerchantDevelop, validateResolveNegativeIncome} from '../common/gameEngine';
import {getActiveIndustries} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameState, IndustryInstance, IndustryType, MerchantDevelopDecision, ValidationResult} from '../common/types';

function validationReason(validate: () => ValidationResult): string | undefined {
  try {
    const result = validate();
    return result.ok ? undefined : result.errors.join('; ');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function merchantDevelopSourceLabel(decision: MerchantDevelopDecision): string {
  const merchantSpaceIds = decision.merchantSpaceIds && decision.merchantSpaceIds.length > 0
    ? decision.merchantSpaceIds
    : [decision.merchantSpaceId];
  return [...new Set(merchantSpaceIds)].join(', ');
}

export function canSubmitResolveMerchantDevelop(
  game: GameState,
  playerId: string,
  industryTypes: IndustryType[],
): boolean {
  return !resolveMerchantDevelopDecisionReason(game, playerId, industryTypes);
}

export function resolveMerchantDevelopDecisionReason(
  game: GameState,
  playerId: string,
  industryTypes: IndustryType[],
): string | undefined {
  return validationReason(() => validateResolveMerchantDevelop(game, {
    type: 'resolve_merchant_develop',
    playerId,
    industryTypes,
  }));
}

export function canSubmitResolveNegativeIncome(
  game: GameState,
  playerId: string,
  industryInstanceIds: string[],
): boolean {
  return !resolveNegativeIncomeDecisionReason(game, playerId, industryInstanceIds);
}

export function resolveNegativeIncomeDecisionReason(
  game: GameState,
  playerId: string,
  industryInstanceIds: string[],
): string | undefined {
  return validationReason(() => validateResolveNegativeIncome(game, {
    type: 'resolve_negative_income',
    playerId,
    industryInstanceIds,
  }));
}

export function industryLiquidationValue(industry: IndustryInstance): number {
  return Math.floor(staticConfig.industryTileSpecs[industry.specId].cost.cash / 2);
}

function scoringLossIfRemoved(industry: IndustryInstance): number {
  return industry.flipped
    ? staticConfig.industryTileSpecs[industry.specId].flip.victoryPoints
    : 0;
}

export function negativeIncomeIndustryOptions(game: GameState, playerId: string): IndustryInstance[] {
  return getActiveIndustries(game)
    .filter((industry) => industry.ownerPlayerId === playerId && industryLiquidationValue(industry) > 0)
    .sort((a, b) =>
      scoringLossIfRemoved(a) - scoringLossIfRemoved(b) ||
      industryLiquidationValue(b) - industryLiquidationValue(a) ||
      a.id.localeCompare(b.id),
    );
}
