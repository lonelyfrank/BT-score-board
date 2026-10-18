import {
  matchCommandPaths,
  tournamentCommandPaths,
  type Backend,
} from '../../../../packages/application/src/services/backend.js';
import { uuid } from '../../../../packages/application/src/portable.js';
import { DomainError, matchById } from '../../../../packages/domain/src/index.js';
import {
  LocalEngine,
  readBackup,
  summarizeBackup,
  type BackupFile,
  type EngineEvent,
  type EngineOptions,
  type MemoryStore,
} from '../../../../packages/local-store/src/index.js';
import {
  ApiError,
  messages,
  toSummary,
  type CreateTournament,
  type GameAdapter,
  type Match,
  type MatchAction,
  type Tournament,
  type TournamentAction,
} from './game.js';

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DomainError)
    return new ApiError(error.code, messages[error.code] ?? error.message);
  if ((error as { name?: string } | null)?.name === 'ZodError') {
    const issues = (error as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return new ApiError(
      'VALIDATION_ERROR',
      issues.map((i) => `${i.path.join('.') || 'dati'}: ${i.message}`).join('; '),
    );
  }
  return new ApiError('STORAGE_FAILED', messages.STORAGE_FAILED!);
}
const all = { limit: 100 };

/**
 * Standalone mode: the unchanged application services run in this browser and every command
 * is durable in IndexedDB before it resolves. No network request is involved.
 */
export class LocalGameAdapter implements GameAdapter {
  readonly mode = 'standalone' as const;
  private engine: Promise<LocalEngine> | null = null;
  private listeners = new Set<(event: EngineEvent) => void>();
  constructor(private readonly options: EngineOptions = {}) {}

  /** Opens the local database once; a failed attempt can be retried. */
  connect(): Promise<LocalEngine> {
    this.engine ??= LocalEngine.open(this.options).then(
      (engine) => {
        engine.subscribe((event) => this.listeners.forEach((listener) => listener(event)));
        return engine;
      },
      (error: unknown) => {
        this.engine = null;
        throw toApiError(error);
      },
    );
    return this.engine;
  }
  subscribe(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private async read<T>(work: (backend: Backend, store: MemoryStore) => T): Promise<T> {
    const engine = await this.connect();
    try {
      return engine.read(work);
    } catch (error) {
      throw toApiError(error);
    }
  }
  private async write<T>(work: (backend: Backend) => T): Promise<T> {
    const engine = await this.connect();
    try {
      return await engine.write(work);
    } catch (error) {
      throw toApiError(error);
    }
  }

  players(search = '', offset = 0) {
    return this.read((_, store) => store.listPlayers({ ...all, offset, search }));
  }
  createPlayer(displayName: string) {
    return this.write((b) => b.createPlayer({ displayName }));
  }
  updatePlayer(id: string, displayName: string) {
    return this.write((b) => b.updatePlayer(id, { displayName }));
  }
  statistics(id: string) {
    return this.read((b) => b.statistics(id));
  }
  async history(id: string) {
    const page = await this.read((b) => b.history(id, { ...all, offset: 0 }));
    return { ...page, items: page.items.map(toSummary) };
  }
  async tournaments(offset = 0) {
    const page = await this.read((_, store) => store.listTournaments({ ...all, offset }));
    return { ...page, items: page.items.map(toSummary) };
  }
  tournament(id: string) {
    return this.read((b) => b.tournament(id));
  }
  match(id: string) {
    return this.read((b) => b.liveMatch(id));
  }
  standings(id: string) {
    return this.read((b) => b.standings(id));
  }
  createTournament(input: CreateTournament) {
    return this.write((b) => b.createTournament(input));
  }
  tournamentCommand(t: Tournament, action: TournamentAction, extra: Record<string, unknown> = {}) {
    return this.write((b) =>
      b.execute(
        tournamentCommandPaths[action],
        t.id,
        { expectedVersion: t.version, ...extra },
        { idempotencyKey: uuid() },
      ),
    );
  }
  matchCommand(m: Match, action: MatchAction, extra: Record<string, unknown> = {}) {
    return this.write((b) => {
      b.execute(
        matchCommandPaths[action],
        m.tournamentId,
        { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version, ...extra },
        { matchId: m.id, idempotencyKey: uuid() },
      );
      return b.liveMatch(m.id);
    });
  }
  /**
   * RecordScore and CompleteTurn, the same two backend commands, committed together: the
   * score is never stored without the turn moving on, and a failure changes neither.
   */
  submitTurn(m: Match, score: number) {
    return this.write((b) => {
      const turnId = m.turnState.currentTurn?.id;
      if (!turnId) throw new ApiError('NO_TURN', 'Nessun turno attivo.');
      let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
      // A total entered before (e.g. data moved from the shared backend) is completed, not re-sent.
      if (!m.scores.some((s) => s.turnId === turnId && !s.voided)) {
        const t = b.execute(
          'RecordScore',
          m.tournamentId,
          { ...versions, turnId, score },
          { matchId: m.id, idempotencyKey: uuid() },
        );
        versions = { expectedVersion: t.version, expectedMatchVersion: matchById(t, m.id).version };
      }
      b.execute(
        'CompleteTurn',
        m.tournamentId,
        { ...versions, turnId },
        { matchId: m.id, idempotencyKey: uuid() },
      );
      return b.liveMatch(m.id);
    });
  }
  undo(m: Match) {
    return this.write((b) => {
      const last = m.scores.filter((s) => !s.voided).at(-1);
      if (!last) throw new ApiError('NO_SCORE', 'Nessun punteggio da annullare.');
      b.execute(
        'VoidScore',
        m.tournamentId,
        {
          expectedVersion: m.tournamentVersion,
          expectedMatchVersion: m.version,
          reason: 'Annullamento ultimo inserimento dalla partita live',
        },
        { scoreId: last.id, idempotencyKey: uuid() },
      );
      return b.liveMatch(m.id);
    });
  }
  getPending() {
    // Local commits either complete or leave nothing behind: there is no uncertain outcome.
    return undefined;
  }

  async status() {
    return (await this.connect()).status();
  }
  async exportBackup() {
    const engine = await this.connect();
    try {
      return await engine.exportBackup();
    } catch (error) {
      throw toApiError(error);
    }
  }
  async readBackup(text: string) {
    try {
      const backup = await readBackup(text);
      return { backup, summary: summarizeBackup(backup) };
    } catch (error) {
      throw toApiError(error);
    }
  }
  async importBackup(backup: BackupFile, replaceExisting: boolean) {
    const engine = await this.connect();
    try {
      await engine.importBackup(backup, { replaceExisting });
    } catch (error) {
      throw toApiError(error);
    }
  }
}
