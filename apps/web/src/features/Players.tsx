import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Plus } from 'lucide-react';
import { api, type Player } from '../services/api';
import { CrownIcon } from '../components/BrandIcons';
import { Avatar, Header, Modal, ErrorMessage, Loading, Empty } from '../components/ui';

export function PlayerPicker({
  selected,
  change,
  max = 256,
}: {
  selected: Player[];
  change: (players: Player[]) => void;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="picker-section" aria-labelledby="picker-title">
      <div className="section-head">
        <h2 id="picker-title">Giocatori ({max > 16 ? selected.length : `2-${max}`})</h2>
        {selected.length > 0 && <span>Tocca per rimuovere</span>}
      </div>
      <div className="player-picker">
        {selected.map((p, index) => (
          <div className="player-chip" key={p.id}>
            <button
              type="button"
              aria-label={`Rimuovi ${p.displayName}`}
              onClick={() => change(selected.filter((x) => x.id !== p.id))}
            >
              <Avatar name={p.displayName} active className="ring" />
              {index === 0 && <CrownIcon className="chip-crown" />}
              <span>{p.displayName}</span>
            </button>
            {index > 0 && (
              <button
                type="button"
                className="order-button"
                aria-label={`Anticipa ${p.displayName}`}
                onClick={() => {
                  const next = [...selected];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  change(next);
                }}
              >
                <ChevronLeft size={16} />
              </button>
            )}
          </div>
        ))}
        {selected.length < max && (
          <button
            type="button"
            className="player-chip add-player"
            aria-label="Aggiungi"
            onClick={() => setOpen(true)}
          >
            <span className="add-ring">
              <Plus size={26} />
            </span>
            <span>Aggiungi</span>
          </button>
        )}
      </div>
      {open && (
        <Modal title="Aggiungi giocatore" close={() => setOpen(false)}>
          <PlayerList
            select={(p) => {
              const next = [...selected, p];
              change(next);
              if (next.length >= max) setOpen(false);
            }}
            excluded={selected.map((p) => p.id)}
          />
        </Modal>
      )}
    </section>
  );
}
function PlayerList({
  select,
  excluded = [],
}: {
  select?: (p: Player) => void;
  excluded?: string[];
}) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Player | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['players', search, offset],
    queryFn: () => api.players(search, offset),
  });
  const mutation = useMutation({
    mutationFn: () =>
      editing ? api.updatePlayer(editing.id, name.trim()) : api.createPlayer(name.trim()),
    onSuccess: (p) => {
      setName('');
      setEditing(null);
      void client.invalidateQueries({ queryKey: ['players'] });
      if (!editing) select?.(p);
    },
  });
  const profile = useQuery({
    queryKey: ['player-stats', editing?.id],
    queryFn: () => api.statistics(editing!.id),
    enabled: !!editing,
  });
  return (
    <>
      <label className="field">
        Cerca giocatore
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Nome o soprannome"
        />
      </label>
      <form
        className="player-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="field">
          {editing ? 'Modifica nome' : 'Nuovo giocatore'}
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="primary" disabled={mutation.isPending || !name.trim()}>
          {editing ? 'Salva' : 'Crea'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setName('');
            }}
          >
            Annulla modifica
          </button>
        )}
      </form>
      <ErrorMessage error={query.error ?? mutation.error} retry={() => void query.refetch()} />
      {query.isPending && <Loading />}
      <div className="player-list">
        {query.data?.items
          .filter((p) => p.status === 'active' && !excluded.includes(p.id))
          .map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => (select ? select(p) : (setEditing(p), setName(p.displayName)))}
            >
              <Avatar name={p.displayName} />
              <span>{p.displayName}</span>
              {select ? (
                <Plus className="list-plus" size={20} />
              ) : (
                <span className="muted">Modifica</span>
              )}
            </button>
          ))}
      </div>
      {query.data?.total === 0 && (
        <Empty title="Nessun giocatore">Crea il primo giocatore del locale.</Empty>
      )}
      {query.data && query.data.total > 100 && (
        <div className="pagination">
          <button disabled={offset === 0} onClick={() => setOffset(offset - 100)}>
            Precedenti
          </button>
          <button
            disabled={offset + 100 >= query.data.total}
            onClick={() => setOffset(offset + 100)}
          >
            Successivi
          </button>
        </div>
      )}
      {editing && profile.data && (
        <section className="panel">
          <h2>Statistiche di {editing.displayName}</h2>
          <p>
            {profile.data.tournamentsPlayed} tornei · {profile.data.tournamentsWon} vittorie
          </p>
          {profile.data.byScoringConfiguration.map((s, i) => (
            <p key={i}>
              {s.configuration.turns} turni · Media {s.averagePerTurn.toFixed(1)} · Miglior giro{' '}
              {s.bestTurn}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
export function Players() {
  return (
    <>
      <Header title="Giocatori" />
      <main className="content">
        <PlayerList />
      </main>
    </>
  );
}
