import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CircleCheck,
  ClipboardCheck,
  Info,
  LayoutGrid,
  ListOrdered,
  Pause,
  Play,
  SkipForward,
  SlidersHorizontal,
  Target,
  Undo2,
  Users,
} from 'lucide-react';
import { CrownIcon, PaintSplash } from '../components/BrandIcons';
import { DartCell, DartPad } from '../components/DartPad';
import { HeatTimeline, viewedHeat } from '../components/Heats';
import { NumberKeypad } from '../components/NumberKeypad';
import { RotationManager } from '../components/Rounds';
import {
  Avatar,
  ErrorMessage,
  Header,
  Modal,
  Segmented,
  StatusChip,
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
import { gameOf, sideOf, type GameMode } from '../services/rules';
import { tournamentPath } from '../services/session';
import { ResultEntry } from './Result';
import { entryName } from './Tournaments';

type Tab = 'live' | 'matrice' | 'classifica' | 'risultati';
type Slot = { entryId: string; round: number };
type Progress = Match['progress'][number];
type RoundView = Progress['rounds'][number];
type Toast = { text: ReactNode; undo?: Slot; tone?: 'warn' };

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

/**
 * The match screen with progressive tracking: the guided turn at the board (Live), the round
 * matrix, the live board and the official results, under the match's own floating bar. The
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
  const tab = (tabs.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'live') as Tab;
  const [heatChoice, setHeatChoice] = useState<string | null>(null);
  const [focus, setFocus] = useState<Slot | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [controls, setControls] = useState(false);
  const go = (next: Tab) => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('tab', next);
        return n;
      },
      { replace: true },
    );
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'warn' ? 2400 : 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const overview = m.heatOverview;
  const heated = overview.heats.filter((h) => h.status !== 'cancelled').length > 1;
  const heat = heated ? viewedHeat(overview, heatChoice) : null;
  const plan = m.turnPlans.find((p) => p.heatId === (heat?.heatId ?? null)) ?? m.turnPlans[0]!;
  const undo = useMatchCommand(m);
  const names = useNames(m, t);
  const single = t?.mode === 'SINGLE_MATCH';
  const isFinal = t?.stages.find((s) => s.id === m.stageId)?.kind === 'final';
  const back = !t
    ? '/'
    : single
      ? '/tornei'
      : `${tournamentPath(t)}${t.mode === 'QUICK_HIGH_SCORE' && isFinal ? '?tab=final' : ''}`;
  const subtitle = [
    single ? 'Partita singola' : statusLabel(m.matchType),
    heat ? `Manche ${heat.number} di ${overview.heats.length}` : null,
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
  return (
    <div className="guided-page">
      <Header
        title={game.label}
        subtitle={subtitle}
        back={back}
        action={
          tab === 'live' && m.status !== 'completed' && m.status !== 'cancelled' ? (
            <button
              className="icon-button"
              aria-label="Controlli del turno"
              onClick={() => setControls(true)}
            >
              <SlidersHorizontal />
            </button>
          ) : undefined
        }
      />
      <main className="guided-content">
        {heated && tab !== 'risultati' && (
          <section className="heat-panel compact" aria-label="Manche">
            <HeatTimeline
              overview={overview}
              viewing={heat?.heatId ?? null}
              select={(id) => {
                setHeatChoice(id);
                setFocus(null);
              }}
            />
          </section>
        )}
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
          />
        )}
        {tab === 'matrice' && (
          <RoundMatrix
            m={m}
            t={t}
            plan={plan}
            focus={focus}
            setFocus={setFocus}
            go={go}
            notify={setToast}
          />
        )}
        {tab === 'classifica' && (
          <LiveBoard
            m={m}
            t={t}
            plan={plan}
            heated={heated}
            open={(slot) => {
              setFocus(slot);
              go('matrice');
            }}
          />
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
      {toast && (
        <div className={`g-toast ${toast.tone ?? ''}`} role="status">
          {toast.tone === 'warn' ? <Info aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
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
      <nav
        className="bottom-nav match-nav"
        aria-label="Navigazione della partita"
        style={{ '--i': i } as CSSProperties}
      >
        <span className="nav-pill" aria-hidden="true" />
        {tabs.map(([id, label, Icon]) => (
          <a
            key={id}
            href={`?tab=${id}`}
            className={id === tab ? 'active' : ''}
            aria-current={id === tab ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              vibrate(8);
              go(id);
            }}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {id === 'matrice' && attention && (
              <i className="nav-dot" aria-label="round da verificare" />
            )}
          </a>
        ))}
      </nav>
    </>
  );
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
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  heated: boolean;
  controls: boolean;
  setControls: (open: boolean) => void;
  notify: (toast: Toast) => void;
  go: (tab: Tab) => void;
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
  const [interlude, setInterlude] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
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
  const nextName = plan.next ? names.thrower(plan.next) : null;
  const nextLabel = !plan.next
    ? heated
      ? 'fine manche'
      : 'fine partita'
    : plan.next.round > round
      ? `R${plan.next.round} · ${nextName}`
      : nextName!;
  const paused = m.guide?.paused ?? false;
  const leader = leaderOf(m, plan.seats, names.progress);
  const seatIndex = current ? plan.seats.indexOf(current.entryId) : -1;
  const side = current
    ? sideOf(
        m.gameMode as GameMode,
        m.participants.find((p) => p.tournamentEntryId === current.entryId)?.playingOrder ?? 1,
      )
    : null;

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
                      : `${view.value} punti`}
              {after != null && !progressKind && spec.kind !== 'remaining'
                ? ` · ${x01 ? 'residuo' : 'totale'} ${after}`
                : ''}
            </>
          ),
          undo: { entryId: saving.entryId, round: saving.round },
        });
        roundDone(fresh, saving);
      },
    );
  }
  /** The turn just saved closed its round: a short pause before the next one starts. */
  function roundDone(fresh: Match, saving: Slot) {
    const freshPlan = fresh.turnPlans.find((p) => p.heatId === plan.heatId);
    if (
      freshPlan?.current &&
      freshPlan.current.round > saving.round &&
      freshPlan.state === 'in_progress'
    )
      setInterlude(saving.round);
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
      (fresh) => {
        roundDone(fresh, saving);
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
    record.run(
      'turns/record',
      { entryId: saving.entryId, round: saving.round, bust: true },
      (fresh) => {
        vibrate();
        roundDone(fresh, saving);
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
      },
    );
  };
  const undoable = plan.undoable;
  const undoName = undoable
    ? names.thrower({
        entryId: undoable.entryId,
        playerId: names.progress(undoable.entryId)?.rounds[undoable.round - 1]?.playerId ?? null,
      })
    : null;
  const closed = plan.closed.filter((s) => plan.seats.includes(s.entryId));

  let body: ReactNode;
  if (m.status === 'completed' || plan.state === 'completed')
    body = (
      <>
        <section className="g-done">
          <span className="g-check">
            <Check strokeWidth={3} />
          </span>
          <h2>
            {plan.shanghai
              ? `Shanghai di ${names.name(plan.shanghai.entryId)}!`
              : m.status === 'completed'
                ? 'Risultato registrato'
                : heated
                  ? `Manche ${plan.heatNumber} completata`
                  : 'Partita completata'}
          </h2>
          <p>
            {m.status === 'completed'
              ? 'Il risultato ufficiale del totem è salvato.'
              : `${plan.thrown} turni registrati${plan.gaps.length ? `, ${plan.gaps.length} da verificare` : ''}. Ora serve il risultato ufficiale del totem.`}
          </p>
        </section>
        <button className="primary cta" onClick={() => go('risultati')}>
          {m.status === 'completed' ? 'VEDI IL RISULTATO' : 'INSERISCI I RISULTATI DEL TOTEM'}
        </button>
        {plan.gaps.length > 0 && (
          <button className="outline" onClick={() => go('matrice')}>
            Rivedi i round mancanti
          </button>
        )}
      </>
    );
  else if (interlude !== null && current)
    body = (
      <>
        <section className="g-done">
          <span className="g-check">
            <Check strokeWidth={3} />
          </span>
          <h2>Round {interlude} completato</h2>
          <p>{plan.seats.length} turni nel round. Si riparte dal primo di tiro.</p>
        </section>
        <button type="button" className="g-next" onClick={() => setInterlude(null)} autoFocus>
          <Avatar name={throwerName} />
          <span>
            <small>
              Round {round}
              {plan.rounds ? ` di ${plan.rounds}` : ''} · ora tocca a
            </small>
            <b>{throwerName}</b>
          </span>
          <span className="g-arrow">
            <ArrowRight strokeWidth={2.6} />
          </span>
        </button>
      </>
    );
  else if (!current)
    body = (
      <>
        <section className="g-now paused" aria-live="polite">
          <span className="eyebrow">Rotazione in pausa</span>
          <h2>Chi è al bersaglio?</h2>
        </section>
        <SeatPicker
          m={m}
          plan={plan}
          names={names}
          busy={busy}
          pick={(id) => command({ action: 'pick', entryId: id })}
        />
        <button onClick={() => command({ action: 'resume' })} disabled={busy}>
          <Play size={18} aria-hidden="true" /> Riprendi la rotazione
        </button>
      </>
    );
  else
    body = (
      <>
        <div className="g-round">
          <b>
            Round <em>{round}</em>
            {plan.rounds ? ` di ${plan.rounds}` : ''}
          </b>
          {plan.expected ? (
            <span className="g-progress" title={`${plan.thrown} di ${plan.expected} turni`}>
              <i style={{ width: `${(plan.thrown / plan.expected) * 100}%` }} />
            </span>
          ) : (
            <span className="g-spacer" />
          )}
          {!progressKind && (
            <Segmented
              label="Registrazione"
              value={mode}
              change={setMode}
              options={[
                { id: 'detail', label: 'Freccette' },
                { id: 'quick', label: 'Totale' },
              ]}
            />
          )}
        </div>
        <section className={`g-now ${paused ? 'paused' : ''}`} aria-live="polite">
          <Avatar name={throwerName} active />
          <span className="eyebrow">
            {paused ? 'Scelto a mano · rotazione in pausa' : 'Ora al bersaglio'}
            {team ? ` · ${names.name(current.entryId)}` : ''}
          </span>
          <h2>
            {throwerName}
            {leader === current.entryId && <CrownIcon role="img" aria-label="In testa" />}
          </h2>
          <div className="meta">
            <span>
              {team
                ? current.playerId
                  ? `Tiratore ${unit!.members.findIndex((x) => x.playerId === current.playerId) + 1} di ${unit!.members.length} · con ${unit!.members
                      .filter((x) => x.playerId !== current.playerId)
                      .map((x) => x.displayName)
                      .join(', ')}`
                  : 'Rotazione libera: tira chiunque della squadra'
                : `Turno ${seatIndex + 1} di ${plan.seats.length}`}
              {game.specialWin === 'SHANGHAI' ? ` · bersaglio ${round}` : ''}
              {side ? ` · ${side}` : ''}
              {game.target && m.result?.targetScore ? ` · obiettivo ${m.result.targetScore}` : ''}
            </span>
            <span>
              Dopo: <b>{paused ? 'scelta a mano' : nextLabel}</b>
            </span>
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
          />
        ) : (
          <div className="paper-area g-quick">
            <PaintSplash className="paper-splash" />
            <div className={`score-paper ${quick ? '' : 'is-empty'}`}>
              <output aria-live="polite" aria-label="Valore del turno da confermare">
                {quick || '0'}
              </output>
              <span className="paper-caption">
                {progressKind
                  ? 'NUMERO RAGGIUNTO SUL TOTEM'
                  : spec.kind === 'remaining'
                    ? 'PUNTI RIMASTI SUL TOTEM'
                    : c.darts
                      ? 'TOTALE DEL TOTEM · CON LE FRECCETTE INSERITE'
                      : 'PUNTI DEL TURNO · FRECCETTE NON REGISTRATE'}
              </span>
            </div>
          </div>
        )}
        <TurnSummary m={m} plan={plan} c={c} x01={x01} progressKind={progressKind} mode={mode} />
        {(mode === 'quick' || progressKind) && (
          <NumberKeypad
            value={quick}
            change={setQuick}
            submit={confirm}
            undo={() => undoable && command({ action: 'undo' }, <>Avanzamento annullato</>)}
            busy={busy || interrupted}
            canUndo={!!undoable}
            maximum={max}
            notify={setHint}
            quick={
              spec.kind === 'points'
                ? [0, 26, 45, 60, 81, 100, 140, 180].filter((v) => v <= max)
                : []
            }
            quickLabel="COLPI"
            limitLabel={`Massimo ${max}`}
            okLabel={`Conferma il turno di ${throwerName}`}
          />
        )}
        {mode === 'quick' && x01 && (
          <button
            type="button"
            className="warning g-bust"
            disabled={busy || interrupted}
            onClick={declareBust}
          >
            BUST · il turno non conta, il residuo resta
          </button>
        )}
        <div className="g-ctas">
          <button className="primary cta" disabled={!c.ok || busy || interrupted} onClick={confirm}>
            {record.busy
              ? 'SALVATAGGIO…'
              : c.shanghai
                ? 'CONFERMA SHANGHAI · FINE PARTITA'
                : `${c.bust ? 'CONFERMA BUST' : c.closed ? 'CONFERMA CHIUSURA' : 'CONFERMA ROUND'}${
                    paused
                      ? ''
                      : plan.next
                        ? ` → ${nextLabel.toUpperCase()}`
                        : ` · ${nextLabel.toUpperCase()}`
                  }`}
          </button>
          {(hint || c.why) && (
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
              Le freccette danno un altro totale: si salva il valore del totem, segnalato da
              verificare.
            </p>
          )}
        </div>
      </>
    );

  return (
    <div className="g-live">
      {interrupted && (
        <p className="live-warning" role="status">
          Torneo o incontro in pausa: riprendilo per registrare i turni.
        </p>
      )}
      {closed.length > 0 && plan.state !== 'completed' && (
        <p className="g-note">
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
      {body}
      <ErrorMessage error={record.error ?? guide.error} />
      <section className="section" aria-label="Riepilogo della manche">
        <div className="section-head">
          <h2>{heated ? `Manche ${plan.heatNumber}` : 'Giocatori'}</h2>
          <span>ordine di tiro</span>
        </div>
        <Board m={m} t={t} plan={plan} sort="order" compact />
      </section>
      {controls && (
        <Modal
          title={picking ? 'Chi è al bersaglio?' : 'Controlli del turno'}
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
            <div className="g-acts">
              <button type="button" className="g-act" disabled={!current || busy} onClick={skip}>
                <SkipForward aria-hidden="true" />
                <span>
                  <b>Salta il turno{current ? ` di ${throwerName}` : ''}</b>
                  <small>Resta non osservato, non vale zero</small>
                </span>
              </button>
              <button
                type="button"
                className="g-act"
                disabled={busy}
                onClick={() => setPicking(true)}
              >
                <Users aria-hidden="true" />
                <span>
                  <b>Scegli chi è al bersaglio</b>
                  <small>Cambia turno senza registrare punti</small>
                </span>
              </button>
              {current && team && (
                <div className="g-act static">
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
              <button
                type="button"
                className="g-act"
                disabled={!undoable || busy}
                onClick={() =>
                  command(
                    { action: 'undo' },
                    <>
                      Avanzamento annullato: torna <b>{undoName}</b>
                    </>,
                  )
                }
              >
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
                className="g-act"
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
              <ErrorMessage error={guide.error ?? record.error} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

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
    <div className="g-acts">
      {plan.seats.map((id, i) => {
        const done = plan.closed.some((s) => s.entryId === id);
        const p = names.progress(id);
        return (
          <button
            type="button"
            key={id}
            className={`g-act ${plan.current?.entryId === id ? 'on' : ''}`}
            disabled={busy || done}
            onClick={() => pick(id)}
          >
            <Avatar name={names.name(id)} />
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

/** Previous total, points of the turn and the new provisional value. */
function TurnSummary({
  m,
  plan,
  c,
  x01,
  progressKind,
  mode,
}: {
  m: Match;
  plan: Plan;
  c: ReturnType<typeof confirmation>;
  x01: boolean;
  progressKind: boolean;
  mode: EntryMode;
}) {
  const previous = progressKind
    ? (m.progress.find((p) => p.tournamentEntryId === plan.current?.entryId)?.partialValue ?? null)
    : plan.before;
  const chip = c.bust ? (
    <StatusChip tone="warning">BUST · il turno vale 0, il residuo resta</StatusChip>
  ) : c.shanghai ? (
    <StatusChip tone="success">SHANGHAI · vittoria immediata</StatusChip>
  ) : c.closed ? (
    <StatusChip tone="success">
      CHIUSURA{mode === 'detail' ? ' · freccette restanti non usate' : ''}
    </StatusChip>
  ) : c.needsTotal ? (
    <StatusChip tone="neutral">NON DECISO · totale da leggere sul totem</StatusChip>
  ) : null;
  return (
    <div className="g-sum">
      <div className="big">
        <small>{progressKind ? 'Numero raggiunto' : 'Punti del turno'}</small>
        <strong>{c.points ?? (mode === 'detail' && c.needsTotal ? '?' : 0)}</strong>
      </div>
      <div className="rows">
        <span>
          {progressKind ? 'Prima' : x01 ? 'Residuo' : 'Totale precedente'}
          <b>{previous ?? '—'}</b>
        </span>
        <span>
          {progressKind ? 'Ora' : x01 ? 'Nuovo residuo' : 'Totale provvisorio'}
          <b className={c.bust ? 'warn' : ''}>{c.after ?? '—'}</b>
        </span>
      </div>
      {chip}
    </div>
  );
}

/** Seats with their progressive value, rounds and state; ordered by throwing order or value. */
function Board({
  m,
  t,
  plan,
  sort,
  compact = false,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  sort: 'order' | 'rank';
  compact?: boolean;
}) {
  const names = useNames(m, t);
  const g = gameOf(m);
  const leader = leaderOf(m, plan.seats, names.progress);
  const cols =
    plan.rounds ??
    Math.max(plan.round, ...plan.seats.map((id) => names.progress(id)?.rounds.length ?? 0));
  const rows = plan.seats.map((id, i) => ({
    id,
    i,
    p: names.progress(id),
    v: metricOf(m, names.progress(id)),
  }));
  if (sort === 'rank')
    rows.sort((a, b) =>
      a.v === null ? 1 : b.v === null ? -1 : g.scoring === 'remaining' ? a.v - b.v : b.v - a.v,
    );
  return (
    <ol className={`g-board ${compact ? 'compact' : ''}`}>
      {rows.map(({ id, i, p, v }, pos) => {
        const on = plan.current?.entryId === id;
        const unit = names.entry(id);
        const closed = plan.closed.find((s) => s.entryId === id);
        const done = p?.rounds.filter((r) => r.status !== 'missing').length ?? 0;
        return (
          <li key={id} className={on ? 'on' : ''}>
            <span className="g-pos">{sort === 'rank' ? pos + 1 : i + 1}</span>
            <Avatar name={on ? names.thrower(plan.current) : names.name(id)} />
            <span className="g-nm">
              <b>
                {names.name(id)}
                {leader === id && <CrownIcon role="img" aria-label="In testa" />}
              </b>
              {(unit?.members.length ?? 0) > 1 ? (
                <small>{unit!.members.map((x) => x.displayName).join(' + ')}</small>
              ) : on ? (
                <small>al bersaglio</small>
              ) : null}
            </span>
            <strong>{v ?? '—'}</strong>
            <span className="g-cnt">{closed ? 'chiuso' : `${done}/${plan.rounds ?? cols}`}</span>
            {!compact && (
              <span className="g-rchips" aria-hidden="true">
                {Array.from({ length: cols }, (_, r) => {
                  const x = p?.rounds[r];
                  const now = on && plan.current?.round === r + 1;
                  const text =
                    !x || x.status === 'missing'
                      ? now
                        ? '•'
                        : x?.state === 'reenter'
                          ? '!'
                          : '–'
                      : x.status === 'skipped'
                        ? 's'
                        : x.bust
                          ? 'B'
                          : x.value;
                  return (
                    <span
                      key={r}
                      className={`${!x || x.status !== 'recorded' ? 'e' : ''} ${x?.bust ? 'b' : ''} ${now ? 'now' : ''}`}
                    >
                      {text}
                    </span>
                  );
                })}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Classifica: throwing order or provisional ranking, next turns, every round. */
function LiveBoard({
  m,
  t,
  plan,
  heated,
  open,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  heated: boolean;
  open: (slot: Slot) => void;
}) {
  const names = useNames(m, t);
  const [sort, setSort] = useState<'order' | 'rank' | 'rounds'>('order');
  const g = gameOf(m);
  const cols =
    plan.rounds ??
    Math.max(plan.round, ...plan.seats.map((id) => names.progress(id)?.rounds.length ?? 0));
  const queue = [plan.current, plan.next].filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div className="g-rank">
      <div className="g-info">
        <div>
          <b>{heated ? `Manche ${plan.heatNumber} di ${m.heatOverview.heats.length}` : g.label}</b>
          <small>
            {plan.seats.length} al bersaglio
            {heated ? ` · ${m.participants.length} iscritti` : ''}
          </small>
        </div>
        <div className="g-rbox">
          <small>Round</small>
          <b>
            {plan.round}
            {plan.rounds ? ` di ${plan.rounds}` : ''}
          </b>
        </div>
      </div>
      <Segmented
        label="Ordinamento"
        value={sort}
        change={setSort}
        options={[
          { id: 'order', label: 'Ordine' },
          { id: 'rank', label: 'Provvisoria' },
          { id: 'rounds', label: 'Tutti i round' },
        ]}
      />
      {sort === 'rounds' ? (
        <>
          <p className="hint">
            Sequenza dei turni, round per round. Tocca un turno per aprirlo nella matrice.
          </p>
          <ol className="g-order">
            {Array.from({ length: cols }, (_, r) => {
              const views = plan.seats.map((id) => names.progress(id)?.rounds[r]);
              const done = views.filter((v) => v && v.status !== 'missing').length;
              const now = plan.current?.round === r + 1;
              const future = plan.current ? r + 1 > plan.current.round : false;
              return (
                <li key={r} className={now ? 'now' : future ? 'todo' : ''}>
                  <div className="g-oh">
                    <b>Round {r + 1}</b>
                    {done === plan.seats.length ? (
                      <StatusChip tone="success">COMPLETATO</StatusChip>
                    ) : now ? (
                      <StatusChip tone="live">IN CORSO</StatusChip>
                    ) : done ? (
                      <StatusChip tone="warning">{plan.seats.length - done} DA INSERIRE</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">DA GIOCARE</StatusChip>
                    )}
                  </div>
                  <div className="g-ot">
                    {plan.seats.map((id, i) => {
                      const v = views[i];
                      const cur = sameSlot(plan.current, { entryId: id, round: r + 1 });
                      const st = cellState(v, cur, future || now);
                      return (
                        <button
                          type="button"
                          key={id}
                          className={st.cls}
                          onClick={() => open({ entryId: id, round: r + 1 })}
                        >
                          <span className="seq">{r * plan.seats.length + i + 1}</span>
                          <span className="nm">
                            {cur
                              ? names.thrower(plan.current)
                              : v?.playerId
                                ? names.thrower({ entryId: id, playerId: v.playerId })
                                : names.name(id)}
                          </span>
                          <span className="vl">{st.value || ' '}</span>
                          <span className="st">{st.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          {sort === 'rank' && (
            <p className="hint">
              Classifica provvisoria e non ufficiale: conta il risultato del totem.
              {heated && !['points'].includes(g.scoring)
                ? ' Le manche non si confrontano tra loro.'
                : ''}
            </p>
          )}
          <Board m={m} t={t} plan={plan} sort={sort} />
          {queue.length > 0 && (
            <section className="section">
              <h2 className="section-title">Prossimi turni</h2>
              <div className="g-queue">
                {queue.map((x, i) => (
                  <span key={`${x.entryId}-${x.round}`}>
                    <Avatar name={names.thrower(x)} />
                    {names.thrower(x)}
                    <small>
                      {i === 0 ? 'ora' : 'dopo'} · R{x.round}
                    </small>
                  </span>
                ))}
              </div>
            </section>
          )}
          <button
            className="outline"
            onClick={() => plan.seats[0] && open({ entryId: plan.seats[0], round: 1 })}
          >
            <LayoutGrid size={20} aria-hidden="true" /> Visualizza matrice round
          </button>
        </>
      )}
    </div>
  );
}

function cellState(v: RoundView | undefined, current: boolean, waiting: boolean) {
  if (v?.state === 'reenter') return { value: '!', label: 'REINSERIRE', cls: 'vd' };
  if (v?.state === 'partial') return { value: '?', label: 'PARZIALE', cls: 'vd' };
  if (v?.status === 'skipped') return { value: '–', label: 'SALTATO', cls: 'sk' };
  if (v?.status === 'recorded')
    return {
      value: v.bust ? '0' : String(v.value),
      label: v.bust ? 'BUST' : v.state === 'review' ? 'VERIFICA' : v.darts ? 'FRECCETTE' : 'TOTALE',
      cls: v.bust ? 'b' : v.state === 'review' ? 'vd' : '',
    };
  if (current) return { value: '•', label: 'AL BERSAGLIO', cls: 'cur' };
  return waiting
    ? { value: '', label: 'IN ATTESA', cls: 'fut' }
    : { value: '', label: 'MANCANTE', cls: 'vd' };
}

/**
 * Matrice: every turn of the seats, round by round. A cell opens the darts, the values before
 * and after, the corrections; edits, annulments and restores never move the turn at the board.
 */
function RoundMatrix({
  m,
  t,
  plan,
  focus,
  setFocus,
  go,
  notify,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  focus: Slot | null;
  setFocus: (slot: Slot | null) => void;
  go: (tab: Tab) => void;
  notify: (toast: Toast) => void;
}) {
  const names = useNames(m, t);
  const g = gameOf(m);
  const x01 = g.scoring === 'remaining';
  const cols =
    plan.rounds ??
    Math.max(plan.round, ...plan.seats.map((id) => names.progress(id)?.rounds.length ?? 0));
  const cell = focus && plan.seats.includes(focus.entryId) && focus.round <= cols ? focus : null;
  return (
    <div className="g-matrix">
      <div className="g-mx">
        <table>
          <thead>
            <tr>
              <th scope="col">
                {plan.seats.some((id) => (names.entry(id)?.members.length ?? 0) > 1)
                  ? 'Squadra'
                  : 'Giocatore'}
              </th>
              {Array.from({ length: cols }, (_, r) => (
                <th scope="col" key={r}>
                  R{r + 1}
                </th>
              ))}
              <th scope="col">{x01 ? 'Res' : 'Tot'}</th>
            </tr>
          </thead>
          <tbody>
            {plan.seats.map((id) => {
              const p = names.progress(id);
              return (
                <tr key={id} className={plan.current?.entryId === id ? 'on' : ''}>
                  <th scope="row">{names.name(id)}</th>
                  {Array.from({ length: cols }, (_, r) => {
                    const v = p?.rounds[r];
                    const cur = sameSlot(plan.current, { entryId: id, round: r + 1 });
                    const sel = sameSlot(cell, { entryId: id, round: r + 1 });
                    let text = '–';
                    let cls = 'e';
                    if (v?.state === 'reenter') [text, cls] = ['!', 'vd'];
                    else if (v?.state === 'partial') [text, cls] = ['?', 'vd'];
                    else if (v?.status === 'skipped') [text, cls] = ['salt.', 'sk'];
                    else if (v?.status === 'recorded')
                      [text, cls] = [
                        v.bust ? 'B' : String(v.value),
                        `${v.darts ? 'dd' : ''} ${v.bust ? 'b' : ''} ${v.state === 'review' ? 'mis' : ''}`,
                      ];
                    else if (cur) [text, cls] = ['ora', 'cur'];
                    return (
                      <td key={r}>
                        <button
                          type="button"
                          className={`${cls} ${sel ? 'sel' : ''}`}
                          aria-label={`${names.name(id)}, round ${r + 1}: ${text}`}
                          aria-pressed={sel}
                          onClick={() => setFocus({ entryId: id, round: r + 1 })}
                        >
                          {text}
                        </button>
                      </td>
                    );
                  })}
                  <td className="tot">{metricOf(m, p) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="g-legend">
        <span>
          <i />
          freccette registrate
        </span>
        <span>B bust</span>
        <span>salt. saltato</span>
        <span>! da reinserire</span>
        <span>? parziale</span>
      </div>
      {cell ? (
        <CellPanel
          key={`${cell.entryId}:${cell.round}`}
          m={m}
          t={t}
          plan={plan}
          slot={cell}
          go={go}
          notify={notify}
        />
      ) : (
        <p className="hint">Tocca una cella per vedere freccette, valori e correzioni.</p>
      )}
    </div>
  );
}

const recordStatus: Record<string, string> = {
  recorded: 'registrato',
  skipped: 'saltato',
  corrected: 'sostituito',
  voided: 'annullato',
};
function CellPanel({
  m,
  t,
  plan,
  slot,
  go,
  notify,
}: {
  m: Match;
  t: Tournament | undefined;
  plan: Plan;
  slot: Slot;
  go: (tab: Tab) => void;
  notify: (toast: Toast) => void;
}) {
  const names = useNames(m, t);
  const g = gameOf(m);
  const spec = m.trackingSpec;
  const x01 = g.scoring === 'remaining';
  const p = names.progress(slot.entryId);
  const v = p?.rounds[slot.round - 1];
  const [edit, setEdit] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const command = useMatchCommand(m);
  const current = sameSlot(plan.current, slot);
  const thrower = names.thrower({
    entryId: slot.entryId,
    playerId: current ? plan.current!.playerId : (v?.playerId ?? null),
  });
  const unit = names.entry(slot.entryId);
  const history = m.rounds
    .filter((r) => r.tournamentEntryId === slot.entryId && r.round === slot.round)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const max = spec.max[Math.min(slot.round, spec.max.length) - 1] ?? spec.max[0] ?? 180;
  const stays = plan.current
    ? `Il turno in corso resta a ${names.thrower(plan.current)}, round ${plan.current.round}.`
    : '';
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
  const after =
    v?.value == null || before === null
      ? null
      : spec.kind === 'remaining'
        ? v.value
        : x01
          ? before - v.value
          : spec.kind === 'points'
            ? before + v.value
            : v.value;
  const save = () => {
    if (edit === null || edit === '') return;
    const value = Number(edit);
    command.run('rounds', { entryId: slot.entryId, round: slot.round, value }, () => {
      notify({
        text: (
          <>
            Round {slot.round} di <b>{names.name(slot.entryId)}</b>: {v?.value ?? '—'} → {value}. Il
            turno in corso non cambia.
          </>
        ),
      });
      setEdit(null);
    });
  };
  const head = (
    <header>
      <Avatar name={thrower} />
      <b>
        {(unit?.members.length ?? 0) > 1
          ? `${names.name(slot.entryId)} (${thrower})`
          : names.name(slot.entryId)}{' '}
        · Round {slot.round}
      </b>
      {v?.bust && <StatusChip tone="warning">BUST</StatusChip>}
      {v?.state === 'skipped' && <StatusChip tone="neutral">SALTATO</StatusChip>}
      {v?.state === 'partial' && <StatusChip tone="warning">PARZIALE</StatusChip>}
      {v?.state === 'reenter' && <StatusChip tone="warning">DA REINSERIRE</StatusChip>}
      {v?.state === 'review' && <StatusChip tone="warning">DA VERIFICARE</StatusChip>}
      {v?.state === 'early' && !v.bust && <StatusChip tone="success">CHIUSO PRIMA</StatusChip>}
      {v?.status === 'recorded' && !v.darts && <StatusChip tone="neutral">SOLO TOTALE</StatusChip>}
    </header>
  );
  if (edit !== null)
    return (
      <section className="g-cell">
        {head}
        <div className="g-out">
          <output aria-live="polite">{edit || '0'}</output>
          <span className="hint">{spec.label.toLowerCase()}</span>
        </div>
        <NumberKeypad
          value={edit}
          change={setEdit}
          submit={save}
          undo={() => setEdit('')}
          busy={command.busy}
          canUndo={false}
          maximum={max}
          notify={() => undefined}
          quick={[]}
          quickLabel=""
          limitLabel={`Massimo ${max}`}
          okLabel="Salva il valore"
        />
        {v?.darts && (
          <p className="hint">
            Le freccette restano com’erano: se il valore non torna, la cella resta da verificare.
          </p>
        )}
        <p className="hint">{stays}</p>
        <div className="pair">
          <button type="button" onClick={() => setEdit(null)} disabled={command.busy}>
            Indietro
          </button>
          <button
            type="button"
            className="primary"
            disabled={edit === '' || command.busy}
            onClick={save}
          >
            {command.busy ? 'SALVATAGGIO…' : 'SALVA'}
          </button>
        </div>
        <ErrorMessage error={command.error} />
      </section>
    );
  if (voiding)
    return (
      <section className="g-cell">
        {head}
        <p>
          Annullare il round {slot.round} di {names.name(slot.entryId)}? Il valore resta nello
          storico e il round torna da inserire. {stays}
        </p>
        <div className="pair">
          <button type="button" onClick={() => setVoiding(false)} disabled={command.busy}>
            Indietro
          </button>
          <button
            type="button"
            className="warning"
            disabled={command.busy}
            onClick={() =>
              command.run(
                'rounds/void',
                { entryId: slot.entryId, round: slot.round, reason: 'Annullato dalla matrice' },
                () => {
                  setVoiding(false);
                  notify({
                    text: <>Round annullato: torna da inserire. Il turno in corso non cambia.</>,
                  });
                },
              )
            }
          >
            Annulla round
          </button>
        </div>
        <ErrorMessage error={command.error} />
      </section>
    );
  const thrown = history.length > 0;
  return (
    <section className="g-cell">
      {head}
      {!v || v.status === 'missing' ? (
        <>
          <p className="hint">
            {current
              ? 'È il turno in corso: si registra da Live.'
              : thrown
                ? 'Il valore è stato annullato: inseriscilo di nuovo quando lo conosci.'
                : plan.gaps.some((s) => sameSlot(s, slot))
                  ? 'Turno passato senza valore: inseriscilo se lo conosci.'
                  : 'Round non ancora giocato.'}
          </p>
          {current ? (
            <button type="button" onClick={() => go('live')}>
              Vai a Live
            </button>
          ) : (
            (thrown || plan.gaps.some((s) => sameSlot(s, slot))) && (
              <button type="button" onClick={() => setEdit('')}>
                Inserisci
              </button>
            )
          )}
        </>
      ) : (
        <>
          <div className="g-sum">
            <div className="big">
              <small>{spec.label}</small>
              <strong>{v.value ?? '–'}</strong>
            </div>
            <div className="rows">
              <span>
                {x01 ? 'Residuo prima' : 'Totale prima'}
                <b>{before ?? '—'}</b>
              </span>
              <span>
                {x01 ? 'Residuo dopo' : 'Totale dopo'}
                <b>{after ?? '—'}</b>
              </span>
            </div>
          </div>
          {v.darts ? (
            <>
              <span className="eyebrow">Dettaglio freccette</span>
              <div className="dart-cells small">
                {[0, 1, 2].map((i) => (
                  <DartCell
                    key={i}
                    index={i}
                    dart={v.darts![i] ?? null}
                    unused={i >= v.darts!.length}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="hint">
              {v.status === 'skipped'
                ? 'Turno non osservato: nessun valore, nemmeno zero.'
                : 'Solo totale: le freccette di questo turno non sono state registrate.'}
            </p>
          )}
          {v.state === 'review' && (
            <p className="g-warn">
              <Info aria-hidden="true" />
              <span>
                Le freccette danno {v.dartsValue}, il valore registrato è {v.value}. Il dettaglio
                resta com’era: correggi il valore se serve.
              </span>
            </p>
          )}
        </>
      )}
      {history.length > 0 && (
        <ul className="g-hist" aria-label="Cronologia del round">
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
      {v && v.status !== 'missing' && (
        <div className="pair">
          <button
            type="button"
            disabled={command.busy}
            onClick={() => setEdit(v.value === null ? '' : String(v.value))}
          >
            {v.value === null ? 'Inserisci' : 'Modifica'}
          </button>
          <button
            type="button"
            className="warning"
            disabled={command.busy}
            onClick={() => setVoiding(true)}
          >
            Annulla round
          </button>
        </div>
      )}
      {v?.corrected && (
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
              () => notify({ text: <>Valore precedente ripristinato.</> }),
            )
          }
        >
          Ripristina il valore precedente
        </button>
      )}
      <ErrorMessage error={command.error} />
    </section>
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
  return (
    <div className="g-results">
      <div className="g-note">
        <Info aria-hidden="true" />
        <span>
          {ended
            ? 'Il risultato ufficiale è quello del totem. Il totale del companion serve a verificarlo, non lo sostituisce.'
            : `Turni in corso: ${plan.expected ? `${plan.expected - plan.thrown} da registrare. ` : ''}I valori del totem si inseriscono a fine manche.`}
        </span>
      </div>
      <ol className="g-res">
        {plan.seats.map((id) => {
          const p = names.progress(id);
          const value = metricOf(m, p);
          const off = official(id);
          const reconciled = m.result?.reconciliation.find((r) => r.entryId === id);
          const missing = p?.missing ?? [];
          const skipped = p?.skipped ?? [];
          let tone = '';
          let state: ReactNode;
          if (off === null)
            state = (
              <>
                <StatusChip tone="neutral">DA INSERIRE</StatusChip>
                <span>
                  {missing.length || skipped.length
                    ? `Round mancanti o saltati: ${[...missing, ...skipped]
                        .sort((a, b) => a - b)
                        .map((r) => `R${r}`)
                        .join(', ')}`
                    : 'Leggi il punteggio finale sul totem.'}
                </span>
              </>
            );
          else if (!p?.complete) {
            tone = 'ok';
            state = (
              <>
                <StatusChip tone="success">TOTEM REGISTRATO</StatusChip>
                <span>Round incompleti: il companion non può verificarlo.</span>
              </>
            );
          } else if (p.computed === off) {
            tone = 'ok';
            state = <StatusChip tone="success">COINCIDE</StatusChip>;
          } else if (reconciled) {
            tone = 'ok';
            state = (
              <>
                <StatusChip tone="success">TOTEM CONFERMATO</StatusChip>
                <span>{reconciled.reason}</span>
              </>
            );
          } else {
            tone = 'diff';
            state = (
              <>
                <StatusChip tone="warning">
                  DIFFERENZA {p.computed !== null && off - p.computed > 0 ? '+' : ''}
                  {p.computed !== null ? off - p.computed : ''}
                </StatusChip>
                <button type="button" onClick={() => review(id)}>
                  Correggi un round
                </button>
              </>
            );
          }
          return (
            <li key={id} className={tone}>
              <div className="g-res-top">
                <Avatar name={names.name(id)} />
                <span className="g-nm">
                  <b>{names.name(id)}</b>
                  <small>
                    Companion {value ?? '—'}
                    {p && !p.complete ? ' parziale' : ''} · {p?.recorded ?? 0}/
                    {p?.rounds.length ?? 0} round
                  </small>
                </span>
                <span className="g-off">
                  <small>TOTEM</small>
                  <strong>{off ?? '—'}</strong>
                </span>
              </div>
              <div className="g-res-st">{state}</div>
            </li>
          );
        })}
      </ol>
      <ResultEntry query={query} tournament={tournament} embedded review={review} />
    </div>
  );
}
