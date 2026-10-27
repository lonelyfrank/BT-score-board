import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Crown, MapPin, Plus } from 'lucide-react';
import { BT_PLAY_SPACE_ID } from '../../../../packages/domain/src/playspaces/playspaces';
import { api, cloudApi, localData } from '../services/api';
import { isAdmin, useAccount } from '../services/cloud';
import { games, type GameMode } from '../services/rules';
import { Empty, ErrorMessage, Header, Loading } from '../components/ui';
import { FxName, LevelChip, recordValue } from '../components/Progression';
import { Qr, shareLink } from '../components/Qr';
import { usePlaySpaces } from '../components/PlaySpaceStep';

/** A select of the play spaces the account can see; the canonical one is the default. */
export function SpaceSelect({
  value,
  change,
  label = 'Punto di incontro',
}: {
  value: string;
  change: (id: string) => void;
  label?: string;
}) {
  const spaces = usePlaySpaces();
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => change(e.target.value)}>
        {(spaces.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * One player's numbers in one play space: nothing from other spaces is counted. The overall
 * history of the person is a separate, labelled section of the profile.
 */
export function SpaceStats({ playerId }: { playerId: string }) {
  const [spaceId, setSpaceId] = useState(BT_PLAY_SPACE_ID);
  const board = useQuery({
    queryKey: ['progression', spaceId],
    queryFn: () => localData!.progression(spaceId),
    enabled: !!localData,
  });
  if (!localData) return null;
  const p = board.data?.players.get(playerId);
  const titles = p?.records ?? [];
  return (
    <section className="card pad" aria-label="Nel punto di incontro">
      <SpaceSelect value={spaceId} change={setSpaceId} label="Statistiche e record nel punto" />
      <ErrorMessage error={board.error} />
      {board.isPending ? (
        <Loading />
      ) : !p ? (
        <p className="hint">Nessuna partita giocata in questo punto.</p>
      ) : (
        <>
          <p>
            {p.stats.matches} partite · {p.stats.wins} vittorie · {p.stats.tournamentsWon} tornei
            vinti
          </p>
          {titles.map((r) => (
            <p key={r.game} className="record-badge">
              <Crown aria-hidden="true" /> {r.spec.title}: {recordValue(r)}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

/** `/punti`: the play spaces of the account, the new-space form, and legacy data to assign. */
export function PlaySpaces() {
  const spaces = usePlaySpaces();
  const account = useAccount();
  return (
    <>
      <Header title="Punti di incontro" subtitle="Ognuno ha la sua scoreboard" back="/" />
      <main className="spaces">
        <ErrorMessage error={spaces.error} />
        <ul className="list" aria-label="Punti di incontro">
          {(spaces.data ?? []).map((s) => (
            <li key={s.id}>
              <Link className="mv big" to={`/punti/${s.id}`}>
                <MapPin aria-hidden="true" />
                <span className="nm">
                  <b>{s.name}</b>
                  <small>{s.canonical ? 'Aperto a tutti' : (s.place ?? 'Punto di incontro')}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className="chip dashed" to="/partite/nuova">
          <Plus aria-hidden="true" /> Nuova partita (anche in un nuovo punto)
        </Link>
        {isAdmin(account) || !cloudApi ? <Unassigned /> : null}
      </main>
    </>
  );
}

/** Data from before play spaces: reviewed, selected and assigned in one confirmed step. */
function Unassigned() {
  const queries = useQueryClient();
  const spaces = usePlaySpaces();
  const list = useQuery({
    queryKey: ['unclassified'],
    queryFn: () => localData!.unclassifiedTournaments(),
    enabled: !!localData,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [sure, setSure] = useState(false);
  const assign = useMutation({
    mutationFn: () => localData!.assignUnclassified([...picked], target, sure),
    onSuccess: () => {
      setPicked(new Set());
      setSure(false);
      void queries.invalidateQueries();
    },
  });
  const items = list.data ?? [];
  if (!items.length) return null;
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const name = spaces.data?.find((s) => s.id === target)?.name;
  return (
    <section className="card pad" aria-labelledby="unassigned-title">
      <h2 id="unassigned-title">Partite da assegnare ({items.length})</h2>
      <p className="hint">
        Sono precedenti ai punti di incontro: restano nello storico ma non contano in nessuna
        scoreboard finché non scegli dove. Non so quali fossero al BT: decidi tu.
      </p>
      <ul className="list">
        {items.map((t) => (
          <li key={t.id}>
            <label className="check-row">
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              {t.name} · {new Date(t.createdAt).toLocaleDateString('it-IT')}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setPicked(new Set(items.map((t) => t.id)))}
      >
        Seleziona tutte
      </button>
      <label className="field">
        Assegna a
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Scegli…</option>
          {(spaces.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {picked.size > 0 && target && (
        <label className="check-row">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          Confermo: {picked.size} partite contano nella scoreboard {name}
        </label>
      )}
      <button
        type="button"
        className="btn cta"
        disabled={!picked.size || !target || !sure || assign.isPending}
        onClick={() => assign.mutate()}
      >
        Assegna
      </button>
      <ErrorMessage error={assign.error} />
    </section>
  );
}

/** `/punti/:id`: scoreboard, records and sharing of one play space. */
export function PlaySpaceDetail() {
  const { id = '' } = useParams();
  const queries = useQueryClient();
  const spaces = usePlaySpaces();
  const space = spaces.data?.find((s) => s.id === id);
  const board = useQuery({
    queryKey: ['progression', id],
    queryFn: () => localData!.progression(id),
    enabled: !!space,
  });
  const players = useQuery({
    queryKey: ['players', '', 0, 'all'],
    queryFn: () => api.players('', 0),
  });
  const tournaments = useQuery({
    queryKey: ['tournaments', 'space', id],
    queryFn: async () => (await api.tournaments(0)).items.filter((t) => t.playSpaceId === id),
    enabled: !!space,
  });
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const invites = useQuery({
    queryKey: ['space-invites', id],
    queryFn: () => cloudApi!.spaceInvites(id),
    enabled: !!cloudApi && !!space && !space.canonical,
  });
  const invite = useMutation({
    mutationFn: async () => (await cloudApi!.createSpaceInvite(id)).code,
    onSuccess: (code) => {
      setLink(`${location.origin}/unisciti/${code}`);
      void queries.invalidateQueries({ queryKey: ['space-invites', id] });
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => cloudApi!.revokeSpaceInvite(inviteId),
    onSuccess: () => void queries.invalidateQueries({ queryKey: ['space-invites', id] }),
  });
  useEffect(() => setLink(null), [id]);
  if (spaces.isPending) return <Loading />;
  if (!space)
    return (
      <>
        <Header title="Punto di incontro" back="/punti" />
        <main className="not-found">
          <Empty title="Punto non trovato">
            <p className="hint">Non esiste, o non fai parte di questo punto.</p>
          </Empty>
        </main>
      </>
    );
  const name = (playerId: string) =>
    players.data?.items.find((p) => p.id === playerId)?.displayName ?? '—';
  const rows = [...(board.data?.players.values() ?? [])].sort(
    (a, b) => b.stats.wins - a.stats.wins || b.stats.matches - a.stats.matches,
  );
  const records = Object.values(board.data?.records ?? {});
  return (
    <>
      <Header
        title={space.name}
        subtitle={[space.place, space.targetDescription].filter(Boolean).join(' · ') || undefined}
        back="/punti"
      />
      <main className="spaces">
        <p className="hint">Scoreboard di {space.name}: contano solo le partite giocate qui.</p>
        <ErrorMessage error={board.error} />
        {board.isPending ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="Ancora nessuna partita">
            <Link to="/partite/nuova">Inizia una partita</Link>
          </Empty>
        ) : (
          <ol className="list" aria-label="Scoreboard">
            {rows.map((p, i) => (
              <li key={p.playerId} className="mv big">
                <span className="pos">{i + 1}</span>
                <span className="nm">
                  <FxName name={name(p.playerId)} p={p} />
                  <small>
                    {p.stats.matches} partite · {p.stats.wins} vittorie
                  </small>
                </span>
                <LevelChip p={p} />
              </li>
            ))}
          </ol>
        )}
        {records.length > 0 && (
          <ul className="record-list" aria-label="Record del punto">
            {records.map((r) => (
              <li key={r.game}>
                <Crown aria-hidden="true" />
                <span>
                  <strong>{games[r.game as GameMode].label}</strong>
                  <small>{r.spec.title}</small>
                </span>
                <span>
                  {name(r.playerId)}
                  <small>{recordValue(r)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {(tournaments.data ?? []).length > 0 && (
          <section aria-label="Partite del punto">
            <h2>Partite</h2>
            <ul className="list">
              {tournaments.data!.slice(0, 20).map((t) => (
                <li key={t.id}>
                  <Link to={`/tornei/${t.id}`}>{t.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {cloudApi && !space.canonical && (
          <section className="card pad" aria-labelledby="share-space">
            <h2 id="share-space">Condividi punto di incontro</h2>
            <p className="hint">
              Chi accetta l’invito ritrova questo stesso punto e la sua scoreboard. L’invito non dà
              il diritto di segnare le partite degli altri.
            </p>
            <button
              type="button"
              className="btn cta"
              disabled={invite.isPending}
              onClick={() => invite.mutate()}
            >
              Crea link d’invito
            </button>
            {link && (
              <div className="follow-share">
                <Qr value={link} label="QR d’invito al punto di incontro" />
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void shareLink(`Unisciti a ${space.name}`, link).then((r) =>
                      setNote(
                        r === 'copied'
                          ? 'Link copiato.'
                          : r === 'failed'
                            ? 'Copia il link a mano.'
                            : '',
                      ),
                    )
                  }
                >
                  Condividi il link
                </button>
                {note && <p role="status">{note}</p>}
              </div>
            )}
            {(invites.data ?? [])
              .filter((i) => !i.revoked)
              .map((i) => (
                <p key={i.id} className="hint">
                  Invito del {new Date(i.createdAt).toLocaleDateString('it-IT')} · scade il{' '}
                  {new Date(i.expiresAt).toLocaleDateString('it-IT')}{' '}
                  <button type="button" className="text-link" onClick={() => revoke.mutate(i.id)}>
                    Revoca
                  </button>
                </p>
              ))}
            <ErrorMessage error={invite.error ?? revoke.error ?? invites.error} />
          </section>
        )}
      </main>
    </>
  );
}

/** `/unisciti/:code`: accepts an invite after signing in, then opens that very play space. */
export function JoinSpace() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    void cloudApi!
      .joinSpace(code)
      .then((space) => {
        if (cancelled) return;
        void queries.invalidateQueries();
        navigate(`/punti/${space.id}`, { replace: true });
      })
      .catch((e: unknown) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [code, navigate, queries]);
  return (
    <>
      <Header title="Invito" back="/" />
      <main className="not-found">
        {error ? <ErrorMessage error={error} /> : <Loading />}
        {error ? <Link to="/">Torna alla Home</Link> : null}
      </main>
    </>
  );
}

/**
 * Under a tournament: where it counts, and the explicit command to move it. A move recomputes
 * both scoreboards and is audited, so it asks for a confirmation and names the destination.
 */
export function MoveSpace({ tournamentId }: { tournamentId: string }) {
  const queries = useQueryClient();
  const spaces = usePlaySpaces();
  const t = useQuery({
    queryKey: ['tournament', tournamentId],
    queryFn: () => api.tournament(tournamentId),
  });
  const access = useQuery({
    queryKey: ['match-access', tournamentId, t.data?.version],
    queryFn: () => cloudApi!.matchAccess(tournamentId),
    enabled: !!cloudApi && !!t.data,
  });
  const [target, setTarget] = useState('');
  const [sure, setSure] = useState(false);
  const move = useMutation({
    mutationFn: () => localData!.moveTournament(t.data!, target),
    onSuccess: () => {
      setTarget('');
      setSure(false);
      void queries.invalidateQueries();
    },
  });
  if (!localData || !t.data || (cloudApi && !access.data?.mine)) return null;
  const current = spaces.data?.find((s) => s.id === t.data.playSpaceId);
  const destination = spaces.data?.find((s) => s.id === target);
  return (
    <section className="card pad move-space" aria-labelledby="move-space-title">
      <h2 id="move-space-title">Punto di incontro</h2>
      <p>
        {current
          ? `I risultati contano nella scoreboard ${current.name}.`
          : 'Non classificato: non conta in nessuna scoreboard.'}
      </p>
      <label className="field">
        Sposta in
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Scegli…</option>
          {(spaces.data ?? [])
            .filter((s) => s.id !== t.data.playSpaceId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      {destination && (
        <label className="check-row">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          Confermo: tutti i risultati passano alla scoreboard {destination.name} e lasciano{' '}
          {current?.name ?? 'i dati non classificati'}
        </label>
      )}
      <button
        type="button"
        className="btn"
        disabled={!target || !sure || move.isPending}
        onClick={() => move.mutate()}
      >
        Sposta
      </button>
      <ErrorMessage error={move.error} />
    </section>
  );
}
