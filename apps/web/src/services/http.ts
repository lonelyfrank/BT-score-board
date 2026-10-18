import {
  ApiError,
  messages,
  storage,
  type CreateTournament,
  type GameAdapter,
  type Match,
  type MatchAction,
  type Page,
  type Pending,
  type Player,
  type Standings,
  type Statistics,
  type Summary,
  type Tournament,
  type TournamentAction,
} from './game.js';

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
  players(search = '', offset = 0) {
    return this.request<Page<Player>>(
      `/players?limit=100&offset=${offset}&search=${encodeURIComponent(search)}`,
    );
  }
  createPlayer(displayName: string) {
    return this.request<Player>('/players', { displayName });
  }
  updatePlayer(id: string, displayName: string) {
    return this.request<Player>(`/players/${id}`, { displayName }, undefined, 'PATCH');
  }
  statistics(id: string) {
    return this.request<Statistics>(`/players/${id}/statistics`);
  }
  history(id: string) {
    return this.request<Page<Summary>>(`/players/${id}/history?limit=100`);
  }
  tournaments(offset = 0) {
    return this.request<Page<Summary>>(`/tournaments?limit=100&offset=${offset}`);
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
  async submitTurn(m: Match, score: number) {
    const completion = this.getPending(`/matches/${m.id}/turns/complete`);
    if (completion) {
      await this.command(completion.path, completion.body);
      return this.match(m.id);
    }
    const saved = this.getPending(`/matches/${m.id}/scores`);
    const turnId = (saved?.body.turnId as string | undefined) ?? m.turnState.currentTurn?.id;
    if (!turnId) throw new ApiError('NO_TURN', 'Nessun turno attivo.');
    // Recording and completion are distinct backend commands. On reload, a
    // recorded but open turn is completed without recording a second score.
    const recorded = m.scores.some((s) => s.turnId === turnId && !s.voided);
    if (!recorded || saved) {
      await this.command(`/matches/${m.id}/scores`, {
        expectedVersion: m.tournamentVersion,
        expectedMatchVersion: m.version,
        turnId,
        score,
      });
    }
    const fresh = await this.match(m.id);
    if (fresh.turns.find((t) => t.id === turnId)?.status !== 'completed') {
      await this.matchCommand(fresh, 'turns/complete', { turnId });
    }
    return this.match(m.id);
  }
  async undo(m: Match) {
    const last = m.scores.filter((s) => !s.voided).at(-1);
    if (!last) throw new ApiError('NO_SCORE', 'Nessun punteggio da annullare.');
    await this.command(`/scores/${last.id}/void`, {
      expectedVersion: m.tournamentVersion,
      expectedMatchVersion: m.version,
      reason: 'Annullamento ultimo inserimento dalla partita live',
    });
    return this.match(m.id);
  }
}
