import {describe, expect, it} from 'vitest';
import {applyCommand, validateCommand} from '../src/common/gameEngine';
import type {GameCommand} from '../src/common/types';
import {addIndustry, addLink, firstHandCard, setHand, setMerchantSpace, testGame} from './helpers';

function expectMalformedCommand(state = testGame(), command: unknown, expectedError: string): void {
  const before = structuredClone(state);
  const payload = command as GameCommand;

  const result = validateCommand(state, payload);

  expect(result.ok).toBe(false);
  expect(result.errors).toContain(expectedError);
  expect(() => applyCommand(state, payload)).toThrow(expectedError);
  expect(state).toEqual(before);
}

function prepareCottonSale() {
  const state = testGame();
  setHand(state, 'p1', ['p2-location-birmingham-1']);
  const cotton = addIndustry(state, {
    id: 'cotton-1',
    ownerPlayerId: 'p1',
    industryType: 'cotton_mill',
    specId: 'cotton_mill-1-1',
    locationId: 'birmingham',
    slotId: 'birmingham-0',
  });
  addLink(state, 'link-1', 'p1', 'birmingham-oxford');
  setMerchantSpace(state, 'oxford-0', 'oxford-cotton-0', true);
  return {state, cotton};
}

describe('command payload validation', () => {
  it.each([
    {
      command: {type: 'pass', playerId: 'p1', cardId: 'p2-location-birmingham-1'},
      name: 'Pass',
    },
    {
      command: {
        type: 'build',
        playerId: 'p1',
        cardId: 'p2-location-birmingham-1',
        locationId: 'birmingham',
        slotId: 'birmingham-0',
        industryType: 'cotton_mill',
      },
      name: 'Build',
    },
    {
      command: {type: 'network', playerId: 'p1', cardId: 'p2-location-birmingham-1', linkLineIds: ['birmingham-walsall']},
      name: 'Network',
    },
    {
      command: {type: 'develop', playerId: 'p1', cardId: 'p2-location-birmingham-1', industryTypes: ['coal_mine']},
      name: 'Develop',
    },
    {
      command: {type: 'sell', playerId: 'p1', cardId: 'p2-location-birmingham-1', sales: []},
      name: 'Sell',
    },
    {
      command: {type: 'loan', playerId: 'p1', cardId: 'p2-location-birmingham-1'},
      name: 'Loan',
    },
    {
      command: {type: 'scout', playerId: 'p1', cardIds: ['p2-location-birmingham-1', 'p2-location-cannock-1', 'p2-location-coalbrookdale-1']},
      name: 'Scout',
    },
    {
      command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: []},
      name: 'Resolve negative income',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: []},
      name: 'Resolve merchant develop',
    },
  ])('rejects $name commands after the game has ended in the rules layer', ({command}) => {
    const state = testGame();
    state.status = 'ended';

    expectMalformedCommand(state, command, 'Game is not active');
  });

  it.each([
    {command: null, name: 'null command'},
    {command: 'pass', name: 'primitive command'},
    {command: {playerId: 'p1'}, name: 'missing type'},
    {command: {type: 2, playerId: 'p1'}, name: 'non-string type'},
    {command: {type: '   ', playerId: 'p1'}, name: 'blank type'},
    {command: {type: 'pass'}, name: 'missing playerId'},
    {command: {type: 'pass', playerId: 2}, name: 'non-string playerId'},
    {command: {type: 'pass', playerId: '   '}, name: 'blank playerId'},
  ])('rejects malformed command envelopes in the rules layer: $name', ({command}) => {
    expectMalformedCommand(testGame(), command, 'Malformed command');
  });

  it('rejects unknown player ids in the rules layer without mutating state', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    expectMalformedCommand(state, {
      type: 'pass',
      playerId: 'ghost-player',
      cardId,
    }, 'Unknown player: ghost-player');
  });

  it.each([
    {command: {type: 'pass', playerId: 'p1'}, name: 'missing cardId'},
    {command: {type: 'loan', playerId: 'p1', cardId: 2}, name: 'non-string cardId'},
    {command: {type: 'pass', playerId: 'p1', cardId: '   '}, name: 'blank cardId'},
  ])('rejects malformed single-card action cardId fields in the rules layer: $name', ({command}) => {
    expectMalformedCommand(testGame(), command, 'Command requires cardId as a non-empty string');
  });

  it('rejects unknown Build locations in the rules layer without mutating state', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expectMalformedCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'missing-location',
      slotId: 'missing-location-0',
      industryType: 'cotton_mill',
    }, 'Unknown location: missing-location');
  });

  it('rejects unknown Build industry types in the rules layer without mutating state', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expectMalformedCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'steel_mill',
    }, 'Unknown industry type: steel_mill');
  });

  it('rejects malformed Build resource-source array fields in the rules layer', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expectMalformedCommand(state, {
      type: 'build',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      industryType: 'cotton_mill',
      coalSources: {},
    }, 'Build coalSources must be an array');
  });

  it('rejects unknown Network link lines in the rules layer without mutating state', () => {
    const state = testGame();
    const cardId = firstHandCard(state, 'p1');

    expectMalformedCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId,
      linkLineIds: ['missing-link-line'],
    }, 'Unknown link line: missing-link-line');
  });

  it.each([
    {
      command: (cardId: string) => ({type: 'network', playerId: 'p1', cardId}),
      error: 'Network requires linkLineIds as a string array',
      name: 'missing linkLineIds',
    },
    {
      command: (cardId: string) => ({type: 'network', playerId: 'p1', cardId, linkLineIds: ['birmingham-walsall', 2]}),
      error: 'Network requires linkLineIds as a string array',
      name: 'non-string linkLineIds',
    },
    {
      command: (cardId: string) => ({type: 'network', playerId: 'p1', cardId, linkLineIds: ['   ']}),
      error: 'Network requires linkLineIds as a string array',
      name: 'blank linkLineIds',
    },
    {
      command: (cardId: string) => ({type: 'network', playerId: 'p1', cardId, linkLineIds: ['birmingham-walsall'], coalSources: {}}),
      error: 'Network coalSources must be an array',
      name: 'non-array coalSources',
    },
  ])('rejects malformed Network payload arrays in the rules layer: $name', ({command, error}) => {
    const state = testGame();

    expectMalformedCommand(state, command(firstHandCard(state, 'p1')), error);
  });

  it.each([
    {
      command: (cardId: string) => ({type: 'develop', playerId: 'p1', cardId}),
      error: 'Develop requires industryTypes as a string array',
      name: 'missing industryTypes',
    },
    {
      command: (cardId: string) => ({type: 'develop', playerId: 'p1', cardId, industryTypes: ['coal_mine', 2]}),
      error: 'Develop requires industryTypes as a string array',
      name: 'non-string industryTypes',
    },
    {
      command: (cardId: string) => ({type: 'develop', playerId: 'p1', cardId, industryTypes: ['   ']}),
      error: 'Develop requires industryTypes as a string array',
      name: 'blank industryTypes',
    },
    {
      command: (cardId: string) => ({type: 'develop', playerId: 'p1', cardId, industryTypes: ['coal_mine'], ironSources: {}}),
      error: 'Develop ironSources must be an array',
      name: 'non-array ironSources',
    },
  ])('rejects malformed Develop payload arrays in the rules layer: $name', ({command, error}) => {
    const state = testGame();

    expectMalformedCommand(state, command(firstHandCard(state, 'p1')), error);
  });

  it.each([
    {
      command: {type: 'sell', playerId: 'p1', cardId: 'p2-location-birmingham-1'},
      error: 'Sell requires sales as an array',
      name: 'missing sales',
    },
    {
      command: {type: 'sell', playerId: 'p1', cardId: 'p2-location-birmingham-1', sales: [2]},
      error: 'Sell requires sales as sale step objects',
      name: 'non-object sales entry',
    },
    {
      command: {
        type: 'sell',
        playerId: 'p1',
        cardId: 'p2-location-birmingham-1',
        sales: [{industryInstanceId: '   ', merchantSpaceId: 'oxford-0'}],
      },
      error: 'Sell requires sales as sale step objects',
      name: 'blank sale industryInstanceId',
    },
    {
      command: {
        type: 'sell',
        playerId: 'p1',
        cardId: 'p2-location-birmingham-1',
        sales: [{industryInstanceId: 'cotton-1', merchantSpaceId: '   '}],
      },
      error: 'Sell requires sales as sale step objects',
      name: 'blank sale merchantSpaceId',
    },
  ])('rejects malformed Sell payload arrays in the rules layer: $name', ({command, error}) => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expectMalformedCommand(state, command, error);
  });

  it('rejects malformed Sell beer source array fields in the rules layer', () => {
    const {state, cotton} = prepareCottonSale();

    expectMalformedCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {
          industryInstanceId: cotton.id,
          merchantSpaceId: 'oxford-0',
          beerSources: {},
        },
      ],
    }, 'Sell beerSources must be an array');
  });

  it.each([
    {
      source: {kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'beer'},
      name: 'blank industry beer source id',
    },
    {
      source: {kind: 'merchant_beer', merchantSpaceId: 'oxford-0', merchantTileInstanceId: '   '},
      name: 'blank merchant beer tile id',
    },
  ])('rejects malformed Sell beer source objects in the rules layer: $name', ({source}) => {
    const {state, cotton} = prepareCottonSale();

    expectMalformedCommand(state, {
      type: 'sell',
      playerId: 'p1',
      cardId: 'p2-location-birmingham-1',
      sales: [
        {
          industryInstanceId: cotton.id,
          merchantSpaceId: 'oxford-0',
          beerSources: [source],
        },
      ],
    }, 'Selected beer source is malformed');
  });

  it.each([
    {
      command: {type: 'scout', playerId: 'p1'},
      name: 'missing cardIds',
    },
    {
      command: {type: 'scout', playerId: 'p1', cardIds: ['p2-location-birmingham-1', 2, 'p2-location-cannock-1']},
      name: 'non-string cardIds',
    },
    {
      command: {type: 'scout', playerId: 'p1', cardIds: ['p2-location-birmingham-1', '   ', 'p2-location-cannock-1']},
      name: 'blank cardIds',
    },
  ])('rejects malformed Scout payload arrays in the rules layer: $name', ({command}) => {
    expectMalformedCommand(testGame(), command, 'Scout requires cardIds as a string array');
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
      command: {type: 'resolve_negative_income', playerId: 'p1', industryInstanceIds: ['   ']},
      name: 'blank industryInstanceIds',
    },
  ])('rejects malformed Resolve negative income payload arrays in the rules layer: $name', ({command}) => {
    const state = testGame();
    state.pendingDecision = {type: 'negative_income', playerId: 'p1', amountOwed: 3, incomePlayerIndex: 0};

    expectMalformedCommand(state, command, 'Negative income requires industryInstanceIds as a string array');
  });

  it.each([
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1'},
      error: 'Merchant develop requires industryTypes as a string array',
      name: 'missing industryTypes',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['coal_mine', 2]},
      error: 'Merchant develop requires industryTypes as a string array',
      name: 'non-string industryTypes',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['   ']},
      error: 'Merchant develop requires industryTypes as a string array',
      name: 'blank industryTypes',
    },
    {
      command: {type: 'resolve_merchant_develop', playerId: 'p1', industryTypes: ['steel_mill']},
      error: 'Unknown industry type: steel_mill',
      name: 'unknown industryTypes',
    },
  ])('rejects malformed Resolve merchant develop payload arrays in the rules layer: $name', ({command, error}) => {
    const state = testGame();
    state.pendingDecision = {type: 'merchant_develop', playerId: 'p1', count: 1, merchantSpaceId: 'gloucester-0'};

    expectMalformedCommand(state, command, error);
  });

  it.each([
    {
      source: {kind: 'industry_tile', industryInstanceId: '   ', resourceType: 'beer'},
      error: 'Selected double rail beer source is malformed',
      name: 'blank brewery source id',
    },
    {
      source: {kind: 'market', market: 'coal', price: 1},
      error: 'Double rail beer must come from a brewery',
      name: 'market source',
    },
  ])('rejects malformed double rail beer source payloads in the rules layer: $name', ({source, error}) => {
    const state = testGame();
    state.era = 'rail';
    state.players.p1.cash = 99;
    setHand(state, 'p1', ['p2-location-cannock-1']);
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-3-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 2,
    });

    expectMalformedCommand(state, {
      type: 'network',
      playerId: 'p1',
      cardId: 'p2-location-cannock-1',
      linkLineIds: ['cannock-walsall', 'cannock-stafford'],
      beerSourceForDoubleRail: source,
    }, error);
  });
});
