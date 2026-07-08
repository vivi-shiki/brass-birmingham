import {staticConfig} from './staticData';

export function getIncomeLevel(position: number): number {
  const clampedPosition = Math.max(0, Math.min(staticConfig.incomeTrack.positions.length - 1, position));
  return staticConfig.incomeTrack.positions[clampedPosition].incomeLevel;
}

export function advanceIncomeSpaces(position: number, spaces: number): number {
  return Math.max(0, Math.min(staticConfig.incomeTrack.positions.length - 1, position + spaces));
}

export function retreatIncomeLevels(position: number, levels: number): number {
  const currentLevel = getIncomeLevel(position);
  const targetLevel = Math.max(staticConfig.incomeTrack.minIncomeLevel, currentLevel - levels);
  const targetPositions = staticConfig.incomeTrack.positions.filter((entry) => entry.incomeLevel === targetLevel);
  return targetPositions[targetPositions.length - 1].position;
}
