import {
  ensure,
  type Context,
  type Heat,
  type HeatStatus,
  type HeatStrategy,
  type Match,
  type Tournament,
} from '../model.js';
import { games } from '../games/catalog.js';
import { chunk, evenSizes, shuffle } from './random.js';

/** Most seats a heat can be configured with (the totem verified so far has four). */
export const MAX_HEAT_CAPACITY = 8;

export const heatTransitions: Record<HeatStatus, HeatStatus[]> = {
  pending: ['ready', 'active', 'cancelled'],
  ready: ['pending', 'active', 'cancelled'],
  active: ['completed', 'cancelled'],
  // A cleared result reopens a played heat; nothing else changes it.
  completed: ['active'],
  cancelled: [],
};
export function transitionHeat(heat: Heat, to: HeatStatus) {
  ensure(
    heatTransitions[heat.status].includes(to),
    'INVALID_STATE',
    `Cannot transition heat from ${heat.status} to ${to}`,
  );
  heat.status = to;
}

/** Seats per heat: the configured capacity, or the most players of the game on the totem. */
export const heatCapacity = (t: Tournament) =>
  t.tournamentConfiguration.heatCapacity ?? games[t.gameMode].players.max;

/**
 * Splits entries into heats of at most `capacity` seats. Sequential keeps the registration
 * order and fills each heat (19 in fours: 4, 4, 4, 4, 3); random shuffles; balanced keeps the
 * order with sizes differing by at most one (17 in fours: 4, 4, 3, 3, 3). Never drops or
 * duplicates an entry, and never refuses a heat because it is not full.
 */
export function planHeats(
  entryIds: string[],
  capacity: number,
  strategy: HeatStrategy,
  random: () => number = Math.random,
): string[][] {
  ensure(
    Number.isInteger(capacity) && capacity >= 1 && capacity <= MAX_HEAT_CAPACITY,
    'INVALID_HEAT_CAPACITY',
    `Heat capacity between 1 and ${MAX_HEAT_CAPACITY}`,
    422,
  );
  ensure(new Set(entryIds).size === entryIds.length, 'DUPLICATE_ENTRY', 'Entries must be unique');
  if (!entryIds.length) return [];
  const count = Math.ceil(entryIds.length / capacity);
  if (strategy === 'sequential')
    return chunk(
      entryIds,
      Array.from({ length: count }, (_, i) => Math.min(capacity, entryIds.length - i * capacity)),
    );
  const ordered = strategy === 'random' ? shuffle(entryIds, random) : entryIds;
  return chunk(ordered, evenSizes(entryIds.length, count));
}

const live = (m: Match) => m.heats.filter((h) => h.status !== 'cancelled');
/** More than one heat: entries of different sessions are compared by their scores only. */
export const multiHeat = (m: Pick<Match, 'heats'>) =>
  m.heats.filter((h) => h.status !== 'cancelled').length > 1;
export const heatOf = (m: Match, entryId: string) =>
  live(m).find((h) => h.entryIds.includes(entryId)) ?? null;
const editable = (h: Heat) => h.status === 'pending' || h.status === 'ready';
function renumber(m: Match) {
  m.heats.forEach((h, i) => (h.number = i + 1));
}
function newHeat(m: Match, entryIds: string[], c: Context): Heat {
  return {
    id: c.id(),
    matchId: m.id,
    number: 0,
    entryIds,
    status: 'pending',
    startedAt: null,
    completedAt: null,
  };
}

/** Heats of a new match when its entries exceed the seats of the totem. */
export function initialHeats(t: Tournament, m: Match, c: Context) {
  if (t.recording !== 'result') return;
  const capacity = heatCapacity(t);
  const ids = m.participants.map((p) => p.tournamentEntryId);
  if (ids.length <= capacity) return;
  m.heats = planHeats(ids, capacity, t.tournamentConfiguration.heatStrategy, c.random).map(
    (entries) => newHeat(m, entries, c),
  );
  renumber(m);
}

function assertEditable(t: Tournament, m: Match) {
  ensure(t.recording === 'result', 'RECORDING_MISMATCH', 'Heats exist for recorded results only');
  ensure(
    ['active', 'ready', 'registration', 'draft'].includes(t.status),
    'TOURNAMENT_NOT_ACTIVE',
    'Tournament must be active',
  );
  ensure(
    !['completed', 'cancelled'].includes(m.status),
    'INVALID_STATE',
    'Heats of a finished match cannot change',
  );
  const stage = t.stages.find((s) => s.id === m.stageId);
  ensure(stage?.status === 'open', 'STAGE_CLOSED', 'Stage must be open');
}
/** Entries still to be placed: those not in a started, played or confirmed heat. */
function placeable(m: Match) {
  const fixed = new Set(m.heats.filter((h) => h.status !== 'pending').flatMap((h) => h.entryIds));
  return m.participants.map((p) => p.tournamentEntryId).filter((id) => !fixed.has(id));
}

/**
 * Plans again the entries of pending heats (and entries in no heat). Confirmed (ready), active
 * and played heats are kept as they are, so a reshuffle never touches what was already played.
 */
export function generateHeats(
  t: Tournament,
  m: Match,
  input: { strategy: HeatStrategy; capacity?: number | null; seed?: number | null },
  c: Context,
  random: () => number = c.random ?? Math.random,
) {
  assertEditable(t, m);
  const capacity = input.capacity ?? heatCapacity(t);
  ensure(
    capacity <= heatCapacity(t),
    'INVALID_HEAT_CAPACITY',
    'A heat cannot hold more entries than the seats configured for the totem',
    422,
  );
  const ids = placeable(m);
  const planned = planHeats(ids, capacity, input.strategy, random);
  m.heats = [
    ...m.heats.filter((h) => !(h.status === 'pending')),
    ...planned.map((entries) => newHeat(m, entries, c)),
  ];
  renumber(m);
  m.version++;
}

export interface HeatLayout {
  heatId?: string | null;
  entryIds: string[];
}
/**
 * Manual arrangement of the heats not started yet, in their new order: moves, swaps, merges,
 * splits and new heats are all expressed as the resulting layout. Confirmed heats must appear
 * unchanged; started and played heats stay first. Every entry of the match must end up in
 * exactly one heat with at most `capacity` seats.
 */
export function arrangeHeats(t: Tournament, m: Match, layout: HeatLayout[], c: Context) {
  assertEditable(t, m);
  const capacity = heatCapacity(t);
  const started = m.heats.filter((h) => !editable(h));
  const startedIds = new Set(started.flatMap((h) => h.entryIds));
  const expected = m.participants
    .map((p) => p.tournamentEntryId)
    .filter((id) => !startedIds.has(id));
  const given = layout.flatMap((h) => h.entryIds);
  ensure(
    given.length === expected.length &&
      new Set(given).size === given.length &&
      given.every((id) => expected.includes(id)),
    'INVALID_HEATS',
    'Every entry still to play must be in exactly one heat',
    422,
  );
  ensure(
    layout.every((h) => h.entryIds.length >= 1 && h.entryIds.length <= capacity),
    'INVALID_HEATS',
    `Each heat holds 1 to ${capacity} entries`,
    422,
  );
  const used = new Set<string>();
  const arranged = layout.map((h) => {
    const existing = h.heatId ? m.heats.find((x) => x.id === h.heatId) : undefined;
    ensure(!h.heatId || (existing && editable(existing)), 'INVALID_HEATS', 'Unknown heat', 422);
    ensure(!existing || !used.has(existing.id), 'INVALID_HEATS', 'A heat appears twice', 422);
    if (existing) {
      used.add(existing.id);
      if (existing.status === 'ready')
        ensure(
          existing.entryIds.length === h.entryIds.length &&
            existing.entryIds.every((id, i) => id === h.entryIds[i]),
          'HEAT_LOCKED',
          'Unlock a confirmed heat before changing it',
        );
      return { ...existing, entryIds: [...h.entryIds] };
    }
    return newHeat(m, [...h.entryIds], c);
  });
  // Confirmed heats left out of the layout would lose their entries: they must be listed.
  ensure(
    m.heats.filter((h) => h.status === 'ready').every((h) => used.has(h.id)),
    'HEAT_LOCKED',
    'Unlock a confirmed heat before removing it',
  );
  m.heats = [...started, ...arranged];
  renumber(m);
  m.version++;
}

const heatById = (m: Match, heatId: string) => {
  const h = m.heats.find((x) => x.id === heatId);
  ensure(h, 'NOT_FOUND', 'Heat not found', 404);
  return h;
};
/** Confirms (locks) or releases a heat not started yet. */
export function lockHeat(t: Tournament, m: Match, heatId: string, locked: boolean) {
  assertEditable(t, m);
  const h = heatById(m, heatId);
  transitionHeat(h, locked ? 'ready' : 'pending');
  m.version++;
}

/** The heat at the board, in any match of the tournament (one totem). */
export const activeHeat = (t: Tournament) =>
  t.matches.flatMap((m) => m.heats).find((h) => h.status === 'active') ?? null;

/**
 * Puts a heat at the board. One totem: refused while another heat or match is in play. The
 * match starts with its first heat.
 */
export function startHeat(t: Tournament, m: Match, heatId: string, c: Context) {
  ensure(t.status === 'active', 'TOURNAMENT_NOT_ACTIVE', 'Tournament must be active');
  const stage = t.stages.find((s) => s.id === m.stageId);
  ensure(stage?.status === 'open', 'STAGE_CLOSED', 'Stage must be open');
  const h = heatById(m, heatId);
  const busy = activeHeat(t);
  ensure(!busy || busy.id === h.id, 'HEAT_BUSY', 'Complete the heat at the board first');
  if (h.status === 'active') return;
  ensure(
    !t.matches.some((x) => x.id !== m.id && ['active', 'paused'].includes(x.status)),
    'BOARD_BUSY',
    'Another match is using the board',
  );
  transitionHeat(h, 'active');
  h.startedAt ??= c.now();
  if (m.status === 'ready' || m.status === 'scheduled') {
    m.status = 'active';
    m.startedAt ??= c.now();
  }
  m.version++;
}

/** Entries of a heat whose result counts (withdrawn players of the phase are left out). */
function counted(t: Tournament, m: Match, h: Heat) {
  const excluded = t.stages.find((s) => s.id === m.stageId)?.excludedEntryIds ?? [];
  return h.entryIds.filter((id) => !excluded.includes(id));
}
/** Every counted entry of the heat has its final result, or the match is decided. */
export function heatComplete(t: Tournament, m: Match, h: Heat) {
  if (m.status === 'completed') return true;
  return counted(t, m, h).every((id) => (m.result?.scores[id] ?? null) !== null);
}
/**
 * Frees the board explicitly. Missing results stay missing (the overview lists them) and can
 * be recorded later as a late entry: the ranking waits for them, it never assumes zero.
 */
export function completeHeat(t: Tournament, m: Match, heatId: string, c: Context) {
  ensure(t.status === 'active', 'TOURNAMENT_NOT_ACTIVE', 'Tournament must be active');
  const h = heatById(m, heatId);
  ensure(h.status === 'active', 'INVALID_STATE', 'Only the heat at the board can be completed');
  transitionHeat(h, 'completed');
  h.completedAt = c.now();
  m.version++;
}

/**
 * Before a value is recorded for these entries: their heat must be at the board or already
 * played (a correction). A heat waiting its turn is put at the board when the board is free.
 */
export function heatForEntry(t: Tournament, m: Match, entryId: string, c: Context) {
  const h = heatOf(m, entryId);
  if (!h || h.status === 'active' || h.status === 'completed') return h;
  const busy = activeHeat(t);
  ensure(!busy, 'HEAT_BUSY', 'Complete the heat at the board first');
  transitionHeat(h, 'active');
  h.startedAt ??= c.now();
  return h;
}

/**
 * Keeps heat states in line with the results: a heat at the board whose results are all in is
 * completed, a heat whose entries all withdrew is cancelled. A played heat that misses a result
 * again (a cleared value) stays played: the overview lists the value as missing.
 */
export function syncHeats(t: Tournament, m: Match, c: Context) {
  for (const h of m.heats) {
    if (h.status === 'cancelled') continue;
    if (!counted(t, m, h).length && h.status !== 'completed') {
      h.status = 'cancelled';
      h.completedAt = c.now();
      continue;
    }
    const done = heatComplete(t, m, h);
    if (h.status === 'active' && done) {
      h.status = 'completed';
      h.completedAt = c.now();
    }
  }
}

export interface HeatView {
  heatId: string;
  number: number;
  status: HeatStatus;
  entryIds: string[];
  /** Counted entries still without a final result. */
  missing: string[];
}
export interface HeatOverview {
  heats: HeatView[];
  currentHeatId: string | null;
  nextHeatId: string | null;
  completed: number;
  /** Entries of heats not started yet. */
  waiting: string[];
}
/** Which heat is at the board, which comes next, what is done and who is still waiting. */
export function heatOverview(t: Tournament, m: Match): HeatOverview {
  const heats = m.heats.map((h) => ({
    heatId: h.id,
    number: h.number,
    status: h.status,
    entryIds: h.entryIds,
    missing:
      h.status === 'cancelled'
        ? []
        : counted(t, m, h).filter((id) => (m.result?.scores[id] ?? null) === null),
  }));
  const current = m.heats.find((h) => h.status === 'active') ?? null;
  const next = m.heats.find((h) => editable(h)) ?? null;
  return {
    heats,
    currentHeatId: current?.id ?? null,
    nextHeatId: next?.id ?? null,
    completed: m.heats.filter((h) => h.status === 'completed').length,
    waiting: m.heats.filter(editable).flatMap((h) => h.entryIds),
  };
}
