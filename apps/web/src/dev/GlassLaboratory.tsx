import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NavigationSurface, navigationDestinations } from '../components/BottomNavigation';
import '../styles/tokens.css';
import './glass-laboratory.css';

const variants = [
  ['frosted', 'A · Frosted Minimal', 'Blur leggero, superficie più opaca, selezione piatta.'],
  ['optical', 'B · Optical Liquid', 'Bordo rifrattivo sperimentale; fallback frosted.'],
  [
    'native',
    'C · Native-inspired Floating',
    'Un solo materiale, selezione interna, movimento controllato.',
  ],
] as const;

function GlassLaboratory() {
  const [current, setCurrent] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [light, setLight] = useState(false);
  const [still, setStill] = useState(false);
  // CSS.supports checks syntax, not SVG backdrop compositing. Keep this experimental
  // enhancement on Blink only; Safari (including iOS Chrome) and Firefox stay frosted.
  const refraction =
    /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) &&
    CSS.supports('backdrop-filter', 'url("#lab-edge-refraction")');
  return (
    <main
      className="glass-lab"
      data-fallback={fallback}
      data-still={still}
      data-refraction={refraction}
    >
      <header>
        <p>BT DARTS · DEV ONLY</p>
        <h1>Glass Laboratory</h1>
        <p>Le tre anteprime condividono la selezione. Scorri i contenuti dietro ogni barra.</p>
        <div className="lab-controls">
          <label>
            <input
              type="checkbox"
              checked={fallback}
              onChange={(e) => setFallback(e.target.checked)}
            />{' '}
            Forza fallback opaco
          </label>
          <label>
            <input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} />{' '}
            Contenuto chiaro
          </label>
          <label>
            <input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} />{' '}
            Riduci movimento
          </label>
        </div>
      </header>
      {/* Static, small displacement; never applied to icons/text or shipped in the app. */}
      <svg width="0" height="0" aria-hidden="true" className="lab-filter-defs">
        <defs>
          <filter
            id="lab-edge-refraction"
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.08"
              numOctaves="1"
              seed="4"
              result="edge-map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="edge-map"
              scale="3"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div className="lab-comparison">
        {variants.map(([variant, title, description]) => (
          <section className={`lab-variant lab-${variant}`} key={variant}>
            <h2>{title}</h2>
            <p>{description}</p>
            <div className="lab-viewport" data-light={light}>
              <div className="lab-scene" tabIndex={0} aria-label={`Contenuto scorrevole ${title}`}>
                <h3>La serata, a colpo d’occhio.</h3>
                <p>Partite · Tornei · Giocatori</p>
                {Array.from({ length: 8 }, (_, i) => (
                  <article key={i}>
                    <span>ROUND {String(i + 1).padStart(2, '0')}</span>
                    <h3>{['Torneo del venerdì', 'Un nuovo record', 'La prossima sfida'][i % 3]}</h3>
                    <p>Ada · Bruno · Carla</p>
                  </article>
                ))}
              </div>
              <NavigationSurface current={current} label={title}>
                {navigationDestinations.map(([url, name, Icon], i) => (
                  <button
                    type="button"
                    className="bt-nav-item"
                    key={url}
                    aria-pressed={i === current}
                    onClick={() => setCurrent(i)}
                  >
                    <Icon aria-hidden="true" strokeWidth={1.8} />
                    <span>{name}</span>
                  </button>
                ))}
              </NavigationSurface>
            </div>
          </section>
        ))}
      </div>
      <p>
        Rifrazione B: esperimento SVG sul solo bordo, senza animazione continua. Il supporto
        sintattico CSS non garantisce il rendering: confrontare con il fallback nello stesso
        browser.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<GlassLaboratory />);
