import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Settings,
  ChartNoAxesColumnIncreasing,
  Crosshair,
  Trophy,
  Users,
  Beer,
  ChevronRight,
} from 'lucide-react';
import { CrossedDarts } from '../components/BrandIcons';
import { Modal } from '../components/ui';

export function Home() {
  const [notice, setNotice] = useState(false);
  return (
    <div className="home-page">
      <div
        className="home-hero"
        role="img"
        aria-label="Bite Trouble — Not perfect, just real. Un pub, un bersaglio, la nostra serata."
      />
      <div className="home-tools">
        <Link className="icon-button" to="/impostazioni" aria-label="Impostazioni">
          <Settings />
        </Link>
        <Link className="icon-button" to="/hiscore" aria-label="Hi-Score Nights">
          <ChartNoAxesColumnIncreasing />
        </Link>
      </div>
      <div className="home-actions">
        <Link className="home-card primary" to="/partite/nuova">
          <CrossedDarts />
          <div>
            <h2>NUOVA PARTITA</h2>
            <p>Gioca ora sul bersaglio</p>
          </div>
          <ChevronRight />
        </Link>
        <Link className="home-card" to="/tornei/nuovo">
          <Trophy />
          <div>
            <h2>NUOVO TORNEO</h2>
            <p>Organizza una competizione</p>
          </div>
          <ChevronRight />
        </Link>
        <Link className="home-card" to="/hiscore">
          <Users />
          <div>
            <h2>HI-SCORE NIGHTS</h2>
            <p>Qualifica + Finale</p>
          </div>
          <ChevronRight />
        </Link>
        <button className="home-card" onClick={() => setNotice(true)}>
          <Beer />
          <div>
            <h2>GAME NIGHT</h2>
            <p>Una serata, più partite</p>
          </div>
          <ChevronRight />
        </button>
      </div>
      <div className="home-footer" role="img" aria-label="Good darts, good friends" />
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
