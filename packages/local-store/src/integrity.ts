import { DomainError, assertDarts, gameModes, type Tournament } from '../../domain/src/index.js';

// Mirrors the SQLite constraints (0001.ts): the domain already enforces these rules, the
// local store re-checks them so a defect can never be persisted silently on the device.
export function assertTournamentIntegrity(
  t: Tournament,
  hasPlayer: (id: string) => boolean,
  hasEvent: (id: string) => boolean,
) {
  const fail = (detail: string): never => {
    throw new DomainError(
      'INTEGRITY_CONFLICT',
      `The operation conflicts with persisted data (${detail})`,
      409,
    );
  };
  if (!Number.isSafeInteger(t.version) || t.version < 0) fail('tournament version');
  if (!gameModes.includes(t.gameMode) || !['result', 'turns'].includes(t.recording)) fail('game');
  if (!['FINAL_ONLY', 'ROUND_BY_ROUND', 'FLEXIBLE'].includes(t.tracking)) fail('tracking');
  if (t.eventId !== null && !hasEvent(t.eventId)) fail('event reference');
  const entries = new Set<string>(),
    players = new Set<string>(),
    seeds = new Set<number>();
  const members = new Map<string, string[]>();
  for (const e of t.entries) {
    if (e.tournamentId !== t.id || entries.has(e.id)) fail('entry');
    // A player belongs to one competitive unit; the first member is the entry's player.
    if (!e.members.length || e.members.length > 8 || e.members[0]!.playerId !== e.playerId)
      fail('entry members');
    if ((e.kind === 'team') !== e.members.length > 1) fail('entry kind');
    for (const m of e.members) {
      if (players.has(m.playerId)) fail('player in two entries');
      if (!hasPlayer(m.playerId)) fail('player reference');
      players.add(m.playerId);
    }
    if (e.seed !== null && (e.seed <= 0 || seeds.has(e.seed))) fail('seed');
    entries.add(e.id);
    members.set(
      e.id,
      e.members.map((m) => m.playerId),
    );
    if (e.seed !== null) seeds.add(e.seed);
  }
  const stages = new Set<string>(),
    orderings = new Set<number>();
  for (const s of t.stages) {
    if (s.tournamentId !== t.id || stages.has(s.id) || s.ordering <= 0 || orderings.has(s.ordering))
      fail('stage');
    stages.add(s.id);
    orderings.add(s.ordering);
  }
  const groups = new Map(t.groups.map((g) => [g.id, g.stageId]));
  for (const g of t.groups) if (!stages.has(g.stageId)) fail('group stage');
  const matches = new Set<string>();
  for (const m of t.matches) {
    if (m.tournamentId !== t.id || matches.has(m.id) || !stages.has(m.stageId)) fail('match');
    if (m.groupId !== null && groups.get(m.groupId) !== m.stageId) fail('match group');
    if (!Number.isSafeInteger(m.version) || m.version < 0) fail('match version');
    matches.add(m.id);
    const participants = new Set<string>(),
      orders = new Set<number>();
    for (const p of m.participants) {
      if (p.matchId !== m.id || !entries.has(p.tournamentEntryId)) fail('participant');
      if (
        participants.has(p.tournamentEntryId) ||
        p.playingOrder <= 0 ||
        orders.has(p.playingOrder)
      )
        fail('participant order');
      participants.add(p.tournamentEntryId);
      orders.add(p.playingOrder);
    }
    if (m.winnerEntryId !== null && !participants.has(m.winnerEntryId)) fail('match winner');
    if (m.result) {
      const r = m.result;
      for (const [entry, value] of Object.entries(r.scores))
        if (
          !participants.has(entry) ||
          (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 12000))
        )
          fail('result score');
      if (r.declaredWinnerEntryId !== null && !participants.has(r.declaredWinnerEntryId))
        fail('result winner');
      if (r.decision && !r.decision.order.every((id) => participants.has(id)))
        fail('result decision');
    }
    // Heats: containers of the match's entries, each entry in at most one live heat.
    const seated = new Set<string>(),
      heatIds = new Set<string>();
    for (const h of m.heats) {
      if (h.matchId !== m.id || heatIds.has(h.id) || h.number <= 0) fail('heat');
      if (!['pending', 'ready', 'active', 'completed', 'cancelled'].includes(h.status))
        fail('heat status');
      heatIds.add(h.id);
      for (const id of h.entryIds) {
        if (!participants.has(id)) fail('heat entry');
        if (h.status !== 'cancelled' && seated.has(id)) fail('entry in two heats');
        if (h.status !== 'cancelled') seated.add(id);
      }
    }
    if (m.heats.filter((h) => h.status === 'active').length > 1) fail('two active heats');
    const roundIds = new Set<string>(),
      roundSlots = new Set<string>();
    for (const r of m.rounds) {
      if (r.matchId !== m.id || roundIds.has(r.id) || !participants.has(r.tournamentEntryId))
        fail('round');
      if (!Number.isInteger(r.round) || r.round <= 0) fail('round number');
      if (r.value !== null && (!Number.isSafeInteger(r.value) || r.value < 0 || r.value > 12000))
        fail('round value');
      if (typeof r.bust !== 'boolean') fail('round bust');
      if (r.playerId !== null && !members.get(r.tournamentEntryId)?.includes(r.playerId))
        fail('round player');
      if (r.darts)
        try {
          assertDarts(r.darts);
        } catch {
          fail('round darts');
        }
      roundIds.add(r.id);
      if (r.status !== 'recorded' && r.status !== 'skipped') continue;
      const slot = `${r.tournamentEntryId}:${r.round}`;
      if (roundSlots.has(slot)) fail('duplicate round');
      roundSlots.add(slot);
    }
    const guide = m.guide;
    if (
      guide &&
      [guide.pick, ...guide.replay].some(
        (slot) =>
          slot !== null &&
          (!participants.has(slot.entryId) || !Number.isInteger(slot.round) || slot.round <= 0),
      )
    )
      fail('turn guide');
    for (const r of m.rotations) {
      const team = members.get(r.entryId);
      if (
        !participants.has(r.entryId) ||
        !team ||
        r.order.length !== team.length ||
        !r.order.every((id) => team.includes(id)) ||
        r.position < 0 ||
        r.position >= r.order.length
      )
        fail('rotation');
    }
    const turns = new Map<string, string>(),
      turnSlots = new Set<string>();
    for (const turn of m.turns) {
      const slot = `${turn.participantId}:${turn.turnNumber}`;
      if (turn.matchId !== m.id || turns.has(turn.id) || turnSlots.has(slot)) fail('turn');
      if (!participants.has(turn.participantId) || turn.turnNumber <= 0) fail('turn participant');
      turns.set(turn.id, turn.participantId);
      turnSlots.add(slot);
    }
    const scoreIds = new Set<string>(),
      scoreSlots = new Set<string>(),
      totalTurns = new Set<string>(),
      dartTurns = new Set<string>();
    for (const score of m.scores) {
      if (score.matchId !== m.id || scoreIds.has(score.id)) fail('score');
      if (turns.get(score.turnId) !== score.tournamentEntryId) fail('score turn');
      if (!Number.isSafeInteger(score.score) || score.score < 0 || score.score > 12000)
        fail('score value');
      if (score.dartIndex !== null && (score.dartIndex < 1 || score.dartIndex > 12)) fail('dart');
      scoreIds.add(score.id);
      if (score.voided) continue;
      const slot = `${score.turnId}:${score.dartIndex ?? 0}`;
      if (scoreSlots.has(slot)) fail('duplicate score slot');
      scoreSlots.add(slot);
      (score.dartIndex === null ? totalTurns : dartTurns).add(score.turnId);
      if (totalTurns.has(score.turnId) && dartTurns.has(score.turnId)) fail('score input mode');
    }
  }
  const results = new Set<string>();
  for (const r of t.results) {
    if (r.tournamentId !== t.id || !entries.has(r.tournamentEntryId)) fail('result');
    if (results.has(r.tournamentEntryId) || r.finalPlacement <= 0) fail('result placement');
    results.add(r.tournamentEntryId);
  }
}
