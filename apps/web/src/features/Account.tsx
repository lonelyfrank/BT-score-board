import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Fingerprint, UserRound } from 'lucide-react';
import { api, cloudApi } from '../services/api';
import { useAccount, type Account } from '../services/cloud';
import { Avatar, ErrorMessage, Modal } from '../components/ui';
import { CodeCard, accountsKey, useAccounts } from '../components/AccountLink';

const roleLabel: Record<Account['role'], string> = {
  owner: 'Proprietario',
  admin: 'Admin',
  player: 'Giocatore',
};
const usePlayers = () =>
  useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });

/** The signed-in account: who it plays as, passkeys, password and sign-out. */
export function AccountSection() {
  const account = useAccount()!;
  const client = useQueryClient();
  const players = usePlayers();
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => cloudApi!.passkeys() });
  const [changing, setChanging] = useState(false);
  const add = useMutation({
    mutationFn: () => cloudApi!.addPasskey(deviceName()),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['passkeys'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => cloudApi!.removePasskey(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['passkeys'] }),
  });
  const logout = useMutation({ mutationFn: () => cloudApi!.logout() });
  const me = players.data?.items.find((p) => p.id === account.playerId);
  return (
    <>
      <section className="card pad access on" aria-labelledby="account-title">
        <div className="access-head">
          <span className="access-icon" aria-hidden="true">
            <UserRound />
          </span>
          <div>
            <h2 id="account-title">@{account.username}</h2>
            <span role="status">{roleLabel[account.role]}</span>
          </div>
        </div>
        <dl className="access-facts">
          <dt>Giocatore</dt>
          <dd>{me?.displayName ?? (account.playerId ? '…' : 'non ancora collegato')}</dd>
        </dl>
        {!account.playerId && (
          <p className="hint">
            {account.role === 'player'
              ? 'Chiedi a un admin di collegare il tuo account al tuo giocatore: così livello, record e storico sono tuoi.'
              : 'Collega il tuo account al tuo giocatore toccando il tuo nome in Utenti, qui sotto.'}
          </p>
        )}
        <button
          type="button"
          className="btn ghost"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          Esci
        </button>
      </section>
      <h2 className="set-h" id="passkeys-title">
        Passkey
      </h2>
      <div className="card" aria-labelledby="passkeys-title">
        {passkeys.data?.map((p) => (
          <div className="row" key={p.id}>
            <span>
              <b className="row-title">{p.name}</b>
              <small className="hint">
                {p.lastUsedAt
                  ? `Usata il ${new Date(p.lastUsedAt).toLocaleDateString('it-IT')}`
                  : `Aggiunta il ${new Date(p.createdAt).toLocaleDateString('it-IT')}`}
              </small>
            </span>
            <button
              type="button"
              className="btn sm ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(p.id)}
            >
              Rimuovi
            </button>
          </div>
        ))}
        {passkeys.data?.length === 0 && (
          <div className="row">
            <span className="hint">Nessuna passkey: entri con username e password.</span>
          </div>
        )}
      </div>
      <button type="button" className="btn" disabled={add.isPending} onClick={() => add.mutate()}>
        <Fingerprint aria-hidden="true" />
        {add.isPending ? 'Conferma sul telefono…' : 'Aggiungi una passkey su questo dispositivo'}
      </button>
      <p className="hint">
        Con la passkey entri con impronta, volto o PIN del telefono, senza digitare la password.
      </p>
      <button type="button" className="btn ghost sm" onClick={() => setChanging(true)}>
        Cambia password
      </button>
      <ErrorMessage error={passkeys.error ?? add.error ?? remove.error ?? logout.error} />
      {changing && <PasswordSheet close={() => setChanging(false)} />}
    </>
  );
}
function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone|iPad/.test(ua)
    ? 'iPhone / iPad'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Dispositivo';
}

function PasswordSheet({ close }: { close: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => cloudApi!.changePassword(current, next),
    onSuccess: close,
  });
  return (
    <Modal
      title="Cambia password"
      close={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Annulla
          </button>
          <button
            className="btn cta"
            form="password-form"
            disabled={change.isPending || !current || next.length < 8}
          >
            Salva
          </button>
        </>
      }
    >
      <form
        id="password-form"
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <label className="field">
          Password attuale
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          Nuova password
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <small className="hint">Almeno 8 caratteri.</small>
      </form>
      <ErrorMessage error={change.error} />
    </Modal>
  );
}

/**
 * Admins: every account with its role and player, invites still to be used, and codes to hand
 * over. Only the owner appoints admins.
 */
export function AdminSection() {
  const me = useAccount()!;
  const client = useQueryClient();
  const accounts = useAccounts();
  const players = usePlayers();
  const [open, setOpen] = useState<Account | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: accountsKey });
  const invite = useMutation({
    mutationFn: () => cloudApi!.createInvite(null),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => cloudApi!.revokeInvite(id),
    onSuccess: refresh,
  });
  const name = (playerId: string | null) =>
    players.data?.items.find((p) => p.id === playerId)?.displayName;
  const data = accounts.data;
  const unlinked = data?.users.filter((u) => !u.playerId).length ?? 0;
  return (
    <>
      <h2 className="set-h" id="users-title">
        Utenti
      </h2>
      <ErrorMessage error={accounts.error} retry={() => void accounts.refetch()} />
      <ul className="roster" aria-labelledby="users-title">
        {data?.users.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              className={`pl ${u.disabled ? 'off' : ''}`}
              onClick={() => setOpen(u)}
            >
              <Avatar name={name(u.playerId) ?? u.username} />
              <span>
                <b>
                  @{u.username}
                  {u.id === me.id ? ' (tu)' : ''}
                </b>
                <small>
                  {[
                    roleLabel[u.role],
                    name(u.playerId) ?? 'senza giocatore',
                    u.disabled && 'disattivato',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {unlinked > 0 && (
        <p className="hint">
          Collega ogni account al suo giocatore dal profilo del giocatore (Giocatori → profilo →
          Account) o toccando l’utente qui sopra.
        </p>
      )}
      {invite.data ? (
        <CodeCard label="Codice invito" {...invite.data} />
      ) : (
        <button
          type="button"
          className="btn"
          disabled={invite.isPending}
          onClick={() => invite.mutate()}
        >
          Crea un invito
        </button>
      )}
      <p className="hint">
        Per chi ha già giocato crea l’invito dal suo profilo giocatore: l’account sarà collegato al
        suo storico. Ogni invito vale 7 giorni e una sola registrazione.
      </p>
      {!!data?.invites.length && (
        <>
          <h2 className="set-h">Inviti in attesa</h2>
          <div className="card">
            {data.invites.map((i) => (
              <div className="row" key={i.id}>
                <span>
                  <b className="row-title">{name(i.playerId) ?? 'Nuovo giocatore'}</b>
                  <small className="hint">
                    scade il {new Date(i.expiresAt).toLocaleDateString('it-IT')}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  Revoca
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <ErrorMessage error={invite.error ?? revoke.error} />
      {open && (
        <UserSheet
          user={data?.users.find((u) => u.id === open.id) ?? open}
          close={() => setOpen(null)}
        />
      )}
    </>
  );
}

function UserSheet({ user, close }: { user: Account; close: () => void }) {
  const me = useAccount()!;
  const client = useQueryClient();
  const players = usePlayers();
  const accounts = useAccounts();
  const [playerId, setPlayerId] = useState(user.playerId ?? '');
  const refresh = () => void client.invalidateQueries({ queryKey: accountsKey });
  const link = useMutation({
    mutationFn: () => cloudApi!.linkAccount(user.id, playerId || null),
    onSuccess: refresh,
  });
  const role = useMutation({
    mutationFn: (next: 'admin' | 'player') => cloudApi!.setRole(user.id, next),
    onSuccess: refresh,
  });
  const reset = useMutation({ mutationFn: () => cloudApi!.resetCode(user.id) });
  const disable = useMutation({
    mutationFn: () => cloudApi!.setDisabled(user.id, !user.disabled),
    onSuccess: refresh,
  });
  const taken = new Set(
    accounts.data?.users.filter((u) => u.id !== user.id && u.playerId).map((u) => u.playerId),
  );
  const choices = players.data?.items.filter((p) => !taken.has(p.id)) ?? [];
  const self = user.id === me.id;
  const canManage = user.role !== 'owner' && (me.role === 'owner' || user.role === 'player');
  return (
    <Modal title={`@${user.username}`} subtitle={roleLabel[user.role]} close={close}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate();
        }}
      >
        <label className="field">
          Gioca come
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">Nessun giocatore</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.status === 'inactive' ? ' (disattivato)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="btn cta" disabled={link.isPending || playerId === (user.playerId ?? '')}>
          Salva collegamento
        </button>
      </form>
      {me.role === 'owner' && !self && user.role !== 'owner' && (
        <button
          type="button"
          className="btn"
          disabled={role.isPending}
          onClick={() => role.mutate(user.role === 'admin' ? 'player' : 'admin')}
        >
          {user.role === 'admin' ? 'Togli il ruolo di admin' : 'Nomina admin'}
        </button>
      )}
      {canManage && !self && (
        <>
          {reset.data ? (
            <CodeCard label="Codice di reset" {...reset.data} />
          ) : (
            <button
              type="button"
              className="btn"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Codice per nuova password
            </button>
          )}
          <button
            type="button"
            className={`btn ${user.disabled ? '' : 'danger'}`}
            disabled={disable.isPending}
            onClick={() => disable.mutate()}
          >
            {user.disabled ? 'Riattiva account' : 'Disattiva account'}
          </button>
          <p className="hint">
            Disattivare chiude le sessioni dell’account; il giocatore e il suo storico restano.
          </p>
        </>
      )}
      <ErrorMessage error={link.error ?? role.error ?? reset.error ?? disable.error} />
    </Modal>
  );
}
