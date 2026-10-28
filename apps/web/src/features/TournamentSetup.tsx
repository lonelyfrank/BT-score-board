import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  Grid2x2Plus,
  Info,
  Lock,
  Pencil,
  Play,
  Plus,
  Search,
  Target,
} from 'lucide-react';
import { distributeGroups } from '../../../../packages/domain/src/tournaments/schedule.js';
import { api, ApiError, localData, type Player, type Tournament } from '../services/api';
import {
  HI_SCORE_ROUNDS,
  checkComposition,
  formatLabel,
  freeMatchLimits,
  gameModes,
  games,
  planHeats,
  syncTeams,
  trackingHints,
  trackingLabels,
  type GameMode,
  type TeamDraft,
  type Tracking,
} from '../services/rules';
import { TeamBuilder } from '../components/TeamBuilder';
import {
  Avatar,
  ErrorMessage,
  Header,
  Segmented,
  Stepper,
  StepperControl,
  Switch,
} from '../components/ui';
import { NewPlayerSheet } from '../components/PlayerSheets';
import { WizardTrack } from '../components/WizardTrack';
import { shortDate } from './Setup';
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

type Format = 'QUICK_HIGH_SCORE' | 'GROUPS' | 'SINGLE_MATCH';
type Strategy = 'sequential' | 'balanced' | 'random' | 'custom';
const groupName = (i: number) => `Girone ${String.fromCharCode(65 + i)}`;
const formats: { id: Format; name: string; desc: string; icon: ReactNode }[] = [
  {
    id: 'QUICK_HIGH_SCORE',
    name: 'Hi-Score rapido',
    desc: 'Qualifica a manche, poi finale tra i migliori',
    icon: <ChartNoAxesColumnIncreasing />,
  },
  {
    id: 'GROUPS',
    name: 'Gironi + eliminazione',
    desc: 'All’italiana, poi semifinali e finale',
    icon: <Grid2x2Plus />,
  },
  {
    id: 'SINGLE_MATCH',
    name: 'Partita singola',
    desc: 'Un incontro da 2 a 4 giocatori',
    icon: <Target />,
  },
];
const strategyLabels: Record<Strategy, string> = {
  sequential: 'Riempi',
  balanced: 'Bilanciata',
  random: 'Casuale',
  custom: 'Manuale',
};
const strategyHints: Record<Strategy, string> = {
  sequential: 'Riempie ogni manche fino ai posti disponibili: l’ultima può restare corta.',
  balanced: 'Manche il più possibile uguali: nessuno gioca da solo.',
  random: 'Sorteggio all’avvio: lo vedi in Organizza manche e puoi cambiarlo prima di giocare.',
  custom: 'Parti dalla bilanciata e sposti i giocatori da Organizza manche, prima di giocare.',
};

/** Snake distribution from the domain itself; null while there are too few players. */
function snake(ids: string[], count: number) {
  try {
    return distributeGroups(ids, count);
  } catch {
    return null;
  }
}

/** Everything the organizer chose: saved on this device after every change. */
type Draft = {
  name: string;
  named: boolean;
  eventId: string;
  format: Format;
  gameMode: GameMode;
  picked: Player[];
  teamMode: boolean;
  teams: TeamDraft[];
  unevenOk: boolean;
  seats: number;
  heatStrategy: Strategy;
  order: 'registration' | 'seed';
  groups: number;
  perGroup: number;
  manual: boolean;
  assigned: Record<string, number>;
  win: number;
  draw: number;
  loss: number;
  allowDraws: boolean;
  qualifiers: number;
  tracking: Tracking;
  x01Entry: 'REMAINING' | 'SCORED';
  /** Where the results count; null until the first question is answered. */
  space: PlaySpaceChoice | null;
};
const draftKey = 'bt-tournament-draft';
const fresh = (): Draft => ({
  name: `Hi-Score Night · ${shortDate()}`,
  named: false,
  eventId: '',
  format: 'QUICK_HIGH_SCORE',
  gameMode: 'HI_SCORE',
  picked: [],
  teamMode: false,
  teams: [],
  unevenOk: false,
  seats: 4,
  heatStrategy: 'balanced',
  order: 'registration',
  groups: 2,
  perGroup: 2,
  manual: false,
  assigned: {},
  win: 3,
  draw: 1,
  loss: 0,
  allowDraws: true,
  qualifiers: 4,
  tracking: 'ROUND_BY_ROUND',
  x01Entry: 'SCORED',
  space: null,
});
function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey);
    return raw ? { ...fresh(), ...(JSON.parse(raw) as Partial<Draft>) } : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey, JSON.stringify(d));
    else localStorage.removeItem(draftKey);
  } catch {
    /* Private mode: the draft lives as long as the screen. */
  }
}
const autoName = (format: Format, mode: GameMode) =>
  format === 'QUICK_HIGH_SCORE'
    ? `Hi-Score Night · ${shortDate()}`
    : format === 'GROUPS'
      ? `Torneo ${games[mode].label} · ${shortDate()}`
      : `${games[mode].label} · ${shortDate()}`;

/**
 * Nuovo torneo, one step at a time: format, players, heats or groups, rules, summary. The
 * steps adapt to the format; every choice stays when going back, and the draft survives
 * leaving the screen.
 */
export function TournamentSetup() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [restored] = useState(readDraft);
  const [d, setD] = useState<Draft>(() => {
    const base = restored ?? fresh();
    const serata = params.get('serata');
    return serata ? { ...base, eventId: serata } : base;
  });
  // Saved only once the organizer changed something: opening the screen is not a draft.
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setTouched(true);
    setD((current) => ({ ...current, ...patch }));
  };
  const spaces = usePlaySpaces();
  const spaceName = choiceName(d.space, spaces.data ?? []);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Tournament>();
  const step = Math.min(5, Math.max(1, Number(params.get('passo')) || 1));
  const go = (n: number) => setParams({ passo: String(n) });
  useEffect(() => {
    if (touched) writeDraft(d);
  }, [d, touched]);
  const roster = useQuery({
    queryKey: ['players', '', 0, 'active'],
    queryFn: () => api.players('', 0, 'active'),
  });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const openEvents = (events.data?.items ?? []).filter((e) =>
    ['planned', 'active'].includes(e.status),
  );
  const isGroups = d.format === 'GROUPS';
  const isQuick = d.format === 'QUICK_HIGH_SCORE';
  const isSingle = d.format === 'SINGLE_MATCH';
  // The quick format ranks Hi-Score totals: no other game can be compared that way.
  const game = games[isQuick ? 'HI_SCORE' : d.gameMode];
  const limits = freeMatchLimits(game.id);
  const picked = d.picked;
  useEffect(() => {
    if (d.teamMode)
      setD((current) => ({
        ...current,
        teams: syncTeams(
          current.teams,
          current.picked.map((p) => p.id),
        ),
      }));
  }, [d.picked, d.teamMode]);
  const byName = (id: string) => picked.find((p) => p.id === id)?.displayName ?? '?';
  // Competitive units: every player alone, or the teams composed in step 2.
  const units = d.teamMode
    ? d.teams.map((t) => ({
        key: t.key,
        playerIds: t.playerIds,
        name: t.playerIds.length > 1 ? t.name : null,
        label: (t.playerIds.length > 1 && t.name) || t.playerIds.map(byName).join(' + '),
      }))
    : picked.map((p) => ({ key: p.id, playerIds: [p.id], name: null, label: p.displayName }));
  const n = units.length;
  const check = d.teamMode
    ? checkComposition(
        d.teams,
        picked.map((p) => p.id),
      )
    : null;
  const uneven = !!check?.warnings.includes('UNEVEN_TEAMS');
  const unitKeys = units.map((u) => u.key).join();
  const composition = useMemo(() => {
    const ids = unitKeys ? unitKeys.split(',') : [];
    if (!d.manual) return snake(ids, d.groups);
    const result = Array.from({ length: d.groups }, () => [] as string[]);
    ids.forEach((id, i) =>
      result[Math.min(d.assigned[id] ?? i % d.groups, d.groups - 1)]!.push(id),
    );
    return result;
  }, [unitKeys, d.groups, d.manual, d.assigned]);
  const seats = Math.min(d.seats, limits.seats);
  const strategy = d.heatStrategy === 'custom' ? 'balanced' : d.heatStrategy;
  // Heats as they will be played: order of registration, sizes from the domain.
  const heatPlan = isGroups
    ? []
    : planHeats(
        units.map((u) => u.key),
        seats,
        strategy === 'random' ? 'sequential' : strategy,
      );
  const combo = heatPlan.map((h) => h.length).join(' + ') || '–';
  const minUnits = isSingle ? limits.min : 2;
  const maxUnits = isSingle ? limits.max : 256;

  const stepReason = (s: number) =>
    s === 1
      ? !localData || choiceReady(d.space)
        ? !d.name.trim()
          ? 'Inserisci il nome del torneo.'
          : ''
        : 'Dì dove giocate: scegli il Bite the Trouble o un altro punto.'
      : s === 2
        ? n < minUnits
          ? `Servono almeno ${minUnits} partecipanti.`
          : n > maxUnits
            ? `${game.label} si gioca al massimo in ${maxUnits}.`
            : check?.errors.length
              ? 'Ogni giocatore deve stare in una sola squadra.'
              : uneven && !d.unevenOk
                ? 'Squadre con un numero diverso di giocatori: conferma la composizione.'
                : ''
        : s === 3
          ? isGroups &&
            (!composition || composition.some((g) => g.length < Math.max(2, d.perGroup)))
            ? `Ogni girone deve avere almeno 2 giocatori e almeno ${d.perGroup} iscritti.`
            : isGroups && d.groups * d.perGroup < 2
              ? 'Servono almeno 2 qualificati alla fase finale.'
              : ''
          : '';
  const reason = [1, 2, 3].map(stepReason).find(Boolean) ?? '';

  const save = useMutation({
    mutationFn: async (start: boolean) => {
      let t =
        created ??
        (await api.createTournament({
          playSpaceId: await resolvePlaySpace(d.space ?? BT_CHOICE),
          name: d.name.trim(),
          eventId: d.eventId || null,
          mode: d.format,
          gameMode: game.id,
          tracking: d.tracking,
          scoringConfiguration: { kind: 'HIGH_SCORE', turns: HI_SCORE_ROUNDS },
          tournamentConfiguration: {
            qualifiers: isGroups
              ? Math.min(64, Math.max(2, d.groups * d.perGroup))
              : isQuick
                ? d.qualifiers
                : undefined,
            groupCount: d.groups,
            qualifiersPerGroup: d.perGroup,
            winPoints: d.win,
            drawPoints: d.draw,
            lossPoints: d.loss,
            allowDraws: game.drawPossible && d.allowDraws,
            playingOrder: d.order,
            x01Entry: d.x01Entry,
            heatCapacity: isGroups ? null : seats,
            heatStrategy: strategy,
          },
        }));
      setCreated(t);
      rememberPlaySpace(t.playSpaceId ?? '');
      // One command registers every unit (singles and teams): all of them, or none.
      if (!t.entries.length && units.length)
        t = await api.tournamentCommand(t, 'entries/compose', {
          entries: units.map((u) => ({ playerIds: u.playerIds, name: u.name })),
        });
      if (isGroups && d.manual && composition && !t.tournamentConfiguration.groupAssignments) {
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
      writeDraft(null);
      const path = isQuick ? '/hiscore' : '/tornei';
      if (!start) return navigate(`${path}/${t.id}`, { replace: true });
      const first = t.matches.find((m) => ['ready', 'active'].includes(m.status));
      const organize = !isGroups && ['random', 'custom'].includes(d.heatStrategy);
      if (!isGroups && first)
        return navigate(`/partite/${first.id}${organize ? '?organize=1' : ''}`, { replace: true });
      navigate(`${path}/${t.id}`, { replace: true });
    },
  });

  const players = roster.data?.items ?? [];
  const shown = filter.trim()
    ? players.filter((p) =>
        `${p.displayName} ${p.nickname ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : players;
  const toggle = (p: Player) =>
    set({
      picked: picked.some((x) => x.id === p.id)
        ? picked.filter((x) => x.id !== p.id)
        : [...picked, p],
      assigned: {},
    });
  const locked = !!created || save.isPending;
  const unitWord = d.teamMode ? 'squadre' : 'giocatori';
  const heatsHint =
    n < minUnits
      ? `servono almeno ${minUnits} ${unitWord}`
      : isGroups
        ? `${d.groups} gironi`
        : `${heatPlan.length} manche da max ${seats}`;
  const subtitle =
    step === 1
      ? restored
        ? 'Bozza ripresa · salvata automaticamente'
        : 'Bozza salvata automaticamente'
      : step === 5
        ? 'Ultimo controllo'
        : [
            formatLabel(d.format),
            step === 3 ? `${n} ${unitWord}` : null,
            step === 4 && !isGroups ? combo : null,
          ]
            .filter(Boolean)
            .join(' · ');
  const firstUnit = isGroups ? composition?.[0]?.[0] : heatPlan[0]?.[0];
  const firstLabel = units.find((u) => u.key === firstUnit)?.label;

  return (
    <>
      <Header
        title={step === 1 || step === 5 ? 'Nuovo torneo' : d.name}
        subtitle={subtitle}
        back="/"
        close
        backLabel="Esci, la bozza resta salvata"
      />
      <div className="toolbar">
        <WizardTrack
          step={step}
          go={go}
          steps={[
            { label: 'Formato', chip: { key: 'FORMATO', value: formatLabel(d.format) } },
            { label: 'Giocatori', chip: { key: 'GIOCATORI', value: String(n) } },
            {
              label: isGroups ? 'Gironi' : 'Manche',
              chip: {
                key: isGroups ? 'GIRONI' : 'MANCHE',
                value: isGroups ? String(d.groups) : combo,
              },
            },
            { label: 'Regole' },
            { label: 'Riepilogo' },
          ]}
        />
      </div>
      <main className="setup">
        <fieldset disabled={locked} className="setup-step">
          {step === 1 && (
            <>
              {localData && <PlaySpaceStep value={d.space} change={(space) => set({ space })} />}
              <div className="wz-head">
                <h2 className="wz-title">Che serata è?</h2>
                <p>Scegli il formato: i passi successivi si adattano.</p>
              </div>
              <label className="field">
                Nome
                <input
                  maxLength={120}
                  value={d.name}
                  onChange={(e) => set({ name: e.target.value, named: true })}
                />
              </label>
              <div className="choice" role="radiogroup" aria-label="Formato">
                {formats.map((f) => (
                  <button
                    type="button"
                    role="radio"
                    key={f.id}
                    aria-checked={d.format === f.id}
                    className="opt"
                    onClick={() =>
                      set({
                        format: f.id,
                        assigned: {},
                        ...(d.named ? {} : { name: autoName(f.id, d.gameMode) }),
                      })
                    }
                  >
                    <span className="oi" aria-hidden="true">
                      {f.icon}
                    </span>
                    <span>
                      <b>{f.name}</b>
                      <small>{f.desc}</small>
                    </span>
                    <span className="radio" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {isQuick ? (
                <div className="locked">
                  <Lock aria-hidden="true" />
                  <span>
                    Gioco sul totem: <b>Hi-Score · {HI_SCORE_ROUNDS} round</b>
                  </span>
                </div>
              ) : (
                <div className="field-group">
                  <span className="field-l">Gioco sul totem</span>
                  <div className="chips" role="radiogroup" aria-label="Gioco sul totem">
                    {gameModes.map((id) => (
                      <button
                        type="button"
                        key={id}
                        role="radio"
                        className="chip"
                        aria-checked={game.id === id}
                        onClick={() =>
                          set({
                            gameMode: id,
                            ...(d.named ? {} : { name: autoName(d.format, id) }),
                          })
                        }
                      >
                        {games[id].label}
                      </button>
                    ))}
                  </div>
                  <p className="hint">{game.rules}</p>
                </div>
              )}
              {openEvents.length > 0 && (
                <label className="field">
                  Serata (facoltativa)
                  <span className="select">
                    <select value={d.eventId} onChange={(e) => set({ eventId: e.target.value })}>
                      <option value="">Nessuna serata</option>
                      {openEvents.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {e.scheduledAt && ` · ${shortDate(new Date(e.scheduledAt))}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </span>
                </label>
              )}
              {restored && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    writeDraft(null);
                    setD(fresh());
                  }}
                >
                  Ricomincia da capo
                </button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <div className="wz-head">
                <h2 className="wz-title">Chi gioca stasera?</h2>
              </div>
              <div className="search-add">
                <label className="search">
                  <Search aria-hidden="true" />
                  <span className="visually-hidden">Filtra giocatori</span>
                  <input
                    placeholder="Cerca o aggiungi"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn cta"
                  aria-label="Nuovo giocatore"
                  onClick={() => setCreating(true)}
                >
                  <Plus aria-hidden="true" />
                </button>
              </div>
              <div className="roster-tools">
                <Segmented
                  label="Singoli o squadre"
                  small
                  value={d.teamMode ? 'teams' : 'singles'}
                  change={(v) =>
                    set({
                      teamMode: v === 'teams',
                      teams:
                        v === 'teams'
                          ? syncTeams(
                              [],
                              picked.map((p) => p.id),
                            )
                          : [],
                      assigned: {},
                      unevenOk: false,
                    })
                  }
                  options={[
                    { id: 'singles', label: 'Singoli' },
                    { id: 'teams', label: 'Squadre' },
                  ]}
                />
                {players.length > 1 && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() =>
                      set({
                        picked:
                          picked.length === players.length
                            ? []
                            : [
                                ...picked,
                                ...players.filter((p) => !picked.some((x) => x.id === p.id)),
                              ],
                        assigned: {},
                      })
                    }
                  >
                    {picked.length === players.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
                  </button>
                )}
              </div>
              <div className="roster" role="group" aria-label="Seleziona partecipanti">
                {shown.map((p) => {
                  const seed = picked.findIndex((x) => x.id === p.id);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className="pl"
                      aria-pressed={seed >= 0}
                      onClick={() => toggle(p)}
                    >
                      <Avatar name={p.displayName} avatar={p.avatar} />
                      <span>
                        <b>{p.displayName}</b>
                        <small>
                          {[p.nickname && `“${p.nickname}”`, seed >= 0 ? `seed ${seed + 1}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <span className="chk" aria-hidden="true">
                        {seed >= 0 && <Check />}
                      </span>
                    </button>
                  );
                })}
                {roster.data && !players.length && (
                  <p className="hint">Nessun giocatore: crea il primo con +.</p>
                )}
              </div>
              <ErrorMessage error={roster.error} retry={() => void roster.refetch()} />
              {d.teamMode && (
                <>
                  <TeamBuilder
                    players={picked}
                    teams={d.teams}
                    change={(next) => set({ teams: next, assigned: {}, unevenOk: false })}
                    disabled={locked}
                  />
                  <p className="hint">
                    Una squadra è un solo partecipante: un posto sul totem, una riga in classifica.
                  </p>
                  {uneven && (
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={d.unevenOk}
                        onChange={(e) => set({ unevenOk: e.target.checked })}
                      />
                      Squadre disomogenee ({check!.sizes.join(' · ')} giocatori): confermo la
                      composizione
                    </label>
                  )}
                </>
              )}
            </>
          )}
          {step === 3 && !isGroups && (
            <>
              <div className="wz-head">
                <h2 className="wz-title">Come salgono al totem?</h2>
              </div>
              <div className="card combo">
                <div>
                  <strong>{combo}</strong>
                  <span>
                    {heatPlan.length} manche · {seats} posti al totem
                  </span>
                </div>
                <StepperControl
                  label="Posti al totem"
                  less="Meno posti"
                  more="Più posti"
                  value={seats}
                  change={(v) => set({ seats: v })}
                  min={isSingle ? Math.min(limits.min, limits.seats) : 2}
                  max={limits.seats}
                />
              </div>
              {heatPlan.length > 1 && (
                <div className="field-group">
                  <span className="field-l">Distribuzione</span>
                  <Segmented
                    label="Distribuzione nelle manche"
                    value={d.heatStrategy}
                    change={(v) => set({ heatStrategy: v })}
                    options={(Object.keys(strategyLabels) as Strategy[]).map((id) => ({
                      id,
                      label: strategyLabels[id],
                    }))}
                  />
                  <p className="hint">{strategyHints[d.heatStrategy]}</p>
                </div>
              )}
              <div className="inline-field">
                <span className="field-l">Ordine di tiro</span>
                <Segmented
                  label="Ordine di tiro"
                  small
                  value={d.order}
                  change={(v) => set({ order: v })}
                  options={[
                    { id: 'registration', label: 'Iscrizione' },
                    { id: 'seed', label: 'Seed' },
                  ]}
                />
              </div>
              <ol className="heats" aria-label="Anteprima delle manche">
                {heatPlan.map((ids, h) => (
                  <li key={h} className="heat">
                    <div className="heat-h">
                      <strong>M{h + 1}</strong>
                      <span>
                        {ids.length} {ids.length === 1 ? 'partecipante' : unitWord}
                      </span>
                      {ids.length === 1 && heatPlan.length > 1 && (
                        <span className="chip warn">gioca da solo</span>
                      )}
                    </div>
                    <div className="seats">
                      {Array.from({ length: seats }, (_, i) => {
                        const u = units.find((x) => x.key === ids[i]);
                        return u ? (
                          <span key={i} className="seat">
                            <Avatar name={u.label} size="xs" />
                            {u.label.split(' ')[0]}
                          </span>
                        ) : (
                          <span key={i} className="seat empty">
                            libero
                          </span>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {step === 3 && isGroups && (
            <>
              <div className="wz-head">
                <h2 className="wz-title">Come si dividono?</h2>
                <p>Tutti contro tutti nei gironi, poi tabellone a eliminazione diretta.</p>
              </div>
              <div className="card">
                <Stepper
                  label="Numero gironi"
                  hint="Distribuzione a serpentina sui seed"
                  value={d.groups}
                  change={(v) => set({ groups: v })}
                  max={16}
                />
                <Stepper
                  label="Qualificati per girone"
                  hint="Accedono al tabellone"
                  value={d.perGroup}
                  change={(v) => set({ perGroup: v })}
                  max={16}
                />
              </div>
              <div className="field-group">
                <span className="field-l">Composizione</span>
                <Segmented
                  label="Composizione gironi"
                  value={d.manual ? 'manual' : 'auto'}
                  change={(v) =>
                    // Manual composition starts from the automatic one.
                    set({
                      manual: v === 'manual',
                      ...(v === 'manual' && composition
                        ? {
                            assigned: Object.fromEntries(
                              composition.flatMap((ids, g) => ids.map((id) => [id, g])),
                            ),
                          }
                        : {}),
                    })
                  }
                  options={[
                    { id: 'auto', label: 'Automatica' },
                    { id: 'manual', label: 'Manuale' },
                  ]}
                />
                <p className="hint">
                  {d.manual
                    ? 'Scegli il girone di ogni iscritto: ognuno in un solo girone.'
                    : 'Anteprima della serpentina. Il sorteggio casuale non è previsto.'}
                </p>
              </div>
              {composition && (
                <div
                  className="group-preview"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(d.groups, 2)}, minmax(0, 1fr))`,
                  }}
                >
                  {composition.map((ids, g) => (
                    <div key={g}>
                      <strong>{groupName(g)}</strong>
                      {ids.map((id) => {
                        const p = units.find((x) => x.key === id)!;
                        const seed = units.indexOf(p) + 1;
                        return d.manual ? (
                          <label key={id} className="assign">
                            <span className="visually-hidden">Girone di {p.label}</span>
                            <select
                              value={g}
                              onChange={(e) =>
                                set({ assigned: { ...d.assigned, [id]: Number(e.target.value) } })
                              }
                            >
                              {Array.from({ length: d.groups }, (_, k) => (
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
              <div className="inline-field">
                <span className="field-l">Ordine di gioco</span>
                <Segmented
                  label="Ordine di gioco"
                  small
                  value={d.order}
                  change={(v) => set({ order: v })}
                  options={[
                    { id: 'registration', label: 'Iscrizione' },
                    { id: 'seed', label: 'Seed' },
                  ]}
                />
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <div className="wz-head">
                <h2 className="wz-title">
                  {isQuick
                    ? 'Finale e registrazione'
                    : isGroups
                      ? 'Punti e registrazione'
                      : 'Registrazione'}
                </h2>
              </div>
              {isQuick && (
                <div className="card pad">
                  <div className="final-row">
                    <div>
                      <span className="field-l">Finale</span>
                      <b>Migliori {d.qualifiers} in finale</b>
                    </div>
                    <StepperControl
                      label="Migliori alla finale"
                      less="Meno finalisti"
                      more="Più finalisti"
                      value={d.qualifiers}
                      change={(v) => set({ qualifiers: v })}
                      min={2}
                      max={64}
                    />
                  </div>
                  <p className="hint">
                    {n > 0 && n < d.qualifiers
                      ? `Con ${n} iscritti (meno di ${d.qualifiers}) non c’è qualifica: tutti giocano direttamente la finale.`
                      : 'Finale nuova: i punti della qualifica non si sommano.'}
                  </p>
                </div>
              )}
              {isGroups && (
                <div className="card pad">
                  <span className="field-l">Punti in classifica</span>
                  <div className="point-grid">
                    {(
                      [
                        ['Vittoria', 'win'],
                        ['Pareggio', 'draw'],
                        ['Sconfitta', 'loss'],
                      ] as const
                    ).map(([label, key]) => (
                      <div key={key}>
                        <span className="hint">{label}</span>
                        <StepperControl
                          label={label}
                          value={d[key]}
                          change={(v) => set({ [key]: v })}
                          min={0}
                          max={100}
                        />
                      </div>
                    ))}
                  </div>
                  {game.drawPossible ? (
                    <div className="switch-row">
                      <span>
                        <span id="draws-label">Pareggi ammessi</span>
                        <small>
                          {d.allowDraws
                            ? 'Un pari assegna i punti del pareggio'
                            : 'Un pari si decide con uno spareggio'}
                        </small>
                      </span>
                      <Switch
                        checked={d.allowDraws}
                        change={(v) => set({ allowDraws: v })}
                        labelledBy="draws-label"
                      />
                    </div>
                  ) : (
                    <p className="hint">
                      {game.label}: il totem indica sempre un vincitore, niente pareggi.
                    </p>
                  )}
                </div>
              )}
              <div className="field-group">
                <span className="field-l">Registrazione</span>
                <div className="choice" role="radiogroup" aria-label="Registrazione">
                  {(['ROUND_BY_ROUND', 'FLEXIBLE', 'FINAL_ONLY'] as Tracking[]).map((id) => (
                    <button
                      type="button"
                      role="radio"
                      key={id}
                      aria-checked={d.tracking === id}
                      className="opt plain"
                      onClick={() => set({ tracking: id })}
                    >
                      <span>
                        <b>{trackingLabels[id]}</b>
                        <small>{trackingHints[id]}</small>
                      </span>
                      <span className="radio" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
              {game.scoring === 'remaining' && d.tracking !== 'FINAL_ONLY' && (
                <div className="inline-field">
                  <span className="field-l">Valore del turno</span>
                  <Segmented
                    label="Valore di ogni turno"
                    small
                    value={d.x01Entry}
                    change={(v) => set({ x01Entry: v })}
                    options={[
                      { id: 'SCORED', label: 'Punti fatti' },
                      { id: 'REMAINING', label: 'Punti rimasti' },
                    ]}
                  />
                </div>
              )}
              <p className="note">
                <Info aria-hidden="true" />
                <span>
                  Parità decisiva: spareggio sul totem o decisione dell’organizzatore, registrata
                  nello storico. Nessun sorteggio nascosto.
                </span>
              </p>
            </>
          )}
          {step === 5 && (
            <>
              <div className="wz-head">
                <h2 className="wz-title">Pronti a lanciare</h2>
                <p>Tocca Modifica per tornare al passo: le altre scelte restano.</p>
              </div>
              <div className="card">
                {localData && (
                  <SumRow k="Punto di incontro" edit={() => go(1)}>
                    {spaceName || '—'}
                    <small>I risultati saranno conteggiati nella scoreboard {spaceName}.</small>
                  </SumRow>
                )}
                <SumRow k="Torneo" edit={() => go(1)}>
                  {d.name.trim() || '—'}
                  <small>
                    {formatLabel(d.format)} · {game.label}
                    {isQuick ? ` ${HI_SCORE_ROUNDS} round` : ''}
                  </small>
                </SumRow>
                <SumRow k="Giocatori" edit={() => go(2)}>
                  {n} {d.teamMode ? 'squadre' : 'singoli'}
                  <small>
                    {units
                      .slice(0, 4)
                      .map((u) => u.label.split(' ')[0])
                      .join(', ')}
                    {n > 4 ? ` e altri ${n - 4}` : ''}
                  </small>
                </SumRow>
                {isGroups ? (
                  <SumRow k="Gironi" edit={() => go(3)}>
                    {composition?.map((g) => g.length).join(' + ') ?? '—'}
                    <small>
                      {d.groups} gironi · {d.manual ? 'manuale' : 'serpentina'} · top {d.perGroup}{' '}
                      per girone
                    </small>
                  </SumRow>
                ) : (
                  <SumRow k="Manche" edit={() => go(3)}>
                    {combo}
                    <small>
                      {strategyLabels[d.heatStrategy]} · ordine{' '}
                      {d.order === 'seed' ? 'per seed' : 'di iscrizione'}
                    </small>
                  </SumRow>
                )}
                {isQuick && (
                  <SumRow k="Finale" edit={() => go(4)}>
                    Migliori {d.qualifiers}
                    <small>Punti della qualifica azzerati</small>
                  </SumRow>
                )}
                {isGroups && (
                  <SumRow k="Punti" edit={() => go(4)}>
                    V {d.win} · N {d.draw} · P {d.loss}
                    <small>
                      {game.drawPossible && d.allowDraws ? 'Pareggi ammessi' : 'Senza pareggi'}
                    </small>
                  </SumRow>
                )}
                <SumRow k="Registrazione" edit={() => go(4)}>
                  {trackingLabels[d.tracking]}
                </SumRow>
              </div>
              {firstLabel && (
                <div className="card first-up">
                  <Avatar name={firstLabel} />
                  <span>
                    <span className="field-l">Primo al bersaglio</span>
                    <b>
                      {firstLabel} · {isGroups ? 'Girone A' : 'Manche 1'}
                    </b>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="btn ghost"
                disabled={!!reason || save.isPending || !!created}
                onClick={() => save.mutate(false)}
              >
                Salva come bozza (iscrizioni aperte)
              </button>
            </>
          )}
        </fieldset>
        <ErrorMessage error={save.error} />
        {save.error && created && (
          <p className="hint">
            <Link to={`${isQuick ? '/hiscore' : '/tornei'}/${created.id}`}>
              Controlla il torneo salvato
            </Link>{' '}
            prima di crearne uno nuovo.
          </p>
        )}
        {creating && (
          <NewPlayerSheet
            keepOpen
            close={() => setCreating(false)}
            created={(p) => {
              setTouched(true);
              setD((current) => ({ ...current, picked: [...current.picked, p] }));
            }}
          />
        )}
      </main>
      <div className="actionbar foot">
        {step === 2 && (
          <div className="ctx">
            <span>
              <b>{picked.length}</b> selezionati
            </span>
            <span>{heatsHint}</span>
          </div>
        )}
        <button
          type="button"
          className="btn ghost"
          disabled={step === 1 || locked}
          onClick={() => go(step - 1)}
        >
          <ArrowLeft aria-hidden="true" /> Indietro
        </button>
        {step < 5 ? (
          <button
            type="button"
            className="btn cta"
            disabled={!!stepReason(step)}
            onClick={() => go(step + 1)}
          >
            {step === 4 ? 'Riepilogo' : 'Continua'} <ArrowRight aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="btn cta"
            disabled={
              !!reason ||
              save.isPending ||
              (!created && save.error instanceof ApiError && save.error.uncertain)
            }
            onClick={() => save.mutate(true)}
          >
            <Play aria-hidden="true" fill="currentColor" />
            {save.isPending ? 'Avvio…' : created ? 'Riprendi avvio' : 'Avvia torneo'}
          </button>
        )}
        {(step < 5 ? stepReason(step) : reason) && (
          <p className="form-reason" role="status">
            {step < 5 ? stepReason(step) : reason}
          </p>
        )}
      </div>
    </>
  );
}

function SumRow({ k, edit, children }: { k: string; edit: () => void; children: ReactNode }) {
  return (
    <div className="sum-row">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
      <button type="button" className="edit" aria-label={`Modifica ${k}`} onClick={edit}>
        <Pencil aria-hidden="true" /> Modifica
      </button>
    </div>
  );
}
