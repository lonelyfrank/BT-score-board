import { ensure, type Match, type Tournament } from '../model.js';
import { playerPerformance } from '../scoring/high-score.js';
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
});
function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (b[i] ?? 0) - (a[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
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
        bucket.map((r) => {
          const performance = playerPerformance(playoff, r.tournamentEntryId);
          return [
            r.tournamentEntryId,
            tournament.tournamentConfiguration.tiePolicy === 'BEST_TURN_THEN_PLAYOFF'
              ? [performance.total, performance.bestTurn]
              : [performance.total],
          ];
        }),
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
export function highScoreStandings(t: Tournament, match: Match): Standing[] {
  const excluded = t.stages.find((s) => s.id === match.stageId)?.excludedEntryIds ?? [];
  return rank(
    match.participants
      .filter((p) => !excluded.includes(p.tournamentEntryId))
      .map((p) => {
        const perf = playerPerformance(match, p.tournamentEntryId);
        return {
          ...row(p.tournamentEntryId),
          ...perf,
          criteria:
            t.tournamentConfiguration.tiePolicy === 'BEST_TURN_THEN_PLAYOFF'
              ? [perf.total, perf.bestTurn]
              : [perf.total],
        };
      }),
    t,
    match.id,
  );
}
export function groupStandings(t: Tournament, groupId: string): Standing[] {
  const group = t.groups.find((g) => g.id === groupId);
  ensure(group, 'NOT_FOUND', 'Group not found', 404);
  const rows = group.entryIds.map(row),
    config = t.tournamentConfiguration;
  const matches = t.matches.filter(
    (m) => m.groupId === groupId && m.matchType === 'group' && m.status === 'completed',
  );
  for (const match of matches) {
    const ranked = highScoreStandings(t, match);
    if (ranked[0]!.tied && !config.allowDraws) continue;
    for (const p of match.participants) {
      const r = rows.find((r) => r.tournamentEntryId === p.tournamentEntryId)!;
      const opponent = match.participants.find((o) => o !== p)!;
      const score = playerPerformance(match, p.tournamentEntryId),
        against = playerPerformance(match, opponent.tournamentEntryId);
      r.played++;
      r.scored += score.total;
      r.conceded += against.total;
      r.turns += score.turns;
      r.bestTurn = Math.max(r.bestTurn, score.bestTurn);
      if (ranked[0]!.tied) {
        r.draws++;
        r.points += config.drawPoints;
      } else if (ranked[0]!.tournamentEntryId === p.tournamentEntryId) {
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
    r.criteria = [r.points, r.difference, r.scored];
  }
  for (const r of rows) {
    const equal = rows.filter(
      (other) => compare(r.criteria.slice(0, 3), other.criteria.slice(0, 3)) === 0,
    );
    let headToHead = 0;
    if (equal.length === 2) {
      const direct = matches.find((m) =>
        equal.every((e) => m.participants.some((p) => p.tournamentEntryId === e.tournamentEntryId)),
      );
      if (direct) {
        const ranked = highScoreStandings(t, direct);
        if (!ranked[0]!.tied && ranked[0]!.tournamentEntryId === r.tournamentEntryId)
          headToHead = 1;
      }
    }
    r.criteria.push(headToHead);
  }
  const ranked = rank(rows, t, groupId);
  return ranked.map((r) => ({ ...r, gapToLeader: (ranked[0]?.points ?? 0) - r.points }));
}
export function selectQualifiers(rows: Standing[], count: number): string[] {
  ensure(
    rows.length >= count,
    'INSUFFICIENT_PLAYERS',
    'Fewer participants than configured qualifiers',
    422,
  );
  ensure(
    count === rows.length || rows[count - 1]!.placement !== rows[count]!.placement,
    'TIE_REQUIRES_PLAYOFF',
    'A qualification boundary tie needs a recorded playoff',
  );
  return rows.slice(0, count).map((r) => r.tournamentEntryId);
}
