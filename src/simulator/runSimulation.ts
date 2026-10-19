import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {simulateGame} from './simulateGame';
import type {PlayerCount} from '../common/types';

const playerCount = Number(process.argv[2] ?? 4);
const seed = Number(process.argv[3] ?? 20261019);
if (![2, 3, 4].includes(playerCount) || !Number.isSafeInteger(seed)) {
  throw new Error('Usage: npm run simulate -- <2|3|4> <integer-seed> [output-path]');
}
const output = resolve(process.argv[4] ?? `artifacts/simulations/game-${playerCount}p-seed-${seed}.json`);
const record = simulateGame({playerCount: playerCount as PlayerCount, seed});
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
const actionCounts = Object.fromEntries([...new Set(record.commands.map(({command}) => command.type))]
  .map((type) => [type, record.commands.filter(({command}) => command.type === type).length]));
process.stdout.write(`${JSON.stringify({output, status: record.status, winnerIds: record.winnerIds, commands: record.commands.length, actionCounts})}\n`);
