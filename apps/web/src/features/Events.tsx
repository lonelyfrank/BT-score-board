import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { api, type PubEvent, type Summary } from '../services/api';
import { useCanManage } from '../services/me';
import { tournamentPath } from '../services/session';
import {
  AddButton,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  Segmented,
  StatusChip,
  statusLabel,
  type Tone,
} from '../components/ui';
import { formatLabel } from '../services/rules';

const eventStatus: Record<PubEvent['status'], [string, Tone]> = {
  active: ['IN CORSO', 'live'],
  planned: ['IN PROGRAMMA', 'neutral'],
  completed: ['CONCLUSA', 'success'],
  cancelled: ['ANNULLATA', 'neutral'],
};
const upcoming = (e: PubEvent) => e.status === 'planned' || e.status === 'active';
const count = (n: number) => `${n} ${n === 1 ? 'torneo' : 'tornei'}`;

function EventCard({ event, tournaments }: { event: PubEvent; tournaments?: Summary[] }) {
  const manage = useCanManage();
  const client = useQueryClient();
  const advance = useMutation({
    mutationFn: () =>
      api.updateEvent(event.id, { status: event.status === 'active' ? 'completed' : 'active' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['events'] }),
  });
  const date = event.scheduledAt ? new Date(event.scheduledAt) : null;
  const [label, tone] = eventStatus[event.status];
  const live = event.status === 'active';
  return (
    <article className={`card pad event ${live ? 'live' : ''}`}>
      <div className="event-top">
        <div className="date-tile" aria-hidden={!date}>
          <small>
            {date ? date.toLocaleDateString('it-IT', { month: 'short' }).toUpperCase() : '—'}
          </small>
          <strong>{date ? date.getDate() : '?'}</strong>
        </div>
        <div className="event-title">
          <h2>{event.name}</h2>
          <p className="hint">
            {[
              date && date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
              tournaments && count(tournaments.length),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <StatusChip tone={tone}>{live ? 'STASERA' : label}</StatusChip>
      </div>
      {event.description && <p className="hint">{event.description}</p>}
      {tournaments === undefined ? (
        <Loading />
      ) : tournaments.length ? (
        <div className="list">
          {tournaments.map((t) => (
            <Link key={t.id} className="mrow" to={tournamentPath(t)}>
              <span>
                {t.name}
                <br />
                <small>
                  {formatLabel(t.mode)} · {statusLabel(t.status)}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : (
        <p className="hint">Nessun torneo ancora collegato.</p>
      )}
      <ErrorMessage error={advance.error} />
      {manage && upcoming(event) && (
        <div className="pair">
          <Link className="btn sm dashed" to={`/tornei/nuovo?serata=${event.id}`}>
            <Plus aria-hidden="true" /> Aggiungi torneo
          </Link>
          <button
            type="button"
            className={`btn sm ${live ? 'ok' : ''}`}
            disabled={advance.isPending}
            onClick={() => advance.mutate()}
          >
            {live ? 'Concludi serata' : 'Apri la serata'}
          </button>
        </div>
      )}
    </article>
  );
}

function NewEventSheet({ close }: { close: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.createEvent({
        name: name.trim(),
        // datetime-local has no zone: the browser's local time, sent with its offset.
        scheduledAt: when ? new Date(when).toISOString() : null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['events'] });
      close();
    },
  });
  return (
    <Modal
      title="Nuova serata"
      close={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Annulla
          </button>
          <button className="btn cta" form="new-event" disabled={!name.trim() || create.isPending}>
            CREA SERATA
          </button>
        </>
      }
    >
      <form
        id="new-event"
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label className="field">
          Nome
          <input
            value={name}
            maxLength={120}
            placeholder="es. Halloween Darts"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Data e ora (facoltativa)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="field">
          Descrizione (facoltativa)
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <ErrorMessage error={create.error} />
      </form>
    </Modal>
  );
}

export function Events() {
  const manage = useCanManage();
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [creating, setCreating] = useState(false);
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const list = (events.data?.items ?? [])
    .filter((e) => (tab === 'up' ? upcoming(e) : !upcoming(e)))
    .sort(
      (a, b) =>
        // Upcoming soonest first, past most recent first; undated last.
        (tab === 'up' ? 1 : -1) * (a.scheduledAt ?? '~').localeCompare(b.scheduledAt ?? '~'),
    );
  const tournaments = useQueries({
    queries: list.map((e) => ({
      queryKey: ['tournaments', 0, e.id],
      queryFn: () => api.tournaments(0, e.id),
    })),
  });
  return (
    <>
      <Header
        title="Game Night"
        subtitle="Serate del locale"
        back="/"
        backLabel="Indietro alla Home"
        action={
          manage ? <AddButton label="Nuova serata" onClick={() => setCreating(true)} /> : undefined
        }
      />
      <div className="toolbar">
        <Segmented
          label="Serate"
          value={tab}
          change={setTab}
          options={[
            { id: 'up', label: 'In programma' },
            { id: 'past', label: 'Concluse' },
          ]}
        />
      </div>
      <main className="lists">
        <ErrorMessage error={events.error} retry={() => void events.refetch()} />
        {events.isPending && <Loading />}
        {list.map((e, i) => (
          <EventCard key={e.id} event={e} tournaments={tournaments[i]?.data?.items} />
        ))}
        {events.data && !list.length && (
          <Empty title="Nessuna serata qui">
            <p>
              {tab === 'up'
                ? 'Crea la prossima serata con il tasto +.'
                : 'Le serate concluse o annullate compaiono in questa scheda.'}
            </p>
          </Empty>
        )}
        <p className="hint">
          Una serata raggruppa più tornei. Ogni torneo gioca su un bersaglio alla volta; l’uso del
          bersaglio tra tornei diversi lo coordina l’organizzatore.
        </p>
      </main>
      {creating && <NewEventSheet close={() => setCreating(false)} />}
    </>
  );
}
