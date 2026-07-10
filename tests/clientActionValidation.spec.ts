import {describe, expect, it} from 'vitest';
import {
  buildActionReason,
  developActionReason,
  loanActionReason,
  networkActionReason,
  passActionReason,
  scoutActionReason,
  sellActionReason,
} from '../src/client/actionValidation';
import {retreatIncomeLevels} from '../src/common/income';
import {staticConfig} from '../src/common/staticData';
import {addIndustry, addLink, firstHandCard, setHand, testGame} from './helpers';

describe('client action validation reasons', () => {
  it('returns no reason for a legal Pass', () => {
    const state = testGame();

    expect(passActionReason(state, 'p1', firstHandCard(state, 'p1'))).toBeUndefined();
  });

  it('returns rule errors for Loan validation failures', () => {
    const state = testGame();
    state.players.p1.incomeTrackPosition = retreatIncomeLevels(staticConfig.incomeTrack.startPosition, 8);

    expect(loanActionReason(state, 'p1', firstHandCard(state, 'p1'))).toContain('below the minimum');
  });

  it('returns shared pending-decision blockers for single-card actions', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    state.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    expect(passActionReason(state, 'p1', cardId)).toBe('Pending decision must be resolved first');
    expect(loanActionReason(state, 'p1', cardId)).toBe('Pending decision must be resolved first');
  });

  it('returns a specific reason when Scout is unavailable because a wild card is held', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1']);

    expect(scoutActionReason(state, 'p1', state.players.p1.handCardIds)).toBe('Cannot Scout while holding a wild card');
  });

  it('returns ordinary-action blockers before local Scout availability reasons', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1', 'p2-location-cannock-1', 'wild-location-1']);
    state.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    expect(scoutActionReason(state, 'p1', state.players.p1.handCardIds)).toBe('Pending decision must be resolved first');
  });

  it('returns stable Scout reasons when dirty card state is missing', () => {
    const missingHand = testGame();
    delete (missingHand.players.p1 as Partial<typeof missingHand.players.p1>).handCardIds;

    expect(() => scoutActionReason(missingHand, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ])).not.toThrow();
    expect(scoutActionReason(missingHand, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ])).toBe('Need at least three cards to Scout');

    const missingWildPools = testGame();
    setHand(missingWildPools, 'p1', [
      'p2-location-birmingham-1',
      'p2-location-cannock-1',
      'p2-location-dudley-1',
    ]);
    delete (missingWildPools as Partial<typeof missingWildPools>).cardZones;

    expect(() => scoutActionReason(missingWildPools, 'p1', missingWildPools.players.p1.handCardIds)).not.toThrow();
    expect(scoutActionReason(missingWildPools, 'p1', missingWildPools.players.p1.handCardIds))
      .toBe('Wild card pools are empty');
  });

  it('returns ordinary-action blockers before local form selection reasons', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');
    state.pendingDecision = {
      type: 'negative_income',
      playerId: 'p1',
      amountOwed: 5,
      incomePlayerIndex: 0,
    };

    expect(buildActionReason(state, 'p1', cardId, '', '', '')).toBe('Pending decision must be resolved first');
    expect(networkActionReason(state, 'p1', cardId, [])).toBe('Pending decision must be resolved first');
    expect(developActionReason(state, 'p1', cardId, [])).toBe('Pending decision must be resolved first');
    expect(sellActionReason(state, 'p1', cardId, [{industryInstanceId: '', merchantSpaceId: ''}]))
      .toBe('Pending decision must be resolved first');
  });

  it('returns selection reasons before Build has enough form input', () => {
    const state = testGame();

    expect(buildActionReason(state, 'p1', firstHandCard(state, 'p1'), '', '', '')).toBe('No valid build location');
  });

  it('returns rule exceptions as Build reasons for stale form targets', () => {
    const state = testGame();

    expect(buildActionReason(
      state,
      'p1',
      firstHandCard(state, 'p1'),
      'missing-location',
      'missing-slot',
      'cotton_mill',
    )).toBe('Unknown location: missing-location');
  });

  it('returns no reason for a legal matching-card Build', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expect(buildActionReason(
      state,
      'p1',
      'p2-location-birmingham-1',
      'birmingham',
      'birmingham-0',
      'cotton_mill',
    )).toBeUndefined();
  });

  it('returns selection reasons before Network has a link', () => {
    const state = testGame();

    expect(networkActionReason(state, 'p1', firstHandCard(state, 'p1'), [])).toBe('No valid network links');
  });

  it('returns rule exceptions as Network reasons for stale form targets', () => {
    const state = testGame();

    expect(networkActionReason(state, 'p1', firstHandCard(state, 'p1'), ['missing-link-line']))
      .toBe('Unknown link line: missing-link-line');
  });

  it('returns selection reasons before Develop has a tile selection', () => {
    const state = testGame();

    expect(developActionReason(state, 'p1', firstHandCard(state, 'p1'), [])).toBe('No developable tiles');
  });

  it('returns no reason for a legal Develop selection', () => {
    const state = testGame();

    expect(developActionReason(state, 'p1', firstHandCard(state, 'p1'), ['coal_mine'])).toBeUndefined();
  });

  it('returns shared rule reasons for illegal Develop selections', () => {
    const state = testGame();

    expect(developActionReason(state, 'p1', firstHandCard(state, 'p1'), ['pottery']))
      .toBe('pottery level 1 cannot be developed');
  });

  it('asks for a sellable industry before Sell has a sale target', () => {
    const state = testGame();

    expect(sellActionReason(state, 'p1', firstHandCard(state, 'p1'), [{
      industryInstanceId: '',
      merchantSpaceId: '',
    }])).toBe('Select a sellable industry');
  });

  it('returns no reason for a legal Sell target', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    const cotton = addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      remainingResource: 0,
    });
    state.board.merchantSpaces['oxford-0'] = {
      id: 'oxford-0',
      merchantTileInstanceId: 'oxford-cotton-0',
      beerPresent: true,
    };
    addLink(state, 'link-1', 'p1', 'birmingham-oxford');

    expect(sellActionReason(state, 'p1', 'p2-location-birmingham-1', [{
      industryInstanceId: cotton.id,
      merchantSpaceId: 'oxford-0',
      beerSources: [{kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: 'oxford-cotton-0'}],
    }])).toBeUndefined();
  });
});
