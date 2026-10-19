import {
  DomainError,
  ensure,
  type Context,
  type Match,
  type MatchResult,
  type Stage,
  type Tournament,
} from '../model.js';
import { evaluateResult, games } from '../games/catalog.js';
import { heatForEntry, multiHeat, syncHeats } from '../competition/heats.js';
import { roundProgress } from '../scoring/rounds.js';
import { matchStandings } from '../standings/index.js';
import {
  activeTournament,
  advanceKnockout,
  assertTieGroup,
  completeTournament,
  currentStage,
  newMatch,
  reopenStage,
  stageById,
  updateOutcome,
} from './engine.js';

export interface RecordResultInput {
  /** Final scores to set (null clears one); players not listed keep what was recorded. */
  scores?: Record<string, number | null>;
  /** undefined keeps the declared winner, null removes it. */
  winnerEntryId?: string | null;
  targetScore?: number | null;
  special?: 'SHANGHAI' | null;
  notes?: string | null;
  /** Required when the change invalidates confirmed phases or playoffs (see resultDependencies). */
  confirmInvalidation?: boolean;
  /**
   * Why an official score differs from the complete progressive total of the same entry. The
   * official value is kept, the rounds are never adjusted to match.
   */
  reconciliation?: Record<string, string>;
}

export interface ResultDependencies {
  /** The match's phase is confirmed and must be reopened. */
  reopens: Stage | null;
  /** Later phases that become invalid, with their matches. */
  stages: Stage[];
  matches: Match[];
  /** Playoffs and decisions that no longer apply. */
  playoffs: Match[];
  /** The official result of the tournament is withdrawn until confirmed again. */
  tournamentCompleted: boolean;
  required: boolean;
}

/**
 * What changing the result of `m` would invalidate. Nothing is overwritten silently: when
 * `required`, RecordResult needs `confirmInvalidation`.
 */
export function resultDependencies(t: Tournament, m: Match): ResultDependencies {
  const stage = stageById(t, m.stageId);
  const reopens = stage.status === 'finalized' ? stage : null;
  const stages = t.stages.filter((s) => s.ordering > stage.ordering && s.status !== 'invalidated');
  const later = new Set(stages.map((s) => s.id));
  const targets = new Set([m.id, m.groupId, m.matchType === 'tiebreak' ? m.tieTarget : null]);
  const playoffs = t.matches.filter(
    (x) =>
      x.matchType === 'tiebreak' &&
      x.id !== m.id &&
      x.status !== 'cancelled' &&
      x.stageId === stage.id &&
      // Reopening a phase cancels all of its playoffs; otherwise only those on the same ranking.
      (reopens !== null ||
        (targets.has(x.tieTarget) && (m.matchType !== 'tiebreak' || x.sequence > m.sequence))),
  );
  const matches = t.matches.filter((x) => later.has(x.stageId) && x.status !== 'cancelled');
  const affects = m.status === 'completed' || m.result !== null;
  return {
    reopens,
    stages,
    matches,
    playoffs,
    tournamentCompleted: t.status === 'completed',
    required: affects && (reopens !== null || playoffs.length > 0),
  };
}

function cancel(m: Match) {
  if (m.status === 'cancelled') return;
  m.status = 'cancelled';
  m.version++;
}
/** Entries whose result counts in this match: withdrawn players of the phase are left out. */
function countedEntries(t: Tournament, m: Match) {
  const excluded = stageById(t, m.stageId).excludedEntryIds;
  return m.participants.map((p) => p.tournamentEntryId).filter((id) => !excluded.includes(id));
}
function blankResult(c: Context): MatchResult {
  const now = c.now();
  return {
    scores: {},
    declaredWinnerEntryId: null,
    targetScore: null,
    special: null,
    walkover: false,
    decision: null,
    notes: null,
    reconciliation: [],
    recordedAt: now,
    updatedAt: now,
    recordedBy: c.operator,
  };
}
function complete(t: Tournament, m: Match, winner: string | null, c: Context) {
  m.status = 'completed';
  m.startedAt ??= c.now();
  m.completedAt = c.now();
  m.winnerEntryId = winner;
  updateOutcome(t, m);
  if (m.matchType === 'tiebreak') {
    const target = t.matches.find((x) => x.id === m.tieTarget);
    if (target && target.status === 'completed') {
      updateOutcome(t, target);
      target.version++;
    }
  }
}
/** A single match ends with its decisive result: there is nothing else to confirm. */
function autoComplete(t: Tournament, c: Context) {
  if (t.mode !== 'SINGLE_MATCH' || t.status !== 'active') return;
  const stage = currentStage(t);
  const matches = t.matches.filter((m) => m.stageId === stage.id && m.status !== 'cancelled');
  const final = matches.find((m) => m.matchType === 'final');
  if (
    stage.status !== 'open' ||
    !final ||
    !matches.every((m) => m.status === 'completed') ||
    matchStandings(t, final)[0]?.tied !== false
  )
    return;
  completeTournament(t, c);
}

/**
 * Records (or corrects) the final result of a match as shown by the totem. Values are merged
 * into what was recorded; the match completes once the game's result is complete. Hi-Score
 * accepts one player at a time, other games need their winner in the same command.
 */
export function recordResult(t: Tournament, m: Match, input: RecordResultInput, c: Context) {
  ensure(
    t.recording === 'result',
    'RECORDING_MISMATCH',
    'This tournament records scores turn by turn',
  );
  // A completed tournament can only be corrected (with confirmation); a paused one waits.
  ensure(
    t.status === 'active' || t.status === 'completed',
    'TOURNAMENT_NOT_ACTIVE',
    'Tournament must be active',
  );
  ensure(m.status !== 'cancelled', 'MATCH_CANCELLED', 'The match was cancelled');
  // A knockout bye has no result; a single match may be a one-player Hi-Score practice.
  ensure(
    m.participants.length > 1 || t.mode === 'SINGLE_MATCH',
    'INVALID_MATCH',
    'A bye has no result',
  );
  ensure(!m.result?.decision, 'DECISION_LOCKED', 'An organizer decision has no scores');
  ensure(!m.result?.walkover, 'WALKOVER_LOCKED', 'A walkover follows a withdrawal');
  const stage = stageById(t, m.stageId);
  ensure(stage.status !== 'invalidated', 'STAGE_CLOSED', 'This phase was invalidated');
  const dependencies = resultDependencies(t, m);
  if (dependencies.required) {
    if (!input.confirmInvalidation)
      throw new DomainError(
        'RESULT_HAS_DEPENDENTS',
        'Changing this result invalidates later phases or playoffs: confirm to proceed',
        409,
        {
          reopensStage: dependencies.reopens?.kind ?? null,
          stages: dependencies.stages.map((s) => s.kind),
          matches: dependencies.matches.length,
          playoffs: dependencies.playoffs.length,
          tournamentCompleted: dependencies.tournamentCompleted,
        },
      );
    if (dependencies.reopens) reopenStage(t, dependencies.reopens.id, c);
    for (const x of dependencies.playoffs) cancel(x);
  }
  activeTournament(t);
  ensure(stage.status === 'open', 'STAGE_CLOSED', 'Stage must be open');
  const entries = countedEntries(t, m);
  for (const id of Object.keys(input.scores ?? {}))
    ensure(
      entries.includes(id),
      'INVALID_RESULT',
      'Withdrawn players and players outside the match have no score',
      422,
    );
  const previous = m.result ?? blankResult(c);
  const scores = { ...previous.scores, ...input.scores };
  for (const [id, value] of Object.entries(scores)) if (value === null) delete scores[id];
  const reconciliation = reconcile(t, m, input, previous, c);
  const next: MatchResult = {
    ...previous,
    scores,
    declaredWinnerEntryId:
      input.winnerEntryId === undefined ? previous.declaredWinnerEntryId : input.winnerEntryId,
    targetScore: input.targetScore === undefined ? previous.targetScore : input.targetScore,
    special: input.special === undefined ? previous.special : input.special,
    notes: input.notes === undefined ? previous.notes : input.notes?.trim() || null,
    reconciliation,
    updatedAt: c.now(),
    recordedBy: c.operator,
  };
  const scoresOnly = multiHeat(m);
  const outcome = evaluateResult(t.gameMode, entries, next, m.scoringConfiguration, {
    scoresOnly,
  });
  ensure(
    outcome.complete || games[t.gameMode].scoreRequired || scoresOnly,
    'WINNER_REQUIRED',
    'Select the winner shown by the totem',
    422,
  );
  // Values go to the heat at the board (or a played one, as a correction).
  if (m.status !== 'completed')
    for (const [id, value] of Object.entries(input.scores ?? {}))
      if (value !== null) heatForEntry(t, m, id, c);
  m.result = next;
  m.version++;
  if (outcome.complete) {
    complete(t, m, outcome.winnerEntryId, c);
    syncHeats(t, m, c);
    advanceKnockout(t, c);
    autoComplete(t, c);
    return m;
  }
  // Hi-Score in progress: scores so far are kept, the match waits for the others.
  m.status = 'active';
  m.startedAt ??= c.now();
  m.completedAt = null;
  m.winnerEntryId = null;
  for (const p of m.participants) {
    p.finalScore = scores[p.tournamentEntryId] ?? null;
    p.placement = null;
    p.outcome = 'pending';
  }
  syncHeats(t, m, c);
  return m;
}

/**
 * Official values against the progressive rounds of the same entries. The official result
 * prevails; when it differs from a complete progression the organizer gives the reason, and
 * both values are kept. ROUND_BY_ROUND asks for every round (recorded or explicitly skipped)
 * before the final value of games with fixed rounds.
 */
function reconcile(
  t: Tournament,
  m: Match,
  input: RecordResultInput,
  previous: MatchResult,
  c: Context,
) {
  let records = [...(previous.reconciliation ?? [])];
  if (t.tracking === 'FINAL_ONLY') return records;
  const differences: { entryId: string; computed: number; official: number }[] = [];
  for (const [entryId, official] of Object.entries(input.scores ?? {})) {
    records = records.filter((r) => r.entryId !== entryId);
    if (official === null) continue;
    const progress = roundProgress(t, m, entryId);
    if (t.tracking === 'ROUND_BY_ROUND')
      ensure(
        progress.missing.length === 0 || progress.rounds.length === 0,
        'ROUNDS_MISSING',
        'Record or skip every round before the final result',
        422,
      );
    if (progress.computed === null || progress.computed === official) continue;
    const reason = input.reconciliation?.[entryId]?.trim();
    if (!reason) {
      differences.push({ entryId, computed: progress.computed, official });
      continue;
    }
    records.push({
      entryId,
      computed: progress.computed,
      official,
      reason,
      recordedAt: c.now(),
      recordedBy: c.operator,
    });
  }
  if (differences.length)
    throw new DomainError(
      'RESULT_DIFFERS_FROM_ROUNDS',
      'The official result differs from the recorded rounds: review them or give a reason',
      409,
      { differences },
    );
  return records;
}

/**
 * A player leaves during the tournament. Their unplayed two-player matches are awarded to the
 * opponent (walkover); in a qualification or multi-player final they are excluded and the
 * others' results decide. Played results stay; a withdrawn player never qualifies.
 */
export function withdrawEntry(t: Tournament, entryId: string, c: Context) {
  activeTournament(t);
  ensure(
    t.recording === 'result',
    'RECORDING_MISMATCH',
    'Turn-by-turn tournaments use early closure',
  );
  const entry = t.entries.find((e) => e.id === entryId);
  ensure(entry, 'NOT_FOUND', 'Entry not found', 404);
  ensure(
    entry.status === 'registered' || entry.status === 'qualified',
    'INVALID_STATE',
    'The player is no longer in the tournament',
  );
  const remaining = t.entries.filter(
    (e) => e.id !== entryId && (e.status === 'registered' || e.status === 'qualified'),
  );
  ensure(remaining.length >= 1, 'INSUFFICIENT_PLAYERS', 'Nobody would be left to play');
  const stage = currentStage(t);
  ensure(stage.status === 'open', 'STAGE_CLOSED', 'Confirm or reopen the current phase first');
  entry.status = 'withdrawn';
  for (const m of t.matches.filter(
    (m) =>
      m.stageId === stage.id &&
      !['completed', 'cancelled'].includes(m.status) &&
      m.participants.some((p) => p.tournamentEntryId === entryId),
  )) {
    if (m.matchType === 'tiebreak') {
      // The tied group changed: the organizer creates the playoff again if still needed.
      cancel(m);
      continue;
    }
    if (m.participants.length === 2) {
      const opponent = m.participants.find((p) => p.tournamentEntryId !== entryId)!;
      const other = t.entries.find((e) => e.id === opponent.tournamentEntryId)!;
      if (other.status === 'withdrawn') {
        cancel(m);
        continue;
      }
      m.result = {
        ...blankResult(c),
        declaredWinnerEntryId: other.id,
        walkover: true,
        notes: 'Ritiro dell’avversario',
      };
      m.version++;
      complete(t, m, other.id, c);
      continue;
    }
    if (!stage.excludedEntryIds.includes(entryId)) stage.excludedEntryIds.push(entryId);
    const entries = countedEntries(t, m);
    const scores = Object.fromEntries(
      Object.entries(m.result?.scores ?? {}).filter(([id]) => entries.includes(id)),
    );
    if (m.result) m.result = { ...m.result, scores, updatedAt: c.now() };
    const outcome = evaluateResult(
      t.gameMode,
      entries,
      {
        scores,
        declaredWinnerEntryId: null,
        targetScore: m.result?.targetScore ?? null,
        special: null,
      },
      m.scoringConfiguration,
      { scoresOnly: multiHeat(m) },
    );
    m.version++;
    if (entries.length === 1) {
      m.result = {
        ...(m.result ?? blankResult(c)),
        declaredWinnerEntryId: entries[0]!,
        walkover: true,
      };
      complete(t, m, entries[0]!, c);
    } else if (outcome.complete && (games[t.gameMode].scoreRequired || multiHeat(m)))
      complete(t, m, outcome.winnerEntryId, c);
  }
  for (const m of t.matches.filter((m) => m.stageId === stage.id && m.heats.length))
    syncHeats(t, m, c);
  advanceKnockout(t, c);
  autoComplete(t, c);
}

/** A group match (or pending playoff) that will not be played; it leaves the standings. */
export function cancelMatch(t: Tournament, m: Match) {
  activeTournament(t);
  ensure(
    m.matchType === 'group' || m.matchType === 'tiebreak',
    'INVALID_MATCH',
    'Only group matches and playoffs can be cancelled: knockout matches need a winner',
  );
  ensure(
    !['completed', 'cancelled'].includes(m.status),
    'INVALID_STATE',
    'Correct a played match instead of cancelling it',
  );
  ensure(stageById(t, m.stageId).status === 'open', 'STAGE_CLOSED', 'Stage must be open');
  cancel(m);
}

/**
 * Resolves a tie by an explicit organizer decision instead of a playoff on the board: a
 * completed playoff whose result is the given order. Nothing is drawn at random.
 */
export function decideTie(
  t: Tournament,
  targetId: string,
  order: string[],
  reason: string,
  c: Context,
) {
  const { stage, targetMatch, group } = assertTieGroup(t, targetId, order);
  const m = newMatch(t, stage, order, 'tiebreak', c, {
    config: targetMatch?.scoringConfiguration ?? t.scoringConfiguration,
    tieTarget: targetId,
    ...(group ? { groupId: group.id } : {}),
  });
  m.turns = [];
  m.result = { ...blankResult(c), decision: { order: [...order], reason } };
  complete(t, m, order[0]!, c);
  advanceKnockout(t, c);
  autoComplete(t, c);
  return m;
}

/** Removes a registration before the start (a typo, a player who left early). */
export function unregisterEntry(t: Tournament, entryId: string) {
  ensure(
    ['draft', 'registration', 'ready'].includes(t.status),
    'REGISTRATION_CLOSED',
    'After the start a player can only withdraw',
  );
  const index = t.entries.findIndex((e) => e.id === entryId);
  ensure(index >= 0, 'NOT_FOUND', 'Entry not found', 404);
  t.entries.splice(index, 1);
  const assignments = t.tournamentConfiguration.groupAssignments;
  if (assignments)
    t.tournamentConfiguration.groupAssignments = assignments.map((g) =>
      g.filter((id) => id !== entryId),
    );
  if (t.status === 'ready') t.status = 'registration';
}
