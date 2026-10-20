import { describe, expect, it } from 'vitest';
import {
  confirmation,
  emptyInput,
  parseTurnDraft,
  pressDartKey,
  type DartInput,
  type DartKey,
  type TurnContext,
} from '../apps/web/src/services/guided.js';

const hs: TurnContext = { game: 'HI_SCORE', round: 1, remaining: null };
function keys(sequence: DartKey[], ctx = hs, input: DartInput = emptyInput()) {
  const messages: string[] = [];
  for (const key of sequence) {
    const result = pressDartKey(input, key, ctx);
    if (result.message) messages.push(result.message);
    input = result.input;
  }
  return { input, messages };
}

describe('Dart keypad', () => {
  it('types sector then S, D or T, and moves to the next dart', () => {
    const { input } = keys(['2', '0', 'S', 'X', '2', '0', 'T']);
    expect(input.darts).toEqual([
      { kind: 'single', sector: 20 },
      { kind: 'miss', sector: null },
      { kind: 'triple', sector: 20 },
    ]);
  });
  it('makes 25 and 50 with the bull key or with 25 S / D, and refuses a triple bull', () => {
    expect(keys(['BULL', 'BULL']).input.darts[0]).toEqual({ kind: 'bull50', sector: null });
    expect(keys(['2', '5', 'D']).input.darts[0]).toEqual({ kind: 'bull50', sector: null });
    const refused = keys(['2', '5', 'T']);
    expect(refused.input.darts[0]).toBeNull();
    expect(refused.messages).toEqual(['Il triplo del bull non esiste.']);
  });
  it('refuses a zero (a miss is ✕) and sectors above 20', () => {
    expect(keys(['0']).messages).toEqual(['Una freccetta fuori si registra con ✕.']);
    expect(keys(['2', '1']).messages).toEqual(['Settori da 1 a 20, oppure 25 per il bull.']);
    expect(keys(['S']).messages).toEqual(['Prima il numero del settore, poi S, D o T.']);
  });
  it('changes the multiplier of a dart already entered, and goes back with ⌫', () => {
    let { input } = keys(['1', '9', 'S']);
    input = { ...input, sel: 0 };
    input = keys(['T'], hs, input).input;
    expect(input.darts[0]).toEqual({ kind: 'triple', sector: 19 });
    input = keys(['BK'], hs, { ...input, sel: 0 }).input;
    expect(input.darts[0]).toBeNull();
  });
  it('clears the darts after a checkout: unused darts are never recorded', () => {
    const x01: TurnContext = { game: '501', round: 9, remaining: 40 };
    const { input } = keys(['2', '0', 'D'], x01, {
      ...emptyInput(),
      darts: [null, { kind: 'single', sector: 1 }, { kind: 'single', sector: 1 }],
    });
    expect(input.darts).toEqual([{ kind: 'double', sector: 20 }, null, null]);
    // Both keys are refused on a dart the turn did not use.
    expect(new Set(keys(['1', 'S'], x01, { ...input, sel: 1 }).messages)).toEqual(
      new Set(['La freccetta non è stata usata: il turno è finito.']),
    );
  });
});

describe('Confirmation of a turn', () => {
  const base = {
    ctx: hs,
    kind: 'points' as const,
    x01: false,
    before: 180,
    mode: 'detail' as const,
    quick: '',
    max: 180,
  };
  it('asks for the missing darts, then records the darts only', () => {
    expect(
      confirmation({ ...base, darts: [{ kind: 'single', sector: 20 }, null, null] }),
    ).toMatchObject({
      ok: false,
      why: 'Mancano 2 freccette.',
      points: 20,
      after: 200,
    });
    const c = confirmation({
      ...base,
      darts: [
        { kind: 'single', sector: 20 },
        { kind: 'miss', sector: null },
        { kind: 'triple', sector: 20 },
      ],
    });
    expect(c).toMatchObject({ ok: true, points: 80, after: 260 });
    expect(c.value).toBeUndefined();
    expect(c.darts).toHaveLength(3);
  });
  it('sends the totem total with an unobserved dart, never zero', () => {
    const darts = [
      { kind: 'single' as const, sector: 20 },
      { kind: 'unobserved' as const, sector: null },
      { kind: 'single' as const, sector: 1 },
    ];
    expect(confirmation({ ...base, darts })).toMatchObject({
      ok: false,
      needsTotal: true,
      why: 'Freccetta non osservata: il totale va letto sul totem.',
    });
    const c = confirmation({ ...base, darts, mode: 'quick', quick: '41' });
    expect(c).toMatchObject({ ok: true, value: 41, reason: undefined });
    expect(c.darts).toHaveLength(3);
  });
  it('keeps the totem value against complete darts as an explained correction', () => {
    const darts = [
      { kind: 'single' as const, sector: 20 },
      { kind: 'single' as const, sector: 20 },
      { kind: 'single' as const, sector: 20 },
    ];
    expect(confirmation({ ...base, darts, mode: 'quick', quick: '65' })).toMatchObject({
      ok: true,
      value: 65,
      reason: 'Valore letto sul totem',
    });
  });
  it('drops incomplete darts when only the total is confirmed', () => {
    const c = confirmation({
      ...base,
      darts: [{ kind: 'single', sector: 20 }, null, null],
      mode: 'quick',
      quick: '85',
    });
    expect(c).toMatchObject({ ok: true, value: 85 });
    expect(c.darts).toBeUndefined();
  });
  it('shows a bust in X01 and refuses points above what is left', () => {
    const x01 = {
      ...base,
      ctx: { game: '501' as const, round: 5, remaining: 21 },
      x01: true,
      before: 21,
    };
    expect(
      confirmation({ ...x01, darts: [{ kind: 'triple', sector: 20 }, null, null] }),
    ).toMatchObject({ ok: true, bust: true, points: 0, after: 21 });
    expect(
      confirmation({ ...x01, darts: [null, null, null], mode: 'quick', quick: '40' }),
    ).toMatchObject({
      ok: false,
      why: 'Più dei 21 rimasti: con un bust il turno vale 0.',
    });
    expect(
      confirmation({ ...x01, darts: [null, null, null], mode: 'quick', quick: '21' }),
    ).toMatchObject({ ok: true, closed: true, after: 0 });
  });
  it('does not guess X01 points left after a missing round', () => {
    const c = confirmation({
      ...base,
      ctx: { game: '501', round: 3, remaining: null },
      x01: true,
      before: null,
      darts: [
        { kind: 'triple', sector: 20 },
        { kind: 'triple', sector: 20 },
        { kind: 'triple', sector: 20 },
      ],
    });
    expect(c).toMatchObject({
      ok: false,
      needsTotal: true,
      why: 'Residuo precedente sconosciuto: il totale va letto sul totem.',
    });
  });
});

describe('Drafts of the turn', () => {
  it('reads well formed drafts only', () => {
    const draft = {
      entryId: 'e1',
      round: 2,
      mode: 'detail',
      darts: [{ kind: 'single', sector: 20 }, null, null],
      quick: '',
    };
    expect(parseTurnDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parseTurnDraft(JSON.stringify({ ...draft, darts: [null] }))).toBeNull();
    expect(parseTurnDraft(JSON.stringify({ ...draft, quick: '12345678' }))).toBeNull();
    expect(parseTurnDraft('not json')).toBeNull();
    expect(parseTurnDraft(null)).toBeNull();
  });
});
