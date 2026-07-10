import {describe, expect, it} from 'vitest';
import {applyCommand, validateCommand} from '../src/common/gameEngine';
import {retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';
import {addIndustry, firstHandCard, testGame} from './helpers';

function positionForIncomeLevel(incomeLevel: number): number {
  const position = staticConfig.incomeTrack.positions.find((entry) => entry.incomeLevel === incomeLevel);
  if (!position) {
    throw new Error(`No income position for level ${incomeLevel}`);
  }
  return position.position;
}

function finishRoundWithPasses(state: ReturnType<typeof testGame>): void {
  applyCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});
  applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});
}

describe('round income', () => {
  it('pays positive income at the end of a round', () => {
    const state = testGame();
    state.players.p1.incomeTrackPosition = positionForIncomeLevel(5);

    finishRoundWithPasses(state);

    expect(state.roundNumber).toBe(2);
    expect(state.players.p1.cash).toBe(22);
    expect(state.eventLog).toContainEqual({type: 'cash_changed', playerId: 'p1', delta: 5, reason: 'income'});
  });

  it('pays negative income from cash without affecting next-round spending order', () => {
    const state = testGame();
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);

    finishRoundWithPasses(state);

    expect(state.players.p1.cash).toBe(14);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.turnOrder).toEqual(['p1', 'p2']);
  });

  it('keeps action-spending turn order after negative-income liquidation', () => {
    const state = testGame();
    state.players.p1.cash = 4;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    applyCommand(state, {type: 'network', playerId: 'p1', cardId: firstHandCard(state, 'p1'), linkLineIds: ['birmingham-walsall']});
    applyCommand(state, {type: 'pass', playerId: 'p2', cardId: firstHandCard(state, 'p2')});

    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 1,
    });
    expect(state.turnOrder).toEqual(['p2', 'p1']);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.turnOrder).toEqual(['p2', 'p1']);
    expect(state.players.p1.spentThisRound).toBe(0);
    expect(state.players.p2.spentThisRound).toBe(0);
    expect(state.players.p1.cash).toBe(2);
  });

  it('pauses for manual industry liquidation when cash cannot cover negative income', () => {
    const state = testGame();
    state.players.p1.cash = 1;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    state.players.p2.incomeTrackPosition = positionForIncomeLevel(4);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [cotton.id];

    finishRoundWithPasses(state);

    expect(state.roundNumber).toBe(1);
    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    });
    expect(state.players.p1.cash).toBe(1);
    expect(state.players.p2.cash).toBe(17);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(false);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.players.p1.cash).toBe(2);
    expect(state.players.p2.cash).toBe(21);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(true);
    expect(state.board.slots['birmingham-0'].occupiedBy).toBeUndefined();
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(cotton.id);
    expect(state.eventLog).toContainEqual({type: 'industry_removed', industryInstanceId: cotton.id, reason: 'negative_income'});
    expect(state.eventLog).toContainEqual({
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [cotton.id],
    });
  });

  it('allows flipped industries to be liquidated for negative income', () => {
    const state = testGame();
    state.players.p1.cash = 1;
    state.players.p1.victoryPoints = 8;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    const cotton = addIndustry(state, {
      id: 'flipped-cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      flipped: true,
    });
    state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds = [cotton.id];

    finishRoundWithPasses(state);

    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    });

    const validation = validateCommand(state, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [cotton.id],
    });
    expect(validation.ok).toBe(true);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(true);
    expect(state.players.p1.industryTileStacks.cotton_mill.builtInstanceIds).not.toContain(cotton.id);
    expect(state.players.p1.cash).toBe(2);
    expect(state.players.p1.victoryPoints).toBe(8);
    expect(state.eventLog).toContainEqual({type: 'industry_removed', industryInstanceId: cotton.id, reason: 'negative_income'});
    expect(state.eventLog).toContainEqual({
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 5,
      paid: 5,
      victoryPointLoss: 0,
      industryInstanceIds: [cotton.id],
    });
  });

  it('continues income settlement into another negative-income decision after resolving the first one', () => {
    const state = testGame();
    state.players.p1.cash = 1;
    state.players.p2.cash = 0;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    state.players.p2.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
    const p1Cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const p2Cotton = addIndustry(state, {
      id: 'cotton-2',
      ownerPlayerId: 'p2',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'worcester',
      slotId: 'worcester-0',
    });

    finishRoundWithPasses(state);

    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    });

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [p1Cotton.id]});

    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p2',
      amountOwed: 3,
      incomePlayerIndex: 1,
    });
    expect(state.roundNumber).toBe(1);
    expect(state.board.industryInstances[p1Cotton.id].removedFromGame).toBe(true);
    expect(state.board.industryInstances[p2Cotton.id].removedFromGame).toBe(false);
    expect(state.players.p1.cash).toBe(2);
    expect(state.players.p2.cash).toBe(0);

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p2', industryInstanceIds: [p2Cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.board.industryInstances[p2Cotton.id].removedFromGame).toBe(true);
    expect(state.players.p2.cash).toBe(3);
    expect(state.eventLog.filter((event) => event.type === 'negative_income_resolved')).toHaveLength(2);
  });

  it('clamps victory point loss after liquidating every available industry for negative income', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.players.p1.victoryPoints = 2;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 9);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    finishRoundWithPasses(state);

    expect(state.pendingDecision).toEqual({
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 9,
      incomePlayerIndex: 0,
    });

    applyCommand(state, {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: [cotton.id]});

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.players.p1.cash).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(0);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(true);
    expect(state.eventLog).toContainEqual({
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 9,
      paid: 6,
      victoryPointLoss: 2,
      industryInstanceIds: [cotton.id],
    });
    expect(state.eventLog).toContainEqual({
      type: 'victory_points_changed',
      playerId: 'p1',
      delta: -2,
      reason: 'negative income shortfall',
    });
  });

  it('blocks ordinary actions while negative income liquidation is pending', () => {
    const state = testGame();
    state.players.p1.cash = 1;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    finishRoundWithPasses(state);

    const validation = validateCommand(state, {type: 'pass', playerId: 'p1', cardId: firstHandCard(state, 'p1')});
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('Pending decision must be resolved first');
  });

  it('rejects liquidating extra industries once the debt is covered', () => {
    const state = testGame();
    state.players.p1.cash = 1;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const manufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });

    finishRoundWithPasses(state);

    const validation = validateCommand(state, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [cotton.id, manufacturer.id],
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain('Cannot liquidate more industries after the debt is covered');
  });

  it('rejects invalid negative-income liquidation selections without mutating industries', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const removedManufacturer = addIndustry(state, {
      id: 'manufacturer-1',
      ownerPlayerId: 'p1',
      industryType: 'manufacturer',
      specId: 'manufacturer-1-1',
      locationId: 'walsall',
      slotId: 'walsall-0',
    });
    removedManufacturer.removedFromGame = true;
    const opponentCoal = addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
    });

    finishRoundWithPasses(state);

    expect(() => applyCommand(state, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [cotton.id, cotton.id, opponentCoal.id, removedManufacturer.id],
    })).toThrow('selected more than once');
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[opponentCoal.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[removedManufacturer.id].removedFromGame).toBe(true);
    expect(state.pendingDecision?.type).toBe('negative_income');
    expect(state.players.p1.cash).toBe(0);
  });

  it('does not force zero-value industries to be removed for a negative-income shortfall', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.players.p1.victoryPoints = 5;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 3);
    const zeroValuePottery = addIndustry(state, {
      id: 'pottery-2',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-1',
    });

    finishRoundWithPasses(state);

    expect(state.pendingDecision).toBeUndefined();
    expect(state.roundNumber).toBe(2);
    expect(state.players.p1.cash).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(2);
    expect(state.board.industryInstances[zeroValuePottery.id].removedFromGame).toBe(false);
    expect(state.board.slots['stafford-1'].occupiedBy).toBe(zeroValuePottery.id);
    expect(state.eventLog).toContainEqual({
      type: 'victory_points_changed',
      playerId: 'p1',
      delta: -3,
      reason: 'negative income shortfall',
    });
    expect(state.eventLog.some((event) =>
      event.type === 'industry_removed' &&
      event.industryInstanceId === zeroValuePottery.id,
    )).toBe(false);
  });

  it('rejects zero-value industries in negative-income liquidation selections', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);
    const zeroValuePottery = addIndustry(state, {
      id: 'pottery-2',
      ownerPlayerId: 'p1',
      industryType: 'pottery',
      specId: 'pottery-2-1',
      locationId: 'stafford',
      slotId: 'stafford-1',
    });
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    finishRoundWithPasses(state);

    const validation = validateCommand(state, {
      type: 'resolve_negative_income',
      playerId: 'p1',
      industryInstanceIds: [zeroValuePottery.id, cotton.id],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(`Industry ${zeroValuePottery.id} cannot raise cash for negative income`);
    expect(state.board.industryInstances[zeroValuePottery.id].removedFromGame).toBe(false);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(false);
    expect(state.pendingDecision?.type).toBe('negative_income');
  });

  it('loses victory points when negative income cannot be fully paid', () => {
    const state = testGame();
    state.players.p1.cash = 0;
    state.players.p1.victoryPoints = 3;
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 5);

    finishRoundWithPasses(state);

    expect(state.players.p1.cash).toBe(0);
    expect(state.players.p1.victoryPoints).toBe(0);
  });
});
