import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  ApplicationEvent,
  Operation,
  Player,
  PubEvent,
  Tournament,
  TournamentEntry,
  Stage,
  Group,
  Match,
  MatchParticipant,
  Turn,
  ScoreEntry,
  TournamentResult,
} from '../../../domain/src/index.js';
export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  nickname: text('nickname'),
  status: text('status').notNull(),
  data: text('data', { mode: 'json' }).$type<Player>().notNull(),
});
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  data: text('data', { mode: 'json' }).$type<PubEvent>().notNull(),
});
export const tournaments = sqliteTable('tournaments', {
  id: text('id').primaryKey(),
  eventId: text('event_id').references(() => events.id),
  name: text('name').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  data: text('data', { mode: 'json' }).$type<Tournament>().notNull(),
});
export const entries = sqliteTable(
  'tournament_entries',
  {
    id: text('id').primaryKey(),
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    seed: integer('seed'),
    data: text('data', { mode: 'json' }).$type<TournamentEntry>().notNull(),
  },
  (t) => [uniqueIndex('entries_player_unique').on(t.tournamentId, t.playerId)],
);
export const stages = sqliteTable('stages', {
  id: text('id').primaryKey(),
  tournamentId: text('tournament_id')
    .notNull()
    .references(() => tournaments.id),
  ordering: integer('ordering').notNull(),
  status: text('status').notNull(),
  data: text('data', { mode: 'json' }).$type<Stage>().notNull(),
});
export const groups = sqliteTable('competition_groups', {
  id: text('id').primaryKey(),
  stageId: text('stage_id')
    .notNull()
    .references(() => stages.id),
  data: text('data', { mode: 'json' }).$type<Group>().notNull(),
});
export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  tournamentId: text('tournament_id')
    .notNull()
    .references(() => tournaments.id),
  stageId: text('stage_id')
    .notNull()
    .references(() => stages.id),
  groupId: text('group_id').references(() => groups.id),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  data: text('data', { mode: 'json' })
    .$type<Omit<Match, 'participants' | 'turns' | 'scores'>>()
    .notNull(),
});
export const participants = sqliteTable(
  'match_participants',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    tournamentId: text('tournament_id').notNull(),
    playingOrder: integer('playing_order').notNull(),
    data: text('data', { mode: 'json' }).$type<MatchParticipant>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.entryId] })],
);
export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matches.id),
  entryId: text('entry_id')
    .notNull()
    .references(() => entries.id),
  turnNumber: integer('turn_number').notNull(),
  status: text('status').notNull(),
  data: text('data', { mode: 'json' }).$type<Turn>().notNull(),
});
export const scores = sqliteTable('score_entries', {
  id: text('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matches.id),
  entryId: text('entry_id')
    .notNull()
    .references(() => entries.id),
  turnId: text('turn_id')
    .notNull()
    .references(() => turns.id),
  score: integer('score').notNull(),
  dartIndex: integer('dart_index'),
  voided: integer('voided', { mode: 'boolean' }).notNull(),
  data: text('data', { mode: 'json' }).$type<ScoreEntry>().notNull(),
});
export const results = sqliteTable(
  'tournament_results',
  {
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id),
    placement: integer('placement').notNull(),
    data: text('data', { mode: 'json' }).$type<TournamentResult>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.entryId] })],
);
export const auditLog = sqliteTable('audit_log', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  tournamentId: text('tournament_id').references(() => tournaments.id),
  data: text('data', { mode: 'json' }).$type<Operation>().notNull(),
});
export const outbox = sqliteTable('application_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  tournamentId: text('tournament_id')
    .notNull()
    .references(() => tournaments.id),
  data: text('data', { mode: 'json' }).$type<ApplicationEvent>().notNull(),
});
export const idempotency = sqliteTable('idempotency', {
  key: text('key').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  response: text('response', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
});
