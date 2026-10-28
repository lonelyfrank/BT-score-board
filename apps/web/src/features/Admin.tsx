import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Users } from 'lucide-react';
import { api, cloudApi, localData } from '../services/api';
import { isAdmin, useAccount } from '../services/cloud';
import { Empty, ErrorMessage, Header, Loading, Modal, Tabs, useTab } from '../components/ui';
import type { Crew } from '../../../../packages/domain/src/index.js';
import { AdminSection } from './Account';
import { CrewSheet } from './Crews';
import { Players } from './Players';
import { DeviceData } from './Settings';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Cloud mode, admins only: accounts, players, crews and the server's data in one place. The
 * server checks every change again; this page only gathers the tools.
 */
export function Admin() {
  const account = useAccount();
  const [tab, setTab] = useTab('utenti');
  if (!cloudApi || !isAdmin(account))
    return (
      <>
        <Header title="Pannello admin" back="/profilo" backLabel="Indietro al profilo" />
        <main className="not-found">
          <Empty title="Solo per gli admin">
            <Link to="/profilo">Torna al profilo</Link>
          </Empty>
        </main>
      </>
    );
  return (
    <>
      <Header
        title="Pannello admin"
        subtitle="Utenti, giocatori, compagnie e dati"
        back="/profilo"
        backLabel="Indietro al profilo"
      />
      <div className="toolbar">
        <Tabs
          label="Sezioni del pannello"
          tabs={[
            { id: 'utenti', label: 'Utenti' },
            { id: 'giocatori', label: 'Giocatori' },
            { id: 'compagnie', label: 'Compagnie' },
            { id: 'dati', label: 'Dati' },
          ]}
          value={tab}
          change={setTab}
        />
      </div>
      {tab === 'giocatori' ? (
        <Players embedded />
      ) : (
        <main className="settings">
          {tab === 'utenti' && <AdminSection />}
          {tab === 'compagnie' && <CrewAdmin />}
          {tab === 'dati' && <DeviceData />}
        </main>
      )}
    </>
  );
}

/** Every crew: create, rename, change members, delete. Members move from a player's profile too. */
function CrewAdmin() {
  const client = useQueryClient();
  const crews = useQuery({ queryKey: ['crews'], queryFn: () => localData!.crews() });
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.players('', 0) });
  const [editing, setEditing] = useState<Crew | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Crew | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => localData!.deleteCrew(id),
    onSuccess: () => {
      void client.invalidateQueries();
      setDeleting(null);
    },
  });
  const name = (id: string) => players.data?.items.find((p) => p.id === id)?.displayName;
  return (
    <>
      <h2 className="set-h" id="crews-title">
        Compagnie
      </h2>
      <ErrorMessage error={crews.error ?? players.error} retry={() => void crews.refetch()} />
      {crews.isPending && <Loading />}
      {crews.data?.length === 0 && (
        <p className="hint">
          Nessuna compagnia. Le compagnie raggruppano gli amici che giocano insieme: in Compagnia
          ognuno filtra classifiche e record sui membri.
        </p>
      )}
      <div className="card" aria-labelledby="crews-title">
        {crews.data?.map((c) => (
          <div className="row" key={c.id}>
            <span>
              <b className="row-title">{c.name}</b>
              <small className="hint">
                {count(c.memberIds.length, 'membro', 'membri')}
                {c.memberIds.length > 0 &&
                  ` · ${c.memberIds
                    .slice(0, 4)
                    .map((id) => name(id) ?? 'Giocatore')
                    .join(', ')}${c.memberIds.length > 4 ? '…' : ''}`}
              </small>
            </span>
            <span className="pair">
              <button
                type="button"
                className="ibtn"
                aria-label={`Modifica ${c.name}`}
                onClick={() => setEditing(c)}
              >
                <Pencil />
              </button>
              <button
                type="button"
                className="ibtn"
                aria-label={`Elimina ${c.name}`}
                onClick={() => setDeleting(c)}
              >
                <Trash2 />
              </button>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn cta"
        disabled={!players.data}
        onClick={() => setEditing('new')}
      >
        <Users aria-hidden="true" /> Nuova compagnia
      </button>
      <p className="hint">
        Per spostare un giocatore da una compagnia all’altra apri il suo profilo (Giocatori) e
        spunta le compagnie, oppure modifica i membri qui.
      </p>
      {editing && players.data && (
        <CrewSheet
          crew={editing === 'new' ? undefined : editing}
          players={players.data.items}
          close={() => setEditing(null)}
          stay
        />
      )}
      {deleting && (
        <Modal
          title="Eliminare la compagnia?"
          variant="dialog"
          tone="danger"
          close={() => setDeleting(null)}
        >
          <p>«{deleting.name}» sparirà per tutti. Giocatori, tornei e livelli restano.</p>
          <ErrorMessage error={remove.error} />
          <div className="pair">
            <button type="button" className="btn" onClick={() => setDeleting(null)}>
              Annulla
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id)}
            >
              Elimina
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
