import { Fragment, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { navigationDestinations } from '../components/BottomNavigation';
import { glassMap } from './initial-glass-map';
import './initial-navigation.css';

/*
 * CSS.supports checks syntax, not SVG backdrop compositing: Safari (iOS Chrome included) and
 * Firefox accept url() and then drop the glass. The lens is enabled on Blink only; the others
 * keep the blurred glass with the same geometry.
 */
const refraction =
  typeof navigator !== 'undefined' &&
  /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) &&
  CSS.supports('backdrop-filter', 'url("#bt-initial-warp")');

const channels = [
  ['R', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['G', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['B', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
] as const;

/**
 * One lens per channel, slightly different scales: the colour fringes of the glass
 * (liquid-glass-react with aberrationIntensity 2: +10% per channel, blur 0.3).
 */
function Lens({ id, scale }: { id: string; scale: number }) {
  return (
    <filter id={id} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
      <feImage
        href={glassMap}
        x="0"
        y="0"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        result="map"
      />
      {channels.map(([channel, matrix], k) => (
        <Fragment key={channel}>
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={-scale * (1 + k * 0.1)}
            xChannelSelector="R"
            yChannelSelector="B"
            result={`d${channel}`}
          />
          <feColorMatrix in={`d${channel}`} type="matrix" values={matrix} result={channel} />
        </Fragment>
      ))}
      <feBlend in="G" in2="B" mode="screen" result="GB" />
      <feBlend in="R" in2="GB" mode="screen" result="RGB" />
      <feGaussianBlur in="RGB" stdDeviation="0.3" />
    </filter>
  );
}

/** SVG lens referenced by the bar's CSS. Render once per page, next to the bar. */
export function GlassFilters() {
  return (
    <svg width="0" height="0" className="bt-glass-filters" aria-hidden="true" focusable="false">
      <defs>
        <Lens id="bt-initial-warp" scale={16} />
      </defs>
    </svg>
  );
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shared geometry for production links, the match bar and the isolated DEV comparison. */
export function NavigationSurface({
  current,
  count = navigationDestinations.length,
  children,
  className = '',
  label = 'Navigazione principale',
}: {
  current: number;
  count?: number;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const blob = useRef<HTMLSpanElement>(null);
  const previous = useRef(current);
  // The capsule stretches a little while it glides to the new item, then settles.
  useLayoutEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    const el = blob.current;
    if (!el) return;
    el.classList.remove('moving');
    void el.offsetWidth;
    el.classList.add('moving');
  }, [current]);

  // Under the finger the bar follows elastically and its soft highlight tracks the touch.
  const follow = (nav: HTMLElement, e: PointerEvent) => {
    const r = nav.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    nav.style.setProperty('--px', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    if (still()) return;
    const elasticity = 0.15;
    const d = Math.hypot(dx, dy) || 1;
    const s = Math.min(d / 300, 1) * elasticity;
    const nx = Math.abs(dx / d);
    const ny = Math.abs(dy / d);
    const sx = Math.max(0.8, 1 + nx * s * 0.3 - ny * s * 0.15);
    const sy = Math.max(0.8, 1 + ny * s * 0.3 - nx * s * 0.15);
    nav.style.transform = `translate(${(dx * elasticity * 0.1).toFixed(2)}px,${(dy * elasticity * 0.1).toFixed(2)}px) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
  };
  const release = (e: PointerEvent<HTMLElement>) => {
    const nav = e.currentTarget;
    if (!nav.classList.contains('pressed')) return;
    nav.classList.remove('pressed');
    nav.style.transform = '';
    nav.querySelector('.is-pressed')?.classList.remove('is-pressed');
    blob.current?.classList.remove('bloom');
  };

  return (
    <nav
      className={`bt-navigation ${className}`}
      aria-label={label}
      data-refraction={refraction || undefined}
      style={{ '--nav-index': Math.max(current, 0), '--nav-count': count } as CSSProperties}
      onPointerDown={(e) => {
        const item = (e.target as Element).closest('.bt-nav-item');
        if (!item) return;
        const nav = e.currentTarget;
        nav.classList.add('pressed');
        follow(nav, e);
        if (item.matches('[aria-current], [aria-pressed="true"]'))
          blob.current?.classList.add('bloom');
        else item.classList.add('is-pressed');
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.classList.contains('pressed')) follow(e.currentTarget, e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <span className="bt-nav-lens" aria-hidden="true" />
      <span className="bt-nav-tint" aria-hidden="true" />
      {current >= 0 && (
        <span className="bt-nav-selection" aria-hidden="true">
          <span ref={blob} className="bt-nav-blob" />
        </span>
      )}
      {children}
    </nav>
  );
}
