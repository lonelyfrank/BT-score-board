import {
  ApiError,
  defaultUndoReason,
  lastTurnScores,
  messages,
  missingScores,
  storage,
  versionsAfter,
  type CreateEvent,
  type CreateTournament,
  type EventPatch,
  type GameAdapter,
  type Match,
  type MatchAction,
  type Page,
  type Pending,
  type Player,
  type PlayerPatch,
  type PlayerStatus,
  type PubEvent,
  type ResultInput,
  type ScoreChange,
  type Standings,
  type Statistics,
  type Summary,
  type Tournament,
  type TournamentAction,
  type TurnInput,
} from './game.js';

export interface ServerInfo {
  reachable: boolean;
  /** Rankings readable without a token (PUBLIC_READS on the server). */
  publicReads: boolean | null;
}

/** Shared mode: the Fastify API is the source of truth; commands carry idempotency keys. */
export class HttpAdapter implements GameAdapter {
  readonly mode = 'shared' as const;
  private token = storage.get('bt-organizer') ?? '';
  private pending = new Map<string, Pending>();
  setToken(token: string) {
    this.token = token;
    token ? storage.set('bt-organizer', token) : storage.remove('bt-organizer');
  }
  hasToken() {
    return !!this.token;
  }
  /** Health and read policy of the pub's server, both checked without the token. */
  async serverInfo(): Promise<ServerInfo> {
    const probe = (path: string) =>
      fetch(path, { signal: AbortSignal.timeout(5000) }).then(
        (r) => r.status,
        () => 0,
      );
    const [health, reads] = await Promise.all([probe('/health'), probe('/api/v1/players?limit=1')]);
    return {
      reachable: health >= 200 && health < 300,
      publicReads: reads === 200 ? true : reads === 401 ? false : null,
    };
  }
  /** Drops unconfirmed match commands once the server state has been re-read. */
  clearPending(matchId: string) {
    for (const path of [`/matches/${matchId}/scores`, `/matches/${matchId}/turns/complete`]) {
      this.pending.delete(path);
      storage.remove(`bt-command:${path}`);
    }
  }
  async request<T>(path: string, body?: unknown, key?: string, method = 'POST'): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/v1${path}`, {
        method: body === undefined ? 'GET' : method,
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(
        'NETWORK',
        'Connessione interrotta. Riprova: il comando verrà recuperato senza duplicare il punteggio.',
        true,
      );
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = data?.error?.code ?? `HTTP_${response.status}`;
      throw new ApiError(
        code,
        messages[code] ?? data?.error?.message ?? 'Il server non è disponibile. Riprova.',
        response.status >= 500 || response.status === 429,
      );
    }
    if (data === null)
      throw new ApiError('NETWORK', 'Risposta incompleta. Riprova il comando.', true);
    return data as T;
  }
  getPending(path: string): Pending | undefined {
    if (!this.pending.has(path)) {
      try {
        const saved = storage.get(`bt-command:${path}`);
        if (saved) this.pending.set(path, JSON.parse(saved));
      } catch {
        /* Invalid local draft. */
      }
    }
    return this.pending.get(path);
  }
  async command(path: string, body: Record<string, unknown>): Promise<Tournament> {
    const command = this.getPending(path) ?? { path, body, key: crypto.randomUUID() };
    this.pending.set(path, command);
    storage.set(`bt-command:${path}`, JSON.stringify(command));
    try {
      const result = await this.request<Tournament>(command.path, command.body, command.key);
      this.pending.delete(path);
      storage.remove(`bt-command:${path}`);
      return result;
    } catch (error) {
      if (error instanceof ApiError && !error.uncertain) {
        this.pending.delete(path);
        storage.remove(`bt-command:${path}`);
      }
      throw error;
    }
  }
  players(search = '', offset = 0, status?: PlayerStatus) {
    return this.request<Page<Player>>(
      `/players?limit=100&offset=${offset}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`,
    );
  }
  createPlayer(displayName: string, nickname: string | null = null, avatar: string | null = null) {
    return this.request<Player>('/players', { displayName, nickname, avatar });
  }
  updatePlayer(id: string, patch: PlayerPatch) {
    return this.request<Player>(`/players/${id}`, patch, undefined, 'PATCH');
  }
  events() {
    return this.request<Page<PubEvent>>('/events?limit=100');
  }
  createEvent(input: CreateEvent) {
    return this.request<PubEvent>('/events', input);
  }
  updateEvent(id: string, patch: EventPatch) {
    return this.request<PubEvent>(`/events/${id}`, patch, undefined, 'PATCH');
  }
  statistics(id: string) {
    return this.request<Statistics>(`/players/${id}/statistics`);
  }
  history(id: string) {
    return this.request<Page<Summary>>(`/players/${id}/history?limit=100`);
  }
  tournaments(offset = 0, eventId?: string) {
    return this.request<Page<Summary>>(
      `/tournaments?limit=100&offset=${offset}${eventId ? `&eventId=${eventId}` : ''}`,
    );
  }
  tournament(id: string) {
    return this.request<Tournament>(`/tournaments/${id}`);
  }
  match(id: string) {
    return this.request<Match>(`/matches/${id}`);
  }
  standings(id: string) {
    return this.request<Standings>(`/tournaments/${id}/standings`);
  }
  createTournament(input: CreateTournament) {
    return this.request<Tournament>('/tournaments', input);
  }
  async tournamentCommand(
    t: Tournament,
    action: TournamentAction,
    extra: Record<string, unknown> = {},
  ) {
    await this.command(`/tournaments/${t.id}/${action}`, { expectedVersion: t.version, ...extra });
    return this.tournament(t.id);
  }
  async matchCommand(m: Match, action: MatchAction, extra: Record<string, unknown> = {}) {
    await this.command(`/matches/${m.id}/${action}`, {
      expectedVersion: m.tournamentVersion,
      expectedMatchVersion: m.version,
      ...extra,
    });
    return this.match(m.id);
  }
  /** An unconfirmed result is replayed with its saved key and body (see command()). */
  recordResult(m: Match, input: ResultInput) {
    return this.matchCommand(m, 'result', input);
  }
  async submitTurn(m: Match, input: TurnInput) {
    const completion = this.getPending(`/matches/${m.id}/turns/complete`);
    if (completion) {
      await this.command(completion.path, completion.body);
      return this.match(m.id);
    }
    const path = `/matches/${m.id}/scores`;
    const saved = this.getPending(path);
    const turnId = (saved?.body.turnId as string | undefined) ?? m.turnState.currentTurn?.id;
    if (!turnId) throw new ApiError('NO_TURN', 'Nessun turno attivo.');
    // Recording and completion are distinct backend commands. An unconfirmed score is replayed
    // exactly first; then only what the server does not hold yet is sent, one dart at a time.
    let fresh = m;
    if (saved) {
      await this.command(path, saved.body);
      fresh = await this.match(m.id);
    }
    for (const { score, dartIndex } of missingScores(fresh, turnId, input)) {
      await this.command(path, {
        expectedVersion: fresh.tournamentVersion,
        expectedMatchVersion: fresh.version,
        turnId,
        score,
        ...(dartIndex === null ? {} : { dartIndex }),
      });
      fresh = await this.match(m.id);
    }
    if (fresh === m) fresh = await this.match(m.id);
    if (fresh.turns.find((t) => t.id === turnId)?.status !== 'completed') {
      await this.matchCommand(fresh, 'turns/complete', { turnId });
    }
    return this.match(m.id);
  }
  async undo(m: Match, reason = defaultUndoReason) {
    const scores = lastTurnScores(m);
    if (!scores.length) throw new ApiError('NO_SCORE', 'Nessun punteggio da annullare.');
    let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
    for (const score of scores)
      versions = versionsAfter(
        await this.command(`/scores/${score.id}/void`, { ...versions, reason }),
        m.id,
      );
    return this.match(m.id);
  }
  async correct(m: Match, changes: ScoreChange[], reason?: string) {
    let versions = { expectedVersion: m.tournamentVersion, expectedMatchVersion: m.version };
    for (const { scoreId, score } of changes)
      versions = versionsAfter(
        await this.command(`/scores/${scoreId}/correct`, {
          ...versions,
          score,
          ...(reason ? { reason } : {}),
        }),
        m.id,
      );
    return this.match(m.id);
  }
}
