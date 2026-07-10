import {describe, expect, it} from 'vitest';
import {encodeSource} from '../src/client/resourceSources';
import {canSubmitNetwork, doubleRailBeerSourceForSubmit, networkLinkOptionsForSelect} from '../src/client/networkOptions';
import {addIndustry, addLink, firstHandCard, setHand, testGame} from './helpers';

function prepareRailNetwork() {
  const state = testGame();
  state.era = 'rail';
  setHand(state, 'p1', ['p2-location-cannock-1']);
  addIndustry(state, {
    id: 'coal-1',
    ownerPlayerId: 'p1',
    industryType: 'coal_mine',
    specId: 'coal_mine-2-1',
    locationId: 'cannock',
    slotId: 'cannock-1',
    remainingResource: 2,
  });
  return state;
}

describe('client network link options', () => {
  it('lists only unoccupied current-era links before the player has a network', () => {
    const state = testGame();
    addLink(state, 'occupied-link', 'p2', 'birmingham-walsall');

    const optionIds = networkLinkOptionsForSelect(state, 'p1', [], 0).map((line) => line.id);

    expect(optionIds).not.toContain('birmingham-walsall');
    expect(optionIds).not.toContain('birmingham-nuneaton');
    expect(optionIds).not.toContain('stokeOnTrent-warrington');
    expect(optionIds).not.toContain('derby-nottingham');
    expect(optionIds).toContain('cannock-stafford');
  });

  it('filters high-player-count merchant links from Network options', () => {
    const threePlayer = testGame();
    threePlayer.playerCount = 3;

    const threePlayerOptionIds = networkLinkOptionsForSelect(threePlayer, 'p1', [], 0).map((line) => line.id);

    expect(threePlayerOptionIds).toContain('stokeOnTrent-warrington');
    expect(threePlayerOptionIds).not.toContain('derby-nottingham');

    const fourPlayer = testGame();
    fourPlayer.playerCount = 4;

    const fourPlayerOptionIds = networkLinkOptionsForSelect(fourPlayer, 'p1', [], 0).map((line) => line.id);

    expect(fourPlayerOptionIds).toContain('stokeOnTrent-warrington');
    expect(fourPlayerOptionIds).toContain('derby-nottingham');
  });

  it('requires the first link to extend from an existing player network', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'cotton-1',
      ownerPlayerId: 'p1',
      industryType: 'cotton_mill',
      specId: 'cotton_mill-1-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
    });

    const optionIds = networkLinkOptionsForSelect(state, 'p1', [], 0).map((line) => line.id);

    expect(optionIds).toContain('birmingham-walsall');
    expect(optionIds).toContain('birmingham-dudley');
    expect(optionIds).not.toContain('cannock-stafford');
  });

  it('offers a via-farm link when the player network is on that farm brewery', () => {
    const state = testGame();
    addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'southern',
      slotId: 'southern-brewery',
      remainingResource: 1,
    });

    const optionIds = networkLinkOptionsForSelect(state, 'p1', [], 0).map((line) => line.id);

    expect(optionIds).toContain('kidderminster-worcester');
    expect(optionIds).not.toContain('birmingham-walsall');
  });

  it('allows the second rail to extend the first selected rail', () => {
    const state = testGame();
    state.era = 'rail';

    const optionIds = networkLinkOptionsForSelect(state, 'p1', ['cannock-stafford'], 1).map((line) => line.id);

    expect(optionIds).toContain('stafford-stone');
    expect(optionIds).toContain('cannock-walsall');
    expect(optionIds).not.toContain('cannock-stafford');
    expect(optionIds).not.toContain('birmingham-dudley');
  });

  it('does not offer second rail options before a first rail is selected', () => {
    const state = testGame();
    state.era = 'rail';

    expect(networkLinkOptionsForSelect(state, 'p1', [], 1)).toEqual([]);
    expect(networkLinkOptionsForSelect(state, 'p1', [''], 1)).toEqual([]);
  });

  it('does not offer a second link in Canal or when only one rail remains', () => {
    const canal = testGame();
    expect(networkLinkOptionsForSelect(canal, 'p1', ['birmingham-walsall'], 1)).toEqual([]);

    const rail = testGame();
    rail.era = 'rail';
    rail.players.p1.remainingLinks.rail = 1;
    expect(networkLinkOptionsForSelect(rail, 'p1', ['cannock-stafford'], 1)).toEqual([]);
  });

  it('does not offer Network links when dirty player state is missing the current era link count', () => {
    const canal = testGame();
    delete (canal.players.p1.remainingLinks as Partial<typeof canal.players.p1.remainingLinks>).canal;

    const rail = testGame();
    rail.era = 'rail';
    delete (rail.players.p1.remainingLinks as Partial<typeof rail.players.p1.remainingLinks>).rail;

    expect(networkLinkOptionsForSelect(canal, 'p1', [], 0)).toEqual([]);
    expect(networkLinkOptionsForSelect(rail, 'p1', [], 0)).toEqual([]);
  });

  it('allows a valid Canal network command', () => {
    const state = testGame();

    expect(canSubmitNetwork(state, 'p1', firstHandCard(state, 'p1'), ['birmingham-walsall'])).toBe(true);
  });

  it('rejects network submission with no selected links', () => {
    const state = testGame();

    expect(canSubmitNetwork(state, 'p1', firstHandCard(state, 'p1'), [])).toBe(false);
  });

  it('rejects stale network submission targets without throwing', () => {
    const state = testGame();

    expect(canSubmitNetwork(state, 'p1', firstHandCard(state, 'p1'), ['missing-link-line'])).toBe(false);
  });

  it('rejects Rail network when the player cannot afford the link even with free coal', () => {
    const state = prepareRailNetwork();
    state.players.p1.cash = 4;

    expect(canSubmitNetwork(state, 'p1', 'p2-location-cannock-1', ['cannock-stafford'])).toBe(false);
  });

  it('allows single rail submission with a selected coal source and no beer source', () => {
    const state = prepareRailNetwork();
    addIndustry(state, {
      id: 'unused-brewery',
      ownerPlayerId: 'p1',
      industryType: 'brewery',
      specId: 'brewery-1-1',
      locationId: 'coalbrookdale',
      slotId: 'coalbrookdale-0',
      remainingResource: 1,
    });

    expect(canSubmitNetwork(
      state,
      'p1',
      'p2-location-cannock-1',
      ['cannock-stafford'],
      [{kind: 'industry_tile', industryInstanceId: 'coal-1', resourceType: 'coal'}],
      undefined,
    )).toBe(true);
  });

  it('rejects double rail submission when no brewery beer is available', () => {
    const state = prepareRailNetwork();

    expect(canSubmitNetwork(state, 'p1', 'p2-location-cannock-1', ['cannock-stafford', 'stafford-stone'])).toBe(false);
  });

  it('allows double rail submission with a selected connected brewery beer source', () => {
    const state = prepareRailNetwork();
    const brewery = addIndustry(state, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });

    expect(canSubmitNetwork(
      state,
      'p1',
      'p2-location-cannock-1',
      ['cannock-stafford', 'stafford-stone'],
      undefined,
      {kind: 'industry_tile', industryInstanceId: brewery.id, resourceType: 'beer'},
    )).toBe(true);
  });

  it('only decodes a legal selected beer source for two-rail submissions in the Rail era', () => {
    const rail = prepareRailNetwork();
    const brewery = addIndustry(rail, {
      id: 'brewery-1',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'stone',
      slotId: 'stone-0',
      remainingResource: 1,
    });
    const disconnectedBrewery = addIndustry(rail, {
      id: 'brewery-disconnected',
      ownerPlayerId: 'p2',
      industryType: 'brewery',
      specId: 'brewery-2-1',
      locationId: 'birmingham',
      slotId: 'birmingham-0',
      remainingResource: 1,
    });
    const source = {kind: 'industry_tile' as const, industryInstanceId: brewery.id, resourceType: 'beer' as const};
    const encodedSource = encodeSource(source);
    const disconnectedSource = encodeSource({
      kind: 'industry_tile' as const,
      industryInstanceId: disconnectedBrewery.id,
      resourceType: 'beer' as const,
    });

    expect(doubleRailBeerSourceForSubmit(rail, 'p1', ['cannock-stafford', 'stafford-stone'], encodedSource)).toEqual(source);
    expect(doubleRailBeerSourceForSubmit(rail, 'p1', ['cannock-stafford', 'stafford-stone'], disconnectedSource)).toBeUndefined();
    expect(doubleRailBeerSourceForSubmit(rail, 'p1', ['cannock-stafford'], encodedSource)).toBeUndefined();
    expect(doubleRailBeerSourceForSubmit(rail, 'p1', ['cannock-stafford', 'stafford-stone'], '')).toBeUndefined();
    expect(doubleRailBeerSourceForSubmit(rail, 'p1', ['cannock-stafford', 'stafford-stone'], 'not-json')).toBeUndefined();

    const canal = testGame();
    expect(doubleRailBeerSourceForSubmit(canal, 'p1', ['birmingham-walsall', 'walsall-wolverhampton'], encodedSource)).toBeUndefined();
  });
});
