import { type Match } from '../model.js';
export function currentTurn(match: Match) {
  return match.turns.find((t) => !['completed', 'skipped'].includes(t.status)) ?? null;
}
export function turnState(match: Match) {
  const remaining = match.turns.filter((t) => !['completed', 'skipped'].includes(t.status));
  return {
    matchId: match.id,
    matchStatus: match.status,
    currentTurn: remaining[0] ?? null,
    nextTurn: remaining[1] ?? null,
    turnsRemaining: remaining.length,
    completedEntryIds: match.participants
      .filter((p) =>
        match.turns
          .filter((t) => t.participantId === p.tournamentEntryId)
          .every((t) => t.status === 'completed'),
      )
      .map((p) => p.tournamentEntryId),
  };
}
