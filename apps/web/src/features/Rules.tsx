import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Header, Tabs } from '../components/ui';
import { gameModes, games, type GameMode } from '../services/rules';

/** The original panel of the Pub Time Darts totem, transcribed: instructions, lights, board. */
const steps = [
  'Inserisci i gettoni nelle fessure dello sportello e scegli il gioco con il pulsante di sinistra (selezione del gioco). I giochi n° 2 e n° 3 valgono 2 gettoni per giocatore, tutti gli altri 1 solo gettone per giocatore.',
  'Premi il pulsante di destra (inizio del gioco) tante volte quanti sono i giocatori. I crediti non usati restano in memoria per le partite successive.',
  'Ogni giocatore lancia 3 freccette per turno, da una distanza non superiore a 2,50 metri. Il punteggio parziale compare nel visore temporaneo e poi si somma a quello del giocatore.',
  'A fine round togli le freccette e premi «cambio giocatore». Il giocatore successivo lancia quando la luce verde «Lancia le freccette» lo abilita.',
];
const lights = [
  ['TOGLI LE FRECCETTE', 'Fine del turno', 'red'],
  ['LANCIA LE FRECCETTE', 'Tocca al prossimo', 'green'],
  ['VINCITORE', 'Partita conclusa', 'gold'],
  ['ECCESSO', 'Zero superato: turno perso', 'red'],
] as const;

type Rule = {
  short: string;
  tag: string;
  body: string[];
  boxes?: [string, string][];
};
/** The eight games in the order of the totem's selector (n° 1–8). */
const panel: Record<GameMode, Rule> = {
  '301': {
    short: '301',
    tag: 'Da 301 a zero · nessun limite di round',
    body: [
      'Il gioco inizia assegnando 301 punti a ogni giocatore e il punteggio si va sottraendo. Vince il giocatore che per primo arriva a zero punti esatti.',
      'Chi supera lo zero perde il turno e continua il gioco con il punteggio che aveva all’inizio di quel round. Non c’è limite di round.',
    ],
  },
  '301_DOUBLE_IN_OUT': {
    short: 'D.In/Out',
    tag: 'Come il 301 · apertura e chiusura in doppio',
    body: [
      'Come il 301, tranne all’inizio e alla fine, quando si contano soltanto i punteggi in doppio.',
    ],
  },
  '501': {
    short: '501',
    tag: 'Come il 301 · si parte da 501',
    body: ['Come il 301, tranne il punteggio, che parte da 501.'],
  },
  HI_SCORE: {
    short: 'Hi-Score',
    tag: '7 round · vince il punteggio più alto',
    body: [
      'Il gioco inizia con zero punti e finisce dopo 7 round. Vince chi ottiene il punteggio più alto.',
    ],
  },
  '301_MASTERS': {
    short: 'Masters',
    tag: 'Come il 301 · chiusura speciale',
    body: [
      'Come il 301, tranne che l’ultima freccetta (quella per arrivare a zero esatto) conta solo se va in doppio, triplo o centro.',
    ],
  },
  EXACTA: {
    short: 'Exacta',
    tag: '5 round · numero fantasma tra 250 e 350',
    body: [
      'Dopo aver premuto «inizio del gioco», il visore temporaneo mostra un numero fantasma tra 250 e 350. Vince il giocatore che dopo 5 round è più vicino al numero fantasma.',
    ],
    boxes: [
      [
        'OBBLIGATORIO',
        'In questo gioco si segna obbligatoriamente con 2 freccette; la terza si può lanciare oppure no.',
      ],
    ],
  },
  ODD_EVEN: {
    short: 'Odd&Even',
    tag: 'Dispari contro pari · vince chi arriva prima',
    body: [
      'I giocatori 1 e/o 3 devono segnare solo singoli (doppi, tripli e centro non contano) sui numeri dispari, partendo dall’1 e proseguendo in ordine (1 – 3 – 5 …) fino al 19.',
      'I giocatori 2 e/o 4 devono segnare sui pari, partendo dal 2 fino al 20. Vince chi arriva per primo alla propria meta.',
    ],
  },
  SHANGHAI: {
    short: 'Shanghai',
    tag: '7 round · numeri in ordine dall’1',
    body: [
      'Il giocatore deve segnare in ordine progressivo partendo dall’1 (1 – 2 – 3 – 4 …). Valgono singoli, doppi e tripli, non il centro. Per l’ordine doppi e tripli contano come singoli, ma moltiplicano il punteggio.',
      'Dopo 7 round vince il giocatore con il punteggio più alto.',
    ],
    boxes: [
      [
        'ESEMPIO',
        'Se devi segnare il 3, puoi fare doppio 3 e conti 6 punti. Se nello stesso tiro fai triplo 1, per l’ordine vale 1, quindi non conta nessun punto.',
      ],
      [
        'IMPORTANTE',
        'Se in un round segni le tre freccette in ordine progressivo, la prima in singolo, la seconda in doppio e la terza in triplo, vinci subito la partita.',
      ],
    ],
  },
};
/** Totem number of a game: its position on the selector. */
export const totemNumber = (mode: GameMode) => gameModes.indexOf(mode) + 1;

/** Regole del totem: how the totem works, then the rules of each of its eight games. */
export function Rules() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'giochi' ? 'giochi' : 'come';
  const chosen = gameModes.find((g) => g === params.get('gioco')) ?? 'SHANGHAI';
  const set = (next: Record<string, string>) =>
    setParams({ ...Object.fromEntries(params), ...next }, { replace: true });
  const rule = panel[chosen];
  return (
    <>
      <Header title="Regole del totem" subtitle="Pub Time Darts · pannello originale" />
      <div className="toolbar">
        <Tabs
          label="Regole"
          tabs={[
            { id: 'come', label: 'Come si gioca' },
            { id: 'giochi', label: 'Giochi' },
          ]}
          value={tab}
          change={(id) => set({ tab: id })}
        />
        {tab === 'giochi' && (
          <div className="rule-games" role="radiogroup" aria-label="Gioco">
            {gameModes.map((g) => (
              <button
                type="button"
                role="radio"
                key={g}
                aria-checked={g === chosen}
                aria-label={`${totemNumber(g)} · ${games[g].label}`}
                className="htab"
                onClick={() => set({ gioco: g })}
              >
                <strong>{totemNumber(g)}</strong>
                <small>{panel[g].short}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <main className="rules">
        {tab === 'come' ? (
          <>
            <h2 className="set-h">Istruzioni</h2>
            <ol className="rule-steps">
              {steps.map((text, i) => (
                <li key={i} className="card">
                  <span aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <h2 className="set-h">Spie del totem</h2>
            <ul className="lights">
              {lights.map(([name, text, tone]) => (
                <li key={name} className={tone}>
                  <b>{name}</b>
                  <small>{text}</small>
                </li>
              ))}
            </ul>
            <dl className="card">
              <div className="row">
                <dt className="k">CREDITO</dt>
                <dd className="v">gettoni ancora disponibili</dd>
              </div>
              <div className="row">
                <dt className="k">ROUND</dt>
                <dd className="v">round in corso</dd>
              </div>
              <div className="row">
                <dt className="k">COMPETITOR 1–8</dt>
                <dd className="v">giocatore al tiro</dd>
              </div>
            </dl>
            <h2 className="set-h">Bersaglio</h2>
            <dl className="card">
              {[
                ['Doppio', 'anello esterno'],
                ['Triplo', 'anello interno'],
                ['Centro', '50 punti'],
                ['Singolo', 'le due fasce larghe'],
              ].map(([k, v]) => (
                <div className="row" key={k}>
                  <dt className="v">{k}</dt>
                  <dd className="k">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <article className="card rule-card" aria-labelledby="rule-title">
            <header>
              <span aria-hidden="true">{totemNumber(chosen)}</span>
              <div>
                <h2 id="rule-title">
                  {chosen === '301_DOUBLE_IN_OUT'
                    ? '301 Double In / Double Out'
                    : games[chosen].label}
                </h2>
                <p className="hint">{rule.tag}</p>
              </div>
            </header>
            {rule.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {rule.boxes?.map(([k, v]) => (
              <div className="rule-box" key={k}>
                <b>{k}</b>
                <span>{v}</span>
              </div>
            ))}
          </article>
        )}
      </main>
      {tab === 'giochi' && (
        <div className="actionbar">
          <Link className="btn cta" to={`/partite/nuova?gioco=${chosen}`}>
            Gioca a {games[chosen].label} <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      )}
    </>
  );
}
