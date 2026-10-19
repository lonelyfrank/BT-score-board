import {
  ensure,
  type Context,
  type Player,
  type Tournament,
  type TournamentEntry,
} from '../model.js';
import { MAX_ENTRIES, MAX_TEAM_MEMBERS } from './teams.js';

/** Player ids of an entry, in throwing order. */
export const memberIds = (e: TournamentEntry) => e.members.map((m) => m.playerId);
/** The entry a player belongs to in this tournament, if any. */
export const entryForPlayer = (t: Tournament, playerId: string) =>
  t.entries.find((e) => e.members.some((m) => m.playerId === playerId));
/** Name shown for a unit: its own name, or its members joined ("Frank + Marco"). */
export const unitName = (name: string | null, members: { displayName: string }[]) =>
  name?.trim() || members.map((m) => m.displayName).join(' + ');

export interface ComposeInput {
  /** Units in order (the order is the seed). One player = a single, more = a team. */
  entries: { playerIds: string[]; name?: string | null }[];
}

/**
 * Replaces the registrations with an explicit composition, before the start, in one step: either
 * every unit is valid or nothing changes. Ids (and seeds) of units whose first player is unchanged
 * are kept, so group assignments that still match stay valid.
 */
export function composeEntries(
  t: Tournament,
  input: ComposeInput,
  player: (id: string) => Player,
  c: Context,
) {
  ensure(
    ['draft', 'registration', 'ready'].includes(t.status),
    'REGISTRATION_CLOSED',
    'Units can be composed only before the start',
  );
  ensure(input.entries.length <= MAX_ENTRIES, 'PLAYER_LIMIT', `Maximum ${MAX_ENTRIES} units`, 422);
  const all = input.entries.flatMap((e) => e.playerIds);
  ensure(
    new Set(all).size === all.length,
    'DUPLICATE_ENTRY',
    'A player can belong to one unit only',
    422,
  );
  ensure(
    input.entries.every((e) => e.playerIds.length >= 1 && e.playerIds.length <= MAX_TEAM_MEMBERS),
    'INVALID_TEAMS',
    `Each unit holds 1 to ${MAX_TEAM_MEMBERS} players`,
    422,
  );
  const previous = new Map(t.entries.map((e) => [e.playerId, e]));
  const now = c.now();
  const entries: TournamentEntry[] = input.entries.map((unit, index) => {
    const members = unit.playerIds.map((id) => {
      const p = player(id);
      ensure(p.status === 'active', 'INACTIVE_PLAYER', 'Inactive player cannot register');
      return { playerId: p.id, displayName: p.displayName };
    });
    const name = unit.playerIds.length > 1 ? unit.name?.trim() || null : null;
    const old = previous.get(members[0]!.playerId);
    return {
      id: old?.id ?? c.id(),
      tournamentId: t.id,
      playerId: members[0]!.playerId,
      displayNameAtRegistration: unitName(name, members),
      kind: members.length > 1 ? 'team' : 'single',
      name,
      members,
      seed: index + 1,
      status: 'registered',
      registeredAt: old?.registeredAt ?? now,
    };
  });
  t.entries = entries;
  const ids = new Set(entries.map((e) => e.id));
  const assignments = t.tournamentConfiguration.groupAssignments;
  if (assignments) {
    const kept = assignments.map((g) => g.filter((id) => ids.has(id)));
    // A new unit has no group yet: the automatic distribution takes over.
    t.tournamentConfiguration.groupAssignments =
      kept.flat().length === entries.length ? kept : null;
  }
  if (t.status === 'draft') t.status = 'registration';
  if (t.status === 'ready') t.status = 'registration';
}
