/**
 * Who is in entry on the result screen, kept apart from React so that it can be tested. The
 * screen never chooses by itself a competitor whose result is already recorded: overwriting a
 * value is a correction, and a correction starts only from an explicit tap.
 */
export interface Seat {
  tournamentEntryId: string;
}

/** The competitor in entry: the one tapped, else the first still without a result. */
export function currentEntry(
  playing: Seat[],
  selected: string | null,
  isRecorded: (entryId: string) => boolean,
): string | null {
  if (selected && playing.some((p) => p.tournamentEntryId === selected)) return selected;
  return playing.find((p) => !isRecorded(p.tournamentEntryId))?.tournamentEntryId ?? null;
}

/**
 * After a save: the next competitor without a result, in playing order after the one just
 * saved and then from the start. Null when everyone in `order` has a result.
 */
export function nextAfter(
  order: Seat[],
  saved: string | null,
  isPending: (entryId: string) => boolean,
): string | null {
  const after = order.findIndex((p) => p.tournamentEntryId === saved);
  const rotated = [...order.slice(after + 1), ...order.slice(0, after + 1)];
  return rotated.find((p) => isPending(p.tournamentEntryId))?.tournamentEntryId ?? null;
}

/** Digits typed and not confirmed yet, with the competitor they were typed for. */
export interface Draft {
  entryId: string;
  value: string;
}
export const serializeDraft = (draft: Draft | null) => (draft ? JSON.stringify(draft) : '');
/**
 * Reads a stored draft. Drafts of earlier versions held the digits only: without the
 * competitor they could be confirmed for somebody else after a reload, so they are dropped.
 */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<Draft> | null;
    return typeof draft?.entryId === 'string' &&
      typeof draft.value === 'string' &&
      /^\d{1,5}$/.test(draft.value)
      ? { entryId: draft.entryId, value: draft.value }
      : null;
  } catch {
    return null;
  }
}
