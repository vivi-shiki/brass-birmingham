import {describe, expect, it} from 'vitest';
import {applyCommand, validateCommand} from '../src/common/gameEngine';
import {createGame} from '../src/common/gameSetup';
import {simulateGame} from '../src/simulator/simulateGame';

describe('complete game simulator', () => {
  it.each([2, 3, 4] as const)('finishes a seeded %i-player standard game', (playerCount) => {
    const record = simulateGame({playerCount, seed: 20261019});
    expect(record.status).toBe('ended');
    expect(record.finalEra).toBe('rail');
    expect(record.winnerIds.length).toBeGreaterThan(0);
    expect(record.commands.length).toBeLessThanOrEqual(400);
    expect(record.events.filter((event) => event.type === 'era_ended')).toHaveLength(2);
    expect(record.events.filter((event) => event.type === 'game_ended')).toHaveLength(1);
    expect(record.commands.some((entry) => entry.command.type === 'build')).toBe(true);
  }, 30_000);

  it('is deterministic and every recorded command replays through the public engine', () => {
    const options = {playerCount: 2 as const, seed: 73};
    const record = simulateGame(options);
    expect(simulateGame(options)).toEqual(record);

    const replay = createGame({id: record.gameId, playerNames: record.playerNames, seed: options.seed});
    for (const entry of record.commands) {
      expect(validateCommand(replay, entry.command)).toEqual({ok: true, errors: []});
      const before = replay.eventLog.length;
      applyCommand(replay, entry.command);
      expect(replay.eventLog.slice(before)).toEqual(entry.events);
    }
    expect(replay.status).toBe('ended');
    expect(replay.eventLog).toEqual(record.events);
    expect(record.players.map((player) => player.victoryPoints)).toEqual(
      record.playerNames.map((_, index) => replay.players[`p${index + 1}`].victoryPoints),
    );
  }, 30_000);

  it('rejects a command budget that cannot reach the ending', () => {
    expect(() => simulateGame({playerCount: 2, seed: 1, maxCommands: 1})).toThrow(/command limit/i);
  });
});
