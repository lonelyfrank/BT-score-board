import type { Match, Tournament } from './game.js';

/** What a participant is told about the turn, derived from the engine's own plan. */
export type TurnNotice =
  | { kind: 'you'; round: number }
  | { kind: 'next'; round: number }
  | { kind: 'other'; label: string; round: number }
  /** The match is not at a turn: not started, paused, or over. */
  | { kind: 'idle'; reason: 'ready' | 'paused' | 'interrupted' | 'completed' }
  /** Only the final result is recorded: no turn is known and none is invented. */
  | { kind: 'unknown' }
  /** The connection is down: the last state is frozen and says nothing about whose turn it is. */
  | { kind: 'stale' };

export interface Seat {
  entryId: string;
  label: string;
  mine: boolean;
  /** Who throws for a team, when a rotation is configured. */
  thrower: string | null;
  current: boolean;
  next: boolean;
  value: number | null;
  recorded: number;
}
const label = (t: Tournament, entryId: string) => {
  const e = t.entries.find((x) => x.id === entryId);
  return e ? (e.kind === 'team' && e.name) || e.members.map((m) => m.displayName).join(' + ') : '?';
};

/**
 * The turn of a match for one person. `connected` false returns `stale`: a frozen screen must
 * never say "Tocca a te" as if it were current. `mine` are the entries the person plays in
 * (resolved through the account's linked player on the server's side, never typed by hand).
 */
export function turnNotice(
  t: Tournament,
  m: Match,
  mine: ReadonlySet<string>,
  connected: boolean,
): TurnNotice {
  if (!connected) return { kind: 'stale' };
  if (m.status === 'completed' || m.status === 'cancelled')
    return { kind: 'idle', reason: 'completed' };
  // Final results only: the app does not know the turns, so it does not announce them.
  if (t.tracking === 'FINAL_ONLY' && t.recording === 'result') return { kind: 'unknown' };
  const plan = m.turnPlans.find((p) => p.state !== 'completed') ?? m.turnPlans[0];
  if (!plan) return { kind: 'unknown' };
  if (plan.state === 'ready') return { kind: 'idle', reason: 'ready' };
  if (plan.state === 'paused') return { kind: 'idle', reason: 'paused' };
  if (plan.state === 'interrupted') return { kind: 'idle', reason: 'interrupted' };
  if (plan.state === 'completed') return { kind: 'idle', reason: 'completed' };
  if (plan.current && mine.has(plan.current.entryId))
    return { kind: 'you', round: plan.current.round };
  if (plan.next && mine.has(plan.next.entryId)) return { kind: 'next', round: plan.next.round };
  return plan.current
    ? { kind: 'other', label: label(t, plan.current.entryId), round: plan.current.round }
    : { kind: 'unknown' };
}

/** The seats in throwing order with the totals recorded so far. */
export function seatsOf(t: Tournament, m: Match, mine: ReadonlySet<string>): Seat[] {
  const plan = m.turnPlans.find((p) => p.state !== 'completed') ?? m.turnPlans[0];
  const order =
    plan?.seats ??
    [...m.participants]
      .sort((a, b) => a.playingOrder - b.playingOrder)
      .map((p) => p.tournamentEntryId);
  return order.map((entryId) => {
    const progress = m.progress.find((p) => p.tournamentEntryId === entryId);
    const rotation = m.rotationViews.find((r) => r.entryId === entryId);
    const entry = t.entries.find((e) => e.id === entryId);
    const throwerId =
      plan?.current?.entryId === entryId ? plan.current.playerId : (rotation?.current ?? null);
    return {
      entryId,
      label: label(t, entryId),
      mine: mine.has(entryId),
      thrower: throwerId
        ? (entry?.members.find((x) => x.playerId === throwerId)?.displayName ?? null)
        : null,
      current: plan?.current?.entryId === entryId,
      next: plan?.next?.entryId === entryId,
      value: progress?.official ?? progress?.computed ?? progress?.partialValue ?? null,
      recorded: progress?.recorded ?? 0,
    };
  });
}

/** Entries of a tournament the player (resolved through their links) belongs to. */
export function entriesOf(t: Tournament, playerIds: ReadonlySet<string>): Set<string> {
  return new Set(
    t.entries
      .filter((e) =>
        (e.members.length ? e.members.map((x) => x.playerId) : [e.playerId]).some((id) =>
          playerIds.has(id),
        ),
      )
      .map((e) => e.id),
  );
}
