export type TournamentStatus =
  'draft' | 'registration' | 'ready' | 'active' | 'paused' | 'completed' | 'cancelled';
export type MatchStatus = 'scheduled' | 'ready' | 'active' | 'paused' | 'completed' | 'cancelled';
/** The eight games of the Pub Time Darts totem (1987). The totem plays them; the app records. */
export type GameMode =
  | '301'
  | '301_DOUBLE_IN_OUT'
  | '501'
  | 'HI_SCORE'
  | '301_MASTERS'
  | 'EXACTA'
  | 'ODD_EVEN'
  | 'SHANGHAI';
/** How the tournament is organized, independently of the game played on the totem. */
export type TournamentFormat = 'QUICK_HIGH_SCORE' | 'GROUPS' | 'SINGLE_MATCH';
/**
 * `result`: the organizer records the final result shown by the totem (default).
 * `turns`: legacy turn-by-turn Hi-Score entry, kept for data created before results existed.
 */
export type Recording = 'result' | 'turns';
/**
 * Progressive tracking next to the official final result (recording `result` only).
 * FINAL_ONLY: only the final result shown by the totem. ROUND_BY_ROUND: every round is recorded
 * (or explicitly skipped) before an entry's final result. FLEXIBLE: rounds are optional.
 */
export type Tracking = 'FINAL_ONLY' | 'ROUND_BY_ROUND' | 'FLEXIBLE';
/** How entries are spread over the physical heats of a match. */
export type HeatStrategy = 'sequential' | 'random' | 'balanced';
export interface Player {
  id: string;
  displayName: string;
  nickname: string | null;
  /** Preset avatar key chosen by the organizer; null shows the initials. */
  avatar: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}
export interface PubEvent {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}
export interface HighScoreConfiguration {
  kind: 'HIGH_SCORE';
  turns: number;
  dartsPerTurn: number;
  maxDartScore: number;
  maxTurnScore: number;
}
export interface TournamentConfiguration {
  qualifiers: number;
  groupCount: number;
  qualifiersPerGroup: number;
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  allowDraws: boolean;
  tiePolicy: 'PLAYOFF' | 'BEST_TURN_THEN_PLAYOFF';
  tieBreakTurns: number;
  finalScoring: HighScoreConfiguration | null;
  playingOrder: 'registration' | 'seed';
  groupAssignments: string[][] | null;
  /**
   * Group ranking chain after points. POINTS_SCORE: difference, scored (Hi-Score only, where
   * points are comparable). POINTS_WINS: wins. Both end with head-to-head and playoffs.
   * null picks the default of the game.
   */
  groupRanking: 'POINTS_SCORE' | 'POINTS_WINS' | null;
  /** Seats of one heat on the totem; null uses the game's maximum (see games). */
  heatCapacity: number | null;
  heatStrategy: HeatStrategy;
  /** X01 progressive values: points scored in the turn, or points left after it. */
  x01Entry: 'SCORED' | 'REMAINING';
}
/** A person inside a competitive unit, with the name shown when the unit was composed. */
export interface EntryMember {
  playerId: string;
  displayName: string;
}
/**
 * CompetitionEntry: the competitive unit of a tournament, a single player or a team. Matches,
 * standings and results only know entries; a team occupies one seat on the totem.
 */
export interface TournamentEntry {
  id: string;
  tournamentId: string;
  /** First member: kept for stored data, the API and the one-entry-per-player constraint. */
  playerId: string;
  /** Team name, or the player's name for a single. */
  displayNameAtRegistration: string;
  kind: 'single' | 'team';
  /** Explicit team name; null for singles and unnamed teams. */
  name: string | null;
  /** Members in throwing order (one for a single). */
  members: EntryMember[];
  seed: number | null;
  status: 'registered' | 'qualified' | 'eliminated' | 'winner' | 'withdrawn';
  registeredAt: string;
}
export interface Stage {
  id: string;
  tournamentId: string;
  kind: string;
  ordering: number;
  status: 'open' | 'finalized' | 'invalidated';
  qualifiedEntryIds: string[];
  excludedEntryIds: string[];
  createdAt: string;
  finalizedAt: string | null;
}
export interface Group {
  id: string;
  stageId: string;
  name: string;
  ordering: number;
  status: 'active' | 'completed' | 'invalidated';
  entryIds: string[];
}
export interface MatchParticipant {
  matchId: string;
  tournamentEntryId: string;
  playingOrder: number;
  finalScore: number | null;
  placement: number | null;
  outcome: 'pending' | 'win' | 'draw' | 'loss';
}
export interface Turn {
  id: string;
  matchId: string;
  participantId: string;
  turnNumber: number;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
}
export interface ScoreEntry {
  id: string;
  matchId: string;
  tournamentEntryId: string;
  turnId: string;
  score: number;
  dartIndex: number | null;
  source: 'manual';
  createdAt: string;
  recordedBy: string;
  voided: boolean;
}
export type HeatStatus = 'pending' | 'ready' | 'active' | 'completed' | 'cancelled';
/**
 * A physical session on the totem holding some entries of a match. It is only a container:
 * the match (e.g. a whole qualification) decides the ranking, never the heat.
 */
export interface Heat {
  id: string;
  matchId: string;
  /** Position in the evening's order, from 1. */
  number: number;
  /** Seats on the totem, in throwing order. */
  entryIds: string[];
  /** Optional physical positions (1-based, increasing), aligned with entryIds. Omitted = contiguous. */
  slotPositions?: number[];
  /** pending: editable. ready: confirmed, kept by reshuffles. active: at the board. */
  status: HeatStatus;
  startedAt: string | null;
  completedAt: string | null;
}
/** What a progressive value means: points of the round, points left (X01), number reached. */
export type RoundValueKind = 'points' | 'remaining' | 'progress';
/**
 * Where one dart landed, as observed. `miss` is a dart off the board (zero points); `unobserved`
 * is a dart nobody saw, which is never zero. Darts left unused because the turn ended early are
 * not recorded at all.
 */
export type DartKind = 'single' | 'double' | 'triple' | 'bull25' | 'bull50' | 'miss' | 'unobserved';
/** One dart of a turn, in throwing order. The points it is worth follow from the game rules. */
export interface DartThrow {
  kind: DartKind;
  /** 1–20 for single, double and triple; null otherwise. */
  sector: number | null;
}
/**
 * One observation of a round, as entered by the organizer. Never official: the final result
 * shown by the totem is. `recorded` and `skipped` (explicitly not observed) are effective;
 * `corrected` was replaced by the record pointing to it, `voided` was annulled.
 */
export interface RoundRecord {
  id: string;
  matchId: string;
  tournamentEntryId: string;
  round: number;
  /** Team member who threw, when tracked. */
  playerId: string | null;
  value: number | null;
  /** X01 bust: this turn contributes no points to the running total. */
  bust: boolean;
  kind: RoundValueKind;
  status: 'recorded' | 'skipped' | 'corrected' | 'voided';
  correctsId: string | null;
  reason: string | null;
  source: 'manual';
  createdAt: string;
  recordedBy: string;
  /**
   * The darts of the turn, when they were entered one by one (up to three, fewer when the turn
   * ended early). Absent or null: only the value was entered, the darts stay unknown.
   */
  darts?: DartThrow[] | null;
}
/** A turn of the match: an entry's round. */
export interface TurnSlot {
  entryId: string;
  round: number;
}
/**
 * The organizer's choices for the turn coordinator. Everything else (who throws, which round)
 * follows from the rounds recorded, so the position survives a reload or another device.
 */
export interface TurnGuide {
  /** Turn chosen by hand: proposed until a value is recorded for it. */
  pick: TurnSlot | null;
  /** Turns taken back with "undo", proposed again in throwing order before going on. */
  replay: TurnSlot[];
  /** Free mode: after a confirmation the organizer chooses who throws. */
  paused: boolean;
}
/** Optional throwing rotation inside a team. Advancing it never records a score. */
export interface Rotation {
  entryId: string;
  /** Player ids in throwing order. */
  order: string[];
  /** Index in `order` of the expected thrower. */
  position: number;
  paused: boolean;
  /** Previous positions, for undo. */
  history: number[];
}
/** An official result that differs from the complete progressive total, kept with its reason. */
export interface Reconciliation {
  entryId: string;
  computed: number;
  official: number;
  reason: string;
  recordedAt: string;
  recordedBy: string;
}
/** Final result of a match as shown by the totem, entered by the organizer. */
export interface MatchResult {
  /** Final score per tournament entry: Hi-Score total, X01 points left, Exacta total… */
  scores: Record<string, number | null>;
  /** Winner declared by the organizer; null when the scores decide (or nobody won yet). */
  declaredWinnerEntryId: string | null;
  /** Exacta: target drawn by the totem (250–350), when noted. */
  targetScore: number | null;
  /** Shanghai: won with single, double and triple of the round number. */
  special: 'SHANGHAI' | null;
  /** Awarded because the opponent withdrew. */
  walkover: boolean;
  /** Playoff replaced by an explicit organizer decision: tied entries, best first. */
  decision: { order: string[]; reason: string } | null;
  notes: string | null;
  /** Official values confirmed against different progressive totals. */
  reconciliation: Reconciliation[];
  recordedAt: string;
  updatedAt: string;
  recordedBy: string;
}
export interface Match {
  id: string;
  tournamentId: string;
  stageId: string;
  groupId: string | null;
  matchType: 'qualification' | 'group' | 'knockout' | 'final' | 'tiebreak';
  status: MatchStatus;
  sequence: number;
  scheduleRound: number;
  startedAt: string | null;
  completedAt: string | null;
  version: number;
  scoringConfiguration: HighScoreConfiguration;
  participants: MatchParticipant[];
  turns: Turn[];
  scores: ScoreEntry[];
  tieTarget: string | null;
  winnerEntryId: string | null;
  /** Final result (recording `result`); null until the first value is entered. */
  result: MatchResult | null;
  /** Physical heats; empty when the whole match is played in one session. */
  heats: Heat[];
  /** Progressive observations (tracking ROUND_BY_ROUND or FLEXIBLE). */
  rounds: RoundRecord[];
  rotations: Rotation[];
  /** Manual choices of the turn coordinator; absent until the first one. */
  guide?: TurnGuide | null;
}
export interface TournamentResult {
  tournamentId: string;
  tournamentEntryId: string;
  finalPlacement: number;
  points: number;
  statistics: {
    /** HIGH_SCORE: turn statistics (legacy). RESULT: `total` is the last final score. */
    kind: 'HIGH_SCORE' | 'RESULT';
    total: number;
    turns: number;
    bestTurn: number;
    average: number;
  };
}
export interface Tournament {
  id: string;
  eventId: string | null;
  name: string;
  /** The tournament format (field name kept for stored data and the API). */
  mode: TournamentFormat;
  gameMode: GameMode;
  recording: Recording;
  tracking: Tracking;
  /** Hi-Score parameters: rounds bound the final score; legacy turn entry uses all of them. */
  scoringConfiguration: HighScoreConfiguration;
  tournamentConfiguration: TournamentConfiguration;
  status: TournamentStatus;
  currentPhase: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Set when an admin removes the tournament: it leaves every list and statistic, and can be restored. */
  deletedAt?: string | null;
  version: number;
  entries: TournamentEntry[];
  stages: Stage[];
  groups: Group[];
  matches: Match[];
  results: TournamentResult[];
}
export interface Operation {
  id: string;
  tournamentId: string | null;
  matchId: string | null;
  scoreId: string | null;
  type: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  operator: string;
  createdAt: string;
}
export interface ApplicationEvent {
  id: string;
  tournamentId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface Context {
  id(): string;
  now(): string;
  operator: string;
  role: 'organizer' | 'spectator';
  /** Uniform [0, 1) source for random compositions; Math.random when absent. */
  random?(): number;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  code: string,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
