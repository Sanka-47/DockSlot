import { describe, it, expect } from 'vitest';
import { PASSWORD_MIN_LENGTH, validatePassword } from '../src/utils/passwordPolicy';

describe('password policy', () => {
  it('requires at least 12 characters', () => {
    expect(validatePassword('Short1!')).toBe(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
    );
  });

  it('requires at least three character classes', () => {
    expect(validatePassword('lowercaseonly123')).toMatch(/at least three of/i);
  });

  it('rejects common passwords that meet the length requirement', () => {
    expect(validatePassword('Password1234')).toMatch(/too common/i);
  });

  it('accepts a 12-character password with three classes', () => {
    expect(validatePassword('Password123!')).toBeNull();
  });

  it('accepts a long passphrase with mixed classes', () => {
    expect(validatePassword('correct Horse Battery Staple 42!')).toBeNull();
  });
});
