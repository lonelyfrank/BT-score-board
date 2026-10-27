import { api } from './api';
import type { LiveState } from '../../../worker/src/live.js';

/** The same state the live channel sends, read over plain requests (the fallback poll). */
export async function fetchLiveState(tournamentId: string): Promise<LiveState | null> {
  const tournament = await api.tournament(tournamentId);
  const current =
    tournament.matches.find((m) => m.status === 'active' || m.status === 'paused') ??
    tournament.matches.find((m) => m.status === 'ready');
  return {
    type: 'state',
    version: tournament.version,
    revision: 0,
    sentAt: Date.now(),
    tournament,
    match: current ? await api.match(current.id) : null,
  };
}
