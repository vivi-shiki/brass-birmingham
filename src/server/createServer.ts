import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import {createServer, type Server as HttpServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Server as SocketIOServer, type Socket as ServerSocket} from 'socket.io';
import {
  cashChangeReasonMatchesDelta,
  incomeChangeReasonMatchesMove,
  normalizeGameEventReason,
  resourceConsumptionReasonMatchesSource,
  victoryPointReasonMatchesDelta,
} from '../common/eventLogValidation';
import {
  applyFaceAuditReviewSheet,
  buildFaceAuditAreaReviewTodoSummary,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditAreaMatchReviewArtifact,
  buildFaceAuditAreaReviewerInstructionsReport,
  buildFaceAuditAreaReviewSheet,
  buildFaceAuditChecklistExport,
  buildFaceAuditEvidenceRefTemplate,
  buildFaceAuditLockArtifact,
  buildFaceAuditLockPreview,
  buildFaceAuditMappedMatchReviewArtifact,
  buildFaceAuditMatchReviewArtifact,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewerInstructions,
  buildFaceAuditReviewPlan,
  buildFaceAuditReviewSheet,
  buildFaceAuditReviewTodo,
  buildFaceAuditReviewTodoSummary,
  buildFaceAuditReviewTemplate,
  buildFaceAuditSourceIdsByAreaTemplate,
  faceAuditAreaReviewerInstructionsArtifactFileName,
  faceAuditAreaReviewArtifactFileName,
  faceAuditAreaReviewSheetArtifactFileName,
  mergeFaceAuditReviewArtifacts,
  parseFaceAuditArea,
  parseFaceAuditEvidenceRefMode,
  summarizeFaceAuditReviewerHandoffResponse,
  summarizeFaceAuditReviewStatus,
  validateFaceAuditLockArtifact,
  validateFaceAuditReviewerHandoffArtifact,
  validateFaceAuditReviewArtifact,
  validateFaceAuditReadyArtifact,
  validateFaceAuditStaticLockGate,
  validFaceAuditEvidenceSourceId,
  type FaceAuditArea,
  type FaceAuditEvidenceRefMode,
} from '../common/faceAudit';
import {determineWinners} from '../common/gameEngine';
import {INDUSTRY_TYPES, LINK_TYPES, validateGameSeed} from '../common/gameSetup';
import {advanceIncomeSpaces, getIncomeLevel, retreatIncomeLevels} from '../common/income';
import {staticConfig} from '../common/staticData';
import type {
  EraScoreBreakdown,
  GameCommand,
  GameEvent,
  GameState,
  IndustryInstance,
  IndustryType,
  LinkInstance,
  LinkType,
  MerchantBonus,
  ResourceSource,
} from '../common/types';
import type {GameStore, GameSummary, PlayerSession} from './gameStore';

export interface BrassServerOptions {
  store: GameStore;
  clientDist?: string;
}

export interface BrassServer {
  app: express.Express;
  server: HttpServer;
  io: SocketIOServer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError && isRecord(error) && 'body' in error;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function publicGameId(value: unknown): string {
  return nonEmptyString(value) ?? 'unknown-game';
}

function gameIdFromRouteParam(value: string): string {
  return nonEmptyString(value) ?? value;
}

function playerIdFromCommand(command: unknown): string | undefined {
  return isRecord(command) ? nonEmptyString(command.playerId) : undefined;
}

function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.get('origin');
  if (!origin) {
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.get('access-control-request-headers') ?? 'content-type,x-player-id,x-player-token',
  );
  res.append('Vary', 'Origin');
}

function playerNamesFromPayload(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.playerNames)) {
    throw new Error('Player names must be an array');
  }
  if (!payload.playerNames.every((name) => typeof name === 'string')) {
    throw new Error('Player names must be strings');
  }
  return payload.playerNames;
}

function seedFromPayload(payload: unknown): number | undefined {
  if (!isRecord(payload) || !('seed' in payload) || payload.seed === undefined) {
    return undefined;
  }
  if (typeof payload.seed !== 'number' || !Number.isFinite(payload.seed)) {
    throw new Error('Game seed must be a finite number');
  }
  return validateGameSeed(payload.seed);
}

function introductoryCanalOnlyFromPayload(payload: unknown): boolean | undefined {
  if (!isRecord(payload) || !('introductoryCanalOnly' in payload) || payload.introductoryCanalOnly === undefined) {
    return undefined;
  }
  if (typeof payload.introductoryCanalOnly !== 'boolean') {
    throw new Error('introductoryCanalOnly must be a boolean');
  }
  return payload.introductoryCanalOnly;
}

function hiddenCardIds(count: number): string[] {
  return Array.from({length: count}, (_, index) => `hidden-card-${index + 1}`);
}

function isCardActiveForPlayerCount(cardId: string, playerCount: GameState['playerCount']): boolean {
  const card = staticConfig.cardSpecs[cardId];
  return Boolean(card && (
    card.type === 'wild_location' ||
    card.type === 'wild_industry' ||
    card.minPlayers === playerCount
  ));
}

function knownCardIdsForPlayerCount(value: unknown, playerCount: GameState['playerCount']): string[] {
  return filteredStringArray(value, (cardId) => isCardActiveForPlayerCount(cardId, playerCount));
}

function projectFaceDownDiscardCount(value: unknown, discardCardCount: number): number {
  const loadedFaceDownCount = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : 0;
  return Math.max(0, Math.min(loadedFaceDownCount, discardCardCount));
}

function discardCardIdsForView(player: GameState['players'][string], playerCount: GameState['playerCount']): string[] {
  const discardCardIds = knownCardIdsForPlayerCount(player.discardCardIds, playerCount);
  const faceDownCount = projectFaceDownDiscardCount(player.faceDownDiscardCount, discardCardIds.length);
  return [
    ...hiddenCardIds(faceDownCount),
    ...discardCardIds.slice(faceDownCount),
  ];
}

function hiddenFaceDownDiscardIds(
  game: GameState,
  playerIds = Object.keys(game.players),
  playerCount = projectPlayerCount(game.playerCount, playerIds),
): Map<string, Map<string, string>> {
  const byPlayer = new Map<string, Map<string, string>>();
  for (const playerId of playerIds) {
    const player = game.players[playerId];
    if (!player) {
      continue;
    }
    const discardCardIds = knownCardIdsForPlayerCount(player.discardCardIds, playerCount);
    const faceDownCount = projectFaceDownDiscardCount(player.faceDownDiscardCount, discardCardIds.length);
    const hiddenIds = new Map<string, string>();
    for (const [index, cardId] of discardCardIds.slice(0, faceDownCount).entries()) {
      hiddenIds.set(cardId, `hidden-card-${index + 1}`);
    }
    byPlayer.set(playerId, hiddenIds);
  }
  return byPlayer;
}

function publicDiscardCardId(
  rawCardId: string,
  hiddenDiscardIds: Map<string, string> | undefined,
  playerCount: GameState['playerCount'],
): string | undefined {
  const hiddenCardId = hiddenDiscardIds?.get(rawCardId);
  if (hiddenCardId !== undefined) {
    return hiddenCardId;
  }
  return isCardActiveForPlayerCount(rawCardId, playerCount) ? rawCardId : undefined;
}

function isGeneratedInstanceId(value: string | undefined, prefix: 'industry' | 'link'): value is string {
  if (value === undefined || !value.startsWith(`${prefix}-`)) {
    return false;
  }
  return /^[0-9]+$/.test(value.slice(prefix.length + 1));
}

const ERAS = ['canal', 'rail'] as const;
const GAME_STATUSES = ['playing', 'ended'] as const;
const DISCARD_DESTINATIONS = ['discard', 'wild_pool'] as const;
const INDUSTRY_REMOVAL_REASONS = ['overbuild', 'develop', 'canal_cleanup', 'negative_income'] as const;
const MARKETS = ['coal', 'iron'] as const;
const RESOURCE_TYPES = ['coal', 'iron', 'beer'] as const;
const PUBLIC_PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'] as const;
const PUBLIC_MERCHANT_SPACE_IDS = new Set(Object.values(staticConfig.locations).flatMap((location) =>
  location.kind === 'merchant' ? location.spaces.map((space) => space.id) : [],
));
const PUBLIC_SLOT_IDS = new Set(Object.values(staticConfig.locations).flatMap((location) => {
  if (location.kind === 'city') {
    return location.slots.map((slot) => slot.id);
  }
  if (location.kind === 'farm_brewery') {
    return [`${location.id}-brewery`];
  }
  return [];
}));
const PUBLIC_LINK_LINE_IDS = new Set(Object.keys(staticConfig.linkLines));

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function publicEventReason(value: unknown): string | undefined {
  return normalizeGameEventReason(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
}

function finiteNumberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerField(record: Record<string, unknown>, field: string): number | undefined {
  const value = finiteNumberField(record, field);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function nonNegativeIntegerField(record: Record<string, unknown>, field: string): number | undefined {
  const value = integerField(record, field);
  return value !== undefined && value >= 0 ? value : undefined;
}

function positiveIntegerField(record: Record<string, unknown>, field: string): number | undefined {
  const value = integerField(record, field);
  return value !== undefined && value > 0 ? value : undefined;
}

function booleanField(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field];
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return [...value];
}

function trimmedStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values: string[] = [];
  for (const item of value) {
    const stringValue = nonEmptyString(item);
    if (stringValue === undefined) {
      return undefined;
    }
    values.push(stringValue);
  }
  return values;
}

function filteredStringArray(value: unknown, accepts: (item: string) => boolean): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && accepts(item));
}

function isKnownCardType(cardId: string, type: 'wild_location' | 'wild_industry'): boolean {
  return staticConfig.cardSpecs[cardId]?.type === type;
}

function isKnownIndustrySpecIdForType(specId: string, industryType: string): boolean {
  return staticConfig.industryTileSpecs[specId]?.industryType === industryType;
}

function merchantTileInstanceIdForView(value: unknown): string | undefined {
  const merchantTileInstanceId = nonEmptyString(value);
  if (merchantTileInstanceId === undefined) {
    return undefined;
  }
  const specId = merchantTileInstanceId.replace(/-\d+$/, '');
  return staticConfig.merchantTileSpecs[specId] ? merchantTileInstanceId : undefined;
}

function industrySlotAllows(locationId: string, slotId: string, industryType: string): boolean {
  const location = staticConfig.locations[locationId];
  if (location?.kind === 'city') {
    return Boolean(location.slots.find((slot) =>
      slot.id === slotId && slot.allowedIndustryTypes.some((allowed) => allowed === industryType),
    ));
  }
  return location?.kind === 'farm_brewery' &&
    industryType === 'brewery' &&
    slotId === `${location.id}-brewery`;
}

function industrySpecMatches(specId: string, industryType: string, level: number): boolean {
  const spec = staticConfig.industryTileSpecs[specId];
  return Boolean(spec && spec.industryType === industryType && spec.level === level);
}

function playerIdField(record: Record<string, unknown>, field: string, playerIds: string[]): string | undefined {
  const value = nonEmptyString(record[field]);
  return value !== undefined && playerIds.includes(value) ? value : undefined;
}

function playerIdArray(value: unknown, playerIds: string[]): string[] | undefined {
  const values = stringArray(value);
  if (values === undefined) {
    return undefined;
  }
  const normalizedValues = values.map((playerId) => playerId.trim());
  const filtered = normalizedValues.filter((playerId, index) =>
    playerId !== '' && playerIds.includes(playerId) && normalizedValues.indexOf(playerId) === index,
  );
  return filtered.length === 0 ? undefined : filtered;
}

function playerIdSetsMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((playerId) => right.includes(playerId));
}

function isCompletePlayerOrder(order: string[] | undefined, playerIds: string[]): order is string[] {
  return order !== undefined && order.length === playerIds.length && playerIds.every((playerId) => order.includes(playerId));
}

function projectTurnOrder(value: unknown, playerIds: string[]): string[] {
  const projected = playerIdArray(value, playerIds) ?? [];
  return [
    ...projected,
    ...playerIds.filter((playerId) => !projected.includes(playerId)),
  ];
}

function currentPlayerIdFromTurnState(turnOrderValue: unknown, currentTurnIndexValue: unknown, playerIds: string[]): string | undefined {
  if (
    !Array.isArray(turnOrderValue) ||
    typeof currentTurnIndexValue !== 'number' ||
    !Number.isInteger(currentTurnIndexValue) ||
    currentTurnIndexValue < 0 ||
    currentTurnIndexValue >= turnOrderValue.length
  ) {
    return undefined;
  }
  const playerId = nonEmptyString(turnOrderValue[currentTurnIndexValue]);
  return playerId !== undefined && playerIds.includes(playerId) ? playerId : undefined;
}

function declaredPlayerCount(value: unknown): GameState['playerCount'] | undefined {
  return value === 2 || value === 3 || value === 4 ? value : undefined;
}

function projectPlayerIdsForDeclaredCount(value: unknown, playerCount: GameState['playerCount'] | undefined): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const publicPlayerIds = playerCount === undefined
    ? PUBLIC_PLAYER_IDS
    : PUBLIC_PLAYER_IDS.slice(0, playerCount);
  return publicPlayerIds.filter((playerId) => isRecord(value[playerId]));
}

function projectPlayerCount(value: unknown, playerIds: string[]): GameState['playerCount'] {
  const declaredCount = declaredPlayerCount(value);
  if (declaredCount !== undefined) {
    return declaredCount;
  }
  const count = playerIds.length;
  if (count === 2 || count === 3 || count === 4) {
    return count;
  }
  return 2;
}

function publicPlayerName(playerId: string, player: Record<string, unknown>): string {
  const name = nonEmptyString(player.name);
  if (name !== undefined) {
    return name;
  }
  const seat = /^p(\d+)$/.exec(playerId)?.[1];
  return seat ? `Player ${seat}` : 'Player';
}

function isLocationActiveForPlayerCount(playerCount: GameState['playerCount'], locationId: string): boolean {
  const location = staticConfig.locations[locationId];
  return Boolean(location && (location.kind !== 'merchant' || location.minPlayers <= playerCount));
}

function isMerchantSpaceActiveForPlayerCount(playerCount: GameState['playerCount'], spaceId: string): boolean {
  return Object.values(staticConfig.locations).some((location) =>
    location.kind === 'merchant' &&
    location.minPlayers <= playerCount &&
    location.spaces.some((space) => space.id === spaceId && space.minPlayers <= playerCount),
  );
}

function isLinkLineActiveForPlayerCount(playerCount: GameState['playerCount'], linkLineId: string): boolean {
  const line = staticConfig.linkLines[linkLineId];
  return Boolean(line && [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId))
    .every((locationId) => isLocationActiveForPlayerCount(playerCount, locationId)));
}

function projectRoundNumber(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

function projectCurrentTurnIndex(
  value: unknown,
  sourceTurnOrder: unknown,
  turnOrder: string[],
  playerIds: string[],
): number {
  if (turnOrder.length === 0) {
    return 0;
  }
  const currentPlayerId = currentPlayerIdFromTurnState(sourceTurnOrder, value, playerIds);
  if (currentPlayerId !== undefined) {
    return turnOrder.indexOf(currentPlayerId);
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < turnOrder.length
    ? value
    : 0;
}

function projectActionsAllowedThisTurn(value: unknown, era: GameState['era'], roundNumber: number): 1 | 2 {
  if (value === 1 || value === 2) {
    return value;
  }
  return era === 'canal' && roundNumber === 1 ? 1 : 2;
}

function projectActionIndexInTurn(value: unknown, actionsAllowedThisTurn: 1 | 2): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < actionsAllowedThisTurn
    ? value
    : 0;
}

function projectNextInstanceId(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function marketOccupiedCount(value: unknown, marketName: 'coal' | 'iron'): number {
  const config = staticConfig.markets[marketName];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return config.initialOccupiedCount;
  }
  return Math.min(value, config.priceSlotsCheapestToMostExpensive.length);
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values: T[] = [];
  for (const item of value) {
    const stringValue = nonEmptyString(item);
    if (!isOneOf(stringValue, allowed)) {
      return undefined;
    }
    values.push(stringValue);
  }
  return values;
}

function scoreRecordForPlayers(value: unknown, playerIds: string[]): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const projected: Record<string, number> = {};
  const seen = new Set<string>();
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = nonEmptyString(rawKey);
    if (key === undefined || !playerIds.includes(key)) {
      continue;
    }
    if (seen.has(key) || typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
      return undefined;
    }
    seen.add(key);
    projected[key] = entry;
  }
  for (const key of playerIds) {
    if (!Object.prototype.hasOwnProperty.call(projected, key)) {
      return undefined;
    }
  }
  return projected;
}

function projectIndustryInstance(value: unknown): IndustryInstance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = nonEmptyString(value.id);
  const specId = nonEmptyString(value.specId);
  const ownerPlayerId = nonEmptyString(value.ownerPlayerId);
  const industryType = nonEmptyString(value.industryType);
  const level = integerField(value, 'level');
  const locationId = nonEmptyString(value.locationId);
  const slotId = nonEmptyString(value.slotId);
  const flipped = booleanField(value, 'flipped');
  const remainingResource = nonNegativeIntegerField(value, 'remainingResource');
  const removedFromGame = booleanField(value, 'removedFromGame');
  if (
    id === undefined ||
    specId === undefined ||
    ownerPlayerId === undefined ||
    !isOneOf(industryType, INDUSTRY_TYPES) ||
    level === undefined ||
    locationId === undefined ||
    slotId === undefined ||
    flipped === undefined ||
    remainingResource === undefined ||
    removedFromGame === undefined ||
    !industrySpecMatches(specId, industryType, level) ||
    !industrySlotAllows(locationId, slotId, industryType)
  ) {
    return undefined;
  }
  return {
    id,
    specId,
    ownerPlayerId,
    industryType,
    level,
    locationId,
    slotId,
    flipped,
    remainingResource,
    removedFromGame,
  };
}

function projectLinkInstance(value: unknown): LinkInstance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = nonEmptyString(value.id);
  const ownerPlayerId = nonEmptyString(value.ownerPlayerId);
  const linkType = nonEmptyString(value.linkType);
  const linkLineId = nonEmptyString(value.linkLineId);
  const line = linkLineId === undefined ? undefined : staticConfig.linkLines[linkLineId];
  if (
    id === undefined ||
    ownerPlayerId === undefined ||
    !isOneOf(linkType, LINK_TYPES) ||
    linkLineId === undefined ||
    !line ||
    !line.allowedLinkTypes.includes(linkType)
  ) {
    return undefined;
  }
  return {id, ownerPlayerId, linkType, linkLineId};
}

function projectPlayerOwnedIndustryInstance(value: unknown, playerIds: string[]): IndustryInstance | undefined {
  const instance = projectIndustryInstance(value);
  return instance !== undefined && playerIds.includes(instance.ownerPlayerId) ? instance : undefined;
}

function projectPlayerOwnedLinkInstance(value: unknown, playerIds: string[]): LinkInstance | undefined {
  const instance = projectLinkInstance(value);
  return instance !== undefined && playerIds.includes(instance.ownerPlayerId) ? instance : undefined;
}

function projectIndustryTileStacks(value: unknown): GameState['players'][string]['industryTileStacks'] {
  const source = isRecord(value) ? value : {};
  const projected = {} as GameState['players'][string]['industryTileStacks'];
  for (const industryType of INDUSTRY_TYPES) {
    const stack = isRecord(source[industryType]) ? source[industryType] : {};
    projected[industryType] = {
      availableSpecIdsInOrder: filteredStringArray(
        stack.availableSpecIdsInOrder,
        (specId) => isKnownIndustrySpecIdForType(specId, industryType),
      ),
      removedSpecIds: filteredStringArray(
        stack.removedSpecIds,
        (specId) => isKnownIndustrySpecIdForType(specId, industryType),
      ),
      builtInstanceIds: stringArray(stack.builtInstanceIds) ?? [],
    };
  }
  return projected;
}

function projectRemainingLinks(value: unknown): GameState['players'][string]['remainingLinks'] {
  const source = isRecord(value) ? value : {};
  const projected = {} as GameState['players'][string]['remainingLinks'];
  for (const linkType of LINK_TYPES) {
    projected[linkType] = integerInRange(source[linkType], 0, 0, staticConfig.rules.initialLinksPerType);
  }
  return projected;
}

function projectPlayerState(
  playerId: string,
  value: unknown,
  playerCount: GameState['playerCount'],
): GameState['players'][string] {
  const player = isRecord(value) ? value : {};
  const discardCardIds = knownCardIdsForPlayerCount(player.discardCardIds, playerCount);
  return {
    id: playerId,
    name: publicPlayerName(playerId, player),
    cash: nonNegativeInteger(player.cash, staticConfig.rules.initialCash),
    victoryPoints: nonNegativeInteger(player.victoryPoints, 0),
    incomeTrackPosition: integerInRange(
      player.incomeTrackPosition,
      staticConfig.incomeTrack.startPosition,
      0,
      staticConfig.incomeTrack.positions.length - 1,
    ),
    spentThisRound: nonNegativeInteger(player.spentThisRound, 0),
    handCardIds: knownCardIdsForPlayerCount(player.handCardIds, playerCount),
    discardCardIds,
    faceDownDiscardCount: projectFaceDownDiscardCount(player.faceDownDiscardCount, discardCardIds.length),
    industryTileStacks: projectIndustryTileStacks(player.industryTileStacks),
    remainingLinks: projectRemainingLinks(player.remainingLinks),
  };
}

function projectPlayers(
  value: unknown,
  playerCount: GameState['playerCount'],
  playerIds = projectPlayerIdsForDeclaredCount(value, playerCount),
): GameState['players'] {
  const source = isRecord(value) ? value : {};
  const projected: GameState['players'] = {};
  for (const playerId of playerIds) {
    projected[playerId] = projectPlayerState(playerId, source[playerId], playerCount);
  }
  return projected;
}

function projectOccupancyMap(
  value: unknown,
  allowedOccupiedIds?: ReadonlySet<string>,
  allowedKeys?: ReadonlySet<string>,
): Record<string, {occupiedBy?: string}> {
  const source = isRecord(value) ? value : {};
  const projected: Record<string, {occupiedBy?: string}> = {};
  for (const [id, occupancy] of Object.entries(source)) {
    if (allowedKeys && !allowedKeys.has(id)) {
      continue;
    }
    const occupiedBy = isRecord(occupancy) ? nonEmptyString(occupancy.occupiedBy) : undefined;
    projected[id] = occupiedBy === undefined || (allowedOccupiedIds && !allowedOccupiedIds.has(occupiedBy))
      ? {}
      : {occupiedBy};
  }
  return projected;
}

function projectMerchantSpaces(value: unknown, playerCount: GameState['playerCount']): GameState['board']['merchantSpaces'] {
  const source = isRecord(value) ? value : {};
  const projected: GameState['board']['merchantSpaces'] = {};
  for (const [spaceId, space] of Object.entries(source)) {
    if (!PUBLIC_MERCHANT_SPACE_IDS.has(spaceId) || !isMerchantSpaceActiveForPlayerCount(playerCount, spaceId)) {
      continue;
    }
    const sourceSpace = isRecord(space) ? space : {};
    const merchantTileInstanceId = merchantTileInstanceIdForView(sourceSpace.merchantTileInstanceId);
    projected[spaceId] = {
      id: spaceId,
      ...(merchantTileInstanceId === undefined ? {} : {merchantTileInstanceId}),
      beerPresent: booleanField(sourceSpace, 'beerPresent') ?? false,
    };
  }
  return projected;
}

function projectedOccupancyReferences(value: unknown): Set<string> {
  const source = isRecord(value) ? value : {};
  const references = new Set<string>();
  for (const occupancy of Object.values(source)) {
    const occupiedBy = isRecord(occupancy) ? nonEmptyString(occupancy.occupiedBy) : undefined;
    if (occupiedBy !== undefined) {
      references.add(occupiedBy);
    }
  }
  return references;
}

function projectIndustryInstanceMap(
  value: unknown,
  playerIds: string[],
  slotOccupancyReferences: ReadonlySet<string>,
): GameState['board']['industryInstances'] {
  const source = isRecord(value) ? value : {};
  const projected: GameState['board']['industryInstances'] = {};
  for (const [industryInstanceId, instance] of Object.entries(source)) {
    const projectedInstance = projectPlayerOwnedIndustryInstance(instance, playerIds);
    if (
      projectedInstance &&
      industryInstanceId === projectedInstance.id &&
      isGeneratedInstanceId(projectedInstance.id, 'industry') &&
      (projectedInstance.removedFromGame || slotOccupancyReferences.has(projectedInstance.id))
    ) {
      projected[industryInstanceId] = projectedInstance;
    }
  }
  return projected;
}

function projectLinkInstanceMap(
  value: unknown,
  playerIds: string[],
  linkLineOccupancyReferences: ReadonlySet<string>,
  playerCount: GameState['playerCount'],
): GameState['board']['linkInstances'] {
  const source = isRecord(value) ? value : {};
  const projected: GameState['board']['linkInstances'] = {};
  for (const [linkInstanceId, instance] of Object.entries(source)) {
    const projectedInstance = projectPlayerOwnedLinkInstance(instance, playerIds);
    if (
      projectedInstance &&
      linkInstanceId === projectedInstance.id &&
      isGeneratedInstanceId(projectedInstance.id, 'link') &&
      linkLineOccupancyReferences.has(projectedInstance.id) &&
      isLinkLineActiveForPlayerCount(playerCount, projectedInstance.linkLineId)
    ) {
      projected[linkInstanceId] = projectedInstance;
    }
  }
  return projected;
}

function projectBoardState(value: unknown, playerIds: string[], playerCount: GameState['playerCount']): GameState['board'] {
  const board = isRecord(value) ? value : {};
  const slotOccupancyReferences = projectedOccupancyReferences(board.slots);
  const linkLineOccupancyReferences = projectedOccupancyReferences(board.linkLines);
  const industryInstances = projectIndustryInstanceMap(board.industryInstances, playerIds, slotOccupancyReferences);
  const linkInstances = projectLinkInstanceMap(board.linkInstances, playerIds, linkLineOccupancyReferences, playerCount);
  return {
    industryInstances,
    linkInstances,
    slots: projectOccupancyMap(board.slots, new Set(Object.keys(industryInstances)), PUBLIC_SLOT_IDS),
    linkLines: projectOccupancyMap(board.linkLines, new Set(Object.keys(linkInstances)), PUBLIC_LINK_LINE_IDS),
    merchantSpaces: projectMerchantSpaces(board.merchantSpaces, playerCount),
  };
}

function projectCardZones(value: unknown, playerCount: GameState['playerCount']): GameState['cardZones'] {
  const cardZones = isRecord(value) ? value : {};
  return {
    drawDeck: knownCardIdsForPlayerCount(cardZones.drawDeck, playerCount),
    wildLocationPool: filteredStringArray(cardZones.wildLocationPool, (cardId) => isKnownCardType(cardId, 'wild_location')),
    wildIndustryPool: filteredStringArray(cardZones.wildIndustryPool, (cardId) => isKnownCardType(cardId, 'wild_industry')),
  };
}

function projectMarketState(value: unknown, marketName: 'coal' | 'iron'): GameState['markets']['coal'] {
  const market = isRecord(value) ? value : {};
  return {
    occupiedCount: marketOccupiedCount(market.occupiedCount, marketName),
  };
}

function projectMarkets(value: unknown): GameState['markets'] {
  const markets = isRecord(value) ? value : {};
  return {
    coal: projectMarketState(markets.coal, 'coal'),
    iron: projectMarketState(markets.iron, 'iron'),
  };
}

function uniqueSpecIdsExcluding(specIds: string[], excluded: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const projected: string[] = [];
  for (const specId of specIds) {
    if (excluded.has(specId) || seen.has(specId)) {
      continue;
    }
    seen.add(specId);
    projected.push(specId);
  }
  return projected;
}

function projectBuiltIndustryReferences(players: GameState['players'], board: GameState['board']): void {
  const visibleBuiltIds = new Map<string, Set<string>>();
  const visibleBuiltSpecIds = new Map<string, Set<string>>();
  for (const playerId of Object.keys(players)) {
    for (const industryType of INDUSTRY_TYPES) {
      visibleBuiltIds.set(`${playerId}:${industryType}`, new Set());
      visibleBuiltSpecIds.set(`${playerId}:${industryType}`, new Set());
    }
  }

  for (const industry of Object.values(board.industryInstances).sort((a, b) => a.id.localeCompare(b.id))) {
    if (industry.removedFromGame || !players[industry.ownerPlayerId]) {
      continue;
    }
    const key = `${industry.ownerPlayerId}:${industry.industryType}`;
    visibleBuiltIds.get(key)?.add(industry.id);
    visibleBuiltSpecIds.get(key)?.add(industry.specId);
  }

  for (const [playerId, player] of Object.entries(players)) {
    for (const industryType of INDUSTRY_TYPES) {
      const stack = player.industryTileStacks[industryType];
      const key = `${playerId}:${industryType}`;
      const visibleIds = visibleBuiltIds.get(key) ?? new Set<string>();
      const visibleSpecIds = visibleBuiltSpecIds.get(key) ?? new Set<string>();
      const projectedIds: string[] = [];
      for (const industryInstanceId of stack.builtInstanceIds) {
        if (!visibleIds.has(industryInstanceId) || projectedIds.includes(industryInstanceId)) {
          continue;
        }
        projectedIds.push(industryInstanceId);
      }
      for (const industryInstanceId of visibleIds) {
        if (!projectedIds.includes(industryInstanceId)) {
          projectedIds.push(industryInstanceId);
        }
      }
      stack.builtInstanceIds = projectedIds;
      stack.removedSpecIds = uniqueSpecIdsExcluding(stack.removedSpecIds, visibleSpecIds);
      stack.availableSpecIdsInOrder = uniqueSpecIdsExcluding(
        stack.availableSpecIdsInOrder,
        new Set([...visibleSpecIds, ...stack.removedSpecIds]),
      );
    }
  }
}

function projectCurrentEraRemainingLinks(
  players: GameState['players'],
  board: GameState['board'],
  era: GameState['era'],
  status: GameState['status'],
): void {
  if (status !== 'playing') {
    return;
  }

  const builtByPlayer = new Map(Object.keys(players).map((playerId) => [playerId, 0]));
  for (const link of Object.values(board.linkInstances)) {
    if (link.linkType !== era || !builtByPlayer.has(link.ownerPlayerId)) {
      continue;
    }
    builtByPlayer.set(link.ownerPlayerId, (builtByPlayer.get(link.ownerPlayerId) ?? 0) + 1);
  }

  for (const [playerId, player] of Object.entries(players)) {
    player.remainingLinks[era] = Math.max(0, staticConfig.rules.initialLinksPerType - (builtByPlayer.get(playerId) ?? 0));
  }
}

function merchantSpaceHasDevelopBonus(merchantSpaceId: string): boolean {
  return Object.values(staticConfig.locations).some((location) =>
    location.kind === 'merchant' &&
    location.bonus.type === 'develop' &&
    location.spaces.some((space) => space.id === merchantSpaceId),
  );
}

function merchantBonusForSpace(merchantSpaceId: string): MerchantBonus | undefined {
  const merchant = Object.values(staticConfig.locations).find((location) =>
    location.kind === 'merchant' && location.spaces.some((space) => space.id === merchantSpaceId),
  );
  return merchant?.kind === 'merchant' ? merchant.bonus : undefined;
}

function merchantDevelopBonusCount(merchantSpaceId: string): number {
  const bonus = merchantBonusForSpace(merchantSpaceId);
  return bonus?.type === 'develop' ? bonus.count : 0;
}

function merchantDevelopBonusCapacity(merchantSpaceIds: readonly string[]): number {
  return merchantSpaceIds.reduce((sum, merchantSpaceId) => sum + merchantDevelopBonusCount(merchantSpaceId), 0);
}

function merchantBonusesMatch(actual: MerchantBonus, expected: MerchantBonus): boolean {
  switch (expected.type) {
    case 'develop':
      return actual.type === 'develop' && actual.count === expected.count;
    case 'income_spaces':
      return actual.type === 'income_spaces' && actual.spaces === expected.spaces;
    case 'victory_points':
      return actual.type === 'victory_points' && actual.points === expected.points;
    case 'cash':
      return actual.type === 'cash' && actual.cash === expected.cash;
  }
}

function merchantBonusMatchesSpace(merchantSpaceId: string, bonus: MerchantBonus): boolean {
  const expected = merchantBonusForSpace(merchantSpaceId);
  return expected !== undefined && merchantBonusesMatch(bonus, expected);
}

function projectPendingDecision(
  value: unknown,
  game: GameState,
  playerIds = Object.keys(game.players),
  turnOrder = game.turnOrder,
  board = game.board,
): GameState['pendingDecision'] {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value.type) {
    case 'negative_income': {
      const playerId = nonEmptyString(value.playerId);
      const amountOwed = positiveIntegerField(value, 'amountOwed');
      const incomePlayerIndex = nonNegativeIntegerField(value, 'incomePlayerIndex');
      return playerId === undefined ||
        !playerIds.includes(playerId) ||
        amountOwed === undefined ||
        incomePlayerIndex === undefined ||
        incomePlayerIndex >= turnOrder.length ||
        turnOrder[incomePlayerIndex] !== playerId
        ? undefined
        : {type: 'negative_income', playerId, amountOwed, incomePlayerIndex};
    }
    case 'merchant_develop': {
      const playerId = nonEmptyString(value.playerId);
      const merchantSpaceId = nonEmptyString(value.merchantSpaceId);
      const count = positiveIntegerField(value, 'count');
      if (
        playerId === undefined ||
        !playerIds.includes(playerId) ||
        merchantSpaceId === undefined ||
        !board.merchantSpaces[merchantSpaceId] ||
        !merchantSpaceHasDevelopBonus(merchantSpaceId) ||
        count === undefined
      ) {
        return undefined;
      }
      const merchantSpaceIds = value.merchantSpaceIds === undefined
        ? undefined
        : stringArray(value.merchantSpaceIds)
          ?.map((candidate) => candidate.trim())
          .filter((candidate) => Boolean(board.merchantSpaces[candidate]) && merchantSpaceHasDevelopBonus(candidate));
      const safeMerchantSpaceIds = merchantSpaceIds === undefined
        ? undefined
        : [...new Set([merchantSpaceId, ...merchantSpaceIds])];
      const projectedMerchantSpaceIds = safeMerchantSpaceIds ?? [merchantSpaceId];
      return {
        type: 'merchant_develop',
        playerId,
        count: Math.min(count, merchantDevelopBonusCapacity(projectedMerchantSpaceIds)),
        merchantSpaceId,
        ...(safeMerchantSpaceIds === undefined ? {} : {merchantSpaceIds: safeMerchantSpaceIds}),
      };
    }
    default:
      return undefined;
  }
}

function projectMerchantBonus(value: unknown): MerchantBonus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (nonEmptyString(value.type)) {
    case 'develop':
      return value.count === 1 ? {type: 'develop', count: 1} : undefined;
    case 'income_spaces': {
      const spaces = positiveIntegerField(value, 'spaces');
      return spaces === undefined ? undefined : {type: 'income_spaces', spaces};
    }
    case 'victory_points': {
      const points = positiveIntegerField(value, 'points');
      return points === undefined ? undefined : {type: 'victory_points', points};
    }
    case 'cash': {
      const cash = positiveIntegerField(value, 'cash');
      return cash === undefined ? undefined : {type: 'cash', cash};
    }
    default:
      return undefined;
  }
}

function resourceTypeMatchesIndustry(resourceType: 'coal' | 'iron' | 'beer', industry: IndustryInstance): boolean {
  return (
    (resourceType === 'coal' && industry.industryType === 'coal_mine') ||
    (resourceType === 'iron' && industry.industryType === 'iron_works') ||
    (resourceType === 'beer' && industry.industryType === 'brewery')
  );
}

function marketPriceForView(
  market: 'coal' | 'iron',
  price: unknown,
  options: {allowFallback?: boolean} = {},
): number | undefined {
  const projectedPrice = typeof price === 'number' && Number.isInteger(price) ? price : undefined;
  if (projectedPrice === undefined) {
    return undefined;
  }
  const config = staticConfig.markets[market];
  if (config.priceSlotsCheapestToMostExpensive.includes(projectedPrice)) {
    return projectedPrice;
  }
  return options.allowFallback && projectedPrice === config.fallbackPriceWhenEmpty
    ? projectedPrice
    : undefined;
}

function projectResourceSource(value: unknown, board: GameState['board']): ResourceSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (nonEmptyString(value.kind)) {
    case 'industry_tile': {
      const industryInstanceId = nonEmptyString(value.industryInstanceId);
      const resourceType = nonEmptyString(value.resourceType);
      const industry = industryInstanceId === undefined ? undefined : board.industryInstances[industryInstanceId];
      if (
        industryInstanceId === undefined ||
        !isOneOf(resourceType, RESOURCE_TYPES) ||
        !industry ||
        !resourceTypeMatchesIndustry(resourceType, industry)
      ) {
        return undefined;
      }
      return {kind: 'industry_tile', industryInstanceId, resourceType};
    }
    case 'market': {
      const market = nonEmptyString(value.market);
      if (!isOneOf(market, MARKETS)) {
        return undefined;
      }
      const price = marketPriceForView(market, value.price, {allowFallback: true});
      if (price === undefined) {
        return undefined;
      }
      return {kind: 'market', market, price};
    }
    case 'merchant_beer': {
      const merchantSpaceId = nonEmptyString(value.merchantSpaceId);
      const merchantTileInstanceId = nonEmptyString(value.merchantTileInstanceId);
      const merchantSpace = merchantSpaceId === undefined ? undefined : board.merchantSpaces[merchantSpaceId];
      if (
        merchantSpaceId === undefined ||
        merchantTileInstanceId === undefined ||
        !merchantSpace ||
        merchantSpace.merchantTileInstanceId !== merchantTileInstanceId ||
        !merchantSpaceHasNonBlankTile(board, merchantSpaceId, merchantTileInstanceId)
      ) {
        return undefined;
      }
      return {kind: 'merchant_beer', merchantSpaceId, merchantTileInstanceId};
    }
    default:
      return undefined;
  }
}

function projectResourceConsumedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedResourceConsumedEvent | undefined {
  const source = projectResourceSource(event.source, board);
  const byPlayerId = playerIdField(event, 'byPlayerId', playerIds);
  const reason = publicEventReason(event.reason);
  return source === undefined ||
    byPlayerId === undefined ||
    reason === undefined ||
    !resourceConsumptionReasonMatchesSource(source, reason)
    ? undefined
    : {type: 'resource_consumed', source, byPlayerId, reason};
}

function industryResourceConsumptionLimit(board: GameState['board'], industryInstanceId: string): number {
  const industry = board.industryInstances[industryInstanceId];
  const resourcesWhenBuilt = industry === undefined
    ? undefined
    : staticConfig.industryTileSpecs[industry.specId]?.resourcesWhenBuilt;
  return resourcesWhenBuilt === undefined ? 0 : Math.max(0, ...Object.values(resourcesWhenBuilt));
}

function isValidCanalEraEndEventForClaims(event: Record<string, unknown>, playerIds: string[]): boolean {
  const era = nonEmptyString(event.era);
  const score = projectEraScoreBreakdown(event.score, playerIds);
  return era === 'canal' && score?.era === 'canal';
}

function historicalResourceConsumptionClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const industryResourceCounts = new Map<string, number>();
  const merchantBeerCounts = new Map<string, number>();

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (
      event.type === 'era_ended' &&
      historicalEraEndedClaims.get(event) === true &&
      isValidCanalEraEndEventForClaims(event, playerIds)
    ) {
      merchantBeerCounts.clear();
      continue;
    }

    if (event.type !== 'resource_consumed') {
      continue;
    }

    const consumedEvent = projectResourceConsumedEvent(event, board, playerIds);
    if (consumedEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    if (consumedEvent.source.kind === 'market') {
      claims.set(event, true);
      continue;
    }

    const counts = consumedEvent.source.kind === 'industry_tile' ? industryResourceCounts : merchantBeerCounts;
    const key = consumedEvent.source.kind === 'industry_tile'
      ? consumedEvent.source.industryInstanceId
      : `${consumedEvent.source.merchantSpaceId}:${consumedEvent.source.merchantTileInstanceId}`;
    const limit = consumedEvent.source.kind === 'industry_tile'
      ? industryResourceConsumptionLimit(board, consumedEvent.source.industryInstanceId)
      : 1;
    const usedCount = counts.get(key) ?? 0;
    if (usedCount >= limit) {
      claims.set(event, false);
      continue;
    }

    counts.set(key, usedCount + 1);
    claims.set(event, true);
  }

  return claims;
}

function knownMerchantSpaceId(board: GameState['board'], merchantSpaceId: string | undefined): merchantSpaceId is string {
  return merchantSpaceId !== undefined && Boolean(board.merchantSpaces[merchantSpaceId]);
}

function merchantSpaceAcceptsIndustry(
  board: GameState['board'],
  merchantSpaceId: string,
  industryType: IndustryType,
): boolean {
  const merchantTileInstanceId = board.merchantSpaces[merchantSpaceId]?.merchantTileInstanceId;
  const specId = typeof merchantTileInstanceId === 'string'
    ? merchantTileInstanceId.trim().replace(/-\d+$/, '')
    : undefined;
  const spec = specId === undefined ? undefined : staticConfig.merchantTileSpecs[specId];
  return Boolean(spec && !spec.blank && spec.acceptedIndustryTypes.includes(industryType));
}

function merchantSpaceHasNonBlankTile(
  board: GameState['board'],
  merchantSpaceId: string,
  merchantTileInstanceId: string,
): boolean {
  const specId = merchantTileInstanceId.trim().replace(/-\d+$/, '');
  const spec = staticConfig.merchantTileSpecs[specId];
  return Boolean(
    spec &&
    !spec.blank &&
    board.merchantSpaces[merchantSpaceId]?.merchantTileInstanceId === merchantTileInstanceId,
  );
}

function industryScoreMatchesRules(
  board: GameState['board'],
  historicalIndustryScore: HistoricalIndustryScoreEntry | undefined,
  industryInstanceId: string | undefined,
  points: number | undefined,
): boolean {
  if (historicalIndustryScore !== undefined) {
    return historicalIndustryScore !== null && historicalIndustryScore === points;
  }
  const industry = industryInstanceId === undefined ? undefined : board.industryInstances[industryInstanceId];
  const expectedPoints = industry === undefined
    ? undefined
    : staticConfig.industryTileSpecs[industry.specId]?.flip.victoryPoints;
  return expectedPoints !== undefined &&
    expectedPoints === points &&
    (industry?.removedFromGame === true || industry?.flipped === true);
}

function industryIsFlipped(board: GameState['board'], industryInstanceId: string | undefined): boolean {
  return industryInstanceId !== undefined && board.industryInstances[industryInstanceId]?.flipped === true;
}

function industryIsRemoved(board: GameState['board'], industryInstanceId: string | undefined): boolean {
  return industryInstanceId !== undefined && board.industryInstances[industryInstanceId]?.removedFromGame === true;
}

function projectIndustryBuiltEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedIndustryBuiltEvent | undefined {
  const instance = projectPlayerOwnedIndustryInstance(event.instance, playerIds);
  const boardInstance = instance === undefined ? undefined : board.industryInstances[instance.id];
  return instance === undefined ||
    !isGeneratedInstanceId(instance.id, 'industry') ||
    (
      boardInstance !== undefined &&
      (
        boardInstance.specId !== instance.specId ||
        boardInstance.ownerPlayerId !== instance.ownerPlayerId ||
        boardInstance.industryType !== instance.industryType ||
        boardInstance.level !== instance.level ||
        boardInstance.locationId !== instance.locationId ||
        boardInstance.slotId !== instance.slotId
      )
    )
    ? undefined
    : {type: 'industry_built', instance};
}

function historicalIndustryBuildClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const builtIndustryInstanceIds = new Set<string>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'industry_built') {
      continue;
    }

    const builtEvent = projectIndustryBuiltEvent(event, board, playerIds);
    if (builtEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    if (builtIndustryInstanceIds.has(builtEvent.instance.id)) {
      claims.set(event, false);
      continue;
    }

    builtIndustryInstanceIds.add(builtEvent.instance.id);
    claims.set(event, true);
  }

  return claims;
}

function projectIndustryRemovedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
): ProjectedIndustryRemovedEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const reason = nonEmptyString(event.reason);
  return !knownIndustryInstanceId(board, industryInstanceId) ||
    !isOneOf(reason, INDUSTRY_REMOVAL_REASONS) ||
    !industryIsRemoved(board, industryInstanceId)
    ? undefined
    : {type: 'industry_removed', industryInstanceId, reason};
}

function historicalIndustryRemovalClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const removedIndustryInstanceIds = new Set<string>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'industry_removed') {
      continue;
    }

    const removedEvent = projectIndustryRemovedEvent(event, board);
    if (removedEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    if (removedIndustryInstanceIds.has(removedEvent.industryInstanceId)) {
      claims.set(event, false);
      continue;
    }

    removedIndustryInstanceIds.add(removedEvent.industryInstanceId);
    claims.set(event, true);
  }

  return claims;
}

function negativeIncomeLiquidationCashValue(board: GameState['board'], industryInstanceId: string): number | undefined {
  const industry = board.industryInstances[industryInstanceId];
  const cashCost = industry === undefined
    ? undefined
    : staticConfig.industryTileSpecs[industry.specId]?.cost.cash;
  return cashCost === undefined ? undefined : Math.floor(cashCost / 2);
}

function historicalNegativeIncomeLiquidationCashClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingRemoval:
    | {event: Record<string, unknown>; industryInstanceId: string}
    | undefined;
  let pendingInvalidNegativeIncomeRemoval = false;
  const removedIndustryInstanceIds = new Set<string>();

  const clearPendingRemoval = () => {
    pendingRemoval = undefined;
    pendingInvalidNegativeIncomeRemoval = false;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingRemoval();
      continue;
    }

    if (event.type === 'industry_removed') {
      clearPendingRemoval();
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const reason = nonEmptyString(event.reason);
      const industry = industryInstanceId === undefined ? undefined : board.industryInstances[industryInstanceId];
      const isValidRemoval = industryInstanceId !== undefined &&
        isOneOf(reason, INDUSTRY_REMOVAL_REASONS) &&
        industry?.removedFromGame === true &&
        !removedIndustryInstanceIds.has(industryInstanceId);
      if (isValidRemoval) {
        removedIndustryInstanceIds.add(industryInstanceId);
      }
      if (reason === 'negative_income' && isValidRemoval) {
        pendingRemoval = {event, industryInstanceId};
      } else if (reason === 'negative_income') {
        pendingInvalidNegativeIncomeRemoval = true;
      }
      continue;
    }

    if (event.type !== 'cash_changed') {
      clearPendingRemoval();
      continue;
    }

    const cashEvent = projectCashChangedEvent(event, playerIds);
    if (cashEvent === undefined) {
      clearPendingRemoval();
      continue;
    }

    if (pendingRemoval === undefined) {
      if (pendingInvalidNegativeIncomeRemoval && cashEvent.reason === 'negative income liquidation') {
        claims.set(event, false);
      }
      clearPendingRemoval();
      continue;
    }

    if (cashEvent.reason !== 'negative income liquidation') {
      clearPendingRemoval();
      continue;
    }

    const industry = board.industryInstances[pendingRemoval.industryInstanceId];
    const expectedCash = negativeIncomeLiquidationCashValue(board, pendingRemoval.industryInstanceId);
    if (
      industry === undefined ||
      expectedCash === undefined ||
      cashEvent.playerId !== industry.ownerPlayerId ||
      cashEvent.delta !== expectedCash
    ) {
      claims.set(event, false);
      clearPendingRemoval();
      continue;
    }

    claims.set(event, true);
    clearPendingRemoval();
  }

  return claims;
}

function projectIndustryFlippedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedIndustryFlippedEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  return ownerPlayerId === undefined ||
    !knownIndustryInstanceId(board, industryInstanceId, ownerPlayerId) ||
    !industryIsFlipped(board, industryInstanceId)
    ? undefined
    : {type: 'industry_flipped', industryInstanceId, ownerPlayerId};
}

function historicalIndustryFlipClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const flippedIndustryInstanceIds = new Set<string>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'industry_flipped') {
      continue;
    }

    const flippedEvent = projectIndustryFlippedEvent(event, board, playerIds);
    if (flippedEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    if (flippedIndustryInstanceIds.has(flippedEvent.industryInstanceId)) {
      claims.set(event, false);
      continue;
    }

    flippedIndustryInstanceIds.add(flippedEvent.industryInstanceId);
    claims.set(event, true);
  }

  return claims;
}

interface ProjectedIndustryFlipIncomeChange {
  change: ProjectedIncomePositionChangedEvent;
  industryType: IndustryType;
  reasonKind: 'flipped' | 'sold';
}

function industryFlipIncomeReason(
  reason: string,
): Pick<ProjectedIndustryFlipIncomeChange, 'industryType' | 'reasonKind'> | undefined {
  for (const industryType of INDUSTRY_TYPES) {
    if (reason === `flipped ${industryType}`) {
      return {industryType, reasonKind: 'flipped'};
    }
    if (reason === `sold ${industryType}`) {
      return {industryType, reasonKind: 'sold'};
    }
  }
  return undefined;
}

function projectIndustryFlipIncomeChange(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedIndustryFlipIncomeChange | undefined {
  if (event.type !== 'income_position_changed') {
    return undefined;
  }
  const change = projectIncomePositionChangedEvent(event, playerIds);
  const reason = change === undefined ? undefined : industryFlipIncomeReason(change.reason);
  return change === undefined || reason === undefined
    ? undefined
    : {change, ...reason};
}

function industryFlipIncomeChangeMatchesFlip(
  incomeChange: ProjectedIndustryFlipIncomeChange,
  flippedEvent: ProjectedIndustryFlippedEvent,
  board: GameState['board'],
): boolean {
  const industry = board.industryInstances[flippedEvent.industryInstanceId];
  const spec = industry === undefined ? undefined : staticConfig.industryTileSpecs[industry.specId];
  const expectedTo = spec === undefined
    ? undefined
    : advanceIncomeSpaces(incomeChange.change.from, spec.flip.incomeSpaces);
  return industry !== undefined &&
    expectedTo !== undefined &&
    incomeChange.change.playerId === flippedEvent.ownerPlayerId &&
    industry.industryType === incomeChange.industryType &&
    incomeChange.change.to === expectedTo;
}

function historicalIndustryFlipIncomeChangeClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalIndustryFlipClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingIncomeChange:
    | {event: Record<string, unknown>; incomeChange: ProjectedIndustryFlipIncomeChange}
    | undefined;

  const clearPendingIncomeChange = () => {
    pendingIncomeChange = undefined;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingIncomeChange();
      continue;
    }

    const incomeChange = projectIndustryFlipIncomeChange(event, playerIds);
    if (incomeChange !== undefined) {
      pendingIncomeChange = {event, incomeChange};
      continue;
    }

    if (event.type !== 'industry_flipped') {
      clearPendingIncomeChange();
      continue;
    }

    if (pendingIncomeChange === undefined) {
      continue;
    }

    const flippedEvent = projectIndustryFlippedEvent(event, board, playerIds);
    if (flippedEvent === undefined || historicalIndustryFlipClaims.get(event) === false) {
      clearPendingIncomeChange();
      continue;
    }

    if (!industryFlipIncomeChangeMatchesFlip(pendingIncomeChange.incomeChange, flippedEvent, board)) {
      claims.set(pendingIncomeChange.event, false);
      clearPendingIncomeChange();
      continue;
    }

    claims.set(pendingIncomeChange.event, true);
    clearPendingIncomeChange();
  }

  return claims;
}

function projectIndustrySoldEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedIndustrySoldEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  const merchantSpaceId = nonEmptyString(event.merchantSpaceId);
  const industry = industryInstanceId === undefined ? undefined : board.industryInstances[industryInstanceId];
  return ownerPlayerId === undefined ||
    industry === undefined ||
    !knownIndustryInstanceId(board, industryInstanceId, ownerPlayerId) ||
    !knownMerchantSpaceId(board, merchantSpaceId) ||
    !industryIsFlipped(board, industryInstanceId) ||
    !merchantSpaceAcceptsIndustry(board, merchantSpaceId, industry.industryType)
    ? undefined
    : {type: 'industry_sold', industryInstanceId, ownerPlayerId, merchantSpaceId};
}

function historicalIndustrySaleClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalIndustryFlipClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const soldIndustryInstanceIds = new Set<string>();
  let pendingFlip: ProjectedIndustryFlippedEvent | undefined;

  const clearPendingFlip = () => {
    pendingFlip = undefined;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingFlip();
      continue;
    }

    if (event.type === 'industry_flipped') {
      const flippedEvent = projectIndustryFlippedEvent(event, board, playerIds);
      pendingFlip = flippedEvent !== undefined && historicalIndustryFlipClaims.get(event) !== false
        ? flippedEvent
        : undefined;
      continue;
    }

    if (event.type !== 'industry_sold') {
      clearPendingFlip();
      continue;
    }

    const soldEvent = projectIndustrySoldEvent(event, board, playerIds);
    if (soldEvent === undefined) {
      claims.set(event, false);
      clearPendingFlip();
      continue;
    }

    if (soldIndustryInstanceIds.has(soldEvent.industryInstanceId)) {
      claims.set(event, false);
      clearPendingFlip();
      continue;
    }

    if (
      pendingFlip !== undefined &&
      (
        pendingFlip.industryInstanceId !== soldEvent.industryInstanceId ||
        pendingFlip.ownerPlayerId !== soldEvent.ownerPlayerId
      )
    ) {
      claims.set(event, false);
      clearPendingFlip();
      continue;
    }

    soldIndustryInstanceIds.add(soldEvent.industryInstanceId);
    claims.set(event, true);
    clearPendingFlip();
  }

  return claims;
}

function projectResourceSoldToMarketEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
): ProjectedResourceSoldToMarketEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const market = nonEmptyString(event.market);
  if (industryInstanceId === undefined || !isOneOf(market, MARKETS)) {
    return undefined;
  }
  const industry = board.industryInstances[industryInstanceId];
  const cashReceived = marketPriceForView(market, event.cashReceived);
  return !industry || !resourceTypeMatchesIndustry(market, industry) || cashReceived === undefined
    ? undefined
    : {type: 'resource_sold_to_market', industryInstanceId, market, cashReceived};
}

function resourceSoldToMarketLimit(board: GameState['board'], industryInstanceId: string): number {
  const industry = board.industryInstances[industryInstanceId];
  const resourcesWhenBuilt = industry === undefined
    ? undefined
    : staticConfig.industryTileSpecs[industry.specId]?.resourcesWhenBuilt;
  return resourcesWhenBuilt === undefined ? 0 : Math.max(0, ...Object.values(resourcesWhenBuilt));
}

function historicalResourceSoldToMarketClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const soldResourceCounts = new Map<string, number>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'resource_sold_to_market') {
      continue;
    }

    const soldEvent = projectResourceSoldToMarketEvent(event, board);
    if (soldEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    const soldCount = soldResourceCounts.get(soldEvent.industryInstanceId) ?? 0;
    if (soldCount >= resourceSoldToMarketLimit(board, soldEvent.industryInstanceId)) {
      claims.set(event, false);
      continue;
    }

    soldResourceCounts.set(soldEvent.industryInstanceId, soldCount + 1);
    claims.set(event, true);
  }

  return claims;
}

function isMarketSaleCashReason(reason: string): reason is 'sold coal to market' | 'sold iron to market' {
  return reason === 'sold coal to market' || reason === 'sold iron to market';
}

function historicalMarketSaleCashClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalResourceSoldToMarketClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingMarketSale:
    | {sale: ProjectedResourceSoldToMarketEvent; ownerPlayerId: string}
    | undefined;
  let pendingInvalidMarketSale = false;

  const clearPendingMarketSale = () => {
    pendingMarketSale = undefined;
    pendingInvalidMarketSale = false;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingMarketSale();
      continue;
    }

    if (event.type === 'resource_sold_to_market') {
      clearPendingMarketSale();
      const soldEvent = projectResourceSoldToMarketEvent(event, board);
      const ownerPlayerId = soldEvent === undefined
        ? undefined
        : board.industryInstances[soldEvent.industryInstanceId]?.ownerPlayerId;
      if (
        soldEvent !== undefined &&
        historicalResourceSoldToMarketClaims.get(event) !== false &&
        ownerPlayerId !== undefined &&
        playerIds.includes(ownerPlayerId)
      ) {
        pendingMarketSale = {sale: soldEvent, ownerPlayerId};
      } else {
        pendingInvalidMarketSale = true;
      }
      continue;
    }

    if (event.type !== 'cash_changed') {
      clearPendingMarketSale();
      continue;
    }

    const cashEvent = projectCashChangedEvent(event, playerIds);
    if (cashEvent === undefined) {
      clearPendingMarketSale();
      continue;
    }

    if (pendingMarketSale === undefined) {
      if (pendingInvalidMarketSale && isMarketSaleCashReason(cashEvent.reason)) {
        claims.set(event, false);
      }
      clearPendingMarketSale();
      continue;
    }

    const expectedReason = `sold ${pendingMarketSale.sale.market} to market`;
    if (!isMarketSaleCashReason(cashEvent.reason)) {
      clearPendingMarketSale();
      continue;
    }

    if (
      cashEvent.reason !== expectedReason ||
      cashEvent.playerId !== pendingMarketSale.ownerPlayerId ||
      cashEvent.delta !== pendingMarketSale.sale.cashReceived
    ) {
      claims.set(event, false);
      clearPendingMarketSale();
      continue;
    }

    claims.set(event, true);
    clearPendingMarketSale();
  }

  return claims;
}

type ActionSpendReason = 'build' | 'network' | 'develop iron';

interface PendingBuildSpendCash {
  event: Record<string, unknown>;
  cash: ProjectedCashChangedEvent;
  marketCost: number;
}

interface PendingBuildResourceSpend {
  playerId: string;
  marketCost: number;
}

interface PendingNetworkSpendEvidence {
  playerId: string;
  marketCost: number;
  linkCount: number;
  linkType?: LinkType;
}

interface PendingDevelopSpendEvidence {
  playerId: string;
  marketCost: number;
}

function isActionSpendReason(reason: string): reason is ActionSpendReason {
  return reason === 'build' || reason === 'network' || reason === 'develop iron';
}

function resourceMarketCostForActionSpend(event: ProjectedResourceConsumedEvent): number {
  return event.source.kind === 'market' ? event.source.price : 0;
}

function networkBaseSpend(linkCount: number, linkType: LinkType | undefined): number | undefined {
  if (linkType === 'canal' && linkCount === 1) {
    return staticConfig.rules.canalLinkCost;
  }
  if (linkType === 'rail' && linkCount === 1) {
    return staticConfig.rules.railSingleLinkCost;
  }
  if (linkType === 'rail' && linkCount === 2) {
    return staticConfig.rules.railDoubleLinkCost;
  }
  return undefined;
}

function historicalActionSpendCashClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalResourceConsumptionClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryBuildClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLinkBuildClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingBuildResources: PendingBuildResourceSpend | undefined;
  let pendingBuildCash: PendingBuildSpendCash | undefined;
  let pendingNetworkEvidence: PendingNetworkSpendEvidence | undefined;
  let pendingDevelopEvidence: PendingDevelopSpendEvidence | undefined;

  const clearActionEvidence = () => {
    pendingBuildResources = undefined;
    pendingNetworkEvidence = undefined;
    pendingDevelopEvidence = undefined;
  };

  const rejectPendingBuildCash = () => {
    if (pendingBuildCash !== undefined) {
      claims.set(pendingBuildCash.event, false);
      pendingBuildCash = undefined;
    }
  };

  const appendResourceCost = (event: ProjectedResourceConsumedEvent) => {
    const marketCost = resourceMarketCostForActionSpend(event);
    if (event.reason === 'build') {
      pendingNetworkEvidence = undefined;
      pendingDevelopEvidence = undefined;
      pendingBuildResources = pendingBuildResources?.playerId === event.byPlayerId
        ? {playerId: event.byPlayerId, marketCost: pendingBuildResources.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost};
      return;
    }
    if (event.reason === 'network') {
      pendingBuildResources = undefined;
      pendingDevelopEvidence = undefined;
      pendingNetworkEvidence = pendingNetworkEvidence?.playerId === event.byPlayerId
        ? {...pendingNetworkEvidence, marketCost: pendingNetworkEvidence.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost, linkCount: 0};
      return;
    }
    if (event.reason === 'develop' || event.reason === 'develop iron') {
      pendingBuildResources = undefined;
      pendingNetworkEvidence = undefined;
      pendingDevelopEvidence = pendingDevelopEvidence?.playerId === event.byPlayerId
        ? {playerId: event.byPlayerId, marketCost: pendingDevelopEvidence.marketCost + marketCost}
        : {playerId: event.byPlayerId, marketCost};
      return;
    }
    clearActionEvidence();
  };

  for (const event of events) {
    if (!isRecord(event)) {
      rejectPendingBuildCash();
      clearActionEvidence();
      continue;
    }

    if (event.type === 'resource_consumed') {
      rejectPendingBuildCash();
      const consumedEvent = projectResourceConsumedEvent(event, board, playerIds);
      if (consumedEvent === undefined || historicalResourceConsumptionClaims.get(event) === false) {
        clearActionEvidence();
        continue;
      }
      appendResourceCost(consumedEvent);
      continue;
    }

    if (event.type === 'link_built') {
      rejectPendingBuildCash();
      const builtEvent = projectLinkBuiltEvent(event, board, playerIds, playerCount);
      if (builtEvent === undefined || historicalLinkBuildClaims.get(event) === false) {
        clearActionEvidence();
        continue;
      }
      pendingBuildResources = undefined;
      pendingDevelopEvidence = undefined;
      pendingNetworkEvidence = pendingNetworkEvidence?.playerId === builtEvent.instance.ownerPlayerId
        ? {
          playerId: builtEvent.instance.ownerPlayerId,
          marketCost: pendingNetworkEvidence.marketCost,
          linkCount: pendingNetworkEvidence.linkCount + 1,
          linkType: pendingNetworkEvidence.linkType ?? builtEvent.instance.linkType,
        }
        : {
          playerId: builtEvent.instance.ownerPlayerId,
          marketCost: 0,
          linkCount: 1,
          linkType: builtEvent.instance.linkType,
        };
      if (pendingNetworkEvidence.linkType !== builtEvent.instance.linkType) {
        pendingNetworkEvidence = undefined;
      }
      continue;
    }

    if (event.type === 'cash_changed') {
      rejectPendingBuildCash();
      const cashEvent = projectCashChangedEvent(event, playerIds);
      if (cashEvent === undefined) {
        clearActionEvidence();
        continue;
      }
      if (cashEvent.reason === 'build') {
        pendingBuildCash = {
          event,
          cash: cashEvent,
          marketCost: pendingBuildResources?.playerId === cashEvent.playerId
            ? pendingBuildResources.marketCost
            : 0,
        };
        clearActionEvidence();
        continue;
      }
      if (cashEvent.reason === 'network') {
        const baseSpend = pendingNetworkEvidence?.playerId === cashEvent.playerId
          ? networkBaseSpend(pendingNetworkEvidence.linkCount, pendingNetworkEvidence.linkType)
          : undefined;
        claims.set(
          event,
          baseSpend !== undefined &&
            cashEvent.delta === -(baseSpend + (pendingNetworkEvidence?.marketCost ?? 0)),
        );
        clearActionEvidence();
        continue;
      }
      if (cashEvent.reason === 'develop iron') {
        const marketCost = pendingDevelopEvidence?.playerId === cashEvent.playerId
          ? pendingDevelopEvidence.marketCost
          : undefined;
        claims.set(event, marketCost !== undefined && marketCost > 0 && cashEvent.delta === -marketCost);
        clearActionEvidence();
        continue;
      }
      clearActionEvidence();
      continue;
    }

    if (event.type === 'industry_removed') {
      const removedEvent = projectIndustryRemovedEvent(event, board);
      if (pendingBuildCash !== undefined && removedEvent?.reason === 'overbuild') {
        clearActionEvidence();
        continue;
      }
      rejectPendingBuildCash();
      clearActionEvidence();
      continue;
    }

    if (event.type === 'industry_built') {
      if (pendingBuildCash === undefined) {
        clearActionEvidence();
        continue;
      }
      const builtEvent = projectIndustryBuiltEvent(event, board, playerIds);
      const spec = builtEvent === undefined
        ? undefined
        : staticConfig.industryTileSpecs[builtEvent.instance.specId];
      claims.set(
        pendingBuildCash.event,
        builtEvent !== undefined &&
          spec !== undefined &&
          historicalIndustryBuildClaims.get(event) !== false &&
          builtEvent.instance.ownerPlayerId === pendingBuildCash.cash.playerId &&
          pendingBuildCash.cash.delta === -(spec.cost.cash + pendingBuildCash.marketCost),
      );
      pendingBuildCash = undefined;
      clearActionEvidence();
      continue;
    }

    rejectPendingBuildCash();
    clearActionEvidence();
  }

  rejectPendingBuildCash();
  return claims;
}

function projectLinkBuiltEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
  playerCount: GameState['playerCount'],
): ProjectedLinkBuiltEvent | undefined {
  const instance = projectPlayerOwnedLinkInstance(event.instance, playerIds);
  const boardInstance = instance === undefined ? undefined : board.linkInstances[instance.id];
  return instance === undefined ||
    !isGeneratedInstanceId(instance.id, 'link') ||
    !isLinkLineActiveForPlayerCount(playerCount, instance.linkLineId) ||
    (
      boardInstance !== undefined &&
      (
        boardInstance.ownerPlayerId !== instance.ownerPlayerId ||
        boardInstance.linkType !== instance.linkType ||
        boardInstance.linkLineId !== instance.linkLineId
      )
    )
    ? undefined
    : {type: 'link_built', instance};
}

function historicalLinkBuildClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const builtLinkInstanceIds = new Set<string>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== 'link_built') {
      continue;
    }

    const builtEvent = projectLinkBuiltEvent(event, board, playerIds, playerCount);
    if (builtEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    if (builtLinkInstanceIds.has(builtEvent.instance.id)) {
      claims.set(event, false);
      continue;
    }

    builtLinkInstanceIds.add(builtEvent.instance.id);
    claims.set(event, true);
  }

  return claims;
}

function projectNegativeIncomeStartedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
  turnOrder: string[],
): ProjectedNegativeIncomeStartedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const amountOwed = positiveIntegerField(event, 'amountOwed');
  const incomePlayerIndex = nonNegativeIntegerField(event, 'incomePlayerIndex');
  return playerId === undefined ||
    amountOwed === undefined ||
    incomePlayerIndex === undefined ||
    incomePlayerIndex >= turnOrder.length ||
    turnOrder[incomePlayerIndex] !== playerId
    ? undefined
    : {type: 'negative_income_started', playerId, amountOwed, incomePlayerIndex};
}

function projectNegativeIncomeResolvedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedNegativeIncomeResolvedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const amountOwed = positiveIntegerField(event, 'amountOwed');
  const paid = nonNegativeIntegerField(event, 'paid');
  const victoryPointLoss = nonNegativeIntegerField(event, 'victoryPointLoss');
  const industryInstanceIds = trimmedStringArray(event.industryInstanceIds);
  return (
    playerId === undefined ||
    amountOwed === undefined ||
    paid === undefined ||
    victoryPointLoss === undefined ||
    !knownIndustryInstanceIds(board, industryInstanceIds, playerId) ||
    !negativeIncomeResolutionMatchesRules(board, industryInstanceIds, amountOwed, paid, victoryPointLoss)
  )
    ? undefined
    : {type: 'negative_income_resolved', playerId, amountOwed, paid, victoryPointLoss, industryInstanceIds};
}

function isNegativeIncomePendingEvidenceEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  pending: ProjectedNegativeIncomeStartedEvent,
): boolean {
  if (event.type === 'industry_removed') {
    const removedEvent = projectIndustryRemovedEvent(event, board);
    return removedEvent?.reason === 'negative_income' &&
      knownIndustryInstanceId(board, removedEvent.industryInstanceId, pending.playerId);
  }

  if (event.type === 'cash_changed') {
    const playerId = playerIdField(event, 'playerId', [pending.playerId]);
    const reason = publicEventReason(event.reason);
    return playerId === pending.playerId &&
      (reason === 'negative income liquidation' || reason === 'income');
  }

  if (event.type === 'victory_points_changed') {
    const playerId = playerIdField(event, 'playerId', [pending.playerId]);
    return playerId === pending.playerId && publicEventReason(event.reason) === 'negative income shortfall';
  }

  return false;
}

function historicalNegativeIncomeClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
  turnOrder: string[],
): {
  starts: Map<Record<string, unknown>, boolean>;
  resolutions: Map<Record<string, unknown>, boolean>;
} {
  const starts = new Map<Record<string, unknown>, boolean>();
  const resolutions = new Map<Record<string, unknown>, boolean>();
  let pending:
    | {event: Record<string, unknown>; started: ProjectedNegativeIncomeStartedEvent}
    | undefined;
  let hasObservedStart = false;
  const clearPending = () => {
    if (pending !== undefined) {
      starts.set(pending.event, false);
      pending = undefined;
    }
  };

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'negative_income_started') {
      const startedEvent = projectNegativeIncomeStartedEvent(event, playerIds, turnOrder);
      if (startedEvent === undefined || pending !== undefined) {
        starts.set(event, false);
        continue;
      }

      pending = {event, started: startedEvent};
      hasObservedStart = true;
      starts.set(event, true);
      continue;
    }

    if (event.type === 'negative_income_resolved') {
      const resolvedEvent = projectNegativeIncomeResolvedEvent(event, board, playerIds);
      if (resolvedEvent === undefined) {
        resolutions.set(event, false);
        continue;
      }

      if (!hasObservedStart) {
        resolutions.set(event, false);
        continue;
      }

      if (
        pending === undefined ||
        resolvedEvent.playerId !== pending.started.playerId ||
        resolvedEvent.amountOwed !== pending.started.amountOwed
      ) {
        resolutions.set(event, false);
        continue;
      }

      pending = undefined;
      resolutions.set(event, true);
      continue;
    }

    if (pending !== undefined && !isNegativeIncomePendingEvidenceEvent(event, board, pending.started)) {
      clearPending();
    }
  }

  return {starts, resolutions};
}

function historicalNegativeIncomeShortfallClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalNegativeIncomeResolutions: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingShortfall:
    | {event: Record<string, unknown>; change: ProjectedVictoryPointsChangedEvent}
    | undefined;

  const clearPendingShortfall = () => {
    pendingShortfall = undefined;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingShortfall();
      continue;
    }

    if (event.type === 'victory_points_changed') {
      const change = projectVictoryPointsChangedEvent(event, playerIds);
      pendingShortfall = change?.reason === 'negative income shortfall'
        ? {event, change}
        : undefined;
      continue;
    }

    if (event.type !== 'negative_income_resolved') {
      clearPendingShortfall();
      continue;
    }

    if (pendingShortfall === undefined) {
      continue;
    }

    const resolvedEvent = projectNegativeIncomeResolvedEvent(event, board, playerIds);
    if (
      resolvedEvent === undefined ||
      historicalNegativeIncomeResolutions.get(event) !== true ||
      resolvedEvent.playerId !== pendingShortfall.change.playerId ||
      resolvedEvent.victoryPointLoss !== -pendingShortfall.change.delta
    ) {
      claims.set(pendingShortfall.event, false);
      clearPendingShortfall();
      continue;
    }

    claims.set(pendingShortfall.event, true);
    clearPendingShortfall();
  }

  return claims;
}

function historicalRoundIncomeCashClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalMerchantBonusValueChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryFlipIncomeChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLoanValueChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalNegativeIncomeResolutions: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const incomePositions = new Map(playerIds.map((playerId) => [playerId, staticConfig.incomeTrack.startPosition]));
  const knownIncomePositionPlayers = new Set<string>();
  let incomeSettlementActive = false;
  let settledIncomePlayers = new Set<string>();
  let pendingNegativeIncomePayment:
    | {event: Record<string, unknown>; change: ProjectedCashChangedEvent}
    | undefined;

  const startIncomeSettlement = () => {
    incomeSettlementActive = true;
    settledIncomePlayers = new Set();
    pendingNegativeIncomePayment = undefined;
  };

  const clearPendingNegativeIncomePayment = () => {
    pendingNegativeIncomePayment = undefined;
  };

  const stopIncomeSettlement = () => {
    incomeSettlementActive = false;
    settledIncomePlayers = new Set();
    clearPendingNegativeIncomePayment();
  };

  const incomePositionChangeIsUsable = (
    event: Record<string, unknown>,
    incomeEvent: ProjectedIncomePositionChangedEvent,
  ): boolean =>
    (
      incomeEvent.reason !== 'merchant bonus' ||
      historicalMerchantBonusValueChangeClaims.get(event) === true
    ) &&
    (
      industryFlipIncomeReason(incomeEvent.reason) === undefined ||
      historicalIndustryFlipIncomeChangeClaims.get(event) === true
    ) &&
    historicalLoanValueChangeClaims.get(event) !== false;

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingNegativeIncomePayment();
      continue;
    }

    if (event.type === 'income_position_changed') {
      const incomeEvent = projectIncomePositionChangedEvent(event, playerIds);
      if (incomeEvent !== undefined && incomePositionChangeIsUsable(event, incomeEvent)) {
        incomePositions.set(incomeEvent.playerId, incomeEvent.to);
        knownIncomePositionPlayers.add(incomeEvent.playerId);
      }
      clearPendingNegativeIncomePayment();
      continue;
    }

    if (event.type === 'turn_order_updated') {
      const order = playerIdArray(event.order, playerIds);
      if (isCompletePlayerOrder(order, playerIds)) {
        startIncomeSettlement();
      } else {
        stopIncomeSettlement();
      }
      continue;
    }

    if (event.type === 'cash_changed') {
      const cashEvent = projectCashChangedEvent(event, playerIds);
      if (cashEvent?.reason !== 'income') {
        if (cashEvent?.reason !== 'negative income liquidation') {
          clearPendingNegativeIncomePayment();
        }
        continue;
      }

      if (!incomeSettlementActive) {
        clearPendingNegativeIncomePayment();
        continue;
      }
      if (!knownIncomePositionPlayers.has(cashEvent.playerId)) {
        clearPendingNegativeIncomePayment();
        continue;
      }

      const incomeLevel = getIncomeLevel(incomePositions.get(cashEvent.playerId) ?? staticConfig.incomeTrack.startPosition);
      if (settledIncomePlayers.has(cashEvent.playerId)) {
        claims.set(event, false);
        clearPendingNegativeIncomePayment();
        continue;
      }

      if (cashEvent.delta > 0) {
        if (cashEvent.delta !== incomeLevel) {
          claims.set(event, false);
        } else {
          claims.set(event, true);
          settledIncomePlayers.add(cashEvent.playerId);
        }
        clearPendingNegativeIncomePayment();
        continue;
      }

      if (incomeLevel >= 0 || -cashEvent.delta > -incomeLevel) {
        claims.set(event, false);
        clearPendingNegativeIncomePayment();
        continue;
      }

      pendingNegativeIncomePayment = {event, change: cashEvent};
      settledIncomePlayers.add(cashEvent.playerId);
      continue;
    }

    if (event.type === 'victory_points_changed') {
      const changedEvent = projectVictoryPointsChangedEvent(event, playerIds);
      if (
        pendingNegativeIncomePayment !== undefined &&
        changedEvent?.reason === 'negative income shortfall' &&
        changedEvent.playerId === pendingNegativeIncomePayment.change.playerId
      ) {
        continue;
      }
      stopIncomeSettlement();
      continue;
    }

    if (event.type === 'negative_income_resolved') {
      if (pendingNegativeIncomePayment === undefined) {
        continue;
      }

      const resolvedEvent = projectNegativeIncomeResolvedEvent(event, board, playerIds);
      if (
        resolvedEvent === undefined ||
        historicalNegativeIncomeResolutions.get(event) === false ||
        resolvedEvent.playerId !== pendingNegativeIncomePayment.change.playerId ||
        resolvedEvent.paid !== -pendingNegativeIncomePayment.change.delta
      ) {
        claims.set(pendingNegativeIncomePayment.event, false);
      } else {
        claims.set(pendingNegativeIncomePayment.event, true);
      }
      clearPendingNegativeIncomePayment();
      continue;
    }

    if (event.type === 'turn_advanced' || event.type === 'era_ended' || event.type === 'game_ended') {
      stopIncomeSettlement();
      continue;
    }

    if (
      event.type === 'card_discarded' ||
      event.type === 'industry_built' ||
      event.type === 'industry_flipped' ||
      event.type === 'industry_sold' ||
      event.type === 'resource_consumed' ||
      event.type === 'resource_sold_to_market' ||
      event.type === 'link_built' ||
      event.type === 'link_scored' ||
      event.type === 'industry_scored' ||
      event.type === 'merchant_bonus_claimed' ||
      event.type === 'merchant_develop_resolved' ||
      event.type === 'loan_taken' ||
      event.type === 'scouted'
    ) {
      stopIncomeSettlement();
    }
  }

  return claims;
}

function negativeIncomeResolutionMatchesRules(
  board: GameState['board'],
  industryInstanceIds: readonly string[] | undefined,
  amountOwed: number,
  paid: number,
  victoryPointLoss: number,
): industryInstanceIds is string[] {
  if (industryInstanceIds === undefined) {
    return false;
  }
  const selectedLiquidationValue = [...new Set(industryInstanceIds)]
    .reduce((sum, industryInstanceId) => {
      const industry = board.industryInstances[industryInstanceId];
      const cashCost = industry === undefined
        ? undefined
        : staticConfig.industryTileSpecs[industry.specId]?.cost.cash;
      return sum + Math.floor((cashCost ?? 0) / 2);
    }, 0);
  const minimumPaidFromLiquidations = Math.min(amountOwed, selectedLiquidationValue);
  return paid + victoryPointLoss === amountOwed &&
    paid >= minimumPaidFromLiquidations &&
    industryInstanceIds.every((industryInstanceId) => industryIsRemoved(board, industryInstanceId));
}

function knownIndustryInstanceId(
  board: GameState['board'],
  industryInstanceId: string | undefined,
  ownerPlayerId?: string,
): industryInstanceId is string {
  const industry = industryInstanceId === undefined ? undefined : board.industryInstances[industryInstanceId];
  return Boolean(industry && (ownerPlayerId === undefined || industry.ownerPlayerId === ownerPlayerId));
}

function knownIndustryInstanceIds(
  board: GameState['board'],
  industryInstanceIds: string[] | undefined,
  ownerPlayerId?: string,
): industryInstanceIds is string[] {
  return industryInstanceIds !== undefined &&
    industryInstanceIds.every((industryInstanceId) => knownIndustryInstanceId(board, industryInstanceId, ownerPlayerId));
}

function knownLinkInstanceId(
  board: GameState['board'],
  linkInstanceId: string | undefined,
  ownerPlayerId?: string,
): linkInstanceId is string {
  const link = linkInstanceId === undefined ? undefined : board.linkInstances[linkInstanceId];
  return Boolean(link && (ownerPlayerId === undefined || link.ownerPlayerId === ownerPlayerId));
}

interface HistoricalLinkReference {
  ownerPlayerId: string;
  linkLineId: string;
  signature: string;
}

type HistoricalLinkReferenceEntry = HistoricalLinkReference | null;
type HistoricalIndustryScoreEntry = number | null;
type ProjectedGameCreatedEvent = Extract<GameEvent, {type: 'game_created'}>;
type ProjectedCardDiscardedEvent =
  | Extract<GameEvent, {type: 'card_discarded'}>
  | {type: 'card_discarded'; playerId: string; cardId: string};
type ProjectedIndustryBuiltEvent = Extract<GameEvent, {type: 'industry_built'}>;
type ProjectedIndustryRemovedEvent = Extract<GameEvent, {type: 'industry_removed'}>;
type ProjectedIndustryFlippedEvent = Extract<GameEvent, {type: 'industry_flipped'}>;
type ProjectedIndustrySoldEvent = Extract<GameEvent, {type: 'industry_sold'}>;
type ProjectedResourceConsumedEvent = Extract<GameEvent, {type: 'resource_consumed'}>;
type ProjectedResourceSoldToMarketEvent = Extract<GameEvent, {type: 'resource_sold_to_market'}>;
type ProjectedLinkBuiltEvent = Extract<GameEvent, {type: 'link_built'}>;
type ProjectedLinkScoredEvent = Extract<GameEvent, {type: 'link_scored'}>;
type ProjectedIndustryScoredEvent = Extract<GameEvent, {type: 'industry_scored'}>;
type ProjectedMerchantBonusClaimedEvent = Extract<GameEvent, {type: 'merchant_bonus_claimed'}>;
type ProjectedMerchantDevelopResolvedEvent = Extract<GameEvent, {type: 'merchant_develop_resolved'}>;
type ProjectedNegativeIncomeStartedEvent = Extract<GameEvent, {type: 'negative_income_started'}>;
type ProjectedNegativeIncomeResolvedEvent = Extract<GameEvent, {type: 'negative_income_resolved'}>;
type ProjectedEraEndedEvent = Extract<GameEvent, {type: 'era_ended'}>;
type ProjectedGameEndedEvent = Extract<GameEvent, {type: 'game_ended'}>;
type ProjectedTurnAdvancedEvent = Extract<GameEvent, {type: 'turn_advanced'}>;
type ProjectedCashChangedEvent = Extract<GameEvent, {type: 'cash_changed'}>;
type ProjectedIncomePositionChangedEvent = Extract<GameEvent, {type: 'income_position_changed'}>;
type ProjectedLoanTakenEvent = Extract<GameEvent, {type: 'loan_taken'}>;
type ProjectedScoutedEvent = Extract<GameEvent, {type: 'scouted'}>;
type ProjectedVictoryPointsChangedEvent = Extract<GameEvent, {type: 'victory_points_changed'}>;
type ProjectedMerchantBonusValueChange =
  | {kind: 'cash'; change: ProjectedCashChangedEvent}
  | {kind: 'income_spaces'; change: ProjectedIncomePositionChangedEvent}
  | {kind: 'victory_points'; change: ProjectedVictoryPointsChangedEvent};

interface HistoricalIndustryReference {
  ownerPlayerId: string;
  industryType: IndustryType;
  specId: string;
  locationId: string;
  flipped: boolean;
  removed: boolean;
}

function historicalLinkSignature(instance: LinkInstance): string {
  return `${instance.ownerPlayerId}|${instance.linkType}|${instance.linkLineId}`;
}

function historicalLinkOwnersForView(
  events: readonly unknown[],
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<string, HistoricalLinkReferenceEntry> {
  const owners = new Map<string, HistoricalLinkReferenceEntry>();
  for (const event of events) {
    if (!isRecord(event) || event.type !== 'link_built') {
      continue;
    }
    const instance = projectPlayerOwnedLinkInstance(event.instance, playerIds);
    if (
      instance === undefined ||
      !isGeneratedInstanceId(instance.id, 'link') ||
      !isLinkLineActiveForPlayerCount(playerCount, instance.linkLineId)
    ) {
      continue;
    }
    const reference = {
      ownerPlayerId: instance.ownerPlayerId,
      linkLineId: instance.linkLineId,
      signature: historicalLinkSignature(instance),
    };
    if (!owners.has(instance.id)) {
      owners.set(instance.id, reference);
      continue;
    }
    const existingReference = owners.get(instance.id);
    if (
      existingReference !== undefined &&
      existingReference !== null &&
      (existingReference.ownerPlayerId !== reference.ownerPlayerId ||
        existingReference.signature !== reference.signature)
    ) {
      owners.set(instance.id, null);
    }
  }
  return owners;
}

function knownHistoricalLinkOwner(
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  linkInstanceId: string,
  ownerPlayerId: string,
): boolean {
  const reference = historicalLinkOwners.get(linkInstanceId);
  return reference !== null && reference !== undefined && reference.ownerPlayerId === ownerPlayerId;
}

function historicalLinkLineId(
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  linkInstanceId: string,
): string | undefined {
  const reference = historicalLinkOwners.get(linkInstanceId);
  return reference === null || reference === undefined ? undefined : reference.linkLineId;
}

function historicalIndustryMatchesBoard(
  industry: IndustryInstance,
  boardIndustry: IndustryInstance | undefined,
): boolean {
  return boardIndustry !== undefined &&
    boardIndustry.ownerPlayerId === industry.ownerPlayerId &&
    boardIndustry.industryType === industry.industryType &&
    boardIndustry.specId === industry.specId &&
    boardIndustry.locationId === industry.locationId;
}

function historicalIndustryFromBoard(board: GameState['board'], industryInstanceId: string): HistoricalIndustryReference | undefined {
  const industry = board.industryInstances[industryInstanceId];
  return industry === undefined
    ? undefined
    : {
      ownerPlayerId: industry.ownerPlayerId,
      industryType: industry.industryType,
      specId: industry.specId,
      locationId: industry.locationId,
      flipped: industry.flipped,
      removed: false,
    };
}

function linkScoreValueForHistoricalIndustries(
  linkLineId: string,
  industries: ReadonlyMap<string, HistoricalIndustryReference>,
): number | undefined {
  const line = staticConfig.linkLines[linkLineId];
  if (!line) {
    return undefined;
  }
  const endpointIds = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId));
  return endpointIds.reduce((sum, locationId) => {
    const location = staticConfig.locations[locationId];
    const printed = location?.printedLinkIcons ?? 0;
    const industryIcons = [...industries.values()]
      .filter((industry) => industry.locationId === locationId && industry.flipped && !industry.removed)
      .reduce((total, industry) => total + (staticConfig.industryTileSpecs[industry.specId]?.flip.linkIcons ?? 0), 0);
    return sum + printed + industryIcons;
  }, 0);
}

function historicalLinkScoreKey(linkInstanceId: string, ownerPlayerId: string): string {
  return `${linkInstanceId}:${ownerPlayerId}`;
}

function historicalLinkScoreValuesForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  playerIds: string[],
): Map<string, number> {
  const industries = new Map<string, HistoricalIndustryReference>();
  const scoreValues = new Map<string, number>();
  let hasObservedIndustryRemoval = false;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'industry_built') {
      const industry = projectPlayerOwnedIndustryInstance(event.instance, playerIds);
      if (
        industry !== undefined &&
        isGeneratedInstanceId(industry.id, 'industry') &&
        historicalIndustryMatchesBoard(industry, board.industryInstances[industry.id])
      ) {
        industries.set(industry.id, {
          ownerPlayerId: industry.ownerPlayerId,
          industryType: industry.industryType,
          specId: industry.specId,
          locationId: industry.locationId,
          flipped: industry.flipped,
          removed: industry.removedFromGame,
        });
      }
      continue;
    }

    if (event.type === 'industry_flipped') {
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
      if (industryInstanceId === undefined || ownerPlayerId === undefined) {
        continue;
      }
      const industry = industries.get(industryInstanceId) ?? historicalIndustryFromBoard(board, industryInstanceId);
      if (industry !== undefined && industry.ownerPlayerId === ownerPlayerId) {
        industries.set(industryInstanceId, {...industry, flipped: true});
      }
      continue;
    }

    if (event.type === 'industry_removed') {
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const reason = nonEmptyString(event.reason);
      if (
        industryInstanceId === undefined ||
        !isOneOf(reason, INDUSTRY_REMOVAL_REASONS) ||
        !industryIsRemoved(board, industryInstanceId)
      ) {
        continue;
      }
      const industry = industries.get(industryInstanceId) ?? historicalIndustryFromBoard(board, industryInstanceId);
      if (industry !== undefined) {
        industries.set(industryInstanceId, {...industry, removed: true});
        hasObservedIndustryRemoval = true;
      }
      continue;
    }

    if (event.type === 'link_scored') {
      const linkInstanceId = nonEmptyString(event.linkInstanceId);
      const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
      if (!isGeneratedInstanceId(linkInstanceId, 'link') || ownerPlayerId === undefined) {
        continue;
      }
      const linkLineId = linkLineIdForScoredLink(board, historicalLinkOwners, linkInstanceId);
      const points = linkLineId === undefined ? undefined : linkScoreValueForHistoricalIndustries(linkLineId, industries);
      if (points !== undefined && hasObservedIndustryRemoval) {
        scoreValues.set(historicalLinkScoreKey(linkInstanceId, ownerPlayerId), points);
      }
    }
  }

  return scoreValues;
}

function historicalIndustryScoreValuesForView(
  events: readonly unknown[],
  board: GameState['board'],
  playerIds: string[],
): Map<Record<string, unknown>, HistoricalIndustryScoreEntry> {
  const industries = new Map<string, HistoricalIndustryReference>();
  const scoreValues = new Map<Record<string, unknown>, HistoricalIndustryScoreEntry>();
  let hasObservedIndustryRemoval = false;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'industry_built') {
      const industry = projectPlayerOwnedIndustryInstance(event.instance, playerIds);
      if (
        industry !== undefined &&
        isGeneratedInstanceId(industry.id, 'industry') &&
        historicalIndustryMatchesBoard(industry, board.industryInstances[industry.id])
      ) {
        industries.set(industry.id, {
          ownerPlayerId: industry.ownerPlayerId,
          industryType: industry.industryType,
          specId: industry.specId,
          locationId: industry.locationId,
          flipped: industry.flipped,
          removed: industry.removedFromGame,
        });
      }
      continue;
    }

    if (event.type === 'industry_flipped') {
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
      if (industryInstanceId === undefined || ownerPlayerId === undefined) {
        continue;
      }
      const industry = industries.get(industryInstanceId) ?? historicalIndustryFromBoard(board, industryInstanceId);
      if (industry !== undefined && industry.ownerPlayerId === ownerPlayerId) {
        industries.set(industryInstanceId, {...industry, flipped: true});
      }
      continue;
    }

    if (event.type === 'industry_removed') {
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const reason = nonEmptyString(event.reason);
      if (
        industryInstanceId === undefined ||
        !isOneOf(reason, INDUSTRY_REMOVAL_REASONS) ||
        !industryIsRemoved(board, industryInstanceId)
      ) {
        continue;
      }
      const industry = industries.get(industryInstanceId) ?? historicalIndustryFromBoard(board, industryInstanceId);
      if (industry !== undefined) {
        industries.set(industryInstanceId, {...industry, removed: true});
        hasObservedIndustryRemoval = true;
      }
      continue;
    }

    if (event.type === 'industry_scored') {
      const industryInstanceId = nonEmptyString(event.industryInstanceId);
      const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
      if (!isGeneratedInstanceId(industryInstanceId, 'industry') || ownerPlayerId === undefined) {
        continue;
      }
      const industry = industries.get(industryInstanceId) ?? historicalIndustryFromBoard(board, industryInstanceId);
      const points = industry === undefined ||
        industry.ownerPlayerId !== ownerPlayerId ||
        !industry.flipped ||
        industry.removed
        ? null
        : staticConfig.industryTileSpecs[industry.specId]?.flip.victoryPoints ?? null;
      if (hasObservedIndustryRemoval) {
        scoreValues.set(event, points);
      }
    }
  }

  return scoreValues;
}

function merchantBonusClaimKey(playerId: string, merchantSpaceId: string): string {
  return `${playerId}:${merchantSpaceId}`;
}

function isProjectedMerchantBonusPendingBoundary(
  event: Record<string, unknown>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): boolean {
  if (event.type === 'era_ended') {
    return historicalEraEndedClaims.get(event) === true;
  }
  if (event.type === 'turn_order_updated') {
    return isCompletePlayerOrder(playerIdArray(event.order, playerIds), playerIds);
  }
  if (event.type === 'turn_advanced') {
    return projectTurnAdvancedEvent(event, playerIds) !== undefined;
  }
  return event.type === 'game_ended';
}

function historicalMerchantBonusClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalResourceConsumptionClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const pendingMerchantBeers = new Map<string, number>();
  let hasObservedMerchantBeerConsumption = false;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (isProjectedMerchantBonusPendingBoundary(event, historicalEraEndedClaims, playerIds)) {
      pendingMerchantBeers.clear();
      continue;
    }

    if (event.type === 'resource_consumed') {
      if (historicalResourceConsumptionClaims.get(event) === false) {
        continue;
      }

      const source = projectResourceSource(event.source, board);
      const byPlayerId = playerIdField(event, 'byPlayerId', playerIds);
      const reason = publicEventReason(event.reason);
      if (
        source?.kind === 'merchant_beer' &&
        byPlayerId !== undefined &&
        reason !== undefined &&
        resourceConsumptionReasonMatchesSource(source, reason)
      ) {
        const key = merchantBonusClaimKey(byPlayerId, source.merchantSpaceId);
        pendingMerchantBeers.set(key, (pendingMerchantBeers.get(key) ?? 0) + 1);
        hasObservedMerchantBeerConsumption = true;
      }
      continue;
    }

    if (event.type === 'merchant_bonus_claimed') {
      if (!hasObservedMerchantBeerConsumption) {
        claims.set(event, false);
        continue;
      }

      const playerId = playerIdField(event, 'playerId', playerIds);
      const merchantSpaceId = nonEmptyString(event.merchantSpaceId);
      const bonus = projectMerchantBonus(event.bonus);
      if (
        playerId === undefined ||
        !knownMerchantSpaceId(board, merchantSpaceId) ||
        bonus === undefined ||
        !merchantBonusMatchesSpace(merchantSpaceId, bonus)
      ) {
        claims.set(event, false);
        continue;
      }

      const key = merchantBonusClaimKey(playerId, merchantSpaceId);
      const pendingCount = pendingMerchantBeers.get(key) ?? 0;
      if (pendingCount <= 0) {
        claims.set(event, false);
        continue;
      }

      pendingMerchantBeers.set(key, pendingCount - 1);
      claims.set(event, true);
    }
  }

  return claims;
}

function historicalMerchantBonusValueChangeClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalMerchantBonusClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingValueChange:
    | {event: Record<string, unknown>; valueChange: ProjectedMerchantBonusValueChange}
    | undefined;

  const clearPendingValueChange = () => {
    pendingValueChange = undefined;
  };

  for (const event of events) {
    if (!isRecord(event)) {
      clearPendingValueChange();
      continue;
    }

    const valueChange = projectMerchantBonusValueChange(event, playerIds);
    if (valueChange !== undefined) {
      pendingValueChange = {event, valueChange};
      continue;
    }

    if (event.type !== 'merchant_bonus_claimed') {
      clearPendingValueChange();
      continue;
    }

    if (pendingValueChange === undefined) {
      continue;
    }

    const claimedEvent = projectMerchantBonusClaimedEvent(event, board, playerIds);
    if (claimedEvent === undefined) {
      clearPendingValueChange();
      continue;
    }

    if (
      historicalMerchantBonusClaims.get(event) === false ||
      !merchantBonusValueChangeMatchesClaim(pendingValueChange.valueChange, claimedEvent)
    ) {
      claims.set(pendingValueChange.event, false);
      clearPendingValueChange();
      continue;
    }

    claims.set(pendingValueChange.event, true);
    clearPendingValueChange();
  }

  return claims;
}

function projectMerchantDevelopResolvedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedMerchantDevelopResolvedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const merchantSpaceId = nonEmptyString(event.merchantSpaceId);
  const industryTypes = enumArray(event.industryTypes, INDUSTRY_TYPES);
  const specIds = trimmedStringArray(event.specIds);
  const hasDuplicateSpecIds = specIds !== undefined && new Set(specIds).size !== specIds.length;
  const merchantSpaceIds = event.merchantSpaceIds === undefined ? undefined : trimmedStringArray(event.merchantSpaceIds);
  const safeMerchantSpaceIds = merchantSpaceId === undefined || merchantSpaceIds === undefined
    ? undefined
    : [...new Set([merchantSpaceId, ...merchantSpaceIds])];
  if (
    playerId === undefined ||
    !knownMerchantSpaceId(board, merchantSpaceId) ||
    !merchantSpaceHasDevelopBonus(merchantSpaceId) ||
    industryTypes === undefined ||
    hasDuplicateSpecIds ||
    !knownIndustrySpecIdsForTypes(specIds, industryTypes) ||
    (event.merchantSpaceIds !== undefined && (
      !knownMerchantSpaceIds(board, safeMerchantSpaceIds) ||
      !safeMerchantSpaceIds.every(merchantSpaceHasDevelopBonus)
    ))
  ) {
    return undefined;
  }
  return {
    type: 'merchant_develop_resolved',
    playerId,
    merchantSpaceId,
    merchantSpaceIds: safeMerchantSpaceIds ?? [merchantSpaceId],
    industryTypes,
    specIds,
  };
}

function historicalMerchantDevelopResolutionsForView(
  events: readonly unknown[],
  board: GameState['board'],
  players: GameState['players'],
  historicalMerchantBonusClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const resolutions = new Map<Record<string, unknown>, boolean>();
  const pendingDevelopBonuses = new Map<string, number>();
  const claimedRemovedSpecIdsByPlayer = new Map<string, Set<string>>();
  let hasObservedDevelopBonus = false;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (isProjectedMerchantBonusPendingBoundary(event, historicalEraEndedClaims, playerIds)) {
      pendingDevelopBonuses.clear();
      continue;
    }

    if (event.type === 'merchant_bonus_claimed') {
      if (historicalMerchantBonusClaims.get(event) === false) {
        continue;
      }

      const playerId = playerIdField(event, 'playerId', playerIds);
      const merchantSpaceId = nonEmptyString(event.merchantSpaceId);
      const bonus = projectMerchantBonus(event.bonus);
      if (
        playerId !== undefined &&
        knownMerchantSpaceId(board, merchantSpaceId) &&
        bonus?.type === 'develop' &&
        merchantBonusMatchesSpace(merchantSpaceId, bonus)
      ) {
        const key = merchantBonusClaimKey(playerId, merchantSpaceId);
        pendingDevelopBonuses.set(key, (pendingDevelopBonuses.get(key) ?? 0) + bonus.count);
        hasObservedDevelopBonus = true;
      }
      continue;
    }

    if (event.type === 'merchant_develop_resolved') {
      if (!hasObservedDevelopBonus) {
        resolutions.set(event, false);
        continue;
      }

      const resolvedEvent = projectMerchantDevelopResolvedEvent(event, board, playerIds);
      if (resolvedEvent === undefined) {
        resolutions.set(event, false);
        continue;
      }

      const resolvedMerchantSpaceIds = resolvedEvent.merchantSpaceIds ?? [resolvedEvent.merchantSpaceId];
      const availableDevelopCount = resolvedMerchantSpaceIds.reduce(
        (sum, merchantSpaceId) => sum + (pendingDevelopBonuses.get(merchantBonusClaimKey(resolvedEvent.playerId, merchantSpaceId)) ?? 0),
        0,
      );
      const player = players[resolvedEvent.playerId];
      const claimedRemovedSpecIds = claimedRemovedSpecIdsByPlayer.get(resolvedEvent.playerId) ?? new Set<string>();
      const specIdsMatchRemovedStacks = player !== undefined &&
        resolvedEvent.specIds.every((specId, index) => {
          const industryType = resolvedEvent.industryTypes[index];
          return player.industryTileStacks[industryType]?.removedSpecIds.includes(specId) &&
            !claimedRemovedSpecIds.has(specId);
        });
      if (
        availableDevelopCount <= 0 ||
        resolvedEvent.industryTypes.length > availableDevelopCount ||
        !specIdsMatchRemovedStacks
      ) {
        resolutions.set(event, false);
        continue;
      }

      for (const specId of resolvedEvent.specIds) {
        claimedRemovedSpecIds.add(specId);
      }
      claimedRemovedSpecIdsByPlayer.set(resolvedEvent.playerId, claimedRemovedSpecIds);
      for (const merchantSpaceId of resolvedMerchantSpaceIds) {
        pendingDevelopBonuses.delete(merchantBonusClaimKey(resolvedEvent.playerId, merchantSpaceId));
      }
      resolutions.set(event, true);
    }
  }

  return resolutions;
}

function linkLineIdForScoredLink(
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  linkInstanceId: string,
): string | undefined {
  return board.linkInstances[linkInstanceId]?.linkLineId ?? historicalLinkLineId(historicalLinkOwners, linkInstanceId);
}

function linkScoreValueForBoard(board: GameState['board'], linkLineId: string): number | undefined {
  const line = staticConfig.linkLines[linkLineId];
  if (!line) {
    return undefined;
  }
  const endpointIds = [line.endpointA, line.endpointB, line.viaFarmBreweryId]
    .filter((locationId): locationId is string => Boolean(locationId));
  return endpointIds.reduce((sum, locationId) => {
    const location = staticConfig.locations[locationId];
    const printed = location?.printedLinkIcons ?? 0;
    const industryIcons = Object.values(board.industryInstances)
      .filter((industry) => industry.locationId === locationId && industry.flipped)
      .reduce((total, industry) => total + (staticConfig.industryTileSpecs[industry.specId]?.flip.linkIcons ?? 0), 0);
    return sum + printed + industryIcons;
  }, 0);
}

function linkScoreMatchesRules(
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  historicalLinkScoreValues: ReadonlyMap<string, number>,
  linkInstanceId: string,
  ownerPlayerId: string,
  points: number,
): boolean {
  const historicalScore = historicalLinkScoreValues.get(historicalLinkScoreKey(linkInstanceId, ownerPlayerId));
  if (historicalScore !== undefined) {
    return historicalScore === points;
  }
  const linkLineId = linkLineIdForScoredLink(board, historicalLinkOwners, linkInstanceId);
  const expectedPoints = linkLineId === undefined ? undefined : linkScoreValueForBoard(board, linkLineId);
  return expectedPoints === points;
}

function knownMerchantSpaceIds(board: GameState['board'], merchantSpaceIds: string[] | undefined): merchantSpaceIds is string[] {
  return merchantSpaceIds !== undefined &&
    merchantSpaceIds.every((merchantSpaceId) => knownMerchantSpaceId(board, merchantSpaceId));
}

function knownIndustrySpecIdsForTypes(specIds: string[] | undefined, industryTypes: IndustryType[] | undefined): specIds is string[] {
  return specIds !== undefined &&
    industryTypes !== undefined &&
    specIds.length === industryTypes.length &&
    specIds.every((specId, index) => isKnownIndustrySpecIdForType(specId, industryTypes[index]));
}

function scoreBreakdownTotalsMatch(score: EraScoreBreakdown, playerIds: readonly string[]): boolean {
  return playerIds.every((playerId) =>
    score.totalVictoryPointsByPlayer[playerId] ===
    score.linkVictoryPointsByPlayer[playerId] + score.industryVictoryPointsByPlayer[playerId],
  );
}

function projectLinkScoredEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  historicalLinkScoreValues: ReadonlyMap<string, number>,
  playerIds: string[],
): ProjectedLinkScoredEvent | undefined {
  const linkInstanceId = nonEmptyString(event.linkInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  const points = nonNegativeIntegerField(event, 'points');
  if (!isGeneratedInstanceId(linkInstanceId, 'link') || ownerPlayerId === undefined || points === undefined) {
    return undefined;
  }
  const hasKnownLink = knownLinkInstanceId(board, linkInstanceId, ownerPlayerId) ||
    knownHistoricalLinkOwner(historicalLinkOwners, linkInstanceId, ownerPlayerId);
  return hasKnownLink && linkScoreMatchesRules(
    board,
    historicalLinkOwners,
    historicalLinkScoreValues,
    linkInstanceId,
    ownerPlayerId,
    points,
  )
    ? {type: 'link_scored', linkInstanceId, ownerPlayerId, points}
    : undefined;
}

function projectIndustryScoredEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  historicalIndustryScoreValues: ReadonlyMap<Record<string, unknown>, HistoricalIndustryScoreEntry>,
  playerIds: string[],
): ProjectedIndustryScoredEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  const points = nonNegativeIntegerField(event, 'points');
  return ownerPlayerId === undefined ||
    points === undefined ||
    !knownIndustryInstanceId(board, industryInstanceId, ownerPlayerId) ||
    !industryScoreMatchesRules(
      board,
      historicalIndustryScoreValues.get(event),
      industryInstanceId,
      points,
    )
    ? undefined
    : {type: 'industry_scored', industryInstanceId, ownerPlayerId, points};
}

function historicalScoringClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  historicalLinkScoreValues: ReadonlyMap<string, number>,
  historicalIndustryScoreValues: ReadonlyMap<Record<string, unknown>, HistoricalIndustryScoreEntry>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): {
  links: Map<Record<string, unknown>, boolean>;
  industries: Map<Record<string, unknown>, boolean>;
} {
  const links = new Map<Record<string, unknown>, boolean>();
  const industries = new Map<Record<string, unknown>, boolean>();
  const scoredLinkKeys = new Set<string>();
  const scoredIndustryInstanceIdsThisEra = new Set<string>();

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'era_ended' && historicalEraEndedClaims.get(event) === true) {
      scoredIndustryInstanceIdsThisEra.clear();
      continue;
    }

    if (event.type === 'link_scored') {
      const scoredEvent = projectLinkScoredEvent(
        event,
        board,
        historicalLinkOwners,
        historicalLinkScoreValues,
        playerIds,
      );
      if (scoredEvent === undefined) {
        if (projectRawLinkScoredEvent(event, playerIds) === undefined) {
          links.set(event, false);
        }
        continue;
      }

      const key = historicalLinkScoreKey(scoredEvent.linkInstanceId, scoredEvent.ownerPlayerId);
      if (scoredLinkKeys.has(key)) {
        links.set(event, false);
        continue;
      }

      scoredLinkKeys.add(key);
      links.set(event, true);
      continue;
    }

    if (event.type === 'industry_scored') {
      const scoredEvent = projectIndustryScoredEvent(event, board, historicalIndustryScoreValues, playerIds);
      if (scoredEvent === undefined) {
        if (projectRawIndustryScoredEvent(event, playerIds) === undefined) {
          industries.set(event, false);
        }
        continue;
      }

      if (scoredIndustryInstanceIdsThisEra.has(scoredEvent.industryInstanceId)) {
        industries.set(event, false);
        continue;
      }

      scoredIndustryInstanceIdsThisEra.add(scoredEvent.industryInstanceId);
      industries.set(event, true);
    }
  }

  return {links, industries};
}

function projectEraScoreBreakdown(value: unknown, playerIds: string[]): EraScoreBreakdown | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const era = nonEmptyString(value.era);
  if (!isOneOf(era, ERAS)) {
    return undefined;
  }
  const linkVictoryPointsByPlayer = scoreRecordForPlayers(value.linkVictoryPointsByPlayer, playerIds);
  const industryVictoryPointsByPlayer = scoreRecordForPlayers(value.industryVictoryPointsByPlayer, playerIds);
  const totalVictoryPointsByPlayer = scoreRecordForPlayers(value.totalVictoryPointsByPlayer, playerIds);
  if (
    linkVictoryPointsByPlayer === undefined ||
    industryVictoryPointsByPlayer === undefined ||
    totalVictoryPointsByPlayer === undefined
  ) {
    return undefined;
  }
  const score = {
    era,
    linkVictoryPointsByPlayer,
    industryVictoryPointsByPlayer,
    totalVictoryPointsByPlayer,
  };
  return scoreBreakdownTotalsMatch(score, playerIds) ? score : undefined;
}

function projectGameCreatedEvent(
  event: Record<string, unknown>,
  gameId: string,
  playerIds: string[],
): ProjectedGameCreatedEvent | undefined {
  const eventGameId = nonEmptyString(event.gameId);
  const eventPlayerIds = playerIdArray(event.playerIds, playerIds);
  return eventGameId !== gameId || !isCompletePlayerOrder(eventPlayerIds, playerIds)
    ? undefined
    : {type: 'game_created', gameId: eventGameId, playerIds};
}

function projectCardDiscardedEvent(
  event: Record<string, unknown>,
  hiddenDiscardIds: Map<string, Map<string, string>>,
  playerIds: string[],
  playerCount: GameState['playerCount'],
): ProjectedCardDiscardedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const rawCardId = nonEmptyString(event.cardId);
  if (playerId === undefined || rawCardId === undefined) {
    return undefined;
  }
  const cardId = publicDiscardCardId(rawCardId, hiddenDiscardIds.get(playerId), playerCount);
  if (cardId === undefined) {
    return undefined;
  }
  if (event.destination === undefined) {
    return {type: 'card_discarded', playerId, cardId};
  }
  const destination = nonEmptyString(event.destination);
  return !isOneOf(destination, DISCARD_DESTINATIONS)
    ? undefined
    : {type: 'card_discarded', playerId, cardId, destination};
}

function projectEraEndedEvent(event: Record<string, unknown>, playerIds: string[]): ProjectedEraEndedEvent | undefined {
  const era = nonEmptyString(event.era);
  const score = projectEraScoreBreakdown(event.score, playerIds);
  return !isOneOf(era, ERAS) || score === undefined || score.era !== era
    ? undefined
    : {type: 'era_ended', era, score};
}

function projectGameEndedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
  expectedGameEndedWinners: string[] | undefined,
): ProjectedGameEndedEvent | undefined {
  const winners = playerIdArray(event.winners, playerIds);
  return winners === undefined ||
    expectedGameEndedWinners === undefined ||
    !playerIdSetsMatch(winners, expectedGameEndedWinners)
    ? undefined
    : {type: 'game_ended', winners: expectedGameEndedWinners};
}

function projectCashChangedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedCashChangedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const delta = integerField(event, 'delta');
  const reason = publicEventReason(event.reason);
  return playerId === undefined ||
    delta === undefined ||
    reason === undefined ||
    !cashChangeReasonMatchesDelta(reason, delta)
    ? undefined
    : {type: 'cash_changed', playerId, delta, reason};
}

function projectIncomePositionChangedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedIncomePositionChangedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const from = integerField(event, 'from');
  const to = integerField(event, 'to');
  const reason = publicEventReason(event.reason);
  return playerId === undefined ||
    from === undefined ||
    to === undefined ||
    reason === undefined ||
    !incomeChangeReasonMatchesMove(reason, from, to)
    ? undefined
    : {type: 'income_position_changed', playerId, from, to, reason};
}

function projectLoanTakenEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedLoanTakenEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  return playerId === undefined ? undefined : {type: 'loan_taken', playerId};
}

function projectScoutedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedScoutedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  return playerId === undefined ? undefined : {type: 'scouted', playerId};
}

function projectVictoryPointsChangedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedVictoryPointsChangedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const delta = integerField(event, 'delta');
  const reason = publicEventReason(event.reason);
  return playerId === undefined ||
    delta === undefined ||
    reason === undefined ||
    !victoryPointReasonMatchesDelta(reason, delta)
    ? undefined
    : {type: 'victory_points_changed', playerId, delta, reason};
}

function projectMerchantBonusClaimedEvent(
  event: Record<string, unknown>,
  board: GameState['board'],
  playerIds: string[],
): ProjectedMerchantBonusClaimedEvent | undefined {
  const playerId = playerIdField(event, 'playerId', playerIds);
  const merchantSpaceId = nonEmptyString(event.merchantSpaceId);
  const bonus = projectMerchantBonus(event.bonus);
  return playerId === undefined ||
    !knownMerchantSpaceId(board, merchantSpaceId) ||
    bonus === undefined ||
    !merchantBonusMatchesSpace(merchantSpaceId, bonus)
    ? undefined
    : {type: 'merchant_bonus_claimed', playerId, merchantSpaceId, bonus};
}

function projectMerchantBonusValueChange(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedMerchantBonusValueChange | undefined {
  if (event.type === 'cash_changed') {
    const change = projectCashChangedEvent(event, playerIds);
    return change?.reason === 'merchant bonus' ? {kind: 'cash', change} : undefined;
  }
  if (event.type === 'income_position_changed') {
    const change = projectIncomePositionChangedEvent(event, playerIds);
    return change?.reason === 'merchant bonus' ? {kind: 'income_spaces', change} : undefined;
  }
  if (event.type === 'victory_points_changed') {
    const change = projectVictoryPointsChangedEvent(event, playerIds);
    return change?.reason === 'merchant bonus' ? {kind: 'victory_points', change} : undefined;
  }
  return undefined;
}

function merchantBonusValueChangeMatchesClaim(
  valueChange: ProjectedMerchantBonusValueChange,
  claimedEvent: ProjectedMerchantBonusClaimedEvent,
): boolean {
  if (valueChange.change.playerId !== claimedEvent.playerId) {
    return false;
  }
  switch (claimedEvent.bonus.type) {
    case 'cash':
      return valueChange.kind === 'cash' && valueChange.change.delta === claimedEvent.bonus.cash;
    case 'income_spaces':
      return valueChange.kind === 'income_spaces' &&
        valueChange.change.to === advanceIncomeSpaces(valueChange.change.from, claimedEvent.bonus.spaces);
    case 'victory_points':
      return valueChange.kind === 'victory_points' && valueChange.change.delta === claimedEvent.bonus.points;
    case 'develop':
      return false;
  }
}

function projectTurnAdvancedEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedTurnAdvancedEvent | undefined {
  const currentPlayerId = playerIdField(event, 'currentPlayerId', playerIds);
  const roundNumber = positiveIntegerField(event, 'roundNumber');
  return currentPlayerId === undefined || roundNumber === undefined
    ? undefined
    : {type: 'turn_advanced', currentPlayerId, roundNumber};
}

function historicalCardDiscardClaimsForView(
  events: readonly unknown[],
  hiddenDiscardIds: Map<string, Map<string, string>>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const discardedRegularCardKeys = new Set<string>();

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (
      event.type === 'era_ended' &&
      historicalEraEndedClaims.get(event) === true &&
      isValidCanalEraEndEventForClaims(event, playerIds)
    ) {
      discardedRegularCardKeys.clear();
      continue;
    }

    if (event.type !== 'card_discarded') {
      continue;
    }

    const discardedEvent = projectCardDiscardedEvent(event, hiddenDiscardIds, playerIds, playerCount);
    const rawCardId = nonEmptyString(event.cardId);
    if (discardedEvent === undefined || rawCardId === undefined) {
      claims.set(event, false);
      continue;
    }

    const destination = 'destination' in discardedEvent ? discardedEvent.destination : 'discard';
    if (destination !== 'discard') {
      claims.set(event, true);
      continue;
    }

    const key = `${discardedEvent.playerId}:${rawCardId}`;
    if (discardedRegularCardKeys.has(key)) {
      claims.set(event, false);
      continue;
    }

    discardedRegularCardKeys.add(key);
    claims.set(event, true);
  }

  return claims;
}

function historicalLifecycleClaimsForView(
  events: readonly unknown[],
  gameId: string,
  playerIds: string[],
  expectedGameEndedWinners: string[] | undefined,
  terminalEra: GameState['era'] | undefined,
): {
  gameCreated: Map<Record<string, unknown>, boolean>;
  eraEnded: Map<Record<string, unknown>, boolean>;
  gameEnded: Map<Record<string, unknown>, boolean>;
} {
  const gameCreated = new Map<Record<string, unknown>, boolean>();
  const eraEnded = new Map<Record<string, unknown>, boolean>();
  const gameEnded = new Map<Record<string, unknown>, boolean>();
  let hasCreatedGame = false;
  const endedEras = new Set<string>();
  let hasEndedGame = false;
  let hasObservedTerminalEraEnd = terminalEra === undefined;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'game_created') {
      const createdEvent = projectGameCreatedEvent(event, gameId, playerIds);
      if (createdEvent === undefined || hasCreatedGame) {
        gameCreated.set(event, false);
        continue;
      }
      hasCreatedGame = true;
      gameCreated.set(event, true);
      continue;
    }

    if (event.type === 'era_ended') {
      const endedEvent = projectEraEndedEvent(event, playerIds);
      if (endedEvent === undefined || endedEras.has(endedEvent.era)) {
        eraEnded.set(event, false);
        continue;
      }
      endedEras.add(endedEvent.era);
      if (endedEvent.era === terminalEra) {
        hasObservedTerminalEraEnd = true;
      }
      eraEnded.set(event, true);
      continue;
    }

    if (event.type === 'game_ended') {
      const endedEvent = projectGameEndedEvent(event, playerIds, expectedGameEndedWinners);
      if (endedEvent === undefined || hasEndedGame || !hasObservedTerminalEraEnd) {
        gameEnded.set(event, false);
        continue;
      }
      hasEndedGame = true;
      gameEnded.set(event, true);
    }
  }

  return {gameCreated, eraEnded, gameEnded};
}

function eventsThroughTerminalLifecycle(
  events: readonly unknown[],
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalGameEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  terminalEra: GameState['era'] | undefined,
): readonly unknown[] {
  const projectedEvents: unknown[] = [];
  let waitingForGameEnd = false;
  for (const event of events) {
    if (waitingForGameEnd) {
      if (isRecord(event) && event.type === 'game_ended') {
        projectedEvents.push(event);
        if (historicalGameEndedClaims.get(event) === true) {
          break;
        }
      }
      continue;
    }

    projectedEvents.push(event);
    if (
      terminalEra !== undefined &&
      isRecord(event) &&
      event.type === 'era_ended' &&
      historicalEraEndedClaims.get(event) === true &&
      nonEmptyString(event.era) === terminalEra
    ) {
      waitingForGameEnd = true;
      continue;
    }
    if (isRecord(event) && event.type === 'game_ended' && historicalGameEndedClaims.get(event) === true) {
      break;
    }
  }
  return projectedEvents;
}

function historicalTurnAdvancedClaimsForView(
  events: readonly unknown[],
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const advancedTurnKeysThisEra = new Set<string>();
  let lastRoundNumber = 0;

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (
      event.type === 'era_ended' &&
      historicalEraEndedClaims.get(event) === true &&
      isValidCanalEraEndEventForClaims(event, playerIds)
    ) {
      advancedTurnKeysThisEra.clear();
      lastRoundNumber = 0;
      continue;
    }

    if (event.type !== 'turn_advanced') {
      continue;
    }

    const advancedEvent = projectTurnAdvancedEvent(event, playerIds);
    if (advancedEvent === undefined || advancedEvent.roundNumber < lastRoundNumber) {
      claims.set(event, false);
      continue;
    }

    const key = `${advancedEvent.roundNumber}:${advancedEvent.currentPlayerId}`;
    if (advancedTurnKeysThisEra.has(key)) {
      claims.set(event, false);
      continue;
    }

    lastRoundNumber = advancedEvent.roundNumber;
    advancedTurnKeysThisEra.add(key);
    claims.set(event, true);
  }

  return claims;
}

function loanIncomePenaltyMatchesRules(event: ProjectedIncomePositionChangedEvent): boolean {
  return event.reason === 'loan' &&
    event.to === retreatIncomeLevels(event.from, staticConfig.rules.loanIncomeLevelPenalty);
}

function rawLoanIncomePlayerId(event: Record<string, unknown>, playerIds: string[]): string | undefined {
  return publicEventReason(event.reason) === 'loan'
    ? playerIdField(event, 'playerId', playerIds)
    : undefined;
}

function isLoanCashChange(event: ProjectedCashChangedEvent): boolean {
  return event.reason === 'loan' && event.delta === staticConfig.rules.loanCash;
}

function historicalLoanValueChangeClaimsForView(
  events: readonly unknown[],
  hiddenDiscardIds: Map<string, Map<string, string>>,
  historicalCardDiscardClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingCash:
    | {event: Record<string, unknown>; change: ProjectedCashChangedEvent}
    | undefined;
  let pendingPair:
    | {
      cashEvent: Record<string, unknown>;
      incomeEvent: Record<string, unknown>;
      playerId: string;
      hasDiscard: boolean;
    }
    | undefined;

  const clearPendingLoanChanges = () => {
    pendingCash = undefined;
    pendingPair = undefined;
  };
  const rejectPendingLoanChanges = () => {
    if (pendingCash !== undefined) {
      claims.set(pendingCash.event, false);
    }
    if (pendingPair !== undefined) {
      claims.set(pendingPair.cashEvent, false);
      claims.set(pendingPair.incomeEvent, false);
    }
    clearPendingLoanChanges();
  };

  for (const event of events) {
    if (!isRecord(event)) {
      rejectPendingLoanChanges();
      continue;
    }

    if (event.type === 'cash_changed') {
      rejectPendingLoanChanges();
      const cashEvent = projectCashChangedEvent(event, playerIds);
      pendingCash = cashEvent !== undefined && isLoanCashChange(cashEvent)
        ? {event, change: cashEvent}
        : undefined;
      continue;
    }

    if (event.type === 'income_position_changed') {
      const incomeEvent = projectIncomePositionChangedEvent(event, playerIds);
      if (pendingCash === undefined) {
        if (incomeEvent !== undefined && incomeEvent.reason === 'loan') {
          claims.set(event, false);
        }
        rejectPendingLoanChanges();
        continue;
      }

      if (incomeEvent === undefined || incomeEvent.reason !== 'loan') {
        if (rawLoanIncomePlayerId(event, playerIds) === pendingCash.change.playerId) {
          claims.set(pendingCash.event, false);
          claims.set(event, false);
        }
        clearPendingLoanChanges();
        continue;
      }

      if (pendingCash.change.playerId !== incomeEvent.playerId || !loanIncomePenaltyMatchesRules(incomeEvent)) {
        claims.set(pendingCash.event, false);
        claims.set(event, false);
        clearPendingLoanChanges();
        continue;
      }

      pendingPair = {
        cashEvent: pendingCash.event,
        incomeEvent: event,
        playerId: incomeEvent.playerId,
        hasDiscard: false,
      };
      pendingCash = undefined;
      continue;
    }

    if (event.type === 'card_discarded') {
      const discardedEvent = projectCardDiscardedEvent(event, hiddenDiscardIds, playerIds, playerCount);
      if (
        pendingPair !== undefined &&
        !pendingPair.hasDiscard &&
        discardedEvent !== undefined &&
        historicalCardDiscardClaims.get(event) !== false &&
        discardedEvent.playerId === pendingPair.playerId
      ) {
        pendingPair = {...pendingPair, hasDiscard: true};
        continue;
      }
      rejectPendingLoanChanges();
      continue;
    }

    if (event.type === 'loan_taken') {
      if (pendingPair === undefined) {
        rejectPendingLoanChanges();
        continue;
      }

      const loanEvent = projectLoanTakenEvent(event, playerIds);
      if (loanEvent === undefined || loanEvent.playerId !== pendingPair.playerId || !pendingPair.hasDiscard) {
        claims.set(pendingPair.cashEvent, false);
        claims.set(pendingPair.incomeEvent, false);
      } else if (loanEvent !== undefined) {
        claims.set(pendingPair.cashEvent, true);
        claims.set(pendingPair.incomeEvent, true);
      }
      clearPendingLoanChanges();
      continue;
    }

    rejectPendingLoanChanges();
  }

  rejectPendingLoanChanges();
  return claims;
}

function historicalLoanTakenClaimsForView(
  events: readonly unknown[],
  historicalLoanValueChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  const pendingCashByPlayer = new Map<string, number>();
  const pendingLoanProofsByPlayer = new Map<string, number>();

  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    if (event.type === 'cash_changed') {
      const cashEvent = projectCashChangedEvent(event, playerIds);
      if (
        cashEvent !== undefined &&
        historicalLoanValueChangeClaims.get(event) !== false &&
        cashEvent.reason === 'loan' &&
        cashEvent.delta === staticConfig.rules.loanCash
      ) {
        pendingCashByPlayer.set(cashEvent.playerId, (pendingCashByPlayer.get(cashEvent.playerId) ?? 0) + 1);
      }
      continue;
    }

    if (event.type === 'income_position_changed') {
      const incomeEvent = projectIncomePositionChangedEvent(event, playerIds);
      if (
        incomeEvent !== undefined &&
        historicalLoanValueChangeClaims.get(event) !== false &&
        loanIncomePenaltyMatchesRules(incomeEvent)
      ) {
        const pendingCashCount = pendingCashByPlayer.get(incomeEvent.playerId) ?? 0;
        if (pendingCashCount > 0) {
          pendingCashByPlayer.set(incomeEvent.playerId, pendingCashCount - 1);
          pendingLoanProofsByPlayer.set(
            incomeEvent.playerId,
            (pendingLoanProofsByPlayer.get(incomeEvent.playerId) ?? 0) + 1,
          );
        }
      }
      continue;
    }

    if (event.type !== 'loan_taken') {
      continue;
    }

    const loanEvent = projectLoanTakenEvent(event, playerIds);
    if (loanEvent === undefined) {
      claims.set(event, false);
      continue;
    }

    const pendingLoanProofCount = pendingLoanProofsByPlayer.get(loanEvent.playerId) ?? 0;
    if (pendingLoanProofCount <= 0) {
      claims.set(event, false);
      continue;
    }

    pendingLoanProofsByPlayer.set(loanEvent.playerId, pendingLoanProofCount - 1);
    claims.set(event, true);
  }

  return claims;
}

function cardDiscardDestination(discardedEvent: ProjectedCardDiscardedEvent): 'discard' | 'wild_pool' {
  return 'destination' in discardedEvent ? discardedEvent.destination : 'discard';
}

function historicalScoutedClaimsForView(
  events: readonly unknown[],
  hiddenDiscardIds: Map<string, Map<string, string>>,
  historicalCardDiscardClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
  playerCount: GameState['playerCount'],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let consecutiveDiscards: ProjectedCardDiscardedEvent[] = [];

  for (const event of events) {
    if (!isRecord(event)) {
      consecutiveDiscards = [];
      continue;
    }

    if (event.type === 'card_discarded') {
      const discardedEvent = projectCardDiscardedEvent(event, hiddenDiscardIds, playerIds, playerCount);
      if (
        discardedEvent === undefined ||
        historicalCardDiscardClaims.get(event) === false ||
        cardDiscardDestination(discardedEvent) !== 'discard'
      ) {
        consecutiveDiscards = [];
        continue;
      }

      consecutiveDiscards = [...consecutiveDiscards, discardedEvent];
      continue;
    }

    if (event.type === 'scouted') {
      const scoutedEvent = projectScoutedEvent(event, playerIds);
      if (
        scoutedEvent === undefined ||
        consecutiveDiscards.length !== 3 ||
        !consecutiveDiscards.every((discardedEvent) => discardedEvent.playerId === scoutedEvent.playerId)
      ) {
        claims.set(event, false);
      } else {
        claims.set(event, true);
      }
      consecutiveDiscards = [];
      continue;
    }

    consecutiveDiscards = [];
  }

  return claims;
}

function historicalVictoryPointChangeClaimsForView(
  events: readonly unknown[],
  board: GameState['board'],
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  historicalLinkScoreValues: ReadonlyMap<string, number>,
  historicalIndustryScoreValues: ReadonlyMap<Record<string, unknown>, HistoricalIndustryScoreEntry>,
  historicalLinkScoreClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryScoreClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
): Map<Record<string, unknown>, boolean> {
  const claims = new Map<Record<string, unknown>, boolean>();
  let pendingScoringChange:
    | {event: Record<string, unknown>; change: ProjectedVictoryPointsChangedEvent}
    | undefined;
  const tentativeEraScoringChanges:
    Array<{event: Record<string, unknown>; change: ProjectedVictoryPointsChangedEvent}> = [];

  const rejectPendingScoringChange = () => {
    if (pendingScoringChange !== undefined) {
      claims.set(pendingScoringChange.event, false);
      pendingScoringChange = undefined;
    }
  };

  const rejectTentativeEraScoringChanges = () => {
    for (const tentative of tentativeEraScoringChanges.splice(0)) {
      claims.set(tentative.event, false);
    }
  };

  const resolveTentativeEraScoringChanges = (score: EraScoreBreakdown) => {
    const linkTotals = Object.fromEntries(playerIds.map((playerId) => [playerId, 0])) as Record<string, number>;
    const industryTotals = Object.fromEntries(playerIds.map((playerId) => [playerId, 0])) as Record<string, number>;
    let hasLinkScoring = false;
    let hasIndustryScoring = false;

    for (const tentative of tentativeEraScoringChanges) {
      if (tentative.change.reason === 'link scoring') {
        linkTotals[tentative.change.playerId] += tentative.change.delta;
        hasLinkScoring = true;
      } else if (tentative.change.reason === 'industry scoring') {
        industryTotals[tentative.change.playerId] += tentative.change.delta;
        hasIndustryScoring = true;
      }
    }

    const linkTotalsMatch = !hasLinkScoring ||
      playerIds.every((playerId) => linkTotals[playerId] === score.linkVictoryPointsByPlayer[playerId]);
    const industryTotalsMatch = !hasIndustryScoring ||
      playerIds.every((playerId) => industryTotals[playerId] === score.industryVictoryPointsByPlayer[playerId]);
    const totalsMatch = linkTotalsMatch && industryTotalsMatch;

    for (const tentative of tentativeEraScoringChanges.splice(0)) {
      claims.set(tentative.event, totalsMatch);
    }
  };

  for (const event of events) {
    if (!isRecord(event)) {
      rejectPendingScoringChange();
      continue;
    }

    if (event.type === 'victory_points_changed') {
      rejectPendingScoringChange();
      const changedEvent = projectVictoryPointsChangedEvent(event, playerIds);
      if (
        changedEvent !== undefined &&
        (changedEvent.reason === 'link scoring' || changedEvent.reason === 'industry scoring')
      ) {
        pendingScoringChange = {event, change: changedEvent};
      }
      continue;
    }

    if (event.type === 'link_scored') {
      if (pendingScoringChange?.change.reason !== 'link scoring') {
        rejectPendingScoringChange();
        continue;
      }
      const projectedScoredEvent = projectLinkScoredEvent(
        event,
        board,
        historicalLinkOwners,
        historicalLinkScoreValues,
        playerIds,
      );
      const rawScoredEvent = projectRawLinkScoredEvent(event, playerIds);
      if (rawScoredEvent === undefined || historicalLinkScoreClaims.get(event) === false) {
        if (hasGeneratedScoredInstanceId(event, 'link')) {
          rejectPendingScoringChange();
        } else {
          rejectPendingScoringChange();
        }
        continue;
      }
      const scoredEvent = projectedScoredEvent ?? rawScoredEvent;
      if (
        pendingScoringChange.change.playerId === scoredEvent.ownerPlayerId &&
        pendingScoringChange.change.delta === scoredEvent.points
      ) {
        if (projectedScoredEvent !== undefined || historicalLinkScoreClaims.get(event) === true) {
          claims.set(pendingScoringChange.event, true);
        } else {
          tentativeEraScoringChanges.push(pendingScoringChange);
        }
        pendingScoringChange = undefined;
        continue;
      }
      rejectPendingScoringChange();
      continue;
    }

    if (event.type === 'industry_scored') {
      if (pendingScoringChange?.change.reason !== 'industry scoring') {
        rejectPendingScoringChange();
        continue;
      }
      const projectedScoredEvent = projectIndustryScoredEvent(event, board, historicalIndustryScoreValues, playerIds);
      const rawScoredEvent = projectRawIndustryScoredEvent(event, playerIds);
      if (rawScoredEvent === undefined || historicalIndustryScoreClaims.get(event) === false) {
        if (hasGeneratedScoredInstanceId(event, 'industry')) {
          rejectPendingScoringChange();
        } else {
          rejectPendingScoringChange();
        }
        continue;
      }
      const scoredEvent = projectedScoredEvent ?? rawScoredEvent;
      if (
        pendingScoringChange.change.playerId === scoredEvent.ownerPlayerId &&
        pendingScoringChange.change.delta === scoredEvent.points
      ) {
        if (projectedScoredEvent !== undefined || historicalIndustryScoreClaims.get(event) === true) {
          claims.set(pendingScoringChange.event, true);
        } else {
          tentativeEraScoringChanges.push(pendingScoringChange);
        }
        pendingScoringChange = undefined;
        continue;
      }
      rejectPendingScoringChange();
      continue;
    }

    if (event.type === 'era_ended') {
      rejectPendingScoringChange();
      const score = projectEraScoreBreakdown(event.score, playerIds);
      if (score !== undefined && score.era === nonEmptyString(event.era)) {
        resolveTentativeEraScoringChanges(score);
      }
      continue;
    }

    rejectPendingScoringChange();
  }

  rejectPendingScoringChange();
  rejectTentativeEraScoringChanges();
  return claims;
}

function hasGeneratedScoredInstanceId(event: Record<string, unknown>, prefix: 'link' | 'industry'): boolean {
  const field = prefix === 'link' ? 'linkInstanceId' : 'industryInstanceId';
  return isGeneratedInstanceId(nonEmptyString(event[field]), prefix);
}

function projectRawLinkScoredEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedLinkScoredEvent | undefined {
  const linkInstanceId = nonEmptyString(event.linkInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  const points = nonNegativeIntegerField(event, 'points');
  return linkInstanceId !== undefined &&
    ownerPlayerId !== undefined &&
    points !== undefined
    ? {type: 'link_scored', linkInstanceId, ownerPlayerId, points}
    : undefined;
}

function projectRawIndustryScoredEvent(
  event: Record<string, unknown>,
  playerIds: string[],
): ProjectedIndustryScoredEvent | undefined {
  const industryInstanceId = nonEmptyString(event.industryInstanceId);
  const ownerPlayerId = playerIdField(event, 'ownerPlayerId', playerIds);
  const points = nonNegativeIntegerField(event, 'points');
  return industryInstanceId !== undefined &&
    ownerPlayerId !== undefined &&
    points !== undefined
    ? {type: 'industry_scored', industryInstanceId, ownerPlayerId, points}
    : undefined;
}

function projectKnownGameEvent(
  event: unknown,
  gameId: string,
  board: GameState['board'],
  hiddenDiscardIds: Map<string, Map<string, string>>,
  historicalCardDiscardClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalGameCreatedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalEraEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalGameEndedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLinkOwners: ReadonlyMap<string, HistoricalLinkReferenceEntry>,
  historicalLinkScoreValues: ReadonlyMap<string, number>,
  historicalIndustryScoreValues: ReadonlyMap<Record<string, unknown>, HistoricalIndustryScoreEntry>,
  historicalLinkScoreClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryScoreClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryBuildClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryRemovalClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryFlipClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustryFlipIncomeChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalIndustrySaleClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalResourceConsumptionClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalResourceSoldToMarketClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalMarketSaleCashClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalActionSpendCashClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalRoundIncomeCashClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLinkBuildClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalMerchantBonusClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalMerchantBonusValueChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLoanValueChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalNegativeIncomeLiquidationCashClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalMerchantDevelopResolutions: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalNegativeIncomeShortfallClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalNegativeIncomeStarts: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalNegativeIncomeResolutions: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalTurnAdvancedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalLoanTakenClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalScoutedClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  historicalVictoryPointChangeClaims: ReadonlyMap<Record<string, unknown>, boolean>,
  playerIds: string[],
  turnOrder: string[],
  playerCount: GameState['playerCount'],
  expectedGameEndedWinners: string[] | undefined,
): GameEvent | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  switch (event.type) {
    case 'game_created': {
      const createdEvent = projectGameCreatedEvent(event, gameId, playerIds);
      return createdEvent === undefined || historicalGameCreatedClaims.get(event) === false
        ? undefined
        : createdEvent;
    }
    case 'card_discarded': {
      const discardedEvent = projectCardDiscardedEvent(event, hiddenDiscardIds, playerIds, playerCount);
      return discardedEvent === undefined || historicalCardDiscardClaims.get(event) === false
        ? undefined
        : discardedEvent as GameEvent;
    }
    case 'cash_changed': {
      const cashEvent = projectCashChangedEvent(event, playerIds);
      return cashEvent === undefined ||
        historicalMarketSaleCashClaims.get(event) === false ||
        (
          isActionSpendReason(cashEvent.reason) &&
          historicalActionSpendCashClaims.get(event) !== true
        ) ||
        historicalRoundIncomeCashClaims.get(event) === false ||
        (
          cashEvent.reason === 'merchant bonus' &&
          historicalMerchantBonusValueChangeClaims.get(event) !== true
        ) ||
        historicalLoanValueChangeClaims.get(event) === false ||
        historicalNegativeIncomeLiquidationCashClaims.get(event) === false
        ? undefined
        : cashEvent;
    }
    case 'income_position_changed': {
      const incomeEvent = projectIncomePositionChangedEvent(event, playerIds);
      return incomeEvent === undefined ||
        (
          incomeEvent.reason === 'merchant bonus' &&
          historicalMerchantBonusValueChangeClaims.get(event) !== true
        ) ||
        (
          industryFlipIncomeReason(incomeEvent.reason) !== undefined &&
          historicalIndustryFlipIncomeChangeClaims.get(event) !== true
        ) ||
        historicalLoanValueChangeClaims.get(event) === false
        ? undefined
        : incomeEvent;
    }
    case 'industry_built': {
      const builtEvent = projectIndustryBuiltEvent(event, board, playerIds);
      return builtEvent === undefined || historicalIndustryBuildClaims.get(event) === false
        ? undefined
        : builtEvent;
    }
    case 'industry_removed': {
      const removedEvent = projectIndustryRemovedEvent(event, board);
      return removedEvent === undefined || historicalIndustryRemovalClaims.get(event) === false
        ? undefined
        : removedEvent;
    }
    case 'industry_flipped': {
      const flippedEvent = projectIndustryFlippedEvent(event, board, playerIds);
      return flippedEvent === undefined || historicalIndustryFlipClaims.get(event) === false
        ? undefined
        : flippedEvent;
    }
    case 'industry_sold': {
      const soldEvent = projectIndustrySoldEvent(event, board, playerIds);
      return soldEvent === undefined || historicalIndustrySaleClaims.get(event) === false
        ? undefined
        : soldEvent;
    }
    case 'resource_consumed': {
      const consumedEvent = projectResourceConsumedEvent(event, board, playerIds);
      return consumedEvent === undefined || historicalResourceConsumptionClaims.get(event) === false
        ? undefined
        : consumedEvent;
    }
    case 'resource_sold_to_market': {
      const soldEvent = projectResourceSoldToMarketEvent(event, board);
      return soldEvent === undefined || historicalResourceSoldToMarketClaims.get(event) === false
        ? undefined
        : soldEvent;
    }
    case 'link_built': {
      const builtEvent = projectLinkBuiltEvent(event, board, playerIds, playerCount);
      return builtEvent === undefined || historicalLinkBuildClaims.get(event) === false
        ? undefined
        : builtEvent;
    }
    case 'link_scored': {
      const scoredEvent = projectLinkScoredEvent(event, board, historicalLinkOwners, historicalLinkScoreValues, playerIds);
      return scoredEvent === undefined || historicalLinkScoreClaims.get(event) === false
        ? undefined
        : scoredEvent;
    }
    case 'industry_scored': {
      const scoredEvent = projectIndustryScoredEvent(event, board, historicalIndustryScoreValues, playerIds);
      return scoredEvent === undefined || historicalIndustryScoreClaims.get(event) === false
        ? undefined
        : scoredEvent;
    }
    case 'merchant_bonus_claimed': {
      const claimedEvent = projectMerchantBonusClaimedEvent(event, board, playerIds);
      return claimedEvent === undefined || historicalMerchantBonusClaims.get(event) === false
        ? undefined
        : claimedEvent;
    }
    case 'merchant_develop_resolved': {
      const resolvedEvent = projectMerchantDevelopResolvedEvent(event, board, playerIds);
      return resolvedEvent === undefined || historicalMerchantDevelopResolutions.get(event) === false
        ? undefined
        : resolvedEvent;
    }
    case 'turn_advanced': {
      const advancedEvent = projectTurnAdvancedEvent(event, playerIds);
      return advancedEvent === undefined || historicalTurnAdvancedClaims.get(event) === false
        ? undefined
        : advancedEvent;
    }
    case 'turn_order_updated': {
      const order = playerIdArray(event.order, playerIds);
      return isCompletePlayerOrder(order, playerIds) ? {type: 'turn_order_updated', order} : undefined;
    }
    case 'negative_income_started': {
      const startedEvent = projectNegativeIncomeStartedEvent(event, playerIds, turnOrder);
      return startedEvent === undefined || historicalNegativeIncomeStarts.get(event) !== true
        ? undefined
        : startedEvent;
    }
    case 'negative_income_resolved': {
      const resolvedEvent = projectNegativeIncomeResolvedEvent(event, board, playerIds);
      return resolvedEvent === undefined || historicalNegativeIncomeResolutions.get(event) !== true
        ? undefined
        : resolvedEvent;
    }
    case 'victory_points_changed': {
      const changedEvent = projectVictoryPointsChangedEvent(event, playerIds);
      return changedEvent === undefined ||
        (
          changedEvent.reason === 'merchant bonus' &&
          historicalMerchantBonusValueChangeClaims.get(event) !== true
        ) ||
        (
          changedEvent.reason === 'negative income shortfall' &&
          historicalNegativeIncomeShortfallClaims.get(event) !== true
        ) ||
        (
          (changedEvent.reason === 'link scoring' || changedEvent.reason === 'industry scoring') &&
          historicalVictoryPointChangeClaims.get(event) !== true
        )
        ? undefined
        : changedEvent;
    }
    case 'era_ended': {
      const endedEvent = projectEraEndedEvent(event, playerIds);
      return endedEvent === undefined || historicalEraEndedClaims.get(event) === false
        ? undefined
        : endedEvent;
    }
    case 'game_ended': {
      const endedEvent = projectGameEndedEvent(event, playerIds, expectedGameEndedWinners);
      return endedEvent === undefined || historicalGameEndedClaims.get(event) === false
        ? undefined
        : endedEvent;
    }
    case 'loan_taken': {
      const loanEvent = projectLoanTakenEvent(event, playerIds);
      return loanEvent === undefined || historicalLoanTakenClaims.get(event) === false
        ? undefined
        : loanEvent;
    }
    case 'scouted': {
      const scoutedEvent = projectScoutedEvent(event, playerIds);
      return scoutedEvent === undefined || historicalScoutedClaims.get(event) === false
        ? undefined
        : scoutedEvent;
    }
    default:
      return undefined;
  }
}

function eventLogForView(
  game: GameState,
  playerIds = Object.keys(game.players),
  playerCount = projectPlayerCount(game.playerCount, playerIds),
  board = projectBoardState(game.board, playerIds, playerCount),
  players = projectPlayers(game.players, playerCount),
  turnOrder = projectTurnOrder(game.turnOrder, playerIds),
  status: GameState['status'] = isOneOf(game.status, GAME_STATUSES) ? game.status : 'playing',
): GameEvent[] {
  const hiddenDiscardIds = hiddenFaceDownDiscardIds(game, playerIds, playerCount);
  const expectedGameEndedWinners = status === 'ended'
    ? determineWinners({players} as GameState)
    : undefined;
  const terminalEra = status === 'ended'
    ? game.variant === 'introductory_canal_only' ? 'canal' : 'rail'
    : undefined;
  const historicalLifecycleClaims = historicalLifecycleClaimsForView(
    game.eventLog,
    game.id,
    playerIds,
    expectedGameEndedWinners,
    terminalEra,
  );
  const visibleEventLog = eventsThroughTerminalLifecycle(
    game.eventLog,
    historicalLifecycleClaims.eraEnded,
    historicalLifecycleClaims.gameEnded,
    terminalEra,
  );
  const historicalCardDiscardClaims = historicalCardDiscardClaimsForView(
    visibleEventLog,
    hiddenDiscardIds,
    historicalLifecycleClaims.eraEnded,
    playerIds,
    playerCount,
  );
  const historicalTurnAdvancedClaims = historicalTurnAdvancedClaimsForView(
    visibleEventLog,
    historicalLifecycleClaims.eraEnded,
    playerIds,
  );
  const historicalLoanValueChangeClaims = historicalLoanValueChangeClaimsForView(
    visibleEventLog,
    hiddenDiscardIds,
    historicalCardDiscardClaims,
    playerIds,
    playerCount,
  );
  const historicalLoanTakenClaims = historicalLoanTakenClaimsForView(
    visibleEventLog,
    historicalLoanValueChangeClaims,
    playerIds,
  );
  const historicalScoutedClaims = historicalScoutedClaimsForView(
    visibleEventLog,
    hiddenDiscardIds,
    historicalCardDiscardClaims,
    playerIds,
    playerCount,
  );
  const historicalLinkOwners = historicalLinkOwnersForView(visibleEventLog, playerIds, playerCount);
  const historicalLinkScoreValues = historicalLinkScoreValuesForView(visibleEventLog, board, historicalLinkOwners, playerIds);
  const historicalIndustryScoreValues = historicalIndustryScoreValuesForView(visibleEventLog, board, playerIds);
  const historicalScoringClaims = historicalScoringClaimsForView(
    visibleEventLog,
    board,
    historicalLinkOwners,
    historicalLinkScoreValues,
    historicalIndustryScoreValues,
    historicalLifecycleClaims.eraEnded,
    playerIds,
  );
  const historicalVictoryPointChangeClaims = historicalVictoryPointChangeClaimsForView(
    visibleEventLog,
    board,
    historicalLinkOwners,
    historicalLinkScoreValues,
    historicalIndustryScoreValues,
    historicalScoringClaims.links,
    historicalScoringClaims.industries,
    playerIds,
  );
  const historicalIndustryBuildClaims = historicalIndustryBuildClaimsForView(visibleEventLog, board, playerIds);
  const historicalIndustryRemovalClaims = historicalIndustryRemovalClaimsForView(visibleEventLog, board);
  const historicalNegativeIncomeLiquidationCashClaims = historicalNegativeIncomeLiquidationCashClaimsForView(
    visibleEventLog,
    game.board,
    playerIds,
  );
  const historicalIndustryFlipClaims = historicalIndustryFlipClaimsForView(visibleEventLog, board, playerIds);
  const historicalIndustryFlipIncomeChangeClaims = historicalIndustryFlipIncomeChangeClaimsForView(
    visibleEventLog,
    board,
    historicalIndustryFlipClaims,
    playerIds,
  );
  const historicalIndustrySaleClaims = historicalIndustrySaleClaimsForView(
    visibleEventLog,
    board,
    historicalIndustryFlipClaims,
    playerIds,
  );
  const historicalResourceConsumptionClaims = historicalResourceConsumptionClaimsForView(
    visibleEventLog,
    board,
    historicalLifecycleClaims.eraEnded,
    playerIds,
  );
  const historicalResourceSoldToMarketClaims = historicalResourceSoldToMarketClaimsForView(visibleEventLog, board);
  const historicalMarketSaleCashClaims = historicalMarketSaleCashClaimsForView(
    visibleEventLog,
    board,
    historicalResourceSoldToMarketClaims,
    playerIds,
  );
  const historicalLinkBuildClaims = historicalLinkBuildClaimsForView(visibleEventLog, board, playerIds, playerCount);
  const historicalActionSpendCashClaims = historicalActionSpendCashClaimsForView(
    visibleEventLog,
    board,
    historicalResourceConsumptionClaims,
    historicalIndustryBuildClaims,
    historicalLinkBuildClaims,
    playerIds,
    playerCount,
  );
  const historicalMerchantBonusClaims = historicalMerchantBonusClaimsForView(
    visibleEventLog,
    board,
    historicalResourceConsumptionClaims,
    historicalLifecycleClaims.eraEnded,
    playerIds,
  );
  const historicalMerchantBonusValueChangeClaims = historicalMerchantBonusValueChangeClaimsForView(
    visibleEventLog,
    board,
    historicalMerchantBonusClaims,
    playerIds,
  );
  const historicalMerchantDevelopResolutions = historicalMerchantDevelopResolutionsForView(
    visibleEventLog,
    board,
    players,
    historicalMerchantBonusClaims,
    historicalLifecycleClaims.eraEnded,
    playerIds,
  );
  const historicalNegativeIncomeClaims = historicalNegativeIncomeClaimsForView(
    visibleEventLog,
    board,
    playerIds,
    turnOrder,
  );
  const historicalNegativeIncomeShortfallClaims = historicalNegativeIncomeShortfallClaimsForView(
    visibleEventLog,
    board,
    historicalNegativeIncomeClaims.resolutions,
    playerIds,
  );
  const historicalRoundIncomeCashClaims = historicalRoundIncomeCashClaimsForView(
    visibleEventLog,
    board,
    historicalMerchantBonusValueChangeClaims,
    historicalIndustryFlipIncomeChangeClaims,
    historicalLoanValueChangeClaims,
    historicalNegativeIncomeClaims.resolutions,
    playerIds,
  );
  return visibleEventLog.flatMap((event) => {
    const projectedEvent = projectKnownGameEvent(
      event,
      game.id,
      board,
      hiddenDiscardIds,
      historicalCardDiscardClaims,
      historicalLifecycleClaims.gameCreated,
      historicalLifecycleClaims.eraEnded,
      historicalLifecycleClaims.gameEnded,
      historicalLinkOwners,
      historicalLinkScoreValues,
      historicalIndustryScoreValues,
      historicalScoringClaims.links,
      historicalScoringClaims.industries,
      historicalIndustryBuildClaims,
      historicalIndustryRemovalClaims,
      historicalIndustryFlipClaims,
      historicalIndustryFlipIncomeChangeClaims,
      historicalIndustrySaleClaims,
      historicalResourceConsumptionClaims,
      historicalResourceSoldToMarketClaims,
      historicalMarketSaleCashClaims,
      historicalActionSpendCashClaims,
      historicalRoundIncomeCashClaims,
      historicalLinkBuildClaims,
      historicalMerchantBonusClaims,
      historicalMerchantBonusValueChangeClaims,
      historicalLoanValueChangeClaims,
      historicalNegativeIncomeLiquidationCashClaims,
      historicalMerchantDevelopResolutions,
      historicalNegativeIncomeShortfallClaims,
      historicalNegativeIncomeClaims.starts,
      historicalNegativeIncomeClaims.resolutions,
      historicalTurnAdvancedClaims,
      historicalLoanTakenClaims,
      historicalScoutedClaims,
      historicalVictoryPointChangeClaims,
      playerIds,
      turnOrder,
      playerCount,
      expectedGameEndedWinners,
    );
    return projectedEvent === undefined ? [] : [structuredClone(projectedEvent) as GameEvent];
  });
}

function cloneKnownGameState(game: GameState): GameState {
  const playerIds = projectPlayerIdsForDeclaredCount(game.players, declaredPlayerCount(game.playerCount));
  const playerCount = projectPlayerCount(game.playerCount, playerIds);
  const players = projectPlayers(game.players, playerCount, playerIds);
  const era: GameState['era'] = isOneOf(game.era, ERAS) ? game.era : 'canal';
  const status: GameState['status'] = isOneOf(game.status, GAME_STATUSES) ? game.status : 'playing';
  const roundNumber = projectRoundNumber(game.roundNumber);
  const turnOrder = projectTurnOrder(game.turnOrder, playerIds);
  const actionsAllowedThisTurn = projectActionsAllowedThisTurn(game.actionsAllowedThisTurn, era, roundNumber);
  const variant = game.variant === 'introductory_canal_only' && era === 'canal'
    ? 'introductory_canal_only' as const
    : undefined;
  const board = projectBoardState(game.board, playerIds, playerCount);
  projectBuiltIndustryReferences(players, board);
  projectCurrentEraRemainingLinks(players, board, era, status);
  const pendingDecision = status === 'playing'
    ? projectPendingDecision(game.pendingDecision, game, playerIds, turnOrder, board)
    : undefined;
  const lastEraScore = projectEraScoreBreakdown(game.lastEraScore, playerIds);
  const knownState: GameState = {
    id: publicGameId(game.id),
    playerCount,
    era,
    roundNumber,
    turnOrder,
    currentTurnIndex: projectCurrentTurnIndex(game.currentTurnIndex, game.turnOrder, turnOrder, playerIds),
    actionIndexInTurn: projectActionIndexInTurn(game.actionIndexInTurn, actionsAllowedThisTurn),
    actionsAllowedThisTurn,
    players,
    board,
    cardZones: projectCardZones(game.cardZones, playerCount),
    markets: projectMarkets(game.markets),
    eventLog: eventLogForView(game, playerIds, playerCount, board, players, turnOrder, status),
    nextInstanceId: projectNextInstanceId(game.nextInstanceId),
    status,
    ...(variant ? {variant} : {}),
    ...(pendingDecision ? {pendingDecision} : {}),
    ...(lastEraScore ? {lastEraScore} : {}),
  };
  return structuredClone(knownState) as GameState;
}

export function gameStateForPlayer(game: GameState, playerId?: string): GameState {
  const view = cloneKnownGameState(game);
  for (const [id, player] of Object.entries(view.players)) {
    player.handCardIds = id === playerId ? [...player.handCardIds] : hiddenCardIds(player.handCardIds.length);
    player.discardCardIds = discardCardIdsForView(player, view.playerCount);
  }
  view.cardZones.drawDeck = hiddenCardIds(view.cardZones.drawDeck.length);
  return view;
}

function joinGameRoom(socket: ServerSocket, gameId: string, playerId?: string): void {
  const previousGameId = optionalString(socket.data.gameId);
  if (previousGameId && previousGameId !== gameId) {
    socket.leave(previousGameId);
  }
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;
  socket.join(gameId);
}

function leaveGameRoom(socket: ServerSocket): void {
  const previousGameId = optionalString(socket.data.gameId);
  if (previousGameId) {
    socket.leave(previousGameId);
  }
  delete socket.data.gameId;
  delete socket.data.playerId;
}

function publicStaticConfig() {
  return JSON.parse(JSON.stringify(staticConfig)) as typeof staticConfig;
}

function publicFaceAuditChecklist() {
  return JSON.parse(JSON.stringify(buildFaceAuditChecklistExport())) as ReturnType<typeof buildFaceAuditChecklistExport>;
}

function publicFaceAuditReviewTemplate() {
  return JSON.parse(JSON.stringify(buildFaceAuditReviewTemplate())) as ReturnType<typeof buildFaceAuditReviewTemplate>;
}

function publicFaceAuditAreaReviewTemplate(area: FaceAuditArea) {
  return JSON.parse(JSON.stringify(buildFaceAuditAreaReviewTemplate(area))) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;
}

function publicFaceAuditReviewTodoSummary() {
  const todo = buildFaceAuditReviewTodo([]);
  return JSON.parse(JSON.stringify(buildFaceAuditReviewTodoSummary(todo))) as ReturnType<typeof buildFaceAuditReviewTodoSummary>;
}

function publicFaceAuditAreaReviewTodoSummary(area: FaceAuditArea) {
  return JSON.parse(JSON.stringify(buildFaceAuditAreaReviewTodoSummary([], area))) as ReturnType<typeof buildFaceAuditAreaReviewTodoSummary>;
}

function sendFaceAuditReviewSheet(
  res: Response,
  report: ReturnType<typeof buildFaceAuditReviewSheet>,
): void {
  res.setHeader('Content-Disposition', 'attachment; filename="face-audit-review-sheet.tsv"');
  res.setHeader('X-Face-Audit-Checklist-Fingerprint', report.checklistFingerprint);
  res.setHeader('X-Face-Audit-Review-Fingerprint', report.reviewFingerprint);
  res.setHeader('X-Face-Audit-Row-Count', String(report.rowCount));
  res.type('text/tab-separated-values').send(report.tsv);
}

function sendFaceAuditAreaReviewSheet(
  res: Response,
  report: ReturnType<typeof buildFaceAuditAreaReviewSheet>,
): void {
  res.setHeader('Content-Disposition', `attachment; filename="${faceAuditAreaReviewSheetArtifactFileName(report.area)}"`);
  res.setHeader('X-Face-Audit-Checklist-Fingerprint', report.checklistFingerprint);
  res.setHeader('X-Face-Audit-Review-Fingerprint', report.reviewFingerprint);
  res.setHeader('X-Face-Audit-Area', report.area);
  res.setHeader('X-Face-Audit-Row-Count', String(report.rowCount));
  res.setHeader('X-Face-Audit-Area-Item-Count', String(report.areaItemCount));
  res.type('text/tab-separated-values').send(report.tsv);
}

function faceAuditReviewerInstructionsReport(artifacts: readonly unknown[]) {
  const status = summarizeFaceAuditReviewStatus(artifacts);
  const todo = buildFaceAuditReviewTodo(artifacts);
  const plan = buildFaceAuditReviewPlan(artifacts);
  const handoff = buildFaceAuditReviewerHandoff(artifacts);
  const markdown = buildFaceAuditReviewerInstructions({
    status,
    todo,
    plan,
    handoff,
    areaFiles: handoff.areas.map((area) => ({
      area: area.area,
      fileName: faceAuditAreaReviewArtifactFileName(area.area),
    })),
  });
  const issues = [
    ...status.issues,
    ...todo.issues,
    ...plan.issues,
    ...handoff.issues,
  ];

  return {
    ok: status.ok && todo.ok && plan.ok && handoff.ok,
    checklistFingerprint: status.checklistFingerprint,
    reviewFingerprint: status.reviewFingerprint,
    markdown,
    issueCount: issues.length,
    issues,
  };
}

function sendFaceAuditReviewerInstructions(
  res: Response,
  report: ReturnType<typeof faceAuditReviewerInstructionsReport>,
): void {
  res.setHeader('Content-Disposition', 'attachment; filename="face-audit-reviewer-instructions.md"');
  res.setHeader('X-Face-Audit-Checklist-Fingerprint', report.checklistFingerprint);
  res.setHeader('X-Face-Audit-Review-Fingerprint', report.reviewFingerprint);
  res.type('text/markdown').send(`${report.markdown}\n`);
}

function sendFaceAuditAreaReviewerInstructions(
  res: Response,
  report: ReturnType<typeof buildFaceAuditAreaReviewerInstructionsReport>,
): void {
  res.setHeader('Content-Disposition', `attachment; filename="${faceAuditAreaReviewerInstructionsArtifactFileName(report.area)}"`);
  res.setHeader('X-Face-Audit-Checklist-Fingerprint', report.checklistFingerprint);
  res.setHeader('X-Face-Audit-Review-Fingerprint', report.reviewFingerprint);
  res.setHeader('X-Face-Audit-Area', report.area);
  res.type('text/markdown').send(`${report.markdown}\n`);
}

function faceAuditReviewArtifactsFromPayload(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload) && Array.isArray(payload.artifacts)) {
    return payload.artifacts;
  }
  return undefined;
}

function faceAuditReviewSheetImportFromPayload(
  payload: unknown,
): {artifacts: unknown[]; reviewSheetTsv: string} | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.artifacts) || typeof payload.reviewSheetTsv !== 'string') {
    return undefined;
  }
  return {
    artifacts: payload.artifacts,
    reviewSheetTsv: payload.reviewSheetTsv,
  };
}

function faceAuditHandoffResponseFromPayload(
  payload: unknown,
): {handoff: unknown; artifacts: unknown[]} | undefined {
  if (!isRecord(payload) || !('handoff' in payload) || !Array.isArray(payload.artifacts)) {
    return undefined;
  }
  return {
    handoff: payload.handoff,
    artifacts: payload.artifacts,
  };
}

function faceAuditReleaseGateLockArtifactFromPayload(payload: unknown): unknown | undefined {
  if (payload === undefined) {
    return undefined;
  }
  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'lockArtifact')) {
    return payload.lockArtifact;
  }
  if (isRecord(payload) && Object.keys(payload).length === 0) {
    return undefined;
  }
  return payload;
}

function faceAuditMatchTemplatePayloadFromPayload(payload: unknown): {
  sourceArtifact: unknown;
  sourceId: string;
  sourceIdsByArea?: unknown;
  reviewer: string;
  reviewedAt: string;
  mode: FaceAuditEvidenceRefMode;
} {
  const source = isRecord(payload) ? payload : {};
  const rawMode = Object.prototype.hasOwnProperty.call(source, 'mode') ? source.mode : 'area';
  return {
    sourceArtifact: Object.prototype.hasOwnProperty.call(source, 'sourceArtifact')
      ? source.sourceArtifact
      : payload,
    sourceId: nonEmptyString(source.sourceId) ?? '',
    sourceIdsByArea: Object.prototype.hasOwnProperty.call(source, 'sourceIdsByArea')
      ? source.sourceIdsByArea
      : undefined,
    reviewer: nonEmptyString(source.reviewer) ?? '',
    reviewedAt: nonEmptyString(source.reviewedAt) ?? '',
    mode: (parseFaceAuditEvidenceRefMode(rawMode) ?? rawMode) as FaceAuditEvidenceRefMode,
  };
}

function faceAuditSourceIdsByAreaTemplatePayloadFromPayload(payload: unknown): {
  sourceArtifact: unknown;
  defaultSourceId: string;
  overrides: unknown;
} {
  const source = isRecord(payload) ? payload : {};
  const overrides = Object.prototype.hasOwnProperty.call(source, 'sourceIdsByArea')
    ? source.sourceIdsByArea
    : Object.prototype.hasOwnProperty.call(source, 'overrides')
      ? source.overrides
      : {};
  return {
    sourceArtifact: Object.prototype.hasOwnProperty.call(source, 'sourceArtifact')
      ? source.sourceArtifact
      : payload,
    defaultSourceId: nonEmptyString(source.defaultSourceId) ?? '',
    overrides,
  };
}

function connectedPlayerIdsForGame(io: SocketIOServer, game: GameSummary): string[] {
  const room = io.sockets.adapter.rooms.get(game.id);
  if (!room) {
    return [];
  }

  const activeSeats = new Set(PUBLIC_PLAYER_IDS.slice(0, game.playerCount));
  const connectedPlayerIds = new Set<string>();
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    const playerId = optionalString(socket?.data.playerId);
    if (playerId && activeSeats.has(playerId as typeof PUBLIC_PLAYER_IDS[number])) {
      connectedPlayerIds.add(playerId);
    }
  }
  return PUBLIC_PLAYER_IDS.filter((playerId) => connectedPlayerIds.has(playerId));
}

function publicGameList(io: SocketIOServer, store: GameStore) {
  return {
    games: store.list().map((game) => {
      const connectedPlayerIds = connectedPlayerIdsForGame(io, game);
      return {
        ...game,
        connectedClientCount: io.sockets.adapter.rooms.get(game.id)?.size ?? 0,
        ...(connectedPlayerIds.length > 0 ? {connectedPlayerIds} : {}),
      };
    }),
  };
}

function broadcastGameList(io: SocketIOServer, store: GameStore): void {
  io.emit('games:list', publicGameList(io, store));
}

export function createBrassServer(options: BrassServerOptions): BrassServer {
  const {store, clientDist} = options;
  const app = express();
  const server = createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  app.use((req, res, next) => {
    applyCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({strict: false}));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!isJsonParseError(error)) {
      next(error);
      return;
    }
    res.status(400).json({errors: ['Malformed JSON body']});
  });

  const officialGameImagesDir = path.join(process.cwd(), 'mods', 'OfficialGameImages');
  if (fs.existsSync(officialGameImagesDir)) {
    app.use('/official-game-images', express.static(officialGameImagesDir));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ok: true});
  });

  app.get('/api/static-config', (_req, res) => {
    res.json({config: publicStaticConfig()});
  });

  app.get('/api/face-audit-checklist', (_req, res) => {
    res.json({faceAudit: publicFaceAuditChecklist()});
  });

  app.get('/api/face-audit-review-template', (_req, res) => {
    res.json({faceAuditReview: publicFaceAuditReviewTemplate()});
  });

  app.get('/api/face-audit-review-template/todo-summary', (_req, res) => {
    res.json({faceAuditReviewTodoSummary: publicFaceAuditReviewTodoSummary()});
  });

  app.get('/api/face-audit-review-template/:area/todo-summary', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    res.json({faceAuditAreaReviewTodoSummary: publicFaceAuditAreaReviewTodoSummary(area)});
  });

  app.get('/api/face-audit-review-template/status', (_req, res) => {
    res.json({faceAuditReviewStatus: summarizeFaceAuditReviewStatus([])});
  });

  app.get('/api/face-audit-review-template/todo', (_req, res) => {
    res.json({faceAuditReviewTodo: buildFaceAuditReviewTodo([])});
  });

  app.get('/api/face-audit-review-template/review-sheet', (_req, res) => {
    sendFaceAuditReviewSheet(res, buildFaceAuditReviewSheet([]));
  });

  app.get('/api/face-audit-review-template/:area/review-sheet', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    sendFaceAuditAreaReviewSheet(res, buildFaceAuditAreaReviewSheet([], area));
  });

  app.get('/api/face-audit-review-template/review-plan', (_req, res) => {
    res.json({faceAuditReviewPlan: buildFaceAuditReviewPlan([])});
  });

  app.get('/api/face-audit-review-template/reviewer-instructions', (_req, res) => {
    sendFaceAuditReviewerInstructions(res, faceAuditReviewerInstructionsReport([]));
  });

  app.get('/api/face-audit-review-template/:area/reviewer-instructions', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    sendFaceAuditAreaReviewerInstructions(res, buildFaceAuditAreaReviewerInstructionsReport([], area));
  });

  app.get('/api/face-audit-review-template/handoff', (_req, res) => {
    res.json({faceAuditReviewerHandoff: buildFaceAuditReviewerHandoff([])});
  });

  app.get('/api/face-audit-review-template/:area', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    res.json({faceAuditAreaReview: publicFaceAuditAreaReviewTemplate(area)});
  });

  app.post('/api/face-audit-evidence-ref-template', (req, res) => {
    const payload = isRecord(req.body) ? req.body : {};
    const sourceId = nonEmptyString(payload.sourceId) ?? '';
    const area = parseFaceAuditArea(payload.area);
    const mode = parseFaceAuditEvidenceRefMode(payload.mode ?? 'area');
    const issues: Array<{field: string; message: string}> = [];
    if (!validFaceAuditEvidenceSourceId(sourceId)) {
      issues.push({
        field: 'sourceId',
        message: 'Face-audit evidence ref template source id must match the evidenceRef source id format',
      });
    }
    if (!area) {
      issues.push({
        field: 'area',
        message: 'Face-audit evidence ref template area must be a known face-audit area',
      });
    }
    if (!mode) {
      issues.push({
        field: 'mode',
        message: 'Face-audit evidence ref template mode must be area or items',
      });
    }
    if (issues.length > 0 || !area || !mode) {
      res.status(422).json({faceAuditEvidenceRefTemplateValidation: {
        ok: false,
        issueCount: issues.length,
        issues,
      }});
      return;
    }
    res.json({faceAuditEvidenceRefTemplate: buildFaceAuditEvidenceRefTemplate(sourceId, area, mode)});
  });

  app.post('/api/face-audit-source-ids-by-area-template', (req, res) => {
    const payload = faceAuditSourceIdsByAreaTemplatePayloadFromPayload(req.body);
    const validation = buildFaceAuditSourceIdsByAreaTemplate(
      payload.sourceArtifact,
      payload.defaultSourceId,
      payload.overrides,
    );
    res.status(validation.ok ? 200 : 422).json(validation.ok
      ? {
          faceAuditSourceIdsByArea: validation.sourceIdsByArea,
          faceAuditSourceIdsByAreaTemplateValidation: validation,
        }
      : {faceAuditSourceIdsByAreaTemplateValidation: validation});
  });

  app.post('/api/face-audit-review-template/match', (req, res) => {
    const payload = faceAuditMatchTemplatePayloadFromPayload(req.body);
    const validation = payload.sourceIdsByArea === undefined
      ? buildFaceAuditMatchReviewArtifact(
          payload.sourceArtifact,
          payload.sourceId,
          payload.reviewer,
          payload.reviewedAt,
          payload.mode,
        )
      : buildFaceAuditMappedMatchReviewArtifact(
          payload.sourceArtifact,
          payload.sourceIdsByArea,
          payload.reviewer,
          payload.reviewedAt,
          payload.mode,
        );
    res.status(validation.ok ? 200 : 422).json(validation.ok
      ? {faceAuditReview: validation.review, faceAuditReviewValidation: validation}
      : {faceAuditReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/:area/match', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    const payload = faceAuditMatchTemplatePayloadFromPayload(req.body);
    const validation = buildFaceAuditAreaMatchReviewArtifact(
      area,
      payload.sourceArtifact,
      payload.sourceId,
      payload.reviewer,
      payload.reviewedAt,
      payload.mode,
    );
    res.status(validation.ok ? 200 : 422).json(validation.ok
      ? {faceAuditAreaReview: validation.review, faceAuditAreaReviewValidation: validation}
      : {faceAuditAreaReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/merge', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      res.status(422).json({
        faceAuditReviewValidation: {
          ok: false,
          review: publicFaceAuditReviewTemplate(),
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review merge expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const validation = mergeFaceAuditReviewArtifacts(artifacts);
    res.status(validation.ok ? 200 : 422).json({faceAuditReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/status', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = summarizeFaceAuditReviewStatus([]);
      res.status(422).json({
        faceAuditReviewStatus: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review status expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = summarizeFaceAuditReviewStatus(artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewStatus: report});
  });

  app.post('/api/face-audit-review-template/todo', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditReviewTodo([]);
      res.status(422).json({
        faceAuditReviewTodo: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review todo expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditReviewTodo(artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewTodo: report});
  });

  app.post('/api/face-audit-review-template/todo-summary', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditReviewTodo([]);
      res.status(422).json({
        faceAuditReviewTodoSummary: buildFaceAuditReviewTodoSummary({
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review todo summary expects a JSON array or an object with an artifacts array',
          }],
        }),
      });
      return;
    }
    const report = buildFaceAuditReviewTodo(artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewTodoSummary: buildFaceAuditReviewTodoSummary(report)});
  });

  app.post('/api/face-audit-review-template/:area/todo-summary', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditAreaReviewTodoSummary([], area);
      res.status(422).json({
        faceAuditAreaReviewTodoSummary: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit area review todo summary expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditAreaReviewTodoSummary(artifacts, area);
    res.status(report.ok ? 200 : 422).json({faceAuditAreaReviewTodoSummary: report});
  });

  app.post('/api/face-audit-review-template/review-plan', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditReviewPlan([]);
      res.status(422).json({
        faceAuditReviewPlan: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review plan expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditReviewPlan(artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewPlan: report});
  });

  app.post('/api/face-audit-review-template/review-sheet', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditReviewSheet([]);
      res.status(422).json({
        faceAuditReviewSheet: {
          ...report,
          ok: false,
          rowCount: 0,
          tsv: '',
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit review sheet expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditReviewSheet(artifacts);
    if (!report.ok) {
      res.status(422).json({faceAuditReviewSheet: report});
      return;
    }
    sendFaceAuditReviewSheet(res, report);
  });

  app.post('/api/face-audit-review-template/:area/review-sheet', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditAreaReviewSheet([], area);
      res.status(422).json({
        faceAuditAreaReviewSheet: {
          ...report,
          ok: false,
          rowCount: 0,
          tsv: '',
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit area review sheet expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditAreaReviewSheet(artifacts, area);
    if (!report.ok) {
      res.status(422).json({faceAuditAreaReviewSheet: report});
      return;
    }
    sendFaceAuditAreaReviewSheet(res, report);
  });

  app.post('/api/face-audit-review-template/apply-review-sheet', (req, res) => {
    const payload = faceAuditReviewSheetImportFromPayload(req.body);
    if (!payload) {
      const report = applyFaceAuditReviewSheet([], '');
      res.status(422).json({
        faceAuditReviewSheetImport: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'payload',
            message: 'Face-audit review sheet import expects an object with artifacts array and reviewSheetTsv string',
          }],
        },
      });
      return;
    }

    const report = applyFaceAuditReviewSheet(payload.artifacts, payload.reviewSheetTsv);
    res.status(report.ok ? 200 : 422).json(report.ok
      ? {faceAuditReviewSheetImport: report, faceAuditReview: report.review}
      : {faceAuditReviewSheetImport: report});
  });

  app.post('/api/face-audit-review-template/reviewer-instructions', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = faceAuditReviewerInstructionsReport([]);
      res.status(422).json({
        faceAuditReviewerInstructions: {
          ...report,
          ok: false,
          issueCount: report.issueCount + 1,
          issues: [
            ...report.issues,
            {
              field: 'artifacts',
              message: 'Face-audit reviewer instructions expects a JSON array or an object with an artifacts array',
            },
          ],
        },
      });
      return;
    }

    const report = faceAuditReviewerInstructionsReport(artifacts);
    if (!report.ok) {
      res.status(422).json({
        faceAuditReviewerInstructions: report,
      });
      return;
    }

    sendFaceAuditReviewerInstructions(res, report);
  });

  app.post('/api/face-audit-review-template/:area/reviewer-instructions', (req, res) => {
    const area = parseFaceAuditArea(req.params.area);
    if (!area) {
      res.status(404).json({errors: ['Face-audit area not found']});
      return;
    }
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditAreaReviewerInstructionsReport([], area);
      res.status(422).json({
        faceAuditAreaReviewerInstructions: {
          ...report,
          ok: false,
          issueCount: report.issueCount + 1,
          issues: [
            ...report.issues,
            {
              field: 'artifacts',
              message: 'Face-audit area reviewer instructions expects a JSON array or an object with an artifacts array',
            },
          ],
        },
      });
      return;
    }

    const report = buildFaceAuditAreaReviewerInstructionsReport(artifacts, area);
    if (!report.ok) {
      res.status(422).json({faceAuditAreaReviewerInstructions: report});
      return;
    }
    sendFaceAuditAreaReviewerInstructions(res, report);
  });

  app.post('/api/face-audit-review-template/handoff', (req, res) => {
    const artifacts = faceAuditReviewArtifactsFromPayload(req.body);
    if (!artifacts) {
      const report = buildFaceAuditReviewerHandoff([]);
      res.status(422).json({
        faceAuditReviewerHandoff: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'artifacts',
            message: 'Face-audit reviewer handoff expects a JSON array or an object with an artifacts array',
          }],
        },
      });
      return;
    }
    const report = buildFaceAuditReviewerHandoff(artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewerHandoff: report});
  });

  app.post('/api/face-audit-reviewer-handoff/verify', (req, res) => {
    const validation = validateFaceAuditReviewerHandoffArtifact(req.body);
    res.status(validation.ok ? 200 : 422).json({faceAuditReviewerHandoffValidation: validation});
  });

  app.post('/api/face-audit-reviewer-handoff/response', (req, res) => {
    const payload = faceAuditHandoffResponseFromPayload(req.body);
    if (!payload) {
      const report = summarizeFaceAuditReviewerHandoffResponse({}, []);
      res.status(422).json({
        faceAuditReviewerHandoffResponse: {
          ...report,
          ok: false,
          issueCount: 1,
          issues: [{
            field: 'payload',
            message: 'Face-audit reviewer handoff response expects an object with handoff and artifacts array',
          }],
        },
      });
      return;
    }
    const report = summarizeFaceAuditReviewerHandoffResponse(payload.handoff, payload.artifacts);
    res.status(report.ok ? 200 : 422).json({faceAuditReviewerHandoffResponse: report});
  });

  app.post('/api/face-audit-review-template/validate', (req, res) => {
    const validation = validateFaceAuditReviewArtifact(req.body);
    res.status(validation.ok ? 200 : 422).json({faceAuditReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/ready', (req, res) => {
    const validation = validateFaceAuditReadyArtifact(req.body);
    res.status(validation.ok ? 200 : 422).json({faceAuditReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/lock-preview', (req, res) => {
    const validation = buildFaceAuditLockPreview(req.body);
    res.status(validation.ok ? 200 : 422).json({faceAuditReviewValidation: validation});
  });

  app.post('/api/face-audit-review-template/lock-artifact', (req, res) => {
    const validation = buildFaceAuditLockArtifact(req.body);
    if (!validation.ok || !validation.lockArtifact) {
      res.status(422).json({faceAuditReviewValidation: validation});
      return;
    }
    res.json({faceAuditLockArtifact: validation.lockArtifact});
  });

  app.post('/api/face-audit-lock-artifact/verify', (req, res) => {
    const validation = validateFaceAuditLockArtifact(req.body);
    res.status(validation.ok ? 200 : 422).json({faceAuditLockArtifactValidation: validation});
  });

  app.post('/api/face-audit-release-gate', (req, res) => {
    const lockArtifact = faceAuditReleaseGateLockArtifactFromPayload(req.body);
    const validation = validateFaceAuditStaticLockGate(lockArtifact);
    res.status(validation.ok ? 200 : 422).json({faceAuditStaticLockGate: validation});
  });

  app.use('/api/games', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/games', (_req, res) => {
    res.json(publicGameList(io, store));
  });

  app.post('/api/games', (req, res) => {
    try {
      const game = store.create({
        playerNames: playerNamesFromPayload(req.body),
        seed: seedFromPayload(req.body),
        introductoryCanalOnly: introductoryCanalOnlyFromPayload(req.body),
      });
      const sessions = store.getPlayerSessions(game.id);
      res.status(201).json({game: gameStateForPlayer(game, sessions[0]?.playerId), sessions});
      broadcastGameList(io, store);
    } catch (error) {
      res.status(400).json({errors: [error instanceof Error ? error.message : String(error)]});
    }
  });

  app.get('/api/games/:id', (req, res) => {
    const gameId = gameIdFromRouteParam(req.params.id);
    const game = store.get(gameId);
    if (!game) {
      res.status(404).json({errors: ['Game not found']});
      return;
    }
    const playerId = nonEmptyString(req.get('x-player-id'));
    const token = nonEmptyString(req.get('x-player-token'));
    if (playerId || token) {
      if (!playerId || !store.verifyPlayerSession(game.id, playerId, token)) {
        res.status(400).json({errors: ['Invalid player session']});
        return;
      }
      res.json({game: gameStateForPlayer(game, playerId)});
      return;
    }
    res.json({game: gameStateForPlayer(game)});
  });

  app.post('/api/games/:id/commands', (req, res) => {
    const gameId = gameIdFromRouteParam(req.params.id);
    const command = isRecord(req.body) && 'command' in req.body
      ? req.body.command
      : req.body;
    const bodySessionToken = isRecord(req.body) && typeof req.body.sessionToken === 'string'
      ? nonEmptyString(req.body.sessionToken)
      : undefined;
    const headerSessionToken = nonEmptyString(req.get('x-player-token'));
    if (bodySessionToken && headerSessionToken && bodySessionToken !== headerSessionToken) {
      res.status(400).json({errors: ['Player token header does not match body session token']});
      return;
    }
    const sessionToken = bodySessionToken ?? headerSessionToken;
    const headerPlayerId = nonEmptyString(req.get('x-player-id'));
    const commandPlayerId = playerIdFromCommand(command);
    if (headerPlayerId && commandPlayerId && headerPlayerId !== commandPlayerId) {
      res.status(400).json({errors: ['Player header does not match command player']});
      return;
    }
    const result = store.apply(gameId, command, sessionToken);
    if (!result.ok) {
      res.status(400).json({errors: result.errors});
      return;
    }
    const playerId = commandPlayerId;
    const room = io.sockets.adapter.rooms.get(gameId);
    if (room && result.state) {
      for (const socketId of room) {
        const socket = io.sockets.sockets.get(socketId);
        socket?.emit('game:state', gameStateForPlayer(result.state, optionalString(socket.data.playerId)));
      }
    }
    res.json({game: result.state ? gameStateForPlayer(result.state, playerId) : undefined});
    broadcastGameList(io, store);
  });

  io.on('connection', (socket) => {
    socket.on('games:list:get', (_payload: unknown, reply?: (response: unknown) => void) => {
      reply?.(publicGameList(io, store));
    });

    socket.on('game:leave', (_payload: unknown, reply?: (response: unknown) => void) => {
      leaveGameRoom(socket);
      reply?.({ok: true});
      broadcastGameList(io, store);
    });

    socket.on('game:create', (payload: unknown, reply?: (response: unknown) => void) => {
      try {
        const game = store.create({
          playerNames: playerNamesFromPayload(payload),
          seed: seedFromPayload(payload),
          introductoryCanalOnly: introductoryCanalOnlyFromPayload(payload),
        });
        const sessions = store.getPlayerSessions(game.id);
        joinGameRoom(socket, game.id, sessions[0]?.playerId);
        reply?.({ok: true, game: gameStateForPlayer(game, sessions[0]?.playerId), sessions, session: sessions[0]});
        socket.emit('game:state', gameStateForPlayer(game, sessions[0]?.playerId));
        broadcastGameList(io, store);
      } catch (error) {
        reply?.({ok: false, errors: [error instanceof Error ? error.message : String(error)]});
      }
    });

    socket.on('game:join', (payload: unknown, reply?: (response: unknown) => void) => {
      const record = isRecord(payload) ? payload : undefined;
      const gameId = nonEmptyString(record?.gameId);
      if (!record || !gameId) {
        reply?.({ok: false, errors: ['Malformed join payload']});
        return;
      }

      const game = store.get(gameId);
      if (!game) {
        reply?.({ok: false, errors: ['Game not found']});
        return;
      }

      const playerId = nonEmptyString(record.playerId);
      const sessionToken = nonEmptyString(record.sessionToken);
      let session: PlayerSession | undefined;
      if (playerId || sessionToken) {
        if (!playerId || !store.verifyPlayerSession(game.id, playerId, sessionToken)) {
          reply?.({ok: false, errors: ['Invalid player session']});
          return;
        }
        session = store.getPlayerSession(game.id, playerId);
      }

      joinGameRoom(socket, game.id, playerId);
      reply?.({ok: true, game: gameStateForPlayer(game, playerId), session});
      socket.emit('game:state', gameStateForPlayer(game, playerId));
      broadcastGameList(io, store);
    });

    socket.on('game:command', (payload: unknown, reply?: (response: unknown) => void) => {
      const record = isRecord(payload) ? payload : undefined;
      const gameId = nonEmptyString(record?.gameId);
      if (!record || !gameId) {
        reply?.({ok: false, errors: ['Malformed command payload']});
        return;
      }

      const socketGameId = optionalString(socket.data.gameId);
      if (socketGameId && socketGameId !== gameId) {
        reply?.({ok: false, errors: ['Socket game does not match command game']});
        return;
      }
      const commandPlayerId = playerIdFromCommand(record.command);
      const socketPlayerId = optionalString(socket.data.playerId);
      if (socketPlayerId && commandPlayerId && socketPlayerId !== commandPlayerId) {
        reply?.({ok: false, errors: ['Socket player does not match command player']});
        return;
      }
      const result = store.apply(
        gameId,
        record.command,
        nonEmptyString(record.sessionToken),
      );
      if (!result.ok) {
        reply?.({ok: false, errors: result.errors});
        return;
      }
      const playerId = commandPlayerId;
      if (playerId) {
        joinGameRoom(socket, gameId, playerId);
      }
      const room = io.sockets.adapter.rooms.get(gameId);
      if (room && result.state) {
        for (const socketId of room) {
          const socket = io.sockets.sockets.get(socketId);
          socket?.emit('game:state', gameStateForPlayer(result.state, optionalString(socket.data.playerId)));
        }
      }
      reply?.({ok: true, game: result.state ? gameStateForPlayer(result.state, playerId) : undefined});
      broadcastGameList(io, store);
    });

    socket.on('disconnect', () => {
      broadcastGameList(io, store);
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({errors: ['API route not found']});
  });

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return {app, server, io};
}
