import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Beer, MapPin, Plus } from 'lucide-react';
import { BT_PLAY_SPACE_ID } from '../../../../packages/domain/src/playspaces/playspaces';
import { localData } from '../services/api';

/**
 * Where the results of a new match count. `existing` is a play space already on the server (or
 * this device); `new` is a draft that is only created at the final confirmation, so going back
 * and forth sends nothing. `draftId` makes the creation idempotent if the answer is lost.
 */
export type PlaySpaceChoice =
  | { kind: 'existing'; id: string }
  | { kind: 'new'; draftId: string; name: string; place: string; target: string };

export const BT_CHOICE: PlaySpaceChoice = { kind: 'existing', id: BT_PLAY_SPACE_ID };
const lastKey = 'bt-last-play-space';
/** The space used last time: offered as a suggestion, never applied by itself. */
export function lastPlaySpace(): string | null {
  try {
    return localStorage.getItem(lastKey);
  } catch {
    return null;
  }
}
export function rememberPlaySpace(id: string) {
  try {
    localStorage.setItem(lastKey, id);
  } catch {
    /* Private mode: nothing to remember. */
  }
}
export const choiceIsBt = (c: PlaySpaceChoice | null) =>
  c?.kind === 'existing' && c.id === BT_PLAY_SPACE_ID;
export const choiceReady = (c: PlaySpaceChoice | null) =>
  c !== null && (c.kind === 'existing' ? c.id !== '' : c.name.trim().length > 0);
export const choiceName = (c: PlaySpaceChoice | null, spaces: { id: string; name: string }[]) =>
  !c ? '' : c.kind === 'new' ? c.name.trim() : (spaces.find((s) => s.id === c.id)?.name ?? '…');

/** Creates the space if it is a draft and returns its id. Called once, at the final step. */
export async function resolvePlaySpace(c: PlaySpaceChoice): Promise<string> {
  if (c.kind === 'existing') return c.id;
  const space = await localData!.createPlaySpace({
    id: c.draftId,
    name: c.name.trim(),
    place: c.place.trim() || null,
    targetDescription: c.target.trim() || null,
  });
  return space.id;
}
export function usePlaySpaces() {
  return useQuery({
    queryKey: ['play-spaces'],
    queryFn: () => localData!.playSpaces(),
    enabled: !!localData,
  });
}

/** Choose the BT scoreboard, another meeting point, or a new one. */
export function PlaySpaceStep({
  value,
  change,
}: {
  value: PlaySpaceChoice | null;
  change: (choice: PlaySpaceChoice | null) => void;
}) {
  const spaces = usePlaySpaces();
  const id = useId();
  const [savedElsewhere, setSavedElsewhere] = useState<PlaySpaceChoice | null>(null);
  const [savedDraft, setSavedDraft] = useState<Extract<PlaySpaceChoice, { kind: 'new' }> | null>(
    null,
  );
  const others = (spaces.data ?? []).filter((s) => s.id !== BT_PLAY_SPACE_ID);
  const elsewhere = value !== null && !choiceIsBt(value);
  const last = lastPlaySpace();
  const lastName = spaces.data?.find((s) => s.id === last)?.name;
  // A draft that was started stays as typed when the choice is toggled back and forth.
  const draft = value?.kind === 'new' ? value : null;
  const choose = (next: PlaySpaceChoice) => {
    if (elsewhere) setSavedElsewhere(value);
    if (draft) setSavedDraft(draft);
    change(next);
  };
  return (
    <section aria-labelledby={`${id}-title`} className="space-step">
      <div className="space-intro">
        <h2 className="wz-title" id={`${id}-title`}>
          Dove giocate?
        </h2>
        <p>Ogni punto ha la sua scoreboard: classifiche e record restano separati.</p>
      </div>
      <div className="space-choices" role="radiogroup" aria-labelledby={`${id}-title`}>
        <label className="space-option">
          <input
            className="space-option-input"
            type="radio"
            name={`${id}-location`}
            checked={choiceIsBt(value)}
            onChange={() => choose(BT_CHOICE)}
          />
          <span className="space-icon">
            <Beer aria-hidden="true" />
          </span>
          <span className="space-copy">
            <b>Al Bite the Trouble</b>
            <small>Conta nella scoreboard del locale, con serate e record del BT</small>
          </span>
          <span className="space-radio" aria-hidden="true" />
        </label>
        <label className="space-option">
          <input
            className="space-option-input"
            type="radio"
            name={`${id}-location`}
            checked={elsewhere}
            onChange={() => choose(savedElsewhere ?? { kind: 'existing', id: '' })}
          />
          <span className="space-icon">
            <MapPin aria-hidden="true" />
          </span>
          <span className="space-copy">
            <b>Altrove</b>
            <small>A casa, in un altro locale o in un punto di incontro vostro</small>
          </span>
          <span className="space-radio" aria-hidden="true" />
        </label>
      </div>
      {elsewhere && (
        <div className="space-others">
          {others.length > 0 && (
            <ul className="list" aria-label="Punti di incontro disponibili">
              {others.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="mv big"
                    aria-pressed={value?.kind === 'existing' && value.id === s.id}
                    onClick={() => choose({ kind: 'existing', id: s.id })}
                  >
                    <MapPin aria-hidden="true" />
                    <span className="nm">
                      <b>{s.name}</b>
                      <small>
                        {[s.place, s.id === last ? 'ultimo usato' : ''].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lastName && !(value?.kind === 'existing' && value.id === last) && (
            <p className="hint">Ultimo usato: {lastName}. Scegli tu dove contare questa partita.</p>
          )}
          <button
            type="button"
            className="btn space-create"
            aria-pressed={value?.kind === 'new'}
            aria-expanded={!!draft}
            aria-controls={`${id}-new`}
            onClick={() =>
              choose(
                draft ??
                  savedDraft ?? {
                    kind: 'new',
                    draftId: crypto.randomUUID(),
                    name: '',
                    place: '',
                    target: '',
                  },
              )
            }
          >
            <Plus aria-hidden="true" /> Nuovo punto di incontro
          </button>
          {draft && (
            <div className="space-new" id={`${id}-new`}>
              <label className="field">
                Nome del punto
                <input
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                  required
                />
              </label>
              <label className="field">
                Luogo (facoltativo)
                <input
                  maxLength={160}
                  placeholder="Es. sala sul retro"
                  value={draft.place}
                  onChange={(e) => change({ ...draft, place: e.target.value })}
                />
              </label>
              <label className="field">
                Dov’è il bersaglio (facoltativo)
                <input
                  maxLength={240}
                  placeholder="Es. vicino al bancone"
                  value={draft.target}
                  onChange={(e) => change({ ...draft, target: e.target.value })}
                />
              </label>
              <p className="hint">Niente indirizzi né posizione: serve solo a riconoscerlo.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
