import type { z } from 'zod';
import type * as schemas from '../../../../packages/contracts/src/schemas/index.js';
import type {
  matchCommandPaths,
  tournamentCommandPaths,
} from '../../../../packages/application/src/services/backend.js';

export type Player = z.output<typeof schemas.playerResponse>;
export type Tournament = z.output<typeof schemas.tournamentResponse>;
export type Match = z.output<typeof schemas.liveMatchResponse>;
export type Standings = z.output<typeof schemas.standingsResponse>;
export type Summary = z.output<typeof schemas.tournamentSummary>;
export type Statistics = z.output<typeof schemas.statisticsResponse>;
export type CreateTournament = z.input<typeof schemas.createTournament>;
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };
export type TournamentAction = keyof typeof tournamentCommandPaths;
export type MatchAction = keyof typeof matchCommandPaths;
export type Pending = { path: string; body: Record<string, unknown>; key: string };

/**
 * What the screens need from the game, independently of where it runs: in this browser
 * (standalone, IndexedDB) or on the Fastify server (shared mode).
 */
export interface GameAdapter {
  readonly mode: 'standalone' | 'shared';
  players(search?: string, offset?: number): Promise<Page<Player>>;
  createPlayer(displayName: string): Promise<Player>;
  updatePlayer(id: string, displayName: string): Promise<Player>;
  statistics(id: string): Promise<Statistics>;
  history(id: string): Promise<Page<Summary>>;
  tournaments(offset?: number): Promise<Page<Summary>>;
  tournament(id: string): Promise<Tournament>;
  match(id: string): Promise<Match>;
  standings(id: string): Promise<Standings>;
  createTournament(input: CreateTournament): Promise<Tournament>;
  tournamentCommand(
    t: Tournament,
    action: TournamentAction,
    extra?: Record<string, unknown>,
  ): Promise<Tournament>;
  matchCommand(m: Match, action: MatchAction, extra?: Record<string, unknown>): Promise<Match>;
  /** Records the current turn's total and completes the turn. */
  submitTurn(m: Match, score: number): Promise<Match>;
  undo(m: Match): Promise<Match>;
  /** A command with an unknown outcome that must be retried before new input (shared mode). */
  getPending(path: string): Pending | undefined;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export const messages: Record<string, string> = {
  UNAUTHORIZED: 'Accedi con il token organizzatore nelle Impostazioni.',
  VERSION_CONFLICT: 'La partita è stata aggiornata. Controlla i dati e ripeti il comando.',
  MATCH_VERSION_CONFLICT: 'Il turno è cambiato. Controlla il punteggio prima di riprovare.',
  TIE_REQUIRES_PLAYOFF: 'Parità decisiva: gioca uno spareggio prima di proseguire.',
  MATCH_ALREADY_ACTIVE: 'È già in corso un incontro. Completa quello prima di iniziarne un altro.',
  BOARD_BUSY: 'È già in corso un incontro. Completa quello prima di iniziarne un altro.',
  STALE_DATA:
    'I dati sono stati modificati in un’altra scheda. Controlla lo stato aggiornato e riprova.',
  STORAGE_FULL:
    'Spazio di archiviazione esaurito: il punteggio non è stato salvato. Esporta un backup e libera spazio sul telefono.',
  STORAGE_FAILED: 'Salvataggio non riuscito: il dato non è stato registrato. Riprova.',
  STORAGE_UNAVAILABLE:
    'Archivio locale non disponibile: questo browser non consente di salvare i dati (ad esempio in navigazione privata).',
  STORAGE_CLOSED: 'È stata installata una nuova versione in un’altra scheda. Ricarica l’app.',
  LOCAL_SCHEMA_NEWER:
    'I dati sono stati salvati da una versione più recente dell’app. Ricarica per aggiornarla.',
  BACKUP_INVALID: 'Il file non è un backup valido di BT Darts Score Board.',
  BACKUP_INTEGRITY:
    'Il backup è danneggiato o modificato: il controllo d’integrità non è riuscito.',
  BACKUP_UNSUPPORTED: 'Il backup è stato creato da una versione più recente dell’app.',
  CONFIRMATION_REQUIRED: 'Conferma la sostituzione dei dati presenti su questo dispositivo.',
};

// Session-scoped drafts: they survive a reload but not a closed tab.
export const storage = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* Memory still works. */
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Storage unavailable. */
    }
  },
};

/** Lighter list item, as returned by GET /tournaments. */
export function toSummary(t: Tournament): Summary {
  const { entries: _e, stages: _s, groups: _g, matches: _m, results: _r, ...summary } = t;
  return summary;
}
