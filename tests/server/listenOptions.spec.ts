import {describe, expect, it} from 'vitest';
import {listenOptionsFromEnv} from '../../src/server/listenOptions';

describe('listenOptionsFromEnv', () => {
  it('defaults to local development host and port', () => {
    expect(listenOptionsFromEnv({})).toEqual({
      host: '127.0.0.1',
      port: 3001,
      url: 'http://127.0.0.1:3001',
    });
  });

  it('reads HOST and PORT from the environment', () => {
    expect(listenOptionsFromEnv({HOST: '0.0.0.0', PORT: '4173'})).toEqual({
      host: '0.0.0.0',
      port: 4173,
      url: 'http://0.0.0.0:4173',
    });
  });

  it('trims configured values and falls back for a blank host', () => {
    expect(listenOptionsFromEnv({HOST: '   ', PORT: ' 4000 '})).toEqual({
      host: '127.0.0.1',
      port: 4000,
      url: 'http://127.0.0.1:4000',
    });
  });

  it('uses the default port when PORT is omitted or blank', () => {
    expect(listenOptionsFromEnv({PORT: undefined}).port).toBe(3001);
    expect(listenOptionsFromEnv({PORT: '   '}).port).toBe(3001);
  });

  it.each(['0', '65536', '3.14', 'abc', '3001abc'])('rejects invalid PORT value %s', (port) => {
    expect(() => listenOptionsFromEnv({PORT: port})).toThrow('PORT must be an integer between 1 and 65535');
  });
});
