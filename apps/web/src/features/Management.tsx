import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  CircleX,
  Eye,
  Flag,
  Lock,
  MapPin,
  MoreVertical,
  Pause,
  Play,
  Share2,
  ShieldCheck,
  Trophy,
  UserMinus,
} from 'lucide-react';
import {
  api,
  cloudApi,
  localData,
  sharedApi,
  type Summary,
  type Tournament,
  type TournamentAction,
} from '../services/api';
import { useRole, type Role } from '../services/me';
import { activeSession, resultsPath, tournamentPath } from '../services/session';
import { formatLabel, gameOf } from '../services/rules';
import {
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
import { Qr, shareLink } from '../components/Qr';
import { OrganizerAccess } from './Settings';
import { MoveSpace } from './PlaySpaces';
import { entryName, isDraft } from './Tournaments';
import '../styles/management.css';

const isOpen = (status: string) => !['completed', 'cancelled'].includes(status);
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** The role of this phone, shown at the top of the management pages and linking to the table. */
function RoleCard({ role, count, to }: { role: Role; count?: number; to?: string }) {
  const body = (
    <>
      {role.id === 'ospite' ? <Eye aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
      <span>
        <b>{role.label}</b>
        <small>{role.hint}</small>
      </span>
      <span className={`chip ${role.id === 'ospite' ? 'warn' : 'ok'}`}>
        {role.id === 'ospite' ? 'SOLA LETTURA' : count ? `${count} COMANDI` : 'TUTTI I COMANDI'}
      </span>
    </>
  );
  return to ? (
    <Link className={`mg-role ${role.id}`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={`mg-role ${role.id}`}>{body}</div>
  );
}

/** Pause, resume and the other plain commands of a tournament, with the lists refreshed after. */
function useTournamentCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      action,
      extra,
    }: {
      id: string;
      action: TournamentAction;
      extra?: Record<string, unknown>;
    }) => api.tournamentCommand(await api.tournament(id), action, extra),
    onSuccess: () => client.invalidateQueries(),
  });
}

type Act = {
  label: string;
  to?: string;
  run?: () => void;
  cta?: boolean;
};

/** Gestione: tournaments and matches of this phone, in progress and past, one card each. */
export function Management() {
  const role = useRole();
  const client = useQueryClient();
  const [state, setState] = useState<'open' | 'done' | 'removed'>('open');
  const [kind, setKind] = useState<'all' | 't' | 'p'>('all');
  const query = useQuery({ queryKey: ['tournaments', 0], queryFn: () => api.tournaments(0) });
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const canRestore = !!localData && role.id !== 'ospite';
  const removed = useQuery({
    queryKey: ['tournaments', 'removed'],
    queryFn: () => localData!.removedTournaments(),
    enabled: canRestore,
  });
  const command = useTournamentCommand();
  const restore = useMutation({
    mutationFn: (id: string) => localData!.removeTournament(id, false),
    onSuccess: () => client.invalidateQueries(),
  });
  const live = session.data?.tournament.id;
  const all = query.data?.items ?? [];
  const bucket = (t: Summary) => (isOpen(t.status) ? 'open' : 'done');
  const count = (s: 'open' | 'done') => all.filter((t) => bucket(t) === s).length;
  const items = (
    state === 'removed' ? (removed.data ?? []) : all.filter((t) => bucket(t) === state)
  )
    .filter((t) => kind === 'all' || (kind === 'p') === (t.mode === 'SINGLE_MATCH'))
    .slice();
  const manage = role.id !== 'ospite';
  const acts = (t: Summary): [Act, Act] => {
    const path = tournamentPath(t);
    const manageTo = `/gestione/${t.id}`;
    if (state === 'removed') {
      return [
        { label: 'Ripristina', run: () => restore.mutate(t.id), cta: true },
        { label: 'Dettagli', to: manageTo },
      ];
    }
    if (t.status === 'cancelled')
      return [
        { label: 'Dettagli', to: manageTo },
        { label: 'Apri', to: path },
      ];
    if (t.status === 'completed')
      return [
        { label: t.mode === 'SINGLE_MATCH' ? 'Risultato' : 'Risultati', to: resultsPath(t) },
        { label: 'Correggi…', to: manageTo },
      ];
    if (isDraft(t as Tournament))
      return [
        { label: 'Continua bozza', to: path },
        { label: 'Elimina bozza', to: manageTo },
      ];
    if (t.status === 'paused')
      return [
        { label: 'Riprendi', cta: true, run: () => command.mutate({ id: t.id, action: 'resume' }) },
        { label: 'Apri', to: path },
      ];
    return [
      { label: t.id === live ? 'Apri il Live' : 'Apri', to: path, cta: true },
      { label: 'Pausa', run: () => command.mutate({ id: t.id, action: 'pause' }) },
    ];
  };
  const chip = (t: Summary): [string, Tone] =>
    isDraft(t as Tournament)
      ? ['BOZZA', 'neutral']
      : t.status === 'active'
        ? ['LIVE', 'live']
        : t.status === 'paused'
          ? ['IN PAUSA', 'warning']
          : t.status === 'completed'
            ? [t.mode === 'SINGLE_MATCH' ? 'CONCLUSA' : 'CONCLUSO', 'success']
            : t.status === 'cancelled'
              ? ['ANNULLATO', 'neutral']
              : [statusLabel(t.status).toUpperCase(), tournamentTone(t.status)];
  return (
    <>
      <Header
        title="Gestione"
        subtitle="Tornei e partite di questo telefono"
        back="/impostazioni"
        backLabel="Indietro alle impostazioni"
        action={
          <Link className="ibtn box" to="/permessi" aria-label="Accesso e permessi">
            <Lock />
          </Link>
        }
      />
      <div className="mg-top">
        <RoleCard role={role} to="/permessi" />
        <Segmented
          label="Stato"
          value={state}
          change={setState}
          options={[
            { id: 'open', label: `In corso · ${count('open')}` },
            { id: 'done', label: `Passati · ${count('done')}` },
            ...(canRestore ? [{ id: 'removed' as const, label: 'Eliminati' }] : []),
          ]}
        />
        <Segmented
          label="Tipo"
          small
          value={kind}
          change={setKind}
          options={[
            { id: 'all', label: 'Tutti' },
            { id: 't', label: 'Tornei' },
            { id: 'p', label: 'Partite' },
          ]}
        />
      </div>
      <main className="lists">
        <ErrorMessage error={query.error ?? command.error ?? restore.error} />
        {query.isPending && <Loading />}
        {items.map((t) => {
          const [label, tone] = chip(t);
          const [a, b] = acts(t);
          const act = (x: Act, extra = '') =>
            x.to ? (
              <Link className={`btn sm ${x.cta ? 'cta' : ''} ${extra}`} to={x.to}>
                {x.label}
              </Link>
            ) : (
              <button
                type="button"
                className={`btn sm ${x.cta ? 'cta' : ''} ${extra}`}
                disabled={!manage || command.isPending || restore.isPending}
                onClick={x.run}
              >
                {x.label}
              </button>
            );
          return (
            <section
              key={t.id}
              className={`card mg-item ${t.id === live && t.status === 'active' ? 'live' : t.status === 'paused' ? 'warn' : ''}`}
              aria-label={t.name}
            >
              <div className="mg-item-h">
                <span>
                  <b>{t.name}</b>
                  <small className="hint">
                    {[
                      t.mode === 'SINGLE_MATCH' ? 'Partita' : formatLabel(t.mode),
                      gameOf(t).label,
                      dateOf(t.createdAt),
                    ].join(' · ')}
                  </small>
                </span>
                <StatusChip tone={tone}>{label}</StatusChip>
              </div>
              <div className="mg-item-a">
                {act(a)}
                {act(b)}
                <Link className="btn sm" to={`/gestione/${t.id}`} aria-label={`Gestisci ${t.name}`}>
                  <MoreVertical aria-hidden="true" />
                </Link>
              </div>
            </section>
          );
        })}
        {!query.isPending && !items.length && (
          <p className="hint mg-empty">
            {state === 'removed'
              ? 'I tornei eliminati compaiono qui e si possono ripristinare.'
              : state === 'open'
                ? 'Nessun torneo o partita in corso.'
                : 'Ancora nessun torneo o partita passato.'}
          </p>
        )}
      </main>
    </>
  );
}

type Row = {
  label: string;
  hint: string;
  icon: ReactNode;
  to?: string;
  run?: () => void;
  /** Needs an organizer (or the private owner): guests see it locked. */
  needs?: boolean;
  danger?: boolean;
  disabled?: boolean;
};

function Group({
  title,
  tag,
  rows,
  guest,
  risk = false,
}: {
  title: string;
  tag: 'CONSULTAZIONE' | 'ORGANIZZATORE';
  rows: Row[];
  guest: boolean;
  risk?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <>
      <div className="set-h mg-gh">
        <span>{title}</span>
        <span className={tag === 'CONSULTAZIONE' ? 'ok' : 'org'}>{tag}</span>
      </div>
      <div className={`card mg-rows ${risk ? 'risk' : ''}`}>
        {rows.map((r) => {
          const locked = !!r.needs && guest;
          const inner = (
            <>
              <span className="ai" aria-hidden="true">
                {r.icon}
              </span>
              <span>
                <b>{r.label}</b>
                <small>{r.hint}</small>
              </span>
              {locked ? (
                <Lock aria-label="Solo organizzatore" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
            </>
          );
          const cls = `mg-act ${locked ? 'off' : ''} ${r.danger ? 'danger' : ''} ${r.needs ? 'org' : ''}`;
          return locked || r.to ? (
            <Link key={r.label} className={cls} to={locked ? '/permessi' : r.to!}>
              {inner}
            </Link>
          ) : (
            <button
              key={r.label}
              type="button"
              className={cls}
              disabled={r.disabled}
              onClick={r.run}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Gestione torneo: what each role can do with one tournament, organized by when it is used. */
export function ManageTournament() {
  const { id = '' } = useParams();
  const role = useRole();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['tournament', id], queryFn: () => api.tournament(id) });
  const removedList = useQuery({
    queryKey: ['tournaments', 'removed'],
    queryFn: () => localData!.removedTournaments(),
    enabled: !!localData && role.id !== 'ospite',
  });
  const command = useTournamentCommand();
  const remove = useMutation({
    mutationFn: (value: boolean) => localData!.removeTournament(id, value),
    onSuccess: async () => {
      await client.invalidateQueries();
      navigate('/gestione');
    },
  });
  const [confirm, setConfirm] = useState<'cancel' | 'remove' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState('');
  const guest = role.id === 'ospite';
  const removed = removedList.data?.find((r) => r.id === id);
  if (query.isPending) return <Loading />;
  if (removed && !query.data)
    return (
      <>
        <Header
          title={removed.name}
          subtitle="Eliminato"
          back="/gestione"
          backLabel="Indietro alla gestione"
        />
        <main className="mg-page">
          <p className="hint">
            Questo torneo è stato eliminato: non compare nelle liste né nelle statistiche, e solo
            gli admin lo vedono. Ripristinandolo torna com’era.
          </p>
          <button
            type="button"
            className="btn cta"
            disabled={remove.isPending}
            onClick={() => remove.mutate(false)}
          >
            Ripristina torneo
          </button>
          <ErrorMessage error={remove.error} />
        </main>
      </>
    );
  const t = query.data;
  if (!t)
    return (
      <>
        <Header title="Gestione torneo" back="/gestione" backLabel="Indietro alla gestione" />
        <main>
          <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        </main>
      </>
    );
  const path = tournamentPath(t);
  const draft = isDraft(t);
  const open = isOpen(t.status);
  const started = open && !draft;
  const paused = t.status === 'paused';
  const active = t.status === 'active';
  const highscore = t.mode === 'QUICK_HIGH_SCORE';
  const single = t.mode === 'SINGLE_MATCH';
  const winner = t.results.find((r) => r.finalPlacement === 1);
  const link = `${location.origin}/segui/${t.id}`;
  const meta = [formatLabel(t.mode), gameOf(t).label, `${t.entries.length} giocatori`].join(' · ');

  const consult: Row[] = [
    open
      ? {
          label: single
            ? 'Apri la partita'
            : highscore
              ? 'Classifica in tempo reale'
              : 'Panoramica e tabellone',
          hint: highscore ? 'Soglia della finale e manche giocate' : 'Fasi, incontri e classifica',
          icon: <ChartNoAxesColumnIncreasing />,
          to: path,
        }
      : {
          label: 'Podio e piazzamenti',
          hint: 'Risultato ufficiale e XP della serata',
          icon: <Trophy />,
          to: resultsPath(t),
        },
    {
      label: 'Regole del gioco',
      hint: gameOf(t).label,
      icon: <BookOpen />,
      to: '/regole',
    },
  ];
  const playing: Row[] = started
    ? [
        {
          label: paused ? 'Riprendi il torneo' : 'Metti in pausa il torneo',
          hint: paused ? 'Si torna a registrare punteggi' : 'Il Live si ferma, nessun dato perso',
          icon: paused ? <Play /> : <Pause />,
          needs: true,
          disabled: (!active && !paused) || command.isPending,
          run: () => command.mutate({ id: t.id, action: paused ? 'resume' : 'pause' }),
        },
        ...(active && !single
          ? [
              {
                label: 'Ritira un giocatore…',
                hint: 'Esce dalla fase in corso, i suoi totali restano nello storico',
                icon: <UserMinus />,
                needs: true,
                to: `${path}?azione=ritira`,
              },
            ]
          : []),
        ...(active && highscore
          ? [
              {
                label: 'Chiudi qualifica in anticipo…',
                hint: 'Si va in finale con i punteggi registrati',
                icon: <Flag />,
                needs: true,
                to: `${path}?azione=chiudi`,
              },
            ]
          : []),
      ]
    : draft
      ? [
          {
            label: 'Continua bozza',
            hint: 'Iscrizioni aperte: riprendi dal riepilogo',
            icon: <Play />,
            needs: true,
            to: path,
          },
        ]
      : [];
  const sharing_: Row[] = [
    ...(cloudApi && open
      ? [
          {
            label: 'Condividi con gli spettatori',
            hint: 'QR e link: diretta, round e classifica in sola visione',
            icon: <Eye />,
            needs: true,
            run: () => setSharing(true),
          },
        ]
      : []),
    ...(localData
      ? [
          {
            label: 'Punto di incontro',
            hint: 'Dove conta il torneo: sposta i risultati in un’altra scoreboard',
            icon: <MapPin />,
            needs: true,
            run: () => setPlacing(true),
          },
          {
            label: 'Condividi con la compagnia',
            hint: 'Incluso o escluso dal pacchetto, dalla pagina della compagnia',
            icon: <Share2 />,
            needs: true,
            to: '/compagnie',
          },
        ]
      : []),
    ...(single && !open
      ? [
          {
            label: 'Correggi il risultato…',
            hint: 'Riapre la partita: la correzione resta nello storico',
            icon: <CalendarDays />,
            needs: true,
            to: path,
          },
        ]
      : []),
  ];
  const risky: Row[] = [
    ...(open
      ? [
          {
            label: draft ? 'Annulla la bozza…' : 'Annulla torneo…',
            hint: 'Resta nello storico, esce dalle statistiche. Non si può riattivare',
            icon: <CircleX />,
            needs: true,
            danger: true,
            run: () => setConfirm('cancel'),
          },
        ]
      : []),
    ...(localData && !(started && (active || paused))
      ? [
          {
            label: 'Elimina il torneo…',
            hint: 'Lo toglie da liste, serate e statistiche. Si ripristina da Eliminati',
            icon: <CircleX />,
            needs: true,
            danger: true,
            run: () => setConfirm('remove'),
          },
        ]
      : []),
  ];
  const count = [playing, sharing_, risky].reduce((n, g) => n + g.length, 0);
  return (
    <>
      <Header
        title={t.name}
        subtitle={`${statusLabel(t.status)} · ${meta}`}
        back="/gestione"
        backLabel="Indietro alla gestione"
      />
      <main className="mg-page">
        <RoleCard role={role} count={count} to={guest ? '/permessi' : undefined} />
        <ErrorMessage error={command.error ?? remove.error} />
        {!open && (
          <section className="card mg-summary" aria-label="Riepilogo">
            <span className="field-l">{t.status === 'cancelled' ? 'Annullato' : 'Concluso'}</span>
            <b>
              {t.status === 'cancelled'
                ? 'Resta nello storico, fuori dalle statistiche'
                : winner
                  ? `Vince ${entryName(t, winner.tournamentEntryId)}`
                  : 'Risultato ufficiale'}
            </b>
            <small className="hint">{meta}</small>
          </section>
        )}
        <Group title="Per tutti" tag="CONSULTAZIONE" rows={consult} guest={guest} />
        <Group
          title={draft ? 'Bozza' : 'Durante il gioco'}
          tag="ORGANIZZATORE"
          rows={playing}
          guest={guest}
        />
        <Group title="Dati e condivisione" tag="ORGANIZZATORE" rows={sharing_} guest={guest} />
        <Group title="Zona rischiosa" tag="ORGANIZZATORE" rows={risky} guest={guest} risk />
        {!open && !single && (
          <p className="hint">
            Un torneo concluso non si annulla: si corregge, e la correzione resta nello storico.
          </p>
        )}
      </main>
      {confirm && (
        <Modal
          variant="dialog"
          tone="danger"
          title={confirm === 'cancel' ? 'Annullare il torneo?' : 'Eliminare il torneo?'}
          close={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
                Indietro
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={command.isPending || remove.isPending}
                onClick={() => {
                  if (confirm === 'cancel')
                    command.mutate(
                      { id: t.id, action: 'cancel' },
                      { onSuccess: () => setConfirm(null) },
                    );
                  else remove.mutate(true);
                }}
              >
                {confirm === 'cancel' ? 'Annulla il torneo' : 'Elimina il torneo'}
              </button>
            </>
          }
        >
          <p>
            {confirm === 'cancel'
              ? 'Annullarlo lo ferma: resta nello storico come “annullato” ma esce dalle statistiche dei giocatori. Non si può riattivare.'
              : 'Eliminare toglie il torneo da liste, serate, compagnie e statistiche: serve per le prove e i tornei di test. Resta ripristinabile da “Eliminati”.'}
          </p>
        </Modal>
      )}
      {placing && (
        <Modal title="Punto di incontro" close={() => setPlacing(false)}>
          <MoveSpace tournamentId={t.id} />
        </Modal>
      )}
      {sharing && (
        <Modal
          title="Condividi con gli spettatori"
          subtitle="Sola visione, nessun diritto nel link"
          close={() => setSharing(false)}
        >
          <Qr value={link} label="QR per seguire il torneo" />
          <p className="hint">
            Chi apre il link segue la diretta senza poterla modificare. Serve un account collegato a
            un giocatore.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void shareLink('Segui il torneo', link).then((r) =>
                setNote(
                  r === 'copied' ? 'Link copiato.' : r === 'failed' ? 'Copia il link a mano.' : '',
                ),
              )
            }
          >
            Condividi il link
          </button>
          {note && <p role="status">{note}</p>}
        </Modal>
      )}
    </>
  );
}

const permissions: [string, boolean | string, boolean | string, boolean | string][] = [
  ['Classifiche e risultati', true, true, true],
  ['Regole del totem', true, true, true],
  ['Creare partite e tornei', false, true, true],
  ['Segnare nel Live', false, true, true],
  ['Pausa, ritiri, chiusure', false, true, true],
  ['Correggere e annullare', false, true, true],
  ['Modificare profili', false, 'solo il tuo', true],
  ['Livelli e record', false, true, false],
  ['Compagnie e pacchetti', false, true, false],
  ['Backup e unione', false, true, false],
];

const Cell = ({ v }: { v: boolean | string }) =>
  v === true ? (
    <Check aria-label="sì" strokeWidth={3} />
  ) : v === false ? (
    <span aria-label="no">—</span>
  ) : (
    v
  );

/** Accesso e permessi: who can do what, and where the organizer token is entered. */
export function Permissions() {
  const role = useRole();
  return (
    <>
      <Header
        title="Accesso e permessi"
        subtitle="Chi può fare cosa"
        back="/impostazioni"
        backLabel="Indietro alle impostazioni"
      />
      <main className="mg-page">
        <section className="card mg-you" aria-label="Il tuo accesso">
          <span className="field-l">Su questo telefono</span>
          <div>
            <b>{role.label}</b>
            <span className={`chip ${role.id === 'ospite' ? 'warn' : 'ok'}`}>
              {role.id === 'ospite' ? 'SOLA LETTURA' : 'ATTIVO'}
            </span>
          </div>
          <p className="hint">{role.hint}.</p>
        </section>
        <div className="card mg-table">
          <table aria-label="Permessi per ruolo">
            <thead>
              <tr>
                <th>Funzione</th>
                <th className={role.id === 'ospite' ? 'me' : ''}>Ospite</th>
                <th className={role.id === 'privato' ? 'me' : ''}>Privato</th>
                <th className={role.id === 'organizzatore' ? 'me' : ''}>Organizz.</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map(([f, g, p, o]) => (
                <tr key={f}>
                  <td>{f}</td>
                  <td className={role.id === 'ospite' ? 'me' : ''}>
                    <Cell v={g} />
                  </td>
                  <td className={role.id === 'privato' ? 'me' : ''}>
                    <Cell v={p} />
                  </td>
                  <td className={role.id === 'organizzatore' ? 'me' : ''}>
                    <Cell v={o} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card mg-roles">
          <div className="row">
            <b>Ospite</b>
            <span className="hint">
              Chi apre il link del locale senza token: classifiche e risultati in diretta.
            </span>
          </div>
          <div className="row">
            <b className="me">Privato</b>
            <span className="hint">
              L’app installata sul tuo telefono, con i dati sul dispositivo.
            </span>
          </div>
          <div className="row">
            <b>Organizzatore</b>
            <span className="hint">
              Server del locale con token: comanda il torneo per tutti i telefoni.
            </span>
          </div>
        </div>
        {/* The token form only exists with a venue server. */}
        {sharedApi && <OrganizerAccess />}
      </main>
    </>
  );
}
