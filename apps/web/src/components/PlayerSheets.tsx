import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api, nickname, type Player } from '../services/api';
import { Avatar, ErrorMessage, Loading, Modal } from './ui';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Picks players of the pub, or creates one from what was typed. Enter adds the exact match or
 * creates the name, then the field is ready for the next one: a table fills from the keyboard.
 */
export function AddPlayerSheet({
  excluded,
  remaining,
  add,
  close,
}: {
  excluded: string[];
  /** Places still free; the sheet closes once the last one is taken. */
  remaining: number;
  add: (player: Player) => void;
  close: () => void;
}) {
  const [q, setQ] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['players', q.trim(), 0, 'active'],
    queryFn: () => api.players(q.trim(), 0, 'active'),
  });
  const pool = (query.data?.items ?? []).filter((p) => !excluded.includes(p.id));
  function taken(player: Player) {
    add(player);
    setQ('');
    if (remaining <= 1) close();
    else field.current?.focus();
  }
  const create = useMutation({
    mutationFn: () => api.createPlayer(q.trim()),
    onSuccess: (player) => {
      void client.invalidateQueries({ queryKey: ['players'] });
      taken(player);
    },
  });
  const name = q.trim();
  return (
    <Modal
      title="Aggiungi giocatore"
      subtitle={
        remaining < 256
          ? `${remaining} ${remaining === 1 ? 'posto libero' : 'posti liberi'}`
          : undefined
      }
      close={close}
      tall
      footer={
        <button className="btn" form="add-player" disabled={!name || create.isPending}>
          {name ? `Crea “${name}” e aggiungi` : 'Scrivi un nome per creare un giocatore'}
        </button>
      }
    >
      <form
        id="add-player"
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name || create.isPending) return;
          const exact = pool.find((p) => sameName(p.displayName, name));
          if (exact) taken(exact);
          else create.mutate();
        }}
      >
        <label className="search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Cerca tra i giocatori del locale</span>
          <input
            ref={field}
            value={q}
            maxLength={120}
            autoCapitalize="words"
            enterKeyHint="done"
            placeholder="Cerca o aggiungi"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </form>
      <div className="roster">
        {pool.map((p) => (
          <button type="button" className="pl" key={p.id} onClick={() => taken(p)}>
            <Avatar name={p.displayName} avatar={p.avatar} />
            <span>
              <b>{p.displayName}</b>
              {nickname(p) && <small>{nickname(p)}</small>}
            </span>
            <span className="chk add" aria-hidden="true">
              <Plus />
            </span>
          </button>
        ))}
        {query.isPending && <Loading />}
        {query.data && !pool.length && <p className="hint">Nessun giocatore trovato.</p>}
      </div>
      <ErrorMessage error={query.error ?? create.error} />
    </Modal>
  );
}

/** A new player with an optional nickname, which tells two people with the same name apart. */
export function NewPlayerSheet({
  close,
  created,
  keepOpen = false,
}: {
  close: () => void;
  created?: (player: Player) => void;
  /** Stays open for the next name (tournament registration). */
  keepOpen?: boolean;
}) {
  const [name, setName] = useState('');
  const [nick, setNick] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const homonyms = useQuery({
    queryKey: ['players', name.trim(), 0, undefined],
    queryFn: () => api.players(name.trim()),
    enabled: !!name.trim(),
  });
  const homonym = !nick.trim() && !!homonyms.data?.items.some((p) => sameName(p.displayName, name));
  const create = useMutation({
    mutationFn: () => api.createPlayer(name.trim(), nick.trim() || null),
    onSuccess: (player) => {
      void client.invalidateQueries({ queryKey: ['players'] });
      created?.(player);
      if (!keepOpen) return close();
      setName('');
      setNick('');
      field.current?.focus();
    },
  });
  return (
    <Modal
      title="Nuovo giocatore"
      subtitle={keepOpen ? 'Invio crea e prepara il prossimo' : undefined}
      close={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            {keepOpen ? 'Fatto' : 'Annulla'}
          </button>
          <button className="btn cta" form="new-player" disabled={!name.trim() || create.isPending}>
            CREA GIOCATORE
          </button>
        </>
      }
    >
      <form
        id="new-player"
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <label className="field">
          Nome
          <input
            ref={field}
            value={name}
            maxLength={120}
            autoCapitalize="words"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Soprannome (facoltativo)
          <input value={nick} maxLength={120} onChange={(e) => setNick(e.target.value)} />
        </label>
        {homonym && (
          <p className="form-reason warn" role="status">
            Esiste già un “{name.trim()}”: aggiungi un soprannome per distinguerli.
          </p>
        )}
        <ErrorMessage error={create.error} />
      </form>
    </Modal>
  );
}
