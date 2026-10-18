import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartNoAxesColumnIncreasing, ChevronRight, Plus, Trophy } from 'lucide-react';
import { api, type PubEvent, type Summary } from '../services/api';
import { tournamentPath } from '../services/session';
import {
  AddButton,
  Empty,
  ErrorMessage,
  Header,
  Loading,
  Modal,
  StatusChip,
  Tabs,
  statusLabel,
  tournamentTone,
  type Tone,
} from '../components/ui';

const eventStatus: Record<PubEvent['status'], [string, Tone]> = {
  active: ['IN CORSO', 'live'],
  planned: ['IN PROGRAMMA', 'neutral'],
  completed: ['CONCLUSA', 'success'],
  cancelled: ['ANNULLATA', 'neutral'],
};
const upcoming = (e: PubEvent) => e.status === 'planned' || e.status === 'active';
const count = (n: number) => `${n} ${n === 1 ? 'torneo' : 'tornei'}`;

function EventCard({ event, tournaments }: { event: PubEvent; tournaments?: Summary[] }) {
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
    <article className={`event ${live ? 'live' : ''}`}>
      <div className="event-top">
        <div className="date-tile" aria-hidden={!date}>
          <small>
            {date ? date.toLocaleDateString('it-IT', { weekday: 'short' }).toUpperCase() : '—'}
          </small>
          <strong>{date ? date.getDate() : '?'}</strong>
          <small>{date ? date.toLocaleDateString('it-IT', { month: 'short' }) : ''}</small>
        </div>
        <div className="event-title">
          <h2>{event.name}</h2>
          <span>
            {[
              date &&
                `ore ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`,
              tournaments && count(tournaments.length),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <StatusChip tone={tone}>
          {live && <span className="live-dot" aria-hidden="true" />}
          {label}
        </StatusChip>
      </div>
      {event.description && <p>{event.description}</p>}
      {tournaments === undefined ? (
        <Loading />
      ) : tournaments.length ? (
        <div className="event-tournaments">
          {tournaments.map((t) => (
            <Link key={t.id} className="event-tournament" to={tournamentPath(t)}>
              {t.mode === 'GROUPS' ? (
                <Trophy aria-hidden="true" />
              ) : (
                <ChartNoAxesColumnIncreasing aria-hidden="true" className="accent-icon" />
              )}
              <span>
                <span>{t.name}</span>
                <small>{t.mode === 'GROUPS' ? 'A gironi' : 'Hi-Score'}</small>
              </span>
              <StatusChip tone={tournamentTone(t.status)}>{statusLabel(t.status).toUpperCase()}</StatusChip>
              <ChevronRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : (
        <p className="hint">Nessun torneo ancora collegato.</p>
      )}
      <ErrorMessage error={advance.error} />
      {upcoming(event) && (
        <div className="pair">
          <Link className="button dashed accent" to={`/tornei/nuovo?serata=${event.id}`}>
            <Plus aria-hidden="true" /> Aggiungi torneo
          </Link>
          <button
            className={live ? 'success-outline' : 'outline'}
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
    <Modal title="Nuova serata" close={close}>
      <form
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
        <button className="primary" disabled={!name.trim() || create.isPending}>
          CREA SERATA
        </button>
        <button type="button" onClick={close}>
          Annulla
        </button>
      </form>
    </Modal>
  );
}

export function Events() {
  const [tab, setTab] = useState('up');
  const [creating, setCreating] = useState(false);
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.events() });
  const list = (events.data?.items ?? [])
    .filter((e) => (tab === 'up' ? upcoming(e) : !upcoming(e)))
    .sort((a, b) =>
      // Upcoming soonest first, past most recent first; undated last.
      (tab === 'up' ? 1 : -1) * ((a.scheduledAt ?? '~').localeCompare(b.scheduledAt ?? '~')),
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
        action={<AddButton label="Nuova serata" onClick={() => setCreating(true)} />}
      />
      <main className="content events-page">
        <Tabs
          label="Serate"
          tabs={[
            { id: 'up', label: 'In programma' },
            { id: 'past', label: 'Concluse' },
          ]}
          value={tab}
          change={setTab}
        />
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
        <div className="graffiti" aria-hidden="true">
          Good
          <br />
          darts
          <br />
          good
          <br />
          friends
        </div>
      </main>
      {creating && <NewEventSheet close={() => setCreating(false)} />}
    </>
  );
}
