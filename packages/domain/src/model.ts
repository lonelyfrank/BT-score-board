export type TournamentStatus =
  'draft' | 'registration' | 'ready' | 'active' | 'paused' | 'completed' | 'cancelled';
export type MatchStatus = 'scheduled' | 'ready' | 'active' | 'paused' | 'completed' | 'cancelled';
export interface Player {
  id: string;
  displayName: string;
  nickname: string | null;
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
}
export interface TournamentEntry {
  id: string;
  tournamentId: string;
  playerId: string;
  displayNameAtRegistration: string;
  seed: number | null;
  status: 'registered' | 'qualified' | 'eliminated' | 'winner';
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
}
export interface TournamentResult {
  tournamentId: string;
  tournamentEntryId: string;
  finalPlacement: number;
  points: number;
  statistics: {
    kind: 'HIGH_SCORE';
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
  mode: 'QUICK_HIGH_SCORE' | 'GROUPS';
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
