import {describe, expect, it} from 'vitest';
import {
  applyCommand,
  executeResolveMerchantDevelop,
  executeResolveNegativeIncome,
  validateCommand,
} from '../src/common/gameEngine';
import type {GameCommand, ResolveMerchantDevelopCommand, ResolveNegativeIncomeCommand} from '../src/common/types';
import {addIndustry, testGame} from './helpers';

describe('pending decision payload validation', () => {
  it('snapshots negative-income resolution payloads before validation and execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 3, incomePlayerIndex: 0};
    let industryIdReads = 0;
    const command = {
      type: 'resolve_negative_income' as const,
      playerId: 'p1',
      get industryInstanceIds() {
        industryIdReads++;
        return industryIdReads <= 4 ? [] : ['missing-industry'];
      },
    } as unknown as GameCommand;

    applyCommand(state, command);

    expect(industryIdReads).toBe(1);
    expect(state.pendingDecision).toBeUndefined();
    expect(state.players.p1.cash).toBe(14);
    expect(state.eventLog).toContainEqual({
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 3,
      paid: 3,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    });
  });

  it('snapshots merchant develop resolution payloads before validation and execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};
    let industryTypeReads = 0;
    const command = {
      type: 'resolve_merchant_develop' as const,
      playerId: 'p1',
      get industryTypes() {
        industryTypeReads++;
        return industryTypeReads <= 4 ? ['coal_mine'] : ['pottery'];
      },
    } as unknown as GameCommand;

    applyCommand(state, command);

    expect(industryTypeReads).toBe(1);
    expect(state.pendingDecision).toBeUndefined();
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p1.industryTileStacks.pottery.removedSpecIds).toEqual([]);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['coal_mine'],
      specIds: ['coal_mine-1-1'],
    });
  });

  it('does not liquidate negative-income industries before payloads are rechecked during direct execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 3, incomePlayerIndex: 0};
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    const pendingBefore = structuredClone(state.pendingDecision);
    const eventLogBefore = structuredClone(state.eventLog);
    const handBefore = [...state.players.p1.handCardIds];
    const cashBefore = state.players.p1.cash;
    let industryIdReads = 0;
    const command = {
      type: 'resolve_negative_income' as const,
      playerId: 'p1',
      get industryInstanceIds() {
        industryIdReads++;
        return industryIdReads === 1 ? [] : [cotton.id];
      },
    } as ResolveNegativeIncomeCommand;

    expect(() => executeResolveNegativeIncome(state, command)).toThrow('Cannot liquidate more industries after the debt is covered');

    expect(industryIdReads).toBe(2);
    expect(state.pendingDecision).toEqual(pendingBefore);
    expect(state.players.p1.cash).toBe(cashBefore);
    expect(state.players.p1.handCardIds).toEqual(handBefore);
    expect(state.board.industryInstances[cotton.id].removedFromGame).toBe(false);
    expect(state.board.slots['birmingham-0'].occupiedBy).toBe(cotton.id);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('does not resolve merchant develop before payloads are rechecked during direct execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};
    const pendingBefore = structuredClone(state.pendingDecision);
    const coalStackBefore = structuredClone(state.players.p1.industryTileStacks.coal_mine);
    const potteryStackBefore = structuredClone(state.players.p1.industryTileStacks.pottery);
    const eventLogBefore = structuredClone(state.eventLog);
    let industryTypeReads = 0;
    const command = {
      type: 'resolve_merchant_develop' as const,
      playerId: 'p1',
      get industryTypes() {
        industryTypeReads++;
        return industryTypeReads === 1 ? ['coal_mine' as const] : ['pottery' as const];
      },
    } as ResolveMerchantDevelopCommand;

    expect(() => executeResolveMerchantDevelop(state, command)).toThrow('pottery level 1 cannot be developed');

    expect(industryTypeReads).toBe(2);
    expect(state.pendingDecision).toEqual(pendingBefore);
    expect(state.players.p1.industryTileStacks.coal_mine).toEqual(coalStackBefore);
    expect(state.players.p1.industryTileStacks.pottery).toEqual(potteryStackBefore);
    expect(state.eventLog).toEqual(eventLogBefore);
  });

  it('uses the captured player for negative-income direct execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 3, incomePlayerIndex: 0};
    const p1CashBefore = state.players.p1.cash;
    const p2CashBefore = state.players.p2.cash;
    let playerIdReads = 0;
    const command = {
      type: 'resolve_negative_income' as const,
      get playerId() {
        playerIdReads++;
        return playerIdReads <= 4 ? 'p1' : 'p2';
      },
      industryInstanceIds: [],
    } as ResolveNegativeIncomeCommand;

    executeResolveNegativeIncome(state, command);

    expect(playerIdReads).toBe(4);
    expect(state.pendingDecision).toBeUndefined();
    expect(state.players.p1.cash).toBe(p1CashBefore - 3);
    expect(state.players.p2.cash).toBe(p2CashBefore);
    expect(state.eventLog).toContainEqual({
      type: 'negative_income_resolved',
      playerId: 'p1',
      amountOwed: 3,
      paid: 3,
      victoryPointLoss: 0,
      industryInstanceIds: [],
    });
  });

  it('uses the captured player for merchant-develop direct execution', () => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};
    let playerIdReads = 0;
    const command = {
      type: 'resolve_merchant_develop' as const,
      get playerId() {
        playerIdReads++;
        return playerIdReads <= 5 ? 'p1' : 'p2';
      },
      industryTypes: ['coal_mine'],
    } as ResolveMerchantDevelopCommand;

    executeResolveMerchantDevelop(state, command);

    expect(playerIdReads).toBe(5);
    expect(state.pendingDecision).toBeUndefined();
    expect(state.players.p1.industryTileStacks.coal_mine.removedSpecIds).toEqual(['coal_mine-1-1']);
    expect(state.players.p2.industryTileStacks.coal_mine.removedSpecIds).toEqual([]);
    expect(state.eventLog).toContainEqual({
      type: 'merchant_develop_resolved',
      playerId: 'p1',
      merchantSpaceId: 'gloucester-0',
      merchantSpaceIds: ['gloucester-0'],
      industryTypes: ['coal_mine'],
      specIds: ['coal_mine-1-1'],
    });
  });

  it.each([
    {
      command: {type: 'resolve_negative_income', playerId: 'p1'},
      name: 'missing industryInstanceIds',
    },
    {
      command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: ['industry-1', 2]},
      name: 'non-string industryInstanceIds',
    },
    {
      command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: ['industry-1', '   ']},
      name: 'blank industryInstanceIds',
    },
  ])('rejects malformed negative-income resolution payloads in the rules layer: $name', ({command}) => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 5, incomePlayerIndex: 0};
    const before = structuredClone(state);
    const payload = command as unknown as GameCommand;

    const result = validateCommand(state, payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Negative income requires industryInstanceIds as a string array');
    expect(() => applyCommand(state, payload)).toThrow('Negative income requires industryInstanceIds as a string array');
    expect(state).toEqual(before);
  });

  it.each([
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1'},
      name: 'missing industryTypes',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['coal_mine', 2]},
      name: 'non-string industryTypes',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['coal_mine', '   ']},
      name: 'blank industryTypes',
    },
  ])('rejects malformed merchant develop resolution payloads in the rules layer: $name', ({command}) => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};
    const before = structuredClone(state);
    const payload = command as unknown as GameCommand;

    const result = validateCommand(state, payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Merchant develop requires industryTypes as a string array');
    expect(() => applyCommand(state, payload)).toThrow('Merchant develop requires industryTypes as a string array');
    expect(state).toEqual(before);
  });

  it('rejects merchant develop decisions for unknown players without throwing internal errors', () => {
    const state = testGame();
    state.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'ghost',
      count: 1,
      merchantSpaceId: 'gloucester-0',
    };
    const before = structuredClone(state);
    const command = {
      type: 'resolve_merchant_develop',
      playerId: 'ghost',
      industryTypes: [],
    } as unknown as GameCommand;

    const result = validateCommand(state, command);

    expect(result).toEqual({ok: false, errors: ['Unknown player: ghost']});
    expect(() => applyCommand(state, command)).toThrow('Unknown player: ghost');
    expect(state).toEqual(before);
  });

  it('rejects merchant develop decisions from non-develop merchant spaces without clearing them', () => {
    const state = testGame();
    state.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 'oxford-0',
    };
    const before = structuredClone(state);
    const command = {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    } as unknown as GameCommand;

    const result = validateCommand(state, command);

    expect(result).toEqual({ok: false, errors: ['Invalid pending merchant develop decision']});
    expect(() => applyCommand(state, command)).toThrow('Invalid pending merchant develop decision');
    expect(state).toEqual(before);
  });

  it('requires a valid primary merchant develop source even when a dirty source list contains one', () => {
    const state = testGame();
    state.pendingDecision = {
      type: 'merchant_develop',
      playerId: 'p1',
      count: 1,
      merchantSpaceId: 2,
      merchantSpaceIds: ['gloucester-0'],
    } as unknown as typeof state.pendingDecision;
    const before = structuredClone(state);
    const command = {
      type: 'resolve_merchant_develop',
      playerId: 'p1',
      industryTypes: ['coal_mine'],
    } as unknown as GameCommand;

    const result = validateCommand(state, command);

    expect(result).toEqual({ok: false, errors: ['Invalid pending merchant develop decision']});
    expect(() => applyCommand(state, command)).toThrow('Invalid pending merchant develop decision');
    expect(state).toEqual(before);
  });
});
