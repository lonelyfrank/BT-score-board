import type { Player, Tournament } from './model.js';

/**
 * Brings data written before game modes and final results (local schema 1, SQLite 0001) to the
 * current model. Idempotent: current data is returned unchanged. Old tournaments were all
 * Hi-Score with turn-by-turn entry, and keep that recording until they end.
 */
export function upgradeTournament(raw: Tournament): Tournament {
  const t = raw as Tournament & Partial<Pick<Tournament, 'gameMode' | 'recording'>>;
  if (t.gameMode && t.recording && t.matches.every((m) => m.result !== undefined)) return t;
  return {
    ...t,
    gameMode: t.gameMode ?? 'HI_SCORE',
    recording: t.recording ?? 'turns',
    tournamentConfiguration: {
      ...t.tournamentConfiguration,
      groupRanking: t.tournamentConfiguration.groupRanking ?? null,
    },
    matches: t.matches.map((m) => ({ ...m, result: m.result ?? null })),
  };
}
export function upgradePlayer(raw: Player): Player {
  return raw.avatar === undefined ? { ...raw, avatar: null } : raw;
}
