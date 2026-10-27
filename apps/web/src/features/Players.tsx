import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, Users } from 'lucide-react';
import { api, localData, nickname, type Player, type PlayerStatus } from '../services/api';
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
import { FxName, LevelChip, ProgressPanel, useProgression } from '../components/Progression';

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
  const progression = useProgression();
  const level = progression.data?.players.get(player.id);
  const s = stats.data;
  const current = update.data ?? player;
  const active = current.status === 'active';
  return (
    <Modal
      title={
        <span className="profile-title">
          <Avatar name={player.displayName} avatar={avatar} className="ring selected" />
          <span>
            <FxName name={player.displayName} p={level} />
            <small>
              {[nickname(current), active ? 'Attivo' : 'Disattivato'].filter(Boolean).join(' · ')}
            </small>
          </span>
        </span>
      }
      close={close}
    >
      <ErrorMessage error={stats.error ?? history.error ?? update.error} />
      {level && <ProgressPanel p={level} />}
      {s && (
        <>
          <div className="stat-tiles">
            <div>
              <small>TORNEI VINTI</small>
              <strong className="gold">
                {s.tournamentsWon}
                <small>/{s.tournamentsPlayed}</small>
              </strong>
            </div>
            <div>
              <small>PARTITE · VITT.</small>
              <strong>
                {s.matchesPlayed} · {percent(s.winRate)}
              </strong>
            </div>
            <div>
              <small>MIGLIOR POS.</small>
              <strong>{s.bestPlacement ? `${s.bestPlacement}°` : '—'}</strong>
            </div>
          </div>
          {s.byGameMode.map((r) => (
            <section className="config-stats" key={`${r.gameMode}-${r.rounds}-${r.dartsPerTurn}`}>
              <h3>
                {games[r.gameMode as GameMode].label}
                {r.rounds !== null && ` · ${r.rounds} round`}
                {r.dartsPerTurn !== null &&
                  r.dartsPerTurn !== 3 &&
                  ` · ${r.dartsPerTurn} freccette`}
                {` · ${r.tournamentsPlayed} ${r.tournamentsPlayed === 1 ? 'torneo' : 'tornei'}`}
              </h3>
              <div>
                <span>
                  <strong>{r.matchesPlayed}</strong>
                  <small>partite</small>
                </span>
                <span>
                  <strong>
                    {r.wins}/{r.draws}/{r.losses}
                  </strong>
                  <small>V/N/P</small>
                </span>
                {r.bestScore !== null ? (
                  <>
                    <span>
                      <strong>{r.bestScore}</strong>
                      <small>record</small>
                    </span>
                    <span>
                      <strong>{r.averageScore!.toFixed(0)}</strong>
                      <small>media</small>
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <strong>{percent(r.winRate)}</strong>
                      <small>vittorie</small>
                    </span>
                    <span>
                      <strong>{r.tournamentsWon}</strong>
                      <small>tornei vinti</small>
                    </span>
                  </>
                )}
              </div>
            </section>
          ))}
          {s.byGameMode.length > 0 && (
            <p className="hint">
              Statistiche separate per modalità: punteggi di giochi diversi non si confrontano.
              Spareggi e vittorie a tavolino esclusi.
            </p>
          )}
          {s.recentMatches.length > 0 && (
            <section className="player-history" aria-labelledby="matches-title">
              <h3 id="matches-title">Ultime partite</h3>
              {s.recentMatches.slice(0, 8).map((x) => (
                <Link key={x.matchId} to={`/partite/${x.matchId}`}>
                  <span>
                    {games[x.gameMode as GameMode].label} · vs {x.opponents.join(', ')}{' '}
                    <small>· {shortDate(x.completedAt)}</small>
                  </span>
                  <strong className={x.outcome === 'win' ? 'place-1' : ''}>
                    {x.score ?? ''} {outcomeLabel[x.outcome] ?? ''}
                  </strong>
                </Link>
              ))}
            </section>
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
                  ·{' '}
                  {new Date(summary.createdAt).toLocaleDateString('it-IT', {
                    day: 'numeric',
                    month: 'short',
                  })}
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
        <fieldset className="avatar-picker">
          <legend>Avatar (facoltativo)</legend>
          <div role="radiogroup" aria-label="Colore avatar">
            <button
              type="button"
              role="radio"
              aria-checked={avatar === null}
              aria-label="Automatico"
              className="avatar-auto"
              onClick={() => setAvatar(null)}
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
                style={{ background: color }}
                onClick={() => setAvatar(id)}
              />
            ))}
          </div>
        </fieldset>
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
      {localData && <LinkDuplicate player={player} close={close} />}
    </Modal>
  );
}

/**
 * The same person created twice (e.g. on two phones): linking keeps the older record, sums
 * matches and levels on it and deactivates the other. Not undone from here.
 */
function LinkDuplicate({ player, close }: { player: Player; close: () => void }) {
  const client = useQueryClient();
  const [other, setOther] = useState('');
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
  const link = useMutation({
    mutationFn: () => localData!.linkPlayers(player.id, other),
    onSuccess: () => {
      void client.invalidateQueries();
      close();
    },
  });
  const candidates = players.data?.items.filter((p) => p.id !== player.id) ?? [];
  return (
    <details className="link-duplicate">
      <summary>È un doppione di un altro giocatore?</summary>
      <p className="hint">
        Se la stessa persona è stata creata due volte, collegale: partite, statistiche e livello si
        sommano sul profilo più vecchio, l’altro viene disattivato.
      </p>
      <label className="field">
        Stessa persona di
        <select value={other} onChange={(e) => setOther(e.target.value)}>
          <option value="">Scegli…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
              {p.nickname ? ` “${p.nickname}”` : ''}
              {p.status === 'inactive' ? ' (disattivato)' : ''}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={link.error} />
      <button disabled={!other || link.isPending} onClick={() => link.mutate()}>
        Collega
      </button>
    </details>
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
  const progression = useProgression();
  return (
    <>
      <Header
        title="Giocatori"
        action={<AddButton label="Nuovo giocatore" onClick={() => setCreating(true)} />}
      />
      <main className="content">
        {localData && (
          <Link className="crew-link" to="/compagnie">
            <Users aria-hidden="true" />
            <span>
              <strong>Compagnie</strong>
              <small>Condividi partite e livelli con gli amici</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
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
              <button
                className={p.status === 'inactive' ? 'inactive' : ''}
                onClick={() => setOpen(p)}
              >
                <Avatar name={p.displayName} avatar={p.avatar} />
                <span>
                  <FxName name={p.displayName} p={progression.data?.players.get(p.id)} />
                  <small>
                    {[
                      progression.data?.players.get(p.id)?.cosmetics.levelTitle,
                      nickname(p) || (progression.data ? '' : 'Nessun soprannome'),
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Nessun soprannome'}
                  </small>
                </span>
                {p.status === 'inactive' ? (
                  <b className="off-tag">DISATTIVATO</b>
                ) : (
                  <LevelChip p={progression.data?.players.get(p.id)} />
                )}
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
