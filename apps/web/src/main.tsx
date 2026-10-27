import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BottomNavigation, Empty, scrollToTop } from './components/ui';
import { AppStatus } from './components/AppStatus';
import { cloudApi, dataMode, localData } from './services/api';
import { session, useAccount } from './services/cloud';
import { useCanManage } from './services/me';
import { registerPwa } from './services/pwa';
import { Home } from './features/Home';
import { Setup } from './features/Setup';
import { MatchScreen } from './features/Match';
import { Settings } from './features/Settings';
import { Players } from './features/Players';
import { TournamentList } from './features/Tournaments';
import { TournamentSetup } from './features/TournamentSetup';
import { TournamentDetail } from './features/TournamentDetail';
import { Events } from './features/Events';
import { Rules } from './features/Rules';
import { CrewDetail, Crews } from './features/Crews';
import { Login } from './features/Login';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/setup.css';
import './styles/match.css';
import './styles/competitions.css';
import './styles/people.css';
import './styles/progression.css';

// Standalone reads and writes never touch the network: they must run while offline too.
const networkMode = dataMode === 'standalone' ? 'always' : 'online';
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 2000, networkMode },
    mutations: { retry: false, networkMode },
  },
});
/** Cloud mode: every screen needs a signed-in account; the session is checked once at start. */
function Gate({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const queries = useQueryClient();
  useEffect(() => {
    // Unreachable server: the sign-in screen shows the error and retries.
    void cloudApi?.refreshSession().catch(() => session.set(null));
  }, []);
  // Signing out or in shows another account's data: nothing cached is kept.
  useEffect(() => () => queries.clear(), [account?.id, queries]);
  if (!cloudApi) return <>{children}</>;
  if (account === undefined)
    return (
      <main className="not-found">
        <p className="loading" role="status">
          Caricamento…
        </p>
      </main>
    );
  return account ? <>{children}</> : <Login />;
}
/** Creating games is for admins in cloud mode; others see why instead of a form they cannot send. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  if (useCanManage()) return <>{children}</>;
  return (
    <main className="not-found">
      <Empty title="Solo per gli admin">
        <p className="hint">Partite e tornei li crea un admin; tu li segui in diretta.</p>
        <Link to="/tornei">Vai ai tornei</Link>
      </Empty>
    </main>
  );
}
function App() {
  const { pathname, search } = useLocation();
  // Match screens and the steps of a flow stay full-screen; choosing the game keeps the bar.
  const hideNav =
    (pathname.startsWith('/partite/') && pathname !== '/partite/nuova') ||
    pathname === '/tornei/nuovo' ||
    (pathname === '/partite/nuova' && new URLSearchParams(search).has('passo'));
  const queries = useQueryClient();
  useEffect(() => {
    scrollToTop();
  }, [pathname]);
  // Commands update the screens through invalidation; other tabs and imports notify here.
  useEffect(
    () =>
      localData?.subscribe((event) => {
        if (event.type !== 'changed') return;
        if (event.origin !== 'local') void queries.invalidateQueries();
        else
          for (const key of [
            'session',
            'recent-results',
            'local-status',
            'progression',
            'links',
            'crews',
            'crew-progression',
            'crew-tournaments',
          ])
            void queries.invalidateQueries({ queryKey: [key] });
      }),
    [queries],
  );
  return (
    <div className={`app-shell ${hideNav ? 'without-nav' : 'with-nav'}`}>
      <a href="#main-content" className="skip-link">
        Vai al contenuto
      </a>
      <AppStatus />
      <div id="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/partite/nuova"
            element={
              <AdminOnly>
                <Setup />
              </AdminOnly>
            }
          />
          <Route path="/partite/:gameId" element={<MatchScreen />} />
          <Route path="/tornei" element={<TournamentList />} />
          <Route
            path="/tornei/nuovo"
            element={
              <AdminOnly>
                <TournamentSetup />
              </AdminOnly>
            }
          />
          <Route path="/tornei/:id" element={<TournamentDetail />} />
          <Route path="/hiscore" element={<TournamentList highscore />} />
          <Route path="/hiscore/:id" element={<TournamentDetail />} />
          <Route path="/serate" element={<Events />} />
          <Route path="/regole" element={<Rules />} />
          <Route path="/giocatori" element={<Players />} />
          <Route path="/compagnie" element={<Crews />} />
          <Route path="/compagnie/:id" element={<CrewDetail />} />
          <Route path="/impostazioni" element={<Settings />} />
          <Route
            path="*"
            element={
              <main className="not-found">
                <Empty title="Pagina non trovata">
                  <Link to="/">Torna alla Home</Link>
                </Empty>
              </main>
            }
          />
        </Routes>
      </div>
      {!hideNav && <BottomNavigation />}
    </div>
  );
}
registerPwa();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Gate>
          <App />
        </Gate>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
