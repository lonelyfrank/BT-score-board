import {
  matchCommandPaths,
  tournamentCommandPaths,
  type Backend,
} from '../../../../packages/application/src/services/backend.js';
import { uuid } from '../../../../packages/application/src/portable.js';
import { DomainError } from '../../../../packages/domain/src/index.js';
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
  defaultUndoReason,
  lastTurnScores,
  messages,
  missingScores,
  toSummary,
  versionsAfter,
  type CreateEvent,
  type CreateTournament,
  type EventPatch,
  type GameAdapter,
  type Match,
  type MatchAction,
  type PlayerPatch,
  type PlayerStatus,
  type ScoreChange,
  type Tournament,
  type TournamentAction,
  type TurnInput,
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

  players(search = '', offset = 0, status?: PlayerStatus) {
    return this.read((_, store) =>
      store.listPlayers({ ...all, offset, search, ...(status ? { status } : {}) }),
    );
  }
  createPlayer(displayName: string, nickname: string | null = null) {
    return this.write((b) => b.createPlayer({ displayName, nickname }));
  }
  updatePlayer(id: string, patch: PlayerPatch) {
    return this.write((b) => b.updatePlayer(id, patch));
  }
  events() {
    return this.read((_, store) => store.listEvents({ ...all, offset: 0 }));
  }
  createEvent(input: CreateEvent) {
    return this.write((b) => b.createEvent(input));
  }
  updateEvent(id: string, patch: EventPatch) {
    return this.write((b) => b.updateEvent(id, patch));
  }
  statistics(id: string) {
    return this.read((b) => b.statistics(id));
  }
  async history(id: string) {
    const page = await this.read((b) => b.history(id, { ...all, offset: 0 }));
    return { ...page, items: page.items.map(toSummary) };
  }
  async tournaments(offset = 0, eventId?: string) {
    const page = await this.read((_, store) =>
      store.listTournaments({ ...all, offset, ...(eventId ? { eventId } : {}) }),
    );
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
   * RecordScore (once, or once per dart) and CompleteTurn, the same backend commands,
   * committed together: no score is stored without the turn moving on, and a failure changes
   * nothing.
   */
  submitTurn(m: Match, input: TurnInput) {
    return this.write((b) => {
      const turnId = m.turnState.currentTurn?.id;
      if (!turnId) throw new ApiError('NO_TURN', 'Nessun turno attivo.');
      let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
      // Scores entered before (e.g. data moved from the shared backend) are completed, not re-sent.
      for (const { score, dartIndex } of missingScores(m, turnId, input)) {
        const t = b.execute(
          'RecordScore',
          m.tournamentId,
          { ...versions, turnId, score, dartIndex },
          { matchId: m.id, idempotencyKey: uuid() },
        );
        versions = versionsAfter(t, m.id);
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
  undo(m: Match, reason = defaultUndoReason) {
    return this.write((b) => {
      const scores = lastTurnScores(m);
      if (!scores.length) throw new ApiError('NO_SCORE', 'Nessun punteggio da annullare.');
      let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
      for (const score of scores) {
        const t = b.execute(
          'VoidScore',
          m.tournamentId,
          { ...versions, reason },
          { scoreId: score.id, idempotencyKey: uuid() },
        );
        versions = versionsAfter(t, m.id);
      }
      return b.liveMatch(m.id);
    });
  }
  correct(m: Match, changes: ScoreChange[], reason?: string) {
    return this.write((b) => {
      let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
      for (const { scoreId, score } of changes) {
        const t = b.execute(
          'CorrectScore',
          m.tournamentId,
          { ...versions, score, ...(reason ? { reason } : {}) },
          { scoreId, idempotencyKey: uuid() },
        );
        versions = versionsAfter(t, m.id);
      }
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
