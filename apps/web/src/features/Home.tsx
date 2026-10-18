import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, ChartNoAxesColumnIncreasing, Trophy, ChevronRight } from 'lucide-react';
import { CheersIcon, CrossedDarts, CrowdIcon } from '../components/BrandIcons';
import { Modal } from '../components/ui';

export function Home() {
  const [notice, setNotice] = useState(false);
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
        <Link className="home-card primary" to="/partite/nuova">
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
