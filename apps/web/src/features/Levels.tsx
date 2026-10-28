import { useState } from 'react';
import { levels, xpRules } from '../../../../packages/domain/src/index.js';
import { Header, Tabs } from '../components/ui';
import { useProgression } from '../components/Progression';
import { useMe } from '../services/me';
import '../styles/levels.css';

/** The name effect each level unlocks, as the profile shows it. */
const effectOf = (level: number) =>
  level >= 12
    ? 'legend'
    : level >= 11
      ? 'gold'
      : level >= 8
        ? 'glow'
        : level >= 5
          ? 'shine'
          : 'none';

const xpText = (n: number) => `${n.toLocaleString('it-IT')} XP`;

/** Livelli e XP: the ladder with the player's place on it, and how the XP are earned. */
export function Levels() {
  const [tab, setTab] = useState('ladder');
  const me = useMe();
  const progression = useProgression();
  const mine = me ? progression.data?.players.get(me) : undefined;
  const current = mine?.progress.level.level ?? 0;
  return (
    <>
      <Header
        title="Livelli e XP"
        subtitle={mine ? `Lv ${current} · ${xpText(mine.xp)}` : 'La scala dei livelli'}
        back="/giocatori"
        backLabel="Indietro ai giocatori"
      />
      <div className="toolbar">
        <Tabs
          label="Livelli"
          value={tab}
          change={setTab}
          tabs={[
            { id: 'ladder', label: 'Scala' },
            { id: 'xp', label: 'Come si sale' },
          ]}
        />
      </div>
      <main className="levels">
        {tab === 'ladder' ? (
          <ol className="list" aria-label="Scala dei livelli">
            {levels.map((l) => (
              <li
                key={l.level}
                className={`ladder ${l.level === current ? 'cur' : l.level < current ? 'done' : ''}`}
                aria-current={l.level === current ? 'true' : undefined}
              >
                <span className="n">{l.level}</span>
                <span>
                  <b className={`fx-name fx-${effectOf(l.level)}`} data-text={l.title}>
                    {l.title}
                  </b>
                  {l.level === current && <i className="me-tag">TU</i>}
                </span>
                <small>{xpText(l.xp)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <h2 className="set-h">Come si guadagnano</h2>
            <div className="card">
              {(
                [
                  ['Partita completata', xpRules.participation],
                  ['Vittoria', xpRules.win],
                  ['Torneo completato', xpRules.tournamentCompleted],
                  ['Torneo vinto', xpRules.tournamentWon],
                  ['Nuovo record personale', xpRules.personalBest],
                ] as const
              ).map(([label, xp]) => (
                <div className="row" key={label}>
                  <span className="v">{label}</span>
                  <span className="xpgain">+{xp} XP</span>
                </div>
              ))}
            </div>
            <p className="hint">
              Dopo {xpRules.dailyMatchCap} partite nello stesso giorno, partite e vittorie non danno
              più XP (contano comunque nelle statistiche). Il primo risultato in un gioco fissa il
              record personale, senza bonus.
            </p>
            <h2 className="set-h">Effetti sul nome</h2>
            <div className="card">
              {(
                [
                  ['shine', 'Brillante', 'dal livello 5'],
                  ['glow', 'Neon', 'dal livello 8'],
                  ['gold', 'Oro', 'livello 11'],
                  ['legend', 'Leggenda', 'livello 12'],
                  ['record', 'Detentore di record', 'chi ha un record'],
                ] as const
              ).map(([fx, label, when]) => (
                <div className="row" key={fx}>
                  <span className={`fx-name fx-${fx} fx-sample`} data-text={label}>
                    {label}
                  </span>
                  <span className="k">{when}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
