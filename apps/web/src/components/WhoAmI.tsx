import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, UserRound } from 'lucide-react';
import { api, localData, nickname } from '../services/api';
import { meStore, useMe } from '../services/me';
import { Avatar, ErrorMessage, Loading, Modal } from './ui';
import { FxName, useProgression } from './Progression';

function useAllPlayers() {
  return useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
}

/** Whether the phone knows its owner: they must be one of the players it holds. */
export function useKnowsMe() {
  const me = useMe();
  const players = useAllPlayers();
  const known = !!me && !!players.data?.items.some((p) => p.id === me);
  return { me: known ? me : null, ready: !!players.data, players: players.data?.items ?? [] };
}

/**
 * Picks who owns this phone among the players it already has, or creates the profile when
 * the owner is not among them yet. Used by the Home card and by the settings.
 */
export function WhoAmISheet({ close }: { close: () => void }) {
  const client = useQueryClient();
  const players = useAllPlayers();
  const progression = useProgression();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createPlayer(name.trim()),
    onSuccess: (player) => {
      choose(player.id);
      void client.invalidateQueries();
    },
  });
  const choose = (id: string) => {
    meStore.set(id);
    close();
  };
  const active = players.data?.items.filter((p) => p.status === 'active') ?? [];
  return (
    <Modal
      title="Chi sei?"
      subtitle="Scegli il tuo giocatore: il telefono lo ricorderà"
      close={close}
    >
      {players.isPending && <Loading />}
      <ErrorMessage error={players.error ?? create.error} />
      {active.length > 0 && (
        <ul className="roster" aria-label="Giocatori presenti su questo telefono">
          {active.map((p) => (
            <li key={p.id}>
              <button type="button" className="pl" onClick={() => choose(p.id)}>
                <Avatar name={p.displayName} avatar={p.avatar} />
                <span>
                  <b>
                    <FxName name={p.displayName} p={progression.data?.players.get(p.id)} />
                  </b>
                  <small>
                    {[progression.data?.players.get(p.id)?.cosmetics.levelTitle, nickname(p)]
                      .filter(Boolean)
                      .join(' · ') || 'Nessuna partita'}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label className="field">
          Non sei nell’elenco? Crea il tuo profilo
          <input
            value={name}
            maxLength={120}
            placeholder="Il tuo nome"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn cta" disabled={create.isPending || !name.trim()}>
          Crea e usa questo profilo
        </button>
      </form>
    </Modal>
  );
}

/** Home card shown while the phone does not know its owner. */
export function WhoAmICard() {
  const { me, ready, players } = useKnowsMe();
  const [open, setOpen] = useState(false);
  if (!localData || !ready || me || !players.some((p) => p.status === 'active')) return null;
  return (
    <>
      <button type="button" className="alert who-card" onClick={() => setOpen(true)}>
        <UserRound aria-hidden="true" />
        <span>
          <b>Chi sei?</b>
          <small>Scegli il tuo giocatore per avere livello, record e compagnie a tuo nome</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      {open && <WhoAmISheet close={() => setOpen(false)} />}
    </>
  );
}
