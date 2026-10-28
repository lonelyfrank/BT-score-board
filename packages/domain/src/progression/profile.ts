import type { GameMode, Match, Tournament, TournamentEntry } from '../model.js';
import { linkResolver, type PlayerLink } from '../crews/crews.js';
import { levelProgress, type LevelProgress } from './levels.js';
import {
  entryPerformance,
  matchPlayedAt,
  recordSpecs,
  takesRecord,
  type RecordHolding,
} from './records.js';
import { roundProgress, trackingSpec } from '../scoring/rounds.js';
import { games } from '../games/catalog.js';

/** XP granted for each event. They count always: no confirmation of the match is needed. */
export const xpRules = {
  /** A completed match with at least two entries that did not withdraw. */
  participation: 12,
  win: 10,
  /** Per player of an entry that finished a tournament (not a single match). */
  tournamentCompleted: 25,
  tournamentWon: 50,
  /** Beating your own previous best in a game (the first result sets it, no bonus). */
  personalBest: 15,
  /**
   * Participation and win XP stop after this many matches a player completes in one day, so a
   * run of invented matches cannot climb the ladder. Matches still count in the statistics.
   */
  dailyMatchCap: 20,
} as const;

export type NameEffect = 'none' | 'shine' | 'glow' | 'gold' | 'legend' | 'record';
export interface Badge {
  id: string;
  kind: 'level' | 'record';
  label: string;
  game?: GameMode;
}
/** What the interface shows next to a player's name. */
export interface Cosmetics {
  levelTitle: string;
  /** Titles of the records held, e.g. "Re del 501". */
  recordTitles: string[];
  badges: Badge[];
  nameEffect: NameEffect;
}

export interface XpBreakdown {
  participation: number;
  wins: number;
  tournaments: number;
  personalBest: number;
  /** XP known only from the player's card: matches this device has never seen. */
  elsewhere: number;
}
export interface PlayerStats {
  matches: number;
  wins: number;
  tournamentsCompleted: number;
  tournamentsWon: number;
}
export interface PersonalBest {
  value: number;
  achievedAt: string;
}
export type PersonalBests = Partial<Record<GameMode, PersonalBest>>;
/** The most points a player scored with one turn of three darts, in any game. */
export interface BestTurn {
  value: number;
  playerId: string;
  gameMode: GameMode;
  tournamentId: string;
  matchId: string;
  achievedAt: string;
}
export interface PlayerProgression {
  playerId: string;
  /** Highest three-dart turn of the player, from tracked rounds of completed matches. */
  bestTurn: BestTurn | null;
  xp: number;
  /** Where the XP comes from, so that it can be told apart from the same XP seen elsewhere. */
  contributions: XpContribution[];
  /** XP known only as an aggregate from an older card (kept as legacy, not reconciled). */
  legacyXp: { xp: number; at: string } | null;
  progress: LevelProgress;
  breakdown: XpBreakdown;
  stats: PlayerStats;
  bests: PersonalBests;
  records: RecordHolding[];
  cosmetics: Cosmetics;
}
export interface Progression {
  players: Map<string, PlayerProgression>;
  /** Current holder of each game's record. */
  records: Partial<Record<GameMode, RecordHolding>>;
  /** Highest three-dart turn of all (null when records are not claimed). */
  bestTurn: BestTurn | null;
}

/** A turn cannot be worth more than three triple 20. */
const MAX_TURN = 180;
/**
 * Points of each three-dart turn of an entry, with who threw it: tracked rounds that score
 * points (X01 rounds read from the points left), and legacy turn-by-turn Hi-Score entries.
 * Busts, skipped rounds and matches played with another number of darts give none.
 */
function turnPoints(t: Tournament, m: Match, entry: TournamentEntry) {
  const turns: { playerId: string; value: number }[] = [];
  if (m.scoringConfiguration.dartsPerTurn !== 3) return turns;
  const legacy = new Map<string, number>();
  for (const s of m.scores)
    if (!s.voided && s.tournamentEntryId === entry.id)
      legacy.set(s.turnId, (legacy.get(s.turnId) ?? 0) + s.score);
  for (const value of legacy.values()) turns.push({ playerId: entry.playerId, value });
  const kind = trackingSpec(t, m).kind;
  if (kind !== 'progress') {
    // Points left are read against the previous turn's: a gap breaks the chain.
    let left = games[t.gameMode].startingScore ?? null;
    for (const r of roundProgress(t, m, entry.id).rounds) {
      if (r.status !== 'recorded' || r.value === null) {
        left = null;
        continue;
      }
      let value: number | null = r.value;
      if (kind === 'remaining') {
        value = left === null ? null : left - r.value;
        left = r.value;
      }
      if (value !== null && !r.bust) turns.push({ playerId: r.playerId ?? entry.playerId, value });
    }
  }
  return turns.filter((x) => x.value > 0 && x.value <= MAX_TURN);
}

/**
 * What a device knows of a player, carried to other devices with a crew package so that the
 * level and the bests follow the person into every crew. Merging keeps the highest XP and the
 * best value per game: the same match seen on two phones is never counted twice.
 */
export interface PlayerCard {
  playerId: string;
  /** Total at the time of writing. Readers use `contributions` when present (see below). */
  xp: number;
  bests: PersonalBests;
  updatedAt: string;
  /**
   * The XP as identifiable contributions, one per match (or tournament), player and rule. The
   * same contribution met twice counts once, and a match this device knows is recomputed from
   * its own data, so a correction or a cancellation replaces what the card said.
   */
  contributions?: XpContribution[];
  /**
   * XP from before contributions existed: an aggregate without provenance. It cannot be split
   * by match, so it is kept as it is and never mixed up with identified contributions.
   */
  legacy?: { xp: number; at: string };
}

/** One identified grant of XP. `source` is the match (or tournament) it comes from. */
export interface XpContribution {
  id: string;
  source: string;
  xp: number;
  at: string;
}

/** The legacy aggregate of a card: explicit, or the whole `xp` of a card without contributions. */
export const cardLegacy = (card: PlayerCard): { xp: number; at: string } | null =>
  card.legacy ?? (card.contributions ? null : { xp: card.xp, at: card.updatedAt });

export function mergeCards(a: PlayerCard, b: PlayerCard): PlayerCard {
  const bests: PersonalBests = { ...a.bests };
  for (const [game, best] of Object.entries(b.bests) as [GameMode, PersonalBest][]) {
    const spec = recordSpecs[game];
    if (spec && takesRecord(spec, best, bests[game])) bests[game] = best;
  }
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const contributions = new Map<string, XpContribution>();
  for (const c of [...(older.contributions ?? []), ...(newer.contributions ?? [])])
    contributions.set(c.id, c);
  // Two aggregates cannot be told apart or added: the larger one stands, as before.
  const legacies = [cardLegacy(a), cardLegacy(b)].filter((l) => l !== null);
  const legacy = legacies.sort((x, y) => y.xp - x.xp)[0];
  const merged: PlayerCard = {
    playerId: a.playerId,
    // Informational: the total as last written by a device. Readers derive XP from the rest.
    xp: Math.max(a.xp, b.xp),
    bests,
    updatedAt: newer.updatedAt,
  };
  if (a.contributions || b.contributions) merged.contributions = [...contributions.values()];
  if (legacy && (a.contributions || b.contributions)) merged.legacy = legacy;
  merged.xp = cardTotal(merged);
  return merged;
}
const cardTotal = (c: PlayerCard) =>
  c.contributions ? c.contributions.reduce((sum, x) => sum + x.xp, 0) + (c.legacy?.xp ?? 0) : c.xp;

export const playerCard = (p: PlayerProgression, updatedAt: string): PlayerCard => ({
  playerId: p.playerId,
  xp: p.xp,
  bests: p.bests,
  updatedAt,
  contributions: p.contributions,
  ...(p.legacyXp ? { legacy: p.legacyXp } : {}),
});

function levelEffect(level: number): NameEffect {
  return level >= 12
    ? 'legend'
    : level >= 11
      ? 'gold'
      : level >= 8
        ? 'glow'
        : level >= 5
          ? 'shine'
          : 'none';
}

interface Played {
  t: Tournament;
  m: Match;
  at: string;
}

export interface ProgressionOptions {
  /** Cards received from other devices. */
  cards?: readonly PlayerCard[];
  /** Duplicate player records: XP and records go to the record each one is linked to. */
  links?: readonly PlayerLink[];
  /**
   * Ids of every match and tournament this device holds, removed ones included: a card
   * contribution from one of them is superseded by the local data, whatever it says now.
   */
  knownSources?: Iterable<string>;
  /** false: no record is claimed (a personal view is not a competitive ranking). Default true. */
  records?: boolean;
}

/**
 * Experience, level, statistics and records of every player, derived from tournaments (and the
 * cards of other devices). Being derived, the result is the same however many times the same
 * data is merged in, and it can be recomputed whenever the rules change. The caller decides
 * which tournaments are visible; the same match listed twice (same id) counts once.
 */
export function computeProgression(
  tournaments: readonly Tournament[],
  options: ProgressionOptions = {},
): Progression {
  const resolve = linkResolver(options.links ?? []);
  const membersOf = (e: TournamentEntry) =>
    (e.members.length ? e.members.map((m) => m.playerId) : [e.playerId]).map(resolve);
  const matches = new Map<string, Played>();
  for (const t of tournaments)
    for (const m of t.matches) {
      const at = matchPlayedAt(m);
      if (m.status === 'completed' && at && !m.result?.walkover && !matches.has(m.id))
        matches.set(m.id, { t, m, at });
    }
  const played = [...matches.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.m.id.localeCompare(b.m.id),
  );

  type Acc = Omit<PlayerProgression, 'progress' | 'cosmetics' | 'xp'>;
  const claimsRecords = options.records !== false;
  type Rule = 'participation' | 'win' | 'tournament' | 'tournamentWon' | 'personalBest';
  const grant = (p: Acc, rule: Rule, source: string, xp: number, at: string) => {
    p.contributions.push({ id: `${rule}|${source}|${p.playerId}`, source, xp, at });
    const b = p.breakdown;
    if (rule === 'participation') b.participation += xp;
    else if (rule === 'win') b.wins += xp;
    else if (rule === 'personalBest') b.personalBest += xp;
    else b.tournaments += xp;
  };
  const acc = new Map<string, Acc>();
  const dayCount = new Map<string, number>();
  const records: Partial<Record<GameMode, RecordHolding>> = {};
  const of = (playerId: string) => {
    let p = acc.get(playerId);
    if (!p) {
      p = {
        playerId,
        contributions: [],
        legacyXp: null,
        breakdown: { participation: 0, wins: 0, tournaments: 0, personalBest: 0, elsewhere: 0 },
        stats: { matches: 0, wins: 0, tournamentsCompleted: 0, tournamentsWon: 0 },
        bests: {},
        records: [],
        bestTurn: null,
      };
      acc.set(playerId, p);
    }
    return p;
  };
  let bestTurn: BestTurn | null = null;
  // Higher wins; an equal turn only when it came earlier (matches are visited in order).
  const better = (a: BestTurn, b: BestTurn | null) => !b || a.value > b.value;
  const claim = (game: GameMode, holding: Omit<RecordHolding, 'game' | 'spec'>) => {
    const spec = recordSpecs[game]!;
    if (claimsRecords && takesRecord(spec, holding, records[game]))
      records[game] = { game, spec, ...holding };
  };

  for (const { t, m, at } of played) {
    const entries = m.participants
      .map((p) => t.entries.find((e) => e.id === p.tournamentEntryId))
      .filter((e): e is TournamentEntry => !!e && e.status !== 'withdrawn');
    if (entries.length < 2) continue;
    const spec = recordSpecs[t.gameMode];
    for (const entry of entries) {
      for (const turn of turnPoints(t, m, entry)) {
        const best: BestTurn = {
          value: turn.value,
          playerId: resolve(turn.playerId),
          gameMode: t.gameMode,
          tournamentId: t.id,
          matchId: m.id,
          achievedAt: at,
        };
        const p = of(best.playerId);
        if (better(best, p.bestTurn)) p.bestTurn = best;
        if (claimsRecords && better(best, bestTurn)) bestTurn = best;
      }
      const won = m.winnerEntryId === entry.id;
      for (const playerId of membersOf(entry)) {
        const p = of(playerId);
        p.stats.matches++;
        if (won) p.stats.wins++;
        const dayKey = `${playerId}|${at.slice(0, 10)}`;
        const day = (dayCount.get(dayKey) ?? 0) + 1;
        dayCount.set(dayKey, day);
        if (day <= xpRules.dailyMatchCap) {
          grant(p, 'participation', m.id, xpRules.participation, at);
          if (won) grant(p, 'win', m.id, xpRules.win, at);
        }
      }
      if (!spec) continue;
      const value = entryPerformance(t, m, entry);
      if (value === null) continue;
      const p = of(resolve(entry.playerId));
      const best = p.bests[t.gameMode];
      if (takesRecord(spec, { value, achievedAt: at }, best)) {
        if (best) grant(p, 'personalBest', m.id, xpRules.personalBest, at);
        p.bests[t.gameMode] = { value, achievedAt: at };
      }
      claim(t.gameMode, {
        value,
        playerId: p.playerId,
        tournamentId: t.id,
        matchId: m.id,
        achievedAt: at,
      });
    }
  }

  const seen = new Set<string>();
  for (const t of tournaments) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.status !== 'completed' || t.mode === 'SINGLE_MATCH') continue;
    for (const entry of t.entries) {
      if (entry.status === 'withdrawn') continue;
      const won = t.results.some((r) => r.tournamentEntryId === entry.id && r.finalPlacement === 1);
      for (const playerId of membersOf(entry)) {
        const p = of(playerId);
        p.stats.tournamentsCompleted++;
        const doneAt = t.completedAt ?? '';
        grant(p, 'tournament', t.id, xpRules.tournamentCompleted, doneAt);
        if (won) {
          p.stats.tournamentsWon++;
          grant(p, 'tournamentWon', t.id, xpRules.tournamentWon, doneAt);
        }
      }
    }
  }

  const xpOf = (p: Acc) => {
    const b = p.breakdown;
    return b.participation + b.wins + b.tournaments + b.personalBest + b.elsewhere;
  };
  // What this device holds decides about a match or tournament it knows, removed ones included.
  const known = new Set(options.knownSources ?? []);
  for (const t of tournaments) {
    known.add(t.id);
    for (const m of t.matches) known.add(m.id);
  }
  const cards = new Map<string, PlayerCard>();
  for (const card of options.cards ?? []) {
    const playerId = resolve(card.playerId);
    const earlier = cards.get(playerId);
    const own = { ...card, playerId };
    cards.set(playerId, earlier ? mergeCards(earlier, own) : own);
  }
  for (const card of cards.values()) {
    const p = of(card.playerId);
    const derived = [...p.contributions];
    const legacy = cardLegacy(card);
    // Identified contributions from matches this device does not know, each counted once.
    // Those dated before a legacy aggregate are taken to be inside it.
    const have = new Set(derived.map((c) => c.id));
    for (const c of card.contributions ?? []) {
      if (known.has(c.source) || have.has(c.id) || (legacy && c.at <= legacy.at)) continue;
      have.add(c.id);
      p.contributions.push(c);
      p.breakdown.elsewhere += c.xp;
    }
    if (legacy) {
      // An aggregate without provenance: kept, not reconciled. What the local data derives up to
      // its date may or may not be inside it, so it counts once (the larger of the two);
      // everything dated later is new activity and is added.
      const before = derived.filter((c) => c.at <= legacy.at).reduce((sum, c) => sum + c.xp, 0);
      p.breakdown.elsewhere += Math.max(0, legacy.xp - before);
      p.legacyXp = legacy;
    }
    for (const [game, best] of Object.entries(card.bests) as [GameMode, PersonalBest][]) {
      const spec = recordSpecs[game];
      if (!spec) continue;
      if (takesRecord(spec, best, p.bests[game])) p.bests[game] = best;
      claim(game, { ...best, playerId: p.playerId, tournamentId: null, matchId: null });
    }
  }

  for (const holding of Object.values(records)) of(holding.playerId).records.push(holding);

  const players = new Map<string, PlayerProgression>();
  for (const p of acc.values()) {
    const xp = xpOf(p);
    const progress = levelProgress(xp);
    const recordBadges: Badge[] = p.records.map((r) => ({
      id: `record:${r.game}`,
      kind: 'record',
      label: r.spec.title,
      game: r.game,
    }));
    const effect = levelEffect(progress.level.level);
    players.set(p.playerId, {
      ...p,
      xp,
      progress,
      cosmetics: {
        levelTitle: progress.level.title,
        recordTitles: p.records.map((r) => r.spec.title),
        badges: [
          { id: `level:${progress.level.level}`, kind: 'level', label: progress.level.title },
          ...recordBadges,
        ],
        // The top level keeps its own effect; any other record holder gets the record one.
        nameEffect: p.records.length && effect !== 'legend' ? 'record' : effect,
      },
    });
  }
  return { players, records, bestTurn };
}
