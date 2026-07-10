import {validateGameSeed} from '../common/gameSetup';

export type CreateGamePayload = {
  playerNames: string[];
  introductoryCanalOnly?: true;
  seed?: number;
};

export type CreateGamePayloadResult =
  | {ok: true; payload: CreateGamePayload}
  | {ok: false; error: string};

type SeedParseResult =
  | {ok: true; seed?: number}
  | {ok: false; error: string};

function isSupportedPlayerCount(count: number): count is 2 | 3 | 4 {
  return count === 2 || count === 3 || count === 4;
}

export function playerNamesForCount(names: string[], count: number): string[] {
  if (!isSupportedPlayerCount(count)) {
    return names;
  }
  return Array.from({length: count}, (_, index) => names[index] ?? `Player ${index + 1}`);
}

function normalizedPlayerNames(names: string[]): string[] | undefined {
  if (!isSupportedPlayerCount(names.length)) {
    return undefined;
  }
  return names.map((name, index) => name.trim() || `Player ${index + 1}`);
}

function seedFromText(seedText: string): SeedParseResult {
  const trimmed = seedText.trim();
  if (!trimmed) {
    return {ok: true};
  }
  const seed = Number(trimmed);
  try {
    return {ok: true, seed: validateGameSeed(seed)};
  } catch (error) {
    return {ok: false, error: error instanceof Error ? error.message : String(error)};
  }
}

export function createGamePayload(
  playerNames: string[],
  introductoryCanalOnly: boolean,
  seedText = '',
): CreateGamePayloadResult {
  const names = normalizedPlayerNames(playerNames);
  if (!names) {
    return {ok: false, error: 'Brass: Birmingham supports 2-4 players'};
  }

  const seedResult = seedFromText(seedText);
  if (!seedResult.ok) {
    return seedResult;
  }

  return {
    ok: true,
    payload: {
      playerNames: names,
      ...(introductoryCanalOnly ? {introductoryCanalOnly: true as const} : {}),
      ...(seedResult.seed !== undefined ? {seed: seedResult.seed} : {}),
    },
  };
}
