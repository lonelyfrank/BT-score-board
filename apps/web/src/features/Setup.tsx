import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronUp, Info, Play, Plus, X } from 'lucide-react';
import { api, ApiError, localData, nickname, type Player, type Tournament } from '../services/api';
import {
  HI_SCORE_ROUNDS,
  checkComposition,
  comparableAcrossHeats,
  freeMatchLimits,
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
import { Avatar, ErrorMessage, Header, Segmented } from '../components/ui';
import { AddPlayerSheet, NewPlayerSheet } from '../components/PlayerSheets';
import { TeamBuilder } from '../components/TeamBuilder';
import {
  BT_CHOICE,
  PlaySpaceStep,
  choiceName,
  choiceReady,
  rememberPlaySpace,
  resolvePlaySpace,
  usePlaySpaces,
  type PlaySpaceChoice,
} from '../components/PlaySpaceStep';

type Unit = { key: string; label: string; playerIds: string[]; name: string | null };

/** The eight games as the organizer picks them: Hi-Score first, then the X01 family. */
export const gameChoices: [GameMode, string][] = [
  ['HI_SCORE', '7 round · totale più alto'],
  ['301', 'chiusura esatta'],
  ['501', 'chiusura esatta'],
  ['301_DOUBLE_IN_OUT', 'apri e chiudi in doppio'],
  ['301_MASTERS', 'chiudi con D, T o centro'],
  ['EXACTA', 'obiettivo 250–350'],
  ['ODD_EVEN', 'dispari contro pari · in 2'],
  ['SHANGHAI', 'numeri in sequenza'],
];
export const shortDate = (d = new Date()) =>
  d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/**
 * A free match of any totem game, in two steps: the game (with how it is recorded), then who
 * goes to the totem in throwing order. Round-by-round recording is the default.
 */
export function Setup() {
  const [params, setParams] = useSearchParams();
  // Without play spaces on offer (shared server) the first step is skipped: there is only one.
  const withSpace = !!localData;
  const total = withSpace ? 3 : 2;
  const step =
    params.get('passo') === 'giocatori'
      ? total
      : params.get('passo') === 'gioco' || !withSpace
        ? total - 1
        : 1;
  const [space, setSpace] = useState<PlaySpaceChoice | null>(withSpace ? null : BT_CHOICE);
  const spaces = usePlaySpaces();
  const [mode, setMode] = useState<GameMode>(
    () => gameChoices.find(([id]) => id === params.get('gioco'))?.[0] ?? 'HI_SCORE',
  );
  const [heatStrategy, setHeatStrategy] = useState<'sequential' | 'balanced' | 'custom'>(
    'sequential',
  );
  const [selected, setSelected] = useState<Player[]>([]);
  const [teamMode, setTeamMode] = useState(false);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [unevenOk, setUnevenOk] = useState(false);
  const [tracking, setTracking] = useState<Tracking>('ROUND_BY_ROUND');
  const [x01Entry, setX01Entry] = useState<'REMAINING' | 'SCORED'>('SCORED');
  const [picker, setPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Tournament>();
  const navigate = useNavigate();
  const game = games[mode];
  const { min, max, seats } = freeMatchLimits(mode);
  const roster = useQuery({
    queryKey: ['players', '', 0, 'active'],
    queryFn: () => api.players('', 0, 'active'),
    enabled: step === 2,
  });
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
  const reason =
    units.length < min
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
            playSpaceId: await resolvePlaySpace(space ?? BT_CHOICE),
            name: `${game.label} · ${shortDate()}`,
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
      rememberPlaySpace(t.playSpaceId ?? '');
      // One command composes every unit: all registered, or none.
      if (!t.entries.length)
        t = await api.tournamentCommand(t, 'entries/compose', {
          entries: units.map((u) => ({ playerIds: u.playerIds, name: u.name })),
        });
      if (['draft', 'registration', 'ready'].includes(t.status))
        t = await api.tournamentCommand(t, 'start');
      navigate(`/partite/${t.matches[0]!.id}${heatStrategy === 'custom' ? '?organize=1' : ''}`, {
        replace: true,
      });
    },
  });
  const move = (index: number) => {
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    setSelected(next);
  };
  const locked = !!draft || create.isPending;
  const unlimited = comparableAcrossHeats(mode) || teamMode;
  const canAdd = (unlimited || selected.length < max) && !locked;
  // Steps counted from the one on top: punto (when offered), gioco, giocatori.
  const toStep = (n: number) =>
    setParams(
      n === total
        ? { passo: 'giocatori', gioco: mode }
        : n === total - 1 && withSpace
          ? { passo: 'gioco', gioco: mode }
          : { gioco: mode },
    );
  const spaceName = choiceName(space, spaces.data ?? []);
  const pool = (roster.data?.items ?? []).filter((p) => !selected.some((x) => x.id === p.id));

  if (withSpace && step === 1)
    return (
      <>
        <Header title="Nuova partita" subtitle="Passo 1 di 3 · Dove giocate" back={null} />
        <div className="toolbar">
          <div className="wz-prog three" aria-hidden="true">
            <i className="on" />
            <i />
            <i />
          </div>
        </div>
        <main className="setup setup-space">
          <PlaySpaceStep value={space} change={setSpace} />
          {space?.kind === 'existing' && choiceReady(space) && (
            <p className="note" role="status">
              <Info aria-hidden="true" />
              <span>I risultati saranno conteggiati nella scoreboard {spaceName}.</span>
            </p>
          )}
        </main>
        <div className="actionbar">
          <button
            type="button"
            className="btn cta"
            disabled={!choiceReady(space)}
            onClick={() => toStep(2)}
          >
            Scegli il gioco <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </>
    );

  if (step === total - 1)
    return (
      <>
        <Header
          title="Nuova partita"
          subtitle={`Passo ${total - 1} di ${total} · Gioco`}
          back={withSpace ? '/partite/nuova' : null}
          backLabel="Torna al punto di incontro"
        />
        <div className="toolbar">
          <div className={`wz-prog ${withSpace ? 'three' : 'two'}`} aria-hidden="true">
            {withSpace && <i className="done" />}
            <i className="on" />
            <i />
          </div>
        </div>
        <main className="setup">
          <h2 className="wz-title">A cosa giocate?</h2>
          <div className="gamegrid" role="radiogroup" aria-label="Gioco del totem">
            {gameChoices.map(([id, sub]) => (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
              >
                <b>{games[id].label}</b>
                <small>{sub}</small>
              </button>
            ))}
          </div>
          <p className="note">
            <Info aria-hidden="true" />
            <span>
              {game.rules} <Link to={`/regole?tab=giochi&gioco=${mode}`}>Regole del totem</Link>
            </span>
          </p>
          <div className="setup-track">
            <span className="field-l" id="tracking-label">
              Registrazione
            </span>
            <Segmented
              label="Registrazione"
              small
              value={tracking}
              change={setTracking}
              options={(['ROUND_BY_ROUND', 'FLEXIBLE', 'FINAL_ONLY'] as Tracking[]).map((id) => ({
                id,
                label: trackingLabels[id],
              }))}
            />
            <p className="hint">{trackingHints[tracking]}</p>
            {game.scoring === 'remaining' && tracking !== 'FINAL_ONLY' && (
              <>
                <span className="field-l">Valore di ogni turno</span>
                <Segmented
                  label="Valore di ogni turno"
                  small
                  value={x01Entry}
                  change={setX01Entry}
                  options={[
                    { id: 'SCORED', label: 'Punti fatti' },
                    { id: 'REMAINING', label: 'Punti rimasti' },
                  ]}
                />
              </>
            )}
          </div>
        </main>
        <div className="actionbar">
          <button type="button" className="btn cta" onClick={() => toStep(total)}>
            Scegli i giocatori <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </>
    );

  return (
    <>
      <Header
        title={`Nuova partita · ${game.label}`}
        subtitle={`Passo ${total} di ${total} · Giocatori`}
        back={
          withSpace ? `/partite/nuova?passo=gioco&gioco=${mode}` : `/partite/nuova?gioco=${mode}`
        }
        backLabel="Torna al gioco"
      />
      <div className="toolbar">
        <div className={`wz-prog ${withSpace ? 'three' : 'two'}`} aria-hidden="true">
          {withSpace && <i className="done" />}
          <i className="done" />
          <i className="on" />
        </div>
      </div>
      <main className="setup">
        <div className="wz-head">
          <h2 className="wz-title">Chi sale al totem?</h2>
          <p>
            In ordine di tiro ·{' '}
            {unlimited
              ? `a manche da ${seats} posti`
              : min === max
                ? `${max} giocatori`
                : `da ${min} a ${max} giocatori`}
          </p>
        </div>
        <fieldset disabled={locked} className="setup-players">
          {selected.length > 1 && (
            <Segmented
              label="Singoli o squadre"
              small
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
          )}
          <ol className="list" aria-label="Ordine di tiro">
            {selected.map((p, i) => (
              <li key={p.id} className="mv big">
                <span className={`pos ${i === 0 ? 'first' : ''}`}>{i + 1}</span>
                <Avatar name={p.displayName} avatar={p.avatar} size="md" />
                <span className="nm">
                  <b>{p.displayName}</b>
                  {(i === 0 || sideOf(mode, i + 1) || nickname(p)) && !teamMode && (
                    <small>
                      {[i === 0 ? 'Tira per primo' : '', sideOf(mode, i + 1) ?? '', nickname(p)]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  )}
                </span>
                <span className="acts">
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Anticipa ${p.displayName}`}
                    disabled={i === 0}
                    onClick={() => move(i)}
                  >
                    <ChevronUp />
                  </button>
                  <button
                    type="button"
                    className="mini"
                    aria-label={`Rimuovi ${p.displayName}`}
                    onClick={() => setSelected(selected.filter((x) => x.id !== p.id))}
                  >
                    <X />
                  </button>
                </span>
              </li>
            ))}
            {canAdd && (
              <li>
                <button
                  type="button"
                  className="slot-free"
                  aria-label="Aggiungi giocatore"
                  onClick={() => setPicker(true)}
                >
                  <Plus aria-hidden="true" /> Posto {selected.length + 1} libero
                </button>
              </li>
            )}
          </ol>
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
          {heats.length > 0 && (
            <section className="card pad" aria-labelledby="heats-title">
              <div className="sec-h">
                <h3 id="heats-title">{heats.length} manche</h3>
                <span>{heats.join(' + ')}</span>
              </div>
              <Segmented
                label="Distribuzione nelle manche"
                small
                value={heatStrategy}
                change={setHeatStrategy}
                options={[
                  { id: 'sequential', label: 'Riempi' },
                  { id: 'balanced', label: 'Bilanciata' },
                  { id: 'custom', label: 'Manuale' },
                ]}
              />
              <p className="hint">
                Più {unitWord} dei posti del totem: classifica unica per punteggio. Le manche si
                rivedono dopo l’avvio, prima di giocarle.
              </p>
            </section>
          )}
          {canAdd && (
            <section className="setup-add" aria-labelledby="add-title">
              <div className="sec-h">
                <span className="field-l" id="add-title">
                  Aggiungi
                </span>
                <button type="button" className="text-link" onClick={() => setPicker(true)}>
                  Tutti
                </button>
              </div>
              <div className="chips">
                {pool.slice(0, 7).map((p) => (
                  <button
                    type="button"
                    className="chip"
                    key={p.id}
                    aria-label={`Aggiungi ${p.displayName}`}
                    onClick={() => setSelected((current) => [...current, p])}
                  >
                    <Avatar name={p.displayName} avatar={p.avatar} size="xs" />
                    {p.displayName}
                  </button>
                ))}
                <button
                  type="button"
                  className="chip dashed"
                  aria-label="Nuovo giocatore"
                  onClick={() => setCreating(true)}
                >
                  <Plus aria-hidden="true" />
                  Nuovo
                </button>
              </div>
            </section>
          )}
        </fieldset>
        <ErrorMessage error={create.error} />
        {create.error && draft && (
          <p className="hint">
            <Link to="/tornei">Controlla la partita salvata</Link> prima di crearne una nuova.
          </p>
        )}
        {picker && (
          <AddPlayerSheet
            excluded={selected.map((p) => p.id)}
            remaining={unlimited ? 256 - selected.length : max - selected.length}
            add={(p) => setSelected((current) => [...current, p])}
            close={() => setPicker(false)}
          />
        )}
        {creating && (
          <NewPlayerSheet
            close={() => setCreating(false)}
            created={(p) => setSelected((current) => [...current, p])}
          />
        )}
      </main>
      <div className="actionbar foot">
        <div className="ctx">
          <span>
            <b>{units.length}</b> al totem · {Math.max(1, heats.length)} manche
          </span>
          <span>{reason ? '' : `primo: ${units[0]?.label ?? ''}`}</span>
          {withSpace && spaceName && <span>I risultati contano nella scoreboard {spaceName}</span>}
        </div>
        <button
          type="button"
          className="btn ghost"
          disabled={locked}
          onClick={() => toStep(total - 1)}
        >
          <ArrowLeft aria-hidden="true" /> Indietro
        </button>
        <button
          type="button"
          className="btn cta"
          disabled={
            !!reason ||
            create.isPending ||
            (!draft && create.error instanceof ApiError && create.error.uncertain)
          }
          onClick={() => create.mutate()}
        >
          <Play aria-hidden="true" fill="currentColor" />
          {create.isPending ? 'Avvio…' : draft ? 'Riprendi avvio' : 'Avvia partita'}
        </button>
        {reason && (
          <p className="form-reason" role="status">
            {reason}
          </p>
        )}
      </div>
    </>
  );
}
