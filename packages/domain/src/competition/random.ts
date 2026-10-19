/** Deterministic [0, 1) generator (mulberry32): the same seed gives the same composition. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fisher–Yates on a copy: every item is kept exactly once. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
/** Sizes of `count` containers holding `total` items, differing by at most one. */
export function evenSizes(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count),
    extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
/** Cuts `items` into consecutive chunks of the given sizes. */
export function chunk<T>(items: readonly T[], sizes: number[]): T[][] {
  let offset = 0;
  return sizes.map((size) => {
    const part = items.slice(offset, offset + size);
    offset += size;
    return part;
  });
}
