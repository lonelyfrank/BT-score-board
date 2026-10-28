import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Info,
  LayoutGrid,
  ListOrdered,
  MoveRight,
  Pause,
  Play,
  SkipForward,
  SlidersHorizontal,
  Target,
  Undo2,
  Users,
} from 'lucide-react';
import { CrownIcon } from '../components/BrandIcons';
import { NavigationSurface } from '../components/BottomNavigation';
import { DartCell, DartPad } from '../components/DartPad';
import { HeatEditor, HeatTabs, viewedHeat } from '../components/Heats';
import { NumberKeypad } from '../components/NumberKeypad';
import { RotationManager } from '../components/Rounds';
import {
  Avatar,
  ErrorMessage,
  Header,
  InBar,
  Modal,
  ScreenBars,
  Segmented,
  StatusChip,
  scrollToTop,
  statusLabel,
} from '../components/ui';
import { api, storage, type Match, type MatchAction, type Tournament } from '../services/api';
import {
  confirmation,
  emptyInput,
  parseTurnDraft,
  type DartInput,
  type EntryMode,
  type Plan,
} from '../services/guided';
import { canOrganizeMatch, gameOf, seatOf, sideOf, type GameMode } from '../services/rules';
import { tournamentPath } from '../services/session';
import { ResultEntry } from './Result';
import { entryName } from './Tournaments';

type Tab = 'live' | 'matrice' | 'classifica' | 'risultati';
type Slot = { entryId: string; round: number };
type Progress = Match['progress'][number];
type RoundView = Progress['rounds'][number];
type Toast = { text: ReactNode; undo?: Slot; tone?: 'warn' };
type HeatRow = Match['heatOverview']['heats'][number];

const tabs: [Tab, string, typeof Target][] = [
  ['live', 'Live', Target],
  ['matrice', 'Matrice', LayoutGrid],
  ['classifica', 'Classifica', ListOrdered],
  ['risultati', 'Risultati', ClipboardCheck],
];
const vibrate = (ms = 12) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* No haptics. */
  }
};
const sameSlot = (a: Slot | null | undefined, b: Slot | null | undefined) =>
  !!a && !!b && a.entryId === b.entryId && a.round === b.round;
/** Short label in tight rows: the first name, a team's name whole. */
const first = (name: string) => (name.includes(' + ') ? name : (name.split(' ')[0] ?? name));
const planOf = (m: Match, heatId: string | null | undefined) =>
  m.turnPlans.find((p) => p.heatId === (heatId ?? null)) ?? m.turnPlans[0]!;

/** One command on the match at a time: a second tap while the first is saving is ignored. */
function useMatchCommand(m: Match, done?: (fresh: Match) => void) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: MatchAction; body: Record<string, unknown> }) =>
      api.matchCommand(m, action, body),
    onSuccess: (fresh) => {
      client.setQueryData(['match', m.id], fresh);
      void client.invalidateQueries({ queryKey: ['tournament', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['standings', fresh.tournamentId] });
      void client.invalidateQueries({ queryKey: ['session'] });
      done?.(fresh);
    },
    // Another tab or device moved on: show what is stored now.
    onError: () => void client.invalidateQueries({ queryKey: ['match', m.id] }),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const run = (
    action: MatchAction,
    body: Record<string, unknown>,
    after?: (fresh: Match) => void,
  ) => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate({ action, body }, { onSuccess: after });
  };
  return { run, busy: mutation.isPending, error: mutation.error, reset: mutation.reset };
}

/** Names and per-entry facts every tab needs. */
function useNames(m: Match, t: Tournament | undefined) {
  const entry = (id: string) => t?.entries.find((e) => e.id === id);
  const name = (id: string) => (t ? entryName(t, id) : 'Giocatore');
  const member = (playerId: string | null) =>
    (playerId &&
      t?.entries.flatMap((e) => e.members).find((x) => x.playerId === playerId)?.displayName) ||
    null;
  const progress = (id: string) => m.progress.find((p) => p.tournamentEntryId === id);
  /** Who throws a turn: the member noted or expected, else the unit's name. */
  const thrower = (slot: { entryId: string; playerId?: string | null } | null) =>
    slot ? (member(slot.playerId ?? null) ?? name(slot.entryId)) : '';
  return { entry, name, member, progress, thrower };
}

/** Progressive value of an entry as the game reads it, or null when nothing is recorded. */
function metricOf(m: Match, p: Progress | undefined) {
  const g = gameOf(m);
  if (p?.partialValue != null) return p.partialValue;
  return g.scoring === 'remaining' ? g.startingScore : null;
}
/** Better first: most points, or fewest left in X01. */
function byValue(m: Match) {
  const lower = gameOf(m).scoring === 'remaining';
  return (a: number | null, b: number | null) =>
    a === null ? (b === null ? 0 : 1) : b === null ? -1 : lower ? a - b : b - a;
}
/** Leader of the seats, by the provisional values (never official). */
function leaderOf(m: Match, seats: string[], progress: (id: string) => Progress | undefined) {
  const g = gameOf(m);
  if (g.scoring === 'progress' || g.scoring === 'distance') return null;
  let best: string | null = null;
  let value: number | null = null;
  let tied = false;
  for (const id of seats) {
    const p = progress(id);
    if (!p || p.partialValue === null) continue;
    const v = p.partialValue;
    if (value === v) tied = true;
    else if (value === null || (g.scoring === 'remaining' ? v < value : v > value)) {
      value = v;
      best = id;
      tied = false;
    }
  }
  // Level at the top: no crown.
  return tied ? null : best;
}
/** Columns of the round matrix: the rounds of the game, or as many as were played. */
function columnsOf(plan: Plan, progress: (id: string) => Progress | undefined) {
  return (
    plan.rounds ?? Math.max(plan.round, ...plan.seats.map((id) => progress(id)?.rounds.length ?? 0))
  );
}

/**
 * The match screen with progressive tracking: the turn at the board (Live), the round matrix,
 * the provisional ranking and the official results, under the match's own floating bar. The
 * global navigation stays out of the match, so it never competes with the keypad.
 */
export function GuidedMatch({
  query,
  tournament,
}: {
  query: UseQueryResult<Match>;
  tournament: UseQueryResult<Tournament>;
}) {
  const m = query.data!;
  const t = tournament.data;
  const game = gameOf(m);
  const [params, setParams] = useSearchParams();
  const [organizing, setOrganizing] = useState(() => params.get('organize') === '1');
  const tab = (tabs.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'live') as Tab;
  const [heatChoice, setHeatChoice] = useState<string | null>(null);
  const [focus, setFocus] = useState<Slot | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [controls, setControls] = useState(false);
  const [top, setTop] = useState<HTMLDivElement | null>(null);
  const [bottom, setBottom] = useState<HTMLDivElement | null>(null);
  const go = (next: Tab) => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('tab', next);
        n.delete('organize');
        return n;
      },
      { replace: true },
    );
    scrollToTop();
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'warn' ? 2400 : 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const overview = m.heatOverview;
  const heated = overview.heats.filter((h) => h.status !== 'cancelled').length > 1;
  // Live follows the heat at the board; matrix and ranking the heat chosen in their tabs.
  const liveHeat = heated ? viewedHeat(overview, null) : null;
  const heat = heated ? (tab === 'live' ? liveHeat : viewedHeat(overview, heatChoice)) : null;
  const plan = planOf(m, heat?.heatId);
  const undo = useMatchCommand(m);
  const names = useNames(m, t);
  const single = t?.mode === 'SINGLE_MATCH';
  const stage = t?.stages.find((s) => s.id === m.stageId);
  const isFinal = stage?.kind === 'final';
  const back = !t
    ? '/'
    : single
      ? '/tornei'
      : `${tournamentPath(t)}${t.mode === 'QUICK_HIGH_SCORE' && isFinal ? '?tab=final' : ''}`;
  const stageLabel = single ? 'Partita singola' : statusLabel(m.matchType);
  const title =
    tab === 'matrice' ? 'Matrice' : tab === 'classifica' ? 'Classifica' : (t?.name ?? game.label);
  const subtitle =
    tab === 'matrice'
      ? `${stageLabel} · ${m.participants.length} ${m.participants.length === 1 ? 'giocatore' : 'giocatori'}${heated ? ` in ${overview.heats.length} manche` : ''}`
      : tab === 'classifica'
        ? `${stageLabel} · aggiornata a ogni turno`
        : [
            single ? game.label : stageLabel,
            liveHeat && tab === 'live'
              ? `Manche ${liveHeat.number} di ${overview.heats.length}`
              : null,
            m.status === 'completed' ? 'risultato registrato' : null,
          ]
            .filter(Boolean)
            .join(' · ');
  const takeBack = () =>
    undo.run('turns/guide', { action: 'undo', heatId: plan.heatId }, (fresh) => {
      const freshPlan = fresh.turnPlans.find((p) => p.heatId === plan.heatId);
      setToast({
        text: (
          <>
            Avanzamento annullato: torna <b>{names.thrower(freshPlan?.current ?? null)}</b>
          </>
        ),
      });
    });
  const canOrganize = t?.status === 'active' && canOrganizeMatch(m);
  return (
    <ScreenBars.Provider value={{ top, bottom }}>
      <div className="screen match-screen">
        <Header
          title={title}
          subtitle={subtitle}
          back={back}
          backLabel="Indietro al torneo"
          action={
            tab === 'live' && m.status !== 'completed' && m.status !== 'cancelled' ? (
              <button
                type="button"
                className="ibtn box"
                aria-label="Controlli del turno"
                onClick={() => setControls(true)}
              >
                <SlidersHorizontal />
              </button>
            ) : undefined
          }
        />
        {organizing && (
          <HeatEditor
            m={m}
            name={(id) => (t ? entryName(t, id) : 'Giocatore')}
            close={() => {
              setOrganizing(false);
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  next.delete('organize');
                  return next;
                },
                { replace: true },
              );
            }}
          />
        )}
        <div className="toolbar" ref={setTop} />
        <main className={`match-main tab-${tab}`}>
          {tab === 'live' && (
            <GuidedLive
              key={plan.heatId ?? 'match'}
              m={m}
              t={t}
              plan={plan}
              heated={heated}
              controls={controls}
              setControls={setControls}
              notify={setToast}
              go={go}
              review={(heatId) => {
                setHeatChoice(heatId);
                go('matrice');
              }}
              organize={canOrganize ? () => setOrganizing(true) : undefined}
            />
          )}
          {tab === 'matrice' && (
            <RoundMatrix
              m={m}
              t={t}
              plan={plan}
              heat={heat}
              heated={heated}
              selectHeat={(id) => setHeatChoice(id)}
              open={setFocus}
              organize={canOrganize ? () => setOrganizing(true) : undefined}
            />
          )}
          {tab === 'classifica' && (
            <LiveBoard m={m} t={t} plan={plan} heated={heated} heat={heat} />
          )}
          {tab === 'risultati' && (
            <GuidedResults
              m={m}
              t={t}
              plan={plan}
              query={query}
              tournament={tournament}
              review={(entryId) => {
                const p = names.progress(entryId);
                const round = p?.rounds.find((r) => r.status !== 'recorded')?.round ?? 1;
                setFocus({ entryId, round });
                go('matrice');
              }}
            />
          )}
          <ErrorMessage error={undo.error} />
        </main>
        <div className="actionbar" ref={setBottom} />
        {focus && tab === 'matrice' && (
          <CellSheet
            key={`${focus.entryId}:${focus.round}`}
            m={m}
            t={t}
            plan={planOf(m, heat?.heatId)}
            slot={focus}
            close={() => setFocus(null)}
            go={(next) => {
              setFocus(null);
              go(next);
            }}
            notify={setToast}
          />
        )}
        {toast && (
          <div className={`toast ${toast.tone ?? ''}`} role="status">
            {toast.tone === 'warn' ? (
              <Info aria-hidden="true" />
            ) : (
              <CircleCheck aria-hidden="true" />
            )}
            <span>{toast.text}</span>
            {toast.undo && sameSlot(plan.undoable, toast.undo) && (
              <button type="button" disabled={undo.busy} onClick={takeBack}>
                Annulla
              </button>
            )}
          </div>
        )}
        <MatchNavigation tab={tab} go={go} attention={plan.gaps.length > 0} />
      </div>
    </ScreenBars.Provider>
  );
}

/** The match's floating glass bar: four destinations of the match only. */
function MatchNavigation({
  tab,
  go,
  attention,
}: {
  tab: Tab;
  go: (tab: Tab) => void;
  attention: boolean;
}) {
  const i = tabs.findIndex(([id]) => id === tab);
  return (
    <>
      <div className="nav-scrim" aria-hidden="true" />
      <NavigationSurface
        current={i}
        count={tabs.length}
        className="bottom-nav match-nav"
        label="Navigazione della partita"
      >
        {tabs.map(([id, label, Icon]) => (
          <a
            key={id}
            href={`?tab=${id}`}
            className="bt-nav-item"
            aria-current={id === tab ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              vibrate(8);
              go(id);
            }}
          >
            <Icon aria-hidden="true" strokeWidth={2} />
            <span>{label}</span>
            {id === 'matrice' && attention && (
              <i className="nav-dot" aria-label="round da verificare" />
            )}
          </a>
        ))}
      </NavigationSurface>
    </>
  );
}

/** Heats whose end was acknowledged: "Inizia manche" was tapped, the call screen is gone. */
const calledKey = (m: Match) => `bt-heat-called:${m.id}`;
function calledHeats(m: Match): string[] {
  try {
    return JSON.parse(storage.get(calledKey(m)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Guided entry of the turn at the board: who throws, three darts or the total, confirm. */
function GuidedLive({
  m,
  t,
  plan,
  heated,
  controls,
  setControls,
  notify,
  go,
  review,
  organize,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  heated: boolean;
  controls: boolean;
  setControls: (open: boolean) => void;
  notify: (toast: Toast) => void;
  go: (tab: Tab) => void;
  review: (heatId: string | null) => void;
  organize?: () => void;
}) {
  const game = gameOf(m);
  const spec = m.trackingSpec;
  const x01 = game.scoring === 'remaining';
  const progressKind = spec.kind === 'progress';
  const names = useNames(m, t);
  const current = plan.current;
  const modeKey = `bt-turn-mode:${m.id}`;
  const draftKey = `bt-turn:${m.id}`;
  const draftFor = (slot: Slot | null) => {
    const d = parseTurnDraft(storage.get(draftKey));
    return d && sameSlot(d, slot) ? d : null;
  };
  const [mode, setModeState] = useState<EntryMode>(() =>
    progressKind
      ? 'quick'
      : (draftFor(current)?.mode ?? (storage.get(modeKey) === 'quick' ? 'quick' : 'detail')),
  );
  const [input, setInput] = useState<DartInput>(() => {
    const d = draftFor(current);
    return d
      ? {
          ...emptyInput(),
          darts: d.darts,
          sel: Math.max(
            0,
            d.darts.findIndex((x) => !x),
          ),
        }
      : emptyInput();
  });
  const [quick, setQuick] = useState(() => draftFor(current)?.quick ?? '');
  const [hint, setHint] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [called, setCalled] = useState(() => calledHeats(m));
  const setMode = (next: EntryMode) => {
    setModeState(next);
    storage.set(modeKey, next);
  };
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), 2400);
    return () => clearTimeout(timer);
  }, [hint]);
  // A new turn at the board (saved, undone, moved by another tab): its own draft or nothing.
  const slotKey = current ? `${current.entryId}:${current.round}` : '';
  const shown = useRef(slotKey);
  useEffect(() => {
    if (shown.current === slotKey) return;
    shown.current = slotKey;
    const d = draftFor(current);
    setInput(d ? { ...emptyInput(), darts: d.darts } : emptyInput());
    setQuick(d?.quick ?? '');
  }, [slotKey]);
  // Typed darts and digits survive a reload, with the turn they belong to.
  useEffect(() => {
    if (!current) return;
    if (!quick && input.darts.every((d) => !d)) storage.remove(draftKey);
    else
      storage.set(
        draftKey,
        JSON.stringify({
          entryId: current.entryId,
          round: current.round,
          mode,
          darts: input.darts,
          quick,
        }),
      );
  }, [input, quick, mode, current, draftKey]);

  const client = useQueryClient();
  const record = useMatchCommand(m);
  const guide = useMatchCommand(m);
  const busy = record.busy || guide.busy;
  const interrupted = plan.state === 'interrupted';
  const round = current?.round ?? plan.round;
  const ctx = { game: m.gameMode as GameMode, round, remaining: x01 ? plan.before : null };
  const max =
    spec.kind === 'remaining'
      ? (game.startingScore ?? 501)
      : (spec.max[Math.min(round, spec.max.length) - 1] ?? spec.max[0] ?? 180);
  const c = confirmation({
    ctx,
    kind: spec.kind,
    x01,
    before: progressKind ? null : plan.before,
    mode,
    darts: input.darts,
    quick,
    max,
  });
  const unit = current ? names.entry(current.entryId) : undefined;
  const team = (unit?.members.length ?? 0) > 1;
  const throwerName = names.thrower(current);
  const paused = m.guide?.paused ?? false;
  const leader = leaderOf(m, plan.seats, names.progress);
  const side = current ? sideOf(m.gameMode as GameMode, seatOf(m, current.entryId)) : null;
  const overview = m.heatOverview;
  const heatRow = overview.heats.find((h) => h.heatId === plan.heatId);

  function confirm() {
    if (!current || !c.ok || busy || interrupted) return;
    const saving = current;
    const who = throwerName;
    record.run(
      'turns/record',
      {
        entryId: saving.entryId,
        round: saving.round,
        ...(c.value !== undefined ? { value: c.value } : {}),
        ...(c.darts ? { darts: c.darts } : {}),
        ...(c.reason ? { reason: c.reason } : {}),
      },
      (fresh) => {
        vibrate();
        storage.remove(draftKey);
        setInput(emptyInput());
        setQuick('');
        const view = fresh.progress
          .find((p) => p.tournamentEntryId === saving.entryId)
          ?.rounds.find((r) => r.round === saving.round);
        const after = fresh.progress.find(
          (p) => p.tournamentEntryId === saving.entryId,
        )?.partialValue;
        notify({
          text: (
            <>
              <b>{who}</b> ·{' '}
              {view?.value === null || view?.value === undefined
                ? view?.state === 'partial'
                  ? 'turno parziale, da verificare'
                  : 'non osservato'
                : view.bust
                  ? 'bust, il turno vale 0'
                  : progressKind
                    ? `numero ${view.value}`
                    : spec.kind === 'remaining'
                      ? `restano ${view.value}`
                      : `${view.value} registrato`}
              {after != null && !progressKind && spec.kind !== 'remaining'
                ? ` · ${x01 ? 'residuo' : 'totale'} ${after}`
                : ''}
            </>
          ),
          undo: { entryId: saving.entryId, round: saving.round },
        });
      },
    );
  }
  const command = (body: Record<string, unknown>, text?: ReactNode) =>
    guide.run('turns/guide', { heatId: plan.heatId, ...body }, () => {
      setControls(false);
      setPicking(false);
      if (text) notify({ text });
    });
  const skip = () => {
    if (!current) return;
    const who = throwerName;
    const saving = current;
    record.run(
      'turns/record',
      { entryId: saving.entryId, round: saving.round, value: null },
      () => {
        setControls(false);
        setInput(emptyInput());
        setQuick('');
        notify({
          text: (
            <>
              Turno di <b>{who}</b> saltato: da verificare a fine manche
            </>
          ),
          undo: saving,
        });
      },
    );
  };
  /** X01 without darts: the totem shows a bust, the turn is worth nothing. */
  const declareBust = () => {
    if (!current || busy || interrupted) return;
    const who = throwerName;
    const saving = current;
    record.run('turns/record', { entryId: saving.entryId, round: saving.round, bust: true }, () => {
      vibrate();
      storage.remove(draftKey);
      setInput(emptyInput());
      setQuick('');
      notify({
        text: (
          <>
            <b>{who}</b> · bust, il turno vale 0
          </>
        ),
        undo: saving,
      });
    });
  };
  const undoable = plan.undoable;
  const undoName = undoable
    ? names.thrower({
        entryId: undoable.entryId,
        playerId: names.progress(undoable.entryId)?.rounds[undoable.round - 1]?.playerId ?? null,
      })
    : null;
  const takeBack = () =>
    undoable &&
    command(
      { action: 'undo' },
      <>
        Avanzamento annullato: torna <b>{undoName}</b>
      </>,
    );
  const closed = plan.closed.filter((s) => plan.seats.includes(s.entryId));

  // The heat at the board has thrown every turn, or the next heat waits to be called.
  const previous =
    heated && heatRow && (heatRow.status === 'pending' || heatRow.status === 'ready')
      ? [...overview.heats]
          .filter((h) => h.status === 'completed' && h.number < heatRow.number)
          .sort((a, b) => b.number - a.number)[0]
      : undefined;
  const endOfHeat =
    heated && m.status !== 'completed' && heatRow
      ? plan.state === 'completed'
        ? {
            heat: heatRow,
            plan,
            next: overview.heats.find((h) => h.heatId === overview.nextHeatId),
          }
        : previous && !called.includes(previous.heatId)
          ? { heat: previous, plan: planOf(m, previous.heatId), next: heatRow }
          : null
      : null;

  if (endOfHeat)
    return (
      <HeatEnd
        m={m}
        t={t}
        heat={endOfHeat.heat}
        plan={endOfHeat.plan}
        next={endOfHeat.next}
        go={go}
        review={() => review(endOfHeat.heat.heatId)}
        organize={organize}
        call={() => {
          const list = [...called, endOfHeat.heat.heatId];
          storage.set(calledKey(m), JSON.stringify(list));
          setCalled(list);
        }}
      />
    );
  if (m.status === 'completed' || plan.state === 'completed')
    return (
      <>
        <section className="done-card">
          <span className="done-check" aria-hidden="true">
            <Check strokeWidth={3} />
          </span>
          <h2>
            {plan.shanghai
              ? `Shanghai di ${names.name(plan.shanghai.entryId)}!`
              : m.status === 'completed'
                ? 'Risultato registrato'
                : 'Partita completata'}
          </h2>
          <p className="hint">
            {m.status === 'completed'
              ? 'Il risultato ufficiale del totem è salvato.'
              : `${plan.thrown} turni registrati${plan.gaps.length ? `, ${plan.gaps.length} da verificare` : ''}. Ora serve il risultato ufficiale del totem.`}
          </p>
        </section>
        <InBar at="bottom">
          <div className="acts">
            {plan.gaps.length > 0 && (
              <button type="button" className="btn" onClick={() => go('matrice')}>
                Rivedi i round
              </button>
            )}
            <button type="button" className="btn cta" onClick={() => go('risultati')}>
              {m.status === 'completed' ? 'Vedi il risultato' : 'Inserisci i risultati del totem'}
            </button>
          </div>
        </InBar>
      </>
    );

  const strip = (
    <InBar at="top">
      <div className="strip">
        <span className="rd">
          Round <em>{round}</em>
          {plan.rounds ? `/${plan.rounds}` : ''}
        </span>
        {plan.rounds ? (
          <span className="pips" aria-hidden="true">
            {Array.from({ length: plan.rounds }, (_, r) => (
              <i key={r} className={r + 1 < round ? 'done' : r + 1 === round ? 'on' : ''} />
            ))}
          </span>
        ) : (
          <span className="pips" aria-hidden="true">
            <i className="on" style={{ flex: 'none', width: 24 }} />
          </span>
        )}
        {!progressKind && (
          <Segmented
            label="Registrazione"
            small
            className="strip-seg"
            value={mode}
            change={setMode}
            options={[
              { id: 'detail', label: 'Freccette' },
              { id: 'quick', label: 'Totale' },
            ]}
          />
        )}
      </div>
    </InBar>
  );

  if (!current)
    return (
      <>
        {strip}
        <section className="now paused" aria-live="polite">
          <span className="eb">Rotazione in pausa</span>
          <h2>Chi è al bersaglio?</h2>
        </section>
        <SeatPicker
          m={m}
          plan={plan}
          names={names}
          busy={busy}
          pick={(id) => command({ action: 'pick', entryId: id })}
        />
        <button
          type="button"
          className="btn"
          onClick={() => command({ action: 'resume' })}
          disabled={busy}
        >
          <Play aria-hidden="true" /> Riprendi la rotazione
        </button>
        <ErrorMessage error={record.error ?? guide.error} />
      </>
    );

  // Who throws in this round, in order: done, at the board, next, then the next round.
  const roundOrder = plan.seats.map((id) => {
    const v = names.progress(id)?.rounds[round - 1];
    const state =
      id === current.entryId
        ? 'cur'
        : v && v.status !== 'missing'
          ? 'done'
          : plan.next?.entryId === id && plan.next.round === round
            ? 'next'
            : '';
    return { id, state };
  });
  const after = !plan.next
    ? heated
      ? overview.nextHeatId && overview.nextHeatId !== plan.heatId
        ? `poi Manche ${overview.heats.find((h) => h.heatId === overview.nextHeatId)?.number}`
        : 'fine qualifica'
      : 'fine partita'
    : plan.next.round > round
      ? `poi Round ${plan.next.round}`
      : '';
  const lastTurn = !plan.next;
  const value = metricOf(m, names.progress(current.entryId));
  const meta = [
    // Physical seat on the totem: heats keep their gaps.
    plan.heatId ? `posto ${seatOf(m, current.entryId)}` : null,
    team
      ? current.playerId
        ? `${names.name(current.entryId)} · tiratore ${unit!.members.findIndex((x) => x.playerId === current.playerId) + 1} di ${unit!.members.length}`
        : `${names.name(current.entryId)} · rotazione libera`
      : null,
    game.specialWin === 'SHANGHAI' ? `bersaglio ${round}` : null,
    side,
    game.target && m.result?.targetScore ? `obiettivo ${m.result.targetScore}` : null,
  ].filter(Boolean);
  const chip = c.bust ? (
    <StatusChip tone="warning">BUST</StatusChip>
  ) : c.shanghai ? (
    <StatusChip tone="success">SHANGHAI</StatusChip>
  ) : c.closed ? (
    <StatusChip tone="success">CHIUSURA</StatusChip>
  ) : c.needsTotal ? (
    <StatusChip tone="neutral">DA LEGGERE SUL TOTEM</StatusChip>
  ) : null;
  const ctaLabel = record.busy
    ? 'Salvataggio…'
    : c.shanghai
      ? 'Conferma Shanghai'
      : c.bust
        ? 'Conferma bust'
        : c.closed
          ? 'Conferma chiusura'
          : lastTurn
            ? heated
              ? 'Conferma e chiudi manche'
              : 'Conferma e chiudi partita'
            : c.points !== null && (mode === 'quick' || c.ok)
              ? `Conferma ${c.points}`
              : 'Conferma';

  return (
    <>
      {strip}
      {interrupted && (
        <p className="note warn" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>Torneo o incontro in pausa: riprendilo per registrare i turni.</span>
        </p>
      )}
      {closed.length > 0 && (
        <p className="note">
          <Info aria-hidden="true" />
          <span>
            {closed.map((s) => names.name(s.entryId)).join(', ')} ha chiuso. Se il totem ha finito
            la partita,{' '}
            <button type="button" className="text-link" onClick={() => go('risultati')}>
              registra il risultato
            </button>
            .
          </span>
        </p>
      )}
      <section
        className={`now ${paused ? 'paused' : ''}`}
        aria-label="Al bersaglio"
        aria-live="polite"
      >
        <div className="now-top">
          <Avatar name={throwerName} size="lg" active />
          <div className="who">
            <div className="eb">
              {paused
                ? 'Scelto a mano · rotazione in pausa'
                : lastTurn && heated
                  ? 'Ultimo turno della manche'
                  : 'Al bersaglio'}
            </div>
            <h2>
              {throwerName}
              {leader === current.entryId && <CrownIcon role="img" aria-label="In testa" />}
            </h2>
            {meta.length > 0 && <small>{meta.join(' · ')}</small>}
          </div>
          <div className="tot">
            <small>{progressKind ? 'NUMERO' : x01 ? 'RESIDUO' : 'TOTALE'}</small>
            <strong>{value ?? 0}</strong>
          </div>
        </div>
        <div className="order" aria-label="Ordine di tiro del round">
          {roundOrder.map(({ id, state }) => (
            <span key={id} className={`sq ${state}`}>
              {state === 'done' ? (
                <Check aria-hidden="true" strokeWidth={3} />
              ) : (
                <Avatar name={names.name(id)} size="xs" />
              )}
              {first(state === 'cur' ? throwerName : names.name(id))}
            </span>
          ))}
          {after && <span className="more">{after}</span>}
        </div>
      </section>
      {mode === 'detail' && !progressKind ? (
        <DartPad
          input={input}
          change={setInput}
          ctx={ctx}
          notify={setHint}
          disabled={busy || interrupted}
          submit={confirm}
          summary={
            <div className="tally">
              <span>
                Turno<b>{c.points ?? (c.needsTotal ? '?' : 0)}</b>
              </span>
              {chip}
              <span>
                {x01 ? 'Residuo' : 'Nuovo totale'}
                <b className={c.bust ? 'warn' : ''}>{c.after ?? '—'}</b>
              </span>
            </div>
          }
        />
      ) : (
        <>
          <div className="paper" aria-live="polite">
            <div>
              <output aria-label="Valore del turno da confermare">{quick || '–'}</output>
              <small>
                {progressKind
                  ? 'NUMERO RAGGIUNTO SUL TOTEM'
                  : spec.kind === 'remaining'
                    ? 'PUNTI RIMASTI SUL TOTEM'
                    : quick === ''
                      ? `PUNTI DEL TURNO · MAX ${max}`
                      : c.after !== null
                        ? `${x01 ? 'RESIDUO' : 'NUOVO TOTALE'} ${c.after}`
                        : 'PUNTI DEL TURNO'}
              </small>
            </div>
          </div>
          {x01 && (
            <button
              type="button"
              className="btn sm warn-outline"
              disabled={busy || interrupted}
              onClick={declareBust}
            >
              BUST · il turno non conta, il residuo resta
            </button>
          )}
          <NumberKeypad
            value={quick}
            change={setQuick}
            submit={confirm}
            busy={busy || interrupted}
            maximum={max}
            notify={setHint}
            limitLabel={`Massimo ${max}`}
          />
        </>
      )}
      <ErrorMessage error={record.error ?? guide.error} />
      <InBar at="bottom">
        <div className="acts pair">
          <button
            type="button"
            className="btn undo"
            aria-label={
              undoable ? `Riapri il turno precedente (${undoName})` : 'Nessun turno da riaprire'
            }
            disabled={!undoable || busy}
            onClick={takeBack}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn cta"
            aria-label={`Conferma il turno di ${throwerName}`}
            disabled={!c.ok || busy || interrupted}
            onClick={confirm}
          >
            <span>
              {ctaLabel} {!lastTurn && !record.busy && <ArrowRight aria-hidden="true" />}
            </span>
            {/* A plain reason fits in the button: the keypad keeps the space. */}
            {!hint && c.why && !c.needsTotal && <small role="status">{c.why}</small>}
          </button>
        </div>
        {(hint || (c.why && c.needsTotal)) && (
          <p className="form-reason" role="status">
            {hint ?? c.why}{' '}
            {!hint && c.needsTotal && (
              <button type="button" className="text-link" onClick={() => setMode('quick')}>
                Inserisci il totale
              </button>
            )}
          </p>
        )}
        {c.ok && c.reason && (
          <p className="form-reason warn" role="status">
            Le freccette danno un altro totale: si salva il valore del totem, da verificare.
          </p>
        )}
      </InBar>
      {controls && (
        <Modal
          title={picking ? 'Chi è al bersaglio?' : 'Controlli del turno'}
          subtitle={picking ? undefined : `${throwerName} · round ${round}`}
          close={() => {
            setControls(false);
            setPicking(false);
          }}
        >
          {picking ? (
            <SeatPicker
              m={m}
              plan={plan}
              names={names}
              busy={busy}
              pick={(id) =>
                command(
                  { action: 'pick', entryId: id },
                  <>
                    Al bersaglio: <b>{names.name(id)}</b>
                  </>,
                )
              }
            />
          ) : (
            <div className="list">
              <button type="button" className="act" disabled={busy} onClick={skip}>
                <SkipForward aria-hidden="true" />
                <span>
                  <b>Salta il turno di {throwerName}</b>
                  <small>Resta non osservato, non vale zero</small>
                </span>
              </button>
              <button
                type="button"
                className="act"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                <Users aria-hidden="true" />
                <span>
                  <b>Scegli chi è al bersaglio</b>
                  <small>Cambia turno senza registrare punti</small>
                </span>
              </button>
              {team && (
                <div className="act static">
                  <Users aria-hidden="true" />
                  <span>
                    <b>Tiratore di {names.name(current.entryId)}</b>
                    <RotationManager
                      m={m}
                      entryId={current.entryId}
                      playerName={(id) => names.member(id) ?? 'Giocatore'}
                      disabled={busy}
                      saved={(fresh) => client.setQueryData(['match', m.id], fresh)}
                    />
                  </span>
                </div>
              )}
              <button type="button" className="act" disabled={!undoable || busy} onClick={takeBack}>
                <Undo2 aria-hidden="true" />
                <span>
                  <b>Annulla l’ultimo avanzamento</b>
                  <small>
                    {undoable
                      ? `Torna a ${undoName}, round ${undoable.round}: il valore resta nello storico`
                      : 'Nessun turno da annullare'}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="act"
                disabled={busy}
                onClick={() => command({ action: paused ? 'resume' : 'pause' })}
              >
                {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                <span>
                  <b>{paused ? 'Riprendi la rotazione' : 'Metti in pausa la rotazione'}</b>
                  <small>
                    {paused
                      ? 'Dopo ogni conferma passa al successivo'
                      : 'Dopo ogni conferma scegli tu chi tira'}
                  </small>
                </span>
              </button>
              {organize && (
                <button
                  type="button"
                  className="act"
                  onClick={() => {
                    setControls(false);
                    organize();
                  }}
                >
                  <ListOrdered aria-hidden="true" />
                  <span>
                    <b>Organizza manche</b>
                    <small>Ordine e composizione delle manche in attesa</small>
                  </span>
                </button>
              )}
              <ErrorMessage error={guide.error ?? record.error} />
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/**
 * A heat has thrown every turn: its provisional ranking, who to call to the totem next. The
 * next heat starts once the totem's totals of this one are recorded (they are the official
 * values); the organizer can still change the next heat before calling it.
 */
function HeatEnd({
  m,
  t,
  heat,
  plan,
  next,
  go,
  review,
  organize,
  call,
}: {
  m: Match;
  t: Tournament | undefined;
  heat: HeatRow;
  plan: Plan;
  next: HeatRow | undefined;
  go: (tab: Tab) => void;
  review: () => void;
  organize?: () => void;
  call: () => void;
}) {
  const names = useNames(m, t);
  const order = byValue(m);
  const value = (id: string) => m.result?.scores[id] ?? metricOf(m, names.progress(id));
  const ranked = [...plan.seats].sort((a, b) => order(value(a), value(b)));
  // Provisional place over the whole match: every value recorded so far.
  const all = m.participants
    .map((p) => value(p.tournamentEntryId))
    .filter((v): v is number => v !== null);
  const cut = t?.mode === 'QUICK_HIGH_SCORE' ? t.tournamentConfiguration.qualifiers : null;
  const place = (id: string) => {
    const v = value(id);
    return v === null ? null : 1 + all.filter((x) => order(x, v) < 0).length;
  };
  const missing = heat.missing.filter((id) => plan.seats.includes(id));
  const nextPlayers = next ? next.entryIds : [];
  return (
    <>
      <div className="heat-end-head">
        <span className="marker">Manche {heat.number} chiusa!</span>
        <p className="hint">
          {plan.thrown} turni per {plan.seats.length}{' '}
          {plan.seats.length === 1 ? 'giocatore' : 'giocatori'} ·{' '}
          {plan.gaps.length ? `${plan.gaps.length} da verificare` : 'nessun turno da verificare'}
          {missing.length ? ` · ${missing.length} totali del totem da inserire` : ''}
        </p>
      </div>
      <section className="card heat-rank" aria-label="Risultato della manche">
        {ranked.map((id, i) => {
          const p = place(id);
          return (
            <div key={id} className={`rk ${i === 0 ? 'gold' : ''}`}>
              <span className={`n ${i < 4 ? `r${i + 1}` : ''}`}>{i + 1}</span>
              <Avatar name={names.name(id)} size="md" />
              <span className="nm">
                <b>{names.name(id)}</b>
                <small>
                  {p === null
                    ? 'nessun valore'
                    : `${p}° provvisorio${isHeated(m) ? ' in qualifica' : ''}${cut && p <= cut ? ' · in finale' : ''}`}
                </small>
              </span>
              <strong>{value(id) ?? '—'}</strong>
            </div>
          );
        })}
      </section>
      {next && (
        <section className="now call" aria-label="Prossima manche">
          <div className="call-head">
            <span className="field-l">Chiama al totem</span>
            <strong>MANCHE {next.number}</strong>
          </div>
          <div className="call-seats">
            {nextPlayers.map((id, i) => (
              <div key={id} className={i === 0 ? 'lead' : ''}>
                <Avatar name={names.name(id)} active={i === 0} />
                <b>{names.name(id)}</b>
                <small>{i === 0 ? 'TIRA PER PRIMO' : `${i + 1}°`}</small>
              </div>
            ))}
          </div>
          {organize && (
            <button type="button" className="text-link" onClick={organize}>
              Cambia giocatori o ordine
            </button>
          )}
        </section>
      )}
      <InBar at="bottom">
        <div className="acts split">
          <button type="button" className="btn" onClick={review}>
            Rivedi M{heat.number}
          </button>
          {missing.length ? (
            <button type="button" className="btn cta" onClick={() => go('risultati')}>
              Totali del totem <ArrowRight aria-hidden="true" />
            </button>
          ) : next ? (
            <button type="button" className="btn cta" onClick={call}>
              Inizia Manche {next.number} <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="btn cta" onClick={() => go('risultati')}>
              Vedi i risultati <ArrowRight aria-hidden="true" />
            </button>
          )}
        </div>
      </InBar>
    </>
  );
}
const isHeated = (m: Match) =>
  m.heatOverview.heats.filter((h) => h.status !== 'cancelled').length > 1;

function SeatPicker({
  m,
  plan,
  names,
  busy,
  pick,
}: {
  m: Match;
  plan: Plan;
  names: ReturnType<typeof useNames>;
  busy: boolean;
  pick: (entryId: string) => void;
}) {
  return (
    <div className="list">
      {plan.seats.map((id, i) => {
        const done = plan.closed.some((s) => s.entryId === id);
        const p = names.progress(id);
        return (
          <button
            type="button"
            key={id}
            className={`act ${plan.current?.entryId === id ? 'on' : ''}`}
            disabled={busy || done}
            onClick={() => pick(id)}
          >
            <Avatar name={names.name(id)} size="md" />
            <span>
              <b>{names.name(id)}</b>
              <small>
                {done ? 'ha chiuso' : `Turno ${i + 1} · ${p?.recorded ?? 0} round registrati`}
              </small>
            </span>
          </button>
        );
      })}
      {m.status === 'completed' && <p className="hint">La partita è conclusa.</p>}
    </div>
  );
}

/** Classifica: the provisional ranking, over the whole qualification or one heat. */
function LiveBoard({
  m,
  t,
  plan,
  heated,
  heat,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  heated: boolean;
  heat: HeatRow | null;
}) {
  const names = useNames(m, t);
  const [view, setView] = useState<'all' | 'heat'>('all');
  const g = gameOf(m);
  const order = byValue(m);
  const overview = m.heatOverview;
  const heatOf = (id: string) => overview.heats.find((h) => h.entryIds.includes(id));
  const excluded = new Set(m.excludedEntryIds);
  const ids = (
    view === 'heat' || !heated ? plan.seats : m.participants.map((p) => p.tournamentEntryId)
  ).filter((id) => !excluded.has(id));
  const value = (id: string) => m.result?.scores[id] ?? metricOf(m, names.progress(id));
  const played = (id: string) =>
    (names.progress(id)?.rounds.filter((r) => r.status !== 'missing').length ?? 0) > 0;
  const rows = ids
    .map((id) => ({ id, v: played(id) || m.result?.scores[id] != null ? value(id) : null }))
    .sort((a, b) => order(a.v, b.v));
  const cut =
    t?.mode === 'QUICK_HIGH_SCORE' && m.matchType === 'qualification'
      ? t.tournamentConfiguration.qualifiers
      : null;
  const cutAt =
    view === 'all' && cut !== null && rows.filter((r) => r.v !== null).length > cut ? cut : null;
  const playingNow = plan.seats.filter(
    (id) => names.progress(id)?.complete === false && played(id),
  );
  const done = ids.filter((id) => names.progress(id)?.complete);
  const waiting = ids.filter((id) => !played(id) && m.result?.scores[id] == null);
  const cols = plan.rounds ?? null;
  const sub = (id: string) => {
    const p = names.progress(id);
    const h = heatOf(id);
    const at = plan.current?.entryId === id;
    const gaps =
      p?.rounds.filter(
        (r) => r.state === 'reenter' || r.state === 'review' || r.state === 'partial',
      ).length ?? 0;
    const thrown = p?.rounds.filter((r) => r.status !== 'missing').length ?? 0;
    const state = !played(id)
      ? 'in attesa'
      : p?.complete
        ? cols
          ? `${cols}/${cols}`
          : 'completato'
        : at
          ? 'al bersaglio'
          : `in gioco ${thrown}${cols ? `/${cols}` : ''}`;
    return [heated && h ? `M${h.number}` : null, state, gaps ? `${gaps} da verificare` : null]
      .filter(Boolean)
      .join(' · ');
  };
  return (
    <>
      <InBar at="top">
        {heated && (
          <Segmented
            label="Vista classifica"
            value={view}
            change={setView}
            options={[
              { id: 'all', label: m.matchType === 'qualification' ? 'Qualifica' : 'Tutti' },
              { id: 'heat', label: `Manche ${heat?.number ?? plan.heatNumber ?? ''}` },
            ]}
          />
        )}
        <div className="card stat3">
          {cut !== null ? (
            <div>
              <small>Soglia finale</small>
              <strong className="accent">{rows[cut - 1]?.v ?? '—'}</strong>
            </div>
          ) : (
            <div>
              <small>In testa</small>
              <strong>{rows[0]?.v ?? '—'}</strong>
            </div>
          )}
          <div>
            <small>Giocati</small>
            <strong>
              {done.length}
              {playingNow.length ? ` + ${playingNow.length}` : ''}
            </strong>
          </div>
          <div>
            <small>In attesa</small>
            <strong className="muted">{waiting.length}</strong>
          </div>
        </div>
      </InBar>
      <ol className="list board" aria-label="Classifica provvisoria">
        {rows.map((r, i) => (
          <li key={r.id}>
            {cutAt !== null && i === cutAt && (
              <div className="cut" aria-hidden="true">
                <i />
                FINALE · TOP {cut}
                <i />
              </div>
            )}
            <div
              className={`rk ${r.v === null ? 'wait' : ''} ${plan.current?.entryId === r.id ? 'me' : ''}`}
            >
              <span className={`n ${r.v !== null && i < 4 ? `r${i + 1}` : ''}`}>
                {r.v === null ? '·' : i + 1}
              </span>
              <Avatar name={names.name(r.id)} size="md" />
              <span className="nm">
                <b>{names.name(r.id)}</b>
                <small>{sub(r.id)}</small>
              </span>
              <strong>{r.v ?? '–'}</strong>
            </div>
          </li>
        ))}
      </ol>
      <p className="hint">
        Classifica provvisoria: conta il risultato del totem.
        {heated && g.scoring !== 'points' ? ' Le manche non si confrontano tra loro.' : ''}
      </p>
    </>
  );
}

/** What a matrix cell shows, and how it reads aloud. */
function cellOf(v: RoundView | undefined, current: boolean, gap: boolean) {
  if (v?.state === 'reenter') return { text: '!', cls: 'gap', label: 'da reinserire' };
  if (v?.state === 'partial') return { text: '?', cls: 'gap', label: 'parziale' };
  if (v?.status === 'skipped') return { text: 'S', cls: 'gap', label: 'saltato' };
  if (v?.status === 'recorded')
    return v.state === 'review'
      ? { text: String(v.value), cls: 'gap', label: `${v.value}, da verificare` }
      : v.bust
        ? { text: 'B', cls: 'bust', label: 'bust' }
        : { text: String(v.value), cls: v.darts ? 'darts' : '', label: String(v.value) };
  if (current) return { text: '●', cls: 'cur', label: 'al bersaglio' };
  if (gap) return { text: '?', cls: 'gap', label: 'mancante' };
  return { text: '·', cls: 'fut', label: 'da giocare' };
}

/**
 * Matrice: every turn of the seats, round by round, with the heats above. A cell opens its
 * correction sheet; corrections never move the turn at the board.
 */
function RoundMatrix({
  m,
  t,
  plan,
  heat,
  heated,
  selectHeat,
  open,
  organize,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  heat: HeatRow | null;
  heated: boolean;
  selectHeat: (heatId: string) => void;
  open: (slot: Slot) => void;
  organize?: () => void;
}) {
  const names = useNames(m, t);
  const g = gameOf(m);
  const x01 = g.scoring === 'remaining';
  const cols = columnsOf(plan, names.progress);
  const status = heat?.status;
  const sub =
    status === 'completed'
      ? `${cols} round · registrata`
      : status === 'pending' || status === 'ready'
        ? 'In attesa · ordine modificabile'
        : plan.current
          ? `Round ${plan.round}${plan.rounds ? ` di ${plan.rounds}` : ''} · tocca a ${first(names.thrower(plan.current))}`
          : plan.state === 'completed'
            ? 'Tutti i turni registrati'
            : `Round ${plan.round}`;
  const gap = plan.gaps[0];
  return (
    <>
      <InBar at="top">
        {heated && (
          <HeatTabs overview={m.heatOverview} viewing={heat?.heatId ?? null} select={selectHeat} />
        )}
      </InBar>
      <div className="mx-head">
        <div>
          <h2>
            {heated ? `Manche ${heat?.number} · ` : ''}
            {plan.seats.length} {plan.seats.length === 1 ? 'giocatore' : 'giocatori'}
          </h2>
          <p className="hint">{sub}</p>
        </div>
        {organize && (
          <button type="button" className="btn sm" onClick={organize}>
            <ListOrdered aria-hidden="true" /> Organizza
          </button>
        )}
      </div>
      <div className="mx-scroll">
        <table className="mx" aria-label="Turni per round">
          <thead>
            <tr>
              <th scope="col">Ordine</th>
              {Array.from({ length: cols }, (_, r) => (
                <th scope="col" key={r}>
                  R{r + 1}
                </th>
              ))}
              <th scope="col">{x01 ? 'RES' : 'TOT'}</th>
            </tr>
          </thead>
          <tbody>
            {plan.seats.map((id) => {
              const p = names.progress(id);
              const on = plan.current?.entryId === id;
              return (
                <tr key={id} className={on ? 'active' : ''}>
                  <th scope="row">
                    <span className="nm">
                      <Avatar name={names.name(id)} size="xs" />
                      {first(names.name(id))}
                    </span>
                  </th>
                  {Array.from({ length: cols }, (_, r) => {
                    const slot = { entryId: id, round: r + 1 };
                    const cell = cellOf(
                      p?.rounds[r],
                      sameSlot(plan.current, slot),
                      plan.gaps.some((s) => sameSlot(s, slot)),
                    );
                    return (
                      <td key={r} className={cell.cls}>
                        <button
                          type="button"
                          aria-label={`${names.name(id)}, round ${r + 1}: ${cell.label}`}
                          onClick={() => open(slot)}
                        >
                          {cell.text}
                        </button>
                      </td>
                    );
                  })}
                  <td className="tot">{metricOf(m, p) ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {gap && (
        <button type="button" className="card gap-card" onClick={() => open(gap)}>
          <AlertTriangle aria-hidden="true" />
          <span>
            <b>
              {plan.gaps.length} {plan.gaps.length === 1 ? 'turno' : 'turni'} da verificare
            </b>
            <span className="hint">
              {names.name(gap.entryId)} · Round {gap.round}
            </span>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      )}
      <div className="mx-legend">
        <span>
          <i className="l-cur" />
          al bersaglio
        </span>
        <span>
          <i className="l-gap" />
          da verificare
        </span>
        <span>B bust · S saltato</span>
        <span>Tocca una cella per correggere</span>
      </div>
    </>
  );
}

const recordStatus: Record<string, string> = {
  recorded: 'registrato',
  skipped: 'saltato',
  corrected: 'sostituito',
  voided: 'annullato',
};
/** Correggi turno: one cell of the matrix, its value before and after, and its history. */
function CellSheet({
  m,
  t,
  plan,
  slot,
  close,
  go,
  notify,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  slot: Slot;
  close: () => void;
  go: (tab: Tab) => void;
  notify: (toast: Toast) => void;
}) {
  const names = useNames(m, t);
  const g = gameOf(m);
  const spec = m.trackingSpec;
  const x01 = g.scoring === 'remaining';
  const p = names.progress(slot.entryId);
  const v = p?.rounds[slot.round - 1];
  const command = useMatchCommand(m);
  const current = sameSlot(plan.current, slot);
  const gap = plan.gaps.some((s) => sameSlot(s, slot));
  const thrower = names.thrower({
    entryId: slot.entryId,
    playerId: current ? plan.current!.playerId : (v?.playerId ?? null),
  });
  const history = m.rounds
    .filter((r) => r.tournamentEntryId === slot.entryId && r.round === slot.round)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const thrown = history.length > 0;
  const max = spec.max[Math.min(slot.round, spec.max.length) - 1] ?? spec.max[0] ?? 180;
  const darted = spec.kind !== 'progress';
  const [mode, setMode] = useState<EntryMode>(v?.darts && darted ? 'detail' : 'quick');
  const [edit, setEdit] = useState(v?.value == null ? '' : String(v.value));
  const [input, setInput] = useState<DartInput>(() =>
    v?.darts ? { ...emptyInput(), darts: [0, 1, 2].map((i) => v.darts![i] ?? null) } : emptyInput(),
  );
  const [voiding, setVoiding] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // Values before and after the round, from the standing values before it.
  const before = (() => {
    if (!p) return null;
    const earlier = p.rounds.slice(0, slot.round - 1);
    if (spec.kind === 'remaining')
      return slot.round === 1
        ? g.startingScore
        : earlier.at(-1)?.status === 'recorded'
          ? earlier.at(-1)!.value
          : null;
    const sum = earlier.reduce((a, r) => a + (r.value ?? 0), 0);
    if (x01) return earlier.every((r) => r.status === 'recorded') ? g.startingScore! - sum : null;
    return sum;
  })();
  const c = confirmation({
    ctx: { game: m.gameMode as GameMode, round: slot.round, remaining: x01 ? before : null },
    kind: spec.kind,
    x01,
    before: spec.kind === 'progress' ? null : before,
    mode,
    darts: input.darts,
    quick: edit,
    max,
  });
  // What the round would record: the total typed, or the value of the darts.
  const nextValue =
    mode === 'quick'
      ? edit === ''
        ? null
        : Number(edit)
      : !c.ok
        ? null
        : spec.kind === 'remaining'
          ? c.after
          : c.points;
  const total = metricOf(m, p);
  const delta =
    nextValue === null || v?.value == null || spec.kind !== 'points' ? null : nextValue - v.value;
  const stays = plan.current
    ? `Il turno in corso resta a ${names.thrower(plan.current)}, round ${plan.current.round}.`
    : '';
  const save = () => {
    if (nextValue === null || command.busy) return;
    command.run(
      'rounds',
      {
        entryId: slot.entryId,
        round: slot.round,
        value: nextValue,
        ...(mode === 'detail' && c.darts ? { darts: c.darts, bust: c.bust } : {}),
      },
      () => {
        notify({
          text: (
            <>
              Round {slot.round} di <b>{names.name(slot.entryId)}</b>: {v?.value ?? '—'} →{' '}
              {nextValue}. Il turno in corso non cambia.
            </>
          ),
        });
        close();
      },
    );
  };
  const recordedAs =
    !v || v.status === 'missing'
      ? current
        ? 'È il turno in corso'
        : thrown
          ? 'Valore annullato: da inserire'
          : gap
            ? 'Turno passato senza valore'
            : 'Round non ancora giocato'
      : v.status === 'skipped'
        ? 'Saltato: non osservato'
        : v.darts
          ? `Registrato con le freccette: ${v.value ?? '?'}`
          : `Registrato come totale: ${v.value ?? '?'}`;
  const editable = !current && (!!v && v.status !== 'missing' ? true : thrown || gap);
  return (
    <Modal
      title={`${(names.entry(slot.entryId)?.members.length ?? 0) > 1 ? `${names.name(slot.entryId)} (${thrower})` : names.name(slot.entryId)} · Round ${slot.round}`}
      subtitle={recordedAs}
      lead={<Avatar name={thrower} />}
      close={close}
      footer={
        voiding ? (
          <>
            <button
              type="button"
              className="btn ghost"
              disabled={command.busy}
              onClick={() => setVoiding(false)}
            >
              Indietro
            </button>
            <button
              type="button"
              className="btn warn"
              disabled={command.busy}
              onClick={() =>
                command.run(
                  'rounds/void',
                  { entryId: slot.entryId, round: slot.round, reason: 'Annullato dalla matrice' },
                  () => {
                    notify({
                      text: <>Round annullato: torna da inserire. Il turno in corso non cambia.</>,
                    });
                    close();
                  },
                )
              }
            >
              Annulla round
            </button>
          </>
        ) : current ? (
          <button type="button" className="btn cta" onClick={() => go('live')}>
            Vai a Live
          </button>
        ) : editable ? (
          <>
            {v && v.status !== 'missing' ? (
              <button
                type="button"
                className="btn danger"
                disabled={command.busy}
                onClick={() => setVoiding(true)}
              >
                Annulla turno
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={close}>
                Chiudi
              </button>
            )}
            <button
              type="button"
              className="btn cta"
              disabled={nextValue === null || command.busy}
              onClick={save}
            >
              {command.busy
                ? 'Salvataggio…'
                : v?.value == null
                  ? 'Salva valore'
                  : 'Salva correzione'}
            </button>
          </>
        ) : undefined
      }
    >
      {voiding ? (
        <p>
          Annullare il round {slot.round} di {names.name(slot.entryId)}? Il valore resta nello
          storico e il round torna da inserire. {stays}
        </p>
      ) : !editable ? (
        <p className="hint">
          {current ? 'Si registra da Live, come ogni turno.' : 'Si registra quando tocca a lui.'}
        </p>
      ) : (
        <>
          {darted && (
            <Segmented
              label="Correggi con"
              value={mode}
              change={setMode}
              options={[
                { id: 'detail', label: 'Freccette' },
                { id: 'quick', label: 'Totale' },
              ]}
            />
          )}
          <div className="before-after">
            <div className="card">
              <span className="field-l">Prima</span>
              <strong className={v?.value != null ? 'struck' : ''}>{v?.value ?? '–'}</strong>
            </div>
            <MoveRight aria-hidden="true" />
            <div className="card on">
              <span className="field-l">Dopo</span>
              <strong>{nextValue ?? '–'}</strong>
            </div>
          </div>
          {total !== null && spec.kind === 'points' && (
            <div className="tally">
              <span>Totale di {first(names.name(slot.entryId))}</span>
              <span>
                {total} →<b>{delta === null ? total : total + delta}</b>
              </span>
            </div>
          )}
          {v?.state === 'review' && (
            <p className="note warn">
              <AlertTriangle aria-hidden="true" />
              <span>
                Le freccette danno {v.dartsValue}, il valore registrato è {v.value}.
              </span>
            </p>
          )}
          {mode === 'detail' ? (
            <DartPad
              input={input}
              change={setInput}
              ctx={{
                game: m.gameMode as GameMode,
                round: slot.round,
                remaining: x01 ? before : null,
              }}
              notify={setHint}
              disabled={command.busy}
              submit={save}
            />
          ) : (
            <NumberKeypad
              value={edit}
              change={setEdit}
              submit={save}
              busy={command.busy}
              maximum={max}
              notify={setHint}
              limitLabel={`Massimo ${max}`}
              label="Tastierino della correzione"
            />
          )}
          {(hint || (mode === 'detail' && c.why)) && (
            <p className="form-reason" role="status">
              {hint ?? c.why}
            </p>
          )}
          {v?.darts && mode === 'quick' && (
            <div className="darts small" aria-label="Freccette registrate">
              {[0, 1, 2].map((i) => (
                <DartCell
                  key={i}
                  index={i}
                  dart={v.darts![i] ?? null}
                  unused={i >= v.darts!.length}
                />
              ))}
            </div>
          )}
        </>
      )}
      {history.length > 0 && (
        <ul className="hist" aria-label="Cronologia del round">
          {history.map((r) => (
            <li key={r.id}>
              {new Date(r.createdAt).toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {r.value ?? '—'} · {recordStatus[r.status]}
              {r.reason ? ` · ${r.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      {v?.corrected && !voiding && (
        <button
          type="button"
          className="text-link"
          disabled={command.busy}
          onClick={() =>
            command.run(
              'rounds/void',
              {
                entryId: slot.entryId,
                round: slot.round,
                restorePrevious: true,
                reason: 'Ripristino del valore precedente',
              },
              () => {
                notify({ text: <>Valore precedente ripristinato.</> });
                close();
              },
            )
          }
        >
          Ripristina il valore precedente
        </button>
      )}
      <ErrorMessage error={command.error} />
    </Modal>
  );
}

/**
 * Risultati: what the companion recorded against the official values of the totem, then the
 * usual entry of the official result. The totem's value always prevails.
 */
function GuidedResults({
  m,
  t,
  plan,
  query,
  tournament,
  review,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  query: UseQueryResult<Match>;
  tournament: UseQueryResult<Tournament>;
  review: (entryId: string) => void;
}) {
  const names = useNames(m, t);
  const official = (id: string) => m.result?.scores[id] ?? null;
  const ended = plan.state === 'completed';
  // Totals that differ from complete rounds without an explanation: to review first.
  const differing = plan.seats.filter((id) => {
    const p = names.progress(id);
    const off = official(id);
    return (
      off !== null &&
      !!p?.complete &&
      p.computed !== off &&
      !m.result?.reconciliation.some((r) => r.entryId === id)
    );
  });
  const annotate = (id: string) => {
    const p = names.progress(id);
    const value = metricOf(m, p);
    const off = official(id);
    if (value === null) return null;
    if (off !== null && p?.complete)
      return p.computed === off ? `companion ${value} ✓` : `companion ${value}`;
    return `companion ${value}${p && !p.complete ? ` · ${p.recorded}/${p.rounds.length} round` : ''}`;
  };
  return (
    <>
      {m.status !== 'completed' && (
        <p className="note">
          <Info aria-hidden="true" />
          <span>
            {ended
              ? 'Conta il totale del totem: quello del companion serve a verificarlo.'
              : `Turni in corso${plan.expected ? `: ${plan.expected - plan.thrown} da registrare` : ''}. I totali del totem si inseriscono a fine manche.`}
          </span>
        </p>
      )}
      {differing.map((id) => {
        const p = names.progress(id)!;
        const off = official(id)!;
        return (
          <div key={id} className="tie-alert" role="alert">
            <p>
              <AlertTriangle aria-hidden="true" />
              <span>
                <strong>{names.name(id)}</strong>: totem {off}, round {p.computed} (differenza{' '}
                {off - p.computed! > 0 ? '+' : ''}
                {off - p.computed!}).
              </span>
            </p>
            <button type="button" className="btn sm" onClick={() => review(id)}>
              Correggi un round
            </button>
          </div>
        );
      })}
      <ResultEntry
        query={query}
        tournament={tournament}
        embedded
        review={review}
        annotate={annotate}
      />
    </>
  );
}
