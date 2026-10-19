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
export interface X01Configuration {
  kind: 'X01';
  initialScore: number;
  doubleOut: boolean;
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
}
export interface TournamentEntry {
  id: string;
  tournamentId: string;
  playerId: string;
  displayNameAtRegistration: string;
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
  /** Hi-Score parameters: rounds bound the final score; legacy turn entry uses all of them. */
  scoringConfiguration: HighScoreConfiguration;
  tournamentConfiguration: TournamentConfiguration;
  status: TournamentStatus;
  currentPhase: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
