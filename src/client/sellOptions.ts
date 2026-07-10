import {canSellToMerchant, canSellToMerchantSpace, validateSell} from '../common/gameEngine';
import {getActiveIndustries} from '../common/selectors';
import type {GameState, IndustryInstance, MerchantSpaceState, SellStep} from '../common/types';
import {validationOk} from './validation';

export type SellStepDraft = {
  industryId: string;
  merchantSpaceId: string;
  beerOne: string;
  beerTwo: string;
};

export function createSellStepDraft(): SellStepDraft {
  return {industryId: '', merchantSpaceId: '', beerOne: '', beerTwo: ''};
}

export function sellableIndustriesForPlayer(game: GameState, playerId: string): IndustryInstance[] {
  return getActiveIndustries(game)
    .filter((industry) =>
      industry.ownerPlayerId === playerId &&
      !industry.flipped &&
      (industry.industryType === 'cotton_mill' ||
        industry.industryType === 'manufacturer' ||
        industry.industryType === 'pottery') &&
      canSellToMerchant(game, industry),
    );
}

export function merchantSpacesWithTiles(game: GameState): MerchantSpaceState[] {
  return Object.values(game.board.merchantSpaces)
    .filter((space) => Boolean(space.merchantTileInstanceId));
}

export function merchantSpacesForSellIndustry(
  game: GameState,
  industryId: string,
  merchantSpaces = merchantSpacesWithTiles(game),
): MerchantSpaceState[] {
  const industry = game.board.industryInstances[industryId];
  return industry ? merchantSpaces.filter((space) => canSellToMerchantSpace(game, industry, space.id)) : [];
}

export function sellableIndustriesForSellStep(
  sellableIndustries: IndustryInstance[],
  steps: SellStepDraft[],
  index: number,
): IndustryInstance[] {
  const currentIndustryId = steps[index]?.industryId;
  const selectedElsewhere = new Set(steps
    .filter((_, stepIndex) => stepIndex !== index)
    .map((step) => step.industryId)
    .filter(Boolean));
  return sellableIndustries.filter((industry) => industry.id === currentIndustryId || !selectedElsewhere.has(industry.id));
}

export function normalizeSellStepDrafts(game: GameState, playerId: string, steps: SellStepDraft[]): SellStepDraft[] {
  const sellableIndustries = sellableIndustriesForPlayer(game, playerId);
  const merchantSpaces = merchantSpacesWithTiles(game);
  const desiredLength = Math.min(Math.max(steps.length, 1), Math.max(sellableIndustries.length, 1));
  const next = steps.slice(0, desiredLength);
  while (next.length < desiredLength) {
    next.push(createSellStepDraft());
  }

  const usedIndustryIds = new Set<string>();
  let changed = next.length !== steps.length;
  const normalized = next.map((step) => {
    let industryId = step.industryId;
    if (!sellableIndustries.some((industry) => industry.id === industryId) || usedIndustryIds.has(industryId)) {
      industryId = sellableIndustries.find((industry) => !usedIndustryIds.has(industry.id))?.id ?? '';
    }
    if (industryId) {
      usedIndustryIds.add(industryId);
    }

    const validMerchantSpaces = merchantSpacesForSellIndustry(game, industryId, merchantSpaces);
    const merchantSpaceId = validMerchantSpaces.some((space) => space.id === step.merchantSpaceId)
      ? step.merchantSpaceId
      : validMerchantSpaces[0]?.id ?? '';
    const keepBeerSources = Boolean(industryId && merchantSpaceId) &&
      industryId === step.industryId &&
      merchantSpaceId === step.merchantSpaceId;
    const normalizedStep = {
      ...step,
      industryId,
      merchantSpaceId,
      beerOne: keepBeerSources ? step.beerOne : '',
      beerTwo: keepBeerSources ? step.beerTwo : '',
    };
    changed = changed ||
      normalizedStep.industryId !== step.industryId ||
      normalizedStep.merchantSpaceId !== step.merchantSpaceId ||
      normalizedStep.beerOne !== step.beerOne ||
      normalizedStep.beerTwo !== step.beerTwo;
    return normalizedStep;
  });
  return changed ? normalized : steps;
}

export function addSellStepDraft(game: GameState, playerId: string, steps: SellStepDraft[]): SellStepDraft[] {
  const sellableIndustries = sellableIndustriesForPlayer(game, playerId);
  const merchantSpaces = merchantSpacesWithTiles(game);
  const selectedIndustryIds = new Set(steps.map((step) => step.industryId).filter(Boolean));
  const industryId = sellableIndustries.find((industry) => !selectedIndustryIds.has(industry.id))?.id ?? '';
  if (!industryId) {
    return steps;
  }
  return [...steps, {
    ...createSellStepDraft(),
    industryId,
    merchantSpaceId: merchantSpacesForSellIndustry(game, industryId, merchantSpaces)[0]?.id ?? '',
  }];
}

export function canSubmitSell(
  game: GameState,
  playerId: string,
  cardId: string,
  sales: SellStep[],
): boolean {
  if (sales.length === 0) {
    return false;
  }
  return validationOk(() => validateSell(game, {
    type: 'sell',
    playerId,
    cardId,
    sales,
  }));
}
