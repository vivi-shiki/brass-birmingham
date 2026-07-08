import {describe, expect, it} from 'vitest';
import {
  buildIndustryOptionsForLocation,
  buildIndustryOptionsForLocationAndCard,
  buildLocationOptionsForCard,
  buildSlotOptionsForIndustry,
  canSubmitBuild,
} from '../src/client/buildSlots';
import {addIndustry, addLink, firstHandCard, setHand, testGame} from './helpers';

describe('client build slot options', () => {
  it('prefers pure industry slots before mixed slots when a pure slot is unoccupied', () => {
    const state = testGame();

    expect(buildSlotOptionsForIndustry(state, 'birmingham', 'manufacturer').map((slot) => slot.id))
      .toEqual(['birmingham-1', 'birmingham-3']);
    expect(buildSlotOptionsForIndustry(state, 'cannock', 'coal_mine').map((slot) => slot.id))
      .toEqual(['cannock-1']);
  });

  it('allows mixed slots once no pure industry slot remains available', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });

    expect(buildSlotOptionsForIndustry(state, 'cannock', 'coal_mine').map((slot) => slot.id))
      .toEqual(['cannock-0', 'cannock-1']);
  });

  it('limits farm brewery slots to brewery builds', () => {
    const state = testGame();

    expect(buildSlotOptionsForIndustry(state, 'northern', 'brewery').map((slot) => slot.id))
      .toEqual(['northern-brewery']);
    expect(buildSlotOptionsForIndustry(state, 'northern', 'manufacturer')).toEqual([]);
  });

  it('filters build industry options to industries with a usable location slot', () => {
    const state = testGame();

    expect(buildIndustryOptionsForLocation(state, 'p1', 'birmingham'))
      .toEqual(['cotton_mill', 'iron_works', 'manufacturer']);
  });

  it('limits farm brewery industry options to breweries', () => {
    const state = testGame();

    expect(buildIndustryOptionsForLocation(state, 'p1', 'northern')).toEqual(['brewery']);
  });

  it('filters build industry options by the next tile buildable era', () => {
    const state = testGame();
    state.era = 'rail';

    expect(buildIndustryOptionsForLocation(state, 'p1', 'cannock')).not.toContain('coal_mine');

    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];

    expect(buildIndustryOptionsForLocation(state, 'p1', 'cannock')).toContain('coal_mine');
  });

  it('omits industry options when the player has no tile left for that industry', () => {
    const state = testGame();
    state.players.p1.industryTileStacks.manufacturer.availableSpecIdsInOrder = [];

    expect(buildIndustryOptionsForLocation(state, 'p1', 'birmingham')).not.toContain('manufacturer');
  });

  it('hides Build options blocked by the Canal one-industry-per-location rule', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    expect(buildSlotOptionsForIndustry(state, 'birmingham', 'iron_works', 'p1')).toEqual([]);
    expect(buildIndustryOptionsForLocation(state, 'p1', 'birmingham')).toEqual([]);
  });

  it('ignores orphan industries when applying the Canal one-industry-per-location rule', () => {
    const state = testGame();
    const orphanCotton = addIndustry(state, {
      id: 'orphan-cotton',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });
    state.board.slots[orphanCotton.slotId] = {};

    expect(buildSlotOptionsForIndustry(state, 'birmingham', 'iron_works', 'p1').map((slot) => slot.id))
      .toEqual(['birmingham-2']);
    expect(buildIndustryOptionsForLocation(state, 'p1', 'birmingham'))
      .toEqual(['cotton_mill', 'iron_works', 'manufacturer']);
  });

  it('offers own overbuild slots alongside mixed slots when no empty pure slot remains', () => {
    const state = testGame();
    state.era = 'rail';
    state.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    addIndustry(state, {
      id: 'coal-1',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });

    expect(buildSlotOptionsForIndustry(state, 'cannock', 'coal_mine', 'p1').map((slot) => slot.id))
      .toEqual(['cannock-0', 'cannock-1']);

    const equalLevel = testGame();
    equalLevel.era = 'rail';
    equalLevel.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    addIndustry(equalLevel, {
      id: 'coal-2',
      ownerPlayerId: 'p1',
      industryType: 'coal_mine',
      specId: 'coal_mine-2-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 1,
    });

    expect(buildSlotOptionsForIndustry(equalLevel, 'cannock', 'coal_mine', 'p1').map((slot) => slot.id))
      .toEqual(['cannock-0']);
  });

  it('offers opponent coal and iron overbuild slots only when that resource is globally depleted', () => {
    const coalBlocked = testGame();
    coalBlocked.players.p1.industryTileStacks.coal_mine.availableSpecIdsInOrder = ['coal_mine-2-1'];
    addIndustry(coalBlocked, {
      id: 'opponent-coal-1',
      ownerPlayerId: 'p2',
      industryType: 'coal_mine',
      specId: 'coal_mine-1-1',
      locationId: 'cannock',
      slotId: 'cannock-1',
      remainingResource: 0,
    });

    expect(buildSlotOptionsForIndustry(coalBlocked, 'cannock', 'coal_mine', 'p1').map((slot) => slot.id))
      .toEqual(['cannock-0']);

    coalBlocked.markets.coal.occupiedCount = 0;

    expect(buildSlotOptionsForIndustry(coalBlocked, 'cannock', 'coal_mine', 'p1').map((slot) => slot.id))
      .toEqual(['cannock-0', 'cannock-1']);

    const ironBlocked = testGame();
    ironBlocked.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    addIndustry(ironBlocked, {
      id: 'opponent-iron-1',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      remainingResource: 0,
    });

    expect(buildIndustryOptionsForLocation(ironBlocked, 'p1', 'birmingham')).not.toContain('iron_works');

    ironBlocked.markets.iron.occupiedCount = 0;

    expect(buildIndustryOptionsForLocation(ironBlocked, 'p1', 'birmingham')).toContain('iron_works');
  });

  it('ignores orphan resource industries when offering depleted opponent overbuild slots', () => {
    const state = testGame();
    state.players.p1.industryTileStacks.iron_works.availableSpecIdsInOrder = ['iron_works-2-1'];
    state.markets.iron.occupiedCount = 0;
    addIndustry(state, {
      id: 'target-iron',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-2',
      remainingResource: 0,
      flipped: true,
    });
    const orphanIron = addIndustry(state, {
      id: 'orphan-iron',
      ownerPlayerId: 'p2',
      industryType: 'iron_works',
      specId: 'iron_works-1-1',
      locationId: 'dudley',
      slotId: 'dudley-1',
      remainingResource: 1,
    });
    state.board.slots[orphanIron.slotId] = {};

    expect(buildSlotOptionsForIndustry(state, 'birmingham', 'iron_works', 'p1').map((slot) => slot.id))
      .toEqual(['birmingham-2']);
  });

  it('limits Build locations to the selected location card', () => {
    const state = testGame();

    expect(buildLocationOptionsForCard(state, 'p1', 'p2-location-birmingham-1').map((location) => location.id))
      .toEqual(['birmingham']);
    expect(buildIndustryOptionsForLocationAndCard(state, 'p1', 'p2-location-birmingham-1', 'birmingham'))
      .toEqual(['cotton_mill', 'iron_works', 'manufacturer']);
    expect(buildIndustryOptionsForLocationAndCard(state, 'p1', 'p2-location-birmingham-1', 'cannock'))
      .toEqual([]);
  });

  it('treats Wild Location as city-only and never as a farm brewery', () => {
    const state = testGame();
    const optionIds = buildLocationOptionsForCard(state, 'p1', 'wild-location-1').map((location) => location.id);

    expect(optionIds).toContain('birmingham');
    expect(optionIds).toContain('cannock');
    expect(optionIds).not.toContain('northern');
    expect(optionIds).not.toContain('southern');
  });

  it('limits industry cards to the matching industry before the player has a network', () => {
    const state = testGame();

    expect(buildIndustryOptionsForLocationAndCard(state, 'p1', 'p2-industry-coal_mine-1', 'cannock'))
      .toEqual(['coal_mine']);
    expect(buildIndustryOptionsForLocationAndCard(state, 'p1', 'p2-industry-coal_mine-1', 'birmingham'))
      .toEqual([]);
  });

  it('requires industry card Build locations to be inside the player network once a network exists', () => {
    const state = testGame();
    addLink(state, 'link-1', 'p1', 'birmingham-tamworth');

    const optionIds = buildLocationOptionsForCard(state, 'p1', 'p2-industry-coal_mine-1').map((location) => location.id);

    expect(optionIds).toContain('tamworth');
    expect(optionIds).not.toContain('cannock');
  });

  it('allows farm brewery Build locations only for brewery industry cards or Wild Industry', () => {
    const state = testGame();

    expect(buildLocationOptionsForCard(state, 'p1', 'p2-industry-brewery-5').map((location) => location.id))
      .toEqual(expect.arrayContaining(['northern', 'southern']));
    expect(buildIndustryOptionsForLocationAndCard(state, 'p1', 'p2-industry-brewery-5', 'northern'))
      .toEqual(['brewery']);
    expect(buildLocationOptionsForCard(state, 'p1', 'p2-industry-coal_mine-1').map((location) => location.id))
      .not.toContain('northern');
    expect(buildLocationOptionsForCard(state, 'p1', 'wild-industry-1').map((location) => location.id))
      .toEqual(expect.arrayContaining(['northern', 'southern']));
  });

  it('allows a valid Build submission for a matching location card', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expect(canSubmitBuild(state, 'p1', 'p2-location-birmingham-1', 'birmingham', 'birmingham-0', 'cotton_mill'))
      .toBe(true);
  });

  it('rejects Build submission with incomplete selections', () => {
    const state = testGame();

    expect(canSubmitBuild(state, 'p1', firstHandCard(state, 'p1'), '', '', '')).toBe(false);
  });

  it('rejects Build submission when the selected card cannot build at that location', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);

    expect(canSubmitBuild(state, 'p1', 'p2-location-birmingham-1', 'cannock', 'cannock-1', 'coal_mine'))
      .toBe(false);
  });

  it('rejects Build submission when the player cannot afford the build', () => {
    const state = testGame();
    setHand(state, 'p1', ['p2-location-birmingham-1']);
    state.players.p1.cash = 0;

    expect(canSubmitBuild(state, 'p1', 'p2-location-birmingham-1', 'birmingham', 'birmingham-0', 'cotton_mill'))
      .toBe(false);
  });
});
