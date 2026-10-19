import { ensure, type Match, type Rotation, type Tournament } from '../model.js';
import { memberIds } from './entries.js';

export type RotationAction = 'advance' | 'undo' | 'pause' | 'resume' | 'reorder';
export interface RotationView {
  entryId: string;
  order: string[];
  /** Expected thrower now, and after them; null while paused (free mode). */
  current: string | null;
  next: string | null;
  paused: boolean;
  canUndo: boolean;
}

/** Pure rotation step: never records a score, only who is expected at the board. */
export function rotate(rotation: Rotation, action: RotationAction, order?: string[]): Rotation {
  const n = rotation.order.length;
  switch (action) {
    case 'advance':
      ensure(!rotation.paused, 'ROTATION_PAUSED', 'Resume the rotation first');
      return {
        ...rotation,
        position: (rotation.position + 1) % n,
        history: [...rotation.history, rotation.position].slice(-50),
      };
    case 'undo': {
      ensure(rotation.history.length > 0, 'NOTHING_TO_UNDO', 'No advance to undo');
      return {
        ...rotation,
        position: rotation.history.at(-1)!,
        history: rotation.history.slice(0, -1),
      };
    }
    case 'pause':
      return { ...rotation, paused: true };
    case 'resume':
      return { ...rotation, paused: false };
    case 'reorder': {
      ensure(
        !!order &&
          order.length === n &&
          new Set(order).size === n &&
          order.every((id) => rotation.order.includes(id)),
        'INVALID_ROTATION',
        'The new order must list every member once',
        422,
      );
      // The expected thrower stays the same person in the new order.
      const current = rotation.order[rotation.position]!;
      return { ...rotation, order: [...order!], position: order!.indexOf(current), history: [] };
    }
  }
}
export function rotationView(rotation: Rotation): RotationView {
  const n = rotation.order.length;
  return {
    entryId: rotation.entryId,
    order: rotation.order,
    current: rotation.paused ? null : rotation.order[rotation.position]!,
    next: rotation.paused ? null : rotation.order[(rotation.position + 1) % n]!,
    paused: rotation.paused,
    canUndo: rotation.history.length > 0,
  };
}
/** The rotation of a team in a match, created from the team order the first time. */
export function rotationFor(t: Tournament, m: Match, entryId: string): Rotation {
  const existing = m.rotations.find((r) => r.entryId === entryId);
  if (existing) return existing;
  const entry = t.entries.find((e) => e.id === entryId);
  ensure(entry, 'NOT_FOUND', 'Entry not found', 404);
  return { entryId, order: memberIds(entry), position: 0, paused: false, history: [] };
}
/** Applies a rotation action of a team taking part in the match. */
export function rotateTeam(
  t: Tournament,
  m: Match,
  entryId: string,
  action: RotationAction,
  order?: string[],
) {
  ensure(
    t.status === 'active' || t.status === 'paused',
    'TOURNAMENT_NOT_ACTIVE',
    'Tournament must be in progress',
  );
  ensure(m.status !== 'cancelled', 'MATCH_CANCELLED', 'The match was cancelled');
  ensure(
    m.participants.some((p) => p.tournamentEntryId === entryId),
    'INVALID_RESULT',
    'The team does not play this match',
    422,
  );
  const next = rotate(rotationFor(t, m, entryId), action, order);
  m.rotations = [...m.rotations.filter((r) => r.entryId !== entryId), next];
  m.version++;
  return next;
}
/** Views of every team of the match (singles have nobody to rotate). */
export function rotationsOf(t: Tournament, m: Match): RotationView[] {
  return m.participants
    .map((p) => t.entries.find((e) => e.id === p.tournamentEntryId))
    .filter((e) => e && e.members.length > 1)
    .map((e) => rotationView(rotationFor(t, m, e!.id)));
}
