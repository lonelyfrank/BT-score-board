import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, ChevronUp, Info, Plus, X } from 'lucide-react';
import { api, ApiError, nickname, type Player, type Tournament } from '../services/api';
import {
  HI_SCORE_ROUNDS,
  checkComposition,
  comparableAcrossHeats,
  freeMatchLimits,
  gameModes,
  games,
  heatSizes,
  sideOf,
  syncTeams,
  trackingHints,
  trackingLabels,
  type GameMode,
  type TeamDraft,
  type Tracking,
} from '../services/rules';
import { Avatar, ErrorMessage, Header, Modal, Segmented } from '../components/ui';
import { DartIcon } from '../components/BrandIcons';
import { AddPlayerSheet } from '../components/PlayerSheets';
import { TeamBuilder } from '../components/TeamBuilder';

type Unit = { key: string; label: string; playerIds: string[]; name: string | null };

/**
 * A free match of any totem game. Round-by-round recording is the default; final-only remains
 * available in the advanced options.
 */
export function Setup() {
  const [heatStrategy, setHeatStrategy] = useState<'sequential' | 'balanced' | 'custom'>(
    'sequential',
  );
  const [mode, setMode] = useState<GameMode>('HI_SCORE');
  const [name, setName] = useState('Partita libera');
  const [selected, setSelected] = useState<Player[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [unevenOk, setUnevenOk] = useState(false);
  const [tracking, setTracking] = useState<Tracking>('ROUND_BY_ROUND');
  const [x01Entry, setX01Entry] = useState<'REMAINING' | 'SCORED'>('SCORED');
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<Tournament>();
  const navigate = useNavigate();
  const game = games[mode];
  const { min, max, seats } = freeMatchLimits(mode);
  const byName = (id: string) => selected.find((p) => p.id === id)?.displayName ?? '?';
  // New players join as singles, removed ones leave their team.
  useEffect(() => {
    if (teamMode)
      setTeams((current) =>
        syncTeams(
          current,
          selected.map((p) => p.id),
        ),
      );
  }, [selected, teamMode]);
  const units: Unit[] = teamMode
    ? teams.map((t) => ({
        key: t.key,
        playerIds: t.playerIds,
        name: t.playerIds.length > 1 ? t.name : null,
        label: (t.playerIds.length > 1 && t.name) || t.playerIds.map(byName).join(' + '),
      }))
    : selected.map((p) => ({ key: p.id, playerIds: [p.id], name: null, label: p.displayName }));
  const check = teamMode
    ? checkComposition(
        teams,
        selected.map((p) => p.id),
      )
    : null;
  const uneven = !!check?.warnings.includes('UNEVEN_TEAMS');
  const heats =
    units.length > seats
      ? heatSizes(units.length, seats, heatStrategy === 'custom' ? 'sequential' : heatStrategy)
      : [];
  const unitWord = teamMode ? 'squadre' : 'giocatori';
  const reason = !name.trim()
    ? 'Inserisci un nome per la partita.'
    : units.length < min
      ? min === 1
        ? `Aggiungi almeno ${teamMode ? 'una squadra' : 'un giocatore'}.`
        : `Servono almeno ${min} ${unitWord}.`
      : units.length > max
        ? `${game.label} si gioca al massimo in ${max}: togli ${units.length - max} ${teamMode ? 'squadre' : units.length - max === 1 ? 'giocatore' : 'giocatori'}.`
        : check?.errors.length
          ? 'Ogni giocatore deve stare in una sola squadra.'
          : uneven && !unevenOk
            ? 'Squadre con un numero diverso di giocatori: conferma la composizione.'
            : '';
  const create = useMutation({
    mutationFn: async () => {
      let t = draft
        ? await api.tournament(draft.id)
        : await api.createTournament({
            name: name.trim(),
            mode: 'SINGLE_MATCH',
            gameMode: mode,
            tracking,
            scoringConfiguration: { kind: 'HIGH_SCORE', turns: HI_SCORE_ROUNDS },
            tournamentConfiguration: {
              playingOrder: 'registration',
              x01Entry,
              heatStrategy: heatStrategy === 'custom' ? 'sequential' : heatStrategy,
            },
          });
      setDraft(t);
      // One command composes every unit: all registered, or none.
      if (!t.entries.length)
        t = await api.tournamentCommand(t, 'entries/compose', {
          entries: units.map((u) => ({ playerIds: u.playerIds, name: u.name })),
        });
      if (['draft', 'registration', 'ready'].includes(t.status))
        t = await api.tournamentCommand(t, 'start');
      navigate(`/partite/${t.matches[0]!.id}${heatStrategy === 'custom' ? '?organize=1' : ''}`);
    },
    onSettled: () => setConfirm(false),
  });
  const move = (index: number) => {
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    setSelected(next);
  };
  const locked = !!draft || create.isPending;
  const unlimited = comparableAcrossHeats(mode) || teamMode;
  return (
    <>
      <Header title="Nuova partita" />
      <main className="content setup-page">
        <span className="eyebrow">Gioco del totem</span>
        <div className="mode-grid totem" role="radiogroup" aria-label="Modalità di gioco del totem">
          {gameModes.map((id) => (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={mode === id ? 'selected' : ''}
              disabled={locked}
              onClick={() => setMode(id)}
            >
              <span>
                {id === 'HI_SCORE' && <ChartNoAxesColumnIncreasing size={17} strokeWidth={3} />}
                {games[id].label}
              </span>
              <small>
                {comparableAcrossHeats(id)
                  ? `${games[id].players.max} per manche`
                  : games[id].players.min === games[id].players.max
                    ? `${games[id].players.max} giocatori`
                    : `${games[id].players.min}–${games[id].players.max} giocatori`}
              </small>
            </button>
          ))}
        </div>
        <p className="note">
          <Info aria-hidden="true" />
          {game.rules} Il totem calcola i punti: qui si registra il risultato finale (e, se vuoi, i
          round).
        </p>
        <div className="divider" />
        <fieldset disabled={locked}>
          <label className="field heading-field">
            Nome partita
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <section className="form-section" aria-labelledby="players-title">
            <div className="section-head">
              <h2 id="players-title">
                Giocatori · {selected.length}
                {!unlimited && ` (${min === max ? max : `${min}–${max}`})`}
              </h2>
              <span>Ordine = ordine di tiro</span>
            </div>
            <ol className="order-list">
              {selected.map((p, i) => (
                <li key={p.id}>
                  <span className={`order ${i === 0 ? 'first' : ''}`}>{i + 1}</span>
                  <Avatar name={p.displayName} className={i === 0 ? 'ring selected' : 'ring'} />
                  <span className="order-name">
                    <span>{p.displayName}</span>
                    <small>
                      {[
                        i === 0 && !teamMode ? 'Tira per primo' : '',
                        teamMode ? '' : (sideOf(mode, i + 1) ?? ''),
                        nickname(p),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Anticipa ${p.displayName}`}
                    disabled={i === 0}
                    onClick={() => move(i)}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Rimuovi ${p.displayName}`}
                    onClick={() => setSelected(selected.filter((x) => x.id !== p.id))}
                  >
                    <X size={16} className="accent-soft" />
                  </button>
                </li>
              ))}
              {(unlimited || selected.length < max) && (
                <li className="add-row">
                  <button type="button" onClick={() => setPicker(true)}>
                    <Plus aria-hidden="true" className="accent-icon" />
                    Aggiungi giocatore
                  </button>
                </li>
              )}
            </ol>
          </section>
          <section className="form-section" aria-labelledby="units-title">
            <div className="section-head">
              <h2 id="units-title">Singoli o squadre</h2>
              <span>{teamMode ? `${units.length} squadre` : 'Ognuno per sé'}</span>
            </div>
            <Segmented
              label="Singoli o squadre"
              value={teamMode ? 'teams' : 'singles'}
              change={(v) => {
                setTeamMode(v === 'teams');
                setTeams(
                  v === 'teams'
                    ? syncTeams(
                        [],
                        selected.map((p) => p.id),
                      )
                    : [],
                );
                setUnevenOk(false);
              }}
              options={[
                { id: 'singles', label: 'Singoli' },
                { id: 'teams', label: 'Squadre' },
              ]}
            />
            {teamMode && (
              <>
                <TeamBuilder
                  players={selected}
                  teams={teams}
                  change={(next) => {
                    setTeams(next);
                    setUnevenOk(false);
                  }}
                  disabled={locked}
                />
                <p className="hint">
                  Ogni squadra occupa un solo posto sul totem e tira a rotazione.
                </p>
                {uneven && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={unevenOk}
                      onChange={(e) => setUnevenOk(e.target.checked)}
                    />
                    Squadre disomogenee ({check!.sizes.join(' · ')} giocatori): confermo la
                    composizione
                  </label>
                )}
              </>
            )}
          </section>
          {heats.length > 0 && (
            <section className="form-section" aria-labelledby="heats-title">
              <h2 id="heats-title">Organizza manche</h2>
              <Segmented
                label="Distribuzione nelle manche"
                value={heatStrategy}
                change={setHeatStrategy}
                options={[
                  { id: 'sequential', label: 'Riempimento' },
                  { id: 'balanced', label: 'Bilanciata' },
                  { id: 'custom', label: 'Personalizzata' },
                ]}
              />
              <div className="options padded">
                <div className="settings-row">
                  <span>
                    {heats.length} manche da {seats} posti
                  </span>
                  <strong>{heats.join(' · ')}</strong>
                </div>
              </div>
              <p className="hint">
                Più {unitWord} dei posti del totem: si gioca a manche e conta una classifica unica
                per punteggio. Le manche si possono rivedere dopo l’avvio, prima di giocarle.
              </p>
            </section>
          )}
          <section className="form-section">
            <h2>Regole {game.label}</h2>
            <div className="options">
              {game.startingScore !== null && (
                <div className="settings-row">
                  <span>Punteggio di partenza</span>
                  <strong>{game.startingScore}</strong>
                </div>
              )}
              {game.rounds !== null && (
                <div className="settings-row">
                  <span>{mode === 'SHANGHAI' ? 'Numeri' : 'Round'}</span>
                  <strong>{mode === 'SHANGHAI' ? `1–${game.rounds}` : game.rounds}</strong>
                </div>
              )}
              {game.target && (
                <div className="settings-row">
                  <span>Obiettivo casuale</span>
                  <strong>
                    {game.target.min}–{game.target.max}
                  </strong>
                </div>
              )}
              <div className="settings-row">
                <span>Da registrare</span>
                <strong className="accent-soft">
                  {game.scoreRequired || heats.length ? 'Punteggio finale' : 'Vincitore'}
                </strong>
              </div>
            </div>
            <p className="hint">
              {game.scoreRequired || heats.length
                ? 'Alla fine si inserisce il totale di ogni partecipante mostrato dal totem.'
                : `Alla fine si tocca il vincitore; ${game.scoreLabel.toLowerCase()} facoltativi.`}
            </p>
          </section>
          <details className="advanced">
            <summary>Opzioni avanzate · {trackingLabels[tracking]}</summary>
            <div className="options padded stack">
              <div className="stack-row">
                <span>Registrazione</span>
                <Segmented
                  label="Registrazione"
                  value={tracking}
                  change={setTracking}
                  options={(Object.keys(trackingLabels) as Tracking[]).map((id) => ({
                    id,
                    label: trackingLabels[id],
                  }))}
                />
              </div>
              <p className="hint">{trackingHints[tracking]}</p>
              {game.scoring === 'remaining' && tracking !== 'FINAL_ONLY' && (
                <div className="stack-row">
                  <span>Valore di ogni turno</span>
                  <Segmented
                    label="Valore di ogni turno"
                    value={x01Entry}
                    change={setX01Entry}
                    options={[
                      { id: 'REMAINING', label: 'Punti rimasti' },
                      { id: 'SCORED', label: 'Punti fatti' },
                    ]}
                  />
                </div>
              )}
            </div>
          </details>
        </fieldset>
        <ErrorMessage error={create.error} />
        {create.error && draft && (
          <p>
            <Link to="/tornei">Controlla la partita salvata</Link> prima di crearne una nuova.
          </p>
        )}
        <div className="cta-block">
          <button
            className="primary cta"
            disabled={
              !!reason ||
              create.isPending ||
              (!draft && create.error instanceof ApiError && create.error.uncertain)
            }
            onClick={() => setConfirm(true)}
          >
            <DartIcon className="cta-icon" strokeWidth={2} fill="none" />
            {create.isPending ? 'Avvio…' : draft ? 'Riprendi avvio' : 'INIZIA PARTITA'}
          </button>
          {reason && (
            <p className="form-reason" role="status">
              {reason}
            </p>
          )}
        </div>
        {picker && (
          <AddPlayerSheet
            excluded={selected.map((p) => p.id)}
            remaining={unlimited ? 256 - selected.length : max - selected.length}
            add={(p) => setSelected((current) => [...current, p])}
            close={() => setPicker(false)}
          />
        )}
        {confirm && (
          <Modal
            variant="dialog"
            title={<span className="marker">Pronti al bersaglio?</span>}
            close={() => !create.isPending && setConfirm(false)}
          >
            <p>
              {name.trim()} · {game.label}
              {heats.length > 0 && ` · ${heats.length} manche`}
            </p>
            <ol className="confirm-order">
              {units.slice(0, 12).map((u, i) => (
                <li key={u.key}>
                  <span>{i + 1}</span>
                  {u.label}
                </li>
              ))}
              {units.length > 12 && <li>… e altri {units.length - 12}</li>}
            </ol>
            <p className="hint">
              Imposta {game.label} sul totem con lo stesso ordine. Dopo l’avvio i partecipanti non
              si possono più modificare.
            </p>
            <button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Avvio…' : 'CONFERMA E INIZIA'}
            </button>
            <button disabled={create.isPending} onClick={() => setConfirm(false)}>
              Modifica
            </button>
          </Modal>
        )}
      </main>
    </>
  );
}
