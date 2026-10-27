export interface Level {
  /** From 1. */
  level: number;
  title: string;
  /** Total XP needed to reach the level. */
  xp: number;
}

/**
 * The ladder. Few XP for the first steps, then roughly doubling: the last one takes years of
 * regular play. Tune the curve here only; levels are derived from total XP, never stored.
 */
export const levels: readonly Level[] = [
  { level: 1, title: 'Assetato', xp: 0 },
  { level: 2, title: 'Assaggiatore', xp: 100 },
  { level: 3, title: 'Spillatore', xp: 250 },
  { level: 4, title: 'Bevitore Fisso', xp: 500 },
  { level: 5, title: 'Mastro di Sala', xp: 1_000 },
  { level: 6, title: 'Cultore del Luppolo', xp: 2_000 },
  { level: 7, title: 'Maltatore', xp: 4_000 },
  { level: 8, title: 'Fermentatore', xp: 8_000 },
  { level: 9, title: 'Mastro Spillatore', xp: 16_000 },
  { level: 10, title: 'Cavaliere del Luppolo', xp: 32_000 },
  { level: 11, title: 'Gran Maestro', xp: 64_000 },
  { level: 12, title: 'Master Birraio', xp: 120_000 },
];

export const maxLevel = levels[levels.length - 1]!;

/** Level reached with a total of XP. Negative or fractional input is clamped to a whole number. */
export function levelFor(xp: number): Level {
  const total = Math.max(0, Math.floor(xp));
  let reached = levels[0]!;
  for (const l of levels) if (total >= l.xp) reached = l;
  return reached;
}

export interface LevelProgress {
  level: Level;
  next: Level | null;
  /** XP earned since the current level. */
  into: number;
  /** XP separating the current level from the next; 0 at the top. */
  span: number;
  /** 0 to 1 towards the next level; 1 at the top. */
  ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  const level = levelFor(total);
  const next = levels.find((l) => l.level === level.level + 1) ?? null;
  const span = next ? next.xp - level.xp : 0;
  const into = total - level.xp;
  return { level, next, into, span, ratio: next ? into / span : 1 };
}
