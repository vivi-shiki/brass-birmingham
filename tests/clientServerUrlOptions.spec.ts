import {describe, expect, it} from 'vitest';
import {serverUrlFromOptions, type ServerUrlRuntimeLocation} from '../src/client/serverUrlOptions';

function location(overrides: Partial<ServerUrlRuntimeLocation> = {}): ServerUrlRuntimeLocation {
  return {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1:5173',
    ...overrides,
  };
}

describe('client server URL options', () => {
  it('uses same-origin URLs outside Vite dev mode', () => {
    expect(serverUrlFromOptions({
      isDev: false,
      location: location({origin: 'https://brass.example.test'}),
    })).toBe('https://brass.example.test');
  });

  it('infers the dev server URL from the current browser host', () => {
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({hostname: '192.168.1.42', origin: 'http://192.168.1.42:5173'}),
    })).toBe('http://192.168.1.42:3001');
  });

  it('keeps the browser protocol and supports custom dev ports', () => {
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({protocol: 'https:', hostname: 'brass.lan', origin: 'https://brass.lan:5173'}),
      devServerPort: 3101,
    })).toBe('https://brass.lan:3101');
  });

  it('brackets IPv6 dev hosts before appending the server port', () => {
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({hostname: '::1', origin: 'http://[::1]:5173'}),
    })).toBe('http://[::1]:3001');
  });

  it('prefers an explicit configured server origin', () => {
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({hostname: '192.168.1.42'}),
      configuredServerUrl: ' https://brass.example.test:3443/api ',
    })).toBe('https://brass.example.test:3443');
  });

  it('ignores malformed or unsupported configured server URLs', () => {
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({hostname: 'brass.lan'}),
      configuredServerUrl: 'not a url',
    })).toBe('http://brass.lan:3001');
    expect(serverUrlFromOptions({
      isDev: true,
      location: location({hostname: 'brass.lan'}),
      configuredServerUrl: 'file:///tmp/brass',
    })).toBe('http://brass.lan:3001');
  });
});
