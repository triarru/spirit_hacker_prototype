/** Narrows a value read from JSON to one of the allowed literals, or fails loudly. */
export function parseOneOf<T extends string | number>(
  allowed: readonly T[],
  value: string | number,
  what: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unknown ${what} "${value}"`);
  return match;
}
