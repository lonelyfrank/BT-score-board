import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  HardDriveDownload,
  Lock,
  MapPin,
  NotepadText,
  Settings,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { api, cloudApi, localData, sharedApi } from '../services/api';
import { activeSession, recentResults, resultsPath, tournamentPath } from '../services/session';
import { gameOf } from '../services/rules';
import type { Summary } from '../services/game';
import { CrewOnboarding } from './Crews';
import { MeChip, WhoAmICard } from '../components/WhoAmI';

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** The glyph of a finished tournament's row: its format, not its decoration. */
function ResultIcon({ summary }: { summary: Summary }) {
  if (summary.mode === 'QUICK_HIGH_SCORE')
    return <ChartNoAxesColumnIncreasing aria-hidden="true" />;
  if (summary.mode === 'GROUPS') return <Users aria-hidden="true" />;
  return <Target aria-hidden="true" />;
}

export function Home() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => activeSession(api) });
  const recent = useQuery({ queryKey: ['recent-results'], queryFn: () => recentResults(api) });
  const backup = useQuery({
    queryKey: ['local-status'],
    queryFn: () => localData!.status(),
    // On the server the reminder is for the admins' copy, in the settings.
    enabled: !!localData && !cloudApi,
  });
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
      <div className="home-hero" aria-hidden="true">
        <img className="home-logo" src="/assets/bt-logo.png" alt="" width={960} height={497} />
      </div>
      <div className="home-foot" aria-hidden="true" />
      <h1 className="visually-hidden">Bite the Trouble — Not perfect, just real</h1>
      <div className="htools">
        <Link to="/impostazioni" aria-label="Impostazioni e backup">
          <Settings />
        </Link>
        <MeChip />
        {sharedApi && (
          <Link className={`access-pill ${locked ? 'locked' : ''}`} to="/impostazioni">
            <span aria-hidden="true" />
            {locked ? 'Accesso richiesto' : 'Organizzatore'}
          </Link>
        )}
        <span className="htools-end">
          <Link to="/regole" aria-label="Regole del totem">
            <NotepadText />
          </Link>
          <Link to="/serate" aria-label="Game Night">
            <CalendarDays />
          </Link>
          <Link to="/compagnia" aria-label="Compagnia: classifiche e record">
            <Users />
          </Link>
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
          <Link className="hcard-new" to="/partite/nuova">
            <span className="hchip">Partita rapida</span>
            <strong>NUOVA PARTITA</strong>
            <small>8 giochi · fino a 4 al totem</small>
            <img src="/assets/bt-home-dartboard.png" alt="" width={112} height={107} />
          </Link>
          <Link className="hcard-tile gold" to="/tornei/nuovo">
            <img src="/assets/bt-home-trophy.png" alt="" width={68} height={73} />
            <span className="hchip">Organizza</span>
            <strong>
              <span>NUOVO</span>
              <span>TORNEO</span>
            </strong>
            <small>
              <span>Hi-Score, gironi</span>
              <span>o partita singola</span>
            </small>
          </Link>
          <Link className="hcard-tile pink" to="/hiscore">
            <img src="/assets/bt-home-chart.png" alt="" width={62} height={70} />
            <span className="hchip">Sfida il pub</span>
            <strong>
              <span>HI-SCORE</span>
              <span>NIGHTS</span>
            </strong>
            <small>
              <span>Qualifica + finale</span>
              <span>dei migliori</span>
            </small>
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
        {!!recent.data?.length && (
          <section className="home-recent" aria-labelledby="recent-title">
            <div className="home-recent-h">
              <img src="/assets/bt-home-results.png" alt="" width={24} height={24} />
              <h2 id="recent-title">RISULTATI RECENTI</h2>
              <Link to="/tornei?filtro=done">
                Tutti <ChevronRight aria-hidden="true" />
              </Link>
            </div>
            <ul className="hrows">
              {recent.data
                .slice(0, backup.data?.backupRecommended ? 2 : 3)
                .map(({ summary, winner }) => (
                  <li key={summary.id}>
                    <Link className="hrow" to={resultsPath(summary)}>
                      <span className="hrow-icon">
                        <ResultIcon summary={summary} />
                      </span>
                      <span className="hrow-title">
                        <small>
                          {gameOf(summary).label} · {shortDate(summary.createdAt)}
                        </small>
                        <b>{summary.name}</b>
                      </span>
                      <span className="hrow-winner">
                        <Trophy aria-hidden="true" />
                        <span>
                          <small>{winner ? 'Vince' : 'Esito'}</small> <b>{winner ?? 'Concluso'}</b>
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        )}
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
      </div>
    </main>
  );
}
