import {applyCommand, determineWinners, validateCommand} from '../common/gameEngine';
import {createGame} from '../common/gameSetup';
import {staticConfig} from '../common/staticData';
import {getActiveIndustries, isLinkLineActiveForPlayerCount} from '../common/selectors';
import {buildIndustryOptionsForLocationAndCard, buildLocationOptionsForCard, buildSlotOptionsForIndustry} from '../client/buildSlots';
import {developOptionsForSelect} from '../client/developOptions';
import {networkLinkOptionsForSelect} from '../client/networkOptions';
import {merchantSpacesForSellIndustry, sellableIndustriesForPlayer} from '../client/sellOptions';
import type {GameCommand, GameEvent, GameState, IndustryType, PlayerCount} from '../common/types';

export interface SimulationOptions {
  playerCount: PlayerCount;
  seed: number;
  maxCommands?: number;
}

export interface SimulatedCommand {
  era: GameState['era'];
  round: number;
  playerId: string;
  command: GameCommand;
  events: GameEvent[];
}

export interface SimulationRecord {
  gameId: string;
  seed: number;
  playerCount: PlayerCount;
  playerNames: string[];
  status: GameState['status'];
  finalEra: GameState['era'];
  finalRound: number;
  players: Array<{id: string; name: string; cash: number; victoryPoints: number; incomeTrackPosition: number}>;
  winnerIds: string[];
  commands: SimulatedCommand[];
  events: GameEvent[];
}

function isLegal(state: GameState, command: GameCommand): boolean {
  return validateCommand(state, command).ok;
}

function pendingCommand(state: GameState): GameCommand {
  const decision = state.pendingDecision!;
  const playerId = decision.playerId;
  if (decision.type === 'merchant_develop') {
    const types = [] as Extract<GameCommand, {type: 'develop'}>['industryTypes'];
    for (let index = 0; index < decision.count; index++) {
      const next = developOptionsForSelect(state.players[playerId], types, index)[0];
      if (!next) break;
      types.push(next);
    }
    return {type: 'resolve_merchant_develop', playerId, industryTypes: types};
  }
  const ids = getActiveIndustries(state)
    .filter((industry) => industry.ownerPlayerId === playerId &&
      Math.floor(staticConfig.industryTileSpecs[industry.specId].cost.cash / 2) > 0)
    .sort((a, b) => Number(a.flipped) - Number(b.flipped) ||
      staticConfig.industryTileSpecs[b.specId].cost.cash - staticConfig.industryTileSpecs[a.specId].cost.cash)
    .map((industry) => industry.id);
  for (let count = 0; count <= ids.length; count++) {
    const command: GameCommand = {type: 'resolve_negative_income', playerId, industryInstanceIds: ids.slice(0, count)};
    if (isLegal(state, command)) return command;
  }
  throw new Error(`Cannot resolve negative income for ${playerId}`);
}

function candidates(state: GameState, playerId: string): GameCommand[] {
  const player = state.players[playerId];
  const cards = [...new Set(player.handCardIds)];
  const result: GameCommand[] = [];
  for (const cardId of cards) {
    for (const location of buildLocationOptionsForCard(state, playerId, cardId)) {
      for (const industryType of buildIndustryOptionsForLocationAndCard(state, playerId, cardId, location.id)) {
        for (const slot of buildSlotOptionsForIndustry(state, location.id, industryType, playerId)) {
          result.push({type: 'build', playerId, cardId, locationId: location.id, slotId: slot.id, industryType});
        }
      }
    }
  }
  const cardId = cards[0];
  if (!cardId) throw new Error(`Player ${playerId} has no card in ${state.era} round ${state.roundNumber}`);
  for (const industry of sellableIndustriesForPlayer(state, playerId)) {
    for (const space of merchantSpacesForSellIndustry(state, industry.id)) {
      result.push({type: 'sell', playerId, cardId, sales: [{industryInstanceId: industry.id, merchantSpaceId: space.id}]});
    }
  }
  for (const line of networkLinkOptionsForSelect(state, playerId, [], 0)) {
    result.push({type: 'network', playerId, cardId, linkLineIds: [line.id]});
  }
  for (const industryType of developOptionsForSelect(player, [], 0)) {
    result.push({type: 'develop', playerId, cardId, industryTypes: [industryType]});
  }
  result.push({type: 'loan', playerId, cardId});
  result.push({type: 'pass', playerId, cardId});
  return result.filter((command) => isLegal(state, command));
}

function merchantLocations(state: GameState, industryType: string): string[] {
  return Object.values(state.board.merchantSpaces).flatMap((space) => {
    const instanceId = space.merchantTileInstanceId;
    const spec = instanceId ? staticConfig.merchantTileSpecs[instanceId.replace(/-\d+$/, '')] : undefined;
    if (!spec?.acceptedIndustryTypes.includes(industryType as IndustryType)) return [];
    const location = Object.values(staticConfig.locations).find((item) =>
      item.kind === 'merchant' && item.spaces.some((candidate) => candidate.id === space.id));
    return location ? [location.id] : [];
  });
}

function routeDistance(state: GameState, from: string, industryType: string, extraLineId?: string): number {
  const targets = new Set(merchantLocations(state, industryType));
  if (targets.size === 0) return 20;
  const distances = new Map<string, number>([[from, 0]]);
  const visited = new Set<string>();
  while (true) {
    const next = [...distances.entries()]
      .filter(([id]) => !visited.has(id))
      .sort((a, b) => a[1] - b[1])[0];
    if (!next) return 20;
    const [location, distance] = next;
    if (targets.has(location)) return distance;
    visited.add(location);
    for (const line of Object.values(staticConfig.linkLines)) {
      if (!line.allowedLinkTypes.includes(state.era) || !isLinkLineActiveForPlayerCount(state, line)) continue;
      const points = [line.endpointA, line.endpointB, line.viaFarmBreweryId].filter((id): id is string => Boolean(id));
      if (!points.includes(location)) continue;
      const cost = state.board.linkLines[line.id]?.occupiedBy || line.id === extraLineId ? 0 : 1;
      for (const other of points) {
        const possible = distance + cost;
        if (possible < (distances.get(other) ?? Infinity)) distances.set(other, possible);
      }
    }
  }
}

function commandScore(state: GameState, command: GameCommand): number {
  const player = state.players[command.playerId];
  switch (command.type) {
    case 'sell': return 40;
    case 'build': {
      const specId = player.industryTileStacks[command.industryType].availableSpecIdsInOrder[0];
      const spec = staticConfig.industryTileSpecs[specId];
      const value = spec.flip.victoryPoints + spec.flip.incomeSpaces * 0.7;
      const cashPenalty = player.cash < 12 ? spec.cost.cash * 0.6 : spec.cost.cash * 0.2;
      const sold = command.industryType === 'cotton_mill' || command.industryType === 'manufacturer' || command.industryType === 'pottery';
      const access = sold ? Math.max(0, 8 - routeDistance(state, command.locationId, command.industryType) * 2) : 0;
      return 17 + value + access - cashPenalty;
    }
    case 'network': {
      const improvement = getActiveIndustries(state)
        .filter((industry) => industry.ownerPlayerId === command.playerId && !industry.flipped &&
          ['cotton_mill', 'manufacturer', 'pottery'].includes(industry.industryType))
        .reduce((best, industry) => {
          const before = routeDistance(state, industry.locationId, industry.industryType);
          const after = routeDistance(state, industry.locationId, industry.industryType, command.linkLineIds[0]);
          return Math.max(best, before - after);
        }, 0);
      return improvement > 0 ? 24 + improvement * 2 : 5;
    }
    case 'develop': return state.era === 'canal' ? 8 : 4;
    case 'loan': return player.cash < 8 ? 25 : -5;
    case 'pass': return 0;
    default: return 0;
  }
}

export function simulateGame(options: SimulationOptions): SimulationRecord {
  const {playerCount, seed} = options;
  const gameId = `simulation-${playerCount}p-${seed}`;
  const playerNames = Array.from({length: playerCount}, (_, index) => `AI ${index + 1}`);
  const state = createGame({id: gameId, playerNames, seed});
  const commands: SimulatedCommand[] = [];
  const limit = options.maxCommands ?? 400;
  while (state.status === 'playing') {
    if (commands.length >= limit) throw new Error(`Simulation command limit ${limit} reached`);
    const playerId = state.pendingDecision?.playerId ?? state.turnOrder[state.currentTurnIndex];
    const command = state.pendingDecision
      ? pendingCommand(state)
      : candidates(state, playerId).sort((a, b) => commandScore(state, b) - commandScore(state, a))[0];
    if (!command) throw new Error(`No legal command for ${playerId}`);
    const era = state.era;
    const round = state.roundNumber;
    const eventCount = state.eventLog.length;
    applyCommand(state, command);
    commands.push({era, round, playerId, command, events: state.eventLog.slice(eventCount)});
  }
  return {
    gameId, seed, playerCount, playerNames, status: state.status,
    finalEra: state.era, finalRound: state.roundNumber,
    players: Object.values(state.players).map(({id, name, cash, victoryPoints, incomeTrackPosition}) =>
      ({id, name, cash, victoryPoints, incomeTrackPosition})),
    winnerIds: determineWinners(state), commands, events: state.eventLog,
  };
}
