export interface BoardSlotRegion {
  slotId: string;
  locationId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  sourceName: string;
}

// Regions are normalized from the official Tabletop Simulator mod's
// ScriptingTrigger positions in mods/Workshop/TS_Save_19.json.
export const BOARD_SLOT_REGIONS: Record<string, BoardSlotRegion> = {
  'belper-0': { slotId: 'belper-0', locationId: 'belper', left: 68.019, top: 7.571, width: 4.375, height: 4.375, sourceName: 'Belper (West)' },
  'belper-1': { slotId: 'belper-1', locationId: 'belper', left: 72.596, top: 7.54, width: 4.375, height: 4.375, sourceName: 'Belper (Central)' },
  'belper-2': { slotId: 'belper-2', locationId: 'belper', left: 77.163, top: 7.547, width: 4.375, height: 4.375, sourceName: 'Belper (East)' },
  'derby-0': { slotId: 'derby-0', locationId: 'derby', left: 71.194, top: 24.101, width: 4.375, height: 4.375, sourceName: 'Derby (West)' },
  'derby-1': { slotId: 'derby-1', locationId: 'derby', left: 73.478, top: 19.537, width: 4.375, height: 4.375, sourceName: 'Derby (North)' },
  'derby-2': { slotId: 'derby-2', locationId: 'derby', left: 75.727, top: 24.108, width: 4.375, height: 4.375, sourceName: 'Derby (East)' },
  'leek-0': { slotId: 'leek-0', locationId: 'leek', left: 50.797, top: 6.154, width: 4.375, height: 4.375, sourceName: 'Leek (West)' },
  'leek-1': { slotId: 'leek-1', locationId: 'leek', left: 55.427, top: 6.084, width: 4.375, height: 4.375, sourceName: 'Leek (East)' },
  'stokeOnTrent-0': { slotId: 'stokeOnTrent-0', locationId: 'stokeOnTrent', left: 37.068, top: 13.264, width: 4.375, height: 4.375, sourceName: 'Stoke-on-Trent (W)' },
  'stokeOnTrent-1': { slotId: 'stokeOnTrent-1', locationId: 'stokeOnTrent', left: 39.416, top: 8.682, width: 4.375, height: 4.375, sourceName: 'Stoke-on-Trent (N)' },
  'stokeOnTrent-2': { slotId: 'stokeOnTrent-2', locationId: 'stokeOnTrent', left: 41.644, top: 13.252, width: 4.375, height: 4.375, sourceName: 'Stoke-on-Trent (E)' },
  'stone-0': { slotId: 'stone-0', locationId: 'stone', left: 26.855, top: 23.566, width: 4.375, height: 4.375, sourceName: 'Stone (West)' },
  'stone-1': { slotId: 'stone-1', locationId: 'stone', left: 31.42, top: 23.535, width: 4.375, height: 4.375, sourceName: 'Stone (East)' },
  'uttoxeter-0': { slotId: 'uttoxeter-0', locationId: 'uttoxeter', left: 52.054, top: 21.872, width: 4.375, height: 4.375, sourceName: 'Uttoxeter (West)' },
  'uttoxeter-1': { slotId: 'uttoxeter-1', locationId: 'uttoxeter', left: 56.645, top: 21.879, width: 4.375, height: 4.375, sourceName: 'Uttoxeter (East)' },
  'stafford-0': { slotId: 'stafford-0', locationId: 'stafford', left: 35.989, top: 32.734, width: 4.375, height: 4.375, sourceName: 'Stafford (West)' },
  'stafford-1': { slotId: 'stafford-1', locationId: 'stafford', left: 40.554, top: 32.742, width: 4.375, height: 4.375, sourceName: 'Stafford (East)' },
  'burtonOnTrent-0': { slotId: 'burtonOnTrent-0', locationId: 'burtonOnTrent', left: 63.587, top: 35.567, width: 4.375, height: 4.375, sourceName: 'Burton-on-Trent (W)' },
  'burtonOnTrent-1': { slotId: 'burtonOnTrent-1', locationId: 'burtonOnTrent', left: 68.153, top: 35.536, width: 4.375, height: 4.375, sourceName: 'Burton-on-Trent (E)' },
  'cannock-0': { slotId: 'cannock-0', locationId: 'cannock', left: 43.214, top: 42.714, width: 4.375, height: 4.375, sourceName: 'Cannock (West)' },
  'cannock-1': { slotId: 'cannock-1', locationId: 'cannock', left: 47.747, top: 42.718, width: 4.375, height: 4.375, sourceName: 'Cannock (East)' },
  'tamworth-0': { slotId: 'tamworth-0', locationId: 'tamworth', left: 65.105, top: 47.811, width: 4.375, height: 4.375, sourceName: 'Tamworth (West)' },
  'tamworth-1': { slotId: 'tamworth-1', locationId: 'tamworth', left: 69.509, top: 47.817, width: 4.375, height: 4.375, sourceName: 'Tamworth (East)' },
  'walsall-0': { slotId: 'walsall-0', locationId: 'walsall', left: 48.713, top: 53.968, width: 4.375, height: 4.375, sourceName: 'Walsall (West)' },
  'walsall-1': { slotId: 'walsall-1', locationId: 'walsall', left: 53.246, top: 53.937, width: 4.375, height: 4.375, sourceName: 'Walsall (East)' },
  'wolverhampton-0': { slotId: 'wolverhampton-0', locationId: 'wolverhampton', left: 32.965, top: 51.701, width: 4.375, height: 4.375, sourceName: 'Wolverhampton (W)' },
  'wolverhampton-1': { slotId: 'wolverhampton-1', locationId: 'wolverhampton', left: 37.498, top: 51.708, width: 4.375, height: 4.375, sourceName: 'Wolverhampton (E)' },
  'coalbrookdale-0': { slotId: 'coalbrookdale-0', locationId: 'coalbrookdale', left: 19.477, top: 56.016, width: 4.375, height: 4.375, sourceName: 'Coalbrookdale (W)' },
  'coalbrookdale-1': { slotId: 'coalbrookdale-1', locationId: 'coalbrookdale', left: 21.76, top: 51.39, width: 4.375, height: 4.375, sourceName: 'Coalbrookdale (N)' },
  'coalbrookdale-2': { slotId: 'coalbrookdale-2', locationId: 'coalbrookdale', left: 24.03, top: 55.969, width: 4.375, height: 4.375, sourceName: 'Coalbrookdale (E)' },
  'dudley-0': { slotId: 'dudley-0', locationId: 'dudley', left: 37.512, top: 63.685, width: 4.375, height: 4.375, sourceName: 'Dudley (West)' },
  'dudley-1': { slotId: 'dudley-1', locationId: 'dudley', left: 42.045, top: 63.692, width: 4.375, height: 4.375, sourceName: 'Dudley (East)' },
  'kidderminster-0': { slotId: 'kidderminster-0', locationId: 'kidderminster', left: 30.682, top: 73.758, width: 4.375, height: 4.375, sourceName: 'Kidderminster (W)' },
  'kidderminster-1': { slotId: 'kidderminster-1', locationId: 'kidderminster', left: 35.216, top: 73.764, width: 4.375, height: 4.375, sourceName: 'Kidderminster (E)' },
  'worcester-0': { slotId: 'worcester-0', locationId: 'worcester', left: 31.933, top: 86.469, width: 4.375, height: 4.375, sourceName: 'Worcester (West)' },
  'worcester-1': { slotId: 'worcester-1', locationId: 'worcester', left: 36.524, top: 86.479, width: 4.375, height: 4.375, sourceName: 'Worcester (East)' },
  'birmingham-0': { slotId: 'birmingham-0', locationId: 'birmingham', left: 58.256, top: 62.832, width: 4.375, height: 4.375, sourceName: 'Birmingham (NW)' },
  'birmingham-1': { slotId: 'birmingham-1', locationId: 'birmingham', left: 62.822, top: 62.879, width: 4.375, height: 4.375, sourceName: 'Birmingham (NE)' },
  'birmingham-2': { slotId: 'birmingham-2', locationId: 'birmingham', left: 58.269, top: 67.463, width: 4.375, height: 4.375, sourceName: 'Birmingham (SW)' },
  'birmingham-3': { slotId: 'birmingham-3', locationId: 'birmingham', left: 62.798, top: 67.468, width: 4.375, height: 4.375, sourceName: 'Birmingham (SE)' },
  'coventry-0': { slotId: 'coventry-0', locationId: 'coventry', left: 78.336, top: 65.957, width: 4.375, height: 4.375, sourceName: 'Coventry (West)' },
  'coventry-1': { slotId: 'coventry-1', locationId: 'coventry', left: 76.07, top: 70.531, width: 4.375, height: 4.375, sourceName: 'Coventry (North)' },
  'coventry-2': { slotId: 'coventry-2', locationId: 'coventry', left: 80.636, top: 70.539, width: 4.375, height: 4.375, sourceName: 'Coventry (East)' },
  'nuneaton-0': { slotId: 'nuneaton-0', locationId: 'nuneaton', left: 73.827, top: 57.673, width: 4.375, height: 4.375, sourceName: 'Nuneaton (West)' },
  'nuneaton-1': { slotId: 'nuneaton-1', locationId: 'nuneaton', left: 78.419, top: 57.643, width: 4.375, height: 4.375, sourceName: 'Nuneaton (East)' },
  'redditch-0': { slotId: 'redditch-0', locationId: 'redditch', left: 53.688, top: 79.016, width: 4.375, height: 4.375, sourceName: 'Redditch (West)' },
  'redditch-1': { slotId: 'redditch-1', locationId: 'redditch', left: 58.279, top: 78.985, width: 4.375, height: 4.375, sourceName: 'Redditch (East)' },
  'northern-brewery': { slotId: 'northern-brewery', locationId: 'northern', left: 28.254, top: 41.468, width: 4.375, height: 4.375, sourceName: 'Northern Unnamed' },
  'southern-brewery': { slotId: 'southern-brewery', locationId: 'southern', left: 24.432, top: 81.115, width: 4.375, height: 4.375, sourceName: 'Southern Unnamed' },
};
