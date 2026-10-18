import { randomUUID, createHash } from 'node:crypto';
import * as d from '../../../domain/src/index.js';
import * as s from '../../../contracts/src/index.js';
import type { Store, ListOptions } from '../ports.js';
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
  ConfigureTournament: s.command.extend({
    tournamentConfiguration: s.tournamentConfiguration.optional(),
    scoringConfiguration: s.scoringConfiguration.optional(),
  }),
};
type CommandInput<K extends CommandName> = z.output<(typeof commandSchemas)[K]>;
export class Backend {
  constructor(
    public readonly store: Store,
    private readonly context: d.Context = {
      id: randomUUID,
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
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          name,
          tournamentId,
          matchId: options.matchId,
          scoreId: options.scoreId,
          input,
          operator: this.context.operator,
        }),
      )
      .digest('hex');
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
        ].includes(name)
      )
        emit('StandingsUpdated');
      if (options.idempotencyKey)
        this.store.saveIdempotency(options.idempotencyKey, fingerprint, t);
      return t;
    });
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
  statistics(id: string) {
    this.player(id);
    const tournaments = this.store
      .tournamentsForPlayer(id)
      .filter((t) => t.startedAt !== null && t.status !== 'cancelled');
    const configurations = new Map<
      string,
      {
        configuration: d.HighScoreConfiguration;
        matchesPlayed: number;
        wins: number;
        losses: number;
        draws: number;
        total: number;
        turns: number;
        averagePerTurn: number;
        bestTurn: number;
      }
    >();
    let tournamentsWon = 0,
      finalsReached = 0,
      bestPlacement: number | null = null;
    for (const t of tournaments) {
      const entry = t.entries.find((e) => e.playerId === id)!;
      const result = t.results.find((r) => r.tournamentEntryId === entry.id);
      if (result) {
        if (result.finalPlacement === 1) tournamentsWon++;
        bestPlacement = Math.min(bestPlacement ?? Infinity, result.finalPlacement);
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
          m.turns
            .filter((turn) => turn.participantId === entry.id)
            .every((turn) => turn.status === 'completed'),
      )) {
        const key = JSON.stringify(m.scoringConfiguration);
        const stats = configurations.get(key) ?? {
          configuration: m.scoringConfiguration,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          total: 0,
          turns: 0,
          averagePerTurn: 0,
          bestTurn: 0,
        };
        const performance = d.playerPerformance(m, entry.id);
        const participant = m.participants.find((p) => p.tournamentEntryId === entry.id)!;
        stats.matchesPlayed++;
        stats.total += performance.total;
        stats.turns += performance.turns;
        stats.bestTurn = Math.max(stats.bestTurn, performance.bestTurn);
        stats.averagePerTurn = stats.turns ? stats.total / stats.turns : 0;
        if (participant.outcome === 'win') stats.wins++;
        else if (participant.outcome === 'loss') stats.losses++;
        else if (participant.outcome === 'draw') stats.draws++;
        configurations.set(key, stats);
      }
    }
    return {
      playerId: id,
      tournamentsPlayed: tournaments.length,
      tournamentsWon,
      finalsReached,
      bestPlacement,
      byScoringConfiguration: [...configurations.values()],
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
    })),
  };
}
