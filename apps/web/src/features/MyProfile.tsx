import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, LogOut, Pencil, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { api, cloudApi, nickname } from '../services/api';
import { isAdmin, useAccount } from '../services/cloud';
import { useMe } from '../services/me';
import { Avatar, Empty, ErrorMessage, Header, Loading } from '../components/ui';
import { FxName, LevelChip, useProgression } from '../components/Progression';
import { WhoAmICard } from '../components/WhoAmI';
import { PlayerStep } from '../components/Welcome';
import { PlayerDetails, Profile } from './Players';

const roleLabel = { owner: 'Proprietario', admin: 'Admin', player: 'Giocatore' } as const;

/** The signed-in person (or the owner of this phone): their player, account and shortcuts. */
export function MyProfile() {
  const account = useAccount();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const [creatingMe, setCreatingMe] = useState(false);
  const player = useQuery({
    queryKey: ['players', 'all'],
    queryFn: () => api.players('', 0),
    select: (page) => page.items.find((p) => p.id === me),
    enabled: !!me,
  });
  const progression = useProgression();
  const logout = useMutation({ mutationFn: () => cloudApi!.logout() });
  const p = player.data;
  const level = p ? progression.data?.players.get(p.id) : undefined;
  const admin = !!cloudApi && isAdmin(account);
  return (
    <>
      <Header
        title="Profilo"
        subtitle={account ? `@${account.username} · ${roleLabel[account.role]}` : undefined}
        back={null}
        action={
          <Link className="ibtn box" to="/impostazioni" aria-label="Impostazioni">
            <Settings />
          </Link>
        }
      />
      <main className="lists">
        {p ? (
          <section className="card pad me-hero" aria-label="Il tuo giocatore">
            <Avatar name={p.displayName} avatar={p.avatar} size="xl" />
            <span>
              <strong>
                <FxName name={p.displayName} p={level} />
              </strong>
              <small>
                {[nickname(p), level?.cosmetics.levelTitle].filter(Boolean).join(' · ')}
              </small>
            </span>
            <LevelChip p={level} />
          </section>
        ) : me && player.isPending ? (
          <Loading />
        ) : cloudApi ? (
          <Empty title="Nessun giocatore collegato">
            <p>
              Crea il tuo giocatore (o riconosci quello che hai già usato): così livello, record e
              storico sono tuoi.
            </p>
            <button type="button" className="btn cta" onClick={() => setCreatingMe(true)}>
              Crea il mio giocatore
            </button>
          </Empty>
        ) : (
          <>
            <WhoAmICard />
            <Empty title="Chi sei su questo telefono?">
              <p>
                Apri il tuo giocatore in Compagnia → Giocatori e tocca «Sono io»: qui vedrai
                livello, record e storico.
              </p>
              <Link to="/compagnia?tab=giocatori">Vai ai giocatori</Link>
            </Empty>
          </>
        )}

        {cloudApi && account && (
          <div className="pair">
            {p && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> Modifica profilo
              </button>
            )}
            <button
              type="button"
              className="btn ghost danger"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut aria-hidden="true" /> {logout.isPending ? 'Uscita…' : 'Esci'}
            </button>
          </div>
        )}
        {!cloudApi && p && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" /> Modifica profilo
          </button>
        )}
        <ErrorMessage error={player.error ?? logout.error} />

        <nav className="list" aria-label="Collegamenti del profilo">
          {admin && (
            <Link className="crew-link" to="/admin">
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>Pannello admin</strong>
                <small>Utenti, giocatori, compagnie e backup</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
          <Link className="crew-link" to="/impostazioni">
            <UserRound aria-hidden="true" />
            <span>
              <strong>{cloudApi ? 'Account e sicurezza' : 'Impostazioni'}</strong>
              <small>{cloudApi ? 'Passkey, password e app' : 'Dati, backup e app'}</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </nav>

        {p && <PlayerDetails player={p} />}
      </main>
      {editing && p && <Profile player={p} close={() => setEditing(false)} />}
      {creatingMe && <PlayerStep close={() => setCreatingMe(false)} />}
    </>
  );
}
