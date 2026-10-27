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
export interface PlayerProgression {
  playerId: string;
  xp: number;
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
}

/**
 * What a device knows of a player, carried to other devices with a crew package so that the
 * level and the bests follow the person into every crew. Merging keeps the highest XP and the
 * best value per game: the same match seen on two phones is never counted twice.
 */
export interface PlayerCard {
  playerId: string;
  xp: number;
  bests: PersonalBests;
  updatedAt: string;
}

export function mergeCards(a: PlayerCard, b: PlayerCard): PlayerCard {
  const bests: PersonalBests = { ...a.bests };
  for (const [game, best] of Object.entries(b.bests) as [GameMode, PersonalBest][]) {
    const spec = recordSpecs[game];
    if (spec && takesRecord(spec, best, bests[game])) bests[game] = best;
  }
  return {
    playerId: a.playerId,
    xp: Math.max(a.xp, b.xp),
    bests,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

export const playerCard = (p: PlayerProgression, updatedAt: string): PlayerCard => ({
  playerId: p.playerId,
  xp: p.xp,
  bests: p.bests,
  updatedAt,
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
  const acc = new Map<string, Acc>();
  const dayCount = new Map<string, number>();
  const records: Partial<Record<GameMode, RecordHolding>> = {};
  const of = (playerId: string) => {
    let p = acc.get(playerId);
    if (!p) {
      p = {
        playerId,
        breakdown: { participation: 0, wins: 0, tournaments: 0, personalBest: 0, elsewhere: 0 },
        stats: { matches: 0, wins: 0, tournamentsCompleted: 0, tournamentsWon: 0 },
        bests: {},
        records: [],
      };
      acc.set(playerId, p);
    }
    return p;
  };
  const claim = (game: GameMode, holding: Omit<RecordHolding, 'game' | 'spec'>) => {
    const spec = recordSpecs[game]!;
    if (takesRecord(spec, holding, records[game])) records[game] = { game, spec, ...holding };
  };

  for (const { t, m, at } of played) {
    const entries = m.participants
      .map((p) => t.entries.find((e) => e.id === p.tournamentEntryId))
      .filter((e): e is TournamentEntry => !!e && e.status !== 'withdrawn');
    if (entries.length < 2) continue;
    const spec = recordSpecs[t.gameMode];
    for (const entry of entries) {
      const won = m.winnerEntryId === entry.id;
      for (const playerId of membersOf(entry)) {
        const p = of(playerId);
        p.stats.matches++;
        if (won) p.stats.wins++;
        const dayKey = `${playerId}|${at.slice(0, 10)}`;
        const day = (dayCount.get(dayKey) ?? 0) + 1;
        dayCount.set(dayKey, day);
        if (day <= xpRules.dailyMatchCap) {
          p.breakdown.participation += xpRules.participation;
          if (won) p.breakdown.wins += xpRules.win;
        }
      }
      if (!spec) continue;
      const value = entryPerformance(t, m, entry);
      if (value === null) continue;
      const p = of(resolve(entry.playerId));
      const best = p.bests[t.gameMode];
      if (takesRecord(spec, { value, achievedAt: at }, best)) {
        if (best) p.breakdown.personalBest += xpRules.personalBest;
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
        p.breakdown.tournaments += xpRules.tournamentCompleted;
        if (won) {
          p.stats.tournamentsWon++;
          p.breakdown.tournaments += xpRules.tournamentWon;
        }
      }
    }
  }

  const xpOf = (p: Acc) => {
    const b = p.breakdown;
    return b.participation + b.wins + b.tournaments + b.personalBest + b.elsewhere;
  };
  // A card can only add: its XP replaces the derived one when higher, its bests compete.
  const cards = new Map<string, PlayerCard>();
  for (const card of options.cards ?? []) {
    const playerId = resolve(card.playerId);
    const known = cards.get(playerId);
    const own = { ...card, playerId };
    cards.set(playerId, known ? mergeCards(known, own) : own);
  }
  for (const card of cards.values()) {
    const p = of(card.playerId);
    p.breakdown.elsewhere += Math.max(0, card.xp - xpOf(p));
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
  return { players, records };
}
