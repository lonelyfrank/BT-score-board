import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, ChevronDown, Minus, Plus, Trophy } from 'lucide-react';
import { distributeGroups } from '../../../../packages/domain/src/tournaments/schedule.js';
import { api, ApiError, type Player, type Tournament } from '../services/api';
import {
  HI_SCORE_ROUNDS,
  checkComposition,
  gameModes,
  games,
  heatSizes,
  syncTeams,
  trackingHints,
  trackingLabels,
  type GameMode,
  type TeamDraft,
  type Tracking,
} from '../services/rules';
import { TeamBuilder } from '../components/TeamBuilder';
import { ErrorMessage, Header, Segmented, Stepper, Switch } from '../components/ui';
import { TrophyEmblem } from '../components/BrandIcons';
import { NewPlayerSheet } from '../components/PlayerSheets';

type Format = 'GROUPS' | 'QUICK_HIGH_SCORE';
const groupName = (i: number) => `Girone ${String.fromCharCode(65 + i)}`;

/** Snake distribution from the domain itself; null while there are too few players. */
function snake(ids: string[], count: number) {
  try {
    return distributeGroups(ids, count);
  } catch {
    return null;
  }
}

function PointStepper({
  label,
  value,
  change,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
}) {
  return (
    <div className="point-stepper" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        <button
          type="button"
          className="mini"
          aria-label={`Riduci ${label}`}
          disabled={value <= 0}
          onClick={() => change(value - 1)}
        >
          <Minus size={14} />
        </button>
        <output>{value}</output>
        <button
          type="button"
          className="mini"
          aria-label={`Aumenta ${label}`}
          disabled={value >= 100}
          onClick={() => change(value + 1)}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

export function TournamentSetup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState('Bite the Trouble Open');
  const [eventId, setEventId] = useState(params.get('serata') ?? '');
  const [format, setFormat] = useState<Format>('GROUPS');
  const [gameMode, setGameMode] = useState<GameMode>('HI_SCORE');
  const [picked, setPicked] = useState<Player[]>([]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [groups, setGroups] = useState(2);
  const [perGroup, setPerGroup] = useState(2);
  const [manual, setManual] = useState(false);
  const [assigned, setAssigned] = useState<Record<string, number>>({});
  const [win, setWin] = useState(3);
  const [draw, setDraw] = useState(1);
  const [loss, setLoss] = useState(0);
  const [allowDraws, setAllowDraws] = useState(true);
  const [qualifiers, setQualifiers] = useState(4);
  const [order, setOrder] = useState<'registration' | 'seed'>('registration');
  const [draft, setDraft] = useState<Tournament>();
  const [teamMode, setTeamMode] = useState(false);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [unevenOk, setUnevenOk] = useState(false);
  const [tracking, setTracking] = useState<Tracking>('ROUND_BY_ROUND');
  const [x01Entry, setX01Entry] = useState<'REMAINING' | 'SCORED'>('SCORED');
  const [heatStrategy, setHeatStrategy] = useState<'balanced' | 'sequential' | 'random' | 'custom'>(
    'sequential',
  );
  useEffect(() => {
    if (teamMode)
      setTeams((current) =>
        syncTeams(
          current,
          picked.map((p) => p.id),
        ),
      );
  }, [picked, teamMode]);

  const roster = useQuery({
    queryKey: ['players', '', 0, 'active'],
    queryFn: () => api.players('', 0, 'active'),
  });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const openEvents = (events.data?.items ?? []).filter((e) =>
    ['planned', 'active'].includes(e.status),
  );
  const isGroups = format === 'GROUPS';
  // The quick format ranks Hi-Score totals: no other game can be compared that way.
  const game = games[isGroups ? gameMode : 'HI_SCORE'];
  const byName = (id: string) => picked.find((p) => p.id === id)?.displayName ?? '?';
  // Competitive units: every player alone, or the teams composed below.
  const units = teamMode
    ? teams.map((t) => ({
        key: t.key,
        playerIds: t.playerIds,
        name: t.playerIds.length > 1 ? t.name : null,
        label: (t.playerIds.length > 1 && t.name) || t.playerIds.map(byName).join(' + '),
      }))
    : picked.map((p) => ({ key: p.id, playerIds: [p.id], name: null, label: p.displayName }));
  const n = units.length;
  const check = teamMode
    ? checkComposition(
        teams,
        picked.map((p) => p.id),
      )
    : null;
  const uneven = !!check?.warnings.includes('UNEVEN_TEAMS');
  // Who is in which group: the snake preview, or the organizer's own choice.
  const unitKeys = units.map((u) => u.key).join();
  const composition = useMemo(() => {
    const ids = unitKeys ? unitKeys.split(',') : [];
    if (!manual) return snake(ids, groups);
    const result = Array.from({ length: groups }, () => [] as string[]);
    ids.forEach((id, i) => result[Math.min(assigned[id] ?? i % groups, groups - 1)]!.push(id));
    return result;
  }, [unitKeys, groups, manual, assigned]);
  const quickHeats =
    !isGroups && n > game.players.max
      ? heatSizes(n, game.players.max, heatStrategy === 'custom' ? 'sequential' : heatStrategy)
      : [];

  const reason = !name.trim()
    ? 'Inserisci il nome del torneo.'
    : n < 2
      ? 'Servono almeno 2 partecipanti.'
      : check?.errors.length
        ? 'Ogni giocatore deve stare in una sola squadra.'
        : uneven && !unevenOk
          ? 'Squadre con un numero diverso di giocatori: conferma la composizione.'
          : isGroups && (!composition || composition.some((g) => g.length < Math.max(2, perGroup)))
            ? `Ogni girone deve avere almeno 2 giocatori e almeno ${perGroup} iscritti.`
            : isGroups && groups * perGroup < 2
              ? 'Servono almeno 2 qualificati alla fase finale.'
              : '';

  const save = useMutation({
    mutationFn: async (start: boolean) => {
      let t =
        draft ??
        (await api.createTournament({
          name: name.trim(),
          eventId: eventId || null,
          mode: format,
          gameMode: game.id,
          tracking,
          scoringConfiguration: { kind: 'HIGH_SCORE', turns: HI_SCORE_ROUNDS },
          tournamentConfiguration: {
            qualifiers: isGroups ? Math.min(64, Math.max(2, groups * perGroup)) : qualifiers,
            groupCount: groups,
            qualifiersPerGroup: perGroup,
            winPoints: win,
            drawPoints: draw,
            lossPoints: loss,
            allowDraws: game.drawPossible && allowDraws,
            playingOrder: order,
            x01Entry,
            heatStrategy: heatStrategy === 'custom' ? 'sequential' : heatStrategy,
          },
        }));
      setDraft(t);
      // One command registers every unit (singles and teams): all of them, or none.
      if (!t.entries.length && units.length)
        t = await api.tournamentCommand(t, 'entries/compose', {
          entries: units.map((u) => ({ playerIds: u.playerIds, name: u.name })),
        });
      if (isGroups && manual && composition && !t.tournamentConfiguration.groupAssignments) {
        const entry = (key: string) => {
          const first = units.find((u) => u.key === key)!.playerIds[0];
          return t.entries.find((e) => e.playerId === first)!.id;
        };
        t = await api.tournamentCommand(t, 'configure', {
          tournamentConfiguration: {
            ...t.tournamentConfiguration,
            groupAssignments: composition.map((g) => g.map(entry)),
          },
        });
      }
      if (t.status === 'draft') t = await api.tournamentCommand(t, 'registration/open');
      if (start) t = await api.tournamentCommand(t, 'start');
      if (start && !isGroups && heatStrategy === 'custom') {
        navigate(`/partite/${t.matches[0]!.id}?organize=1`);
        return;
      }
      navigate(`${format === 'QUICK_HIGH_SCORE' ? '/hiscore' : '/tornei'}/${t.id}`);
    },
  });

  const players = roster.data?.items ?? [];
  const shown = filter.trim()
    ? players.filter((p) =>
        `${p.displayName} ${p.nickname ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : players;
  const toggle = (p: Player) =>
    setPicked((current) =>
      current.some((x) => x.id === p.id) ? current.filter((x) => x.id !== p.id) : [...current, p],
    );
  const locked = !!draft || save.isPending;
  return (
    <>
      <Header title="Nuovo torneo" />
      <main className="content setup-page with-graffiti">
        <div className="event-heading">
          <TrophyEmblem />
          <div>
            <h2>{name.trim() || 'Il tuo torneo'}</h2>
            <p>
              {n} giocatori · {game.label} ·{' '}
              {isGroups ? `${groups} gironi · eliminazione diretta` : `Top ${qualifiers}`}
            </p>
          </div>
        </div>
        <fieldset disabled={locked} className="setup-fields">
          <label className="field">
            Nome torneo
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Serata (facoltativa)
            <span className="select">
              <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">Nessuna serata</option>
                {openEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.scheduledAt &&
                      ` · ${new Date(e.scheduledAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
          </label>
          <section className="form-section">
            <h2>Formato</h2>
            <div className="choice-group" role="radiogroup" aria-label="Formato">
              <button
                type="button"
                role="radio"
                aria-checked={isGroups}
                onClick={() => setFormat('GROUPS')}
              >
                A gironi
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!isGroups}
                onClick={() => setFormat('QUICK_HIGH_SCORE')}
              >
                <ChartNoAxesColumnIncreasing size={17} strokeWidth={3} aria-hidden="true" />
                Hi-Score rapido
              </button>
            </div>
            <p className="description">
              {isGroups
                ? 'Tutti contro tutti nei gironi, poi tabellone a eliminazione diretta (semifinali e finale).'
                : 'Una qualifica unica: i migliori totali giocano una finale unica, ripartendo da zero.'}
            </p>
          </section>
          <section className="form-section">
            <h2>Gioco sul totem</h2>
            <div className="mode-grid compact" role="radiogroup" aria-label="Gioco sul totem">
              {gameModes.map((id) => {
                const allowed = isGroups || id === 'HI_SCORE';
                return (
                  <button
                    type="button"
                    key={id}
                    role="radio"
                    aria-checked={game.id === id}
                    className={game.id === id ? 'selected' : ''}
                    disabled={!allowed}
                    onClick={() => setGameMode(id)}
                  >
                    <span>{games[id].label}</span>
                  </button>
                );
              })}
            </div>
            <p className="hint">
              {game.rules}{' '}
              {game.scoreRequired
                ? `Si registra il punteggio finale (${HI_SCORE_ROUNDS} round).`
                : 'Si registra il vincitore indicato dal totem; i punteggi sono facoltativi.'}
              {!isGroups && ' Il formato rapido confronta i totali: solo Hi-Score.'}
            </p>
          </section>
          <section className="form-section" aria-labelledby="entrants-title">
            <div className="section-head">
              <h2 id="entrants-title">Partecipanti · {n}</h2>
              <span>Ordine di tocco = seed</span>
            </div>
            {players.length > 12 && (
              <input
                aria-label="Filtra giocatori"
                placeholder="Filtra per nome o soprannome"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            <div className="roster" role="group" aria-label="Seleziona partecipanti">
              {shown.map((p) => {
                const seed = picked.findIndex((x) => x.id === p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    aria-pressed={seed >= 0}
                    onClick={() => toggle(p)}
                  >
                    <span className="seed">{seed >= 0 ? seed + 1 : '–'}</span>
                    <span>
                      {p.displayName}
                      {p.nickname && <small> “{p.nickname}”</small>}
                    </span>
                  </button>
                );
              })}
            </div>
            <ErrorMessage error={roster.error} retry={() => void roster.refetch()} />
            <button type="button" className="dashed" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="accent-icon" /> Nuovo giocatore
            </button>
          </section>
          <section className="form-section" aria-labelledby="units-title">
            <div className="section-head">
              <h2 id="units-title">Singoli o squadre</h2>
              <span>{teamMode ? `${n} squadre` : 'Ognuno per sé'}</span>
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
                        picked.map((p) => p.id),
                      )
                    : [],
                );
                setAssigned({});
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
                  players={picked}
                  teams={teams}
                  change={(next) => {
                    setTeams(next);
                    setAssigned({});
                    setUnevenOk(false);
                  }}
                  disabled={locked}
                />
                <p className="hint">
                  Una squadra è un solo partecipante: un posto sul totem, una riga in classifica.
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
          {isGroups ? (
            <>
              <section className="form-section">
                <h2>Gironi</h2>
                <div className="options">
                  <Stepper
                    label="Numero gironi"
                    hint="Distribuzione a serpentina sui seed"
                    value={groups}
                    change={setGroups}
                    max={16}
                  />
                  <Stepper
                    label="Qualificati per girone"
                    hint="Accedono al tabellone"
                    value={perGroup}
                    change={setPerGroup}
                    max={16}
                  />
                  <div className="composition">
                    <span>Composizione</span>
                    <Segmented
                      label="Composizione gironi"
                      value={manual ? 'manual' : 'auto'}
                      change={(v) => {
                        // Manual composition starts from the automatic one.
                        if (v === 'manual' && composition)
                          setAssigned(
                            Object.fromEntries(
                              composition.flatMap((ids, g) => ids.map((id) => [id, g])),
                            ),
                          );
                        setManual(v === 'manual');
                      }}
                      options={[
                        { id: 'auto', label: 'Automatica' },
                        { id: 'manual', label: 'Manuale' },
                      ]}
                    />
                    {composition && (
                      <div
                        className="group-preview"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(groups, 4)}, minmax(0, 1fr))`,
                        }}
                      >
                        {composition.map((ids, g) => (
                          <div key={g}>
                            <strong>{groupName(g)}</strong>
                            {ids.map((id) => {
                              const p = units.find((x) => x.key === id)!;
                              const seed = units.indexOf(p) + 1;
                              return manual ? (
                                <label key={id} className="assign">
                                  <span className="visually-hidden">Girone di {p.label}</span>
                                  <select
                                    value={g}
                                    onChange={(e) =>
                                      setAssigned({ ...assigned, [id]: Number(e.target.value) })
                                    }
                                  >
                                    {Array.from({ length: groups }, (_, k) => (
                                      <option key={k} value={k}>
                                        {String.fromCharCode(65 + k)}
                                      </option>
                                    ))}
                                  </select>
                                  {p.label}
                                </label>
                              ) : (
                                <span key={id}>
                                  <small>{seed}</small>
                                  {p.label}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                    <small>
                      {manual
                        ? 'Scegli il girone di ogni iscritto: ognuno in un solo girone.'
                        : 'Anteprima della serpentina. Il sorteggio casuale non è previsto.'}
                    </small>
                  </div>
                </div>
              </section>
              <section className="form-section">
                <h2>Punti in classifica</h2>
                <div className="options padded">
                  <div className="point-grid">
                    <PointStepper label="Vittoria" value={win} change={setWin} />
                    <PointStepper label="Pareggio" value={draw} change={setDraw} />
                    <PointStepper label="Sconfitta" value={loss} change={setLoss} />
                  </div>
                  {game.drawPossible ? (
                    <div className="switch-row">
                      <span className="row-label">
                        <span id="draws-label">Pareggi ammessi</span>
                        <small>
                          {allowDraws
                            ? 'Un pari assegna i punti del pareggio'
                            : 'Un pari si decide con uno spareggio'}
                        </small>
                      </span>
                      <Switch
                        checked={allowDraws}
                        change={setAllowDraws}
                        labelledBy="draws-label"
                      />
                    </div>
                  ) : (
                    <p className="hint row-hint">
                      {game.label}: il totem indica sempre un vincitore, niente pareggi.
                    </p>
                  )}
                </div>
                <p className="hint">
                  Classifica:{' '}
                  {game.id === 'HI_SCORE'
                    ? 'punti, differenza punteggi, punteggi segnati, scontro diretto (tra 2), poi spareggio.'
                    : 'punti, vittorie, scontro diretto (tra 2), poi spareggio. I punteggi del totem non contano: giochi diversi non si confrontano.'}
                </p>
              </section>
            </>
          ) : (
            <section className="form-section">
              <h2>Finale</h2>
              <div className="options">
                <Stepper
                  label="Migliori alla finale"
                  hint="Minimo 2"
                  value={qualifiers}
                  change={setQualifiers}
                  min={2}
                  max={64}
                />
                <p className="hint row-hint">
                  {n > 0 && n < qualifiers
                    ? `Con ${n} iscritti (meno di ${qualifiers}) non c’è qualifica: tutti giocano direttamente la finale.`
                    : 'Finale unica tra i qualificati, con punteggio azzerato: i punti della qualifica non si sommano.'}
                </p>
              </div>
              {quickHeats.length > 0 && (
                <>
                  <h2>Manche di qualifica</h2>
                  <div className="options padded stack">
                    <div className="settings-row">
                      <span>{quickHeats.length} manche</span>
                      <strong>{quickHeats.join(' · ')}</strong>
                    </div>
                    <div className="stack-row">
                      <span>Distribuzione</span>
                      <Segmented
                        label="Distribuzione nelle manche"
                        value={heatStrategy}
                        change={setHeatStrategy}
                        options={[
                          { id: 'sequential', label: 'Riempimento' },
                          { id: 'custom', label: 'Personalizzata' },
                          { id: 'random', label: 'Casuale' },
                          { id: 'balanced', label: 'Bilanciata' },
                        ]}
                      />
                    </div>
                  </div>
                  <p className="hint">
                    Le manche sono solo turni al bersaglio: i migliori {qualifiers} si scelgono su
                    tutti i punteggi della qualifica, non per manche.
                  </p>
                </>
              )}
            </section>
          )}
          <details className="advanced">
            <summary>Registrazione · {trackingLabels[tracking]}</summary>
            <div className="options padded stack">
              <Segmented
                label="Registrazione"
                value={tracking}
                change={setTracking}
                options={(Object.keys(trackingLabels) as Tracking[]).map((id) => ({
                  id,
                  label: trackingLabels[id],
                }))}
              />
              <p className="hint">{trackingHints[tracking]}</p>
              {game.scoring === 'remaining' && tracking !== 'FINAL_ONLY' && (
                <div className="stack-row">
                  <span>Valore di ogni turno</span>
                  <Segmented
                    label="Valore di ogni turno"
                    value={x01Entry}
                    change={setX01Entry}
                    options={[
                      { id: 'SCORED', label: 'Punti fatti' },
                      { id: 'REMAINING', label: 'Punti rimasti' },
                    ]}
                  />
                </div>
              )}
            </div>
          </details>
          <section className="form-section">
            <h2>Parità e ordine</h2>
            <div className="options padded stack">
              <p className="hint">
                Una parità decisiva (soglia della finale, vincitore, qualificati dei gironi) si
                risolve con uno spareggio sul totem oppure con una decisione esplicita
                dell’organizzatore, che resta nello storico. Nessun sorteggio nascosto.
              </p>
              <div className="stack-row">
                <span>Ordine di gioco</span>
                <Segmented
                  label="Ordine di gioco"
                  value={order}
                  change={setOrder}
                  options={[
                    { id: 'registration', label: 'Iscrizione' },
                    { id: 'seed', label: 'Seed' },
                  ]}
                />
              </div>
            </div>
          </section>
        </fieldset>
        <ErrorMessage error={save.error} />
        {save.error && draft && (
          <p>
            <Link to={`${format === 'QUICK_HIGH_SCORE' ? '/hiscore' : '/tornei'}/${draft.id}`}>
              Controlla il torneo salvato
            </Link>{' '}
            prima di crearne uno nuovo.
          </p>
        )}
        <div className="cta-block">
          <button
            className="primary cta"
            disabled={
              !!reason ||
              save.isPending ||
              (!draft && save.error instanceof ApiError && save.error.uncertain)
            }
            onClick={() => save.mutate(true)}
          >
            <Trophy className="cta-icon" fill="currentColor" />
            {save.isPending ? 'Avvio…' : draft ? 'Riprendi avvio' : 'AVVIA TORNEO'}
          </button>
          {reason && (
            <p className="form-reason" role="status">
              {reason}
            </p>
          )}
          <button
            disabled={!name.trim() || save.isPending || !!draft}
            onClick={() => save.mutate(false)}
          >
            Salva come bozza (iscrizioni aperte)
          </button>
        </div>
        <div className="graffiti" aria-hidden="true">
          Good
          <br />
          darts
          <br />
          good
          <br />
          friends
        </div>
        {creating && (
          <NewPlayerSheet
            keepOpen
            close={() => setCreating(false)}
            created={(p) => setPicked((current) => [...current, p])}
          />
        )}
      </main>
    </>
  );
}
