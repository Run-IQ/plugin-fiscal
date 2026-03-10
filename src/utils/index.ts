export * from './version.js';

/**
 * Deep merges two objects.
 * Arrays are replaced, not merged (standard behavior for fiscal params like brackets).
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = target[key];

    if (
      sVal &&
      typeof sVal === 'object' &&
      !Array.isArray(sVal) &&
      tVal &&
      typeof tVal === 'object' &&
      !Array.isArray(tVal)
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>);
    } else {
      result[key] = sVal;
    }
  }

  return result as T;
}
