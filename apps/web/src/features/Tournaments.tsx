import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trophy, ChevronRight, AlertTriangle, Plus } from 'lucide-react';
import { CrownIcon, TrophyEmblem } from '../components/BrandIcons';
import {
  api,
  localData,
  pollInterval,
  type Player,
  type Standings,
  type Tournament,
  type TournamentAction,
} from '../services/api';
import { tournamentPath } from '../services/session';
import {
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  StatusChip,
  statusLabel,
  tournamentTone,
} from '../components/ui';
import { AddPlayerSheet } from '../components/PlayerSheets';

export type Table = Standings[number];
export type Row = Table['rows'][number];
export type TMatch = Tournament['matches'][number];

export function TournamentList({ highscore = false }: { highscore?: boolean }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['tournaments', offset],
    queryFn: () => api.tournaments(offset),
  });
  const items = query.data?.items.filter((t) => !highscore || t.mode === 'QUICK_HIGH_SCORE');
  return (
    <>
      <Header title={highscore ? 'Hi-Score Nights' : 'Tornei'} />
      <main className="content with-graffiti">
        <Link className="primary button cta" to="/tornei/nuovo">
          <Trophy className="cta-icon" fill="currentColor" /> NUOVO TORNEO
        </Link>
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        <div className="tournament-list">
          {items?.map((t) => (
            <Link className="event-card" key={t.id} to={tournamentPath(t)}>
              <TrophyEmblem />
              <div>
                <h2>{t.name}</h2>
                <p>
                  {new Date(t.createdAt).toLocaleDateString('it-IT', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}{' '}
                  · {t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}
                </p>
              </div>
              <StatusChip tone={tournamentTone(t.status)}>
                {statusLabel(t.status).toUpperCase()}
              </StatusChip>
              <ChevronRight />
            </Link>
          ))}
        </div>
        {items && !items.length && (
          <Empty title="Il bersaglio vi aspetta">
            <p>
              Nessun torneo {highscore ? 'Hi-Score ' : ''}in questa pagina. Crea il prossimo evento
              del locale.
            </p>
          </Empty>
        )}
        {query.data && query.data.total > 100 && (
          <div className="pagination">
            <button disabled={!offset} onClick={() => setOffset(offset - 100)}>
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
      </main>
    </>
  );
}

export const entryName = (t: Tournament, id: string) =>
  t.entries.find((e) => e.id === id)?.displayNameAtRegistration ?? '?';
export const isDraft = (t: Tournament) => ['draft', 'registration', 'ready'].includes(t.status);
export const liveStages = (t: Tournament) => t.stages.filter((s) => s.status !== 'invalidated');
export const playable = (m: TMatch) => !['completed', 'cancelled'].includes(m.status);

/** The tournament, its standings and its commands, kept in sync after every change. */
export function useTournament(id: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.tournament(id),
    refetchInterval: pollInterval,
  });
  const standings = useQuery({
    queryKey: ['standings', id],
    queryFn: () => api.standings(id),
    enabled: !!query.data,
    refetchInterval: pollInterval,
  });
  const mutation = useMutation({
    mutationFn: async ({
      action,
      extra,
    }: {
      action: TournamentAction;
      extra?: Record<string, unknown>;
    }) => api.tournamentCommand(await api.tournament(id), action, extra),
    onSuccess: (t) => {
      client.setQueryData(['tournament', id], t);
      void client.invalidateQueries({ queryKey: ['standings', id] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: () => {
      void query.refetch();
      void standings.refetch();
    },
  });
  const tables = standings.data?.filter((r) => r.stageStatus !== 'invalidated') ?? [];
  return {
    query,
    standings,
    mutation,
    tables,
    command: (action: TournamentAction, extra?: Record<string, unknown>) =>
      mutation.mutate({ action, extra }),
    error: query.error ?? standings.error ?? mutation.error,
    retry: () => {
      void query.refetch();
      void standings.refetch();
    },
  };
}

/**
 * Groups of players tied on the same placement that block the next step: crossing the cut
 * (`cut` qualify), or, with `withinCut`, anywhere inside it (group seeding).
 */
export function blockingTies(rows: Row[], cut: number, withinCut = false) {
  const groups = new Map<number, Row[]>();
  for (const row of rows.filter((r) => r.tied))
    groups.set(row.placement, [...(groups.get(row.placement) ?? []), row]);
  return [...groups.values()].filter(
    (g) => g[0]!.placement <= cut && (withinCut || g[0]!.placement + g.length - 1 > cut),
  );
}

export function RankBadge({ placement }: { placement: number }) {
  return <span className={`rank-badge rank-${placement}`}>{placement}</span>;
}

export function Podium({ t }: { t: Tournament }) {
  const placed = [...t.results].sort((a, b) => a.finalPlacement - b.finalPlacement);
  const order = [placed[1], placed[0], placed[2]];
  return (
    <section className="podium" aria-labelledby="podium-title">
      <h2 id="podium-title">Risultato ufficiale</h2>
      <ol>
        {order.map(
          (r) =>
            r && (
              <li key={r.tournamentEntryId} className={`place-${r.finalPlacement}`}>
                {r.finalPlacement === 1 && <CrownIcon className="podium-crown" />}
                <Avatar name={entryName(t, r.tournamentEntryId)} />
                <span>{entryName(t, r.tournamentEntryId)}</span>
                <small>{r.points} pt</small>
                <span className="podium-step" aria-label={`${r.finalPlacement}° posto`}>
                  {r.finalPlacement}
                </span>
              </li>
            ),
        )}
      </ol>
    </section>
  );
}

/** Official placements with the statistics of each player's last match. */
export function ResultsTable({ t }: { t: Tournament }) {
  const placed = [...t.results].sort((a, b) => a.finalPlacement - b.finalPlacement);
  return (
    <div className="table-scroll">
      <table>
        <caption>Piazzamenti finali · statistiche dell’ultima prova</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Giocatore</th>
            <th scope="col" className="num">
              Punti
            </th>
            <th scope="col" className="num">
              Media
            </th>
            <th scope="col" className="num">
              Best
            </th>
          </tr>
        </thead>
        <tbody>
          {placed.map((r) => (
            <tr key={r.tournamentEntryId} className={`rank-${r.finalPlacement}`}>
              <td className="pos">{r.finalPlacement}</td>
              <td>{entryName(t, r.tournamentEntryId)}</td>
              <td className="num strong">{r.points}</td>
              <td className="num muted">{r.statistics.average.toFixed(1)}</td>
              <td className="num muted">{r.statistics.bestTurn}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Standalone mode: the night's results live only on this phone until exported. */
export function BackupLink() {
  return localData ? (
    <Link className="button" to="/impostazioni#backup">
      Salva un backup della serata
    </Link>
  ) : null;
}

/** Registration of a saved draft, then the start. */
export function DraftPanel({
  t,
  busy,
  command,
}: {
  t: Tournament;
  busy: boolean;
  command: (action: TournamentAction, extra?: Record<string, unknown>) => void;
}) {
  const [picker, setPicker] = useState(false);
  const client = useQueryClient();
  const register = useMutation({
    mutationFn: async (player: Player) =>
      api.tournamentCommand(await api.tournament(t.id), 'players', {
        playerId: player.id,
        seed: t.entries.length + 1,
      }),
    onSuccess: (fresh) => client.setQueryData(['tournament', t.id], fresh),
  });
  return (
    <section className="panel" aria-labelledby="draft-title">
      <h2 id="draft-title">Iscrizioni aperte</h2>
      <ol className="entry-list">
        {t.entries.map((e, i) => (
          <li key={e.id}>
            <span className="seed">{e.seed ?? i + 1}</span>
            {e.displayNameAtRegistration}
          </li>
        ))}
      </ol>
      {!t.entries.length && <p className="hint">Nessun iscritto.</p>}
      <button className="dashed" disabled={register.isPending} onClick={() => setPicker(true)}>
        <Plus aria-hidden="true" className="accent-icon" /> Iscrivi giocatore
      </button>
      <ErrorMessage error={register.error} />
      <button
        className="primary cta"
        disabled={busy || register.isPending || t.entries.length < 2}
        onClick={() => command('start')}
      >
        AVVIA TORNEO
      </button>
      {picker && (
        <AddPlayerSheet
          excluded={t.entries.map((e) => e.playerId)}
          remaining={256 - t.entries.length}
          add={(p) => register.mutate(p)}
          close={() => setPicker(false)}
        />
      )}
    </section>
  );
}

/** Amber notice for a tie that only a playoff on the board can decide. */
export function TieAlert({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; run: () => void; disabled?: boolean };
}) {
  return (
    <div className="tie-alert" role="alert">
      <p>
        <AlertTriangle aria-hidden="true" />
        <span>{children}</span>
      </p>
      {action && (
        <button disabled={action.disabled} onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
export const names = (t: Tournament, rows: { tournamentEntryId: string }[]) => {
  const list = rows.map((r) => entryName(t, r.tournamentEntryId));
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list.at(-1)}` : (list[0] ?? '');
};

/** The playoff group must be exactly the tied players: preselected, still editable. */
export function TieSheet({
  t,
  table,
  group,
  busy,
  error,
  create,
  close,
  title,
}: {
  t: Tournament;
  table: Table;
  group: Row[];
  busy: boolean;
  error: unknown;
  create: (entryIds: string[]) => void;
  close: () => void;
  title: string;
}) {
  const [selected, setSelected] = useState(group.map((r) => r.tournamentEntryId));
  const expected = new Set(group.map((r) => r.tournamentEntryId));
  const invalid =
    selected.length < 2
      ? 'Servono almeno 2 giocatori.'
      : selected.length !== expected.size || selected.some((id) => !expected.has(id))
        ? 'Il gruppo deve contenere esattamente tutti i giocatori a pari merito.'
        : '';
  const first = group[0]!.placement;
  const rows = table.rows.filter((r) => Math.abs(r.placement - first) <= group.length);
  return (
    <Modal title={title} close={close} tone="warning">
      <p>
        Seleziona l’intero gruppo a pari merito. Il risultato sarà deciso sul bersaglio in{' '}
        {t.tournamentConfiguration.tieBreakTurns}{' '}
        {t.tournamentConfiguration.tieBreakTurns === 1 ? 'turno' : 'turni'}.
      </p>
      <div className="check-list">
        {rows.map((r) => (
          <label className="check-row" key={r.tournamentEntryId}>
            <input
              type="checkbox"
              checked={selected.includes(r.tournamentEntryId)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.tournamentEntryId]
                    : selected.filter((x) => x !== r.tournamentEntryId),
                )
              }
            />
            <span>
              {r.placement}° · {entryName(t, r.tournamentEntryId)}
            </span>
            <strong>{table.stageKind === 'group' ? r.points : r.total}</strong>
          </label>
        ))}
      </div>
      {invalid && (
        <p className="form-reason" role="alert">
          {invalid}
        </p>
      )}
      <ErrorMessage error={error} />
      <button className="primary" disabled={!!invalid || busy} onClick={() => create(selected)}>
        CREA INCONTRO DI SPAREGGIO
      </button>
      <button onClick={close}>Annulla</button>
    </Modal>
  );
}

/** "Al bersaglio": the match on the board, or the next one to play. */
export function BoardCard({ t, match, title }: { t: Tournament; match: TMatch; title: string }) {
  const live = match.status === 'active' || match.status === 'paused';
  const [a, b] = match.participants;
  const score = (p?: TMatch['participants'][number]) =>
    p
      ? (p.finalScore ??
        match.scores
          .filter((s) => !s.voided && s.tournamentEntryId === p.tournamentEntryId)
          .reduce((n, s) => n + s.score, 0))
      : 0;
  return (
    <section className="board-section" aria-labelledby="board-title">
      <h2 id="board-title">Al bersaglio</h2>
      <article className={`board-card ${live ? 'live' : ''}`}>
        <div className="board-meta">
          <span>
            #{match.sequence} · {title}
          </span>
          <span className={live ? 'accent-soft' : ''}>
            {live ? statusLabel(match.status).toUpperCase() : 'PRONTO'}
          </span>
        </div>
        {match.participants.length === 2 ? (
          <div className="versus">
            <span>
              {entryName(t, a!.tournamentEntryId)} {live && <b>{score(a)}</b>}
            </span>
            <span className="marker">VS</span>
            <span>
              {live && <b>{score(b)}</b>} {entryName(t, b!.tournamentEntryId)}
            </span>
          </div>
        ) : (
          <p className="board-players">
            {match.participants.map((p) => entryName(t, p.tournamentEntryId)).join(' · ')}
          </p>
        )}
        <Link className="primary button" to={`/partite/${match.id}`}>
          {live ? 'Riprendi incontro' : 'Gioca l’incontro'}
        </Link>
      </article>
    </section>
  );
}
