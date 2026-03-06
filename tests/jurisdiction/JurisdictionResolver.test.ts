import { describe, it, expect } from 'vitest';
import { JurisdictionResolver } from '../../src/jurisdiction/JurisdictionResolver.js';

describe('JurisdictionResolver', () => {
  it('NATIONAL + GLOBAL = 3000', () => {
    expect(JurisdictionResolver.resolve('NATIONAL', 'GLOBAL')).toBe(3000);
  });

  it('NATIONAL + ORGANIZATION = 3300', () => {
    expect(JurisdictionResolver.resolve('NATIONAL', 'ORGANIZATION')).toBe(3300);
  });

  it('NATIONAL + USER = 3600', () => {
    expect(JurisdictionResolver.resolve('NATIONAL', 'USER')).toBe(3600);
  });

  it('REGIONAL + GLOBAL = 2000', () => {
    expect(JurisdictionResolver.resolve('REGIONAL', 'GLOBAL')).toBe(2000);
  });

  it('REGIONAL + ORGANIZATION = 2200', () => {
    expect(JurisdictionResolver.resolve('REGIONAL', 'ORGANIZATION')).toBe(2200);
  });

  it('REGIONAL + USER = 2400', () => {
    expect(JurisdictionResolver.resolve('REGIONAL', 'USER')).toBe(2400);
  });

  it('MUNICIPAL + GLOBAL = 1000', () => {
    expect(JurisdictionResolver.resolve('MUNICIPAL', 'GLOBAL')).toBe(1000);
  });

  it('MUNICIPAL + ORGANIZATION = 1100', () => {
    expect(JurisdictionResolver.resolve('MUNICIPAL', 'ORGANIZATION')).toBe(1100);
  });

  it('MUNICIPAL + USER = 1200', () => {
    expect(JurisdictionResolver.resolve('MUNICIPAL', 'USER')).toBe(1200);
  });

  it('NATIONAL+ORGANIZATION (3300) > NATIONAL+GLOBAL (3000)', () => {
    const orgPriority = JurisdictionResolver.resolve('NATIONAL', 'ORGANIZATION');
    const globalPriority = JurisdictionResolver.resolve('NATIONAL', 'GLOBAL');
    expect(orgPriority).toBeGreaterThan(globalPriority);
  });
});
