import * as d from '../../../domain/src/index.js';
import * as s from '../../../contracts/src/index.js';
import type { Store, ListOptions } from '../ports.js';
import { sha256Hex, uuid } from '../portable.js';
import type { z } from 'zod';

export type CommandName = keyof typeof commandSchemas;
export const commandSchemas = {
  RegisterPlayer: s.registerPlayer,
  ReadyTournament: s.command,
  OpenRegistration: s.command,
  StartTournament: s.command,
  PauseTournament: s.command,
  ResumeTournament: s.command,
  CancelTournament: s.command,
  StartMatch: s.matchCommand,
  PauseMatch: s.matchCommand,
  ResumeMatch: s.matchCommand,
  RecordScore: s.recordScore,
  CompleteTurn: s.completeTurn,
  CompleteMatch: s.matchCommand,
  CorrectScore: s.correctScore,
  VoidScore: s.voidScore,
  FinalizeQualification: s.command,
  GenerateFinal: s.command,
  CreateTieBreak: s.tieBreak,
  CompleteTournament: s.command,
  ReopenStage: s.reopenStage,
  CloseQualificationEarly: s.earlyClose,
  ReorderMatches: s.reorderMatches,
  AdvanceKnockout: s.command,
  RecordResult: s.recordResult,
  WithdrawEntry: s.withdrawEntry,
  UnregisterPlayer: s.entryCommand,
  CancelMatch: s.cancelMatch,
  DecideTie: s.decideTie,
  ConfigureTournament: s.command.extend({
    tournamentConfiguration: s.tournamentConfiguration.optional(),
    scoringConfiguration: s.scoringConfiguration.optional(),
  }),
};
type CommandInput<K extends CommandName> = z.output<(typeof commandSchemas)[K]>;
// Command paths shared by the REST routes and the standalone adapter, relative to their resource.
export const tournamentCommandPaths = {
  players: 'RegisterPlayer',
  'registration/open': 'OpenRegistration',
  ready: 'ReadyTournament',
  configure: 'ConfigureTournament',
  start: 'StartTournament',
  pause: 'PauseTournament',
  resume: 'ResumeTournament',
  cancel: 'CancelTournament',
  complete: 'CompleteTournament',
  'qualification/finalize': 'FinalizeQualification',
  'qualification/close-early': 'CloseQualificationEarly',
  'finals/generate': 'GenerateFinal',
  tiebreaks: 'CreateTieBreak',
  'stages/reopen': 'ReopenStage',
  'matches/reorder': 'ReorderMatches',
  'elimination/advance': 'AdvanceKnockout',
  'entries/withdraw': 'WithdrawEntry',
  'entries/remove': 'UnregisterPlayer',
  'tiebreaks/decide': 'DecideTie',
} as const satisfies Record<string, CommandName>;
export const matchCommandPaths = {
  start: 'StartMatch',
  pause: 'PauseMatch',
  resume: 'ResumeMatch',
  scores: 'RecordScore',
  'turns/complete': 'CompleteTurn',
  complete: 'CompleteMatch',
  result: 'RecordResult',
  cancel: 'CancelMatch',
} as const satisfies Record<string, CommandName>;
export const scoreCommandPaths = {
  correct: 'CorrectScore',
  void: 'VoidScore',
} as const satisfies Record<string, CommandName>;
export class Backend {
  constructor(
    public readonly store: Store,
    private readonly context: d.Context = {
      id: uuid,
      now: () => new Date().toISOString(),
      operator: 'organizer',
      role: 'organizer',
    },
  ) {}
  private authorize() {
    d.ensure(this.context.role === 'organizer', 'FORBIDDEN', 'Organizer permission required', 403);
  }
  private audit(
    type: string,
    before: unknown,
    after: unknown,
    ids: { tournamentId?: string; matchId?: string; scoreId?: string; reason?: string } = {},
  ) {
    this.store.appendAudit({
      id: this.context.id(),
      tournamentId: ids.tournamentId ?? null,
      matchId: ids.matchId ?? null,
      scoreId: ids.scoreId ?? null,
      type,
      before,
      after,
      reason: ids.reason ?? null,
      operator: this.context.operator,
      createdAt: this.context.now(),
    });
  }
  player(id: string) {
    const p = this.store.getPlayer(id);
    d.ensure(p, 'NOT_FOUND', 'Player not found', 404);
    return p;
  }
  event(id: string) {
    const e = this.store.getEvent(id);
    d.ensure(e, 'NOT_FOUND', 'Event not found', 404);
    return e;
  }
  tournament(id: string) {
    const t = this.store.getTournament(id);
    d.ensure(t, 'NOT_FOUND', 'Tournament not found', 404);
    return t;
  }
  forMatch(id: string) {
    const t = this.store.tournamentForMatch(id);
    d.ensure(t, 'NOT_FOUND', 'Match not found', 404);
    return t;
  }
  forScore(id: string) {
    const t = this.store.tournamentForScore(id);
    d.ensure(t, 'NOT_FOUND', 'Score not found', 404);
    return t;
  }
  createPlayer(input: unknown) {
    this.authorize();
    const data = s.createPlayer.parse(input);
    return this.store.transaction(() => {
      const now = this.context.now();
      const p: d.Player = {
        id: this.context.id(),
        ...data,
        nickname: data.nickname ?? null,
        avatar: data.avatar ?? null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      this.store.savePlayer(p);
      this.audit('PlayerCreated', null, p);
      return p;
    });
  }
  updatePlayer(id: string, input: unknown) {
    this.authorize();
    const data = s.updatePlayer.parse(input);
    return this.store.transaction(() => {
      const old = this.player(id);
      const p = { ...old, ...data, updatedAt: this.context.now() };
      this.store.savePlayer(p);
      this.audit('PlayerUpdated', old, p);
      return p;
    });
  }
  createEvent(input: unknown) {
    this.authorize();
    const data = s.createEvent.parse(input);
    return this.store.transaction(() => {
      const now = this.context.now();
      const e: d.PubEvent = {
        id: this.context.id(),
        ...data,
        description: data.description ?? null,
        scheduledAt: data.scheduledAt ?? null,
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      };
      this.store.saveEvent(e);
      this.audit('EventCreated', null, e);
      return e;
    });
  }
  updateEvent(id: string, input: unknown) {
    this.authorize();
    const data = s.updateEvent.parse(input);
    return this.store.transaction(() => {
      const old = this.event(id);
      const e = { ...old, ...data, updatedAt: this.context.now() };
      this.store.saveEvent(e);
      this.audit('EventUpdated', old, e);
      return e;
    });
  }
  createTournament(input: unknown) {
    this.authorize();
    const data = s.createTournament.parse(input);
    return this.store.transaction(() => {
      if (data.eventId) {
        const event = this.event(data.eventId);
        d.ensure(
          !['completed', 'cancelled'].includes(event.status),
          'EVENT_CLOSED',
          'Cannot add a tournament to a closed event',
        );
      }
      const t: d.Tournament = {
        ...data,
        eventId: data.eventId ?? null,
        id: this.context.id(),
        status: 'draft',
        currentPhase: null,
        version: 0,
        createdAt: this.context.now(),
        startedAt: null,
        completedAt: null,
        entries: [],
        stages: [],
        groups: [],
        matches: [],
        results: [],
      };
      d.validateDefinition(t);
      this.store.saveTournament(t);
      this.audit('TournamentCreated', null, t, { tournamentId: t.id });
      return t;
    });
  }
  execute<K extends CommandName>(
    name: K,
    tournamentId: string,
    raw: unknown,
    options: { matchId?: string; scoreId?: string; idempotencyKey?: string } = {},
  ): d.Tournament {
    this.authorize();
    const input = commandSchemas[name].parse(raw) as CommandInput<K>;
    d.ensure(
      options.idempotencyKey || name !== 'RecordScore',
      'IDEMPOTENCY_KEY_REQUIRED',
      'RecordScore requires an Idempotency-Key',
      400,
    );
    if (options.idempotencyKey)
      d.ensure(
        /^[A-Za-z0-9._:-]{8,128}$/.test(options.idempotencyKey),
        'INVALID_IDEMPOTENCY_KEY',
        'Use 8–128 letters, digits, dots, colons, underscores or hyphens',
        400,
      );
    const fingerprint = sha256Hex(
      JSON.stringify({
        name,
        tournamentId,
        matchId: options.matchId,
        scoreId: options.scoreId,
        input,
        operator: this.context.operator,
      }),
    );
    return this.store.transaction(() => {
      if (options.idempotencyKey) {
        const previous = this.store.getIdempotency(options.idempotencyKey);
        if (previous) {
          d.ensure(
            previous.fingerprint === fingerprint,
            'IDEMPOTENCY_CONFLICT',
            'Key was already used for a different command',
          );
          return previous.response as d.Tournament;
        }
      }
      const t = this.tournament(tournamentId);
      const before = structuredClone(t);
      d.ensure(
        t.version === input.expectedVersion,
        'VERSION_CONFLICT',
        'Tournament version has changed',
      );
      const m = options.matchId
        ? d.matchById(t, options.matchId)
        : options.scoreId
          ? t.matches.find((m) => m.scores.some((s) => s.id === options.scoreId))
          : undefined;
      if ('expectedMatchVersion' in input) {
        d.ensure(m, 'NOT_FOUND', 'Match not found', 404);
        d.ensure(
          m.version === input.expectedMatchVersion,
          'VERSION_CONFLICT',
          'Match version has changed',
        );
      }
      const c = this.context;
      switch (name) {
        case 'RegisterPlayer': {
          const i = input as CommandInput<'RegisterPlayer'>;
          d.register(t, this.player(i.playerId), i.seed ?? null, c);
          break;
        }
        case 'ConfigureTournament': {
          const i = input as CommandInput<'ConfigureTournament'>;
          d.ensure(
            ['draft', 'registration', 'ready'].includes(t.status),
            'RULES_LOCKED',
            'Rules are immutable after start',
          );
          if (i.scoringConfiguration) t.scoringConfiguration = i.scoringConfiguration;
          if (i.tournamentConfiguration) t.tournamentConfiguration = i.tournamentConfiguration;
          d.validateDefinition(t);
          if (t.status === 'ready') t.status = 'registration';
          break;
        }
        case 'ReadyTournament':
          d.readyTournament(t);
          break;
        case 'OpenRegistration':
          d.transitionTournament(t.status, 'registration');
          t.status = 'registration';
          break;
        case 'StartTournament':
          for (const e of t.entries)
            d.ensure(
              this.player(e.playerId).status === 'active',
              'INACTIVE_PLAYER',
              'Registered player was deactivated',
            );
          d.startTournament(t, c);
          break;
        case 'PauseTournament':
          d.pauseTournament(t);
          break;
        case 'ResumeTournament':
          d.resumeTournament(t);
          break;
        case 'CancelTournament':
          d.cancelTournament(t);
          break;
        case 'StartMatch':
          d.startMatch(t, m!, c);
          break;
        case 'PauseMatch':
          d.activeTournament(t);
          d.transitionMatch(m!.status, 'paused');
          m!.status = 'paused';
          m!.version++;
          break;
        case 'ResumeMatch':
          d.ensure(m!.status === 'paused', 'INVALID_STATE', 'Match must be paused');
          d.startMatch(t, m!, c);
          break;
        case 'RecordScore':
          d.recordScore(t, m!, input as CommandInput<'RecordScore'>, c);
          break;
        case 'CompleteTurn':
          d.completeTurn(t, m!, (input as CommandInput<'CompleteTurn'>).turnId, c);
          break;
        case 'CompleteMatch':
          d.completeMatch(t, m!, c);
          break;
        case 'CorrectScore':
          d.correctScore(t, options.scoreId!, (input as CommandInput<'CorrectScore'>).score, c);
          break;
        case 'VoidScore':
          d.correctScore(t, options.scoreId!, null, c);
          break;
        case 'FinalizeQualification':
          d.finalizeQualification(t, c);
          break;
        case 'GenerateFinal':
          d.generateFinal(t, c);
          break;
        case 'CreateTieBreak': {
          const i = input as CommandInput<'CreateTieBreak'>;
          d.createTieBreak(t, i.targetId, i.entryIds, c);
          break;
        }
        case 'CompleteTournament':
          d.completeTournament(t, c);
          break;
        case 'ReopenStage':
          d.reopenStage(t, (input as CommandInput<'ReopenStage'>).stageId, c);
          break;
        case 'CloseQualificationEarly':
          d.closeQualificationEarly(
            t,
            (input as CommandInput<'CloseQualificationEarly'>).excludedEntryIds,
            c,
          );
          break;
        case 'ReorderMatches':
          d.reorder(t, (input as CommandInput<'ReorderMatches'>).matchIds);
          break;
        case 'RecordResult': {
          const {
            expectedVersion: _v,
            expectedMatchVersion: _m,
            ...result
          } = input as CommandInput<'RecordResult'>;
          d.recordResult(t, m!, result, c);
          break;
        }
        case 'WithdrawEntry':
          d.withdrawEntry(t, (input as CommandInput<'WithdrawEntry'>).entryId, c);
          break;
        case 'UnregisterPlayer':
          d.unregisterEntry(t, (input as CommandInput<'UnregisterPlayer'>).entryId);
          break;
        case 'CancelMatch':
          d.cancelMatch(t, m!);
          break;
        case 'DecideTie': {
          const i = input as CommandInput<'DecideTie'>;
          d.decideTie(t, i.targetId, i.orderedEntryIds, i.reason, c);
          break;
        }
        case 'AdvanceKnockout': {
          d.activeTournament(t);
          const stage = d.currentStage(t);
          d.ensure(
            t.mode === 'GROUPS' &&
              stage.status === 'open' &&
              !['group', 'final'].includes(stage.kind),
            'INVALID_STAGE',
            'An open elimination stage is required',
          );
          d.advanceKnockout(t, c);
          d.ensure(
            d.currentStage(t).id !== stage.id,
            'INCOMPLETE_STAGE',
            'Complete every elimination match and resolve its winner',
          );
          break;
        }
      }
      t.version++;
      this.store.saveTournament(t, before.version);
      const oldScore = options.scoreId
        ? before.matches.flatMap((m) => m.scores).find((s) => s.id === options.scoreId)
        : null;
      const newScore = options.scoreId
        ? t.matches.flatMap((m) => m.scores).find((s) => s.id === options.scoreId)
        : name === 'RecordScore'
          ? m!.scores.at(-1)
          : null;
      this.audit(
        name,
        name === 'RecordScore' ? null : (oldScore ?? auditSnapshot(before)),
        newScore ?? auditSnapshot(t),
        {
          tournamentId: t.id,
          matchId: m?.id,
          scoreId: newScore?.id,
          reason: 'reason' in input ? (input.reason as string) : undefined,
        },
      );
      const emit = (type: string, payload: Record<string, unknown> = {}) =>
        this.store.appendEvent({
          id: c.id(),
          tournamentId: t.id,
          type,
          payload: { version: t.version, ...payload },
          createdAt: c.now(),
        });
      const eventNames: Partial<Record<CommandName, string>> = {
        StartTournament: 'TournamentStarted',
        RecordScore: 'ScoreRecorded',
        CompleteTurn: 'TurnCompleted',
        FinalizeQualification: 'QualificationCompleted',
        CompleteTournament: 'TournamentCompleted',
        CorrectScore: 'ScoreCorrected',
        VoidScore: 'ScoreVoided',
        ReopenStage: 'StageReopened',
        PauseTournament: 'TournamentPaused',
        ResumeTournament: 'TournamentResumed',
        RecordResult: 'ResultRecorded',
        WithdrawEntry: 'EntryWithdrawn',
        DecideTie: 'TieDecided',
      };
      emit(eventNames[name] ?? name, { matchId: m?.id ?? null });
      for (const match of t.matches) {
        const old = before.matches.find((m) => m.id === match.id);
        if (match.status === 'completed' && old?.status !== 'completed')
          emit('MatchCompleted', { matchId: match.id, bye: match.participants.length === 1 });
        if (match.matchType === 'final' && match.status === 'active' && old?.status !== 'active')
          emit('FinalStarted', { matchId: match.id });
      }
      if (
        [
          'RecordScore',
          'CompleteTurn',
          'CorrectScore',
          'VoidScore',
          'ReopenStage',
          'CloseQualificationEarly',
          'RecordResult',
          'WithdrawEntry',
          'CancelMatch',
          'DecideTie',
        ].includes(name)
      )
        emit('StandingsUpdated');
      if (options.idempotencyKey)
        this.store.saveIdempotency(options.idempotencyKey, fingerprint, t);
      return t;
    });
  }
  liveMatch(id: string) {
    const t = this.forMatch(id);
    const m = d.matchById(t, id);
    return {
      ...m,
      tournamentVersion: t.version,
      gameMode: t.gameMode,
      recording: t.recording,
      excludedEntryIds: d.stageById(t, m.stageId).excludedEntryIds,
      turnState: d.turnState(m),
      scoreboard: m.participants.map((p) => ({
        tournamentEntryId: p.tournamentEntryId,
        ...d.playerPerformance(m, p.tournamentEntryId),
        total: d.participantScore(t, m, p.tournamentEntryId) ?? 0,
      })),
    };
  }
  standings(id: string) {
    const t = this.tournament(id);
    return t.stages.flatMap<z.output<typeof s.standingsResponse>[number]>((stage) => {
      if (stage.kind === 'group')
        return t.groups
          .filter((g) => g.stageId === stage.id)
          .map((g) => ({
            stageId: stage.id,
            stageKind: stage.kind,
            stageStatus: stage.status,
            targetId: g.id,
            groupName: g.name,
            rows: d.groupStandings(t, g.id),
          }));
      return t.matches
        .filter((m) => m.stageId === stage.id && m.matchType !== 'tiebreak')
        .map((m) => ({
          stageId: stage.id,
          stageKind: stage.kind,
          stageStatus: stage.status,
          targetId: m.id,
          groupName: null,
          rows: d.highScoreStandings(t, m),
        }));
    });
  }
  history(id: string, options: ListOptions) {
    this.player(id);
    const all = this.store.tournamentsForPlayer(id);
    const filtered = all.filter(
      (t) =>
        (!options.status || t.status === options.status) &&
        (!options.search || t.name.toLowerCase().includes(options.search.toLowerCase())),
    );
    return {
      items: filtered.slice(options.offset, options.offset + options.limit),
      total: filtered.length,
      limit: options.limit,
      offset: options.offset,
    };
  }
  /**
   * Player statistics computed from the stored results (never stored themselves): a corrected
   * result changes them at the next read. Games are kept apart; Hi-Score totals only compare
   * with the same rounds and darts.
   */
  statistics(id: string): z.output<typeof s.statisticsResponse> {
    this.player(id);
    const tournaments = this.store
      .tournamentsForPlayer(id)
      .filter((t) => t.startedAt !== null && t.status !== 'cancelled');
    type Row = z.output<typeof s.statisticsResponse>['byGameMode'][number] & { totals: number[] };
    const rows = new Map<string, Row>();
    const tally = { matchesPlayed: 0, wins: 0, draws: 0, losses: 0 };
    const recent: z.output<typeof s.statisticsResponse>['recentMatches'] = [];
    const placements: z.output<typeof s.statisticsResponse>['placements'] = [];
    let tournamentsWon = 0,
      finalsReached = 0,
      bestPlacement: number | null = null;
    const rowFor = (t: d.Tournament, config: d.HighScoreConfiguration | null) => {
      const hs = t.gameMode === 'HI_SCORE' && config;
      const key = hs
        ? `${t.gameMode}:${config.turns}:${config.dartsPerTurn}:${config.maxDartScore}`
        : t.gameMode;
      let row = rows.get(key);
      if (!row) {
        row = {
          gameMode: t.gameMode,
          rounds: hs ? config.turns : null,
          dartsPerTurn: hs ? config.dartsPerTurn : null,
          tournamentsPlayed: 0,
          tournamentsWon: 0,
          matchesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          winRate: null,
          scoredMatches: 0,
          bestScore: null,
          averageScore: null,
          totals: [],
        };
        rows.set(key, row);
      }
      return row;
    };
    for (const t of tournaments) {
      const entry = t.entries.find((e) => e.playerId === id)!;
      const result = t.results.find((r) => r.tournamentEntryId === entry.id);
      const own = rowFor(t, t.scoringConfiguration);
      own.tournamentsPlayed++;
      if (result) {
        if (result.finalPlacement === 1) {
          tournamentsWon++;
          own.tournamentsWon++;
        }
        bestPlacement = Math.min(bestPlacement ?? Infinity, result.finalPlacement);
        placements.push({
          tournamentId: t.id,
          name: t.name,
          gameMode: t.gameMode,
          format: t.mode,
          placement: result.finalPlacement,
          players: t.entries.length,
          completedAt: t.completedAt,
        });
      }
      const validMatches = t.matches.filter(
        (m) =>
          m.status !== 'cancelled' &&
          d.stageById(t, m.stageId).status !== 'invalidated' &&
          m.participants.some((p) => p.tournamentEntryId === entry.id),
      );
      if (validMatches.some((m) => m.matchType === 'final')) finalsReached++;
      for (const m of validMatches.filter(
        (m) =>
          m.status === 'completed' &&
          m.matchType !== 'tiebreak' &&
          m.participants.length > 1 &&
          !m.result?.walkover &&
          !d.stageById(t, m.stageId).excludedEntryIds.includes(entry.id) &&
          m.turns
            .filter((turn) => turn.participantId === entry.id)
            .every((turn) => turn.status === 'completed'),
      )) {
        const participant = m.participants.find((p) => p.tournamentEntryId === entry.id)!;
        const row = rowFor(t, m.scoringConfiguration);
        const score = d.participantScore(t, m, entry.id);
        for (const target of [row, tally]) {
          target.matchesPlayed++;
          if (participant.outcome === 'win') target.wins++;
          else if (participant.outcome === 'loss') target.losses++;
          else if (participant.outcome === 'draw') target.draws++;
        }
        if (t.gameMode === 'HI_SCORE' && score !== null) row.totals.push(score);
        recent.push({
          matchId: m.id,
          tournamentId: t.id,
          tournamentName: t.name,
          gameMode: t.gameMode,
          matchType: m.matchType,
          completedAt: m.completedAt,
          outcome: participant.outcome,
          score,
          opponents: m.participants
            .filter((p) => p.tournamentEntryId !== entry.id)
            .map(
              (p) =>
                t.entries.find((e) => e.id === p.tournamentEntryId)?.displayNameAtRegistration ??
                '?',
            ),
        });
      }
    }
    const rate = (x: { wins: number; matchesPlayed: number }) =>
      x.matchesPlayed ? x.wins / x.matchesPlayed : null;
    return {
      playerId: id,
      tournamentsPlayed: tournaments.length,
      tournamentsWon,
      finalsReached,
      bestPlacement,
      ...tally,
      winRate: rate(tally),
      byGameMode: [...rows.values()]
        .filter((r) => r.tournamentsPlayed > 0 || r.matchesPlayed > 0)
        .map(({ totals, ...r }) => ({
          ...r,
          winRate: rate(r),
          scoredMatches: totals.length,
          bestScore: totals.length ? Math.max(...totals) : null,
          averageScore: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
        })),
      placements: placements.sort((a, b) =>
        (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
      ),
      recentMatches: recent
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 20),
    };
  }
}
function auditSnapshot(t: d.Tournament) {
  return {
    version: t.version,
    status: t.status,
    currentPhase: t.currentPhase,
    scoringConfiguration: t.scoringConfiguration,
    tournamentConfiguration: t.tournamentConfiguration,
    entries: t.entries.map((e) => ({
      id: e.id,
      playerId: e.playerId,
      status: e.status,
      seed: e.seed,
    })),
    stages: t.stages,
    groups: t.groups,
    results: t.results,
    matches: t.matches.map((m) => ({
      id: m.id,
      stageId: m.stageId,
      status: m.status,
      version: m.version,
      sequence: m.sequence,
      winnerEntryId: m.winnerEntryId,
      participants: m.participants,
      tieTarget: m.tieTarget,
      result: m.result,
    })),
  };
}
