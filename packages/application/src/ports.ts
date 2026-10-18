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
export interface Store {
  transaction<T>(work: () => T): T;
  getPlayer(id: string): Player | undefined;
  savePlayer(player: Player): void;
  listPlayers(options: ListOptions): Page<Player>;
  getEvent(id: string): PubEvent | undefined;
  saveEvent(event: PubEvent): void;
  listEvents(options: ListOptions): Page<PubEvent>;
  getTournament(id: string): Tournament | undefined;
  saveTournament(tournament: Tournament, expectedVersion?: number): void;
  listTournaments(options: ListOptions): Page<Tournament>;
  tournamentsForPlayer(playerId: string): Tournament[];
  tournamentForMatch(id: string): Tournament | undefined;
  tournamentForScore(id: string): Tournament | undefined;
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
