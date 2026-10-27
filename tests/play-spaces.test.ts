import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from '../packages/application/src/index.js';
import {
  BT_PLAY_SPACE_ID,
  ancestry,
  computeProgression,
  mergeCrew,
  matchById,
  withMembership,
  type Crew,
  type PlayerCard,
  type Tournament,
} from '../packages/domain/src/index.js';
import { LocalEngine, migrations, readBackup } from '../packages/local-store/src/index.js';
import { mergeBackupData } from '../packages/local-store/src/merge.js';

const engines: LocalEngine[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.close());
});
async function phone(name = `bt-phone-${randomUUID()}`) {
  const engine = await LocalEngine.open({ channel: null, database: { name, migrations } });
  engines.push(engine);
  return engine;
}
function exec(
  b: Backend,
  t: Tournament,
  name: Parameters<Backend['execute']>[0],
  body: Record<string, unknown> = {},
  matchId?: string,
) {
  const m = matchId ? matchById(t, matchId) : undefined;
  return b.execute(
    name,
    t.id,
    { expectedVersion: t.version, ...(m ? { expectedMatchVersion: m.version } : {}), ...body },
    { matchId, idempotencyKey: randomUUID() },
  );
}
const player = (e: LocalEngine, displayName: string) =>
  e.write((b) => b.createPlayer({ displayName }));
async function play(
  engine: LocalEngine,
  playSpaceId: string,
  ids: [string, string],
  totals: [number, number],
) {
  let t = await engine.write((b) =>
    b.createTournament({
      playSpaceId,
      name: 'Sfida',
      mode: 'SINGLE_MATCH',
      gameMode: 'HI_SCORE',
      scoringConfiguration: { turns: 7 },
    }),
  );
  for (const playerId of ids)
    t = await engine.write((b) => exec(b, t, 'RegisterPlayer', { playerId }));
  t = await engine.write((b) => exec(b, t, 'StartTournament'));
  const scores = { [t.entries[0]!.id]: totals[0], [t.entries[1]!.id]: totals[1] };
  return engine.write((b) => exec(b, t, 'RecordResult', { scores }, t.matches[0]!.id));
}
const send = async (from: LocalEngine) => readBackup(JSON.stringify(await from.exportBackup()));

describe('play spaces: identity', () => {
  it('has the canonical Bite the Trouble space, found by id and never by name', async () => {
    const e = await phone();
    expect(e.playSpaces().map((p) => p.id)).toEqual([BT_PLAY_SPACE_ID]);
    const fake = await e.createPlaySpace({ name: 'Bite the Trouble' }, 'ann');
    const other = await e.createPlaySpace({ name: 'BT' }, 'ann');
    expect(fake.canonical).toBe(false);
    expect(other.canonical).toBe(false);
    expect(new Set(e.playSpaces().map((p) => p.id)).size).toBe(3);
    expect(e.playSpaces().filter((p) => p.canonical)).toHaveLength(1);
  });

  it('creates a space idempotently and requires a name', async () => {
    const e = await phone();
    const id = randomUUID();
    const a = await e.createPlaySpace({ name: 'Da Gino', place: 'sala sul retro' }, 'ann', id);
    const b = await e.createPlaySpace({ name: 'Da Gino', place: 'sala sul retro' }, 'ann', id);
    expect(b).toEqual(a);
    expect(e.playSpaces()).toHaveLength(2);
    expect(() => e.createPlaySpace({ name: '   ' }, 'ann')).toThrow(/name/);
    // Retrying with the canonical id creates nothing and does not rename it.
    expect((await e.createPlaySpace({ name: 'Altro' }, 'ann', BT_PLAY_SPACE_ID)).name).toBe(
      'Bite the Trouble',
    );
  });

  it('refuses a new tournament without a valid play space', async () => {
    const e = await phone();
    await expect(
      e.write((b) => b.createTournament({ name: 'X', mode: 'SINGLE_MATCH' })),
    ).rejects.toThrow();
  });
});

describe('play spaces: isolated scoreboards', () => {
  it('Frank and Salvo playing elsewhere change nothing at the BT, and vice versa', async () => {
    const e = await phone();
    const frank = await player(e, 'Frank');
    const salvo = await player(e, 'Salvo');
    const bar = await e.createPlaySpace({ name: 'Da Gino' }, 'frank');
    await play(e, BT_PLAY_SPACE_ID, [frank.id, salvo.id], [300, 200]);
    const before = structuredClone(e.progression(BT_PLAY_SPACE_ID).players.get(frank.id)!);
    const recordBefore = e.progression(BT_PLAY_SPACE_ID).records.HI_SCORE;

    await play(e, bar.id, [frank.id, salvo.id], [450, 100]);
    const after = e.progression(BT_PLAY_SPACE_ID);
    expect(after.players.get(frank.id)).toEqual(before);
    expect(after.records.HI_SCORE).toEqual(recordBefore);
    expect(after.records.HI_SCORE!.value).toBe(300);
    expect(e.progression(bar.id).records.HI_SCORE!.value).toBe(450);
    expect(e.progression(bar.id).players.get(frank.id)!.stats.matches).toBe(1);

    // Then they play at the BT: only the BT context changes.
    const barBefore = structuredClone(e.progression(bar.id).players.get(frank.id)!);
    await play(e, BT_PLAY_SPACE_ID, [frank.id, salvo.id], [380, 120]);
    expect(e.progression(BT_PLAY_SPACE_ID).records.HI_SCORE!.value).toBe(380);
    expect(e.progression(bar.id).players.get(frank.id)).toEqual(barBefore);
    // The personal view counts everything for XP but names no record holder.
    const personal = e.progression();
    expect(personal.players.get(frank.id)!.stats.matches).toBe(3);
    expect(personal.records).toEqual({});
    expect(personal.players.get(frank.id)!.cosmetics.recordTitles).toEqual([]);
  });

  it('filters statistics and history by play space, with an explicit personal total', async () => {
    const e = await phone();
    const a = await player(e, 'Ann');
    const b = await player(e, 'Bob');
    const bar = await e.createPlaySpace({ name: 'Da Gino' }, 'ann');
    await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [300, 200]);
    await play(e, bar.id, [a.id, b.id], [250, 100]);
    const stats = (space?: string | null) =>
      e.read((backend) => backend.statistics(a.id, space)).matchesPlayed;
    expect(stats()).toBe(2);
    expect(stats(BT_PLAY_SPACE_ID)).toBe(1);
    expect(stats(bar.id)).toBe(1);
    expect(e.read((backend) => backend.history(a.id, { limit: 10, offset: 0 }, bar.id)).total).toBe(
      1,
    );
  });

  it('moves a tournament explicitly and recomputes both spaces without duplicates', async () => {
    const e = await phone();
    const a = await player(e, 'Ann');
    const b = await player(e, 'Bob');
    const bar = await e.createPlaySpace({ name: 'Da Gino' }, 'ann');
    const t = await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [300, 200]);
    const move = (confirm: boolean, version = t.version) =>
      e.write((backend) =>
        backend.moveTournament(t.id, {
          expectedVersion: version,
          playSpaceId: bar.id,
          confirm: confirm as true,
        }),
      );
    await expect(move(false)).rejects.toThrow();
    await expect(move(true, t.version - 1)).rejects.toThrow(/version/i);
    const moved = await move(true);
    expect(moved.playSpaceId).toBe(bar.id);
    expect(moved.version).toBe(t.version + 1);
    expect(e.progression(BT_PLAY_SPACE_ID).players.get(a.id)).toBeUndefined();
    expect(e.progression(bar.id).players.get(a.id)!.stats.matches).toBe(1);
    expect(e.progression().players.get(a.id)!.stats.matches).toBe(1);
    const audit = await e.audit(t.id);
    expect(audit.items.some((x) => x.type === 'TournamentMoved')).toBe(true);
    // The same move again is a conflict, not a second change.
    await expect(
      e.write((backend) =>
        backend.moveTournament(t.id, {
          expectedVersion: moved.version,
          playSpaceId: bar.id,
          confirm: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it('keeps unclassified legacy data out of every scoreboard until it is assigned', async () => {
    const e = await phone();
    const a = await player(e, 'Ann');
    const b = await player(e, 'Bob');
    const t = await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [300, 200]);
    // Data written before play spaces has no playSpaceId at all.
    const backup = await send(e);
    const legacy = structuredClone(backup.data);
    legacy.tournaments = legacy.tournaments.map((x) => {
      const { playSpaceId: _p, lineage: _l, ...rest } = x;
      return rest as Tournament;
    });
    const { createBackup } = await import('../packages/local-store/src/backup.js');
    const old = await phone();
    await old.importBackup(
      await readBackup(
        JSON.stringify({
          ...(await createBackup(legacy, backup.source, backup.exportedAt)),
          schemaVersion: 5,
        }),
      ),
      { replaceExisting: true },
    );
    expect(old.read((_, s) => s.getTournament(t.id))!.playSpaceId).toBeNull();
    expect(old.progression(BT_PLAY_SPACE_ID).players.size).toBe(0);
    expect(old.progression().players.get(a.id)!.stats.matches).toBe(1);
    // Still readable in the history; assigning it needs the confirmation of the user.
    const unclassified = old.read((_, s) =>
      s.listTournaments({ limit: 10, offset: 0 }).items.filter((x) => x.playSpaceId == null),
    );
    expect(unclassified).toHaveLength(1);
    await old.write((backend) => {
      const current = backend.tournament(t.id);
      backend.moveTournament(t.id, {
        expectedVersion: current.version,
        playSpaceId: BT_PLAY_SPACE_ID,
        confirm: true,
      });
    });
    expect(old.progression(BT_PLAY_SPACE_ID).players.get(a.id)!.stats.matches).toBe(1);
  });
});

describe('XP contributions', () => {
  const at = (n: number) => `2026-10-${String(n).padStart(2, '0')}T20:00:00.000Z`;
  async function twoMatches() {
    const e = await phone();
    const a = await player(e, 'Ann');
    const b = await player(e, 'Bob');
    const t1 = await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [300, 200]);
    const t2 = await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [250, 260]);
    return { e, a, b, t1, t2 };
  }
  const all = (e: LocalEngine) =>
    e.read((_, s) => s.listTournaments({ limit: 100, offset: 0 }).items);

  it('adds a disjoint history instead of taking the larger number', async () => {
    const { e, a, t1, t2 } = await twoMatches();
    const mine = computeProgression([structuredClone(t1)]).players.get(a.id)!;
    // Another phone knows a different match of Ann: a card with identified contributions.
    const theirs = computeProgression([structuredClone(t2)]).players.get(a.id)!;
    const card: PlayerCard = {
      playerId: a.id,
      xp: theirs.xp,
      bests: theirs.bests,
      updatedAt: at(20),
      contributions: theirs.contributions,
    };
    const merged = computeProgression([t1], { cards: [card] }).players.get(a.id)!;
    expect(merged.xp).toBe(mine.xp + theirs.xp);
    // The same match known on both sides counts once.
    const overlap = computeProgression(all(e), { cards: [card] }).players.get(a.id)!;
    expect(overlap.xp).toBe(computeProgression(all(e)).players.get(a.id)!.xp);
  });

  it('is idempotent when the same card arrives twice and replaces what a correction changed', async () => {
    const { e, a, t1 } = await twoMatches();
    const full = computeProgression(all(e)).players.get(a.id)!;
    const card: PlayerCard = {
      playerId: a.id,
      xp: full.xp,
      bests: full.bests,
      updatedAt: at(20),
      contributions: full.contributions,
    };
    const stranger = computeProgression([t1], { cards: [card, card, card] }).players.get(a.id)!;
    const once = computeProgression([t1], { cards: [card] }).players.get(a.id)!;
    expect(stranger.xp).toBe(once.xp);
    // A tournament this device removed keeps superseding what the card says about it.
    const removed = computeProgression([], {
      cards: [card],
      knownSources: [t1.id, ...t1.matches.map((m) => m.id)],
    });
    expect(removed.players.get(a.id)!.xp).toBeLessThan(full.xp);
  });

  it('keeps legacy aggregate cards without inventing or losing XP', async () => {
    const { a, t1, t2 } = await twoMatches();
    const localOnly = computeProgression([t1, t2]).players.get(a.id)!;
    const dated = (xp: number, when: string): PlayerCard => ({
      playerId: a.id,
      xp,
      bests: {},
      updatedAt: when,
    });
    // A legacy 100 XP card from before both matches, and a new independent match of 22 XP.
    const matchXp = localOnly.contributions.find((c) => c.source === t1.matches[0]!.id)!.at;
    const longAgo = '2020-01-01T00:00:00.000Z';
    const result = computeProgression([t1, t2], { cards: [dated(100, longAgo)] }).players.get(
      a.id,
    )!;
    // Nothing dated before the card is derived locally, so the aggregate is kept in full and
    // the new activity is added on top: 100 + local, never just 100.
    expect(result.xp).toBe(100 + localOnly.xp);
    expect(result.legacyXp).toEqual({ xp: 100, at: longAgo });
    // A legacy card dated after the matches may contain them: the larger of the two stands.
    const after = computeProgression([t1, t2], {
      cards: [dated(localOnly.xp + 40, '2099-01-01T00:00:00.000Z')],
    }).players.get(a.id)!;
    expect(after.xp).toBe(localOnly.xp + 40);
    expect(matchXp).toBeTruthy();
    // A legacy card smaller than what is derived neither raises nor lowers anything.
    const small = computeProgression([t1, t2], {
      cards: [dated(5, '2099-01-01T00:00:00.000Z')],
    }).players.get(a.id)!;
    expect(small.xp).toBe(localOnly.xp);
  });

  it('survives export, partial import and double import of a crew package', async () => {
    const { e, a, b, t1 } = await twoMatches();
    const crew = await e.saveCrew({
      id: randomUUID(),
      name: 'Amici',
      memberIds: [a.id, b.id],
      tournamentIds: [t1.id],
      excludedTournamentIds: [],
      autoShare: false,
    });
    const pack = await readBackup(JSON.stringify(await e.exportCrew(crew.id)));
    const other = await phone();
    await other.mergeBackup(pack);
    const first = other.progression().players.get(a.id)!.xp;
    await other.mergeBackup(pack);
    expect(other.progression().players.get(a.id)!.xp).toBe(first);
    expect(first).toBe(e.progression().players.get(a.id)!.xp);
  });
});

describe('merge integrity', () => {
  it('knows a continued copy from an independent one', () => {
    const base = { version: 1 } as Tournament;
    expect(ancestry({ ...base, lineage: ['a'] }, { ...base, lineage: ['a', 'b'] })).toBe('older');
    expect(ancestry({ ...base, lineage: ['a', 'b'] }, { ...base, lineage: ['a'] })).toBe('newer');
    expect(ancestry({ ...base, lineage: ['a', 'b'] }, { ...base, lineage: ['a', 'c'] })).toBe(
      'diverged',
    );
    // A higher version alone proves nothing, and no provenance means no proof.
    expect(ancestry({ version: 3 }, { version: 9, lineage: ['x'] })).toBe('diverged');
  });

  it('keeps two independent histories as variants and counts neither twice', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    const t = await play(a, BT_PLAY_SPACE_ID, [ann.id, bob.id], [300, 200]);
    const seed = await send(a);

    // Two phones start from the same copy and each corrects the result on its own.
    const b = await phone();
    await b.importBackup(seed, { replaceExisting: true });
    const c = await phone();
    await c.importBackup(seed, { replaceExisting: true });
    const entry = (e: LocalEngine) => e.read((_, s) => s.getTournament(t.id)!);
    const fix = (e: LocalEngine, scores: [number, number]) =>
      e.write((backend) => {
        const cur = backend.tournament(t.id);
        const ids = cur.entries.map((x) => x.id);
        return exec(
          backend,
          cur,
          'RecordResult',
          {
            scores: { [ids[0]!]: scores[0], [ids[1]!]: scores[1] },
            notes: 'correzione',
            confirmInvalidation: true,
          },
          cur.matches[0]!.id,
        );
      });
    await fix(b, [310, 200]);
    await fix(c, [290, 205]);
    expect(entry(b).version).toBe(entry(c).version);
    const fromC = await send(c);

    const preview = await b.previewMerge(fromC);
    expect(preview.tournaments.diverged).toEqual(['Sfida']);
    const report = await b.mergeBackup(fromC);
    expect(report.tournaments.diverged).toEqual(['Sfida']);
    // The local copy is kept untouched; the other is a variant outside every scoreboard.
    expect(b.variants()).toHaveLength(1);
    expect(entry(b).matches[0]!.result!.scores[entry(b).entries[0]!.id]).toBe(310);
    expect(b.progression(BT_PLAY_SPACE_ID).players.get(ann.id)!.stats.matches).toBe(1);
    // Merging the same archive again changes nothing and adds no second variant.
    expect((await b.mergeBackup(fromC)).unchanged).toBe(true);
    expect(b.variants()).toHaveLength(1);

    // An explicit decision: use the other copy; the replaced one is kept in turn.
    await b.resolveVariant(b.variants()[0]!.id, 'useVariant');
    expect(entry(b).matches[0]!.result!.scores[entry(b).entries[0]!.id]).toBe(290);
    expect(b.variants()).toHaveLength(1);
    expect(b.variants()[0]!.tournament.matches[0]!.result!.scores[ann.id]).toBeUndefined();
    await b.resolveVariant(b.variants()[0]!.id, 'keepLocal');
    expect(b.variants()).toHaveLength(0);
  });

  it('lets a real continuation replace the older copy', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    const t = await play(a, BT_PLAY_SPACE_ID, [ann.id, bob.id], [300, 200]);
    const b = await phone();
    await b.importBackup(await send(a), { replaceExisting: true });
    const edited = await a.write((backend) => {
      const cur = backend.tournament(t.id);
      return exec(
        backend,
        cur,
        'RecordResult',
        {
          scores: { [cur.entries[0]!.id]: 320, [cur.entries[1]!.id]: 200 },
          notes: 'fix',
          confirmInvalidation: true,
        },
        cur.matches[0]!.id,
      );
    });
    const report = await b.mergeBackup(await send(a));
    expect(report.tournaments.diverged).toEqual([]);
    expect(b.read((_, s) => s.getTournament(t.id))!.version).toBe(edited.version);
    expect(b.variants()).toHaveLength(0);
  });

  it('reports a merge as changed when only history changed', () => {
    const empty = {
      players: [],
      events: [],
      tournaments: [],
      audit: [],
      outbox: [],
      commands: [],
      crews: [],
      cards: [],
      links: [],
      playSpaces: [],
      variants: [],
    };
    const op = {
      id: randomUUID(),
      tournamentId: null,
      matchId: null,
      scoreId: null,
      type: 'X',
      before: null,
      after: null,
      reason: null,
      operator: 'a',
      createdAt: 'now',
      sequence: 1,
    };
    const merged = mergeBackupData(empty, { ...empty, audit: [op] });
    expect(merged.report.unchanged).toBe(false);
    expect(merged.data.audit).toHaveLength(1);
    const again = mergeBackupData(merged.data, { ...empty, audit: [op] });
    expect(again.report.unchanged).toBe(true);
    const cmd = {
      key: 'k'.repeat(10),
      fingerprint: 'a'.repeat(64),
      tournamentId: null,
      version: null,
      createdAt: 'x',
    };
    expect(mergeBackupData(empty, { ...empty, commands: [cmd] }).report.unchanged).toBe(false);
  });

  it('does not bring a removed crew member back from an old copy', () => {
    const base: Crew = {
      id: randomUUID(),
      name: 'Amici',
      memberIds: ['a', 'b', 'c'],
      tournamentIds: [],
      excludedTournamentIds: [],
      autoShare: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const phoneA = withMembership(
      base,
      { ...base, memberIds: ['a', 'b'], updatedAt: '2026-02-01T00:00:00.000Z' },
      '2026-02-01T00:00:00.000Z',
    );
    expect(mergeCrew(phoneA, base).memberIds).toEqual(['a', 'b']);
    expect(mergeCrew(base, phoneA).memberIds).toEqual(['a', 'b']);
    // Re-adding later survives an old removal, and the merge is symmetric and repeatable.
    const readded = withMembership(
      phoneA,
      { ...phoneA, memberIds: ['a', 'b', 'c'], updatedAt: '2026-03-01T00:00:00.000Z' },
      '2026-03-01T00:00:00.000Z',
    );
    expect(mergeCrew(readded, phoneA).memberIds.sort()).toEqual(['a', 'b', 'c']);
    expect(mergeCrew(phoneA, readded).memberIds.sort()).toEqual(['a', 'b', 'c']);
    const twice = mergeCrew(mergeCrew(phoneA, base), base);
    expect(twice.memberIds).toEqual(['a', 'b']);
  });

  it('keeps the play spaces of a crew when an editor that ignores them saves it', () => {
    const base: Crew = {
      id: randomUUID(),
      name: 'Amici',
      memberIds: ['a'],
      tournamentIds: [],
      excludedTournamentIds: [],
      autoShare: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      playSpaceIds: ['s1'],
      favoritePlaySpaceId: 's1',
    };
    const { playSpaceIds: _p, favoritePlaySpaceId: _f, ...edited } = base;
    const saved = withMembership(
      base,
      { ...edited, name: 'Amici veri' },
      '2026-02-01T00:00:00.000Z',
    );
    expect(saved.playSpaceIds).toEqual(['s1']);
    expect(saved.favoritePlaySpaceId).toBe('s1');
  });

  it('removing a member from a crew keeps the player and their history', async () => {
    const e = await phone();
    const a = await player(e, 'Ann');
    const b = await player(e, 'Bob');
    await play(e, BT_PLAY_SPACE_ID, [a.id, b.id], [300, 200]);
    const crew = await e.saveCrew({
      id: randomUUID(),
      name: 'Amici',
      memberIds: [a.id, b.id],
      tournamentIds: [],
      excludedTournamentIds: [],
      autoShare: true,
    });
    const saved = await e.saveCrew({ ...crew, memberIds: [a.id] });
    expect(saved.memberIds).toEqual([a.id]);
    expect(saved.removedMembers!.map((r) => r.playerId)).toEqual([b.id]);
    expect(e.read((_, s) => s.getPlayer(b.id))!.status).toBe('active');
    expect(e.progression().players.get(b.id)!.stats.matches).toBe(1);
  });

  it('refuses player links that loop or contradict one another', async () => {
    const mk = async () => {
      const e = await phone();
      return { e, x: await player(e, 'X'), y: await player(e, 'Y') };
    };
    const { e, x, y } = await mk();
    const data = (await e.exportBackup()).data;
    const link = (from: string, to: string) => ({
      from,
      to,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const local = { ...data, links: [link(x.id, y.id)] };
    const loop = mergeBackupData(local, { ...data, links: [link(y.id, x.id)] });
    expect(loop.report.linksRejected).toBe(1);
    expect(loop.data.links).toHaveLength(1);
    const clash = mergeBackupData(local, { ...data, links: [link(x.id, randomUUID())] });
    expect(clash.report.linksRejected).toBe(1);
  });
});

describe('backups and play spaces', () => {
  it('keeps space ids through export and import and never merges by name', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    const gino = await a.createPlaySpace({ name: 'Da Gino', place: 'sala' }, 'ann');
    await play(a, gino.id, [ann.id, bob.id], [300, 200]);
    const b = await phone();
    const homonym = await b.createPlaySpace({ name: 'Da Gino' }, 'bob');
    await b.mergeBackup(await send(a));
    const ids = b.playSpaces().map((p) => p.id);
    expect(ids).toContain(gino.id);
    expect(ids).toContain(homonym.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.playSpaces().filter((p) => p.name === 'Da Gino')).toHaveLength(2);
    // Importing repeatedly never creates another Bite the Trouble.
    await b.mergeBackup(await send(a));
    expect(b.playSpaces().filter((p) => p.canonical)).toHaveLength(1);
    expect(b.playSpaces()).toHaveLength(3);
  });

  it('rejects a backup that defines the canonical space or points to an unknown one', async () => {
    const a = await phone();
    const { createBackup } = await import('../packages/local-store/src/backup.js');
    const base = (await a.exportBackup()).data;
    const make = (data: typeof base) =>
      createBackup(data, { deviceId: 'd', revision: 1, app: 't' }, new Date().toISOString());
    const space = {
      id: BT_PLAY_SPACE_ID,
      name: 'BT',
      place: null,
      targetDescription: null,
      canonical: true,
      createdBy: null,
      createdAt: 'x',
      updatedAt: 'x',
      version: 0,
    };
    await expect(
      readBackup(JSON.stringify(await make({ ...base, playSpaces: [space] }))),
    ).rejects.toThrow(/canonical/);
  });

  it('reads a backup written before play spaces and adds no space', async () => {
    const a = await phone();
    const { createBackup } = await import('../packages/local-store/src/backup.js');
    const base = (await a.exportBackup()).data;
    const { playSpaces: _p, variants: _v, ...old } = base;
    const file = await createBackup(
      old as typeof base,
      { deviceId: 'd', revision: 1, app: 't' },
      new Date().toISOString(),
    );
    const read = await readBackup(JSON.stringify({ ...file, schemaVersion: 5 }));
    expect(read.data.playSpaces).toEqual([]);
    const b = await phone();
    await b.mergeBackup(read);
    expect(b.playSpaces()).toHaveLength(1);
  });
});
