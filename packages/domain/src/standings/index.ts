import { ensure, type Match, type Tournament } from '../model.js';
import { playerPerformance } from '../scoring/high-score.js';
import { games, resultCriteria } from '../games/catalog.js';
export interface Standing {
  tournamentEntryId: string;
  placement: number;
  tied: boolean;
  total: number;
  bestTurn: number;
  average: number;
  turns: number;
  gapToLeader: number;
  progression: number[];
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scored: number;
  conceded: number;
  difference: number;
  criteria: number[];
  /** A result (or a completed turn, legacy) exists for this player. */
  recorded: boolean;
  /** The player withdrew: never selected for the next phase. */
  withdrawn: boolean;
  /** Best and average final score per match (Hi-Score results). */
  bestScore: number;
  averageScore: number;
}
const row = (id: string): Standing => ({
  tournamentEntryId: id,
  placement: 0,
  tied: false,
  total: 0,
  bestTurn: 0,
  average: 0,
  turns: 0,
  gapToLeader: 0,
  progression: [],
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  scored: 0,
  conceded: 0,
  difference: 0,
  criteria: [],
  recorded: false,
  withdrawn: false,
  bestScore: 0,
  averageScore: 0,
});
function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
const withdrawn = (t: Tournament, id: string) =>
  t.entries.find((e) => e.id === id)?.status === 'withdrawn';

/** Final score of a player in a match: the recorded result, or the legacy turn total. */
export function participantScore(t: Tournament, m: Match, entryId: string): number | null {
  if (t.recording === 'turns' && !m.result) return playerPerformance(m, entryId).total;
  return m.result?.scores[entryId] ?? null;
}

/** How a playoff (or organizer decision) orders the players it involves. */
function playoffKey(t: Tournament, playoff: Match, entryId: string): number[] {
  const decision = playoff.result?.decision;
  if (decision) return [decision.order.length - decision.order.indexOf(entryId)];
  if (t.recording === 'turns') {
    const performance = playerPerformance(playoff, entryId);
    return t.tournamentConfiguration.tiePolicy === 'BEST_TURN_THEN_PLAYOFF'
      ? [performance.total, performance.bestTurn]
      : [performance.total];
  }
  return resultCriteria(
    t.gameMode,
    participantScore(t, playoff, entryId),
    playoff.winnerEntryId === entryId,
    playoff.result?.targetScore ?? null,
  );
}

export function rank(rows: Standing[], tournament: Tournament, target: string): Standing[] {
  // A tie-break is meaningful only for the exact equal subgroup at the time it was played.
  let buckets: Standing[][] = [];
  for (const r of [...rows].sort(
    (a, b) =>
      compare(a.criteria, b.criteria) || a.tournamentEntryId.localeCompare(b.tournamentEntryId),
  )) {
    const last = buckets.at(-1);
    if (last && compare(last[0]!.criteria, r.criteria) === 0) last.push(r);
    else buckets.push([r]);
  }
  for (const playoff of tournament.matches
    .filter((m) => m.matchType === 'tiebreak' && m.tieTarget === target && m.status === 'completed')
    .sort((a, b) => a.sequence - b.sequence)) {
    buckets = buckets.flatMap((bucket) => {
      if (
        bucket.length < 2 ||
        bucket.length !== playoff.participants.length ||
        !bucket.every((r) =>
          playoff.participants.some((p) => p.tournamentEntryId === r.tournamentEntryId),
        )
      )
        return [bucket];
      const scores = new Map(
        bucket.map((r) => [
          r.tournamentEntryId,
          playoffKey(tournament, playoff, r.tournamentEntryId),
        ]),
      );
      const ordered = [...bucket].sort(
        (a, b) =>
          compare(scores.get(a.tournamentEntryId)!, scores.get(b.tournamentEntryId)!) ||
          a.tournamentEntryId.localeCompare(b.tournamentEntryId),
      );
      const split: Standing[][] = [];
      for (const r of ordered) {
        const last = split.at(-1);
        if (
          last &&
          compare(scores.get(last[0]!.tournamentEntryId)!, scores.get(r.tournamentEntryId)!) === 0
        )
          last.push(r);
        else split.push([r]);
      }
      return split;
    });
  }
  const output: Standing[] = [];
  for (const bucket of buckets) {
    const placement = output.length + 1;
    for (const r of bucket)
      output.push({
        ...r,
        placement,
        tied: bucket.length > 1,
        gapToLeader: Math.max(0, (buckets[0]?.[0]?.total ?? 0) - r.total),
      });
  }
  return output;
}

/**
 * Ranking inside one match: Hi-Score totals (legacy turns), or the recorded result read as its
 * game demands (winner first, then the meaningful score). Withdrawn-before-the-end players of a
 * qualification or final are excluded; playoffs and decisions split ties.
 */
export function matchStandings(t: Tournament, match: Match): Standing[] {
  const excluded = t.stages.find((s) => s.id === match.stageId)?.excludedEntryIds ?? [];
  const players = match.participants.filter((p) => !excluded.includes(p.tournamentEntryId));
  if (t.recording === 'turns' && !match.result)
    return rank(
      players.map((p) => {
        const perf = playerPerformance(match, p.tournamentEntryId);
        return {
          ...row(p.tournamentEntryId),
          ...perf,
          recorded: perf.turns > 0,
          withdrawn: withdrawn(t, p.tournamentEntryId),
          bestScore: perf.total,
          averageScore: perf.total,
          criteria:
            t.tournamentConfiguration.tiePolicy === 'BEST_TURN_THEN_PLAYOFF'
              ? [perf.total, perf.bestTurn]
              : [perf.total],
        };
      }),
      t,
      match.id,
    );
  const decision = match.result?.decision;
  return rank(
    players.map((p) => {
      const id = p.tournamentEntryId;
      const score = participantScore(t, match, id);
      return {
        ...row(id),
        total: score ?? 0,
        recorded: score !== null || !!decision || match.status === 'completed',
        withdrawn: withdrawn(t, id),
        bestScore: score ?? 0,
        averageScore: score ?? 0,
        criteria: decision
          ? [decision.order.length - decision.order.indexOf(id)]
          : resultCriteria(
              t.gameMode,
              score,
              match.winnerEntryId === id,
              match.result?.targetScore ?? null,
            ),
      };
    }),
    t,
    match.id,
  );
}
/** Kept name: every match ranking, Hi-Score or not. */
export const highScoreStandings = matchStandings;

/** Winner of a completed match, or null on a draw. */
function decided(t: Tournament, match: Match) {
  if (t.recording === 'turns' && !match.result) {
    const ranked = matchStandings(t, match);
    return ranked[0]!.tied ? null : ranked[0]!.tournamentEntryId;
  }
  return match.winnerEntryId;
}
/** The ranking chain after points; POINTS_SCORE only where scores are comparable points. */
export function groupRanking(t: Tournament) {
  return (
    t.tournamentConfiguration.groupRanking ??
    (t.gameMode === 'HI_SCORE' ? 'POINTS_SCORE' : 'POINTS_WINS')
  );
}

export function groupStandings(t: Tournament, groupId: string): Standing[] {
  const group = t.groups.find((g) => g.id === groupId);
  ensure(group, 'NOT_FOUND', 'Group not found', 404);
  const rows = group.entryIds.map(row),
    config = t.tournamentConfiguration;
  const legacy = t.recording === 'turns';
  const byScore = groupRanking(t) === 'POINTS_SCORE';
  // Hi-Score-like totals actually played (walkovers excluded): best and average per match.
  const played = new Map<string, number[]>();
  const matches = t.matches.filter(
    (m) => m.groupId === groupId && m.matchType === 'group' && m.status === 'completed',
  );
  for (const match of matches) {
    const winner = decided(t, match);
    if (winner === null && !config.allowDraws) continue;
    for (const p of match.participants) {
      const r = rows.find((r) => r.tournamentEntryId === p.tournamentEntryId)!;
      const opponent = match.participants.find((o) => o !== p)!;
      const score = participantScore(t, match, p.tournamentEntryId),
        against = participantScore(t, match, opponent.tournamentEntryId);
      r.played++;
      if (byScore) {
        r.scored += score ?? 0;
        r.conceded += against ?? 0;
      }
      if (legacy && !match.result) {
        const performance = playerPerformance(match, p.tournamentEntryId);
        r.turns += performance.turns;
        r.bestTurn = Math.max(r.bestTurn, performance.bestTurn);
      }
      if (score !== null && games[t.gameMode].scoring === 'points' && !match.result?.walkover)
        played.set(r.tournamentEntryId, [...(played.get(r.tournamentEntryId) ?? []), score]);
      if (winner === null) {
        r.draws++;
        r.points += config.drawPoints;
      } else if (winner === p.tournamentEntryId) {
        r.wins++;
        r.points += config.winPoints;
      } else {
        r.losses++;
        r.points += config.lossPoints;
      }
    }
  }
  for (const r of rows) {
    r.total = r.scored;
    r.average = r.turns ? r.scored / r.turns : 0;
    r.difference = r.scored - r.conceded;
    r.recorded = r.played > 0;
    r.withdrawn = withdrawn(t, r.tournamentEntryId);
    const totals = played.get(r.tournamentEntryId) ?? [];
    r.bestScore = Math.max(0, ...totals);
    r.averageScore = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    r.criteria = byScore ? [r.points, r.difference, r.scored] : [r.points, r.wins];
  }
  for (const r of rows) {
    const width = r.criteria.length;
    const equal = rows.filter(
      (other) => compare(r.criteria.slice(0, width), other.criteria.slice(0, width)) === 0,
    );
    let headToHead = 0;
    if (equal.length === 2) {
      const direct = matches.find((m) =>
        equal.every((e) => m.participants.some((p) => p.tournamentEntryId === e.tournamentEntryId)),
      );
      if (direct && decided(t, direct) === r.tournamentEntryId) headToHead = 1;
    }
    r.criteria.push(headToHead);
  }
  const ranked = rank(rows, t, groupId);
  return ranked.map((r) => ({ ...r, gapToLeader: (ranked[0]?.points ?? 0) - r.points }));
}

/** The first `count` eligible players; a tie across the boundary needs a playoff or decision. */
export function selectQualifiers(rows: Standing[], count: number): string[] {
  const eligible = rows.filter((r) => !r.withdrawn);
  ensure(
    eligible.length >= count,
    'INSUFFICIENT_PLAYERS',
    'Fewer participants than configured qualifiers',
    422,
  );
  ensure(
    count === eligible.length || eligible[count - 1]!.placement !== eligible[count]!.placement,
    'TIE_REQUIRES_PLAYOFF',
    'A qualification boundary tie needs a recorded playoff',
  );
  return eligible.slice(0, count).map((r) => r.tournamentEntryId);
}
