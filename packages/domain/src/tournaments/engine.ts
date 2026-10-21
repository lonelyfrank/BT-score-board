import {
  ensure,
  type Context,
  type HighScoreConfiguration,
  type Match,
  type Stage,
  type Tournament,
  type Player,
} from '../model.js';
import { currentTurn } from '../matches/turn-manager.js';
import {
  effectiveScores,
  playerPerformance,
  turnIsComplete,
  validateScore,
} from '../scoring/high-score.js';
import {
  groupStandings,
  matchStandings,
  participantScore,
  selectQualifiers,
} from '../standings/index.js';
import { comparableAcrossHeats, games } from '../games/catalog.js';
import { heatCapacity, initialHeats, MAX_HEAT_CAPACITY, startHeat } from '../competition/heats.js';
import { entryForPlayer } from '../competition/entries.js';
import { MAX_ENTRIES } from '../competition/teams.js';
import { distributeGroups, roundRobin, seededBracket } from './schedule.js';
import { transitionMatch, transitionTournament } from '../rules/state-machines.js';

export function activeTournament(t: Tournament) {
  ensure(t.status === 'active', 'TOURNAMENT_NOT_ACTIVE', 'Tournament must be active');
}
export function matchById(t: Tournament, id: string) {
  const m = t.matches.find((m) => m.id === id);
  ensure(m, 'NOT_FOUND', 'Match not found', 404);
  return m;
}
export function stageById(t: Tournament, id: string) {
  const s = t.stages.find((s) => s.id === id);
  ensure(s, 'NOT_FOUND', 'Stage not found', 404);
  return s;
}
export function currentStage(t: Tournament) {
  const s = t.stages.filter((s) => s.status !== 'invalidated').at(-1);
  ensure(s, 'NO_STAGE', 'Tournament has not started');
  return s;
}
function newStage(t: Tournament, kind: string, c: Context): Stage {
  const s: Stage = {
    id: c.id(),
    tournamentId: t.id,
    kind,
    ordering: t.stages.length + 1,
    status: 'open',
    qualifiedEntryIds: [],
    excludedEntryIds: [],
    createdAt: c.now(),
    finalizedAt: null,
  };
  t.stages.push(s);
  t.currentPhase = kind;
  return s;
}
export function newMatch(
  t: Tournament,
  stage: Stage,
  ids: string[],
  type: Match['matchType'],
  c: Context,
  options: {
    groupId?: string;
    scheduleRound?: number;
    config?: HighScoreConfiguration;
    tieTarget?: string;
  } = {},
): Match {
  const config = options.config ?? t.scoringConfiguration,
    id = c.id();
  const m: Match = {
    id,
    tournamentId: t.id,
    stageId: stage.id,
    groupId: options.groupId ?? null,
    matchType: type,
    status: 'ready',
    sequence: Math.max(0, ...t.matches.map((m) => m.sequence)) + 1,
    scheduleRound: options.scheduleRound ?? 1,
    startedAt: null,
    completedAt: null,
    version: 0,
    scoringConfiguration: { ...config },
    participants: ids.map((entryId, index) => ({
      matchId: id,
      tournamentEntryId: entryId,
      playingOrder: index + 1,
      finalScore: null,
      placement: null,
      outcome: 'pending',
    })),
    turns: [],
    scores: [],
    tieTarget: options.tieTarget ?? null,
    winnerEntryId: null,
    result: null,
    heats: [],
    rounds: [],
    rotations: [],
    guide: null,
  };
  // More entries than seats on the totem: the match is played over several heats.
  initialHeats(t, m, c);
  // Final results need no turns: the totem keeps them.
  if (t.recording === 'turns')
    for (let round = 1; round <= config.turns; round++)
      for (const participant of m.participants)
        m.turns.push({
          id: c.id(),
          matchId: id,
          participantId: participant.tournamentEntryId,
          turnNumber: round,
          status: 'pending',
          startedAt: null,
          completedAt: null,
        });
  t.matches.push(m);
  return m;
}
export function register(t: Tournament, player: Player, seed: number | null, c: Context) {
  ensure(
    t.status === 'draft' || t.status === 'registration',
    'REGISTRATION_CLOSED',
    'Registration is closed',
  );
  ensure(player.status === 'active', 'INACTIVE_PLAYER', 'Inactive player cannot register');
  ensure(!entryForPlayer(t, player.id), 'DUPLICATE_ENTRY', 'Player already registered');
  ensure(
    seed === null || !t.entries.some((e) => e.seed === seed),
    'DUPLICATE_SEED',
    'Seed already assigned',
  );
  ensure(t.entries.length < MAX_ENTRIES, 'PLAYER_LIMIT', `Maximum ${MAX_ENTRIES} participants`);
  if (t.status === 'draft') t.status = 'registration';
  t.entries.push({
    id: c.id(),
    tournamentId: t.id,
    playerId: player.id,
    displayNameAtRegistration: player.displayName,
    kind: 'single',
    name: null,
    members: [{ playerId: player.id, displayName: player.displayName }],
    seed,
    status: 'registered',
    registeredAt: c.now(),
  });
}
/** Format, game and recording that can be played together. */
export function validateDefinition(t: Tournament) {
  ensure(
    t.mode !== 'QUICK_HIGH_SCORE' || t.gameMode === 'HI_SCORE',
    'INVALID_GAME_MODE',
    'The quick format ranks Hi-Score totals: choose Hi-Score',
    422,
  );
  ensure(
    t.recording === 'result' || t.gameMode === 'HI_SCORE',
    'INVALID_GAME_MODE',
    'Turn-by-turn entry exists only for Hi-Score',
    422,
  );
  ensure(
    t.mode !== 'SINGLE_MATCH' || t.recording === 'result',
    'INVALID_GAME_MODE',
    'A single match records its final result',
    422,
  );
  ensure(
    t.tournamentConfiguration.groupRanking !== 'POINTS_SCORE' || t.gameMode === 'HI_SCORE',
    'INVALID_RANKING',
    'Score difference ranks only Hi-Score groups: other games rank by points and wins',
    422,
  );
  ensure(
    t.tracking === 'FINAL_ONLY' || t.recording === 'result',
    'INVALID_TRACKING',
    'Progressive tracking goes with final results',
    422,
  );
  const capacity = t.tournamentConfiguration.heatCapacity;
  const seats = Math.min(MAX_HEAT_CAPACITY, games[t.gameMode].players.max);
  ensure(
    capacity === null || (Number.isInteger(capacity) && capacity >= 1 && capacity <= seats),
    'INVALID_HEAT_CAPACITY',
    `Heat capacity between 1 and ${seats}`,
    422,
  );
}
/**
 * Entries a single match accepts. Up to the seats of the totem any game works (Hi-Score also
 * alone, as a practice); beyond them the match is played over several heats, which only
 * games scored in points can rank together.
 */
export function singleMatchLimits(t: Tournament) {
  const g = games[t.gameMode];
  const seats = Math.min(heatCapacity(t), g.players.max);
  return {
    min: g.scoreRequired ? 1 : g.players.min,
    max: comparableAcrossHeats(t.gameMode) ? MAX_ENTRIES : seats,
    seats,
  };
}
function orderedEntries(t: Tournament) {
  if (t.tournamentConfiguration.playingOrder === 'seed') {
    ensure(
      t.entries.every((e) => e.seed !== null),
      'SEED_REQUIRED',
      'Assign unique seeds to all players for seeded order',
    );
    return [...t.entries].sort((a, b) => a.seed! - b.seed!).map((e) => e.id);
  }
  return t.entries.map((e) => e.id);
}
function groupsFor(t: Tournament, ids: string[]) {
  const config = t.tournamentConfiguration;
  const groups = config.groupAssignments ?? distributeGroups(ids, config.groupCount);
  const flattened = groups.flat();
  ensure(
    groups.length === config.groupCount &&
      groups.every((g) => g.length >= 2 && g.length >= config.qualifiersPerGroup) &&
      flattened.length === ids.length &&
      new Set(flattened).size === ids.length &&
      flattened.every((id) => ids.includes(id)),
    'INVALID_GROUP_ASSIGNMENTS',
    'Groups must contain every entry exactly once and enough players for qualification',
    422,
  );
  ensure(
    config.groupCount * config.qualifiersPerGroup >= 2,
    'INVALID_QUALIFIER_COUNT',
    'Knockout requires at least two qualifiers',
    422,
  );
  return groups;
}
export function readyTournament(t: Tournament) {
  transitionTournament(t.status, 'ready');
  validateDefinition(t);
  const ids = orderedEntries(t);
  if (t.mode === 'QUICK_HIGH_SCORE')
    // With fewer players than finalists the qualification is skipped (see startTournament).
    ensure(ids.length >= 2, 'INSUFFICIENT_PLAYERS', 'Register at least two players', 422);
  else if (t.mode === 'SINGLE_MATCH') {
    const { min, max } = singleMatchLimits(t);
    ensure(
      ids.length >= min && ids.length <= max,
      'INVALID_PLAYER_COUNT',
      `${games[t.gameMode].label} is played by ${min === max ? min : `${min} to ${max}`} players`,
      422,
    );
  } else groupsFor(t, ids);
  t.status = 'ready';
}
/** Quick format: fewer players than finalists means everyone plays the final directly. */
export const directFinal = (t: Tournament) =>
  t.mode === 'QUICK_HIGH_SCORE' && t.entries.length < t.tournamentConfiguration.qualifiers;
export function startTournament(t: Tournament, c: Context) {
  if (t.status === 'registration') readyTournament(t);
  transitionTournament(t.status, 'active');
  t.status = 'active';
  t.startedAt = c.now();
  const ids = orderedEntries(t);
  if (t.mode === 'SINGLE_MATCH' || directFinal(t)) {
    const s = newStage(t, 'final', c);
    newMatch(t, s, ids, 'final', c, {
      config: t.tournamentConfiguration.finalScoring ?? t.scoringConfiguration,
    });
  } else if (t.mode === 'QUICK_HIGH_SCORE') {
    const s = newStage(t, 'qualification', c);
    newMatch(t, s, ids, 'qualification', c);
  } else {
    const s = newStage(t, 'group', c);
    groupsFor(t, ids).forEach((entries, index) => {
      const group = {
        id: c.id(),
        stageId: s.id,
        name: `Group ${index + 1}`,
        ordering: index + 1,
        status: 'active' as const,
        entryIds: entries,
      };
      t.groups.push(group);
      for (const pair of roundRobin(entries))
        newMatch(t, s, [pair.home, pair.away], 'group', c, {
          groupId: group.id,
          scheduleRound: pair.scheduleRound,
        });
    });
  }
}
export function pauseTournament(t: Tournament) {
  transitionTournament(t.status, 'paused');
  t.status = 'paused';
  for (const m of t.matches.filter((m) => m.status === 'active')) {
    m.status = 'paused';
    m.version++;
  }
}
export function resumeTournament(t: Tournament) {
  transitionTournament(t.status, 'active');
  t.status = 'active';
  for (const m of t.matches.filter((m) => m.status === 'paused')) {
    m.status = 'active';
    m.version++;
  }
}
export function cancelTournament(t: Tournament) {
  transitionTournament(t.status, 'cancelled');
  t.status = 'cancelled';
  for (const m of t.matches.filter((m) => !['completed', 'cancelled'].includes(m.status))) {
    m.status = 'cancelled';
    m.version++;
  }
}
export function startMatch(t: Tournament, m: Match, c: Context) {
  activeTournament(t);
  ensure(stageById(t, m.stageId).status === 'open', 'STAGE_CLOSED', 'Stage must be open');
  ensure(
    !t.matches.some((other) => other.id !== m.id && ['active', 'paused'].includes(other.status)),
    'BOARD_BUSY',
    'Another match is using the board',
  );
  transitionMatch(m.status, 'active');
  m.status = 'active';
  m.startedAt ??= c.now();
  m.version++;
  // Several heats: the first one waiting goes to the board with the match.
  const first = m.heats.find((h) => h.status === 'pending' || h.status === 'ready');
  if (first && !m.heats.some((h) => h.status === 'active')) startHeat(t, m, first.id, c);
  const turn = currentTurn(m);
  if (turn) {
    turn.status = 'active';
    turn.startedAt ??= c.now();
  }
}
export function recordScore(
  t: Tournament,
  m: Match,
  input: { turnId: string; score: number; dartIndex: number | null },
  c: Context,
) {
  activeTournament(t);
  ensure(m.status === 'active', 'MATCH_NOT_ACTIVE', 'Start match before recording');
  ensure(stageById(t, m.stageId).status === 'open', 'STAGE_CLOSED', 'Stage is finalized');
  const turn = currentTurn(m);
  ensure(
    turn && turn.id === input.turnId,
    'WRONG_TURN',
    'Only the current turn accepts new scores',
  );
  const scores = effectiveScores(m, turn.id),
    config = m.scoringConfiguration;
  if (input.dartIndex === null)
    ensure(scores.length === 0, 'DUPLICATE_SCORE', 'Turn already has scores');
  else {
    ensure(
      input.dartIndex >= 1 &&
        input.dartIndex <= config.dartsPerTurn &&
        Number.isInteger(input.dartIndex),
      'INVALID_DART',
      'Dart index out of range',
      422,
    );
    ensure(
      scores.every((s) => s.dartIndex !== null && s.dartIndex !== input.dartIndex),
      'DUPLICATE_SCORE',
      'Dart already recorded or turn has a total',
    );
  }
  validateScore(input.score, input.dartIndex === null ? config.maxTurnScore : config.maxDartScore);
  validateScore(
    scores.reduce((n, s) => n + s.score, input.score),
    config.maxTurnScore,
  );
  const score = {
    id: c.id(),
    matchId: m.id,
    tournamentEntryId: turn.participantId,
    turnId: turn.id,
    score: input.score,
    dartIndex: input.dartIndex,
    source: 'manual' as const,
    createdAt: c.now(),
    recordedBy: c.operator,
    voided: false,
  };
  m.scores.push(score);
  m.version++;
  return score;
}
/** Winner, placements and final scores of a completed match, playoffs included. */
export function updateOutcome(t: Tournament, m: Match) {
  const rows = matchStandings(t, m);
  m.winnerEntryId = rows[0] && !rows[0].tied ? rows[0].tournamentEntryId : null;
  for (const p of m.participants) {
    const row = rows.find((r) => r.tournamentEntryId === p.tournamentEntryId);
    p.finalScore = participantScore(t, m, p.tournamentEntryId);
    p.placement = row?.placement ?? null;
    p.outcome = row?.placement === 1 ? (row.tied ? 'draw' : 'win') : 'loss';
  }
}
export function completeTurn(t: Tournament, m: Match, turnId: string, c: Context) {
  activeTournament(t);
  ensure(m.status === 'active', 'MATCH_NOT_ACTIVE', 'Match must be active');
  const turn = currentTurn(m);
  ensure(turn && turn.id === turnId, 'WRONG_TURN', 'Turn is not current or is already complete');
  ensure(
    turnIsComplete(m, turn),
    'INCOMPLETE_TURN',
    'Record a turn total or all darts before completing',
  );
  turn.status = 'completed';
  turn.completedAt = c.now();
  m.version++;
  const next = currentTurn(m);
  if (next) {
    next.status = 'active';
    next.startedAt ??= c.now();
  } else completeMatch(t, m, c);
}
export function completeMatch(t: Tournament, m: Match, c: Context) {
  activeTournament(t);
  ensure(m.status === 'active', 'MATCH_NOT_ACTIVE', 'Match must be active');
  ensure(
    m.turns.every(
      (turn) =>
        turn.status === 'skipped' || (turn.status === 'completed' && turnIsComplete(m, turn)),
    ),
    'INCOMPLETE_MATCH',
    'Every required turn must be complete',
  );
  transitionMatch(m.status, 'completed');
  m.status = 'completed';
  m.completedAt = c.now();
  m.version++;
  updateOutcome(t, m);
  if (m.matchType === 'tiebreak') {
    const target = t.matches.find((x) => x.id === m.tieTarget);
    if (target) {
      updateOutcome(t, target);
      target.version++;
    }
  }
  advanceKnockout(t, c);
}
export function correctScore(t: Tournament, scoreId: string, value: number | null, c: Context) {
  activeTournament(t);
  const m = t.matches.find((m) => m.scores.some((s) => s.id === scoreId));
  ensure(m, 'NOT_FOUND', 'Score not found', 404);
  const stage = stageById(t, m.stageId);
  ensure(
    stage.status === 'open',
    'STAGE_CLOSED',
    'Reopen this stage administratively before correction',
  );
  ensure(m.status !== 'cancelled', 'MATCH_CANCELLED', 'Cannot correct an invalidated match');
  const score = m.scores.find((s) => s.id === scoreId)!;
  ensure(!score.voided, 'SCORE_VOIDED', 'Score has been voided');
  ensure(
    !stage.excludedEntryIds.includes(score.tournamentEntryId),
    'ENTRY_WITHDRAWN',
    'Withdrawn qualification entries cannot be rescored',
  );
  if (value !== null) {
    validateScore(
      value,
      score.dartIndex === null
        ? m.scoringConfiguration.maxTurnScore
        : m.scoringConfiguration.maxDartScore,
    );
    const other = effectiveScores(m, score.turnId)
      .filter((s) => s.id !== score.id)
      .reduce((n, s) => n + s.score, 0);
    validateScore(other + value, m.scoringConfiguration.maxTurnScore);
    score.score = value;
  } else {
    score.voided = true;
    const turn = m.turns.find((x) => x.id === score.turnId)!;
    turn.status = 'pending';
    turn.completedAt = null;
    if (m.status === 'completed') {
      m.status = 'ready';
      m.completedAt = null;
    }
  }
  // Recorded playoffs become invalid if their underlying scores change.
  const targets = new Set([m.id, m.groupId].filter(Boolean));
  if (m.matchType === 'tiebreak') targets.add(m.tieTarget);
  for (const dep of t.matches.filter(
    (x) =>
      x.matchType === 'tiebreak' &&
      x.id !== m.id &&
      targets.has(x.tieTarget) &&
      (m.matchType !== 'tiebreak' || x.sequence > m.sequence) &&
      x.status !== 'cancelled',
  )) {
    dep.status = 'cancelled';
    dep.version++;
  }
  if (m.status === 'completed') updateOutcome(t, m);
  else {
    m.winnerEntryId = null;
    for (const p of m.participants) {
      p.finalScore = null;
      p.placement = null;
      p.outcome = 'pending';
    }
  }
  if (m.matchType === 'tiebreak') {
    const target = t.matches.find((x) => x.id === m.tieTarget);
    if (target) {
      updateOutcome(t, target);
      target.version++;
    }
  }
  if (m.status === 'active') {
    for (const turn of m.turns) if (turn.status === 'active') turn.status = 'pending';
    const next = currentTurn(m);
    if (next) next.status = 'active';
  }
  m.version++;
  return score;
}
/** The exact unresolved tied group of a match or group; returns where its playoff belongs. */
export function assertTieGroup(t: Tournament, targetId: string, entryIds: string[]) {
  activeTournament(t);
  ensure(
    new Set(entryIds).size === entryIds.length,
    'DUPLICATE_ENTRY',
    'Playoff entrants must be unique',
  );
  const targetMatch = t.matches.find((m) => m.id === targetId),
    group = t.groups.find((g) => g.id === targetId);
  ensure(targetMatch || group, 'NOT_FOUND', 'Playoff target not found', 404);
  ensure(
    !targetMatch || targetMatch.matchType !== 'tiebreak',
    'INVALID_TARGET',
    'Target the original match, not its playoff',
  );
  const stage = stageById(t, targetMatch?.stageId ?? group!.stageId);
  ensure(stage.status === 'open', 'STAGE_CLOSED', 'Cannot create playoff for a closed stage');
  if (targetMatch)
    ensure(targetMatch.status === 'completed', 'INCOMPLETE_MATCH', 'Finish the match first');
  else
    ensure(
      t.matches
        .filter((m) => m.groupId === group!.id && m.matchType === 'group')
        .every(
          (m) =>
            m.status === 'completed' && (t.tournamentConfiguration.allowDraws || m.winnerEntryId),
        ),
      'INCOMPLETE_GROUP',
      'Finish group matches and required match playoffs first',
    );
  ensure(
    !t.matches.some(
      (m) => m.tieTarget === targetId && !['completed', 'cancelled'].includes(m.status),
    ),
    'PLAYOFF_PENDING',
    'Complete the pending playoff first',
  );
  const rows = targetMatch ? matchStandings(t, targetMatch) : groupStandings(t, group!.id);
  const first = rows.find((r) => r.tournamentEntryId === entryIds[0]);
  const tied = rows.filter((r) => r.placement === first?.placement);
  ensure(
    first?.tied &&
      tied.length === entryIds.length &&
      tied.every((r) => entryIds.includes(r.tournamentEntryId)),
    'INVALID_TIE_GROUP',
    'Playoff must include exactly one unresolved tied group',
  );
  return { stage, targetMatch, group };
}
export function createTieBreak(t: Tournament, targetId: string, entryIds: string[], c: Context) {
  const { stage, targetMatch, group } = assertTieGroup(t, targetId, entryIds);
  ensure(
    t.recording === 'turns' ||
      entryIds.length <= heatCapacity(t) ||
      comparableAcrossHeats(t.gameMode),
    'INVALID_PLAYER_COUNT',
    'Too many tied players for one game on the totem: decide the tie explicitly',
    422,
  );
  return newMatch(t, stage, entryIds, 'tiebreak', c, {
    config: {
      ...(targetMatch?.scoringConfiguration ?? t.scoringConfiguration),
      turns: t.tournamentConfiguration.tieBreakTurns,
    },
    tieTarget: targetId,
    ...(group ? { groupId: group.id } : {}),
  });
}
export function finalizeQualification(t: Tournament, c: Context) {
  activeTournament(t);
  const s = currentStage(t);
  ensure(
    s.status === 'open' && ['qualification', 'group'].includes(s.kind),
    'INVALID_STAGE',
    'Current phase is not an open qualification',
  );
  const matches = t.matches.filter((m) => m.stageId === s.id && m.status !== 'cancelled');
  ensure(
    matches.length > 0 && matches.every((m) => m.status === 'completed'),
    'INCOMPLETE_QUALIFICATION',
    'All expected matches and playoffs must be completed',
  );
  let ids: string[];
  if (s.kind === 'qualification') {
    const m = matches.find((m) => m.matchType === 'qualification')!;
    ids = selectQualifiers(matchStandings(t, m), t.tournamentConfiguration.qualifiers);
  } else {
    ensure(
      t.tournamentConfiguration.allowDraws ||
        matches.filter((m) => m.matchType === 'group').every((m) => m.winnerEntryId !== null),
      'TIE_REQUIRES_PLAYOFF',
      'Drawn group matches need playoffs when draws are disabled',
    );
    const groups = t.groups
      .filter((g) => g.stageId === s.id)
      .sort((a, b) => a.ordering - b.ordering);
    const qualified = groups.map((g) => {
      const rows = groupStandings(t, g.id);
      const ids = selectQualifiers(rows, t.tournamentConfiguration.qualifiersPerGroup);
      const places = rows.filter((r) => ids.includes(r.tournamentEntryId)).map((r) => r.placement);
      ensure(
        new Set(places).size === places.length,
        'TIE_REQUIRES_PLAYOFF',
        'Resolve tied qualifying positions for explicit knockout seeding',
      );
      g.status = 'completed';
      return ids;
    });
    ids = [];
    for (let place = 0; place < t.tournamentConfiguration.qualifiersPerGroup; place++)
      for (const group of qualified) ids.push(group[place]!);
  }
  s.qualifiedEntryIds = ids;
  s.status = 'finalized';
  s.finalizedAt = c.now();
  for (const e of t.entries)
    if (e.status !== 'withdrawn') e.status = ids.includes(e.id) ? 'qualified' : 'eliminated';
}
export function generateFinal(t: Tournament, c: Context) {
  activeTournament(t);
  const source = currentStage(t);
  ensure(
    ['qualification', 'group'].includes(source.kind) && source.status === 'finalized',
    'QUALIFICATION_NOT_FINALIZED',
    'Confirm qualification before generating finals',
  );
  if (t.mode === 'QUICK_HIGH_SCORE') {
    const s = newStage(t, 'final', c);
    const ids = orderedEntries(t).filter((id) => source.qualifiedEntryIds.includes(id));
    newMatch(t, s, ids, 'final', c, {
      config: t.tournamentConfiguration.finalScoring ?? t.scoringConfiguration,
    });
  } else generateKnockoutStage(t, seededBracket(source.qualifiedEntryIds), c);
}
function generateKnockoutStage(t: Tournament, pairs: (string | null)[][], c: Context) {
  const kind =
    pairs.length === 1
      ? 'final'
      : pairs.length === 2
        ? 'semifinal'
        : `elimination_${pairs.length * 2}`;
  const s = newStage(t, kind, c);
  for (const pair of pairs) {
    const ids = pair.filter((id): id is string => id !== null);
    ensure(ids.length > 0, 'EMPTY_PAIR', 'Empty knockout pair');
    const m = newMatch(t, s, ids, kind === 'final' ? 'final' : 'knockout', c, {
      config: t.tournamentConfiguration.finalScoring ?? t.scoringConfiguration,
    });
    if (ids.length === 1) {
      m.turns = [];
      m.status = 'completed';
      m.completedAt = c.now();
      m.winnerEntryId = ids[0]!;
      m.participants[0]!.outcome = 'win';
      m.participants[0]!.placement = 1;
    }
  }
}
export function advanceKnockout(t: Tournament, c: Context) {
  if (t.mode !== 'GROUPS') return;
  const s = currentStage(t);
  if (['qualification', 'group'].includes(s.kind) || s.status !== 'open') return;
  const matches = t.matches.filter(
    (m) => m.stageId === s.id && m.matchType !== 'tiebreak' && m.status !== 'cancelled',
  );
  if (
    !matches.length ||
    !matches.every((m) => m.status === 'completed' && m.winnerEntryId) ||
    t.matches.some(
      (m) =>
        m.stageId === s.id &&
        m.matchType === 'tiebreak' &&
        !['completed', 'cancelled'].includes(m.status),
    )
  )
    return;
  if (s.kind === 'final') return; // Winner confirmation remains an explicit command.
  s.status = 'finalized';
  s.finalizedAt = c.now();
  s.qualifiedEntryIds = matches.map((m) => m.winnerEntryId!);
  for (const m of matches)
    for (const p of m.participants)
      if (p.tournamentEntryId !== m.winnerEntryId) {
        const e = t.entries.find((e) => e.id === p.tournamentEntryId)!;
        if (e.status !== 'withdrawn') e.status = 'eliminated';
      }
  const winners = s.qualifiedEntryIds;
  generateKnockoutStage(
    t,
    Array.from({ length: winners.length / 2 }, (_, i) => [winners[i * 2]!, winners[i * 2 + 1]!]),
    c,
  );
}
export function completeTournament(t: Tournament, c: Context) {
  activeTournament(t);
  const s = currentStage(t);
  ensure(s.kind === 'final' && s.status === 'open', 'INVALID_STAGE', 'An open final is required');
  const final = t.matches.find((m) => m.stageId === s.id && m.matchType === 'final')!;
  ensure(
    final.status === 'completed' &&
      t.matches
        .filter((m) => m.stageId === s.id && m.status !== 'cancelled')
        .every((m) => m.status === 'completed'),
    'INCOMPLETE_FINAL',
    'Complete final and all playoffs',
  );
  const rows = matchStandings(t, final);
  ensure(
    rows[0] && !rows[0].tied,
    'TIE_REQUIRES_PLAYOFF',
    'The winner requires a decisive playoff',
  );
  final.winnerEntryId = rows[0].tournamentEntryId;
  s.status = 'finalized';
  s.finalizedAt = c.now();
  s.qualifiedEntryIds = [final.winnerEntryId];
  const placements = new Map(rows.map((r) => [r.tournamentEntryId, r.placement]));
  // Finalists who withdrew rank after those who finished the final.
  for (const p of final.participants)
    if (!placements.has(p.tournamentEntryId)) placements.set(p.tournamentEntryId, rows.length + 1);
  const validStages = t.stages.filter((s) => s.status !== 'invalidated').reverse();
  for (const stage of validStages) {
    if (stage.kind === 'qualification') {
      const match = t.matches.find(
        (m) => m.stageId === stage.id && m.matchType === 'qualification',
      )!;
      for (const r of matchStandings(t, match))
        if (!placements.has(r.tournamentEntryId))
          placements.set(
            r.tournamentEntryId,
            Math.max(t.tournamentConfiguration.qualifiers + 1, r.placement),
          );
    } else if (stage.kind === 'group') {
      const count = stage.qualifiedEntryIds.length;
      for (const g of t.groups.filter((g) => g.stageId === stage.id))
        for (const id of g.entryIds) if (!placements.has(id)) placements.set(id, count + 1);
    } else {
      const matches = t.matches.filter(
        (m) => m.stageId === stage.id && m.matchType !== 'tiebreak' && m.status !== 'cancelled',
      );
      const placement = matches.length + 1;
      for (const m of matches)
        for (const p of m.participants)
          if (!placements.has(p.tournamentEntryId)) placements.set(p.tournamentEntryId, placement);
    }
  }
  t.results = t.entries.map((e) => {
    const finalParticipant = final.participants.some((p) => p.tournamentEntryId === e.id);
    const last = finalParticipant
      ? final
      : [...t.matches]
          .reverse()
          .find(
            (m) =>
              m.status === 'completed' &&
              m.matchType !== 'tiebreak' &&
              m.participants.some((p) => p.tournamentEntryId === e.id) &&
              stageById(t, m.stageId).status !== 'invalidated',
          );
    const legacy = t.recording === 'turns' && !last?.result;
    const stats = !last
      ? { total: 0, turns: 0, bestTurn: 0, average: 0 }
      : legacy
        ? playerPerformance(last, e.id)
        : { total: participantScore(t, last, e.id) ?? 0, turns: 0, bestTurn: 0, average: 0 };
    if (e.status !== 'withdrawn') e.status = e.id === final.winnerEntryId ? 'winner' : 'eliminated';
    return {
      tournamentId: t.id,
      tournamentEntryId: e.id,
      finalPlacement: placements.get(e.id) ?? t.entries.length,
      points: stats.total,
      statistics: {
        kind: legacy ? ('HIGH_SCORE' as const) : ('RESULT' as const),
        total: stats.total,
        turns: stats.turns,
        bestTurn: stats.bestTurn,
        average: stats.average,
      },
    };
  });
  transitionTournament(t.status, 'completed');
  t.status = 'completed';
  t.currentPhase = 'completed';
  t.completedAt = c.now();
}
export function reopenStage(t: Tournament, stageId: string, c: Context) {
  ensure(
    ['active', 'paused', 'completed'].includes(t.status),
    'INVALID_STATE',
    'Only started tournaments can reopen a stage',
  );
  const s = stageById(t, stageId);
  ensure(s.status !== 'invalidated', 'INVALID_STAGE', 'Cannot reopen an invalidated stage');
  for (const later of t.stages.filter(
    (x) => x.ordering > s.ordering && x.status !== 'invalidated',
  )) {
    later.status = 'invalidated';
    for (const m of t.matches.filter((m) => m.stageId === later.id)) {
      m.status = 'cancelled';
      m.version++;
    }
    for (const g of t.groups.filter((g) => g.stageId === later.id)) g.status = 'invalidated';
  }
  for (const m of t.matches.filter(
    (m) => m.stageId === s.id && m.matchType === 'tiebreak' && m.status !== 'cancelled',
  )) {
    m.status = 'cancelled';
    m.version++;
  }
  for (const m of t.matches.filter((m) => m.stageId === s.id && m.matchType !== 'tiebreak'))
    if (m.status === 'completed' && m.participants.length > 1) {
      updateOutcome(t, m);
      m.version++;
    }
  s.status = 'open';
  s.qualifiedEntryIds = [];
  s.finalizedAt = null;
  t.results = [];
  t.status = 'active';
  t.currentPhase = s.kind;
  t.completedAt = null;
  for (const m of t.matches.filter((m) => m.stageId === s.id && m.status === 'paused')) {
    m.status = 'active';
    m.version++;
  }
  for (const g of t.groups.filter((g) => g.stageId === s.id)) g.status = 'active';
  const previous = t.stages
    .filter((x) => x.ordering < s.ordering && x.status === 'finalized')
    .at(-1);
  for (const e of t.entries)
    e.status =
      e.status === 'withdrawn'
        ? 'withdrawn'
        : s.excludedEntryIds.includes(e.id)
          ? 'eliminated'
          : !previous
            ? 'registered'
            : previous.qualifiedEntryIds.includes(e.id)
              ? 'qualified'
              : 'eliminated';
}
export function closeQualificationEarly(t: Tournament, excluded: string[], c: Context) {
  activeTournament(t);
  const s = currentStage(t);
  ensure(
    t.mode === 'QUICK_HIGH_SCORE' && s.kind === 'qualification' && s.status === 'open',
    'INVALID_STAGE',
    'Early closure is available only for Quick qualification',
  );
  const m = t.matches.find((m) => m.stageId === s.id && m.matchType === 'qualification')!;
  ensure(m.status === 'active', 'MATCH_NOT_ACTIVE', 'Start qualification before early closure');
  const incomplete = m.participants
    .filter((p) =>
      m.turns.some(
        (turn) => turn.participantId === p.tournamentEntryId && turn.status !== 'completed',
      ),
    )
    .map((p) => p.tournamentEntryId);
  ensure(
    excluded.length === incomplete.length &&
      new Set(excluded).size === excluded.length &&
      incomplete.every((id) => excluded.includes(id)),
    'INVALID_EXCLUSIONS',
    'Explicitly exclude exactly all incomplete participants',
  );
  ensure(
    m.participants.length - excluded.length >= t.tournamentConfiguration.qualifiers,
    'INSUFFICIENT_PLAYERS',
    'Too few completed participants to qualify',
  );
  // Incomplete participants are withdrawn; their recorded scores remain available.
  for (const id of excluded) t.entries.find((e) => e.id === id)!.status = 'eliminated';
  s.excludedEntryIds = [...excluded];
  for (const turn of m.turns.filter(
    (turn) => excluded.includes(turn.participantId) && turn.status !== 'completed',
  )) {
    turn.status = 'skipped';
    turn.completedAt = c.now();
  }
  m.status = 'completed';
  m.completedAt = c.now();
  m.version++;
  updateOutcome(t, m);
}
export function reorder(t: Tournament, ids: string[]) {
  activeTournament(t);
  const ready = t.matches.filter(
    (m) => m.status === 'ready' && stageById(t, m.stageId).status === 'open',
  );
  ensure(
    ids.length === ready.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => ready.some((m) => m.id === id)),
    'INVALID_MATCH_ORDER',
    'Supply each pending match exactly once',
  );
  const sequences = ready.map((m) => m.sequence).sort((a, b) => a - b);
  ids.forEach((id, i) => {
    const m = matchById(t, id);
    m.sequence = sequences[i]!;
    m.version++;
  });
}
