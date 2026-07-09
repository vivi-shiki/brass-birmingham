import {staticConfig, getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds} from './staticData';
import {SeededRandom, shuffle} from './random';
import type {
  BoardState,
  GameState,
  IndustryType,
  LinkType,
  PlayerCount,
  PlayerState,
} from './types';

export interface CreateGameOptions {
  id: string;
  playerNames: string[];
  seed?: number;
  initialTurnOrder?: string[];
  introductoryCanalOnly?: boolean;
}

export const INDUSTRY_TYPES: IndustryType[] = [
  'cotton_mill',
  'coal_mine',
  'iron_works',
  'manufacturer',
  'pottery',
  'brewery',
];

export const LINK_TYPES: LinkType[] = ['canal', 'rail'];

export function coercePlayerCount(count: number): PlayerCount {
  if (count === 2 || count === 3 || count === 4) {
    return count;
  }
  throw new Error('Brass: Birmingham supports 2-4 players');
}

export function validateGameSeed(seed: number | undefined): number | undefined {
  if (seed === undefined) {
    return undefined;
  }
  if (!Number.isFinite(seed)) {
    throw new Error('Game seed must be a finite number');
  }
  if (!Number.isInteger(seed)) {
    throw new Error('Game seed must be an integer');
  }
  return seed;
}

function createIndustryStacks() {
  const stacks = {} as PlayerState['industryTileStacks'];
  for (const type of INDUSTRY_TYPES) {
    stacks[type] = {
      availableSpecIdsInOrder: [...staticConfig.industryStackSpecIds[type]],
      removedSpecIds: [],
      builtInstanceIds: [],
    };
  }
  return stacks;
}

function createPlayer(id: string, name: string): PlayerState {
  return {
    id,
    name,
    cash: staticConfig.rules.initialCash,
    victoryPoints: 0,
    incomeTrackPosition: staticConfig.incomeTrack.startPosition,
    spentThisRound: 0,
    handCardIds: [],
    discardCardIds: [],
    faceDownDiscardCount: 0,
    industryTileStacks: createIndustryStacks(),
    remainingLinks: {
      canal: staticConfig.rules.initialLinksPerType,
      rail: staticConfig.rules.initialLinksPerType,
    },
  };
}

function createBoardState(playerCount: PlayerCount, merchantTileDeck: string[]): BoardState {
  const slots: BoardState['slots'] = {};
  for (const location of Object.values(staticConfig.locations)) {
    if (location.kind === 'city') {
      for (const slot of location.slots) {
        slots[slot.id] = {};
      }
    }
    if (location.kind === 'farm_brewery') {
      slots[`${location.id}-brewery`] = {};
    }
  }

  const linkLines = Object.fromEntries(Object.keys(staticConfig.linkLines).map((id) => [id, {}]));
  const merchantSpaces: BoardState['merchantSpaces'] = {};
  let nextMerchantTile = 0;
  for (const location of Object.values(staticConfig.locations)) {
    if (location.kind !== 'merchant' || location.minPlayers > playerCount) {
      continue;
    }
    for (const space of location.spaces.filter((candidate) => candidate.minPlayers <= playerCount)) {
      const merchantTileInstanceId = merchantTileDeck[nextMerchantTile++];
      const specId = merchantTileInstanceId?.replace(/-\d+$/, '');
      merchantSpaces[space.id] = {
        id: space.id,
        merchantTileInstanceId,
        beerPresent: Boolean(specId && !staticConfig.merchantTileSpecs[specId]?.blank),
      };
    }
  }

  return {
    industryInstances: {},
    linkInstances: {},
    slots,
    linkLines,
    merchantSpaces,
  };
}

function createMerchantTileDeck(playerCount: PlayerCount, random: SeededRandom): string[] {
  const specs = Object.values(staticConfig.merchantTileSpecs)
    .filter((spec) => spec.minPlayers <= playerCount)
    .map((spec, index) => `${spec.id}-${index}`);
  return shuffle(specs, random);
}

function createInitialTurnOrder(playerIds: string[], initialTurnOrder: string[] | undefined, random: SeededRandom): string[] {
  if (!initialTurnOrder) {
    return shuffle(playerIds, random);
  }
  if (initialTurnOrder.length !== playerIds.length) {
    throw new Error('Initial turn order must include every player exactly once');
  }
  const playerIdSet = new Set(playerIds);
  const uniqueOrder = new Set(initialTurnOrder);
  if (uniqueOrder.size !== initialTurnOrder.length || initialTurnOrder.some((playerId) => !playerIdSet.has(playerId))) {
    throw new Error('Initial turn order must include every player exactly once');
  }
  return [...initialTurnOrder];
}

export function createGame(options: CreateGameOptions): GameState {
  const playerCount = coercePlayerCount(options.playerNames.length);
  const random = new SeededRandom(validateGameSeed(options.seed) ?? Date.now());
  const playerIds = options.playerNames.map((_, index) => `p${index + 1}`);
  const players = Object.fromEntries(playerIds.map((id, index) => {
    const name = options.playerNames[index].trim() || `Player ${index + 1}`;
    return [id, createPlayer(id, name)];
  }));
  const turnOrder = createInitialTurnOrder(playerIds, options.initialTurnOrder, random);

  const drawDeck = shuffle(getCardIdsForPlayerCount(playerCount), random);
  const merchantTileDeck = createMerchantTileDeck(playerCount, random);

  for (const playerId of playerIds) {
    const player = players[playerId];
    while (player.handCardIds.length < staticConfig.rules.handSize && drawDeck.length > 0) {
      player.handCardIds.push(drawDeck.pop() as string);
    }
    const faceDownDiscard = drawDeck.pop();
    if (faceDownDiscard) {
      player.discardCardIds.push(faceDownDiscard);
      player.faceDownDiscardCount++;
    }
  }

  return {
    id: options.id,
    playerCount,
    era: 'canal',
    roundNumber: 1,
    turnOrder,
    currentTurnIndex: 0,
    actionIndexInTurn: 0,
    actionsAllowedThisTurn: staticConfig.rules.firstCanalRoundActions,
    players,
    board: createBoardState(playerCount, merchantTileDeck),
    cardZones: {
      drawDeck,
      wildLocationPool: getWildLocationCardIds(),
      wildIndustryPool: getWildIndustryCardIds(),
    },
    markets: {
      coal: {occupiedCount: staticConfig.markets.coal.initialOccupiedCount},
      iron: {occupiedCount: staticConfig.markets.iron.initialOccupiedCount},
    },
    eventLog: [{type: 'game_created', gameId: options.id, playerIds}],
    nextInstanceId: 1,
    status: 'playing',
    ...(options.introductoryCanalOnly ? {variant: 'introductory_canal_only' as const} : {}),
  };
}
