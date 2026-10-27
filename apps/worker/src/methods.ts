// The engine methods the server exposes, shared by the Worker (permissions) and the web client.

/** Every signed-in account may call these: they only read. */
export const readMethods = [
  'players',
  'events',
  'statistics',
  'history',
  'tournaments',
  'tournament',
  'match',
  'standings',
  'status',
  'progression',
  'crews',
  'links',
  'crewProgression',
  'crewTournaments',
  'allTournaments',
  'playSpaces',
  'matchAccess',
  'scorerCandidates',
] as const;
/** Read-only too, but only for admins: what was removed or switched off. */
export const adminReadMethods = [
  'removedTournaments',
  'unclassifiedTournaments',
  'variants',
] as const;
/**
 * These change data: admins only, except what rpc.ts allows an account: editing the own profile,
 * creating players, play spaces and matches, and changing a match it is the scorer of.
 */
export const writeMethods = [
  'createPlayer',
  'updatePlayer',
  'createEvent',
  'updateEvent',
  'createTournament',
  'tournamentCommand',
  'matchCommand',
  'recordResult',
  'submitTurn',
  'undo',
  'correct',
  'exportBackup',
  'importBackup',
  'saveCrew',
  'deleteCrew',
  'linkPlayers',
  'removeTournament',
  'exportCrew',
  'previewMerge',
  'mergeBackup',
  'moveTournament',
  'createPlaySpace',
  'assignUnclassified',
  'resolveVariant',
  'transferScorer',
  'takeOverScoring',
  'recoverScorer',
] as const;
/** Backups travel as their exported text: the server checks their integrity itself. */
export const backupMethods = ['importBackup', 'previewMerge', 'mergeBackup'] as const;
export type CloudMethod =
  (typeof readMethods)[number] | (typeof adminReadMethods)[number] | (typeof writeMethods)[number];
/** Scoring rights of a match: answered by the server's own tables, not by the engine. */
export type AccessMethod =
  'matchAccess' | 'scorerCandidates' | 'transferScorer' | 'takeOverScoring' | 'recoverScorer';
