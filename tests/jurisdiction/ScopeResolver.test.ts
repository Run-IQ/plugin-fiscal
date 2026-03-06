import { describe, it, expect } from 'vitest';
import { ScopeResolver } from '../../src/jurisdiction/ScopeResolver.js';

describe('ScopeResolver', () => {
  it('GLOBAL multiplier = 1.0', () => {
    expect(ScopeResolver.getMultiplier('GLOBAL')).toBe(1.0);
  });

  it('ORGANIZATION multiplier = 1.1', () => {
    expect(ScopeResolver.getMultiplier('ORGANIZATION')).toBe(1.1);
  });

  it('USER multiplier = 1.2', () => {
    expect(ScopeResolver.getMultiplier('USER')).toBe(1.2);
  });
});
