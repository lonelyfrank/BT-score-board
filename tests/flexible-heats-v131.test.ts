import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../packages/application/src/index.js';
import {
  arrangeHeats,
  generateHeats,
  heatCapacity,
  heatSlots,
  physicalSeat,
  planHeats,
  turnPlan,
  type GameMode,
  type Tournament,
} from '../packages/domain/src/index.js';
import { LocalEngine, createBackup, readBackup } from '../packages/local-store/src/index.js';
import { setup, command } from './helpers.js';

const context = {
  id: randomUUID,
  now: () => '2026-10-21T18:00:00Z',
  operator: 'test',
  role: 'organizer' as const,
};
const stores: ReturnType<typeof setup>['store'][] = [];
const engines: LocalEngine[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  engines.splice(0).forEach((e) => e.close());
  vi.restoreAllMocks();
});
function backend() {
  const s = setup();
  stores.push(s.store);
  return s.backend;
}
function competition(
  b: Backend,
  count: number,
  options: {
    game?: GameMode;
    mode?: Tournament['mode'];
    tracking?: Tournament['tracking'];
    mixed?: boolean;
  } = {},
) {
  let t = b.createTournament({
    name: 'Flexible V1.3.1',
    mode: options.mode ?? 'SINGLE_MATCH',
    gameMode: options.game ?? 'HI_SCORE',
    tracking: options.tracking ?? 'FLEXIBLE',
  });
  const players = Array.from(
    { length: count + (options.mixed ? 2 : 0) },
    (_, i) => b.createPlayer({ displayName: `Player ${i + 1}` }).id,
  );
  const units = options.mixed
    ? [players.slice(0, 2), players.slice(2, 4), ...players.slice(4).map((p) => [p])]
    : players.map((p) => [p]);
  t = command(b, t, 'ComposeEntries', { entries: units.map((playerIds) => ({ playerIds })) });
  return command(b, t, 'StartTournament');
}
const layouts = (t: Tournament) =>
  t.matches[0]!.heats.map((h) => ({
    heatId: h.id,
    entryIds: [...h.entryIds],
    ...(h.slotPositions ? { slotPositions: h.slotPositions } : {}),
  }));
const sizes = (t: Tournament) => t.matches[0]!.heats.map((h) => h.entryIds.length);

const distributions = [
  [1, [1]],
  [3, [3]],
  [4, [4]],
  [5, [4, 1]],
  [7, [4, 3]],
  [8, [4, 4]],
  [11, [4, 4, 3]],
  [13, [4, 4, 4, 1]],
  [15, [4, 4, 4, 3]],
  [17, [4, 4, 4, 4, 1]],
  [19, [4, 4, 4, 4, 3]],
] as const;
describe('Flexible heat invariants V1.3.1', () => {
  it.each(distributions)('defaults to sequential for %i participants', (n, expected) => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    expect(planHeats(ids, 4).map((h) => h.length)).toEqual(expected);
    expect(planHeats(ids, 4).flat()).toEqual(ids);
    const t = competition(backend(), n);
    expect(t.tournamentConfiguration.heatStrategy).toBe('sequential');
    expect(t.matches[0]!.heats.length ? sizes(t) : [t.matches[0]!.participants.length]).toEqual(
      expected,
    );
  });
  it.each([
    [13, [4, 3, 3, 3]],
    [17, [4, 4, 3, 3, 3]],
  ] as const)('keeps balanced available for %i', (n, expected) => {
    const t = competition(backend(), n);
    generateHeats(t, t.matches[0]!, { strategy: 'balanced' }, context);
    expect(sizes(t)).toEqual(expected);
  });
  it.each([
    [4, 4, 4, 1],
    [4, 4, 3, 2],
    [4, 3, 3, 3],
    [3, 3, 3, 2, 2],
  ])('accepts custom layout %j', (...sizeList) => {
    const t = competition(backend(), 13);
    const ids = t.entries.map((e) => e.id);
    let from = 0;
    const layout = sizeList.map((n) => ({ entryIds: ids.slice(from, (from += n)) }));
    arrangeHeats(t, t.matches[0]!, layout, context);
    expect(sizes(t)).toEqual(sizeList);
  });
  it('moves, swaps, reorders, creates and removes heats, preserving physical gaps', () => {
    const b = backend();
    let t = competition(b, 5);
    const m = t.matches[0]!;
    const [a, bId, c, d, e] = t.entries.map((e) => e.id);
    t = command(
      b,
      t,
      'ArrangeHeats',
      {
        heats: [
          { heatId: m.heats[1]!.id, entryIds: [e, bId], slotPositions: [1, 4] },
          { heatId: m.heats[0]!.id, entryIds: [c, a], slotPositions: [2, 3] },
          { entryIds: [d], slotPositions: [4] },
        ],
      },
      m.id,
    );
    expect(heatSlots(t.matches[0]!.heats[0]!, 4)).toEqual([e, null, null, bId]);
    expect(turnPlan(t, t.matches[0]!).seats).toEqual([e, bId]);
    expect(turnPlan(t, t.matches[0]!).next?.entryId).toBe(bId);
    const merged = [
      { heatId: m.heats[1]!.id, entryIds: [e, bId, d] },
      { heatId: m.heats[0]!.id, entryIds: [a, c] },
    ];
    t = command(b, t, 'ArrangeHeats', { heats: merged }, m.id);
    expect(sizes(t)).toEqual([3, 2]);
  });
  it.each([
    'duplicate',
    'missing',
    'overflow',
    'empty',
    'slots-duplicate',
    'slots-reverse',
    'slots-range',
    'slots-length',
    'unknown-heat',
    'duplicate-heat',
  ])('rejects %s atomically', (invalid) => {
    const t = competition(backend(), 5);
    const m = t.matches[0]!;
    const before = structuredClone(m);
    const l = layouts(t);
    if (invalid === 'duplicate') l[1]!.entryIds = [l[0]!.entryIds[0]!];
    if (invalid === 'missing') l[0]!.entryIds.pop();
    if (invalid === 'overflow') {
      l[0]!.entryIds.push(...l[1]!.entryIds);
      l.pop();
    }
    if (invalid === 'empty') l.push({ entryIds: [], heatId: '' });
    if (invalid === 'slots-duplicate') l[0]!.slotPositions = [1, 2, 2, 4];
    if (invalid === 'slots-reverse') l[0]!.slotPositions = [4, 3, 2, 1];
    if (invalid === 'slots-range') l[1]!.slotPositions = [5];
    if (invalid === 'slots-length') l[1]!.slotPositions = [];
    if (invalid === 'unknown-heat') l[1]!.heatId = randomUUID();
    if (invalid === 'duplicate-heat') l[1]!.heatId = l[0]!.heatId;
    expect(() => arrangeHeats(t, m, l, context)).toThrow();
    expect(m).toEqual(before);
  });
  it('protects a completed heat played out of order, including its number and historical thrower', () => {
    const b = backend();
    let t = competition(b, 13);
    const m = t.matches[0]!;
    const fixed = m.heats[1]!;
    t = command(b, t, 'RecordTurn', { entryId: fixed.entryIds[0], round: 1, value: 60 }, m.id);
    t = command(b, t, 'CompleteHeat', { heatId: fixed.id }, m.id);
    const before = structuredClone(t.matches[0]!);
    const l = layouts(t)
      .filter((h) => h.heatId !== fixed.id)
      .reverse();
    t = command(b, t, 'ArrangeHeats', { heats: l }, m.id);
    expect(t.matches[0]!.heats[1]).toEqual(before.heats[1]);
    expect(t.matches[0]!.rounds).toEqual(before.rounds);
    expect(() => command(b, t, 'ArrangeHeats', { heats: layouts(t) }, m.id)).toThrow(/history/);
    t = command(b, t, 'GenerateHeats', { strategy: 'sequential' }, m.id);
    expect(t.matches[0]!.heats[1]).toEqual(before.heats[1]);
  });
  it('protects history even if a historical heat incorrectly says pending, and legacy sessions without heats', () => {
    const b = backend();
    let t = competition(b, 5);
    const id = t.matches[0]!.id;
    t = command(b, t, 'RecordTurn', { entryId: t.entries[0]!.id, round: 1, value: 60 }, id);
    t = command(b, t, 'GuideTurn', { action: 'undo' }, id);
    const m = t.matches[0]!;
    m.heats[0]!.status = 'pending';
    m.heats[0]!.startedAt = null;
    expect(() => arrangeHeats(t, m, layouts(t), context)).toThrow(/history/);
    const before = structuredClone(m.heats[0]);
    generateHeats(t, m, { strategy: 'balanced' }, context);
    expect(m.heats[0]).toEqual(before);
    m.heats = [];
    expect(() => arrangeHeats(t, m, [{ entryIds: t.entries.map((e) => e.id) }], context)).toThrow(
      /started/,
    );
  });
  it('keeps confirmed heat slots and position locked until explicitly released', () => {
    const b = backend();
    let t = competition(b, 5);
    const id = t.matches[0]!.id;
    const heatId = t.matches[0]!.heats[1]!.id;
    t = command(b, t, 'LockHeat', { heatId, locked: true }, id);
    expect(() => command(b, t, 'ArrangeHeats', { heats: layouts(t).reverse() }, id)).toThrow(
      /confirmed/,
    );
    const l = layouts(t);
    l[1]!.slotPositions = [4];
    expect(() => command(b, t, 'ArrangeHeats', { heats: l }, id)).toThrow(/confirmed/);
    t = command(b, t, 'LockHeat', { heatId, locked: false }, id);
    t = command(b, t, 'ArrangeHeats', { heats: l.reverse() }, id);
    expect(t.matches[0]!.heats[0]!.slotPositions).toEqual([4]);
  });
  it('replaces an unplayed guide pick with the updated slot order', () => {
    const b = backend();
    let t = competition(b, 5);
    const id = t.matches[0]!.id;
    t = command(b, t, 'GuideTurn', { action: 'pick', entryId: t.entries[2]!.id }, id);
    const l = layouts(t);
    l[0]!.entryIds.reverse();
    t = command(b, t, 'ArrangeHeats', { heats: l }, id);
    expect(turnPlan(t, t.matches[0]!).current?.entryId).toBe(l[0]!.entryIds[0]);
    expect(t.matches[0]!.guide?.pick).toBeNull();
  });
  it.each(['501', 'EXACTA', 'ODD_EVEN'] as const)(
    'rejects independent comparisons for %s and follows reordered physical sides',
    (game) => {
      const b = backend();
      let t = competition(b, 2, { game });
      const m = t.matches[0]!;
      expect(() =>
        command(
          b,
          t,
          'ArrangeHeats',
          { heats: t.entries.map((e) => ({ entryIds: [e.id] })) },
          m.id,
        ),
      ).toThrow(/independent/);
      t = command(
        b,
        t,
        'ArrangeHeats',
        { heats: [{ entryIds: [...t.entries].reverse().map((e) => e.id) }] },
        m.id,
      );
      expect(turnPlan(t, t.matches[0]!).current?.entryId).toBe(t.entries[1]!.id);
      expect(physicalSeat(t.matches[0]!, t.entries[1]!.id)).toBe(1);
      expect(heatCapacity(t)).toBe(game === 'ODD_EVEN' ? 2 : 4);
      expect(() =>
        b.createTournament({
          name: 'Invalid',
          mode: 'SINGLE_MATCH',
          gameMode: game,
          tournamentConfiguration: { heatCapacity: game === 'ODD_EVEN' ? 4 : 5 },
        }),
      ).toThrow();
    },
  );
});

describe('Complete evening workflows', () => {
  it.each([11, 13])(
    'records %i participants through every guided round and official result',
    (count) => {
      const b = backend();
      let t = competition(b, count, { tracking: 'ROUND_BY_ROUND' });
      const id = t.matches[0]!.id;
      const heatIds = t.matches[0]!.heats.map((h) => h.id);
      for (const heatId of heatIds) {
        let plan = turnPlan(t, t.matches[0]!, heatId);
        const seats = plan.seats;
        for (let round = 1; round <= 7; round++)
          for (const entryId of seats) {
            expect(plan.current).toMatchObject({ entryId, round });
            t = command(
              b,
              t,
              'RecordTurn',
              { entryId, round, value: 10 + t.entries.findIndex((e) => e.id === entryId) },
              id,
            );
            plan = turnPlan(t, t.matches[0]!, heatId);
          }
        expect(plan.current).toBeNull();
        expect(plan.expected).toBe(7 * seats.length);
        for (const entryId of seats)
          t = command(
            b,
            t,
            'RecordResult',
            { scores: { [entryId]: 7 * (10 + t.entries.findIndex((e) => e.id === entryId)) } },
            id,
          );
      }
      expect(t.status).toBe('completed');
      expect(t.matches[0]!.rounds).toHaveLength(count * 7);
      expect(t.results).toHaveLength(count);
    },
  );
  it('qualifies the four best official totals of 15 entrants and plays the Hi-Score final', () => {
    const b = backend();
    let t = competition(b, 15, { mode: 'QUICK_HIGH_SCORE' });
    const id = t.matches[0]!.id;
    expect(sizes(t)).toEqual([4, 4, 4, 3]);
    for (const [i, entry] of t.entries.entries())
      t = command(b, t, 'RecordResult', { scores: { [entry.id]: 300 + i } }, id);
    t = command(b, t, 'FinalizeQualification');
    expect(t.stages[0]!.qualifiedEntryIds).toEqual(
      t.entries
        .slice(-4)
        .reverse()
        .map((e) => e.id),
    );
    t = command(b, t, 'GenerateFinal');
    const f = t.matches.at(-1)!;
    for (const [i, p] of f.participants.entries())
      t = command(b, t, 'RecordResult', { scores: { [p.tournamentEntryId]: 400 + i } }, f.id);
    t = command(b, t, 'CompleteTournament');
    expect(t.status).toBe('completed');
    expect(t.results).toHaveLength(15);
  });
  it('keeps mixed-team rotation, pause, undo and correction through reordered partial heats', () => {
    const b = backend();
    let t = competition(b, 5, { mixed: true });
    const id = t.matches[0]!.id;
    const [a, bTeam, c, d, e] = t.entries;
    t = command(
      b,
      t,
      'ArrangeHeats',
      {
        heats: [
          { entryIds: [e!.id, bTeam!.id, c!.id, d!.id] },
          { entryIds: [a!.id], slotPositions: [4] },
        ],
      },
      id,
    );
    const single = t.matches[0]!.heats[1]!.id;
    expect(turnPlan(t, t.matches[0]!, single).next?.playerId).toBe(a!.members[1]!.playerId);
    t = command(b, t, 'RecordTurn', { entryId: a!.id, round: 1, value: 60 }, id);
    const original = t.matches[0]!.rounds[0]!.playerId;
    t = command(b, t, 'GuideTurn', { action: 'pause' }, id);
    expect(turnPlan(t, t.matches[0]!, single).current).toBeNull();
    t = command(b, t, 'GuideTurn', { action: 'resume' }, id);
    expect(turnPlan(t, t.matches[0]!, single).current?.playerId).toBe(a!.members[1]!.playerId);
    t = command(b, t, 'GuideTurn', { action: 'undo', heatId: single }, id);
    expect(turnPlan(t, t.matches[0]!, single).current?.playerId).toBe(original);
    t = command(b, t, 'RecordTurn', { entryId: a!.id, round: 1, value: 80 }, id);
    expect(turnPlan(t, t.matches[0]!, single).current?.playerId).toBe(a!.members[1]!.playerId);
    t = command(b, t, 'RecordRound', { entryId: a!.id, round: 1, value: 90, reason: 'Totem' }, id);
    expect(t.matches[0]!.rounds.every((r) => r.playerId === original)).toBe(true);
    expect(turnPlan(t, t.matches[0]!, single).seats).toEqual([a!.id]);
  });
});

async function local(name: string) {
  const e = await LocalEngine.open({ database: { name }, channel: null });
  engines.push(e);
  return e;
}
describe('IndexedDB layout durability', () => {
  it('restores custom gaps/order after reopening and backup transfer, accepts historical layouts', async () => {
    globalThis.indexedDB = new IDBFactory();
    const name = randomUUID();
    const e = await local(name);
    let t = await e.write((b) => competition(b, 5));
    const id = t.matches[0]!.id;
    const l = layouts(t).reverse();
    l[0]!.slotPositions = [4];
    l[1]!.entryIds.reverse();
    t = await e.write((b) => command(b, t, 'ArrangeHeats', { heats: l }, id));
    e.close();
    const reopened = await local(name);
    expect(reopened.read((b) => b.tournament(t.id))).toEqual(t);
    const backup = await reopened.exportBackup();
    const copy = await local(randomUUID());
    await copy.importBackup(await readBackup(JSON.stringify(backup)), { replaceExisting: false });
    expect(copy.read((b) => b.liveMatch(id).turnPlans[0]!.seats)).toEqual(l[0]!.entryIds);
    expect(copy.read((b) => b.tournament(t.id))).toEqual(t);
    // Import an actual pre-V1.3.1 backup, with no new field and its historical balanced setting.
    const historical = structuredClone(backup.data);
    historical.tournaments[0]!.tournamentConfiguration.heatStrategy = 'balanced';
    for (const h of historical.tournaments[0]!.matches[0]!.heats) delete h.slotPositions;
    const oldBackup = await createBackup(
      historical,
      { ...backup.source, app: '1.3' },
      backup.exportedAt,
    );
    const oldDevice = await local(randomUUID());
    await oldDevice.importBackup(await readBackup(JSON.stringify(oldBackup)), {
      replaceExisting: false,
    });
    const old = oldDevice.read((b) => b.tournament(t.id));
    expect(old).toEqual(historical.tournaments[0]);
    expect(heatSlots(old.matches[0]!.heats[0]!, 4)).toEqual([l[0]!.entryIds[0], null, null, null]);
  });
  it('rolls back the entire layout, audit, command and revision after an IndexedDB write fails', async () => {
    globalThis.indexedDB = new IDBFactory();
    const name = randomUUID();
    const e = await local(name);
    const t = await e.write((b) => competition(b, 13));
    const before = await e.exportBackup();
    const revision = e.status().meta.revision;
    // Fail the metadata write after tournament/audit writes have already been enqueued.
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'meta') throw new DOMException('Disk full', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(
      e.write((b) =>
        command(b, t, 'ArrangeHeats', { heats: layouts(t).reverse() }, t.matches[0]!.id),
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_FULL' });
    vi.restoreAllMocks();
    expect(e.status().meta.revision).toBe(revision);
    expect(e.read((b) => b.tournament(t.id))).toEqual(t);
    e.close();
    const reopened = await local(name);
    expect((await reopened.exportBackup()).data).toEqual(before.data);
  });
  it('commits only one of two simultaneous tab arrangements', async () => {
    globalThis.indexedDB = new IDBFactory();
    const name = randomUUID();
    const one = await local(name);
    const t = await one.write((b) => competition(b, 13));
    const two = await local(name);
    const id = t.matches[0]!.id;
    const outcomes = await Promise.allSettled([
      one.write((b) => command(b, t, 'ArrangeHeats', { heats: layouts(t).reverse() }, id)),
      two.write((b) => command(b, t, 'GenerateHeats', { strategy: 'balanced' }, id)),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_DATA' },
    });
    const reopened = await local(name);
    const committed = reopened.read((b) => b.tournament(t.id));
    expect(committed).toEqual(
      (outcomes.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Tournament>).value,
    );
  });
});
