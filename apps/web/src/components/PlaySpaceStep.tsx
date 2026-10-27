import { useQuery } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
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

/** "State giocando al Bite the Trouble?", then the other places, or a new one. */
export function PlaySpaceStep({
  value,
  change,
}: {
  value: PlaySpaceChoice | null;
  change: (choice: PlaySpaceChoice | null) => void;
}) {
  const spaces = usePlaySpaces();
  const others = (spaces.data ?? []).filter((s) => s.id !== BT_PLAY_SPACE_ID);
  const elsewhere = value !== null && !choiceIsBt(value);
  const last = lastPlaySpace();
  const lastName = spaces.data?.find((s) => s.id === last)?.name;
  // A draft that was started stays as typed when the choice is toggled back and forth.
  const draft = value?.kind === 'new' ? value : null;
  return (
    <section aria-labelledby="space-title" className="space-step">
      <h2 className="wz-title" id="space-title">
        State giocando al Bite the Trouble?
      </h2>
      <div className="choice" role="radiogroup" aria-labelledby="space-title">
        <button
          type="button"
          role="radio"
          className="opt"
          aria-checked={choiceIsBt(value)}
          onClick={() => change(BT_CHOICE)}
        >
          <b>Sì, siamo al BT</b>
          <small>I risultati contano nella scoreboard del Bite the Trouble.</small>
        </button>
        <button
          type="button"
          role="radio"
          className="opt"
          aria-checked={elsewhere}
          onClick={() => {
            // Nothing is chosen for them: the list or the new-space form comes next.
            if (!elsewhere) change(draft ?? { kind: 'existing', id: '' });
          }}
        >
          <b>No, giochiamo altrove</b>
          <small>Scegli un punto di incontro o creane uno nuovo.</small>
        </button>
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
                    onClick={() => change({ kind: 'existing', id: s.id })}
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
            className="chip dashed"
            aria-pressed={value?.kind === 'new'}
            onClick={() =>
              change(
                draft ?? {
                  kind: 'new',
                  draftId: crypto.randomUUID(),
                  name: '',
                  place: '',
                  target: '',
                },
              )
            }
          >
            <Plus aria-hidden="true" /> Crea punto di incontro
          </button>
          {draft && (
            <div className="space-new">
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
                  placeholder="Es. Da Gino, sala sul retro"
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
              <p className="hint">Nessun indirizzo né posizione: serve solo a riconoscerlo.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
