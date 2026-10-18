import type { GameAdapter, Match, Summary, Tournament } from './game';

export interface ActiveSession {
  tournament: Tournament;
  /** The match on the board, or the next one to play in the open stage. */
  match: Match | null;
  current: { player: string; turn: number; turns: number } | null;
  lastScore: { player: string; score: number } | null;
}

const entryName = (t: Tournament, id: string) =>
  t.entries.find((e) => e.id === id)?.displayNameAtRegistration ?? 'Giocatore';

/** What the organizer was doing: the newest started tournament and its match in progress. */
export async function activeSession(api: GameAdapter): Promise<ActiveSession | null> {
  const page = await api.tournaments();
  const summary = page.items.find((t) => t.status === 'active' || t.status === 'paused');
  if (!summary) return null;
  const tournament = await api.tournament(summary.id);
  const open = new Set(tournament.stages.filter((s) => s.status === 'open').map((s) => s.id));
  const target =
    tournament.matches.find((m) => m.status === 'active' || m.status === 'paused') ??
    tournament.matches
      .filter((m) => m.status === 'ready' && open.has(m.stageId))
      .sort((a, b) => a.sequence - b.sequence)[0];
  const match = target ? await api.match(target.id) : null;
  const turn = match?.turnState.currentTurn;
  const last = match?.scores.filter((s) => !s.voided).at(-1);
  return {
    tournament,
    match,
    current:
      match?.status === 'active' && turn
        ? {
            player: entryName(tournament, turn.participantId),
            turn: turn.turnNumber,
            turns: match.scoringConfiguration.turns,
          }
        : null,
    lastScore: last
      ? { player: entryName(tournament, last.tournamentEntryId), score: last.score }
      : null,
  };
}

export interface RecentResult {
  summary: Summary;
  winner: string | null;
}
export async function recentResults(api: GameAdapter, count = 3): Promise<RecentResult[]> {
  const page = await api.tournaments();
  const completed = page.items.filter((t) => t.status === 'completed').slice(0, count);
  return Promise.all(
    completed.map(async (summary) => {
      const t = await api.tournament(summary.id);
      const first = t.results.find((r) => r.finalPlacement === 1);
      return { summary, winner: first ? entryName(t, first.tournamentEntryId) : null };
    }),
  );
}

export const tournamentPath = (t: { id: string; mode: string }) =>
  `${t.mode === 'QUICK_HIGH_SCORE' ? '/hiscore' : '/tornei'}/${t.id}`;
