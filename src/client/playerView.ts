import {getIncomeLevel} from '../common/income';
import type {GameState, PlayerState} from '../common/types';

type DirtyPlayerState = Partial<PlayerState> & {
  handCardIds?: unknown;
};

export type PlayerTableRow = {
  id: string;
  name: string;
  cash: number;
  incomeTrackPosition: number;
  incomeLevel: number;
  victoryPoints: number;
  handCount: number;
  spentThisRound: number;
};

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function dirtyPlayerForView(game: GameState, playerId: string): DirtyPlayerState | undefined {
  return game.players[playerId] as DirtyPlayerState | undefined;
}

export function playerIdForView(game: GameState, playerId: string): string {
  return nonEmptyString(dirtyPlayerForView(game, playerId)?.id) ?? playerId;
}

export function playerNameForView(game: GameState, playerId: string): string {
  const name = nonEmptyString(dirtyPlayerForView(game, playerId)?.name);
  if (name) {
    return name;
  }
  return playerIdForView(game, playerId) || 'unknown player';
}

export function playerLabelForView(game: GameState, playerId: string): string {
  const id = playerIdForView(game, playerId);
  const name = playerNameForView(game, playerId);
  return id && name !== id ? `${name} (${id})` : name;
}

export function playerHandCardIdsForView(game: GameState, playerId: string): string[] {
  return stringIds(dirtyPlayerForView(game, playerId)?.handCardIds);
}

export function playerTableRowForView(game: GameState, playerId: string): PlayerTableRow {
  const player = dirtyPlayerForView(game, playerId);
  const incomeTrackPosition = finiteNumber(player?.incomeTrackPosition);
  return {
    id: playerIdForView(game, playerId),
    name: playerNameForView(game, playerId),
    cash: finiteNumber(player?.cash),
    incomeTrackPosition,
    incomeLevel: getIncomeLevel(incomeTrackPosition),
    victoryPoints: finiteNumber(player?.victoryPoints),
    handCount: playerHandCardIdsForView(game, playerId).length,
    spentThisRound: finiteNumber(player?.spentThisRound),
  };
}
