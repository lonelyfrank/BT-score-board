import { z } from 'zod';
export const id = z.uuid();
const name = z.string().trim().min(1).max(120);
export const version = z.number().int().nonnegative();
export const gameMode = z.enum([
  '301',
  '301_DOUBLE_IN_OUT',
  '501',
  'HI_SCORE',
  '301_MASTERS',
  'EXACTA',
  'ODD_EVEN',
  'SHANGHAI',
]);
export const tournamentFormat = z.enum(['QUICK_HIGH_SCORE', 'GROUPS', 'SINGLE_MATCH']);
export const recording = z.enum(['result', 'turns']);
export const tracking = z.enum(['FINAL_ONLY', 'ROUND_BY_ROUND', 'FLEXIBLE']);
export const heatStrategy = z.enum(['sequential', 'random', 'balanced']);
export const x01Entry = z.enum(['SCORED', 'REMAINING']);
/** Seats of a heat on the totem (verified: four). */
const heatCapacity = z.number().int().min(1).max(4);
/** Preset avatars only: no images are stored. */
export const avatar = z.string().regex(/^[a-z0-9-]{1,32}$/);
export const scoringConfiguration = z
  .strictObject({
    kind: z.literal('HIGH_SCORE').default('HIGH_SCORE'),
    // The totem plays Hi-Score over 7 rounds.
    turns: z.number().int().min(1).max(100).default(7),
    dartsPerTurn: z.number().int().min(1).max(12).default(3),
    maxDartScore: z.number().int().min(1).max(1000).default(60),
    maxTurnScore: z.number().int().min(1).max(12000).optional(),
  })
  .transform((c) => ({ ...c, maxTurnScore: c.maxTurnScore ?? c.dartsPerTurn * c.maxDartScore }));
export const tournamentConfiguration = z.strictObject({
  qualifiers: z.number().int().min(2).max(64).default(4),
  groupCount: z.number().int().min(1).max(16).default(2),
  qualifiersPerGroup: z.number().int().min(1).max(16).default(2),
  winPoints: z.number().int().min(0).max(100).default(3),
  drawPoints: z.number().int().min(0).max(100).default(1),
  lossPoints: z.number().int().min(0).max(100).default(0),
  allowDraws: z.boolean().default(true),
  tiePolicy: z.enum(['PLAYOFF', 'BEST_TURN_THEN_PLAYOFF']).default('PLAYOFF'),
  tieBreakTurns: z.number().int().min(1).max(20).default(1),
  finalScoring: scoringConfiguration.nullable().default(null),
  playingOrder: z.enum(['registration', 'seed']).default('registration'),
  groupAssignments: z.array(z.array(id).min(2)).min(1).max(16).nullable().default(null),
  // A union, not .nullable(): OpenAPI 3.0 enums must list null for the request validator.
  groupRanking: z.union([z.enum(['POINTS_SCORE', 'POINTS_WINS']), z.null()]).default(null),
  // null: the most players of the game on the totem.
  heatCapacity: z.union([heatCapacity, z.null()]).default(null),
  heatStrategy: heatStrategy.default('sequential'),
  x01Entry: x01Entry.default('REMAINING'),
});
export const createPlayer = z.strictObject({
  displayName: name,
  nickname: name.nullable().optional(),
  avatar: avatar.nullable().optional(),
});
export const updatePlayer = createPlayer
  .partial()
  .extend({ status: z.enum(['active', 'inactive']).optional() })
  .refine((x) => Object.keys(x).length > 0, 'Provide an update');
export const createEvent = z.strictObject({
  name,
  description: z.string().max(2000).nullable().optional(),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export const updateEvent = createEvent
  .partial()
  .extend({ status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional() });
export const createTournament = z.strictObject({
  name,
  eventId: id.nullable().optional(),
  mode: tournamentFormat,
  gameMode: gameMode.default('HI_SCORE'),
  recording: recording.default('result'),
  tracking: tracking.default('FINAL_ONLY'),
  scoringConfiguration: scoringConfiguration.prefault({}),
  tournamentConfiguration: tournamentConfiguration.prefault({}),
});
export const command = z.strictObject({ expectedVersion: version });
export const registerPlayer = command.extend({
  playerId: id,
  seed: z.number().int().min(1).max(256).nullable().optional(),
});
export const matchCommand = command.extend({ expectedMatchVersion: version });
export const recordScore = matchCommand.extend({
  turnId: id,
  score: z.number().int().nonnegative().max(12000),
  dartIndex: z.number().int().min(1).max(12).nullable().default(null),
});
export const completeTurn = matchCommand.extend({ turnId: id });
export const correctScore = matchCommand.extend({
  score: z.number().int().nonnegative().max(12000),
  reason: z.string().trim().min(1).max(1000).optional(),
});
export const voidScore = matchCommand.extend({ reason: z.string().trim().min(1).max(1000) });
export const tieBreak = command.extend({ targetId: id, entryIds: z.array(id).min(2).max(64) });
export const reopenStage = command.extend({
  stageId: id,
  reason: z.string().trim().min(1).max(1000),
});
export const earlyClose = command.extend({
  excludedEntryIds: z.array(id).min(1).max(256),
  reason: z.string().trim().min(1).max(1000),
});
export const reorderMatches = command.extend({ matchIds: z.array(id).min(1).max(10000) });
const reason = z.string().trim().min(1).max(1000);
/** Units in seed order: one player is a single, more players a team. */
export const composeEntries = command.extend({
  entries: z
    .array(
      z.strictObject({
        playerIds: z.array(id).min(1).max(8),
        name: name.nullable().optional(),
      }),
    )
    .min(1)
    .max(256),
});
export const generateHeats = matchCommand.extend({
  strategy: heatStrategy,
  capacity: heatCapacity.nullable().optional(),
  /** Seed of the random strategy: the same seed gives the same heats. */
  seed: z.number().int().nonnegative().max(4294967295).nullable().optional(),
});
export const arrangeHeats = matchCommand.extend({
  heats: z
    .array(
      z.strictObject({
        heatId: id.nullable().optional(),
        entryIds: z.array(id).min(1).max(4),
        slotPositions: z.array(z.number().int().min(1).max(4)).optional(),
      }),
    )
    .min(1)
    .max(256),
});
export const heatCommand = matchCommand.extend({ heatId: id });
export const lockHeat = heatCommand.extend({ locked: z.boolean() });
/**
 * One dart as observed: sector 1–20 for single, double and triple, none for bull, miss (off the
 * board, zero) and unobserved (nobody saw it, never zero).
 */
export const dartThrow = z.strictObject({
  kind: z.enum(['single', 'double', 'triple', 'bull25', 'bull50', 'miss', 'unobserved']),
  sector: z.number().int().min(1).max(20).nullable(),
});
/** Up to three darts; fewer only when the turn ended early (bust, checkout). */
const darts = z.array(dartThrow).min(1).max(3);
export const recordRound = matchCommand.extend({
  entryId: id,
  round: z.number().int().min(1).max(99),
  /** null: the round was not observed (skipped), which is not zero. */
  value: z.number().int().nonnegative().max(12000).nullable(),
  /** Darts one by one; left out on a correction to keep the darts already entered. */
  darts: darts.nullable().optional(),
  /** X01: the points from this round do not count. */
  bust: z.boolean().default(false),
  playerId: id.nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
  advanceRotation: z.boolean().default(false),
});
/** Confirms the turn at the board; refused when another turn is there. */
export const recordTurn = matchCommand.extend({
  entryId: id,
  round: z.number().int().min(1).max(99),
  /** Left out when the darts decide the turn; null: not observed. */
  value: z.number().int().nonnegative().max(12000).nullable().optional(),
  darts: darts.nullable().optional(),
  /** X01: declared bust, without a value (the running total is kept). */
  bust: z.boolean().default(false),
  playerId: id.nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
});
export const guideTurn = matchCommand.extend({
  action: z.enum(['pick', 'undo', 'pause', 'resume']),
  entryId: id.nullable().optional(),
  round: z.number().int().min(1).max(99).nullable().optional(),
  heatId: id.nullable().optional(),
});
export const voidRound = matchCommand.extend({
  entryId: id,
  round: z.number().int().min(1).max(99),
  restorePrevious: z.boolean().default(false),
  reason,
});
export const rotateTeam = matchCommand.extend({
  entryId: id,
  action: z.enum(['advance', 'undo', 'pause', 'resume', 'reorder']),
  order: z.array(id).min(2).max(8).optional(),
});
export const recordResult = matchCommand.extend({
  scores: z.record(id, z.number().int().nonnegative().max(12000).nullable()).optional(),
  winnerEntryId: id.nullable().optional(),
  targetScore: z.number().int().nonnegative().max(1000).nullable().optional(),
  special: z.enum(['SHANGHAI']).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  confirmInvalidation: z.boolean().default(false),
  /** Why an official score differs from the complete progressive total of that entry. */
  reconciliation: z.record(id, reason).optional(),
});
export const entryCommand = command.extend({ entryId: id });
export const withdrawEntry = entryCommand.extend({ reason });
export const cancelMatch = matchCommand.extend({ reason });
export const decideTie = command.extend({
  targetId: id,
  orderedEntryIds: z.array(id).min(2).max(64),
  reason,
});
export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(120).optional(),
  status: z.string().max(32).optional(),
  eventId: id.optional(),
});
export const eventQuery = z.strictObject({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const playerResponse = z.object({
  id,
  displayName: z.string(),
  nickname: z.string().nullable(),
  avatar: z.string().nullable().default(null),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const eventResponse = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const scoringResponse = z.object({
  kind: z.literal('HIGH_SCORE'),
  turns: z.number(),
  dartsPerTurn: z.number(),
  maxDartScore: z.number(),
  maxTurnScore: z.number(),
});
export const entryResponse = z.object({
  id,
  tournamentId: id,
  playerId: id,
  displayNameAtRegistration: z.string(),
  kind: z.enum(['single', 'team']).default('single'),
  name: z.string().nullable().default(null),
  members: z.array(z.object({ playerId: id, displayName: z.string() })).default([]),
  seed: z.number().nullable(),
  status: z.string(),
  registeredAt: z.string(),
});
export const stageResponse = z.object({
  id,
  tournamentId: id,
  kind: z.string(),
  ordering: z.number(),
  status: z.string(),
  qualifiedEntryIds: z.array(id),
  excludedEntryIds: z.array(id),
  createdAt: z.string(),
  finalizedAt: z.string().nullable(),
});
export const groupResponse = z.object({
  id,
  stageId: id,
  name: z.string(),
  ordering: z.number(),
  status: z.string(),
  entryIds: z.array(id),
});
export const scoreResponse = z.object({
  id,
  matchId: id,
  tournamentEntryId: id,
  turnId: id,
  score: z.number(),
  dartIndex: z.number().nullable(),
  source: z.literal('manual'),
  createdAt: z.string(),
  recordedBy: z.string(),
  voided: z.boolean(),
});
export const turnResponse = z.object({
  id,
  matchId: id,
  participantId: id,
  turnNumber: z.number(),
  status: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export const heatResponse = z.object({
  slotPositions: z.array(z.number().int().min(1)).optional(),
  id,
  matchId: id,
  number: z.number(),
  entryIds: z.array(id),
  status: z.enum(['pending', 'ready', 'active', 'completed', 'cancelled']),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export const roundResponse = z.object({
  id,
  matchId: id,
  tournamentEntryId: id,
  round: z.number(),
  playerId: id.nullable(),
  value: z.number().nullable(),
  bust: z.boolean().default(false),
  kind: z.enum(['points', 'remaining', 'progress']),
  status: z.enum(['recorded', 'skipped', 'corrected', 'voided']),
  correctsId: id.nullable(),
  reason: z.string().nullable(),
  source: z.literal('manual'),
  createdAt: z.string(),
  recordedBy: z.string(),
  /** Absent on rounds recorded before darts existed: only their value is known. */
  darts: z.array(dartThrow).nullable().optional(),
});
const turnSlot = z.object({ entryId: id, round: z.number() });
export const guideResponse = z.object({
  pick: turnSlot.nullable(),
  replay: z.array(turnSlot),
  paused: z.boolean(),
});
export const rotationResponse = z.object({
  entryId: id,
  order: z.array(id),
  position: z.number(),
  paused: z.boolean(),
  history: z.array(z.number()),
});
export const participantResponse = z.object({
  matchId: id,
  tournamentEntryId: id,
  playingOrder: z.number(),
  finalScore: z.number().nullable(),
  placement: z.number().nullable(),
  outcome: z.string(),
});
export const matchResponse = z.object({
  id,
  tournamentId: id,
  stageId: id,
  groupId: id.nullable(),
  matchType: z.string(),
  status: z.string(),
  sequence: z.number(),
  scheduleRound: z.number(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  version,
  scoringConfiguration: scoringResponse,
  participants: z.array(participantResponse),
  turns: z.array(turnResponse),
  scores: z.array(scoreResponse),
  tieTarget: id.nullable(),
  winnerEntryId: id.nullable(),
  result: z
    .object({
      scores: z.record(id, z.number().nullable()),
      declaredWinnerEntryId: id.nullable(),
      targetScore: z.number().nullable(),
      special: z.enum(['SHANGHAI']).nullable(),
      walkover: z.boolean(),
      decision: z.object({ order: z.array(id), reason: z.string() }).nullable(),
      notes: z.string().nullable(),
      reconciliation: z
        .array(
          z.object({
            entryId: id,
            computed: z.number(),
            official: z.number(),
            reason: z.string(),
            recordedAt: z.string(),
            recordedBy: z.string(),
          }),
        )
        .default([]),
      recordedAt: z.string(),
      updatedAt: z.string(),
      recordedBy: z.string(),
    })
    .nullable()
    .default(null),
  heats: z.array(heatResponse).default([]),
  rounds: z.array(roundResponse).default([]),
  rotations: z.array(rotationResponse).default([]),
  guide: guideResponse.nullable().optional(),
});
export const resultResponse = z.object({
  tournamentId: id,
  tournamentEntryId: id,
  finalPlacement: z.number(),
  points: z.number(),
  statistics: z.object({
    kind: z.enum(['HIGH_SCORE', 'RESULT']),
    total: z.number(),
    turns: z.number(),
    bestTurn: z.number(),
    average: z.number(),
  }),
});
export const configResponse = z.object({
  qualifiers: z.number(),
  groupCount: z.number(),
  qualifiersPerGroup: z.number(),
  winPoints: z.number(),
  drawPoints: z.number(),
  lossPoints: z.number(),
  allowDraws: z.boolean(),
  tiePolicy: z.string(),
  tieBreakTurns: z.number(),
  finalScoring: scoringResponse.nullable(),
  playingOrder: z.string(),
  groupAssignments: z.array(z.array(id)).nullable(),
  groupRanking: z.enum(['POINTS_SCORE', 'POINTS_WINS']).nullable().default(null),
  heatCapacity: z.number().nullable().default(null),
  heatStrategy: heatStrategy.default('balanced'),
  x01Entry: x01Entry.default('REMAINING'),
});
export const tournamentResponse = z.object({
  id,
  eventId: id.nullable(),
  name: z.string(),
  mode: tournamentFormat,
  gameMode: gameMode.default('HI_SCORE'),
  recording: recording.default('turns'),
  tracking: tracking.default('FINAL_ONLY'),
  scoringConfiguration: scoringResponse,
  tournamentConfiguration: configResponse,
  status: z.string(),
  currentPhase: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  deletedAt: z.string().nullable().optional(),
  version,
  entries: z.array(entryResponse),
  stages: z.array(stageResponse),
  groups: z.array(groupResponse),
  matches: z.array(matchResponse),
  results: z.array(resultResponse),
});
export const tournamentSummary = tournamentResponse.omit({
  entries: true,
  stages: true,
  groups: true,
  matches: true,
  results: true,
});
export const standingResponse = z.object({
  tournamentEntryId: id,
  placement: z.number(),
  tied: z.boolean(),
  total: z.number(),
  bestTurn: z.number(),
  average: z.number(),
  turns: z.number(),
  gapToLeader: z.number(),
  progression: z.array(z.number()),
  played: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  points: z.number(),
  scored: z.number(),
  conceded: z.number(),
  difference: z.number(),
  criteria: z.array(z.number()),
  recorded: z.boolean(),
  withdrawn: z.boolean(),
  bestScore: z.number(),
  averageScore: z.number(),
});
export const standingsResponse = z.array(
  z.object({
    stageId: id,
    stageKind: z.string(),
    stageStatus: z.string(),
    targetId: id,
    groupName: z.string().nullable(),
    rows: z.array(standingResponse),
  }),
);
export const turnStateResponse = z.object({
  matchId: id,
  matchStatus: z.string(),
  currentTurn: turnResponse.nullable(),
  nextTurn: turnResponse.nullable(),
  turnsRemaining: z.number(),
  completedEntryIds: z.array(id),
});
export const liveMatchResponse = matchResponse.extend({
  tournamentVersion: version,
  gameMode,
  recording,
  /** Players of the match who withdrew from its phase. */
  excludedEntryIds: z.array(id),
  turnState: turnStateResponse,
  tracking,
  /** What a progressive value means for this game, and its bounds per round. */
  trackingSpec: z.object({
    kind: z.enum(['points', 'remaining', 'progress']),
    rounds: z.number().nullable(),
    computed: z.enum(['sum', 'start-minus-sum', 'last']),
    label: z.string(),
    /** Highest value of rounds 1, 2, … (open-ended games: the same for every round). */
    max: z.array(z.number()),
  }),
  /** Heat capacity on the totem for this tournament. */
  heatCapacity: z.number(),
  heatOverview: z.object({
    heats: z.array(
      z.object({
        heatId: id,
        number: z.number(),
        status: z.string(),
        entryIds: z.array(id),
        missing: z.array(id),
      }),
    ),
    currentHeatId: id.nullable(),
    nextHeatId: id.nullable(),
    completed: z.number(),
    waiting: z.array(id),
  }),
  progress: z.array(
    z.object({
      tournamentEntryId: id,
      rounds: z.array(
        z.object({
          round: z.number(),
          status: z.enum(['recorded', 'skipped', 'missing']),
          value: z.number().nullable(),
          bust: z.boolean().default(false),
          playerId: id.nullable(),
          corrected: z.boolean(),
          recordId: id.nullable(),
          state: z.enum([
            'complete',
            'early',
            'partial',
            'skipped',
            'review',
            'reenter',
            'missing',
          ]),
          darts: z.array(dartThrow).nullable(),
          dartsValue: z.number().nullable(),
        }),
      ),
      recorded: z.number(),
      missing: z.array(z.number()),
      skipped: z.array(z.number()),
      complete: z.boolean(),
      partialValue: z.number().nullable(),
      computed: z.number().nullable(),
      best: z.number().nullable(),
      average: z.number().nullable(),
      official: z.number().nullable(),
    }),
  ),
  /** Turn coordinator: one plan per heat, or one for a match played in one session. */
  turnPlans: z.array(
    z.object({
      heatId: id.nullable(),
      heatNumber: z.number().nullable(),
      seats: z.array(id),
      rounds: z.number().nullable(),
      state: z.enum(['ready', 'in_progress', 'paused', 'interrupted', 'completed']),
      current: turnSlot.extend({ playerId: id.nullable() }).nullable(),
      next: turnSlot.extend({ playerId: id.nullable() }).nullable(),
      round: z.number(),
      thrown: z.number(),
      expected: z.number().nullable(),
      undoable: turnSlot.nullable(),
      closed: z.array(turnSlot),
      gaps: z.array(turnSlot),
      shanghai: turnSlot.nullable(),
      before: z.number().nullable(),
    }),
  ),
  rotationViews: z.array(
    z.object({
      entryId: id,
      order: z.array(id),
      current: id.nullable(),
      next: id.nullable(),
      paused: z.boolean(),
      canUndo: z.boolean(),
    }),
  ),
  scoreboard: z.array(
    z.object({
      tournamentEntryId: id,
      total: z.number(),
      turns: z.number(),
      bestTurn: z.number(),
      average: z.number(),
      progression: z.array(z.number()),
    }),
  ),
});
export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});
export const auditResponse = z.object({
  id,
  tournamentId: id.nullable(),
  matchId: id.nullable(),
  scoreId: id.nullable(),
  type: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  operator: z.string(),
  createdAt: z.string(),
});
export const notificationResponse = z.object({
  sequence: z.number(),
  id,
  tournamentId: id,
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
const tally = {
  matchesPlayed: z.number(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  /** Wins / matches played, null before the first match. */
  winRate: z.number().nullable(),
};
export const statisticsResponse = z.object({
  playerId: id,
  tournamentsPlayed: z.number(),
  tournamentsWon: z.number(),
  finalsReached: z.number(),
  bestPlacement: z.number().nullable(),
  ...tally,
  /** One row per game (Hi-Score also per number of rounds): scores are never mixed. */
  byGameMode: z.array(
    z.object({
      gameMode,
      /** Hi-Score parameters of the totals (legacy data may differ from the totem's 7 × 3). */
      rounds: z.number().nullable(),
      dartsPerTurn: z.number().nullable(),
      tournamentsPlayed: z.number(),
      tournamentsWon: z.number(),
      ...tally,
      /** Hi-Score only: final totals. */
      scoredMatches: z.number(),
      bestScore: z.number().nullable(),
      averageScore: z.number().nullable(),
    }),
  ),
  placements: z.array(
    z.object({
      tournamentId: id,
      name: z.string(),
      gameMode,
      format: tournamentFormat,
      placement: z.number(),
      players: z.number(),
      completedAt: z.string().nullable(),
    }),
  ),
  recentMatches: z.array(
    z.object({
      matchId: id,
      tournamentId: id,
      tournamentName: z.string(),
      gameMode,
      matchType: z.string(),
      completedAt: z.string().nullable(),
      outcome: z.string(),
      score: z.number().nullable(),
      opponents: z.array(z.string()),
    }),
  ),
});
export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), limit: z.number(), offset: z.number() });
