import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from '../packages/application/src/index.js';
import {
  crewTournaments,
  linkResolver,
  matchById,
  mergeCrew,
  type Crew,
  type Tournament,
} from '../packages/domain/src/index.js';
import {
  LocalEngine,
  SCHEMA_VERSION,
  migrations,
  readBackup,
} from '../packages/local-store/src/index.js';

const engines: LocalEngine[] = [];
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.close());
});
/** One phone: its own database. */
async function phone(name = `bt-phone-${randomUUID()}`, list = migrations) {
  const engine = await LocalEngine.open({ channel: null, database: { name, migrations: list } });
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
const player = (engine: LocalEngine, displayName: string) =>
  engine.write((b) => b.createPlayer({ displayName }));
/** A Hi-Score single match between two players, completed with its totals. */
async function play(engine: LocalEngine, ids: [string, string], totals: [number, number]) {
  let t = await engine.write((b) =>
    b.createTournament({
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
const crewOf = (memberIds: string[]) => ({
  id: randomUUID(),
  name: 'Gli amici del giovedì',
  memberIds,
  tournamentIds: [],
  excludedTournamentIds: [],
  autoShare: true,
});
const xp = (engine: LocalEngine, id: string) =>
  engine.read(() => engine.progression()).players.get(id)?.xp ?? 0;
const send = async (from: LocalEngine, crewId: string) =>
  readBackup(JSON.stringify(await from.exportCrew(crewId)));

describe('crews between phones', () => {
  it('shares the crew tournaments and nothing else, and levels arrive on the other phone', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    const eve = await player(a, 'Eve');
    const shared = await play(a, [ann.id, bob.id], [300, 200]);
    const privateMatch = await play(a, [ann.id, eve.id], [250, 260]);
    const crew = await a.saveCrew(crewOf([ann.id, bob.id]));
    expect(a.crewTournaments(crew.id).map((t) => t.id)).toEqual([shared.id]);

    const pack = await send(a, crew.id);
    expect(pack.scope).toBe('crew');
    expect(pack.data.tournaments.map((t) => t.id)).toEqual([shared.id]);
    expect(pack.data.players.map((p) => p.displayName).sort()).toEqual(['Ann', 'Bob']);

    const b = await phone();
    const preview = await b.previewMerge(pack);
    expect(preview).toMatchObject({ players: { added: 2 }, tournaments: { added: 1 } });
    await b.mergeBackup(pack);
    expect(b.socialData().crews.map((c) => c.name)).toEqual(['Gli amici del giovedì']);
    expect(b.read((_, s) => s.getTournament(privateMatch.id))).toBeUndefined();
    // Ann's private match is not on phone B, but her level is: it came with her card.
    expect(xp(b, ann.id)).toBe(xp(a, ann.id));
    expect(b.progression().players.get(ann.id)!.breakdown.elsewhere).toBeGreaterThan(0);
    expect(b.crewProgression(crew.id).records.HI_SCORE).toMatchObject({ playerId: ann.id });

    // Merging the same package again changes nothing.
    expect((await b.mergeBackup(pack)).unchanged).toBe(true);
  });

  it('merges both ways without losing matches played on either phone', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    await play(a, [ann.id, bob.id], [300, 200]);
    const crew = await a.saveCrew(crewOf([ann.id, bob.id]));
    const b = await phone();
    await b.mergeBackup(await send(a, crew.id));

    // An evening only Bob's phone was there for, and one only Ann's phone saw.
    const onB = await play(b, [ann.id, bob.id], [100, 400]);
    const onA = await play(a, [ann.id, bob.id], [350, 150]);
    await a.mergeBackup(await send(b, crew.id));
    await b.mergeBackup(await send(a, crew.id));
    for (const device of [a, b]) {
      expect(
        device
          .crewTournaments(crew.id)
          .map((t) => t.id)
          .sort(),
      ).toEqual(
        a
          .crewTournaments(crew.id)
          .map((t) => t.id)
          .sort(),
      );
      expect(device.read((_, s) => s.getTournament(onA.id))).toBeDefined();
      expect(device.read((_, s) => s.getTournament(onB.id))).toBeDefined();
    }
    expect(xp(a, ann.id)).toBe(xp(b, ann.id));
    expect(xp(a, bob.id)).toBe(xp(b, bob.id));
    expect(a.progression().players.get(ann.id)!.stats.matches).toBe(3);
  });

  it('keeps the most advanced copy of a tournament and reports homonyms to link', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    const crew = await a.saveCrew(crewOf([ann.id, bob.id]));
    const b = await phone();
    // Phone B knew "Ann" before: a different record of the same person.
    const annOnB = await player(b, 'Ann');
    const carl = await player(b, 'Carl');
    await play(b, [annOnB.id, carl.id], [180, 90]);
    const report = await b.mergeBackup(await send(a, crew.id));
    expect(report.homonyms).toEqual([
      { name: 'Ann', players: expect.arrayContaining([expect.objectContaining({ id: ann.id })]) },
    ]);

    const together = xp(b, annOnB.id) + xp(b, ann.id);
    const { kept, linked } = await b.linkPlayers(annOnB.id, ann.id);
    // The older record (created first, on phone A) survives, whichever order the link was made in.
    expect(kept).toBe(ann.id);
    expect(linked).toBe(annOnB.id);
    expect(b.read((_, s) => s.getPlayer(annOnB.id))!.status).toBe('inactive');
    expect(b.socialData().crews[0]!.memberIds).toEqual([ann.id, bob.id]);
    expect(b.progression().players.has(annOnB.id)).toBe(false);
    // Phone B's own match with Carl now counts for Ann too.
    expect(xp(b, ann.id)).toBe(together);
    expect(b.progression().players.get(ann.id)!.stats.matches).toBe(1);

    // A tournament advanced on another phone (higher version) replaces the older copy.
    const t = await play(a, [ann.id, bob.id], [10, 20]);
    const pack = await send(a, crew.id);
    const older = structuredClone(pack);
    older.data.tournaments = older.data.tournaments.map((x) =>
      x.id === t.id ? { ...x, version: 1, name: 'Vecchia copia' } : x,
    );
    await b.mergeBackup(pack);
    await b.mergeBackup(older);
    expect(b.read((_, s) => s.getTournament(t.id))!.name).toBe('Sfida');
  });

  it('restores and merges full backups with crews, cards and links', async () => {
    const a = await phone();
    const ann = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    await play(a, [ann.id, bob.id], [300, 200]);
    await a.saveCrew(crewOf([ann.id, bob.id]));
    const full = await readBackup(JSON.stringify(await a.exportBackup()));
    expect(full.data.crews).toHaveLength(1);

    const b = await phone();
    await b.importBackup(full, { replaceExisting: false });
    expect(b.socialData().crews).toHaveLength(1);
    const report = await b.mergeBackup(full);
    expect(report.unchanged).toBe(true);
  });

  it('upgrades a phone with data from before crews, keeping everything', async () => {
    const name = `bt-old-${randomUUID()}`;
    const old = await phone(name, migrations.slice(0, 4));
    const ann = await player(old, 'Ann');
    const bob = await player(old, 'Bob');
    const t = await play(old, [ann.id, bob.id], [300, 200]);
    old.close();
    engines.splice(engines.indexOf(old), 1);

    const upgraded = await phone(name);
    expect(SCHEMA_VERSION).toBe(5);
    expect(upgraded.socialData()).toEqual({ crews: [], cards: [], links: [] });
    expect(upgraded.read((_, s) => s.getTournament(t.id))!.status).toBe('completed');
    // Levels come from the existing matches straight away.
    expect(xp(upgraded, ann.id)).toBeGreaterThan(0);
  });
});

describe('crew rules', () => {
  const t = (id: string, players: string[]) =>
    ({
      id,
      entries: players.map((p) => ({ playerId: p, members: [{ playerId: p }] })),
    }) as unknown as Tournament;
  const crew = (patch: Partial<Crew> = {}): Crew => ({
    ...crewOf(['a', 'b']),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...patch,
  });
  it('shares automatically only what members played among themselves', () => {
    const all = [t('1', ['a', 'b']), t('2', ['a', 'x']), t('3', [])];
    expect(crewTournaments(crew(), all).map((x) => x.id)).toEqual(['1']);
    expect(crewTournaments(crew({ tournamentIds: ['2'] }), all).map((x) => x.id)).toEqual([
      '1',
      '2',
    ]);
    expect(crewTournaments(crew({ excludedTournamentIds: ['1'] }), all)).toEqual([]);
    expect(crewTournaments(crew({ autoShare: false }), all)).toEqual([]);
    // A linked duplicate counts as the member it was linked to.
    const resolve = linkResolver([{ from: 'x', to: 'b', createdAt: '' }]);
    expect(crewTournaments(crew(), all, resolve).map((x) => x.id)).toEqual(['1', '2']);
  });
  it('merges copies of a crew keeping every member', () => {
    const mine = crew({ memberIds: ['a', 'b'], excludedTournamentIds: ['9'] });
    const theirs = crew({
      memberIds: ['a', 'c'],
      tournamentIds: ['9'],
      name: 'Rinominata',
      updatedAt: '2026-02-01',
    });
    const merged = mergeCrew(mine, theirs);
    expect(merged).toMatchObject({ name: 'Rinominata', tournamentIds: ['9'] });
    expect([...merged.memberIds].sort()).toEqual(['a', 'b', 'c']);
    expect(merged.excludedTournamentIds).toEqual([]);
    expect(mergeCrew(theirs, mine)).toEqual(merged);
  });
  it('merges duplicates into a survivor that stays active and keeps what the other had', async () => {
    const a = await phone();
    const old = await player(a, 'Ann');
    const bob = await player(a, 'Bob');
    await play(a, [old.id, bob.id], [100, 50]);
    await a.write((b) => b.updatePlayer(old.id, { status: 'inactive' }));
    const fresh = await player(a, 'Anna');
    await a.write((b) => b.updatePlayer(fresh.id, { nickname: 'Freccia' }));
    // The older record is inactive: it is never the one that survives, so nobody is left inactive.
    const { kept, linked } = await a.linkPlayers(old.id, fresh.id);
    expect([kept, linked]).toEqual([fresh.id, old.id]);
    expect(a.read((_, s) => s.getPlayer(fresh.id))).toMatchObject({ status: 'active' });
    expect(a.progression().players.get(fresh.id)!.stats.matches).toBe(1);

    const c = await player(a, 'Carl');
    const d = await player(a, 'Carlo');
    await a.write((b) => b.updatePlayer(d.id, { nickname: 'Dardo', avatar: 'blue' }));
    await a.write((b) => b.updatePlayer(c.id, { nickname: 'Cal' }));
    const merged = await a.linkPlayers(c.id, d.id);
    // The survivor takes the avatar it lacked and keeps its own nickname, and stays active.
    expect(a.read((_, s) => s.getPlayer(merged.kept))).toMatchObject({
      status: 'active',
      avatar: 'blue',
    });
    expect(a.read((_, s) => s.getPlayer(merged.linked))).toMatchObject({ status: 'inactive' });
  });
  it('resolves link chains and survives cycles', () => {
    const resolve = linkResolver([
      { from: 'a', to: 'b', createdAt: '' },
      { from: 'b', to: 'c', createdAt: '' },
      { from: 'x', to: 'y', createdAt: '' },
      { from: 'y', to: 'x', createdAt: '' },
    ]);
    expect(resolve('a')).toBe('c');
    expect(['x', 'y']).toContain(resolve('x'));
  });
});
