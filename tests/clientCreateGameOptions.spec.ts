import {describe, expect, it} from 'vitest';
import {createGamePayload, playerNamesForCount} from '../src/client/createGameOptions';

describe('client create game options', () => {
  it('resizes player names for supported Brass player counts', () => {
    expect(playerNamesForCount(['Ada', 'Ben'], 4)).toEqual(['Ada', 'Ben', 'Player 3', 'Player 4']);
    expect(playerNamesForCount(['Ada', 'Ben', 'Cara', 'Dev'], 2)).toEqual(['Ada', 'Ben']);
  });

  it('leaves player names unchanged for unsupported counts', () => {
    const names = ['Ada', 'Ben'];

    expect(playerNamesForCount(names, 5)).toBe(names);
  });

  it('normalizes create-game player names and omits false optional fields', () => {
    expect(createGamePayload([' Ada ', '   '], false)).toEqual({
      ok: true,
      payload: {
        playerNames: ['Ada', 'Player 2'],
      },
    });
  });

  it('includes introductory variant and integer seed when selected', () => {
    expect(createGamePayload(['Ada', 'Ben', 'Cara'], true, ' 42 ')).toEqual({
      ok: true,
      payload: {
        playerNames: ['Ada', 'Ben', 'Cara'],
        introductoryCanalOnly: true,
        seed: 42,
      },
    });
  });

  it('rejects unsupported player counts before emitting create-game payloads', () => {
    expect(createGamePayload(['Solo'], false)).toEqual({
      ok: false,
      error: 'Brass: Birmingham supports 2-4 players',
    });
    expect(createGamePayload(['Ada', 'Ben', 'Cara', 'Dev', 'Eli'], false)).toEqual({
      ok: false,
      error: 'Brass: Birmingham supports 2-4 players',
    });
  });

  it('rejects invalid seed text before emitting create-game payloads', () => {
    expect(createGamePayload(['Ada', 'Ben'], false, 'not-a-number')).toEqual({
      ok: false,
      error: 'Game seed must be a finite number',
    });
    expect(createGamePayload(['Ada', 'Ben'], false, '1.5')).toEqual({
      ok: false,
      error: 'Game seed must be an integer',
    });
  });
});
