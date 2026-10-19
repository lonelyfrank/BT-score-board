import type {
  ApplicationEvent,
  Operation,
  Player,
  PubEvent,
  Tournament,
} from '../../domain/src/index.js';
export interface ListOptions {
  limit: number;
  offset: number;
  search?: string;
  status?: string;
  eventId?: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface PlayerRepository {
  getPlayer(id: string): Player | undefined;
  savePlayer(player: Player): void;
  listPlayers(options: ListOptions): Page<Player>;
}
/**
 * The Tournament aggregate (entries, stages, groups, matches and their results) is saved as one
 * unit: a command changes it atomically, and its version guards against concurrent writers.
 */
export interface TournamentRepository {
  getTournament(id: string): Tournament | undefined;
  saveTournament(tournament: Tournament, expectedVersion?: number): void;
  listTournaments(options: ListOptions): Page<Tournament>;
  tournamentsForPlayer(playerId: string): Tournament[];
}
/** Matches live inside their tournament: lookups return the owning aggregate. */
export interface MatchRepository {
  tournamentForMatch(id: string): Tournament | undefined;
  tournamentForScore(id: string): Tournament | undefined;
}
/**
 * Everything the application services need from persistence. IndexedDB (MemoryStore + LocalDatabase)
 * and SQLite implement it; a future synchronized store would too, without touching the engine.
 */
export interface Store extends PlayerRepository, TournamentRepository, MatchRepository {
  transaction<T>(work: () => T): T;
  getEvent(id: string): PubEvent | undefined;
  saveEvent(event: PubEvent): void;
  listEvents(options: ListOptions): Page<PubEvent>;
  appendAudit(operation: Operation): void;
  audit(tournamentId: string, options: ListOptions): Page<Operation>;
  appendEvent(event: ApplicationEvent): void;
  events(
    tournamentId: string,
    after: number,
    limit: number,
  ): (ApplicationEvent & { sequence: number })[];
  getIdempotency(key: string): { fingerprint: string; response: unknown } | undefined;
  saveIdempotency(key: string, fingerprint: string, response: unknown): void;
}
// Durable polling is available today. A future SSE/WebSocket adapter can consume this port.
export interface NotificationAdapter {
  publish(event: ApplicationEvent): Promise<void>;
}
