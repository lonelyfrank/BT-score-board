import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BottomNavigation, Empty } from './components/ui';
import { Home } from './features/Home';
import { Setup } from './features/Setup';
import { Live } from './features/Live';
import { Settings } from './features/Settings';
import { Players } from './features/Players';
import { TournamentDetail, TournamentList } from './features/Tournaments';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 2000 }, mutations: { retry: false } },
});
function App() {
  const { pathname } = useLocation();
  const hideNav = pathname.startsWith('/partite/');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className={`app-shell ${hideNav ? 'without-nav' : 'with-nav'}`}>
      <a href="#main-content" className="skip-link">
        Vai al contenuto
      </a>
      <div id="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/partite/nuova" element={<Setup />} />
          <Route path="/partite/:gameId" element={<Live />} />
          <Route path="/tornei" element={<TournamentList />} />
          <Route path="/tornei/nuovo" element={<Setup tournament />} />
          <Route path="/tornei/:id" element={<TournamentDetail />} />
          <Route path="/hiscore" element={<TournamentList highscore />} />
          <Route path="/hiscore/:id" element={<TournamentDetail highscore />} />
          <Route path="/giocatori" element={<Players />} />
          <Route path="/impostazioni" element={<Settings />} />
          <Route
            path="*"
            element={
              <Empty title="Pagina non trovata">
                <Link to="/">Torna alla Home</Link>
              </Empty>
            }
          />
        </Routes>
      </div>
      {!hideNav && <BottomNavigation />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
