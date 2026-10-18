import { ensure } from '../model.js';
export interface Pairing {
  home: string;
  away: string;
  scheduleRound: number;
}
export function roundRobin(entries: string[]): Pairing[] {
  ensure(
    new Set(entries).size === entries.length,
    'DUPLICATE_ENTRY',
    'Schedule entries must be unique',
  );
  const rotation: (string | null)[] = [...entries];
  if (rotation.length % 2) rotation.push(null);
  const matches: Pairing[] = [];
  for (let round = 1; round < rotation.length; round++) {
    for (let i = 0; i < rotation.length / 2; i++) {
      const home = rotation[i],
        away = rotation[rotation.length - 1 - i];
      if (home && away) matches.push({ home, away, scheduleRound: round });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  return matches;
}
export function distributeGroups(entries: string[], count: number): string[][] {
  ensure(
    count >= 1 && entries.length >= count * 2,
    'INVALID_GROUP_COUNT',
    'Each group requires at least two participants',
    422,
  );
  const groups = Array.from({ length: count }, () => [] as string[]);
  entries.forEach((id, i) => {
    const row = Math.floor(i / count);
    groups[row % 2 ? count - 1 - (i % count) : i % count]!.push(id);
  });
  return groups;
}
// Standard recursive bracket positions: 1 v 8, 4 v 5, 2 v 7, 3 v 6.
export function seededBracket(entries: string[]): (string | null)[][] {
  ensure(
    entries.length >= 2 && new Set(entries).size === entries.length,
    'INVALID_BRACKET',
    'A bracket needs distinct qualifiers',
  );
  const size = 2 ** Math.ceil(Math.log2(entries.length));
  let seeds = [1, 2];
  while (seeds.length < size) {
    const next = seeds.length * 2 + 1;
    seeds = seeds.flatMap((s) => [s, next - s]);
  }
  const slots = seeds.map((s) => entries[s - 1] ?? null);
  return Array.from({ length: size / 2 }, (_, i) => [slots[i * 2]!, slots[i * 2 + 1]!]);
}
