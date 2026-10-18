import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, ChevronDown, Minus, Plus, Trophy } from 'lucide-react';
import { distributeGroups } from '../../../../packages/domain/src/tournaments/schedule.js';
import { api, ApiError, type Player, type Tournament } from '../services/api';
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
  const [name, setName] = useState('BiteTrouble Open');
  const [eventId, setEventId] = useState(params.get('serata') ?? '');
  const [format, setFormat] = useState<Format>('GROUPS');
  const [picked, setPicked] = useState<Player[]>([]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [turns, setTurns] = useState(3);
  const [darts, setDarts] = useState(3);
  const [groups, setGroups] = useState(2);
  const [perGroup, setPerGroup] = useState(2);
  const [manual, setManual] = useState(false);
  const [assigned, setAssigned] = useState<Record<string, number>>({});
  const [win, setWin] = useState(3);
  const [draw, setDraw] = useState(1);
  const [loss, setLoss] = useState(0);
  const [allowDraws, setAllowDraws] = useState(true);
  const [qualifiers, setQualifiers] = useState(4);
  const [finalTurns, setFinalTurns] = useState(3);
  const [tiePolicy, setTiePolicy] = useState<'PLAYOFF' | 'BEST_TURN_THEN_PLAYOFF'>('PLAYOFF');
  const [tieBreakTurns, setTieBreakTurns] = useState(1);
  const [order, setOrder] = useState<'registration' | 'seed'>('registration');
  const [draft, setDraft] = useState<Tournament>();

  const roster = useQuery({
    queryKey: ['players', '', 0, 'active'],
    queryFn: () => api.players('', 0, 'active'),
  });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const openEvents = (events.data?.items ?? []).filter((e) =>
    ['planned', 'active'].includes(e.status),
  );
  const isGroups = format === 'GROUPS';
  const n = picked.length;
  // Who is in which group: the snake preview, or the organizer's own choice.
  const composition = useMemo(() => {
    const ids = picked.map((p) => p.id);
    if (!manual) return snake(ids, groups);
    const result = Array.from({ length: groups }, () => [] as string[]);
    picked.forEach((p, i) => result[Math.min(assigned[p.id] ?? i % groups, groups - 1)]!.push(p.id));
    return result;
  }, [picked, groups, manual, assigned]);

  const reason = !name.trim()
    ? 'Inserisci il nome del torneo.'
    : n < 2
      ? 'Servono almeno 2 partecipanti.'
      : !isGroups && qualifiers > n
        ? `I finalisti (${qualifiers}) superano gli iscritti (${n}).`
        : isGroups &&
            (!composition || composition.some((g) => g.length < Math.max(2, perGroup)))
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
          scoringConfiguration: { kind: 'HIGH_SCORE', turns, dartsPerTurn: darts },
          tournamentConfiguration: {
            qualifiers: isGroups ? Math.min(64, Math.max(2, groups * perGroup)) : qualifiers,
            groupCount: groups,
            qualifiersPerGroup: perGroup,
            winPoints: win,
            drawPoints: draw,
            lossPoints: loss,
            allowDraws,
            tiePolicy,
            tieBreakTurns,
            playingOrder: order,
            finalScoring:
              !isGroups && finalTurns !== turns
                ? { kind: 'HIGH_SCORE', turns: finalTurns, dartsPerTurn: darts }
                : null,
          },
        }));
      setDraft(t);
      for (const [index, player] of picked.entries())
        if (!t.entries.some((e) => e.playerId === player.id))
          t = await api.tournamentCommand(t, 'players', { playerId: player.id, seed: index + 1 });
      if (isGroups && manual && composition && !t.tournamentConfiguration.groupAssignments) {
        const entry = (playerId: string) => t.entries.find((e) => e.playerId === playerId)!.id;
        t = await api.tournamentCommand(t, 'configure', {
          tournamentConfiguration: {
            ...t.tournamentConfiguration,
            groupAssignments: composition.map((g) => g.map(entry)),
          },
        });
      }
      if (t.status === 'draft') t = await api.tournamentCommand(t, 'registration/open');
      if (start) t = await api.tournamentCommand(t, 'start');
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
              {n} giocatori ·{' '}
              {isGroups ? `${groups} gironi · eliminazione diretta` : `Hi-Score · Top ${qualifiers}`}
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
                Hi-Score
              </button>
            </div>
            <p className="description">
              {isGroups
                ? 'Tutti contro tutti nei gironi, poi tabellone a eliminazione diretta (semifinali e finale).'
                : 'Una qualifica unica: i migliori totali giocano una finale unica, ripartendo da zero.'}
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
          <section className="form-section">
            <h2>Prova Hi-Score</h2>
            <div className="options">
              <Stepper
                label={isGroups ? 'Turni per incontro' : 'Turni di qualifica'}
                hint="Per ogni giocatore"
                value={turns}
                change={setTurns}
                max={100}
              />
              <Stepper
                label="Freccette per turno"
                hint="Massimo 60 a freccetta"
                value={darts}
                change={setDarts}
                max={12}
              />
              <div className="settings-row">
                <span>Massimo per turno</span>
                <strong className="accent-soft">{darts * 60}</strong>
              </div>
            </div>
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
                              const p = picked.find((x) => x.id === id)!;
                              const seed = picked.indexOf(p) + 1;
                              return manual ? (
                                <label key={id} className="assign">
                                  <span className="visually-hidden">Girone di {p.displayName}</span>
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
                                  {p.displayName}
                                </label>
                              ) : (
                                <span key={id}>
                                  <small>{seed}</small>
                                  {p.displayName}
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
                  <div className="switch-row">
                    <span className="row-label">
                      <span id="draws-label">Pareggi ammessi</span>
                      <small>
                        {allowDraws
                          ? 'Un pari assegna i punti del pareggio'
                          : 'Un pari si decide con uno spareggio'}
                      </small>
                    </span>
                    <Switch checked={allowDraws} change={setAllowDraws} labelledBy="draws-label" />
                  </div>
                </div>
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
                <Stepper
                  label="Turni della finale"
                  hint={finalTurns === turns ? 'Come la qualifica' : 'Diversi dalla qualifica'}
                  value={finalTurns}
                  change={setFinalTurns}
                  max={100}
                />
                <p className="hint row-hint">Finale unica tra i qualificati, con punteggio azzerato.</p>
              </div>
            </section>
          )}
          <section className="form-section">
            <h2>Parità e ordine</h2>
            <div className="options padded stack">
              <div className="stack-row">
                <span>In caso di parità</span>
                <Segmented
                  label="Criterio di parità"
                  value={tiePolicy}
                  change={setTiePolicy}
                  options={[
                    { id: 'PLAYOFF', label: 'Spareggio sul bersaglio' },
                    { id: 'BEST_TURN_THEN_PLAYOFF', label: 'Miglior turno, poi spareggio' },
                  ]}
                />
              </div>
              <Stepper
                label="Turni di spareggio"
                value={tieBreakTurns}
                change={setTieBreakTurns}
                max={20}
              />
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
