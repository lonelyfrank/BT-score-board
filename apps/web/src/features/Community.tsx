import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Crown, Flame, Medal, Target, Trophy, Zap } from 'lucide-react';
import { api, localData } from '../services/api';
import { useMe } from '../services/me';
import { games, type GameMode } from '../services/rules';
import { Avatar, Empty, ErrorMessage, Header, Loading, Segmented, Tabs } from '../components/ui';
import { FxName, LevelChip, recordValue, useProgression } from '../components/Progression';
import { Players } from './Players';
import type { PlayerProgression, RecordHolding } from '../../../../packages/domain/src/index.js';

type Board = 'level' | 'turn' | 'wins';
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
const xp = (n: number) => `${n.toLocaleString('it-IT')} XP`;

function usePlayers() {
  return useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
}
function useCrews() {
  return useQuery({ queryKey: ['crews'], queryFn: () => localData!.crews(), enabled: !!localData });
}

/**
 * Everyone who plays: rankings by level, best three-dart turn and wins, every record and the
 * roster. A crew narrows rankings and records to its members.
 */
export function Community() {
  const [params, setParams] = useSearchParams();
  const tab = (['classifica', 'record', 'giocatori'] as const).find((t) => t === params.get('tab'));
  const current = tab ?? 'classifica';
  const crewId = params.get('crew') ?? '';
  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next))
      if (v) p.set(k, v);
      else p.delete(k);
    setParams(p, { replace: true });
  };
  const players = usePlayers();
  const crews = useCrews();
  const active = players.data?.items.filter((p) => p.status === 'active').length;
  return (
    <>
      <Header
        title="Compagnia"
        subtitle={active === undefined ? undefined : `${active} giocatori · classifiche e record`}
        back={null}
      />
      <div className="toolbar">
        <Tabs
          label="Sezioni della compagnia"
          tabs={[
            { id: 'classifica', label: 'Classifiche' },
            { id: 'record', label: 'Record' },
            { id: 'giocatori', label: 'Giocatori' },
          ]}
          value={current}
          change={(id) => set({ tab: id })}
        />
        {current !== 'giocatori' && !!crews.data?.length && (
          <label className="field compact">
            <span className="visually-hidden">Compagnia</span>
            <select value={crewId} onChange={(e) => set({ crew: e.target.value })}>
              <option value="">Tutti i giocatori</option>
              {crews.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {current === 'giocatori' ? (
        <Players embedded />
      ) : (
        <main className="lists">
          {current === 'classifica' ? <Rankings crewId={crewId} /> : <Records crewId={crewId} />}
        </main>
      )}
    </>
  );
}

/** Players shown in rankings: active ones, or the members of the chosen crew. */
function useRanked(crewId: string) {
  const players = usePlayers();
  const crews = useCrews();
  const progression = useProgression();
  const members = crews.data?.find((c) => c.id === crewId)?.memberIds;
  const list = (players.data?.items ?? []).filter((p) =>
    members ? members.includes(p.id) : p.status === 'active',
  );
  return {
    list: list.map((player) => ({ player, p: progression.data?.players.get(player.id) })),
    progression,
    pending: players.isPending || progression.isPending,
    error: players.error ?? progression.error ?? crews.error,
  };
}

function Rankings({ crewId }: { crewId: string }) {
  const [board, setBoard] = useState<Board>('level');
  const me = useMe();
  const { list, pending, error } = useRanked(crewId);
  const rows =
    board === 'level'
      ? [...list].sort((a, b) => (b.p?.xp ?? 0) - (a.p?.xp ?? 0))
      : board === 'turn'
        ? list
            .filter((x) => x.p?.bestTurn)
            .sort(
              (a, b) =>
                b.p!.bestTurn!.value - a.p!.bestTurn!.value ||
                a.p!.bestTurn!.achievedAt.localeCompare(b.p!.bestTurn!.achievedAt),
            )
        : list
            .filter((x) => x.p?.stats.matches)
            .sort(
              (a, b) =>
                b.p!.stats.tournamentsWon - a.p!.stats.tournamentsWon ||
                b.p!.stats.wins - a.p!.stats.wins,
            );
  const detail = ({ p }: { p?: PlayerProgression }) =>
    !p
      ? 'Nessuna partita'
      : board === 'level'
        ? `${p.cosmetics.levelTitle} · ${xp(p.xp)}`
        : board === 'turn'
          ? `${games[p.bestTurn!.gameMode].label} · ${day(p.bestTurn!.achievedAt)}`
          : `${p.stats.wins} partite vinte su ${p.stats.matches}`;
  const value = ({ p }: { p?: PlayerProgression }) =>
    board === 'level' ? (
      <LevelChip p={p} />
    ) : (
      <strong className="rank-value">
        {board === 'turn' ? p!.bestTurn!.value : p!.stats.tournamentsWon}
        <small>{board === 'turn' ? 'punti' : 'tornei'}</small>
      </strong>
    );
  return (
    <>
      <Segmented
        label="Classifica"
        value={board}
        change={setBoard}
        options={[
          { id: 'level', label: 'Livello' },
          { id: 'turn', label: 'Miglior tiro' },
          { id: 'wins', label: 'Vittorie' },
        ]}
      />
      <p className="hint">
        {board === 'level'
          ? 'XP da partite giocate e vinte, tornei conclusi e record personali.'
          : board === 'turn'
            ? 'Il punteggio più alto con un turno di 3 freccette, in qualsiasi gioco (massimo 180). Contano i round registrati.'
            : 'Tornei vinti, poi partite vinte. Spareggi e vittorie a tavolino esclusi.'}
      </p>
      <ErrorMessage error={error} />
      {pending && <Loading />}
      {!pending && rows.length === 0 ? (
        <Empty title="Ancora nessuno in classifica">
          <p>
            {board === 'turn'
              ? 'Registra le partite round per round: il miglior tiro arriva dai round.'
              : 'La classifica si riempie con le partite concluse.'}
          </p>
        </Empty>
      ) : (
        <section className="card pad" aria-label="Classifica">
          <ol className="crew-ranking">
            {rows.map((row, i) => (
              <li key={row.player.id}>
                <span className="rank">{i + 1}</span>
                <Avatar name={row.player.displayName} avatar={row.player.avatar} />
                <span>
                  <span>
                    <FxName name={row.player.displayName} p={row.p} />
                    {row.player.id === me && <i className="me-tag">TU</i>}
                  </span>
                  <small>{detail(row)}</small>
                </span>
                {value(row)}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function Records({ crewId }: { crewId: string }) {
  const players = usePlayers();
  const { list, progression, pending, error } = useRanked(crewId);
  // A crew's game records come from its own tournaments only.
  const crew = useQuery({
    queryKey: ['crew-progression', crewId],
    queryFn: () => localData!.crewProgression(crewId),
    enabled: !!crewId && !!localData,
  });
  const byId = new Map(players.data?.items.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.displayName ?? 'Giocatore';
  const source = crewId ? crew.data : progression.data;
  const gameRecords = Object.values(source?.records ?? {}) as RecordHolding[];
  const top = (
    score: (p: PlayerProgression) => number,
    min = 1,
  ): { id: string; p: PlayerProgression; value: number } | null => {
    let best: { id: string; p: PlayerProgression; value: number } | null = null;
    for (const { player, p } of list) {
      if (!p) continue;
      const value = score(p);
      if (value >= min && (!best || value > best.value)) best = { id: player.id, p, value };
    }
    return best;
  };
  const turn = list
    .map((x) => x.p?.bestTurn)
    .filter((b) => !!b)
    .sort((a, b) => b.value - a.value || a.achievedAt.localeCompare(b.achievedAt))[0];
  const general: { icon: ReactNode; title: string; who: string | null; value: string }[] = [
    {
      icon: <Zap aria-hidden="true" />,
      title: 'Miglior tiro (3 freccette)',
      who: turn?.playerId ?? null,
      value: turn ? `${turn.value} punti · ${games[turn.gameMode].label}` : '',
    },
    ...(
      [
        [<Medal key="i" aria-hidden="true" />, 'Livello più alto', (p) => p.xp, (v) => xp(v)],
        [
          <Trophy key="i" aria-hidden="true" />,
          'Più tornei vinti',
          (p) => p.stats.tournamentsWon,
          (v) => `${v} tornei`,
        ],
        [
          <Crown key="i" aria-hidden="true" />,
          'Più partite vinte',
          (p) => p.stats.wins,
          (v) => `${v} partite`,
        ],
        [
          <Target key="i" aria-hidden="true" />,
          'Più partite giocate',
          (p) => p.stats.matches,
          (v) => `${v} partite`,
        ],
        [
          <Flame key="i" aria-hidden="true" />,
          'Miglior % vittorie (min. 10 partite)',
          (p) => (p.stats.matches >= 10 ? Math.round((p.stats.wins / p.stats.matches) * 100) : 0),
          (v) => `${v}%`,
        ],
      ] as [ReactNode, string, (p: PlayerProgression) => number, (v: number) => string][]
    ).map(([icon, title, score, format]) => {
      const best = top(score);
      return { icon, title, who: best?.id ?? null, value: best ? format(best.value) : '' };
    }),
  ];
  return (
    <>
      <ErrorMessage error={error ?? crew.error} />
      {pending && <Loading />}
      <h2 className="set-h" id="general-title">
        Record generali
      </h2>
      <ul className="record-list" aria-labelledby="general-title">
        {general.map((r) => (
          <li key={r.title}>
            {r.icon}
            <span>
              <strong>{r.title}</strong>
            </span>
            <span>
              {r.who ? (
                <FxName name={name(r.who)} p={progression.data?.players.get(r.who)} />
              ) : (
                <small>Ancora nessuno</small>
              )}
              {r.who && <small>{r.value}</small>}
            </span>
          </li>
        ))}
      </ul>
      <h2 className="set-h" id="games-title">
        Record per gioco
      </h2>
      {gameRecords.length === 0 ? (
        <p className="hint">
          Ancora nessun record. Hi-Score e Shanghai premiano il punteggio più alto, Exacta chi si
          avvicina di più all’obiettivo; 301 e 501 chi chiude in meno round, se i round sono
          registrati.
        </p>
      ) : (
        <ul className="record-list" aria-labelledby="games-title">
          {gameRecords.map((r) => (
            <li key={r.game}>
              <Crown aria-hidden="true" />
              <span>
                <strong>{games[r.game as GameMode].label}</strong>
                <small>{r.spec.title}</small>
              </span>
              <span>
                {r.matchId ? (
                  <Link to={`/partite/${r.matchId}`}>
                    <FxName name={name(r.playerId)} p={progression.data?.players.get(r.playerId)} />
                  </Link>
                ) : (
                  <FxName name={name(r.playerId)} p={progression.data?.players.get(r.playerId)} />
                )}
                <small>
                  {recordValue(r)} · {day(r.achievedAt)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
