import { describe, expect, it } from 'vitest';
import { applyState } from '../apps/web/src/services/live.js';
import { turnNotice, seatsOf } from '../apps/web/src/services/follow.js';
import type { Match, Tournament } from '../apps/web/src/services/game.js';

const entry = (id: string, name: string, playerIds = [id + '-p']) => ({
  id,
  tournamentId: 't',
  playerId: playerIds[0]!,
  displayNameAtRegistration: name,
  kind: playerIds.length > 1 ? 'team' : 'single',
  name: playerIds.length > 1 ? name : null,
  members: playerIds.map((p) => ({ playerId: p, displayName: playerIds.length > 1 ? p : name })),
  seed: null,
  status: 'registered',
  registeredAt: 'x',
});
const tournament = (tracking: string, recording = 'result') =>
  ({
    id: 't',
    tracking,
    recording,
    entries: [entry('a', 'Ann'), entry('b', 'Bob'), entry('c', 'Team', ['c1', 'c2'])],
  }) as unknown as Tournament;
const plan = (over: Record<string, unknown> = {}) => ({
  heatId: null,
  heatNumber: null,
  seats: ['a', 'b', 'c'],
  rounds: 7,
  state: 'in_progress',
  current: { entryId: 'a', round: 2, playerId: null },
  next: { entryId: 'b', round: 2, playerId: null },
  round: 2,
  ...over,
});
const match = (plans: unknown[], over: Record<string, unknown> = {}) =>
  ({
    status: 'active',
    participants: [],
    progress: [],
    rotationViews: [],
    turnPlans: plans,
    ...over,
  }) as unknown as Match;

describe('what a participant is told about the turn', () => {
  const t = tournament('ROUND_BY_ROUND');
  it('says it is their turn, or that they are next, from the engine plan', () => {
    expect(turnNotice(t, match([plan()]), new Set(['a']), true)).toEqual({ kind: 'you', round: 2 });
    expect(turnNotice(t, match([plan()]), new Set(['b']), true)).toEqual({
      kind: 'next',
      round: 2,
    });
    expect(turnNotice(t, match([plan()]), new Set(['c']), true)).toMatchObject({
      kind: 'other',
      label: 'Ann',
    });
  });
  it('never says "your turn" while the connection is down', () => {
    expect(turnNotice(t, match([plan()]), new Set(['a']), false)).toEqual({ kind: 'stale' });
  });
  it('does not invent turns when only the final result is recorded', () => {
    expect(turnNotice(tournament('FINAL_ONLY'), match([plan()]), new Set(['a']), true)).toEqual({
      kind: 'unknown',
    });
  });
  it('reports a match that is not at a turn', () => {
    expect(turnNotice(t, match([plan({ state: 'ready' })]), new Set(['a']), true)).toEqual({
      kind: 'idle',
      reason: 'ready',
    });
    expect(turnNotice(t, match([plan({ state: 'paused' })]), new Set(['a']), true)).toEqual({
      kind: 'idle',
      reason: 'paused',
    });
    expect(turnNotice(t, match([plan()], { status: 'completed' }), new Set(['a']), true)).toEqual({
      kind: 'idle',
      reason: 'completed',
    });
  });
  it('shows the thrower of a team when a rotation is configured', () => {
    const m = match([plan({ current: { entryId: 'c', round: 1, playerId: 'c2' }, next: null })], {
      rotationViews: [
        {
          entryId: 'c',
          order: ['c1', 'c2'],
          current: 'c2',
          next: 'c1',
          paused: false,
          canUndo: false,
        },
      ],
    });
    const seat = seatsOf(t, m, new Set(['c'])).find((s) => s.entryId === 'c')!;
    expect(seat).toMatchObject({ current: true, mine: true, thrower: 'c2' });
  });
});

describe('ordering of live updates', () => {
  const state = (version: number) => ({ type: 'state', version }) as never;
  it('applies only newer states: duplicates and out-of-order ones are dropped', () => {
    let current = applyState(null, state(3));
    expect(current?.version).toBe(3);
    expect(applyState(current, state(3))).toBeNull();
    expect(applyState(current, state(2))).toBeNull();
    current = applyState(current, state(7)); // a gap: the full state repairs it
    expect(current?.version).toBe(7);
  });
});
