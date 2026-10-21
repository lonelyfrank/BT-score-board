import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { api, nickname, type Player, type PlayerStatus } from '../services/api';
import { tournamentPath } from '../services/session';
import { games, type GameMode } from '../services/rules';
import {
  AddButton,
  Avatar,
  avatarPresets,
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
const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const outcomeLabel: Record<string, string> = { win: 'V', draw: 'N', loss: 'P' };
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '';

function Profile({ player, close }: { player: Player; close: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(player.displayName);
  const [nick, setNick] = useState(player.nickname ?? '');
  const [avatar, setAvatar] = useState(player.avatar ?? null);
  const [editing, setEditing] = useState(false);
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
      if ('displayName' in patch) close();
    },
  });
  const s = stats.data;
  const current = update.data ?? player;
  const active = current.status === 'active';
  const since = new Date(player.createdAt).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
  });
  return (
    <Modal
      title={current.displayName}
      subtitle={[nickname(current), active ? `Attivo · dal ${since}` : 'Disattivato']
        .filter(Boolean)
        .join(' · ')}
      lead={<Avatar name={player.displayName} avatar={avatar} size="xl" />}
      close={close}
      tall
      footer={
        editing ? (
          <>
            <button
              type="button"
              className="btn ghost"
              disabled={update.isPending}
              onClick={() => setEditing(false)}
            >
              Annulla
            </button>
            <button
              className="btn cta"
              form="profile-name"
              disabled={update.isPending || !name.trim()}
            >
              Salva
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`btn ${active ? 'danger' : ''}`}
              disabled={update.isPending}
              onClick={() => update.mutate({ status: active ? 'inactive' : 'active' })}
            >
              {active ? 'Disattiva' : 'Riattiva'}
            </button>
            <button type="button" className="btn cta" onClick={() => setEditing(true)}>
              Modifica nome
            </button>
          </>
        )
      }
    >
      <ErrorMessage error={stats.error ?? history.error ?? update.error} />
      {editing && (
        <form
          id="profile-name"
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ displayName: name.trim(), nickname: nick.trim() || null, avatar });
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
        </form>
      )}
      <div className="avatar-row">
        <span className="field-l" id="avatar-label">
          Colore avatar
        </span>
        <div className="swatches" role="radiogroup" aria-labelledby="avatar-label">
          <button
            type="button"
            role="radio"
            aria-checked={avatar === null}
            aria-label="Automatico"
            className="auto"
            disabled={update.isPending}
            onClick={() => {
              setAvatar(null);
              update.mutate({ avatar: null });
            }}
          >
            A
          </button>
          {Object.entries(avatarPresets).map(([id, color]) => (
            <button
              type="button"
              role="radio"
              key={id}
              aria-checked={avatar === id}
              aria-label={id}
              className="swatch"
              style={{ background: color }}
              disabled={update.isPending}
              onClick={() => {
                setAvatar(id);
                update.mutate({ avatar: id });
              }}
            />
          ))}
        </div>
      </div>
      {s && (
        <>
          <div className="card stat3">
            <div>
              <small>Tornei</small>
              <strong>{s.tournamentsPlayed}</strong>
            </div>
            <div>
              <small>Vittorie</small>
              <strong className="gold">{s.tournamentsWon}</strong>
            </div>
            <div>
              <small>Miglior pos.</small>
              <strong>{s.bestPlacement ? `${s.bestPlacement}°` : '—'}</strong>
            </div>
          </div>
          {s.recentMatches.length > 0 && (
            <section className="list" aria-labelledby="matches-title">
              <div className="sec-h">
                <h3 id="matches-title">Ultime partite</h3>
                <span>
                  {s.matchesPlayed} partite · {percent(s.winRate)} vinte
                </span>
              </div>
              {s.recentMatches.slice(0, 6).map((x) => (
                <Link className="mrow" key={x.matchId} to={`/partite/${x.matchId}`}>
                  <span>
                    {games[x.gameMode as GameMode].label} · vs {x.opponents.join(', ')}
                    <br />
                    <small>{shortDate(x.completedAt)}</small>
                  </span>
                  {x.outcome === 'win' ? (
                    <span className="chip ok">
                      {x.score ?? ''} {outcomeLabel[x.outcome]}
                    </span>
                  ) : (
                    <strong>
                      {x.score ?? ''} {outcomeLabel[x.outcome] ?? ''}
                    </strong>
                  )}
                </Link>
              ))}
            </section>
          )}
          {s.byGameMode.length > 0 && (
            <section className="list" aria-labelledby="modes-title">
              <div className="sec-h">
                <h3 id="modes-title">Per gioco</h3>
                <span>modalità separate</span>
              </div>
              {s.byGameMode.map((r) => (
                <div
                  className="mrow mode-stats"
                  key={`${r.gameMode}-${r.rounds}-${r.dartsPerTurn}`}
                >
                  <span>
                    {games[r.gameMode as GameMode].label}
                    {r.rounds !== null && ` · ${r.rounds} round`}
                    {r.dartsPerTurn !== null &&
                      r.dartsPerTurn !== 3 &&
                      ` · ${r.dartsPerTurn} freccette`}
                    <br />
                    <small>
                      {r.matchesPlayed} partite · V/N/P {r.wins}/{r.draws}/{r.losses}
                      {r.bestScore !== null
                        ? ` · record ${r.bestScore} · media ${r.averageScore!.toFixed(0)}`
                        : ` · ${percent(r.winRate)} vinte`}
                    </small>
                  </span>
                  <strong>{r.tournamentsWon}</strong>
                </div>
              ))}
              <p className="hint">
                Punteggi di giochi diversi non si confrontano. Spareggi e vittorie a tavolino
                esclusi.
              </p>
            </section>
          )}
        </>
      )}
      {stats.isPending && <Loading />}
      {!!history.data?.length && (
        <section className="list" aria-labelledby="history-title">
          <div className="sec-h">
            <h3 id="history-title">Storico</h3>
            <span>piazzamenti ufficiali</span>
          </div>
          {history.data.map(({ summary, place }) => (
            <Link className="mrow" key={summary.id} to={tournamentPath(summary)}>
              <span>
                {summary.name}
                <br />
                <small>
                  {new Date(summary.createdAt).toLocaleDateString('it-IT', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </small>
              </span>
              {place === 1 ? (
                <span className="chip ok">1°</span>
              ) : (
                <strong>{place ? `${place}°` : '—'}</strong>
              )}
            </Link>
          ))}
        </section>
      )}
      <p className="hint">
        Disattivare non cancella lo storico: il giocatore sparisce solo dalle nuove iscrizioni.
      </p>
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
  const counts = useQuery({
    queryKey: ['players', 'counts'],
    queryFn: async () => {
      const [a, i] = await Promise.all([
        api.players('', 0, 'active'),
        api.players('', 0, 'inactive'),
      ]);
      return { active: a.total, inactive: i.total };
    },
  });
  const page = query.data;
  return (
    <>
      <Header
        title="Giocatori"
        subtitle={
          counts.data
            ? `${counts.data.active} attivi · ${counts.data.inactive} disattivati`
            : undefined
        }
        back={null}
        action={<AddButton label="Nuovo giocatore" onClick={() => setCreating(true)} />}
      />
      <div className="toolbar">
        <label className="search">
          <Search aria-hidden="true" />
          <span className="visually-hidden">Cerca giocatori</span>
          <input
            type="search"
            placeholder="Cerca giocatori"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <Segmented
          label="Filtro stato"
          small
          value={filter}
          change={(f) => {
            setFilter(f);
            setOffset(0);
          }}
          options={[
            { id: 'active', label: 'Attivi' },
            { id: 'all', label: 'Tutti' },
            { id: 'inactive', label: 'Disattivati' },
          ]}
        />
      </div>
      <main className="lists">
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <ul className="roster">
          {page?.items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`pl ${p.status === 'inactive' ? 'off' : ''}`}
                onClick={() => setOpen(p)}
              >
                <Avatar name={p.displayName} avatar={p.avatar} />
                <span>
                  <b>{p.displayName}</b>
                  <small>
                    {p.status === 'inactive'
                      ? ['disattivato', nickname(p)].filter(Boolean).join(' · ')
                      : nickname(p) || `dal ${shortDate(p.createdAt)}`}
                  </small>
                </span>
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
        {!!page?.total && page.total > page.items.length && (
          <p className="hint">
            {offset + 1}–{offset + page.items.length} di {page.total}
          </p>
        )}
        {page && page.total > PAGE && (
          <div className="pair">
            <button
              type="button"
              className="btn"
              disabled={offset === 0}
              onClick={() => setOffset(offset - PAGE)}
            >
              Precedenti
            </button>
            <button
              type="button"
              className="btn"
              disabled={offset + PAGE >= page.total}
              onClick={() => setOffset(offset + PAGE)}
            >
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
