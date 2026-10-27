import { useState } from 'react';
import { ArrowUpDown, Lock, LockOpen, Shuffle, Split, UserPlus } from 'lucide-react';
import { Segmented, Stepper } from './ui';
import {
  MAX_TEAM_MEMBERS,
  buildTeams,
  checkComposition,
  dissolveTeam,
  movePlayer,
  renameTeam,
  reshuffleTeams,
  reverseTeam,
  setTeamLocked,
  swapPlayers,
  type TeamDraft,
  type TeamStrategy,
} from '../services/rules';

type Named = { id: string; displayName: string };
const vibrate = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* No haptics. */
  }
};

/**
 * Composes the selected players into competitive units: singles, pairs or teams of any size.
 * Two taps swap players (or move one into a team); locked teams survive a reshuffle. Nothing is
 * saved here: the parent confirms the composition with one command.
 */
export function TeamBuilder({
  players,
  teams,
  change,
  disabled = false,
}: {
  players: Named[];
  teams: TeamDraft[];
  change: (teams: TeamDraft[]) => void;
  disabled?: boolean;
}) {
  const [size, setSize] = useState(2);
  const [strategy, setStrategy] = useState<TeamStrategy>('random');
  const [picked, setPicked] = useState<string | null>(null);
  const name = (id: string) => players.find((p) => p.id === id)?.displayName ?? '?';
  const ids = players.map((p) => p.id);
  const check = checkComposition(teams, ids);

  function generate() {
    const locked = teams.filter((t) => t.locked).map((t) => t.playerIds);
    change(buildTeams(ids, { teamSize: size, strategy, locked }));
    setPicked(null);
    vibrate();
  }
  function tap(playerId: string) {
    if (disabled) return;
    if (picked === null) return setPicked(playerId);
    if (picked === playerId) return setPicked(null);
    try {
      change(swapPlayers(teams, picked, playerId));
      vibrate();
    } catch {
      /* A locked team: the swap is refused, the selection stays. */
      return;
    }
    setPicked(null);
  }
  function moveHere(key: string | null) {
    if (picked === null) return;
    try {
      change(movePlayer(teams, picked, key));
      vibrate();
    } catch {
      return;
    }
    setPicked(null);
  }

  return (
    <div className="team-builder">
      <div className="card">
        <Stepper
          label="Giocatori per squadra"
          hint="Le squadre possono restare disomogenee"
          value={size}
          change={setSize}
          min={1}
          max={MAX_TEAM_MEMBERS}
        />
        <div className="stepper-row stack">
          <span>Composizione</span>
          <Segmented
            label="Strategia di composizione"
            small
            value={strategy}
            change={setStrategy}
            options={[
              { id: 'sequential', label: 'In ordine' },
              { id: 'random', label: 'Casuale' },
              { id: 'balanced', label: 'Bilanciata' },
            ]}
          />
        </div>
        <div className="team-actions stepper-row">
          <button type="button" disabled={disabled || !ids.length} onClick={generate}>
            Genera squadre
          </button>
          <button
            type="button"
            disabled={disabled || teams.filter((t) => !t.locked).length < 2}
            onClick={() => {
              change(reshuffleTeams(teams, 'random'));
              setPicked(null);
              vibrate();
            }}
          >
            <Shuffle size={16} aria-hidden="true" /> Rimescola
          </button>
        </div>
      </div>
      <p className="hint" role="status">
        {picked
          ? `${name(picked)} selezionato: tocca un altro giocatore per scambiarli, oppure «Sposta qui» su una squadra.`
          : 'Tocca due giocatori per scambiarli. Il lucchetto conserva una squadra nel rimescolamento.'}
      </p>
      <ol className="team-list">
        {teams.map((team, index) => (
          <li key={team.key} className={team.locked ? 'locked' : ''}>
            <div className="team-head">
              <span className="pos">{index + 1}</span>
              {team.playerIds.length > 1 ? (
                <input
                  aria-label={`Nome della squadra ${index + 1}`}
                  placeholder={team.playerIds.map(name).join(' + ')}
                  maxLength={120}
                  value={team.name ?? ''}
                  disabled={disabled}
                  onChange={(e) => change(renameTeam(teams, team.key, e.target.value))}
                />
              ) : (
                <span className="team-single">Singolo</span>
              )}
              <small>
                {team.playerIds.length} {team.playerIds.length === 1 ? 'giocatore' : 'giocatori'}
              </small>
              <button
                type="button"
                className="mini"
                aria-pressed={team.locked}
                aria-label={team.locked ? 'Sblocca squadra' : 'Blocca squadra'}
                disabled={disabled}
                onClick={() => change(setTeamLocked(teams, team.key, !team.locked))}
              >
                {team.locked ? <Lock size={16} /> : <LockOpen size={16} />}
              </button>
              {team.playerIds.length > 1 && (
                <>
                  <button
                    type="button"
                    className="mini"
                    aria-label="Inverti ordine di tiro"
                    disabled={disabled || team.locked}
                    onClick={() => change(reverseTeam(teams, team.key))}
                  >
                    <ArrowUpDown size={16} />
                  </button>
                  <button
                    type="button"
                    className="mini"
                    aria-label="Sciogli in singoli"
                    disabled={disabled || team.locked}
                    onClick={() => change(dissolveTeam(teams, team.key))}
                  >
                    <Split size={16} />
                  </button>
                </>
              )}
            </div>
            <div
              className="team-members"
              role="group"
              aria-label={`Componenti squadra ${index + 1}`}
            >
              {team.playerIds.map((id, i) => (
                <button
                  type="button"
                  key={id}
                  className="chip"
                  aria-pressed={picked === id}
                  disabled={disabled || team.locked}
                  onClick={() => tap(id)}
                >
                  <small>{i + 1}</small> {name(id)}
                </button>
              ))}
              {picked && !team.playerIds.includes(picked) && !team.locked && (
                <button type="button" className="chip move-here" onClick={() => moveHere(team.key)}>
                  Sposta qui
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {picked && (
        <button type="button" className="btn dashed" onClick={() => moveHere(null)}>
          <UserPlus aria-hidden="true" /> {name(picked)} gioca da singolo
        </button>
      )}
      {check.errors.length > 0 && (
        <p className="form-reason" role="alert">
          Composizione non valida: ogni giocatore deve stare in una sola squadra.
        </p>
      )}
    </div>
  );
}
