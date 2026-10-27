import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Radio, WifiOff } from 'lucide-react';
import { linkResolver } from '../../../../packages/domain/src/crews/crews';
import { cloudApi, localData } from '../services/api';
import { isAdmin, useAccount } from '../services/cloud';
import { entriesOf, seatsOf, turnNotice, type TurnNotice } from '../services/follow';
import { useLiveMatch } from '../services/live';
import { fetchLiveState } from '../services/liveFetch';
import { useMe } from '../services/me';
import { ErrorMessage, Header, Loading } from '../components/ui';
import { usePlaySpaces } from '../components/PlaySpaceStep';

const clock = (at: number | null) =>
  at ? new Date(at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
const vibrateKey = 'bt-follow-vibrate';
const readVibrate = () => {
  try {
    return localStorage.getItem(vibrateKey) === '1';
  } catch {
    return false;
  }
};

function notice(n: TurnNotice, stoppedAt: string) {
  switch (n.kind) {
    case 'you':
      return { tone: 'you', head: 'Tocca a te', sub: `Round ${n.round}` };
    case 'next':
      return { tone: 'next', head: 'Sei il prossimo', sub: `Dopo il round ${n.round} in corso` };
    case 'other':
      return { tone: 'other', head: `Tocca a ${n.label}`, sub: `Round ${n.round}` };
    case 'idle':
      return {
        tone: 'idle',
        head:
          n.reason === 'completed'
            ? 'Partita conclusa'
            : n.reason === 'paused'
              ? 'Pausa'
              : n.reason === 'interrupted'
                ? 'Partita in pausa'
                : 'Non è ancora iniziata',
        sub: '',
      };
    case 'unknown':
      return {
        tone: 'idle',
        head: 'Turni non seguiti',
        sub: 'Il segnapunti registra solo il risultato finale.',
      };
    case 'stale':
      return {
        tone: 'stale',
        head: 'Stato fermo',
        sub: `Connessione interrotta: l’ultimo aggiornamento è delle ${stoppedAt}.`,
      };
  }
}

/**
 * A match followed from another phone: current turn, order, rounds and scores, read-only. It
 * shows what the scorer recorded after the server saved it, and says plainly when the
 * connection is down and the screen is frozen.
 */
export function FollowMatch({ tournamentId }: { tournamentId: string }) {
  const account = useAccount();
  const queries = useQueryClient();
  const live = useLiveMatch(tournamentId, () => fetchLiveState(tournamentId));
  const me = useMe();
  const links = useQuery({
    queryKey: ['links'],
    queryFn: () => localData!.links(),
    enabled: !!localData,
  });
  const spaces = usePlaySpaces();
  const state = live.state;
  const access = useQuery({
    queryKey: ['match-access', tournamentId, state?.version],
    queryFn: () => cloudApi!.matchAccess(tournamentId),
    enabled: !!cloudApi && !!state,
  });
  const connected = live.status === 'live';
  const [vibrate, setVibrate] = useState(readVibrate);
  const mine = (() => {
    if (!state || !me) return new Set<string>();
    const resolve = linkResolver(links.data ?? []);
    const ids = new Set(
      state.tournament.entries.flatMap((e) =>
        (e.members.length ? e.members.map((x) => x.playerId) : [e.playerId]).filter(
          (id) => resolve(id) === me,
        ),
      ),
    );
    return entriesOf(state.tournament, ids);
  })();
  const turn = state?.match
    ? turnNotice(state.tournament, state.match, mine, connected)
    : state && !connected
      ? ({ kind: 'stale' } as TurnNotice)
      : ({ kind: 'unknown' } as TurnNotice);
  // A vibration, only if asked for, only when it becomes the person's turn, only while live.
  const was = useRef<TurnNotice['kind']>('unknown');
  useEffect(() => {
    if (vibrate && turn.kind === 'you' && was.current !== 'you') navigator.vibrate?.(200);
    was.current = turn.kind;
  }, [turn.kind, vibrate]);

  if (live.status === 'denied')
    return (
      <>
        <Header title="Partita" back="/" />
        <main className="not-found">
          <p role="alert">Non hai più accesso a questa partita.</p>
          <Link to="/">Torna alla Home</Link>
        </main>
      </>
    );
  if (!state) return live.status === 'connecting' ? <Loading /> : <Loading />;
  const t = state.tournament;
  const space = spaces.data?.find((s) => s.id === t.playSpaceId);
  const seats = state.match ? seatsOf(t, state.match, mine) : [];
  const n = notice(turn, clock(live.receivedAt));
  const scorer = access.data?.scorer?.username;
  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  return (
    <>
      <Header title={t.name} subtitle={space ? `Scoreboard ${space.name}` : undefined} back="/" />
      <main className="follow">
        <p className={`follow-link ${connected ? 'ok' : 'off'}`} role="status">
          {connected ? <Radio aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          {connected
            ? 'In diretta'
            : live.status === 'connecting'
              ? 'Connessione…'
              : `Connessione persa · dati fermi alle ${clock(live.receivedAt)}`}
        </p>
        <section className={`follow-turn ${n.tone}`} aria-live="polite">
          <h2>{n.head}</h2>
          {n.sub && <p>{n.sub}</p>}
        </section>
        {seats.length > 0 && (
          <ol className="follow-seats" aria-label="Ordine di tiro">
            {seats.map((s, i) => (
              <li
                key={s.entryId}
                className={[s.mine ? 'mine' : '', s.current && connected ? 'now' : ''].join(' ')}
              >
                <span className="pos">{i + 1}</span>
                <span className="nm">
                  <b>{s.label}</b>
                  {s.thrower && s.current && connected && <small>Tira {s.thrower}</small>}
                  {s.mine && <small>Sei tu</small>}
                </span>
                <span className="val">{s.value ?? '—'}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="hint">
          Solo lettura. Il risultato ufficiale è quello mostrato dal totem, registrato da{' '}
          {scorer ?? 'chi segna la partita'}.
        </p>
        {canVibrate && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={vibrate}
              onChange={(e) => {
                setVibrate(e.target.checked);
                try {
                  localStorage.setItem(vibrateKey, e.target.checked ? '1' : '0');
                } catch {
                  /* Not remembered. */
                }
              }}
            />
            Vibra quando tocca a me (solo con l’app aperta)
          </label>
        )}
        {access.data && !access.data.scorer && isAdmin(account) && (
          <div className="card pad">
            <p>Questa partita non ha un segnapunti.</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (
                  !window.confirm(
                    'Assumi il segnapunti di questa partita? L’operazione è registrata.',
                  )
                )
                  return;
                void cloudApi!
                  .recoverScorer(tournamentId, account!.id, 'Recupero amministrativo')
                  .then(() => queries.invalidateQueries());
              }}
            >
              Assumi il segnapunti (recupero admin)
            </button>
          </div>
        )}
        <ErrorMessage error={access.error} />
      </main>
    </>
  );
}

/** `/segui/:id`: the link a participant opens to follow one match, nothing else. */
export function FollowRoute() {
  const { id = '' } = useParams();
  return <FollowMatch tournamentId={id} />;
}
