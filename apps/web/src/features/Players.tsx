import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { api, nickname, type Player, type PlayerStatus } from '../services/api';
import { tournamentPath } from '../services/session';
import {
  AddButton,
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Segmented,
} from '../components/ui';
import { NewPlayerSheet } from '../components/PlayerSheets';

type Filter = PlayerStatus | 'all';
const PAGE = 100;

function Profile({ player, close }: { player: Player; close: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(player.displayName);
  const [nick, setNick] = useState(player.nickname ?? '');
  const stats = useQuery({
    queryKey: ['player-stats', player.id],
    queryFn: () => api.statistics(player.id),
  });
  // Placements come from each tournament's official results: the latest ten.
  const history = useQuery({
    queryKey: ['player-history', player.id],
    queryFn: async () => {
      const page = await api.history(player.id);
      return Promise.all(
        page.items.slice(0, 10).map(async (summary) => {
          const t = await api.tournament(summary.id);
          const entry = t.entries.find((e) => e.playerId === player.id);
          const place = t.results.find((r) => r.tournamentEntryId === entry?.id)?.finalPlacement;
          return { summary, place };
        }),
      );
    },
  });
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.updatePlayer>[1]) =>
      api.updatePlayer(player.id, patch),
    onSuccess: (_, patch) => {
      void client.invalidateQueries({ queryKey: ['players'] });
      if (!('status' in patch)) close();
    },
  });
  const s = stats.data;
  const current = update.data ?? player;
  const active = current.status === 'active';
  return (
    <Modal
      title={
        <span className="profile-title">
          <Avatar name={player.displayName} className="ring selected" />
          <span>
            {player.displayName}
            <small>{[nickname(current), active ? 'Attivo' : 'Disattivato'].filter(Boolean).join(' · ')}</small>
          </span>
        </span>
      }
      close={close}
    >
      <ErrorMessage error={stats.error ?? history.error ?? update.error} />
      {s && (
        <>
          <div className="stat-tiles">
            <div>
              <small>TORNEI VINTI</small>
              <strong className="gold">{s.tournamentsWon}</strong>
            </div>
            <div>
              <small>FINALI</small>
              <strong>{s.finalsReached}</strong>
            </div>
            <div>
              <small>MIGLIOR POS.</small>
              <strong>{s.bestPlacement ? `${s.bestPlacement}°` : '—'}</strong>
            </div>
          </div>
          {s.byScoringConfiguration.map((c, i) => (
            <section className="config-stats" key={i}>
              <h3>
                Hi-Score · {c.configuration.turns} turni · {c.configuration.dartsPerTurn} freccette ·
                max {c.configuration.maxDartScore}
              </h3>
              <div>
                <span>
                  <strong>{c.matchesPlayed}</strong>
                  <small>incontri</small>
                </span>
                <span>
                  <strong>
                    {c.wins}/{c.draws}/{c.losses}
                  </strong>
                  <small>V/N/P</small>
                </span>
                <span>
                  <strong>{c.averagePerTurn.toFixed(1)}</strong>
                  <small>media</small>
                </span>
                <span>
                  <strong>{c.bestTurn}</strong>
                  <small>best</small>
                </span>
              </div>
            </section>
          ))}
          {s.byScoringConfiguration.length > 0 && (
            <p className="hint">Statistiche separate per configurazione: spareggi e bye esclusi.</p>
          )}
        </>
      )}
      {stats.isPending && <Loading />}
      {!!history.data?.length && (
        <section className="player-history" aria-labelledby="history-title">
          <h3 id="history-title">Storico</h3>
          {history.data.map(({ summary, place }) => (
            <Link key={summary.id} to={tournamentPath(summary)}>
              <span>
                {summary.name}{' '}
                <small>
                  · {new Date(summary.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                </small>
              </span>
              <strong className={place ? `place-${Math.min(place, 4)}` : ''}>
                {place ? `${place}°` : '—'}
              </strong>
            </Link>
          ))}
        </section>
      )}
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ displayName: name.trim(), nickname: nick.trim() || null });
        }}
      >
        <label className="field">
          Nome
          <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Soprannome
          <input value={nick} maxLength={120} onChange={(e) => setNick(e.target.value)} />
        </label>
        <div className="pair">
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ status: active ? 'inactive' : 'active' })}
          >
            {active ? 'Disattiva' : 'Riattiva'}
          </button>
          <button className="primary" disabled={update.isPending || !name.trim()}>
            Salva
          </button>
        </div>
        <p className="hint">
          Disattivare non cancella lo storico: il giocatore sparisce solo dalle nuove iscrizioni.
        </p>
      </form>
    </Modal>
  );
}

export function Players() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Player | null>(null);
  const [creating, setCreating] = useState(false);
  const status = filter === 'all' ? undefined : filter;
  const query = useQuery({
    queryKey: ['players', search.trim(), offset, status],
    queryFn: () => api.players(search.trim(), offset, status),
  });
  const page = query.data;
  return (
    <>
      <Header title="Giocatori" action={<AddButton label="Nuovo giocatore" onClick={() => setCreating(true)} />} />
      <main className="content">
        <div className="search-field">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Cerca giocatori"
            placeholder="Cerca per nome o soprannome"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <Segmented
          label="Filtro stato"
          value={filter}
          change={(f) => {
            setFilter(f);
            setOffset(0);
          }}
          options={[
            { id: 'active', label: 'Attivi' },
            { id: 'inactive', label: 'Disattivati' },
            { id: 'all', label: 'Tutti' },
          ]}
        />
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <ul className="player-rows">
          {page?.items.map((p) => (
            <li key={p.id}>
              <button className={p.status === 'inactive' ? 'inactive' : ''} onClick={() => setOpen(p)}>
                <Avatar name={p.displayName} />
                <span>
                  <span>{p.displayName}</span>
                  <small>{nickname(p) || 'Nessun soprannome'}</small>
                </span>
                {p.status === 'inactive' ? <b className="off-tag">DISATTIVATO</b> : <span />}
                <ChevronRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {page?.total === 0 && (
          <Empty title="Nessun giocatore trovato">
            <p>Puoi crearlo con il tasto +.</p>
          </Empty>
        )}
        {!!page?.total && (
          <p className="count">
            {offset + 1}–{offset + page.items.length} di {page.total}
          </p>
        )}
        {page && page.total > PAGE && (
          <div className="pagination">
            <button disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
              Precedenti
            </button>
            <button disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Successivi
            </button>
          </div>
        )}
      </main>
      {open && <Profile key={open.id} player={open} close={() => setOpen(null)} />}
      {creating && <NewPlayerSheet close={() => setCreating(false)} />}
    </>
  );
}
