import type { Match, Player, Tournament, TournamentEntry } from './model.js';

const current = (t: Tournament) =>
  !!t.gameMode &&
  !!t.recording &&
  !!t.tracking &&
  t.tournamentConfiguration.heatStrategy !== undefined &&
  t.entries.every((e) => e.members !== undefined) &&
  t.matches.every(
    (m) =>
      m.result !== undefined &&
      m.heats !== undefined &&
      (m.result === null || m.result.reconciliation !== undefined),
  );

function upgradeEntry(e: TournamentEntry): TournamentEntry {
  if (e.members) return e;
  // Before teams every entry was one player, registered under their own name.
  return {
    ...e,
    kind: 'single',
    name: null,
    members: [{ playerId: e.playerId, displayName: e.displayNameAtRegistration }],
  };
}
function upgradeMatch(m: Match): Match {
  return {
    ...m,
    result: m.result ? { ...m.result, reconciliation: m.result.reconciliation ?? [] } : null,
    heats: m.heats ?? [],
    rounds: m.rounds ?? [],
    rotations: m.rotations ?? [],
  };
}

/**
 * Brings data written by earlier versions to the current model: game modes and final results
 * (local schema 1, SQLite 0001), then competition entries, heats and progressive tracking
 * (local schema 2, SQLite 0002). Idempotent: current data is returned unchanged. Old
 * tournaments were all Hi-Score with turn-by-turn entry, and keep that recording until they
 * end; tournaments without tracking record final results only.
 */
export function upgradeTournament(raw: Tournament): Tournament {
  const t = raw as Tournament & Partial<Pick<Tournament, 'gameMode' | 'recording' | 'tracking'>>;
  if (current(t)) return t;
  const config = t.tournamentConfiguration;
  return {
    ...t,
    gameMode: t.gameMode ?? 'HI_SCORE',
    recording: t.recording ?? 'turns',
    tracking: t.tracking ?? 'FINAL_ONLY',
    tournamentConfiguration: {
      ...config,
      groupRanking: config.groupRanking ?? null,
      heatCapacity: config.heatCapacity ?? null,
      heatStrategy: config.heatStrategy ?? 'balanced',
      x01Entry: config.x01Entry ?? 'REMAINING',
    },
    entries: t.entries.map(upgradeEntry),
    matches: t.matches.map(upgradeMatch),
  };
}
export function upgradePlayer(raw: Player): Player {
  return raw.avatar === undefined ? { ...raw, avatar: null } : raw;
}
