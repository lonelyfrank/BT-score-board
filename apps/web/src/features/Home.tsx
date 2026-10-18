import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings,
  ChartNoAxesColumnIncreasing,
  Trophy,
  ChevronRight,
  HardDriveDownload,
  Lock,
} from 'lucide-react';
import { CheersIcon, CrossedDarts, CrowdIcon } from '../components/BrandIcons';
import { api, localData, sharedApi } from '../services/api';
import { activeSession, recentResults, resultsPath, tournamentPath } from '../services/session';

export function Home() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const recent = useQuery({ queryKey: ['recent-results'], queryFn: () => recentResults(api) });
  const backup = useQuery({
    queryKey: ['local-status'],
    queryFn: () => localData!.status(),
    enabled: !!localData,
  });
  const s = session.data;
  // Shared mode only: commands need the organizer token of this tab.
  const locked = !!sharedApi && !sharedApi.hasToken();
  const resume = s && {
    to: s.match ? `/partite/${s.match.id}` : tournamentPath(s.tournament),
    detail: [
      s.tournament.name,
      s.current
        ? `${s.current.player} al tiro · turno ${s.current.turn} di ${s.current.turns}`
        : s.match
          ? 'prossimo incontro pronto'
          : 'conferma la fase per proseguire',
    ].join(' · '),
  };
  return (
    <div className="home-page">
      <div className="home-hero" aria-hidden="true" />
      <div className="home-footer" aria-hidden="true" />
      <h1 className="visually-hidden">Bite Trouble — Not perfect, just real</h1>
      <div className="home-tools">
        <Link className="icon-button" to="/impostazioni" aria-label="Impostazioni e accesso">
          <Settings />
        </Link>
        {sharedApi && (
          <Link className={`access-pill ${locked ? 'locked' : ''}`} to="/impostazioni">
            <span aria-hidden="true" />
            {locked ? 'Accesso richiesto' : 'Organizzatore'}
          </Link>
        )}
        <Link className="icon-button" to="/hiscore" aria-label="Classifiche Hi-Score">
          <ChartNoAxesColumnIncreasing strokeWidth={2.4} />
        </Link>
      </div>
      <div className="home-actions">
        {resume && (
          <Link className="home-resume" to={resume.to}>
            <span className="live-dot" aria-hidden="true" />
            <span>
              <small>IN CORSO · RIPRENDI</small>
              <span>{resume.detail}</span>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
        <nav aria-label="Azioni principali">
          <Link className="home-card primary" to="/partite/nuova">
            <CrossedDarts />
            <span>
              <strong>NUOVA PARTITA</strong>
              <small>Hi-Score · 2–4 giocatori</small>
            </span>
            <ChevronRight />
          </Link>
          <Link className="home-card" to="/tornei/nuovo">
            <Trophy strokeWidth={1.5} />
            <span>
              <strong>NUOVO TORNEO</strong>
              <small>Gironi + eliminazione diretta</small>
            </span>
            <ChevronRight />
          </Link>
          <Link className="home-card" to="/hiscore">
            <CrowdIcon />
            <span>
              <strong>HI-SCORE NIGHTS</strong>
              <small>Qualifica + finale unica</small>
            </span>
            <ChevronRight />
          </Link>
          <Link className="home-card" to="/serate">
            <CheersIcon />
            <span>
              <strong>GAME NIGHT</strong>
              <small>Una serata, più tornei</small>
            </span>
            <ChevronRight />
          </Link>
        </nav>
        {locked && (
          <Link className="home-locked" to="/impostazioni">
            <Lock aria-hidden="true" />
            <span>Inserisci il token organizzatore per creare partite e registrare punteggi.</span>
          </Link>
        )}
      </div>
      {(backup.data?.backupRecommended || !!recent.data?.length) && (
        <section className="home-extra" aria-label="Risultati e dati">
          {backup.data?.backupRecommended && (
            <Link className="home-backup" to="/impostazioni#backup">
              <HardDriveDownload aria-hidden="true" />
              <span>
                <strong>Backup consigliato</strong>
                <small>
                  {backup.data.meta.changesSinceBackup} modifiche non salvate fuori dal telefono
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
          {!!recent.data?.length && (
            <>
              <h2>Risultati recenti</h2>
              <ul className="home-results">
                {recent.data.map(({ summary, winner }) => (
                  <li key={summary.id}>
                    <Link to={resultsPath(summary)}>
                      <span>{summary.name}</span>
                      <small>{winner ? `Vince ${winner}` : 'Concluso'}</small>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link className="home-all" to="/tornei">
                Tutti i tornei
              </Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}
