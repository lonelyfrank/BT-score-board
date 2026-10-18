import type { z } from 'zod';
import type * as schemas from '../../../../packages/contracts/src/schemas/index.js';

export type Player = z.output<typeof schemas.playerResponse>;
export type Tournament = z.output<typeof schemas.tournamentResponse>;
export type Match = z.output<typeof schemas.liveMatchResponse>;
export type Standings = z.output<typeof schemas.standingsResponse>;
export type Summary = z.output<typeof schemas.tournamentSummary>;
export type Statistics = z.output<typeof schemas.statisticsResponse>;
export type CreateTournament = z.input<typeof schemas.createTournament>;
export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  UNAUTHORIZED: 'Accedi con il token organizzatore nelle Impostazioni.',
  VERSION_CONFLICT: 'La partita è stata aggiornata. Controlla i dati e ripeti il comando.',
  MATCH_VERSION_CONFLICT: 'Il turno è cambiato. Controlla il punteggio prima di riprovare.',
  TIE_REQUIRES_PLAYOFF: 'Parità decisiva: gioca uno spareggio prima di proseguire.',
  MATCH_ALREADY_ACTIVE: 'È già in corso un incontro. Completa quello prima di iniziarne un altro.',
};
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
type Pending = { path: string; body: Record<string, unknown>; key: string };
export class HttpAdapter {
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
  async tournamentCommand(t: Tournament, action: string, extra: Record<string, unknown> = {}) {
    await this.command(`/tournaments/${t.id}/${action}`, { expectedVersion: t.version, ...extra });
    return this.tournament(t.id);
  }
  async matchCommand(m: Match, action: string, extra: Record<string, unknown> = {}) {
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
export const api = new HttpAdapter();
