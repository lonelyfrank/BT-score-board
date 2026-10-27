import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  ChevronUp,
  Grid2x2Plus,
  HardDriveDownload,
  MoreHorizontal,
  Play,
  Plus,
  Target,
  X,
} from 'lucide-react';
import {
  api,
  localData,
  pollInterval,
  type Player,
  type Standings,
  type Summary,
  type Tournament,
  type TournamentAction,
} from '../services/api';
import { useCanManage } from '../services/me';
import { activeSession, recentResults, tournamentPath } from '../services/session';
import { formatLabel, gameOf, isResultRecording } from '../services/rules';
import {
  AddButton,
  Avatar,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Segmented,
  StatusChip,
  statusLabel,
  tournamentTone,
  type Tone,
} from '../components/ui';
import { AddPlayerSheet } from '../components/PlayerSheets';
import { TournamentAdminSheet } from '../components/TournamentAdmin';

export type Table = Standings[number];
export type Row = Table['rows'][number];
export type TMatch = Tournament['matches'][number];

type Archive = 'all' | 'open' | 'done' | 'removed';
const isOpen = (status: string) => !['completed', 'cancelled'].includes(status);
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

/** Tornei, or with `highscore` the Hi-Score Nights: tonight's first, then the archive. */
export function TournamentList({ highscore = false }: { highscore?: boolean }) {
  const manage = useCanManage();
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const filter =
    (['all', 'open', 'done', 'removed'] as const).find((f) => f === params.get('filtro')) ?? 'all';
  const setFilter = (f: Archive) => setParams(f === 'all' ? {} : { filtro: f }, { replace: true });
  const [managing, setManaging] = useState<Summary | null>(null);
  // Removed tournaments are seen by admins only (the server refuses everyone else).
  const showRemoved = manage && !!localData && filter === 'removed';
  const query = useQuery({
    queryKey: ['tournaments', offset],
    queryFn: () => api.tournaments(offset),
  });
  const removed = useQuery({
    queryKey: ['tournaments', 'removed'],
    queryFn: () => localData!.removedTournaments(),
    enabled: showRemoved,
  });
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const recent = useQuery({ queryKey: ['recent-results'], queryFn: () => recentResults(api) });
  const live = session.data?.tournament;
  const mode = (t: Summary) => !highscore || t.mode === 'QUICK_HIGH_SCORE';
  const all = (query.data?.items ?? []).filter(mode);
  const items = showRemoved
    ? (removed.data ?? []).filter(mode)
    : all.filter((t) => filter === 'all' || (filter === 'open') === isOpen(t.status));
  const winner = (id: string) => recent.data?.find((r) => r.summary.id === id)?.winner;
  const groupOf = (t: Summary) =>
    t.id === live?.id
      ? highscore
        ? 'Stasera'
        : 'Al bersaglio'
      : isDraft(t as Tournament)
        ? 'Iscrizioni aperte'
        : isOpen(t.status)
          ? 'In corso'
          : highscore
            ? 'Concluse'
            : 'Archivio';
  const order = highscore
    ? ['Stasera', 'In corso', 'Iscrizioni aperte', 'Concluse']
    : ['Al bersaglio', 'In corso', 'Iscrizioni aperte', 'Archivio'];
  const groups = showRemoved
    ? [{ label: 'Eliminati', items }].filter((g) => g.items.length)
    : order
        .map((label) => ({ label, items: items.filter((t) => groupOf(t) === label) }))
        .filter((g) => g.items.length);
  const open = all.filter((t) => isOpen(t.status)).length;
  const sub = (t: Summary) => {
    if (t.id === live?.id && session.data) {
      const s = session.data;
      return [
        formatLabel(t.mode),
        s.next?.heat ? `Manche ${s.next.heat.number} di ${s.next.heat.of}` : null,
        `${s.playersIn} giocatori`,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    const w = winner(t.id);
    if (w) return `Vince ${w} · ${gameOf(t).label}`;
    return `${dateOf(t.createdAt)} · ${gameOf(t).label} · ${formatLabel(t.mode)}`;
  };
  const chip = (t: Summary): [string, Tone] =>
    t.id === live?.id && t.status === 'active'
      ? ['LIVE', 'live']
      : isDraft(t as Tournament)
        ? ['BOZZA', 'neutral']
        : t.status === 'completed'
          ? [highscore ? 'CONCLUSA' : 'CONCLUSO', 'success']
          : [statusLabel(t.status).toUpperCase(), tournamentTone(t.status)];
  return (
    <>
      <Header
        title={highscore ? 'Hi-Score Nights' : 'Tornei'}
        subtitle={
          highscore
            ? 'Qualifica a manche + finale'
            : `${open} in corso · ${all.length - open} conclusi`
        }
        back={null}
        action={
          manage ? (
            <AddButton
              label={highscore ? 'Nuova Hi-Score Night' : 'Nuovo torneo'}
              to="/tornei/nuovo"
            />
          ) : undefined
        }
      />
      <div className="toolbar">
        <Segmented
          label={highscore ? 'Filtro serate' : 'Filtro tornei'}
          value={filter}
          change={setFilter}
          options={[
            { id: 'all', label: 'Tutti' },
            { id: 'open', label: 'In corso' },
            { id: 'done', label: 'Archivio' },
            ...(manage && localData ? [{ id: 'removed' as const, label: 'Eliminati' }] : []),
          ]}
        />
      </div>
      <main className="lists">
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <Loading />}
        {groups.map((g) => (
          <section key={g.label} className="list" aria-labelledby={`g-${g.label}`}>
            <h2 className="group-l" id={`g-${g.label}`}>
              {g.label}
            </h2>
            {g.items.map((t) => {
              const [label, tone] = chip(t);
              const isLive = t.id === live?.id;
              return (
                <div key={t.id} className="list">
                  <Link className={`tcard ${isLive ? 'live' : ''}`} to={tournamentPath(t)}>
                    <span className="ti" aria-hidden="true">
                      {t.mode === 'QUICK_HIGH_SCORE' ? (
                        <ChartNoAxesColumnIncreasing />
                      ) : t.mode === 'GROUPS' ? (
                        <Grid2x2Plus />
                      ) : (
                        <Target />
                      )}
                    </span>
                    <span className="body">
                      <span className="top">
                        <h3>{t.name}</h3>
                        <StatusChip tone={tone}>{label}</StatusChip>
                      </span>
                      <p>{sub(t)}</p>
                      {isLive && highscore && session.data?.next?.heat && (
                        <span className="pips" aria-hidden="true">
                          {Array.from({ length: session.data.next.heat.of }, (_, i) => (
                            <i
                              key={i}
                              className={
                                i + 1 < session.data!.next!.heat!.number
                                  ? 'done'
                                  : i + 1 === session.data!.next!.heat!.number
                                    ? 'on'
                                    : ''
                              }
                            />
                          ))}
                        </span>
                      )}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                  {isLive && highscore && <TonightStats t={live!} />}
                  {manage && (
                    <div className="t-admin">
                      <button type="button" className="btn sm ghost" onClick={() => setManaging(t)}>
                        <MoreHorizontal aria-hidden="true" />
                        Gestisci
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {(showRemoved ? removed.data : query.data) && !items.length && (
          <Empty title={showRemoved ? 'Nessun torneo eliminato' : 'Il bersaglio vi aspetta'}>
            <p>
              {showRemoved
                ? 'I tornei eliminati compaiono qui e si possono ripristinare.'
                : `Nessun ${highscore ? 'Hi-Score Night' : 'torneo'} in questa vista. Crea il prossimo evento del locale.`}
            </p>
          </Empty>
        )}
        {query.data && query.data.total > 100 && (
          <div className="pair">
            <button
              type="button"
              className="btn"
              disabled={!offset}
              onClick={() => setOffset(offset - 100)}
            >
              Precedenti
            </button>
            <button
              type="button"
              className="btn"
              disabled={offset + 100 >= query.data.total}
              onClick={() => setOffset(offset + 100)}
            >
              Successivi
            </button>
          </div>
        )}
      </main>
      {managing && (
        <TournamentAdminSheet t={managing} removed={showRemoved} close={() => setManaging(null)} />
      )}
    </>
  );
}

/** Tonight's Hi-Score Night: who leads, the score that gets into the final, what is left. */
function TonightStats({ t }: { t: Tournament }) {
  const standings = useQuery({ queryKey: ['standings', t.id], queryFn: () => api.standings(t.id) });
  const qual = t.stages.find((s) => s.kind === 'qualification' && s.status !== 'invalidated');
  const match = t.matches.find((m) => m.stageId === qual?.id && m.matchType === 'qualification');
  const table = standings.data?.find((r) => r.targetId === match?.id);
  const rows = (table?.rows ?? []).filter((r) => r.recorded);
  const cut = t.tournamentConfiguration.qualifiers;
  const heats = match?.heats.filter((h) => h.status !== 'cancelled') ?? [];
  const left = heats.filter((h) => h.status !== 'completed');
  const waiting = heats
    .filter((h) => h.status === 'pending' || h.status === 'ready')
    .reduce((n, h) => n + h.entryIds.length, 0);
  if (!table) return null;
  return (
    <div className="card stat3">
      <div>
        <small>In testa</small>
        <span className="name">{rows[0] ? entryName(t, rows[0].tournamentEntryId) : '—'}</span>
        <strong>{rows[0]?.total ?? '—'}</strong>
      </div>
      <div>
        <small>Soglia top {cut}</small>
        <span className="name">
          {rows[cut - 1] ? entryName(t, rows[cut - 1]!.tournamentEntryId) : '—'}
        </span>
        <strong className="accent">{rows[cut - 1]?.total ?? '—'}</strong>
      </div>
      <div>
        <small>Mancano</small>
        <span className="name">
          {left.length} {left.length === 1 ? 'manche' : 'manche'}
        </span>
        <strong className="muted">{waiting}</strong>
      </div>
    </div>
  );
}

export const entryName = (t: Tournament, id: string) =>
  t.entries.find((e) => e.id === id)?.displayNameAtRegistration ?? '?';
/** The domain stores "Group 1", "Group 2"…: shown as Girone A, Girone B. */
export const groupLabel = (name: string | null | undefined) => {
  const n = /^Group (\d+)$/.exec(name ?? '');
  return n ? `Girone ${String.fromCharCode(64 + Number(n[1]))}` : (name ?? '');
};
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

export function Podium({ t }: { t: Tournament }) {
  const placed = [...t.results].sort((a, b) => a.finalPlacement - b.finalPlacement);
  const order = [placed[1], placed[0], placed[2]];
  const first = placed[0];
  const value = (r: (typeof placed)[number]) =>
    t.gameMode === 'HI_SCORE' ? r.points : `${r.finalPlacement}°`;
  return (
    <section className="result-done" aria-labelledby="podium-title">
      <div className="result-head">
        <span className="marker">
          {first ? `Vince ${entryName(t, first.tournamentEntryId).split(' ')[0]}!` : 'Risultato'}
        </span>
        <StatusChip tone="success">RISULTATO UFFICIALE</StatusChip>
      </div>
      <h2 id="podium-title" className="visually-hidden">
        Risultato ufficiale
      </h2>
      <ol className="pod" aria-label="Podio">
        {order.map(
          (r, i) =>
            r && (
              <li key={r.tournamentEntryId} className={`p${[2, 1, 3][i]}`}>
                <Avatar
                  name={entryName(t, r.tournamentEntryId)}
                  size={i === 1 ? undefined : 'sm'}
                  className={i === 1 ? 'gold' : ''}
                />
                <span>{entryName(t, r.tournamentEntryId)}</span>
                <b>{value(r)}</b>
                <small aria-label={`${r.finalPlacement}° posto`}>{r.finalPlacement}°</small>
              </li>
            ),
        )}
      </ol>
    </section>
  );
}

/** Official placements; Hi-Score with the score of each player's last match. */
export function ResultsTable({ t }: { t: Tournament }) {
  const placed = [...t.results].sort((a, b) => a.finalPlacement - b.finalPlacement);
  const results = isResultRecording(t);
  return (
    <ol className="list" aria-label="Piazzamenti finali">
      {placed.map((r) => (
        <li key={r.tournamentEntryId} className="rk">
          <span className={`n ${r.finalPlacement <= 4 ? `r${r.finalPlacement}` : ''}`}>
            {r.finalPlacement}
          </span>
          <Avatar name={entryName(t, r.tournamentEntryId)} size="md" />
          <span className="nm">
            <b>
              {entryName(t, r.tournamentEntryId)}
              {t.entries.find((e) => e.id === r.tournamentEntryId)?.status === 'withdrawn' && (
                <span className="tag">RITIRATO</span>
              )}
            </b>
            {!results && (
              <small>
                media {r.statistics.average.toFixed(1)} · best {r.statistics.bestTurn}
              </small>
            )}
          </span>
          <strong>{t.gameMode === 'HI_SCORE' || !results ? r.points : ''}</strong>
        </li>
      ))}
    </ol>
  );
}

/** Standalone mode: the night's results live only on this phone until exported. */
export function BackupLink() {
  return localData ? (
    <Link className="mrow" to="/impostazioni#backup">
      <span>
        Salva un backup della serata
        <br />
        <small>I risultati restano solo su questo telefono finché non li esporti</small>
      </span>
      <HardDriveDownload aria-hidden="true" />
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
    mutationFn: async (player: Player) => {
      const fresh = await api.tournament(t.id);
      // The next free seed: removals leave gaps that must not be reused twice.
      const seed = Math.max(0, ...fresh.entries.map((e) => e.seed ?? 0)) + 1;
      return api.tournamentCommand(fresh, 'players', { playerId: player.id, seed });
    },
    onSuccess: (fresh) => client.setQueryData(['tournament', t.id], fresh),
  });
  const remove = useMutation({
    mutationFn: async (entryId: string) =>
      api.tournamentCommand(await api.tournament(t.id), 'entries/remove', { entryId }),
    onSuccess: (fresh) => client.setQueryData(['tournament', t.id], fresh),
  });
  return (
    <section className="card pad" aria-labelledby="draft-title">
      <div className="sec-h">
        <h2 id="draft-title">Iscrizioni aperte</h2>
        <span>
          {t.entries.length} {t.entries.length === 1 ? 'iscritto' : 'iscritti'}
        </span>
      </div>
      <ol className="list">
        {t.entries.map((e, i) => (
          <li key={e.id} className="mv">
            <span className="pos">{e.seed ?? i + 1}</span>
            <Avatar name={e.displayNameAtRegistration} size="sm" />
            <b>{e.displayNameAtRegistration}</b>
            <button
              type="button"
              className="mini"
              aria-label={`Togli ${e.displayNameAtRegistration} dagli iscritti`}
              disabled={remove.isPending || busy}
              onClick={() => remove.mutate(e.id)}
            >
              <X />
            </button>
          </li>
        ))}
      </ol>
      {!t.entries.length && <p className="hint">Nessun iscritto.</p>}
      <button
        type="button"
        className="btn dashed"
        disabled={register.isPending}
        onClick={() => setPicker(true)}
      >
        <Plus aria-hidden="true" /> Iscrivi giocatore
      </button>
      <ErrorMessage error={register.error ?? remove.error} />
      <button
        type="button"
        className="btn cta"
        disabled={busy || register.isPending || t.entries.length < 2}
        onClick={() => command('start')}
      >
        <Play aria-hidden="true" fill="currentColor" /> AVVIA TORNEO
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

/** Amber notice for a tie that only a playoff on the board, or the organizer, can decide. */
export function TieAlert({
  children,
  action,
  secondary,
}: {
  children: ReactNode;
  action?: { label: string; run: () => void; disabled?: boolean };
  /** The alternative to a playoff: an explicit organizer decision. */
  secondary?: { label: string; run: () => void; disabled?: boolean };
}) {
  return (
    <div className="tie-alert" role="alert">
      <p>
        <AlertTriangle aria-hidden="true" />
        <span>{children}</span>
      </p>
      {(action || secondary) && (
        <div className="tie-actions">
          {action && (
            <button
              type="button"
              className="btn sm"
              disabled={action.disabled}
              onClick={action.run}
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              className="btn sm"
              disabled={secondary.disabled}
              onClick={secondary.run}
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Settles a tie without playing: the organizer puts the tied players in order and states why.
 * Recorded as a decided playoff; nothing is drawn at random.
 */
export function DecisionSheet({
  t,
  targetId,
  entries,
  title,
  close,
  done,
}: {
  t: Tournament;
  targetId: string;
  entries: string[];
  title: string;
  close: () => void;
  done: (fresh: Tournament) => void;
}) {
  const [order, setOrder] = useState(entries);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: async () =>
      api.tournamentCommand(await api.tournament(t.id), 'tiebreaks/decide', {
        targetId,
        orderedEntryIds: order,
        reason: reason.trim(),
      }),
    onSuccess: done,
  });
  const move = (i: number) => {
    const next = [...order];
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    setOrder(next);
  };
  return (
    <Modal
      title={title}
      subtitle="Dal migliore: la decisione resta nello storico"
      close={close}
      tone="warning"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Annulla
          </button>
          <button
            type="button"
            className="btn cta"
            disabled={!reason.trim() || decide.isPending}
            onClick={() => decide.mutate()}
          >
            CONFERMA DECISIONE
          </button>
        </>
      }
    >
      <ol className="list">
        {order.map((id, i) => (
          <li key={id} className="mv big">
            <span className={`pos ${i === 0 ? 'first' : ''}`}>{i + 1}</span>
            <Avatar name={entryName(t, id)} size="md" />
            <b>{entryName(t, id)}</b>
            <button
              type="button"
              className="mini"
              aria-label={`Anticipa ${entryName(t, id)}`}
              disabled={i === 0 || decide.isPending}
              onClick={() => move(i)}
            >
              <ChevronUp />
            </button>
          </li>
        ))}
      </ol>
      <label className="field">
        Motivo (obbligatorio)
        <input
          value={reason}
          maxLength={1000}
          placeholder="es. spareggio rinunciato, chiusura del locale"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <ErrorMessage error={decide.error} />
    </Modal>
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
    <Modal
      title={title}
      subtitle={`Si decide sul bersaglio in ${t.tournamentConfiguration.tieBreakTurns} ${t.tournamentConfiguration.tieBreakTurns === 1 ? 'turno' : 'turni'}`}
      close={close}
      tone="warning"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Annulla
          </button>
          <button
            type="button"
            className="btn cta"
            disabled={!!invalid || busy}
            onClick={() => create(selected)}
          >
            CREA INCONTRO DI SPAREGGIO
          </button>
          {invalid && (
            <p className="form-reason" role="alert">
              {invalid}
            </p>
          )}
        </>
      }
    >
      <p className="hint">Seleziona l’intero gruppo a pari merito.</p>
      <div className="list">
        {rows.map((r) => (
          <label className="check-row card pick" key={r.tournamentEntryId}>
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
      <ErrorMessage error={error} />
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
  // Over several heats the board holds one heat: the one playing, else the next.
  const heats = match.heats.filter((h) => h.status !== 'cancelled');
  const heat =
    heats.length > 1
      ? (heats.find((h) => h.status === 'active') ??
        heats.find((h) => h.status === 'pending' || h.status === 'ready'))
      : undefined;
  return (
    <section className={`now board ${live ? '' : 'ready'}`} aria-labelledby="board-title">
      <div className="board-head">
        <span id="board-title" className="field-l">
          {live ? 'Al bersaglio' : 'Prossimo'} · {title}
          {heat ? ` · Manche ${heat.number} di ${heats.length}` : ''}
        </span>
        {live ? (
          <StatusChip tone="live">{match.status === 'paused' ? 'IN PAUSA' : 'LIVE'}</StatusChip>
        ) : (
          <StatusChip tone="neutral">PRONTO</StatusChip>
        )}
      </div>
      {heat ? (
        <p className="board-players">{heat.entryIds.map((id) => entryName(t, id)).join(' · ')}</p>
      ) : match.participants.length === 2 ? (
        <div className="vs">
          <span>
            <Avatar name={entryName(t, a!.tournamentEntryId)} />
            <span className="nm">{entryName(t, a!.tournamentEntryId)}</span>
            {live && isResultRecording(t) === false && <b>{score(a)}</b>}
          </span>
          <i>VS</i>
          <span>
            {live && isResultRecording(t) === false && <b>{score(b)}</b>}
            <span className="nm">{entryName(t, b!.tournamentEntryId)}</span>
            <Avatar name={entryName(t, b!.tournamentEntryId)} />
          </span>
        </div>
      ) : (
        <p className="board-players">
          {match.participants.map((p) => entryName(t, p.tournamentEntryId)).join(' · ')}
        </p>
      )}
      <Link className="btn cta" to={`/partite/${match.id}`}>
        {live ? 'Apri il Live' : 'Gioca l’incontro'}
      </Link>
    </section>
  );
}

export type MenuAction = {
  icon: ReactNode;
  label: string;
  hint: string;
  run: () => void;
  disabled?: boolean;
};
/** The less frequent commands of a tournament, behind one header button. */
export function ActionsMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  return (
    <>
      <button
        type="button"
        className="ibtn box"
        aria-label="Altre azioni del torneo"
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal />
      </button>
      {open && (
        <Modal title="Azioni del torneo" close={() => setOpen(false)}>
          <div className="list">
            {actions.map((a) => (
              <button
                type="button"
                key={a.label}
                className="act"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.run();
                }}
              >
                {a.icon}
                <span>
                  <b>{a.label}</b>
                  <small>{a.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
