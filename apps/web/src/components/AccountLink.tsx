import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudApi, type Player } from '../services/api';
import { ErrorMessage } from './ui';

export const accountsKey = ['accounts'];
export function useAccounts() {
  return useQuery({ queryKey: accountsKey, queryFn: () => cloudApi!.users() });
}
const expiry = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** A one-time code to hand over, with a button to share or copy it. */
export function CodeCard({
  label,
  code,
  expiresAt,
}: {
  label: string;
  code: string;
  expiresAt: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = `${label} BT Darts: ${code} (valido fino al ${expiry(expiresAt)}) — ${window.location.origin}`;
  return (
    <div className="card pad" role="status">
      <span className="field-l">{label}</span>
      <strong className="invite-code">{code}</strong>
      <small className="hint">Valido fino al {expiry(expiresAt)} · si usa una volta sola</small>
      <button
        type="button"
        className="btn sm"
        onClick={async () => {
          if (navigator.share) await navigator.share({ text }).catch(() => undefined);
          else {
            await navigator.clipboard?.writeText(text).catch(() => undefined);
            setCopied(true);
          }
        }}
      >
        {copied ? 'Copiato' : 'Condividi'}
      </button>
    </div>
  );
}

/**
 * Admins only, in the player's profile: the account that plays as this player, or a way to
 * give it one. An invite for this player links the account it creates; an existing account can
 * be linked directly (e.g. someone who signed up before the switch).
 */
export function AccountLink({ player }: { player: Player }) {
  const client = useQueryClient();
  const accounts = useAccounts();
  const [choice, setChoice] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: accountsKey });
  const invite = useMutation({
    mutationFn: () => cloudApi!.createInvite(player.id),
    onSuccess: refresh,
  });
  const link = useMutation({
    mutationFn: (userId: string) => cloudApi!.linkAccount(userId, player.id),
    onSuccess: () => {
      setChoice('');
      refresh();
    },
  });
  const unlink = useMutation({
    mutationFn: (userId: string) => cloudApi!.linkAccount(userId, null),
    onSuccess: refresh,
  });
  const users = accounts.data?.users ?? [];
  const owner = users.find((u) => u.playerId === player.id);
  const free = users.filter((u) => !u.playerId);
  const pending = accounts.data?.invites.find((i) => i.playerId === player.id);
  return (
    <section className="account-link" aria-labelledby={`account-${player.id}`}>
      <h3 className="set-h" id={`account-${player.id}`}>
        Account
      </h3>
      <div className="card">
        <div className="row">
          <span className="k">Collegato a</span>
          {owner ? (
            <span className="v">@{owner.username}</span>
          ) : (
            <span className="chip warn">NESSUN ACCOUNT</span>
          )}
        </div>
        {!owner && pending && !invite.data && (
          <div className="row">
            <span className="k">Invito in attesa</span>
            <span className="v">fino al {expiry(pending.expiresAt)}</span>
          </div>
        )}
      </div>
      {owner ? (
        <button
          type="button"
          className="btn ghost sm"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate(owner.id)}
        >
          Scollega @{owner.username}
        </button>
      ) : (
        <>
          {invite.data ? (
            <CodeCard label="Codice invito" {...invite.data} />
          ) : (
            <button
              type="button"
              className="btn"
              disabled={invite.isPending}
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? 'Creazione…' : 'Crea invito per questo giocatore'}
            </button>
          )}
          {free.length > 0 && (
            <form
              className="sheet-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (choice) link.mutate(choice);
              }}
            >
              <label className="field">
                Oppure collega un account esistente
                <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Scegli…</option>
                  {free.map((u) => (
                    <option key={u.id} value={u.id}>
                      @{u.username}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn sm" disabled={!choice || link.isPending}>
                Collega
              </button>
            </form>
          )}
          <p className="hint">
            L’account collegato vede livello, record e compagnie di questo giocatore e può
            modificarne nome, soprannome e colore.
          </p>
        </>
      )}
      <ErrorMessage error={accounts.error ?? invite.error ?? link.error ?? unlink.error} />
    </section>
  );
}
