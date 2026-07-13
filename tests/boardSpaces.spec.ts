import {describe, expect, it} from 'vitest';
import {BOARD_SLOT_REGIONS} from '../src/common/boardSpaces';
import {staticConfig} from '../src/common/staticData';

function buildSlotIds(): string[] {
  return Object.values(staticConfig.locations).flatMap((location) => {
    if (location.kind === 'city') {
      return location.slots.map((slot) => slot.id);
    }
    if (location.kind === 'farm_brewery') {
      return [`${location.id}-brewery`];
    }
    return [];
  });
}

describe('board slot regions', () => {
  it('covers every buildable slot in static data', () => {
    expect(Object.keys(BOARD_SLOT_REGIONS).sort()).toEqual(buildSlotIds().sort());
  });

  it('keeps normalized regions within the board image bounds', () => {
    for (const region of Object.values(BOARD_SLOT_REGIONS)) {
      expect(region.left).toBeGreaterThanOrEqual(0);
      expect(region.top).toBeGreaterThanOrEqual(0);
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);
      expect(region.left + region.width).toBeLessThanOrEqual(100);
      expect(region.top + region.height).toBeLessThanOrEqual(100);
      expect(region.locationId).toBeTruthy();
      expect(region.sourceName).toBeTruthy();
    }
  });
});
