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
] as const;
/** Read-only too, but only for admins: what was removed or switched off. */
export const adminReadMethods = ['removedTournaments'] as const;
/** These change data: admins only, except a player editing their own profile. */
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
] as const;
/** Backups travel as their exported text: the server checks their integrity itself. */
export const backupMethods = ['importBackup', 'previewMerge', 'mergeBackup'] as const;
export type CloudMethod =
  (typeof readMethods)[number] | (typeof adminReadMethods)[number] | (typeof writeMethods)[number];
