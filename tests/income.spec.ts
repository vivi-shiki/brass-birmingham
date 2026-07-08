import {describe, expect, it} from 'vitest';
import {advanceIncomeSpaces, getIncomeLevel, retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';

describe('income track', () => {
  it('maps the starting position to income level zero', () => {
    expect(getIncomeLevel(staticConfig.incomeTrack.startPosition)).toBe(0);
  });

  it('advances by spaces rather than income levels', () => {
    const start = staticConfig.incomeTrack.startPosition;
    expect(getIncomeLevel(advanceIncomeSpaces(start, 1))).toBe(1);
    expect(getIncomeLevel(advanceIncomeSpaces(start, 2))).toBe(1);
    expect(getIncomeLevel(advanceIncomeSpaces(start, 3))).toBe(2);
  });

  it('loan retreat moves to the highest space of the target income level', () => {
    const start = staticConfig.incomeTrack.startPosition;
    const afterLoan = retreatIncomeLevels(start, 3);

    expect(getIncomeLevel(afterLoan)).toBe(-3);
    expect(getIncomeLevel(afterLoan + 1)).toBe(-2);
  });

  it('loan retreat from a multi-space positive income level lands on the target level highest space', () => {
    const level12HighestPosition = staticConfig.incomeTrack.positions
      .filter((entry) => entry.incomeLevel === 12)
      .at(-1)?.position;
    if (level12HighestPosition === undefined) {
      throw new Error('Missing income level 12');
    }

    const afterLoan = retreatIncomeLevels(level12HighestPosition, 3);

    expect(getIncomeLevel(afterLoan)).toBe(9);
    expect(getIncomeLevel(afterLoan + 1)).toBe(10);
  });
});
