import { describe, it, expect } from 'vitest';
import { PASSWORD_MIN_LENGTH, validatePassword } from '../src/utils/passwordPolicy';

describe('password policy', () => {
  it('requires at least 8 characters', () => {
    expect(validatePassword('Short1!')).toBe(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
    );
  });

  it('rejects common passwords that meet the length requirement', () => {
    expect(validatePassword('Password1234')).toMatch(/too common/i);
  });

  it('accepts an 8-character password', () => {
    expect(validatePassword('abcd1234')).toBeNull();
  });

  it('accepts a 12-character password', () => {
    expect(validatePassword('Password123!')).toBeNull();
  });

  it('accepts a long passphrase with mixed classes', () => {
    expect(validatePassword('correct Horse Battery Staple 42!')).toBeNull();
  });
});
