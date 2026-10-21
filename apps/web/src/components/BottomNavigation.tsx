import type { CSSProperties, ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router-dom';
import { ChartNoAxesColumnIncreasing, Home, Trophy, Users } from 'lucide-react';
import { DartIcon } from './BrandIcons';
import '../styles/bottom-navigation.css';

export const navigationDestinations = [
  ['/', 'Home', Home],
  ['/partite/nuova', 'Partite', DartIcon],
  ['/tornei', 'Tornei', Trophy],
  ['/hiscore', 'Hi-Score', ChartNoAxesColumnIncreasing],
  ['/giocatori', 'Giocatori', Users],
] as const;

/** Shared geometry for production links and the isolated DEV comparison. */
export function NavigationSurface({
  current,
  children,
  className = '',
  label = 'Navigazione principale',
}: {
  current: number;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <nav
      className={`bt-navigation ${className}`}
      aria-label={label}
      style={{ '--nav-index': Math.max(current, 0) } as CSSProperties}
    >
      {current >= 0 && <span className="bt-nav-selection" aria-hidden="true" />}
      {children}
    </nav>
  );
}

export function BottomNavigation() {
  const { pathname } = useLocation();
  const current = navigationDestinations.findIndex(([path]) =>
    matchPath({ path, end: path === '/' }, pathname),
  );
  return (
    <>
      <div className="nav-scrim" aria-hidden="true" />
      <NavigationSurface current={current} className="bottom-nav">
        {navigationDestinations.map(([url, name, Icon]) => (
          <NavLink
            className="bt-nav-item"
            key={url}
            to={url}
            end={url === '/'}
            onClick={() => navigator.vibrate?.(8)}
          >
            <Icon aria-hidden="true" strokeWidth={1.8} />
            <span>{name}</span>
          </NavLink>
        ))}
      </NavigationSurface>
    </>
  );
}
