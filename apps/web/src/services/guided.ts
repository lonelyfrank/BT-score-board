/**
 * Guided scoring, kept apart from React so that it can be tested: the dart keypad, what the
 * confirmation would record and why it cannot yet, and the drafts that survive a reload.
 * The game rules themselves come from the domain (evaluateTurn), never copied here.
 */
import {
  evaluateTurn,
  type TurnEvaluation,
} from '../../../../packages/domain/src/scoring/darts.js';
import type { DartThrow, GameMode } from '../../../../packages/domain/src/model.js';
import type { Match } from './game.js';

export type { DartThrow };
export type Plan = Match['turnPlans'][number];
export type Cell = DartThrow | null;
export type EntryMode = 'detail' | 'quick';

/** The three cells being typed: the selected one, digits typed for it, a bull to double. */
export interface DartInput {
  darts: Cell[];
  sel: number;
  typed: string;
  /** Cell that just got a bull 25: BULL again makes it 50. */
  bull: number | null;
}
export const emptyInput = (): DartInput => ({
  darts: [null, null, null],
  sel: 0,
  typed: '',
  bull: null,
});
export interface TurnContext {
  game: GameMode;
  round: number;
  /** X01: points left before the turn, null when unknown. */
  remaining: number | null;
}

/** The darts of the turn so far: the filled cells up to the first empty one. */
export function enteredDarts(darts: Cell[]) {
  const out: DartThrow[] = [];
  for (const d of darts) {
    if (!d) break;
    out.push(d);
  }
  return out;
}
export interface TurnView {
  ev: TurnEvaluation | null;
  /** Cell after which the turn is over (bust, checkout): later cells are unused. */
  endedAt: number | null;
  unused: (index: number) => boolean;
  /** Darts still to enter before the turn can be confirmed. */
  missing: number;
  complete: boolean;
  /** Darts to send: three, or up to the one that ended the turn. */
  darts: DartThrow[];
}
export function turnView(ctx: TurnContext, darts: Cell[]): TurnView {
  const prefix = enteredDarts(darts);
  const ev = prefix.length ? evaluateTurn(ctx, prefix) : null;
  const endedAt = ev?.endedAt ?? null;
  const needed = endedAt === null ? 3 : endedAt + 1;
  const sent = prefix.slice(0, needed);
  return {
    ev: sent.length ? evaluateTurn(ctx, sent) : null,
    endedAt,
    unused: (i) => endedAt !== null && i > endedAt,
    missing: needed - sent.length,
    complete: sent.length === needed,
    darts: sent,
  };
}

/** Cells after the end of the turn are cleared: unused darts are never recorded. */
function settle(input: DartInput, ctx: TurnContext): DartInput {
  const view = turnView(ctx, input.darts);
  const darts = input.darts.map((d, i) => (view.unused(i) ? null : d));
  const open = (i: number) => !darts[i] && !view.unused(i);
  const after = [0, 1, 2].find((i) => i > input.sel && open(i));
  const any = [0, 1, 2].find(open);
  return { ...input, darts, typed: '', sel: after ?? any ?? input.sel };
}
/** Puts a dart in a cell and moves to the next empty one. */
export function placeDart(input: DartInput, index: number, dart: Cell, ctx: TurnContext) {
  const darts = [...input.darts];
  darts[index] = dart;
  return settle({ ...input, darts, sel: index, bull: null }, ctx);
}

export type DartKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'S' | 'D' | 'T' | 'BULL' | 'X' | 'BK';
/**
 * One key of the dart keypad: the sector (1–20, 25 for the bull), then S, D or T. BULL is 25
 * and 50 when tapped again, ✕ a dart off the board, ⌫ goes back. Returns the new input and,
 * when the key was refused, the reason to show.
 */
export function pressDartKey(
  input: DartInput,
  key: DartKey,
  ctx: TurnContext,
): { input: DartInput; message?: string } {
  const i = input.sel;
  const cell = input.darts[i];
  const view = turnView(ctx, input.darts);
  if (view.unused(i))
    return { input, message: 'La freccetta non è stata usata: il turno è finito.' };
  if (/^\d$/.test(key)) {
    const typed = input.typed.length >= 2 ? key : input.typed + key;
    if (typed === '0') return { input, message: 'Una freccetta fuori si registra con ✕.' };
    const n = Number(typed);
    if (typed.length === 2 && !(n <= 20 || n === 25))
      return { input, message: 'Settori da 1 a 20, oppure 25 per il bull.' };
    return { input: { ...input, typed: String(n), bull: null } };
  }
  if (key === 'S' || key === 'D' || key === 'T') {
    const n = input.typed
      ? Number(input.typed)
      : cell && cell.sector !== null
        ? cell.sector
        : cell && (cell.kind === 'bull25' || cell.kind === 'bull50')
          ? 25
          : null;
    if (n === null) return { input, message: 'Prima il numero del settore, poi S, D o T.' };
    if (n === 25) {
      if (key === 'T') return { input, message: 'Il triplo del bull non esiste.' };
      return {
        input: placeDart(input, i, { kind: key === 'S' ? 'bull25' : 'bull50', sector: null }, ctx),
      };
    }
    if (n < 1 || n > 20) return { input, message: 'Settori da 1 a 20.' };
    const kind = key === 'S' ? 'single' : key === 'D' ? 'double' : 'triple';
    return { input: placeDart(input, i, { kind, sector: n }, ctx) };
  }
  if (key === 'BULL') {
    const last = input.bull;
    if (last !== null && !input.typed && input.darts[last]?.kind === 'bull25')
      return { input: placeDart(input, last, { kind: 'bull50', sector: null }, ctx) };
    return { input: { ...placeDart(input, i, { kind: 'bull25', sector: null }, ctx), bull: i } };
  }
  if (key === 'X') return { input: placeDart(input, i, { kind: 'miss', sector: null }, ctx) };
  // Backspace: the digits typed, then the dart of the cell, then the cell before.
  if (input.typed) return { input: { ...input, typed: input.typed.slice(0, -1) } };
  if (cell) return { input: placeDart(input, i, null, ctx) };
  return { input: { ...input, sel: Math.max(0, i - 1), bull: null } };
}

export const dartLabel: Record<DartThrow['kind'], string> = {
  single: 'Singolo',
  double: 'Doppio',
  triple: 'Triplo',
  bull25: 'Bull',
  bull50: 'Bull 50',
  miss: 'Fuori',
  unobserved: 'Non vista',
};
/** Short text of a dart: "T20", "25", "50", "✕", "?". */
export function dartText(d: DartThrow) {
  switch (d.kind) {
    case 'single':
      return String(d.sector);
    case 'double':
      return `D${d.sector}`;
    case 'triple':
      return `T${d.sector}`;
    case 'bull25':
      return '25';
    case 'bull50':
      return '50';
    case 'miss':
      return '✕';
    case 'unobserved':
      return '?';
  }
}

/** What a confirmation records, and the label and reason shown on the main button. */
export interface Confirmation {
  ok: boolean;
  /** Value sent (undefined: the darts decide it). */
  value?: number | null;
  darts?: DartThrow[];
  /** Darts and totem value differ: the value is kept as an explained correction. */
  reason?: string;
  why: string | null;
  /** The darts cannot decide the turn: offer the total from the totem instead. */
  needsTotal: boolean;
  /** Turn points (or value) shown in the summary; null while unknown. */
  points: number | null;
  /** Running total or points left after the turn; null while unknown. */
  after: number | null;
  bust: boolean;
  closed: boolean;
  shanghai: boolean;
}
export function confirmation(options: {
  ctx: TurnContext;
  kind: 'points' | 'remaining' | 'progress';
  /** X01 (points left shown, whichever value is entered). */
  x01: boolean;
  before: number | null;
  mode: EntryMode;
  darts: Cell[];
  quick: string;
  max: number;
}): Confirmation {
  const { ctx, kind, x01, before, mode, quick, max } = options;
  const view = turnView(ctx, options.darts);
  const base = {
    ok: false,
    why: null,
    needsTotal: false,
    points: null,
    after: null,
    bust: false,
    closed: false,
    shanghai: false,
  };
  const afterOf = (points: number | null, bust: boolean) =>
    points === null || before === null
      ? null
      : x01
        ? bust
          ? before
          : before - points
        : before + points;
  if (mode === 'quick' || kind === 'progress') {
    if (quick === '') return { ...base, why: 'Digita il valore letto sul totem.' };
    const value = Number(quick);
    if (value > max) return { ...base, why: `Massimo ${max}.` };
    // Complete darts entered before switching to the total are kept with it.
    const darts = view.complete && view.darts.length ? view.darts : undefined;
    const derived =
      darts && view.ev?.points != null
        ? kind === 'points'
          ? view.ev.points
          : kind === 'remaining' && ctx.remaining !== null
            ? ctx.remaining - view.ev.points
            : null
        : null;
    const points = kind === 'remaining' ? (before === null ? null : before - value) : value;
    if (x01 && kind === 'points' && before !== null && value > before)
      return {
        ...base,
        points: value,
        why: `Più dei ${before} rimasti: con un bust il turno vale 0.`,
      };
    if (x01 && kind === 'remaining' && before !== null && value > before)
      return { ...base, why: `Più dei ${before} rimasti prima del turno.` };
    return {
      ...base,
      ok: true,
      value,
      darts,
      reason: derived !== null && derived !== value ? 'Valore letto sul totem' : undefined,
      points: kind === 'progress' ? value : points,
      after: kind === 'remaining' ? value : kind === 'progress' ? value : afterOf(value, false),
      closed: x01 && (kind === 'remaining' ? value === 0 : before !== null && value === before),
    };
  }
  const ev = view.ev;
  const unknown = !!ev && ev.points === null;
  // No dart yet: the turn is worth 0 so far and the total has not moved.
  const points = ev ? ev.points : 0;
  const result = {
    ...base,
    points,
    after: afterOf(points, !!ev?.bust),
    bust: !!ev?.bust,
    closed: !!ev?.closed,
    shanghai: !!ev?.shanghai,
  };
  if (!view.complete) {
    const n = view.missing;
    return { ...result, why: `Manca${n > 1 ? 'no' : ''} ${n} freccett${n > 1 ? 'e' : 'a'}.` };
  }
  if (unknown || (kind === 'remaining' && ctx.remaining === null))
    return {
      ...result,
      needsTotal: true,
      why:
        ev?.unknown === 'remaining' || (kind === 'remaining' && ctx.remaining === null)
          ? 'Residuo precedente sconosciuto: il totale va letto sul totem.'
          : 'Freccetta non osservata: il totale va letto sul totem.',
    };
  return { ...result, ok: true, darts: view.darts };
}

/** Digits and darts not confirmed yet, with the turn they belong to. */
export interface TurnDraft {
  entryId: string;
  round: number;
  mode: EntryMode;
  darts: Cell[];
  quick: string;
}
const isDart = (d: unknown): d is DartThrow =>
  !!d &&
  typeof d === 'object' &&
  typeof (d as DartThrow).kind === 'string' &&
  ((d as DartThrow).sector === null || Number.isInteger((d as DartThrow).sector));
/** A stored draft, only when it is well formed. */
export function parseTurnDraft(raw: string | null): TurnDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<TurnDraft>;
    if (
      typeof d.entryId !== 'string' ||
      !Number.isInteger(d.round) ||
      (d.mode !== 'detail' && d.mode !== 'quick') ||
      !Array.isArray(d.darts) ||
      d.darts.length !== 3 ||
      !d.darts.every((x) => x === null || isDart(x)) ||
      typeof d.quick !== 'string' ||
      !/^\d{0,5}$/.test(d.quick)
    )
      return null;
    return d as TurnDraft;
  } catch {
    return null;
  }
}
