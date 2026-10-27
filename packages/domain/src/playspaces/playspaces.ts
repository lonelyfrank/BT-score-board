import type { Tournament } from '../model.js';

/**
 * A play space ("punto di incontro"): a place where friends play, with its own scoreboard,
 * records and statistics. Players and accounts are global; only the results are scoped.
 */
export interface PlaySpace {
  id: string;
  name: string;
  /** Free text such as "Birreria Da Gino, sala sul retro". No coordinates, no address. */
  place: string | null;
  /** How to find the board: "il totem vicino al bancone". */
  targetDescription: string | null;
  /** True only for the built-in Bite the Trouble space: recognised by id, never by name. */
  canonical: boolean;
  /** Account (or operator) that created it; null for the canonical space. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Stable id of the canonical Bite the Trouble play space, the same on every installation. */
export const BT_PLAY_SPACE_ID = '00000000-0000-4000-8000-00000000b7d1';
export const BT_PLAY_SPACE: PlaySpace = Object.freeze({
  id: BT_PLAY_SPACE_ID,
  name: 'Bite the Trouble',
  place: null,
  targetDescription: null,
  canonical: true,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 0,
});

/**
 * Lists the spaces of an installation: the canonical one is always present and cannot be
 * overridden by a stored record (a space merely named "BT" is a different space).
 */
export function withCanonicalPlaySpace(stored: readonly PlaySpace[]): PlaySpace[] {
  return [BT_PLAY_SPACE, ...stored.filter((p) => p.id !== BT_PLAY_SPACE_ID)];
}

/** The play space of a tournament: null for data from before play spaces (unclassified). */
export const playSpaceOf = (t: Pick<Tournament, 'playSpaceId'>): string | null =>
  t.playSpaceId ?? null;

/**
 * The tournaments that count for one play space. Unclassified (legacy) tournaments belong to
 * no space until they are assigned: they stay in the history but feed no scoreboard.
 */
export function inPlaySpace<T extends Pick<Tournament, 'playSpaceId'>>(
  tournaments: readonly T[],
  playSpaceId: string,
): T[] {
  return tournaments.filter((t) => playSpaceOf(t) === playSpaceId);
}

/** Tournaments not yet assigned to a play space (data created before they existed). */
export const unclassified = <T extends Pick<Tournament, 'playSpaceId'>>(
  tournaments: readonly T[],
): T[] => tournaments.filter((t) => playSpaceOf(t) === null);

const clean = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
};
/** Normalises the descriptive fields of a new play space; the name is mandatory. */
export function playSpaceFields(input: {
  name?: unknown;
  place?: unknown;
  targetDescription?: unknown;
}) {
  const name = clean(input.name, 80);
  return {
    name,
    place: clean(input.place, 160),
    targetDescription: clean(input.targetDescription, 240),
  };
}

/**
 * Provenance of a tournament: one stamp per version, in order. A copy descends from another
 * when the other's stamps are a prefix of its own. A higher version number alone proves
 * nothing: two phones that each kept scoring the same tournament both reach version 9.
 */
export type Ancestry = 'same' | 'newer' | 'older' | 'diverged';
export function ancestry(
  mine: Pick<Tournament, 'lineage' | 'version'>,
  theirs: Pick<Tournament, 'lineage' | 'version'>,
): Ancestry {
  const a = mine.lineage ?? [];
  const b = theirs.lineage ?? [];
  // Without provenance on either side nothing proves that one copy continues the other.
  if (!a.length || !b.length) return 'diverged';
  const prefix = (short: string[], long: string[]) => short.every((stamp, i) => long[i] === stamp);
  if (a.length === b.length) return prefix(a, b) ? 'same' : 'diverged';
  return a.length < b.length
    ? prefix(a, b)
      ? 'older'
      : 'diverged'
    : prefix(b, a)
      ? 'newer'
      : 'diverged';
}
