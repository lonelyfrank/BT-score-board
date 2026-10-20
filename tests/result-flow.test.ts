import { describe, expect, it } from 'vitest';
import {
  currentEntry,
  nextAfter,
  parseDraft,
  serializeDraft,
} from '../apps/web/src/services/result-flow.js';

const seats = (...ids: string[]) => ids.map((tournamentEntryId) => ({ tournamentEntryId }));

describe('Result screen: who is in entry', () => {
  const heat = seats('a', 'b', 'c', 'd');
  it('starts from the first competitor still without a result', () => {
    const recorded = new Set(['a']);
    expect(currentEntry(heat, null, (id) => recorded.has(id))).toBe('b');
  });
  it('never picks a recorded competitor by itself once a heat is complete', () => {
    // Before V1.2 the first player of the played heat was armed: the next heat's first total
    // could overwrite their score.
    expect(currentEntry(heat, null, () => true)).toBeNull();
  });
  it('corrects a recorded competitor only when tapped', () => {
    expect(currentEntry(heat, 'a', () => true)).toBe('a');
  });
  it('ignores a tap left over from another heat', () => {
    expect(currentEntry(heat, 'z', () => false)).toBe('a');
  });
  it('moves on in playing order after a save, wrapping to the ones skipped', () => {
    const pending = new Set(['a', 'c']);
    expect(nextAfter(heat, 'b', (id) => pending.has(id))).toBe('c');
    expect(nextAfter(heat, 'c', (id) => pending.has(id) && id !== 'c')).toBe('a');
    expect(nextAfter(heat, 'd', () => false)).toBeNull();
  });
});

describe('Result screen: drafts across a reload', () => {
  it('keeps the digits with the competitor they were typed for', () => {
    const raw = serializeDraft({ entryId: 'b', value: '420' });
    expect(parseDraft(raw)).toEqual({ entryId: 'b', value: '420' });
    expect(serializeDraft(null)).toBe('');
  });
  it('drops drafts without a competitor, damaged or not numeric', () => {
    expect(parseDraft('420')).toBeNull();
    expect(parseDraft('{')).toBeNull();
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft(JSON.stringify({ entryId: 'b', value: '4a' }))).toBeNull();
    expect(parseDraft(JSON.stringify({ value: '420' }))).toBeNull();
  });
});
