import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookText,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Crosshair,
  HardDriveDownload,
  Lock,
  MapPin,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import { api, cloudApi, localData, sharedApi } from '../services/api';
import { activeSession, recentResults, resultsPath, tournamentPath } from '../services/session';
import { gameOf } from '../services/rules';
import { CrewOnboarding } from './Crews';
import { WhoAmICard } from '../components/WhoAmI';

export function Home() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const recent = useQuery({ queryKey: ['recent-results'], queryFn: () => recentResults(api) });
  const backup = useQuery({
    queryKey: ['local-status'],
    queryFn: () => localData!.status(),
    // On the server the reminder is for the admins' copy, in the settings.
    enabled: !!localData && !cloudApi,
  });
  // Any signed-in account may start a match; the server decides what each one may change.
  const manage = true;
  const s = session.data;
  // Shared mode only: commands need the organizer token of this tab.
  const locked = !!sharedApi && !sharedApi.hasToken();
  const resume = s && {
    to: s.match ? `/partite/${s.match.id}` : tournamentPath(s.tournament),
    detail: [
      s.tournament.name,
      s.current
        ? `${s.current.player} al tiro, turno ${s.current.turn}/${s.current.turns}`
        : s.next?.heat
          ? `manche ${s.next.heat.number}/${s.next.heat.of}: ${s.next.players.join(', ')}`
          : s.next && s.next.players.length <= 4
            ? `prossimo: ${s.next.players.join(' vs ')}`
            : s.next
              ? `${s.next.missing} punteggi da registrare`
              : `${gameOf(s.tournament).label} · conferma la fase per proseguire`,
    ].join(' · '),
  };
  return (
    <main className="home">
      <div className="home-hero" aria-hidden="true" />
      <div className="home-foot" aria-hidden="true" />
      <h1 className="visually-hidden">Bite the Trouble — Not perfect, just real</h1>
      <div className="htools">
        <Link to="/impostazioni" aria-label="Impostazioni e backup">
          <Settings />
        </Link>
        {sharedApi && (
          <Link className={`access-pill ${locked ? 'locked' : ''}`} to="/impostazioni">
            <span aria-hidden="true" />
            {locked ? 'Accesso richiesto' : 'Organizzatore'}
          </Link>
        )}
        <span className="htools-end">
          <Link to="/regole" aria-label="Regole del totem">
            <BookText />
          </Link>
          <Link to="/serate" aria-label="Game Night">
            <CalendarDays />
          </Link>
          {localData && (
            <Link to="/compagnie" aria-label="Compagnie">
              <Users />
            </Link>
          )}
          {localData && (
            <Link to="/punti" aria-label="Punti di incontro">
              <MapPin />
            </Link>
          )}
        </span>
      </div>
      <div className="home-body">
        {resume && (
          <Link className="resume" to={resume.to}>
            <i aria-hidden="true" />
            <span>
              <small>IN CORSO · RIPRENDI</small>
              <span>{resume.detail}</span>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
        <nav className="hcards" aria-label="Azioni principali">
          {manage ? (
            <>
              <Link className="hcard primary" to="/partite/nuova">
                <Crosshair aria-hidden="true" />
                <span>
                  <strong>NUOVA PARTITA</strong>
                  <small>8 giochi · fino a 4 al totem</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
              <Link className="hcard" to="/tornei/nuovo">
                <Trophy aria-hidden="true" strokeWidth={1.5} />
                <span>
                  <strong>NUOVO TORNEO</strong>
                  <small>Hi-Score, gironi o partita singola</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <Link className="hcard primary" to="/tornei">
                <Trophy aria-hidden="true" />
                <span>
                  <strong>TORNEI</strong>
                  <small>In corso, classifiche e risultati</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
              <Link className="hcard" to="/giocatori">
                <Users aria-hidden="true" strokeWidth={1.5} />
                <span>
                  <strong>GIOCATORI</strong>
                  <small>Livelli, record e statistiche</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </>
          )}
          <Link className="hcard" to="/hiscore">
            <ChartNoAxesColumnIncreasing aria-hidden="true" strokeWidth={1.5} />
            <span>
              <strong>HI-SCORE NIGHTS</strong>
              <small>Qualifica + finale dei migliori</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </nav>
        {locked && (
          <Link className="alert" to="/impostazioni">
            <Lock aria-hidden="true" />
            <span>
              <b>Accesso organizzatore</b>
              <small>Inserisci il token per creare partite e registrare punteggi</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
        <WhoAmICard />
        <CrewOnboarding />
        {backup.data?.backupRecommended && (
          <Link className="alert" to="/impostazioni#backup">
            <HardDriveDownload aria-hidden="true" />
            <span>
              <b>Backup consigliato</b>
              <small>{backup.data.meta.changesSinceBackup} modifiche solo su questo telefono</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
        {!!recent.data?.length && (
          <section className="home-recent" aria-labelledby="recent-title">
            <div className="sec-h">
              <h2 id="recent-title">RISULTATI RECENTI</h2>
              <Link to="/tornei?filtro=done">Tutti</Link>
            </div>
            <ul className="hstrip">
              {recent.data.slice(0, 2).map(({ summary, winner }) => (
                <li key={summary.id}>
                  <Link to={resultsPath(summary)}>
                    <b>{summary.name}</b>
                    <small>{winner ? `Vince ${winner}` : 'Concluso'}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
