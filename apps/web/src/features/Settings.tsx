import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Header, ErrorMessage } from '../components/ui';

export function Settings() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [connected, setConnected] = useState(api.hasToken());
  const client = useQueryClient();
  return (
    <>
      <Header title="Impostazioni" />
      <main className="content">
        <section className="panel">
          <h2>Accesso organizzatore</h2>
          <p>
            Inserisci il token configurato sul server per gestire giocatori e punteggi. Rimane in
            questa scheda del browser.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              api.setToken(token.trim());
              try {
                await api.players();
                await client.cancelQueries();
                client.clear();
                setConnected(true);
                setToken('');
              } catch (err) {
                api.setToken('');
                setConnected(false);
                client.clear();
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Token organizzatore
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy || !token.trim()}>
              {busy ? 'Connessione…' : 'Collega applicativo'}
            </button>
          </form>
          <ErrorMessage error={error} />
          {connected && (
            <>
              <p className="success" role="status">
                Accesso organizzatore attivo
              </p>
              <Link to="/" className="button">
                Torna alla Home
              </Link>
              <button
                onClick={async () => {
                  await client.cancelQueries();
                  api.setToken('');
                  client.clear();
                  setConnected(false);
                }}
              >
                Disconnetti
              </button>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Modalità disponibili</h2>
          <p>
            Hi-Score, tornei a gironi, qualificazioni, spareggi e finali. Le modalità 301/501 e le
            squadre non sono ancora disponibili.
          </p>
        </section>
      </main>
    </>
  );
}
