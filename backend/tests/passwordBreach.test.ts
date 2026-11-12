import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  assertPasswordNotBreached,
  isPasswordBreached,
} from '../src/utils/passwordBreach';

const ORIGINAL_FLAG = process.env.PASSWORD_BREACH_CHECK_ENABLED;

function sha1(password: string): string {
  return crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
}

function hibpResponse(body: string, ok = true): Response {
  return {
    ok,
    text: async () => body,
  } as unknown as Response;
}

describe('HaveIBeenPwned k-anonymity password check', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.PASSWORD_BREACH_CHECK_ENABLED = 'true';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_FLAG === undefined) delete process.env.PASSWORD_BREACH_CHECK_ENABLED;
    else process.env.PASSWORD_BREACH_CHECK_ENABLED = ORIGINAL_FLAG;
  });

  it('matches a suffix from the range response and only sends the prefix', async () => {
    const password = 'breached-password';
    const hash = sha1(password);
    fetchMock.mockResolvedValue(
      hibpResponse(`00112233445566778899AABBCCDDEEFF00:3\r\n${hash.slice(5)}:42\r\n`)
    );

    await expect(isPasswordBreached(password)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`
    );
  });

  it('returns false when the suffix is absent', async () => {
    fetchMock.mockResolvedValue(hibpResponse('00112233445566778899AABBCCDDEEFF00:3\r\n'));
    await expect(isPasswordBreached('not-breached-password')).resolves.toBe(false);
  });

  it('skips the network call when the feature flag is disabled', async () => {
    process.env.PASSWORD_BREACH_CHECK_ENABLED = 'false';
    await expect(isPasswordBreached('anything')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open when HIBP is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(isPasswordBreached('anything')).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws a 400 when a breached password is asserted', async () => {
    const password = 'breached-password';
    fetchMock.mockResolvedValue(hibpResponse(`${sha1(password).slice(5)}:1\r\n`));

    await expect(assertPasswordNotBreached(password)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/data breach/i),
    });
  });
});
