import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, Crosshair, Home, Trophy, Users } from 'lucide-react';
import { createGlassMap, glassGeometry, verifiedGlassRefraction } from './glass-map';
import '../styles/bottom-navigation.css';

export const navigationDestinations = [
  ['/', 'Home', Home],
  ['/partite/nuova', 'Partite', Crosshair],
  ['/tornei', 'Tornei', Trophy],
  ['/hiscore', 'Hi-Score', ChartNoAxesColumnIncreasing],
  ['/giocatori', 'Giocatori', Users],
] as const;
/** Sections of each destination: the pages opened from Home belong to Home. */
const sections = [
  ['/', '/regole', '/serate', '/impostazioni', '/gestione', '/permessi'],
  ['/partite'],
  ['/tornei'],
  ['/hiscore'],
  ['/giocatori', '/livelli'],
];
const normalizedPath = (path: string) => path.toLowerCase().replace(/\/+$/, '') || '/';
const sectionOf = (pathname: string) =>
  sections.findIndex((paths) =>
    paths.some((p) =>
      p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`),
    ),
  );

function clearPress(nav: HTMLElement | null) {
  nav?.classList.remove('pressed');
  nav?.querySelectorAll('.is-pressed').forEach((item) => item.classList.remove('is-pressed'));
}

/** Shared geometry for production links, the match bar and the isolated DEV comparison. */
export function NavigationSurface({
  current,
  count = navigationDestinations.length,
  children,
  className = '',
  label = 'Navigazione principale',
  material,
  satinOnly = false,
}: {
  current: number;
  count?: number;
  children: ReactNode;
  className?: string;
  label?: string;
  /** DEV calibration; production uses the shared geometry and CSS tokens. */
  material?: { band: number; displacement: number; style: CSSProperties };
  satinOnly?: boolean;
}) {
  const navRef = useRef<HTMLElement>(null);
  const id = `bt-glass-${useId().replace(/:/g, '')}`;
  const [map, setMap] = useState<{ href: string; width: number; height: number } | null>(null);
  const band = material?.band ?? glassGeometry.band;
  const displacement = material?.displacement ?? glassGeometry.displacement;
  const refraction = !satinOnly && verifiedGlassRefraction();
  useLayoutEffect(() => {
    if (!refraction || !navRef.current) return;
    const nav = navRef.current;
    let last = '';
    const update = () => {
      const width = nav.offsetWidth;
      const height = nav.offsetHeight;
      if (!width || !height) return;
      const radius = Math.min(parseFloat(getComputedStyle(nav).borderTopLeftRadius), height / 2);
      const key = `${width}/${height}/${radius}/${band}`;
      if (last === key) return;
      last = key;
      const href = createGlassMap(width, height, radius, band);
      if (href) setMap({ href, width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [refraction, band]);
  // Interaction is transient. Selection is always derived from current/route.
  const activePointer = useRef<number | null>(null);
  const release = () => {
    activePointer.current = null;
    clearPress(navRef.current);
  };
  useEffect(() => {
    const reset = () => {
      activePointer.current = null;
      clearPress(navRef.current);
    };
    const endPointer = (event: globalThis.PointerEvent) => {
      if (event.pointerId === activePointer.current) reset();
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
    window.addEventListener('blur', reset);
    window.addEventListener('pagehide', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('pointerup', endPointer);
      window.removeEventListener('pointercancel', endPointer);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pagehide', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);
  useLayoutEffect(() => {
    activePointer.current = null;
    clearPress(navRef.current);
  }, [current]);

  const follow = (nav: HTMLElement, e: PointerEvent) => {
    const rect = nav.getBoundingClientRect();
    const percent = (n: number, size: number) =>
      `${Math.max(0, Math.min(100, (n / size) * 100)).toFixed(1)}%`;
    nav.style.setProperty('--px', percent(e.clientX - rect.left, rect.width));
    nav.style.setProperty('--py', percent(e.clientY - rect.top, rect.height));
  };

  return (
    <nav
      ref={navRef}
      className={`bt-navigation ${className}`}
      aria-label={label}
      data-refraction={refraction && map ? true : undefined}
      style={
        {
          '--nav-index': Math.max(current, 0),
          '--nav-count': count,
          '--nav-filter': `url("#${id}")`,
          ...material?.style,
        } as CSSProperties
      }
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        const item = (e.target as Element).closest('.bt-nav-item');
        if (!item || item.matches(':disabled, [aria-disabled="true"]')) return;
        release();
        activePointer.current = e.pointerId;
        e.currentTarget.classList.add('pressed');
        item.classList.add('is-pressed');
        follow(e.currentTarget, e);
      }}
      onPointerMove={(e) => {
        if (activePointer.current === e.pointerId) follow(e.currentTarget, e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onLostPointerCapture={release}
      onClickCapture={release}
    >
      {refraction && map && (
        <svg width="0" height="0" className="bt-glass-filters" aria-hidden="true" focusable="false">
          <defs>
            <filter
              id={id}
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={map.width}
              height={map.height}
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={map.href}
                x="0"
                y="0"
                width={map.width}
                height={map.height}
                result="map"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={2 * displacement}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      )}
      <span className="bt-nav-lens" aria-hidden="true" />
      <span className="bt-nav-tint" aria-hidden="true" />
      {current >= 0 && (
        <span className="bt-nav-selection" aria-hidden="true">
          <span className="bt-nav-blob" />
        </span>
      )}
      {children}
    </nav>
  );
}

export function BottomNavigation() {
  const { pathname } = useLocation();
  const path = normalizedPath(pathname);
  const current = sectionOf(path);
  return (
    <>
      <div className="nav-scrim" aria-hidden="true" />
      <NavigationSurface current={current} className="bottom-nav">
        {navigationDestinations.map(([url, name, Icon], i) => (
          <Link
            className="bt-nav-item"
            key={url}
            to={url}
            // The destination itself, or a page inside its section.
            aria-current={i !== current ? undefined : path === url ? 'page' : 'location'}
            onClick={() => navigator.vibrate?.(8)}
          >
            <Icon aria-hidden="true" strokeWidth={Icon === ChartNoAxesColumnIncreasing ? 2.4 : 2} />
            <span>{name}</span>
          </Link>
        ))}
      </NavigationSurface>
    </>
  );
}
