import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, Users } from 'lucide-react';
import {
  api,
  cloudApi,
  localData,
  nickname,
  type Player,
  type PlayerStatus,
} from '../services/api';
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
import { linkDirection } from '../../../../packages/domain/src/index.js';
import { meStore, useCanManage } from '../services/me';
import { SpaceStats } from './PlaySpaces';
import { AccountLink } from '../components/AccountLink';
import { useKnowsMe } from '../components/WhoAmI';

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
  // Only the owner of a profile changes it; everyone in the crew sees it. Until the phone
  // knows its owner (see the Home) nothing is blocked. In cloud mode admins change any profile.
  const { me } = useKnowsMe();
  const manage = useCanManage();
  const canEdit = cloudApi ? manage || me === player.id : !localData || !me || me === player.id;
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
  const progression = useProgression();
  const level = progression.data?.players.get(player.id);
  const s = stats.data;
  const current = update.data ?? player;
  const active = current.status === 'active';
  const since = new Date(player.createdAt).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
  });
  return (
    <Modal
      title={<FxName name={current.displayName} p={level} />}
      subtitle={[nickname(current), active ? `Attivo · dal ${since}` : 'Disattivato']
        .filter(Boolean)
        .join(' · ')}
      lead={<Avatar name={player.displayName} avatar={avatar} size="xl" />}
      close={close}
      tall
      footer={
        !canEdit ? undefined : editing ? (
          <>
            <button
              key="cancel"
              type="button"
              className="btn ghost"
              disabled={update.isPending}
              onClick={() => setEditing(false)}
            >
              Annulla
            </button>
            <button
              key="save"
              type="submit"
              className="btn cta"
              form="profile-name"
              disabled={update.isPending || !name.trim()}
            >
              Salva
            </button>
          </>
        ) : (
          <>
            {manage && (
              <button
                key="toggle"
                type="button"
                className={`btn ${active ? 'danger' : ''}`}
                disabled={update.isPending}
                onClick={() => update.mutate({ status: active ? 'inactive' : 'active' })}
              >
                {active ? 'Disattiva' : 'Riattiva'}
              </button>
            )}
            <button key="edit" type="button" className="btn cta" onClick={() => setEditing(true)}>
              Modifica nome
            </button>
          </>
        )
      }
    >
      <ErrorMessage error={stats.error ?? history.error ?? update.error} />
      {level && <ProgressPanel p={level} />}
      <SpaceStats playerId={player.id} />
      <p className="hint">
        Le statistiche qui sotto sono lo storico personale complessivo, di tutti i punti di incontro
        insieme: non è una classifica.
      </p>
      {canEdit && editing && (
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
      {canEdit ? (
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
      ) : (
        <p className="note">
          <span>
            Solo {player.displayName} può modificare il proprio profilo. Tu lo vedi come tutti gli
            altri della compagnia.
          </span>
        </p>
      )}
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
      {localData && !cloudApi && <ThisIsMe player={player} />}
      {cloudApi && manage && <AccountLink player={player} />}
      {localData && canEdit && manage && <LinkDuplicate player={player} close={close} />}
    </Modal>
  );
}

/** Marks this player as the owner of the phone. */
function ThisIsMe({ player }: { player: Player }) {
  const { me } = useKnowsMe();
  if (me === player.id) return <p className="hint">Questo è il tuo profilo su questo telefono.</p>;
  // Once the phone knows its owner, changing it is deliberate: Impostazioni → Io sono.
  if (me) return null;
  return (
    <button type="button" className="btn" onClick={() => meStore.set(player.id)}>
      Sono io
    </button>
  );
}

/**
 * The same person created twice (e.g. on two phones): the two records are merged into one that
 * stays active. Its matches, statistics and level sum up the other's; its account, crews and
 * missing nickname or avatar follow. Not undone from here.
 */
function LinkDuplicate({ player, close }: { player: Player; close: () => void }) {
  const client = useQueryClient();
  const [other, setOther] = useState('');
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
  const links = useQuery({ queryKey: ['links'], queryFn: () => localData!.links() });
  const link = useMutation({
    mutationFn: () => localData!.linkPlayers(player.id, other),
    onSuccess: () => {
      void client.invalidateQueries();
      close();
    },
  });
  const merged = new Set(links.data?.map((l) => l.from));
  const candidates =
    players.data?.items.filter((p) => p.id !== player.id && !merged.has(p.id)) ?? [];
  const chosen = candidates.find((p) => p.id === other);
  const survivor = chosen && linkDirection(player, chosen).to === chosen.id ? chosen : player;
  return (
    <details className="link-duplicate">
      <summary>È un doppione di un altro giocatore?</summary>
      <p className="hint">
        Se la stessa persona è stata creata due volte, uniscile: partite, statistiche e livello si
        sommano in un solo profilo, che resta attivo.
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
      {chosen && (
        <p className="hint">
          Resta il profilo di {survivor.displayName};{' '}
          {survivor === player ? chosen.displayName : player.displayName} viene assorbito.
        </p>
      )}
      <ErrorMessage error={link.error} />
      <button disabled={!other || link.isPending} onClick={() => link.mutate()}>
        Unisci
      </button>
    </details>
  );
}

/** The level's title and the records held: the level number is the chip on the right. */
const levelLabel = (p?: {
  progress: { level: { title: string } };
  records: { spec: { title: string } }[];
}) => (p ? [p.progress.level.title, ...p.records.map((r) => r.spec.title)].join(' · ') : '');

export function Players() {
  const manage = useCanManage();
  const [search, setSearch] = useState('');
  // Deactivated and merged profiles are for admins only; everyone else sees who plays.
  const [chosen, setFilter] = useState<Filter>('active');
  const filter: Filter = manage ? chosen : 'active';
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Player | null>(null);
  const [creating, setCreating] = useState(false);
  const status = filter === 'all' ? undefined : filter;
  const query = useQuery({
    queryKey: ['players', search.trim(), offset, status],
    queryFn: () => api.players(search.trim(), offset, status),
  });
  const links = useQuery({
    queryKey: ['links'],
    queryFn: () => localData!.links(),
    enabled: !!localData,
  });
  // A merged record is its survivor now: it leaves the lists, and an admin finds it under
  // "Disattivati" with a note.
  const mergedInto = new Map((links.data ?? []).map((l) => [l.from, l.to]));
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
  const everyone = useQuery({
    queryKey: ['players', 'all'],
    queryFn: () => api.players('', 0),
    enabled: manage,
  });
  const nameOf = (id: string) => everyone.data?.items.find((p) => p.id === id)?.displayName;
  const page = query.data && {
    ...query.data,
    items: query.data.items.filter((p) => (manage && filter !== 'active') || !mergedInto.has(p.id)),
  };
  const progression = useProgression();
  const { me } = useKnowsMe();
  return (
    <>
      <Header
        title="Giocatori"
        subtitle={
          counts.data
            ? manage
              ? `${counts.data.active} attivi · ${Math.max(0, counts.data.inactive - mergedInto.size)} disattivati · ${mergedInto.size} uniti`
              : `${counts.data.active} giocatori`
            : undefined
        }
        back={null}
        action={
          manage ? (
            <AddButton label="Nuovo giocatore" onClick={() => setCreating(true)} />
          ) : undefined
        }
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
        {manage && (
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
        )}
      </div>
      <main className="lists">
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
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <ul className="roster">
          {page?.items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`pl with-lv ${p.status === 'inactive' ? 'off' : ''}`}
                onClick={() => setOpen(p)}
              >
                <Avatar name={p.displayName} avatar={p.avatar} />
                <span>
                  <b>
                    <FxName name={p.displayName} p={progression.data?.players.get(p.id)} />
                    {p.id === me && <i className="me-tag">TU</i>}
                  </b>
                  <small>
                    {p.status === 'inactive'
                      ? [
                          mergedInto.has(p.id)
                            ? `unito a ${nameOf(mergedInto.get(p.id)!) ?? 'un altro profilo'}`
                            : 'disattivato',
                          nickname(p),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : [
                          levelLabel(progression.data?.players.get(p.id)),
                          nickname(p) || `dal ${shortDate(p.createdAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </small>
                </span>
                {p.status !== 'inactive' && <LevelChip p={progression.data?.players.get(p.id)} />}
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
