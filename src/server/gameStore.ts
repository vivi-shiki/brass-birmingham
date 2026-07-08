import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {applyCommand, validateCommand} from '../common/gameEngine';
import {createGame, INDUSTRY_TYPES, validateGameSeed} from '../common/gameSetup';
import {getCurrentPlayerId} from '../common/selectors';
import {getCardIdsForPlayerCount, getWildIndustryCardIds, getWildLocationCardIds, staticConfig} from '../common/staticData';
import type {BoardState, GameCommand, GameState, IndustryInstance, IndustryTileSpec, IndustryType, LinkInstance, PlayerCount} from '../common/types';

export interface CreateStoredGameInput {
  playerNames: string[];
  seed?: number;
}

export interface CommandResult {
  ok: boolean;
  state?: GameState;
  errors?: string[];
}

export interface PlayerSession {
  playerId: string;
  token: string;
}

export interface ListedPendingDecision {
  type: NonNullable<GameState['pendingDecision']>['type'];
  playerId: string;
}

export interface GameSummary {
  id: string;
  playerNames: string[];
  playerCount: PlayerCount;
  roundNumber: number;
  era: GameState['era'];
  status: GameState['status'];
  currentPlayerId?: string;
  pendingDecision?: ListedPendingDecision;
}

export interface GameStoreOptions {
  storagePath?: string;
}

interface PersistedGameStore {
  version: 1;
  games: GameState[];
  sessions?: Record<string, PlayerSession[]>;
}

type CommandPayload = Pick<GameCommand, 'type' | 'playerId'> & Record<string, unknown>;

const validIndustryTypes = new Set<string>(INDUSTRY_TYPES);

function isPlayerCount(value: unknown): value is PlayerCount {
  return value === 2 || value === 3 || value === 4;
}

function playerIdsInSeatOrder(game: GameState): string[] {
  return Object.keys(game.players).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
}

function isCommandEnvelope(command: unknown): command is CommandPayload {
  return typeof command === 'object' &&
    command !== null &&
    typeof (command as {type?: unknown}).type === 'string' &&
    typeof (command as {playerId?: unknown}).playerId === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringField(command: CommandPayload, field: string, errors: string[]): void {
  if (typeof command[field] !== 'string') {
    errors.push(`${command.type} command requires ${field}`);
  }
}

function validateIndustryTypeField(command: CommandPayload, field: string, errors: string[]): void {
  const value = command[field];
  if (typeof value !== 'string') {
    errors.push(`${command.type} command requires ${field}`);
    return;
  }
  if (!validIndustryTypes.has(value)) {
    errors.push(`${command.type} command field ${field} must be a valid industry type`);
  }
}

function validateStringArrayField(command: CommandPayload, field: string, errors: string[]): void {
  if (!isStringArray(command[field])) {
    errors.push(`${command.type} command requires ${field} as a string array`);
  }
}

function validateIndustryTypeArrayField(command: CommandPayload, field: string, errors: string[]): void {
  const value = command[field];
  if (!isStringArray(value)) {
    errors.push(`${command.type} command requires ${field} as a string array`);
    return;
  }
  for (const [index, industryType] of value.entries()) {
    if (!validIndustryTypes.has(industryType)) {
      errors.push(`${command.type} command field ${field}[${index}] must be a valid industry type`);
    }
  }
}

function validateResourceSource(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    errors.push(`${pathName} must be a resource source`);
    return;
  }

  if (value.kind === 'industry_tile') {
    if (typeof value.industryInstanceId !== 'string') {
      errors.push(`${pathName}.industryInstanceId must be a string`);
    }
    if (value.resourceType !== 'coal' && value.resourceType !== 'iron' && value.resourceType !== 'beer') {
      errors.push(`${pathName}.resourceType must be coal, iron, or beer`);
    }
    return;
  }

  if (value.kind === 'market') {
    if (value.market !== 'coal' && value.market !== 'iron') {
      errors.push(`${pathName}.market must be coal or iron`);
    }
    if (typeof value.price !== 'number' || !Number.isFinite(value.price)) {
      errors.push(`${pathName}.price must be a finite number`);
    } else if (!Number.isInteger(value.price) || value.price < 0) {
      errors.push(`${pathName}.price must be a non-negative integer`);
    }
    return;
  }

  if (value.kind === 'merchant_beer') {
    if (typeof value.merchantSpaceId !== 'string') {
      errors.push(`${pathName}.merchantSpaceId must be a string`);
    }
    if (typeof value.merchantTileInstanceId !== 'string') {
      errors.push(`${pathName}.merchantTileInstanceId must be a string`);
    }
    return;
  }

  errors.push(`${pathName}.kind must be industry_tile, market, or merchant_beer`);
}

function validateOptionalResourceSources(command: CommandPayload, field: string, errors: string[]): void {
  const value = command[field];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${command.type} command field ${field} must be an array`);
    return;
  }
  for (const [index, source] of value.entries()) {
    validateResourceSource(source, `${command.type} command field ${field}[${index}]`, errors);
  }
}

function validateSellSteps(command: CommandPayload, errors: string[]): void {
  if (!Array.isArray(command.sales)) {
    errors.push('sell command requires sales as an array');
    return;
  }
  for (const [index, step] of command.sales.entries()) {
    if (typeof step !== 'object' || step === null) {
      errors.push(`sell command sales[${index}] must be an object`);
      continue;
    }
    const sale = step as Record<string, unknown>;
    if (typeof sale.industryInstanceId !== 'string') {
      errors.push(`sell command sales[${index}] requires industryInstanceId`);
    }
    if (typeof sale.merchantSpaceId !== 'string') {
      errors.push(`sell command sales[${index}] requires merchantSpaceId`);
    }
    if (sale.beerSources !== undefined && !Array.isArray(sale.beerSources)) {
      errors.push(`sell command sales[${index}] field beerSources must be an array`);
    } else if (Array.isArray(sale.beerSources)) {
      for (const [sourceIndex, source] of sale.beerSources.entries()) {
        validateResourceSource(source, `sell command sales[${index}].beerSources[${sourceIndex}]`, errors);
      }
    }
  }
}

function validateCommandPayloadShape(command: CommandPayload): string[] {
  const errors: string[] = [];
  switch (command.type) {
    case 'build':
      validateStringField(command, 'cardId', errors);
      validateStringField(command, 'locationId', errors);
      validateStringField(command, 'slotId', errors);
      validateIndustryTypeField(command, 'industryType', errors);
      validateOptionalResourceSources(command, 'coalSources', errors);
      validateOptionalResourceSources(command, 'ironSources', errors);
      break;
    case 'network':
      validateStringField(command, 'cardId', errors);
      validateStringArrayField(command, 'linkLineIds', errors);
      validateOptionalResourceSources(command, 'coalSources', errors);
      if (command.beerSourceForDoubleRail !== undefined) {
        validateResourceSource(command.beerSourceForDoubleRail, 'network command field beerSourceForDoubleRail', errors);
      }
      break;
    case 'develop':
      validateStringField(command, 'cardId', errors);
      validateIndustryTypeArrayField(command, 'industryTypes', errors);
      validateOptionalResourceSources(command, 'ironSources', errors);
      break;
    case 'sell':
      validateStringField(command, 'cardId', errors);
      validateSellSteps(command, errors);
      break;
    case 'resolve_negative_income':
      validateStringArrayField(command, 'industryInstanceIds', errors);
      break;
    case 'resolve_merchant_develop':
      validateIndustryTypeArrayField(command, 'industryTypes', errors);
      break;
    case 'loan':
    case 'pass':
      validateStringField(command, 'cardId', errors);
      break;
    case 'scout':
      validateStringArrayField(command, 'cardIds', errors);
      break;
  }
  return errors;
}

function snapshotCommandPayload(command: CommandPayload): CommandPayload | undefined {
  try {
    const snapshot = structuredClone(command) as unknown;
    return isCommandEnvelope(snapshot) ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function parsePersistedGameStore(raw: string, storagePath: string): Partial<PersistedGameStore> {
  try {
    return JSON.parse(raw) as Partial<PersistedGameStore>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse game store file ${storagePath}: ${detail}`);
  }
}

interface ExpectedBoardSlot {
  id: string;
  locationId: string;
  allowedIndustryTypes: IndustryType[];
}

function expectedBoardSlots(): Record<string, ExpectedBoardSlot> {
  const slots: Record<string, ExpectedBoardSlot> = {};

  for (const location of Object.values(staticConfig.locations)) {
    if (location.kind === 'city') {
      for (const slot of location.slots) {
        slots[slot.id] = {
          id: slot.id,
          locationId: location.id,
          allowedIndustryTypes: [...slot.allowedIndustryTypes],
        };
      }
      continue;
    }

    if (location.kind === 'farm_brewery') {
      const slotId = `${location.id}-brewery`;
      slots[slotId] = {
        id: slotId,
        locationId: location.id,
        allowedIndustryTypes: ['brewery'],
      };
    }
  }

  return slots;
}

function createEmptyBoardState(): BoardState {
  return {
    industryInstances: {},
    linkInstances: {},
    slots: {},
    linkLines: {},
    merchantSpaces: {},
  };
}

function resourceCapacityForIndustrySpec(spec: IndustryTileSpec, era: GameState['era']): number {
  const eraCapacity = spec.resourcesWhenBuilt?.[era];
  if (typeof eraCapacity === 'number' && Number.isFinite(eraCapacity)) {
    return Math.max(0, Math.floor(eraCapacity));
  }
  if (era === 'canal') {
    return 0;
  }
  return Math.max(
    0,
    ...Object.values(spec.resourcesWhenBuilt ?? {})
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );
}

function activeMerchantSpaceIds(playerCount: GameState['playerCount']): string[] {
  return Object.values(staticConfig.locations)
    .filter((location) => location.kind === 'merchant' && location.minPlayers <= playerCount)
    .flatMap((location) => location.kind === 'merchant'
      ? location.spaces
        .filter((space) => space.minPlayers <= playerCount)
        .map((space) => space.id)
      : []);
}

function merchantTileSpecId(merchantTileInstanceId: string): string {
  return merchantTileInstanceId.replace(/-\d+$/, '');
}

function nextMerchantTileInstanceId(specId: string, usedInstanceIds: Set<string>): string {
  let suffix = 0;
  let instanceId = `${specId}-${suffix}`;
  while (usedInstanceIds.has(instanceId)) {
    suffix++;
    instanceId = `${specId}-${suffix}`;
  }
  usedInstanceIds.add(instanceId);
  return instanceId;
}

function normalizeMerchantSpaces(game: GameState): void {
  const legacySpaces = isObjectMap(game.board.merchantSpaces) ? game.board.merchantSpaces : {};
  const activeSpaceIds = activeMerchantSpaceIds(game.playerCount);
  const usedInstanceIds = new Set<string>();
  const usedSpecIds = new Set<string>();
  const normalizedSpaces: BoardState['merchantSpaces'] = {};

  for (const spaceId of activeSpaceIds) {
    const legacySpace = legacySpaces[spaceId];
    if (isObjectMap(legacySpace) && typeof legacySpace.merchantTileInstanceId === 'string') {
      const specId = merchantTileSpecId(legacySpace.merchantTileInstanceId);
      const spec = staticConfig.merchantTileSpecs[specId];
      if (spec && spec.minPlayers <= game.playerCount && !usedSpecIds.has(specId) && !usedInstanceIds.has(legacySpace.merchantTileInstanceId)) {
        normalizedSpaces[spaceId] = {
          id: spaceId,
          merchantTileInstanceId: legacySpace.merchantTileInstanceId,
          beerPresent: typeof legacySpace.beerPresent === 'boolean' ? legacySpace.beerPresent : !spec.blank,
        };
        usedInstanceIds.add(legacySpace.merchantTileInstanceId);
        usedSpecIds.add(specId);
        continue;
      }
    }

    normalizedSpaces[spaceId] = {id: spaceId, beerPresent: false};
  }

  const availableSpecIds = Object.values(staticConfig.merchantTileSpecs)
    .filter((spec) => spec.minPlayers <= game.playerCount && !usedSpecIds.has(spec.id))
    .map((spec) => spec.id)
    .sort((a, b) => a.localeCompare(b));

  for (const space of Object.values(normalizedSpaces)) {
    if (space.merchantTileInstanceId) {
      continue;
    }
    const specId = availableSpecIds.shift();
    if (!specId) {
      continue;
    }
    const spec = staticConfig.merchantTileSpecs[specId];
    space.merchantTileInstanceId = nextMerchantTileInstanceId(specId, usedInstanceIds);
    space.beerPresent = !spec.blank;
    usedSpecIds.add(specId);
  }

  game.board.merchantSpaces = normalizedSpaces;
}

function normalizeBoardOccupancy(game: GameState): Set<string> {
  const invalidActiveIndustryIds = new Set<string>();
  if (!isObjectMap((game as Partial<GameState>).board)) {
    game.board = createEmptyBoardState();
  }
  if (!isObjectMap(game.board.industryInstances)) {
    game.board.industryInstances = {};
  }
  if (!isObjectMap(game.board.linkInstances)) {
    game.board.linkInstances = {};
  }
  if (!isObjectMap(game.board.slots)) {
    game.board.slots = {};
  }
  if (!isObjectMap(game.board.linkLines)) {
    game.board.linkLines = {};
  }
  normalizeMerchantSpaces(game);

  const expectedSlots = expectedBoardSlots();
  game.board.slots = Object.fromEntries(
    Object.keys(expectedSlots).map((slotId) => [slotId, {}]),
  );
  game.board.linkLines = Object.fromEntries(
    Object.keys(staticConfig.linkLines).map((linkLineId) => [linkLineId, {}]),
  );
  const normalizedIndustryInstances: BoardState['industryInstances'] = {};
  for (const [mapId, rawIndustry] of Object.entries(game.board.industryInstances)) {
    if (!isObjectMap(rawIndustry)) {
      continue;
    }
    const industry = rawIndustry as Partial<IndustryInstance> as IndustryInstance;
    if (typeof industry.id !== 'string' || industry.id.length === 0) {
      industry.id = mapId;
    }
    if (industry.id.length === 0) {
      continue;
    }
    industry.removedFromGame = typeof industry.removedFromGame === 'boolean' ? industry.removedFromGame : false;
    normalizedIndustryInstances[industry.id] = industry;
  }
  game.board.industryInstances = normalizedIndustryInstances;

  const activeIndustries = Object.values(game.board.industryInstances)
    .filter((industry) => !industry.removedFromGame)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const industry of activeIndustries) {
    const slotSpec = expectedSlots[industry.slotId];
    const slot = slotSpec ? game.board.slots[industry.slotId] : undefined;
    const spec = staticConfig.industryTileSpecs[industry.specId];
    const validExceptEra = Boolean(
      slotSpec &&
      slot &&
      game.players[industry.ownerPlayerId] &&
      spec &&
      spec.industryType === industry.industryType &&
      industry.locationId === slotSpec.locationId &&
      slotSpec.allowedIndustryTypes.includes(industry.industryType) &&
      !slot.occupiedBy
    );
    const eraMismatch = Boolean(spec && !spec.buildableEras.includes(game.era));
    if (!validExceptEra || eraMismatch) {
      industry.removedFromGame = true;
      // Canal-only tiles found in otherwise valid Rail slots likely represent
      // missed cleanup of tiles that were actually built. Other invalid active
      // entries are ghosts and should not consume player stack tiles.
      const missedCanalCleanup = game.era === 'rail' && eraMismatch && validExceptEra;
      if (!missedCanalCleanup) {
        invalidActiveIndustryIds.add(industry.id);
      }
      continue;
    }
    if (!slot || !spec) {
      continue;
    }

    industry.level = spec.level;
    industry.flipped = typeof industry.flipped === 'boolean' ? industry.flipped : false;
    industry.remainingResource = integerInRange(
      industry.remainingResource,
      0,
      0,
      resourceCapacityForIndustrySpec(spec, game.era),
    );
    if (industry.flipped || (spec.flip.trigger === 'resource_depleted' && industry.remainingResource === 0)) {
      industry.flipped = true;
      industry.remainingResource = 0;
    }

    slot.occupiedBy = industry.id;
  }
  for (const industry of Object.values(game.board.industryInstances)) {
    if (industry.removedFromGame) {
      industry.remainingResource = 0;
    }
  }

  const normalizedLinkInstances: BoardState['linkInstances'] = {};
  for (const [mapId, rawLink] of Object.entries(game.board.linkInstances)) {
    if (!isObjectMap(rawLink)) {
      continue;
    }
    const link = rawLink as Partial<LinkInstance> as LinkInstance;
    if (typeof link.id !== 'string' || link.id.length === 0) {
      link.id = mapId;
    }
    if (link.id.length === 0) {
      continue;
    }
    normalizedLinkInstances[link.id] = link;
  }
  game.board.linkInstances = normalizedLinkInstances;

  const activeLinks = Object.values(game.board.linkInstances)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const link of activeLinks) {
    const line = game.board.linkLines[link.linkLineId];
    if (
      !line ||
      !game.players[link.ownerPlayerId] ||
      link.linkType !== game.era ||
      !staticConfig.linkLines[link.linkLineId]?.allowedLinkTypes.includes(link.linkType) ||
      line.occupiedBy
    ) {
      delete game.board.linkInstances[link.id];
      continue;
    }

    line.occupiedBy = link.id;
  }

  return invalidActiveIndustryIds;
}

function normalizeCardZones(game: GameState): void {
  if (!isObjectMap((game as Partial<GameState>).cardZones)) {
    game.cardZones = {
      drawDeck: [],
      wildLocationPool: [],
      wildIndustryPool: [],
    };
  }

  const regularCardIds = new Set(getCardIdsForPlayerCount(game.playerCount));
  const wildLocationIds = new Set(getWildLocationCardIds());
  const wildIndustryIds = new Set(getWildIndustryCardIds());
  const claimed = new Set<string>();

  const normalizeCardList = (value: unknown, acceptsCard: (cardId: string) => boolean): string[] => {
    const normalized: string[] = [];
    if (!Array.isArray(value)) {
      return normalized;
    }

    for (const cardId of value) {
      if (typeof cardId !== 'string' || !acceptsCard(cardId) || claimed.has(cardId)) {
        continue;
      }
      claimed.add(cardId);
      normalized.push(cardId);
    }
    return normalized;
  };

  for (const playerId of playerIdsInSeatOrder(game)) {
    const player = game.players[playerId];
    player.handCardIds = normalizeCardList(
      player.handCardIds,
      (cardId) => regularCardIds.has(cardId) || wildLocationIds.has(cardId) || wildIndustryIds.has(cardId),
    );
  }

  for (const playerId of playerIdsInSeatOrder(game)) {
    const player = game.players[playerId];
    player.discardCardIds = normalizeCardList(player.discardCardIds, (cardId) => regularCardIds.has(cardId));
  }

  game.cardZones.drawDeck = normalizeCardList(game.cardZones.drawDeck, (cardId) => regularCardIds.has(cardId));
  game.cardZones.wildLocationPool = normalizeCardList(game.cardZones.wildLocationPool, (cardId) => wildLocationIds.has(cardId));
  game.cardZones.wildIndustryPool = normalizeCardList(game.cardZones.wildIndustryPool, (cardId) => wildIndustryIds.has(cardId));

  for (const cardId of [...regularCardIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.drawDeck.push(cardId);
    }
  }
  for (const cardId of [...wildLocationIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.wildLocationPool.push(cardId);
    }
  }
  for (const cardId of [...wildIndustryIds].sort()) {
    if (!claimed.has(cardId)) {
      claimed.add(cardId);
      game.cardZones.wildIndustryPool.push(cardId);
    }
  }
}

function normalizeTurnState(game: GameState): void {
  const playerIds = playerIdsInSeatOrder(game);
  const validPlayerIds = new Set(playerIds);
  const normalizedTurnOrder: string[] = [];
  const seenPlayerIds = new Set<string>();
  const loadedTurnOrder = Array.isArray(game.turnOrder) ? game.turnOrder : [];

  for (const playerId of loadedTurnOrder) {
    if (typeof playerId !== 'string' || !validPlayerIds.has(playerId) || seenPlayerIds.has(playerId)) {
      continue;
    }
    seenPlayerIds.add(playerId);
    normalizedTurnOrder.push(playerId);
  }

  for (const playerId of playerIds) {
    if (!seenPlayerIds.has(playerId)) {
      normalizedTurnOrder.push(playerId);
    }
  }

  game.turnOrder = normalizedTurnOrder;
  if (game.turnOrder.length === 0) {
    game.currentTurnIndex = 0;
    game.actionIndexInTurn = 0;
    return;
  }

  const loadedTurnIndex = (game as {currentTurnIndex?: unknown}).currentTurnIndex;
  game.currentTurnIndex = typeof loadedTurnIndex === 'number' &&
    Number.isFinite(loadedTurnIndex) &&
    Math.floor(loadedTurnIndex) === loadedTurnIndex &&
    loadedTurnIndex >= 0 &&
    loadedTurnIndex < game.turnOrder.length
    ? loadedTurnIndex
    : 0;

  if (game.actionsAllowedThisTurn !== 1 && game.actionsAllowedThisTurn !== 2) {
    game.actionsAllowedThisTurn = game.era === 'canal' && game.roundNumber === 1
      ? staticConfig.rules.firstCanalRoundActions
      : staticConfig.rules.normalActionsPerTurn;
  }

  const loadedActionIndex = (game as {actionIndexInTurn?: unknown}).actionIndexInTurn;
  game.actionIndexInTurn = typeof loadedActionIndex === 'number' && Number.isFinite(loadedActionIndex)
    ? Math.max(0, Math.min(Math.floor(loadedActionIndex), game.actionsAllowedThisTurn - 1))
    : 0;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.floor(value), max));
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeNumericState(game: GameState): void {
  if (game.era !== 'canal' && game.era !== 'rail') {
    game.era = 'canal';
  }
  if (game.status !== 'playing' && game.status !== 'ended') {
    game.status = 'playing';
  }
  game.roundNumber = nonNegativeInteger(game.roundNumber, 1) || 1;
  game.nextInstanceId = nonNegativeInteger(game.nextInstanceId, 1) || 1;

  if (!isObjectMap((game as Partial<GameState>).markets)) {
    game.markets = {
      coal: {occupiedCount: staticConfig.markets.coal.initialOccupiedCount},
      iron: {occupiedCount: staticConfig.markets.iron.initialOccupiedCount},
    };
  }
  for (const marketName of ['coal', 'iron'] as const) {
    const market = isObjectMap(game.markets[marketName])
      ? game.markets[marketName]
      : {occupiedCount: staticConfig.markets[marketName].initialOccupiedCount};
    market.occupiedCount = integerInRange(
      (market as {occupiedCount?: unknown}).occupiedCount,
      staticConfig.markets[marketName].initialOccupiedCount,
      0,
      staticConfig.markets[marketName].priceSlotsCheapestToMostExpensive.length,
    );
    game.markets[marketName] = market;
  }

  for (const player of Object.values(game.players)) {
    player.cash = nonNegativeInteger(player.cash, staticConfig.rules.initialCash);
    player.victoryPoints = nonNegativeInteger(player.victoryPoints, 0);
    player.incomeTrackPosition = integerInRange(
      player.incomeTrackPosition,
      staticConfig.incomeTrack.startPosition,
      0,
      staticConfig.incomeTrack.positions.length - 1,
    );
    player.spentThisRound = nonNegativeInteger(player.spentThisRound, 0);

    if (!isObjectMap(player.remainingLinks)) {
      player.remainingLinks = {
        canal: staticConfig.rules.initialLinksPerType,
        rail: staticConfig.rules.initialLinksPerType,
      };
    }
    for (const linkType of ['canal', 'rail'] as const) {
      player.remainingLinks[linkType] = integerInRange(
        player.remainingLinks[linkType],
        staticConfig.rules.initialLinksPerType,
        0,
        staticConfig.rules.initialLinksPerType,
      );
    }
  }
}

function normalizeScoreRecord(value: unknown, playerIds: string[]): Record<string, number> {
  const source = isObjectMap(value) ? value : {};
  return Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    nonNegativeInteger(source[playerId], 0),
  ]));
}

function normalizeLastEraScore(game: GameState): void {
  const score = (game as Partial<GameState>).lastEraScore;
  if (!isObjectMap(score) || (score.era !== 'canal' && score.era !== 'rail')) {
    game.lastEraScore = undefined;
    return;
  }

  const canKeepScore = game.status === 'ended'
    ? score.era === game.era
    : game.era === 'rail' && score.era === 'canal';
  if (!canKeepScore) {
    game.lastEraScore = undefined;
    return;
  }

  const playerIds = Object.keys(game.players);
  game.lastEraScore = {
    era: score.era,
    linkVictoryPointsByPlayer: normalizeScoreRecord(score.linkVictoryPointsByPlayer, playerIds),
    industryVictoryPointsByPlayer: normalizeScoreRecord(score.industryVictoryPointsByPlayer, playerIds),
    totalVictoryPointsByPlayer: normalizeScoreRecord(score.totalVictoryPointsByPlayer, playerIds),
  };
}

function normalizePlayersAndCount(game: GameState): void {
  const loadedPlayers = isObjectMap((game as Partial<GameState>).players) ? game.players : {};
  const normalizedPlayers: GameState['players'] = {};
  const entries = Object.entries(loadedPlayers)
    .filter(([, player]) => isObjectMap(player))
    .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
    .slice(0, 4);

  for (const [index, [playerId, loadedPlayer]] of entries.entries()) {
    const player = loadedPlayer as GameState['players'][string];
    player.id = playerId;
    player.name = typeof player.name === 'string' && player.name.trim().length > 0
      ? player.name.trim()
      : `Player ${index + 1}`;
    player.handCardIds = Array.isArray(player.handCardIds) ? player.handCardIds : [];
    player.discardCardIds = Array.isArray(player.discardCardIds) ? player.discardCardIds : [];
    normalizedPlayers[playerId] = player;
  }

  game.players = normalizedPlayers;
  const playerCount = Object.keys(game.players).length;
  game.playerCount = isPlayerCount(playerCount)
    ? playerCount
    : isPlayerCount(game.playerCount) ? game.playerCount : 2;
}

function merchantSpaceHasDevelopBonus(merchantSpaceId: string): boolean {
  return Object.values(staticConfig.locations).some((location) =>
    location.kind === 'merchant' &&
    location.bonus.type === 'develop' &&
    location.spaces.some((space) => space.id === merchantSpaceId),
  );
}

function normalizeMerchantDevelopSpaceIds(game: GameState, decision: Record<string, unknown>, fallbackSpaceId: string): string[] {
  const candidateSpaceIds = [
    fallbackSpaceId,
    ...(Array.isArray(decision.merchantSpaceIds) ? decision.merchantSpaceIds : []),
  ];
  return [...new Set(candidateSpaceIds.filter((spaceId): spaceId is string =>
    typeof spaceId === 'string' &&
    Boolean(game.board.merchantSpaces[spaceId]) &&
    merchantSpaceHasDevelopBonus(spaceId),
  ))];
}

function normalizePendingDecision(game: GameState): void {
  const decision = (game as Partial<GameState>).pendingDecision;
  if (!isRecord(decision) || typeof decision.type !== 'string') {
    game.pendingDecision = undefined;
    return;
  }

  if (decision.type === 'negative_income') {
    const playerId = decision.playerId;
    const amountOwed = decision.amountOwed;
    if (typeof playerId !== 'string' || !game.players[playerId] || typeof amountOwed !== 'number' || !Number.isFinite(amountOwed)) {
      game.pendingDecision = undefined;
      return;
    }

    const incomePlayerIndex = game.turnOrder.indexOf(playerId);
    const normalizedAmount = Math.floor(amountOwed);
    if (incomePlayerIndex < 0 || normalizedAmount <= 0) {
      game.pendingDecision = undefined;
      return;
    }

    game.currentTurnIndex = incomePlayerIndex;
    game.actionIndexInTurn = 0;
    game.pendingDecision = {
      type: 'negative_income',
      playerId,
      amountOwed: normalizedAmount,
      incomePlayerIndex,
    };
    return;
  }

  if (decision.type === 'merchant_develop') {
    const playerId = decision.playerId;
    const merchantSpaceId = decision.merchantSpaceId;
    const count = decision.count;
    if (
      typeof playerId !== 'string' ||
      !game.players[playerId] ||
      typeof merchantSpaceId !== 'string' ||
      !game.board.merchantSpaces[merchantSpaceId] ||
      !merchantSpaceHasDevelopBonus(merchantSpaceId) ||
      typeof count !== 'number' ||
      !Number.isFinite(count)
    ) {
      game.pendingDecision = undefined;
      return;
    }

    const currentTurnIndex = game.turnOrder.indexOf(playerId);
    const normalizedCount = Math.min(2, Math.floor(count));
    if (currentTurnIndex < 0 || normalizedCount <= 0) {
      game.pendingDecision = undefined;
      return;
    }
    const merchantSpaceIds = normalizeMerchantDevelopSpaceIds(game, decision, merchantSpaceId);

    game.currentTurnIndex = currentTurnIndex;
    game.pendingDecision = {
      type: 'merchant_develop',
      playerId,
      count: normalizedCount,
      merchantSpaceId,
      merchantSpaceIds,
    };
    return;
  }

  game.pendingDecision = undefined;
}

function stringSetFromArray(value: unknown): Set<string> {
  return new Set(Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []);
}

function consumedIndustrySpecIds(
  game: GameState,
  playerId: string,
  industryType: IndustryType,
  invalidActiveIndustryIds: Set<string>,
): Set<string> {
  const consumed = new Set<string>();
  for (const industry of Object.values(game.board.industryInstances)) {
    if (invalidActiveIndustryIds.has(industry.id)) {
      continue;
    }
    const spec = staticConfig.industryTileSpecs[industry.specId];
    if (
      industry.ownerPlayerId === playerId &&
      industry.industryType === industryType &&
      spec?.industryType === industryType
    ) {
      consumed.add(industry.specId);
    }
  }
  return consumed;
}

function normalizeEventLog(game: GameState): void {
  game.eventLog = Array.isArray(game.eventLog)
    ? game.eventLog.filter((event) => isRecord(event) && typeof event.type === 'string') as GameState['eventLog']
    : [];
}

function isRecoverableLoadedGame(value: unknown): value is GameState {
  return isObjectMap(value) && typeof value.id === 'string' && value.id.trim().length > 0;
}

function hasSupportedPlayerSet(game: GameState): boolean {
  return isPlayerCount(Object.keys(game.players).length);
}

function normalizeLoadedGame(game: GameState): GameState {
  normalizePlayersAndCount(game);
  normalizeNumericState(game);
  const invalidActiveIndustryIds = normalizeBoardOccupancy(game);
  normalizeCardZones(game);
  normalizeTurnState(game);
  normalizePendingDecision(game);
  normalizeEventLog(game);
  normalizeLastEraScore(game);

  for (const [playerId, player] of Object.entries(game.players)) {
    if (!isObjectMap(player.industryTileStacks)) {
      player.industryTileStacks = {} as GameState['players'][string]['industryTileStacks'];
    }
    for (const industryType of INDUSTRY_TYPES) {
      const staticSpecIds = staticConfig.industryStackSpecIds[industryType];
      const loadedStack = isObjectMap(player.industryTileStacks[industryType])
        ? player.industryTileStacks[industryType]
        : undefined;
      const availableSource = Array.isArray(loadedStack?.availableSpecIdsInOrder)
        ? stringSetFromArray(loadedStack.availableSpecIdsInOrder)
        : new Set(staticSpecIds);
      const removedSource = stringSetFromArray(loadedStack?.removedSpecIds);
      const consumedSpecIds = consumedIndustrySpecIds(game, playerId, industryType, invalidActiveIndustryIds);

      player.industryTileStacks[industryType] = {
        availableSpecIdsInOrder: staticSpecIds.filter((specId) =>
          availableSource.has(specId) && !removedSource.has(specId) && !consumedSpecIds.has(specId),
        ),
        removedSpecIds: staticSpecIds.filter((specId) => removedSource.has(specId) && !consumedSpecIds.has(specId)),
        builtInstanceIds: [],
      };
    }

    const loadedCount = (player as {faceDownDiscardCount?: unknown}).faceDownDiscardCount;
    if (typeof loadedCount === 'number' && Number.isFinite(loadedCount)) {
      player.faceDownDiscardCount = Math.max(0, Math.min(Math.floor(loadedCount), player.discardCardIds.length));
      continue;
    }

    player.faceDownDiscardCount = game.era === 'canal'
      ? Math.min(1, player.discardCardIds.length)
      : 0;
  }

  for (const industry of Object.values(game.board.industryInstances)) {
    if (industry.removedFromGame) {
      continue;
    }
    const owner = game.players[industry.ownerPlayerId];
    const stack = owner?.industryTileStacks[industry.industryType];
    if (stack) {
      stack.builtInstanceIds.push(industry.id);
    }
  }
  return game;
}

function cloneGame(game: GameState): GameState {
  return structuredClone(game) as GameState;
}

export class GameStore {
  private readonly games = new Map<string, GameState>();
  private readonly sessions = new Map<string, Map<string, string>>();
  private readonly storagePath?: string;

  constructor(options: GameStoreOptions = {}) {
    this.storagePath = options.storagePath;
    this.load();
  }

  create(input: CreateStoredGameInput): GameState {
    const seed = validateGameSeed(input.seed);
    const game = createGame({
      id: randomUUID(),
      playerNames: input.playerNames.map((name, index) => name.trim() || `Player ${index + 1}`),
      seed,
    });
    this.games.set(game.id, game);
    this.sessions.set(game.id, this.createSessionsForGame(game));
    try {
      this.persist();
    } catch (error) {
      this.games.delete(game.id);
      this.sessions.delete(game.id);
      throw error;
    }
    return game;
  }

  get(id: string): GameState | undefined {
    return this.games.get(id);
  }

  getPlayerSessions(gameId: string): PlayerSession[] {
    return [...(this.sessions.get(gameId)?.entries() ?? [])].map(([playerId, token]) => ({playerId, token}));
  }

  getPlayerSession(gameId: string, playerId: string): PlayerSession | undefined {
    const token = this.sessions.get(gameId)?.get(playerId);
    return token ? {playerId, token} : undefined;
  }

  verifyPlayerSession(gameId: string, playerId: string, token: string | undefined): boolean {
    return Boolean(token && this.sessions.get(gameId)?.get(playerId) === token);
  }

  list(): GameSummary[] {
    return [...this.games.values()].map((game) => {
      const pendingDecision = game.pendingDecision
        ? {type: game.pendingDecision.type, playerId: game.pendingDecision.playerId}
        : undefined;
      return {
        id: game.id,
        playerNames: playerIdsInSeatOrder(game).map((playerId) => game.players[playerId].name),
        playerCount: game.playerCount,
        roundNumber: game.roundNumber,
        era: game.era,
        status: game.status,
        ...(game.status === 'playing' ? {currentPlayerId: getCurrentPlayerId(game)} : {}),
        ...(pendingDecision ? {pendingDecision} : {}),
      };
    });
  }

  apply(gameId: string, command: unknown, token?: string): CommandResult {
    const game = this.games.get(gameId);
    if (!game) {
      return {ok: false, errors: [`Unknown game: ${gameId}`]};
    }
    if (!isCommandEnvelope(command)) {
      return {ok: false, errors: ['Malformed command']};
    }
    const commandSnapshot = snapshotCommandPayload(command);
    if (!commandSnapshot) {
      return {ok: false, errors: ['Malformed command']};
    }
    if (!this.verifyPlayerSession(gameId, commandSnapshot.playerId, token)) {
      return {ok: false, errors: [`Invalid session for ${commandSnapshot.playerId}`]};
    }
    const shapeErrors = validateCommandPayloadShape(commandSnapshot);
    if (shapeErrors.length > 0) {
      return {ok: false, errors: shapeErrors};
    }

    try {
      const gameCommand = commandSnapshot as unknown as GameCommand;
      const candidate = cloneGame(game);
      const validation = validateCommand(candidate, gameCommand);
      if (!validation.ok) {
        return {ok: false, errors: validation.errors};
      }

      applyCommand(candidate, gameCommand);
      this.games.set(gameId, candidate);
      try {
        this.persist();
      } catch (error) {
        this.games.set(gameId, game);
        throw error;
      }
      return {ok: true, state: candidate};
    } catch (error) {
      return {ok: false, errors: [error instanceof Error ? error.message : String(error)]};
    }
  }

  private createSessionsForGame(game: GameState): Map<string, string> {
    return new Map(Object.keys(game.players).map((playerId) => [playerId, randomUUID()]));
  }

  private normalizeSessionsForGame(game: GameState, persistedSessions: unknown): Map<string, string> {
    const playerIds = Object.keys(game.players);
    if (!Array.isArray(persistedSessions)) {
      return this.createSessionsForGame(game);
    }

    const sessions = new Map<string, string>();
    const validPlayerIds = new Set(playerIds);
    for (const session of persistedSessions) {
      if (
        typeof session === 'object' &&
        session !== null &&
        typeof (session as Partial<PlayerSession>).playerId === 'string' &&
        typeof (session as Partial<PlayerSession>).token === 'string' &&
        validPlayerIds.has((session as PlayerSession).playerId)
      ) {
        sessions.set((session as PlayerSession).playerId, (session as PlayerSession).token);
      }
    }

    for (const playerId of playerIds) {
      if (!sessions.has(playerId)) {
        sessions.set(playerId, randomUUID());
      }
    }
    return sessions;
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }
    const raw = fs.readFileSync(this.storagePath, 'utf8');
    const parsed = parsePersistedGameStore(raw, this.storagePath);
    if (parsed.version !== 1 || !Array.isArray(parsed.games)) {
      throw new Error(`Unsupported game store file: ${this.storagePath}`);
    }
    this.games.clear();
    this.sessions.clear();
    for (const loadedGame of parsed.games) {
      if (!isRecoverableLoadedGame(loadedGame)) {
        continue;
      }
      const game = normalizeLoadedGame(loadedGame);
      if (!hasSupportedPlayerSet(game)) {
        continue;
      }
      this.games.set(game.id, game);
      this.sessions.set(game.id, this.normalizeSessionsForGame(game, parsed.sessions?.[game.id]));
    }
  }

  private persist(): void {
    if (!this.storagePath) {
      return;
    }
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, {recursive: true});
    const payload: PersistedGameStore = {
      version: 1,
      games: [...this.games.values()],
      sessions: Object.fromEntries([...this.sessions.entries()].map(([gameId, sessions]) => [
        gameId,
        [...sessions.entries()].map(([playerId, token]) => ({playerId, token})),
      ])),
    };
    const temporaryPath = `${this.storagePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2));
    fs.renameSync(temporaryPath, this.storagePath);
  }
}

export const gameStore = new GameStore({
  storagePath: process.env.BRASS_GAME_STORE_PATH ?? path.join(process.cwd(), 'data', 'games.json'),
});
