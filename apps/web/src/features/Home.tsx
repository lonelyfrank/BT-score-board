import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Settings,
  ChartNoAxesColumnIncreasing,
  Trophy,
  ChevronRight,
  Play,
  HardDriveDownload,
} from 'lucide-react';
import { CheersIcon, CrossedDarts, CrowdIcon } from '../components/BrandIcons';
import { Modal } from '../components/ui';
import { api, localData } from '../services/api';
import { activeSession, recentResults, tournamentPath } from '../services/session';

export function Home() {
  const [notice, setNotice] = useState(false);
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const recent = useQuery({ queryKey: ['recent-results'], queryFn: () => recentResults(api) });
  const backup = useQuery({
    queryKey: ['local-status'],
    queryFn: () => localData!.status(),
    enabled: !!localData,
  });
  const s = session.data;
  return (
    <div className="home-page">
      <div className="home-hero" aria-hidden="true" />
      <div className="home-footer" aria-hidden="true" />
      <h1 className="visually-hidden">Bite Trouble — Not perfect, just real</h1>
      <div className="home-tools">
        <Link className="icon-button" to="/impostazioni" aria-label="Impostazioni">
          <Settings />
        </Link>
        <Link className="icon-button" to="/hiscore" aria-label="Statistiche e classifiche">
          <ChartNoAxesColumnIncreasing strokeWidth={2.4} />
        </Link>
      </div>
      <nav className="home-actions" aria-label="Azioni principali">
        {s && (
          <Link
            className="home-card primary resume"
            to={s.match ? `/partite/${s.match.id}` : tournamentPath(s.tournament)}
          >
            <Play fill="currentColor" />
            <span>
              <strong>
                {s.match?.status === 'active' ? 'RIPRENDI PARTITA' : 'RIPRENDI TORNEO'}
              </strong>
              <small>{s.tournament.name}</small>
              {s.current ? (
                <small className="resume-detail">
                  Al tiro {s.current.player} · Turno {s.current.turn} di {s.current.turns}
                </small>
              ) : (
                <small className="resume-detail">
                  {s.match ? 'Prossimo incontro pronto' : 'Conferma la fase per proseguire'}
                </small>
              )}
              {s.lastScore && (
                <small className="resume-detail">
                  Ultimo punteggio: {s.lastScore.player} {s.lastScore.score}
                </small>
              )}
            </span>
            <ChevronRight />
          </Link>
        )}
        <Link className={`home-card ${s ? '' : 'primary'}`} to="/partite/nuova">
          <CrossedDarts />
          <span>
            <strong>NUOVA PARTITA</strong>
            <small>Gioca ora sul bersaglio</small>
          </span>
          <ChevronRight />
        </Link>
        <Link className="home-card" to="/tornei/nuovo">
          <Trophy strokeWidth={1.5} />
          <span>
            <strong>NUOVO TORNEO</strong>
            <small>Organizza una competizione</small>
          </span>
          <ChevronRight />
        </Link>
        <Link className="home-card" to="/hiscore">
          <CrowdIcon />
          <span>
            <strong>HI-SCORE NIGHTS</strong>
            <small>Qualifica + Finale</small>
          </span>
          <ChevronRight />
        </Link>
        <button className="home-card" onClick={() => setNotice(true)}>
          <CheersIcon />
          <span>
            <strong>GAME NIGHT</strong>
            <small>Una serata, più partite</small>
          </span>
          <ChevronRight />
        </button>
      </nav>
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
                    <Link to={`${tournamentPath(summary)}?tab=final`}>
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
      {notice && (
        <Modal title="Game Night" close={() => setNotice(false)}>
          <p>
            La gestione di una serata con più partite sarà disponibile in un prossimo aggiornamento.
          </p>
          <Link className="primary button" to="/tornei/nuovo">
            Crea un torneo
          </Link>
        </Modal>
      )}
    </div>
  );
}
