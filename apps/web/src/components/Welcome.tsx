import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint } from 'lucide-react';
import { cloudApi } from '../services/api';
import { useAccount } from '../services/cloud';
import { deviceName } from '../features/Account';
import { ErrorMessage, Modal } from './ui';

const key = (id: string) => `bt-welcome-passkey-${id}`;
const skipped = (id: string) => {
  try {
    return localStorage.getItem(key(id)) !== null;
  } catch {
    return false;
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem(key(id), '1');
  } catch {
    /* Asked again next time. */
  }
};
const passkeysWork = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window;

/**
 * First sign-in after an invite: the person creates their own player (merging the records made
 * before that they recognise as themselves), then is invited to add a passkey, which signs in
 * with one touch and recovers the account without an admin's code.
 */
export function Welcome() {
  const account = useAccount()!;
  const [later, setLater] = useState(false);
  const [passkeyDone, setPasskeyDone] = useState(() => skipped(account.id));
  if (later) return null;
  if (!account.playerId) return <PlayerStep close={() => setLater(true)} />;
  if (account.passkeys === 0 && !passkeyDone && passkeysWork())
    return (
      <PasskeyStep
        close={() => {
          remember(account.id);
          setPasskeyDone(true);
        }}
      />
    );
  return null;
}

function PlayerStep({ close }: { close: () => void }) {
  const account = useAccount()!;
  const client = useQueryClient();
  const [name, setName] = useState(account.username);
  const [nick, setNick] = useState('');
  const [merge, setMerge] = useState<string[]>([]);
  const candidates = useQuery({
    queryKey: ['welcome-candidates'],
    queryFn: () => cloudApi!.candidates(),
  });
  const create = useMutation({
    mutationFn: () => cloudApi!.createOwnPlayer(name.trim(), nick.trim(), merge),
    onSuccess: () => void client.invalidateQueries(),
  });
  const toggle = (id: string) =>
    setMerge((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const found = candidates.data ?? [];
  return (
    <Modal
      title="Benvenuto!"
      subtitle="Crea il tuo giocatore"
      close={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Più tardi
          </button>
          <button
            className="btn cta"
            form="welcome-player"
            disabled={create.isPending || !name.trim()}
          >
            Crea il mio giocatore
          </button>
        </>
      }
    >
      <form
        id="welcome-player"
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <p className="hint">
          È il profilo con cui giochi: partite, statistiche e livello saranno tuoi.
        </p>
        <label className="field">
          Nome
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Soprannome (facoltativo)
          <input value={nick} maxLength={120} onChange={(e) => setNick(e.target.value)} />
        </label>
        {found.length > 0 && (
          <fieldset className="field">
            <legend>Hai già giocato qui? Riconosciti</legend>
            <p className="hint">
              Se un admin o un amico ti aveva già aggiunto, scegli il tuo nome: partite e livello si
              uniscono al tuo nuovo giocatore.
            </p>
            {found.map((p) => (
              <label key={p.id} className="check">
                <input
                  type="checkbox"
                  checked={merge.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                {p.displayName}
                {p.nickname ? ` “${p.nickname}”` : ''}
              </label>
            ))}
          </fieldset>
        )}
        <ErrorMessage error={candidates.error ?? create.error} />
      </form>
    </Modal>
  );
}

function PasskeyStep({ close }: { close: () => void }) {
  const add = useMutation({
    mutationFn: () => cloudApi!.addPasskey(deviceName()),
    onSuccess: close,
  });
  return (
    <Modal
      title="Accesso veloce"
      subtitle="Aggiungi una passkey"
      close={close}
      footer={
        <>
          <button type="button" className="btn ghost" disabled={add.isPending} onClick={close}>
            Non ora
          </button>
          <button
            type="button"
            className="btn cta"
            disabled={add.isPending}
            onClick={() => add.mutate()}
          >
            <Fingerprint aria-hidden="true" />
            {add.isPending ? 'Conferma sul telefono…' : 'Crea la passkey'}
          </button>
        </>
      }
    >
      <p>
        Con la passkey entri con impronta, volto o PIN del telefono, senza digitare la password.
      </p>
      <p>
        Se un giorno dimentichi la password, la passkey ti fa rientrare subito, senza aspettare un
        codice da un admin.
      </p>
      <ErrorMessage error={add.error} />
    </Modal>
  );
}
