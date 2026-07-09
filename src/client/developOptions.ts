import {validateDevelop} from '../common/gameEngine';
import {staticConfig} from '../common/staticData';
import type {GameState, IndustryType, PlayerState, ResourceSource} from '../common/types';
import {validationOk} from './validation';

export const developIndustryTypes: IndustryType[] = [
  'cotton_mill',
  'coal_mine',
  'iron_works',
  'manufacturer',
  'pottery',
  'brewery',
];

export function developOptionsForSelect(
  player: PlayerState,
  selectedTypes: Array<IndustryType | undefined>,
  index: number,
): IndustryType[] {
  const simulatedStackHeads = new Map<IndustryType, number>();
  for (let selectedIndex = 0; selectedIndex < index; selectedIndex++) {
    const selectedType = selectedTypes[selectedIndex];
    if (selectedType) {
      simulatedStackHeads.set(selectedType, (simulatedStackHeads.get(selectedType) ?? 0) + 1);
    }
  }

  return developIndustryTypes.filter((industryType) => {
    const offset = simulatedStackHeads.get(industryType) ?? 0;
    const specId = player.industryTileStacks[industryType]?.availableSpecIdsInOrder[offset];
    return Boolean(specId && staticConfig.industryTileSpecs[specId]?.canDevelop);
  });
}

export function normalizeDevelopSelections(
  player: PlayerState,
  selectedTypes: Array<IndustryType | undefined>,
  maxCount: number,
): IndustryType[] {
  const normalized: IndustryType[] = [];
  while (normalized.length < maxCount) {
    const options = developOptionsForSelect(player, normalized, normalized.length);
    if (options.length === 0) {
      return normalized;
    }
    const selectedType = selectedTypes[normalized.length];
    normalized.push(selectedType && options.includes(selectedType) ? selectedType : options[0]);
  }
  return normalized;
}

export function canSubmitDevelop(
  game: GameState,
  playerId: string,
  cardId: string,
  industryTypes: IndustryType[],
  ironSources?: ResourceSource[],
): boolean {
  if (industryTypes.length === 0) {
    return false;
  }
  return validationOk(() => validateDevelop(game, {
    type: 'develop',
    playerId,
    cardId,
    industryTypes,
    ironSources,
  }));
}
