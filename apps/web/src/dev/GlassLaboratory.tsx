import { useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { NavigationSurface, navigationDestinations } from '../components/BottomNavigation';
import { glassGeometry, verifiedGlassRefraction } from '../components/glass-map';
import {
  NavigationSurface as InitialSurface,
  GlassFilters as InitialFilters,
} from './InitialNavigationSurface';
import '../styles/tokens.css';
import './glass-laboratory.css';

const controls = [
  ['blur', 'Satinatura', 0, 30, 1, 'px', 'Raggio di sfocatura del contenuto reale.'],
  ['tint', 'Tinta', 0, 0.8, 0.01, 'α', 'Opacità della tinta neutra scura, indipendente dal blur.'],
  ['saturation', 'Saturazione', 100, 200, 5, '%', 'Intensità cromatica del backdrop.'],
  [
    'band',
    'Zona curva',
    2,
    24,
    1,
    'px',
    'Distanza interna dal perimetro interessata dalla curvatura.',
  ],
  [
    'displacement',
    'Spostamento massimo',
    0,
    10,
    0.5,
    'px',
    'Picco dello spostamento lungo la normale alla capsula.',
  ],
  ['reflection', 'Riflessi', 0, 0.5, 0.01, 'α', 'Intensità delle due luci localizzate.'],
  ['shadow', 'Ombra', 0, 0.6, 0.01, 'α', 'Opacità dell’ombra di separazione.'],
] as const;
// Read the production tokens so the laboratory never silently ships a stale preset.
const token = (name: string) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const defaults = {
  blur: token('--bt-nav-blur'),
  tint: token('--bt-nav-tint-alpha'),
  saturation: token('--bt-nav-saturation'),
  ...glassGeometry,
  reflection: token('--bt-nav-reflection'),
  shadow: token('--bt-nav-shadow'),
};
const variants = [
  [
    'current',
    'A · Materiale iniziale',
    'Snapshot delle modifiche locali prima di questo intervento.',
  ],
  ['cable', 'B · Riferimento Cable', 'Materiale scuro: blur 30 px, saturazione 185%, tinta 51,4%.'],
  [
    'proposal',
    'C · Satinato geometrico',
    'Centro stabile, curvatura al perimetro e luci localizzate.',
  ],
] as const;

function GlassLaboratory() {
  const [current, setCurrent] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [satinOnly, setSatinOnly] = useState(false);
  const [light, setLight] = useState(false);
  const [still, setStill] = useState(false);
  const [scene, setScene] = useState('cards');
  const [values, setValues] = useState(defaults);
  const style = {
    '--bt-nav-blur': `${values.blur}px`,
    '--bt-nav-tint-alpha': values.tint,
    '--bt-nav-saturation': `${values.saturation}%`,
    '--bt-nav-reflection': values.reflection,
    '--bt-nav-shadow': values.shadow,
  } as CSSProperties;
  return (
    <main className="glass-lab" data-fallback={fallback} data-still={still}>
      <header>
        <p>BT DARTS · SOLO SVILUPPO</p>
        <h1>Glass Laboratory</h1>
        <p>Tre materiali sullo stesso contenuto reale. Scorrimento e selezione sincronizzati.</p>
        <p>
          Rifrazione C:{' '}
          {verifiedGlassRefraction() && !satinOnly
            ? 'abilitata su Chromium desktop 156 verificato'
            : 'fallback CSS satinato'}
          . Questo modello web non replica lo shader Apple.
        </p>
        <div className="lab-controls">
          <label>
            <input
              type="checkbox"
              checked={fallback}
              onChange={(e) => setFallback(e.target.checked)}
            />
            Forza fallback opaco
          </label>
          <label>
            <input
              type="checkbox"
              checked={satinOnly}
              onChange={(e) => setSatinOnly(e.target.checked)}
            />
            Solo satinatura
          </label>
          <label>
            <input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} />
            Contenuto chiaro
          </label>
          <label>
            <input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} />
            Riduci movimento
          </label>
          <label>
            Scena
            <select aria-label="Scena" value={scene} onChange={(e) => setScene(e.target.value)}>
              <option value="cards">Carte colorate</option>
              <option value="grid">Griglia</option>
              <option value="text">Testo</option>
              <option value="photo">Fotografia</option>
            </select>
          </label>
        </div>
        <details>
          <summary>Calibrazione della proposta C · parametri del nostro modello</summary>
          <div className="lab-sliders">
            {controls.map(([key, name, min, max, step, unit, help]) => (
              <label key={key}>
                {name}{' '}
                <output>
                  {values[key]} {unit}
                </output>
                <input
                  type="range"
                  aria-label={name}
                  min={min}
                  max={max}
                  step={step}
                  value={values[key]}
                  onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
                />
                <small>{help}</small>
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setValues(defaults)}>
            Ripristina parametri
          </button>
          <p>
            Per isolare la rifrazione: griglia, satinatura 0 px, tinta 0, riflessi 0. Confronta
            «Solo satinatura»; il centro rimane stabile. Il preset legge i token della navbar reale.
          </p>
        </details>
      </header>
      <InitialFilters />
      <div className="lab-comparison">
        {variants.map(([variant, title, description]) => {
          const Surface = variant === 'current' ? InitialSurface : NavigationSurface;
          return (
            <section className={`lab-variant lab-${variant}`} key={variant}>
              <h2>{title}</h2>
              <p>{description}</p>
              <div className="lab-viewport" data-light={light} data-scene={scene}>
                <div
                  className="lab-scene"
                  tabIndex={0}
                  aria-label={`Contenuto scorrevole ${title}`}
                  onScroll={(e) => {
                    const top = e.currentTarget.scrollTop;
                    document.querySelectorAll<HTMLElement>('.lab-scene').forEach((el) => {
                      if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
                    });
                  }}
                >
                  <h3>La serata, a colpo d’occhio.</h3>
                  <p>Partite · Tornei · Giocatori</p>
                  {Array.from({ length: 8 }, (_, i) => (
                    <article key={i}>
                      {scene === 'photo' && (
                        <img src="/assets/bt-footer.jpg" alt="Fotografia BT Darts" />
                      )}
                      <span>ROUND {String(i + 1).padStart(2, '0')}</span>
                      <h3>
                        {['Torneo del venerdì', 'Un nuovo record', 'La prossima sfida'][i % 3]}
                      </h3>
                      <p>
                        Ada · Bruno · Carla — 180 punti. Il contenuto scorre sotto il materiale.
                      </p>
                    </article>
                  ))}
                </div>
                <Surface
                  current={current}
                  label={title}
                  {...(variant === 'current'
                    ? {}
                    : {
                        satinOnly: satinOnly || variant === 'cable',
                        material: { ...values, style },
                      })}
                >
                  {navigationDestinations.map(([url, name, Icon], i) => (
                    <button
                      type="button"
                      className="bt-nav-item"
                      key={url}
                      aria-pressed={i === current}
                      onClick={() => setCurrent(i)}
                    >
                      <Icon aria-hidden="true" strokeWidth={2} />
                      <span>{name}</span>
                    </button>
                  ))}
                </Surface>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<GlassLaboratory />);
