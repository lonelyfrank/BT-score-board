import type { z } from 'zod';
import type * as schemas from '../../../../packages/contracts/src/schemas/index.js';
import type {
  matchCommandPaths,
  tournamentCommandPaths,
} from '../../../../packages/application/src/services/backend.js';

export type Player = z.output<typeof schemas.playerResponse>;
export type PlayerStatus = Player['status'];
export type PlayerPatch = z.input<typeof schemas.updatePlayer>;
export type PubEvent = z.output<typeof schemas.eventResponse>;
export type CreateEvent = z.input<typeof schemas.createEvent>;
export type EventPatch = z.input<typeof schemas.updateEvent>;
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
/** A turn total, or one value per dart in throwing order. */
export type TurnInput = number | number[];
export type ScoreChange = { scoreId: string; score: number };
/** A final result (or part of a Hi-Score one), without the version guards. */
export type ResultInput = Omit<
  z.input<typeof schemas.recordResult>,
  'expectedVersion' | 'expectedMatchVersion'
>;

/**
 * What the screens need from the game, independently of where it runs: in this browser
 * (standalone, IndexedDB) or on the Fastify server (shared mode).
 */
export interface GameAdapter {
  readonly mode: 'standalone' | 'shared';
  players(search?: string, offset?: number, status?: PlayerStatus): Promise<Page<Player>>;
  createPlayer(
    displayName: string,
    nickname?: string | null,
    avatar?: string | null,
  ): Promise<Player>;
  updatePlayer(id: string, patch: PlayerPatch): Promise<Player>;
  statistics(id: string): Promise<Statistics>;
  history(id: string): Promise<Page<Summary>>;
  events(): Promise<Page<PubEvent>>;
  createEvent(input: CreateEvent): Promise<PubEvent>;
  updateEvent(id: string, patch: EventPatch): Promise<PubEvent>;
  tournaments(offset?: number, eventId?: string): Promise<Page<Summary>>;
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
  /**
   * Records or corrects the final result of a match as shown by the totem. The same `key` for a
   * repeated confirmation replays it instead of writing twice.
   */
  recordResult(m: Match, input: ResultInput, key: string): Promise<Match>;
  /** Legacy turn entry: records the current turn (total or every dart) and completes it. */
  submitTurn(m: Match, score: TurnInput): Promise<Match>;
  /** Voids every score of the last scored turn, which reopens it. The reason stays in the audit. */
  undo(m: Match, reason?: string): Promise<Match>;
  /** Corrects recorded scores; each keeps its previous value in the audit. */
  correct(m: Match, changes: ScoreChange[], reason?: string): Promise<Match>;
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
  STAGE_CLOSED:
    'Questa fase è già confermata: va riaperta dall’organizzatore prima di modificare i punteggi.',
  INACTIVE_PLAYER: 'Un giocatore iscritto è stato disattivato: riattivalo prima di avviare.',
  INVALID_GROUP_ASSIGNMENTS:
    'Ogni iscritto deve stare in un solo girone, con almeno 2 giocatori e abbastanza qualificati per girone.',
  INVALID_EXCLUSIONS: 'Vanno esclusi esattamente tutti i giocatori che non hanno finito i turni.',
  INSUFFICIENT_PLAYERS: 'Restano troppo pochi giocatori per la finale.',
  EVENT_CLOSED: 'La serata è conclusa o annullata: non si possono aggiungere tornei.',
  SEED_REQUIRED: 'Per l’ordine per seed ogni iscritto deve avere un seed.',
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
  RESULT_HAS_DEPENDENTS:
    'Questo risultato è già stato usato per le fasi successive: conferma la correzione per riaprirle.',
  WINNER_REQUIRED: 'Indica il vincitore mostrato dal totem.',
  RESULT_INCONSISTENT: 'Il vincitore indicato non corrisponde ai punteggi inseriti.',
  INVALID_SCORE: 'Punteggio fuori dai limiti di questa modalità.',
  INVALID_TARGET: 'L’obiettivo Exacta va da 250 a 350.',
  INVALID_RESULT: 'Risultato non valido per i giocatori di questo incontro.',
  INVALID_GAME_MODE: 'Il torneo rapido Hi-Score si gioca solo in modalità Hi-Score.',
  INVALID_PLAYER_COUNT:
    'Numero di partecipanti non ammesso: oltre i posti del totem si gioca a manche solo con i giochi a punti.',
  INVALID_RANKING:
    'La differenza punti vale solo per Hi-Score: le altre modalità contano vittorie.',
  RECORDING_MISMATCH: 'Questo torneo registra i punteggi turno per turno.',
  DECISION_LOCKED: 'Lo spareggio è stato deciso dall’organizzatore e non ha punteggi.',
  WALKOVER_LOCKED: 'Incontro vinto a tavolino per ritiro: non ha punteggi.',
  MATCH_CANCELLED: 'L’incontro è stato annullato.',
  INVALID_TIE_GROUP: 'Lo spareggio deve includere esattamente tutti i giocatori a pari merito.',
  PLAYOFF_PENDING: 'C’è già uno spareggio da giocare per questa parità.',
  TOURNAMENT_NOT_ACTIVE: 'Il torneo non è in corso (in pausa o concluso).',
  INCOMPLETE_QUALIFICATION: 'Mancano risultati: registra tutti gli incontri prima di confermare.',
  INCOMPLETE_FINAL: 'Registra il risultato della finale e degli spareggi prima di confermare.',
  REGISTRATION_CLOSED: 'Le iscrizioni sono chiuse: dopo l’avvio un giocatore può solo ritirarsi.',
  DUPLICATE_ENTRY: 'Giocatore già iscritto (anche in un’altra squadra).',
  PLAYER_LIMIT: 'Limite tecnico raggiunto: massimo 256 unità per torneo.',
  INVALID_TEAMS: 'Ogni squadra deve avere da 1 a 8 giocatori.',
  TEAM_LOCKED: 'Squadra bloccata: sbloccala prima di modificarla.',
  TEAM_FULL: 'La squadra ha già 8 giocatori.',
  HEAT_BUSY: 'C’è già una manche al bersaglio: completala prima di passare alla successiva.',
  INVALID_HEATS:
    'Ogni giocatore ancora da giocare deve stare in una sola manche, senza superare i posti del totem.',
  HEAT_LOCKED: 'Manche confermata: sbloccala prima di modificarla.',
  INVALID_HEAT_CAPACITY: 'Posti per manche non validi per questo totem.',
  INCOMPLETE_HEAT: 'Mancano risultati in questa manche.',
  TRACKING_DISABLED: 'Questa partita registra solo il risultato finale.',
  INVALID_TRACKING: 'Il tracciamento dei round richiede la registrazione dei risultati finali.',
  ROUNDS_MISSING:
    'Modalità round per round: registra o salta ogni round prima del risultato finale.',
  RESULT_DIFFERS_FROM_ROUNDS:
    'Il risultato ufficiale è diverso dalla somma dei round: rivedi i round o indica il motivo.',
  INVALID_ROUND: 'Numero di round non valido per questo gioco.',
  INVALID_PLAYER: 'Il tiratore indicato non fa parte della squadra.',
  ROTATION_PAUSED: 'Rotazione in pausa: riprendila per avanzare.',
  NOTHING_TO_UNDO: 'Nessun avanzamento da annullare.',
  NOTHING_TO_RESTORE: 'Questo valore non ne sostituiva un altro.',
  INVALID_ROTATION: 'Il nuovo ordine deve contenere tutti i giocatori una volta sola.',
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

export const defaultUndoReason = 'Annullamento ultimo inserimento dalla partita live';

/** The scores to send for a turn, skipping those the backend already holds for it. */
export function missingScores(m: Match, turnId: string, input: TurnInput) {
  const recorded = m.scores.filter((s) => s.turnId === turnId && !s.voided);
  if (!Array.isArray(input)) return recorded.length ? [] : [{ score: input, dartIndex: null }];
  return input
    .map((score, i) => ({ score, dartIndex: i + 1 }))
    .filter((d) => !recorded.some((s) => s.dartIndex === d.dartIndex));
}
/** Scores of the last turn that holds any, which an undo removes together. */
export function lastTurnScores(m: Match) {
  const valid = m.scores.filter((s) => !s.voided);
  const last = valid.at(-1);
  return last ? valid.filter((s) => s.turnId === last.turnId) : [];
}
/** Versions to send with the next command on a match, read from the tournament just returned. */
export function versionsAfter(t: Tournament, matchId: string) {
  return {
    expectedVersion: t.version,
    expectedMatchVersion: t.matches.find((x) => x.id === matchId)!.version,
  };
}

export type EntryMode = 'total' | 'dart';
/** How the scorer likes to enter points; a per-device convenience, never game data. */
export const entryMode = {
  get(): EntryMode {
    try {
      return localStorage.getItem('bt-entry-mode') === 'dart' ? 'dart' : 'total';
    } catch {
      return 'total';
    }
  },
  set(mode: EntryMode) {
    try {
      localStorage.setItem('bt-entry-mode', mode);
    } catch {
      /* Not remembered. */
    }
  },
};
export const nickname = (p: { nickname: string | null }) => (p.nickname ? `“${p.nickname}”` : '');

/** Lighter list item, as returned by GET /tournaments. */
export function toSummary(t: Tournament): Summary {
  const { entries: _e, stages: _s, groups: _g, matches: _m, results: _r, ...summary } = t;
  return summary;
}
