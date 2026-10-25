import { describe, expect, it } from 'vitest';
import { isAuthorized, listenAddress } from '../proto/auth';

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

describe('isAuthorized', () => {
  it('lets everything through when no password is set', () => {
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized(undefined, '')).toBe(true);
  });

  it('accepts the right password with any user name', () => {
    expect(isAuthorized(basic('josef', 'tajne-heslo'), 'tajne-heslo')).toBe(true);
    expect(isAuthorized(basic('', 'tajne-heslo'), 'tajne-heslo')).toBe(true);
  });

  it('accepts a password that contains a colon', () => {
    expect(isAuthorized(basic('u', 'a:b'), 'a:b')).toBe(true);
  });

  it('rejects no header, another scheme, a wrong password and no colon', () => {
    const noColon = `Basic ${Buffer.from('tajne-heslo', 'utf8').toString('base64')}`;
    expect(isAuthorized(undefined, 'tajne-heslo')).toBe(false);
    expect(isAuthorized('Bearer tajne-heslo', 'tajne-heslo')).toBe(false);
    expect(isAuthorized(basic('josef', 'spatne'), 'tajne-heslo')).toBe(false);
    expect(isAuthorized(noColon, 'tajne-heslo')).toBe(false);
  });
});

describe('listenAddress', () => {
  it('uses the default port on 127.0.0.1 without PORT', () => {
    expect(listenAddress({}, 4000)).toEqual({ port: 4000, host: '127.0.0.1' });
    expect(listenAddress({ PORT: '' }, 4000)).toEqual({ port: 4000, host: '127.0.0.1' });
  });

  it('binds 0.0.0.0 on the PORT the host gives', () => {
    expect(listenAddress({ PORT: '10000' }, 4000)).toEqual({ port: 10000, host: '0.0.0.0' });
  });

  it('refuses a PORT that is not a port', () => {
    expect(() => listenAddress({ PORT: 'abc' }, 4000)).toThrow('PORT must be a TCP port');
    expect(() => listenAddress({ PORT: '70000' }, 4000)).toThrow('PORT must be a TCP port');
  });
});
