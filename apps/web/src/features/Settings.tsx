import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { ApiError, appVersion, localData, sharedApi } from '../services/api';
import type { BackupFile, BackupSummary } from '../../../../packages/local-store/src/index.js';
import {
  canShareFiles,
  downloadFile,
  formatBytes,
  requestPersistence,
  shareFile,
  storageInfo,
} from '../services/device';
import { usePwa } from '../services/pwa';
import { Header, ErrorMessage, Modal } from '../components/ui';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('it-IT', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'mai';

export function Settings() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <>
      <Header title="Impostazioni" />
      <main className="content">
        {localData ? <DeviceData /> : <OrganizerAccess />}
        <AppSection />
        <section className="panel">
          <h2>Modalità disponibili</h2>
          <p>
            Hi-Score con inserimento a totale o per freccetta, tornei a gironi con eliminazione
            diretta, Hi-Score Nights con finale unica, spareggi e serate. X01, Cricket e le squadre
            non sono ancora disponibili.
          </p>
        </section>
      </main>
    </>
  );
}

function backupName(at: string) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bt-darts-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

function DeviceData() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['local-status'], queryFn: () => localData!.status() });
  const storage = useQuery({ queryKey: ['storage-info'], queryFn: storageInfo });
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ backup: BackupFile; summary: BackupSummary }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const exportBackup = useMutation({
    mutationFn: async (mode: 'download' | 'share') => {
      const backup = await localData!.exportBackup();
      const name = backupName(backup.exportedAt);
      const text = JSON.stringify(backup);
      if (mode === 'share' && (await shareFile(name, text))) return 'Backup condiviso.';
      downloadFile(name, text);
      return `Backup salvato come ${name}. Conservalo fuori dal telefono.`;
    },
    onSuccess: (text) => {
      setMessage(text);
      void client.invalidateQueries({ queryKey: ['local-status'] });
    },
  });
  const readFile = useMutation({
    mutationFn: async (file: File) => localData!.readBackup(await file.text()),
    onSuccess: setPreview,
    onSettled: () => {
      if (fileInput.current) fileInput.current.value = '';
    },
  });
  const importBackup = useMutation({
    mutationFn: () => localData!.importBackup(preview!.backup, true),
    onSuccess: () => {
      setPreview(undefined);
      setMessage('Backup ripristinato su questo dispositivo.');
      void client.invalidateQueries();
    },
  });
  const persist = useMutation({
    mutationFn: requestPersistence,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['storage-info'] }),
  });
  const s = status.data;
  const counts = s?.counts;
  const hasData = !!counts && counts.players + counts.tournaments + counts.events > 0;
  const info = storage.data;
  return (
    <>
      <section className="panel" aria-labelledby="device-title">
        <h2 id="device-title">Dati su questo dispositivo</h2>
        <p>
          Giocatori, partite e tornei sono salvati soltanto in questo browser, senza server né
          cloud. Funziona anche senza connessione.
        </p>
        <ErrorMessage error={status.error} retry={() => void status.refetch()} />
        {s && (
          <div className="data-rows">
            <div className="settings-row">
              <span>Giocatori · tornei</span>
              <strong>
                {s.counts.players} · {s.counts.tournaments}
              </strong>
            </div>
            <div className="settings-row">
              <span>Ultimo backup</span>
              <strong>{dateTime(s.meta.lastBackupAt)}</strong>
            </div>
            <div className="settings-row">
              <span>Modifiche dopo il backup</span>
              <strong className={s.backupRecommended ? 'warning-text' : ''}>
                {s.meta.changesSinceBackup}
              </strong>
            </div>
            <div className="settings-row">
              <span>Archiviazione persistente</span>
              <strong className={info?.persisted ? '' : 'warning-text'}>
                {info?.persisted ? 'Attiva' : info?.persisted === false ? 'Non garantita' : '—'}
              </strong>
            </div>
            {info?.usage != null && info.quota != null && (
              <div className="settings-row">
                <span>Spazio usato</span>
                <strong>
                  {formatBytes(info.usage)} di {formatBytes(info.quota)}
                </strong>
              </div>
            )}
          </div>
        )}
        {info?.persisted === false && (
          <>
            <p className="hint">
              Il browser potrebbe cancellare i dati se lo spazio scarseggia. Installare l’app sulla
              schermata Home aiuta; il backup resta comunque la protezione principale.
            </p>
            <button disabled={persist.isPending} onClick={() => persist.mutate()}>
              Richiedi archiviazione persistente
            </button>
          </>
        )}
        {persist.data === false && (
          <p className="hint" role="status">
            Il browser non ha concesso l’archiviazione persistente.
          </p>
        )}
      </section>
      <section className="panel" id="backup" aria-labelledby="backup-title">
        <h2 id="backup-title">Backup</h2>
        <p>
          Esporta un backup prima e dopo ogni serata e conservalo fuori dal telefono (email, Drive,
          computer). Cancellare i dati del browser o cambiare telefono elimina l’archivio locale.
        </p>
        <div className="data-actions">
          <button
            className="primary"
            disabled={exportBackup.isPending}
            onClick={() => exportBackup.mutate('download')}
          >
            {exportBackup.isPending ? 'Preparazione…' : 'Esporta backup'}
          </button>
          {canShareFiles() && (
            <button disabled={exportBackup.isPending} onClick={() => exportBackup.mutate('share')}>
              Condividi backup
            </button>
          )}
          <label className="button file-button">
            Importa backup
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile.mutate(file);
              }}
            />
          </label>
        </div>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        <ErrorMessage error={exportBackup.error ?? readFile.error} />
      </section>
      {preview && (
        <Modal
          title="Ripristinare questo backup?"
          close={() => !importBackup.isPending && setPreview(undefined)}
        >
          <p>
            Backup del <strong>{dateTime(preview.summary.exportedAt)}</strong>:{' '}
            {count(preview.summary.counts.players, 'giocatore', 'giocatori')},{' '}
            {count(preview.summary.counts.tournaments, 'torneo', 'tornei')}.
          </p>
          {preview.summary.tournaments.length > 0 && (
            <ul>
              {preview.summary.tournaments.map((t) => (
                <li key={t.createdAt + t.name}>
                  {t.name} · {new Date(t.createdAt).toLocaleDateString('it-IT')}
                </li>
              ))}
            </ul>
          )}
          {hasData ? (
            <>
              <p className="warning-text">
                Sostituirà tutti i dati attuali di questo dispositivo (
                {count(counts.players, 'giocatore', 'giocatori')},{' '}
                {count(counts.tournaments, 'torneo', 'tornei')}). L’operazione non si può annullare.
              </p>
              <button
                disabled={exportBackup.isPending}
                onClick={() => exportBackup.mutate('download')}
              >
                Scarica prima i dati attuali
              </button>
            </>
          ) : (
            <p>Il dispositivo non contiene dati: il backup verrà importato.</p>
          )}
          <ErrorMessage error={importBackup.error} />
          <button
            className="primary"
            disabled={importBackup.isPending}
            onClick={() => importBackup.mutate()}
          >
            {importBackup.isPending ? 'Ripristino…' : hasData ? 'Sostituisci i dati' : 'Importa'}
          </button>
        </Modal>
      )}
    </>
  );
}

function AppSection() {
  const pwa = usePwa();
  return (
    <section className="panel" aria-labelledby="app-title">
      <h2 id="app-title">App</h2>
      <div className="data-rows">
        <div className="settings-row">
          <span>Versione</span>
          <strong>{appVersion}</strong>
        </div>
        {pwa.supported && (
          <div className="settings-row">
            <span>Uso senza connessione</span>
            <strong className={pwa.offlineReady ? '' : 'warning-text'}>
              {pwa.offlineReady ? 'Pronta' : 'In preparazione'}
            </strong>
          </div>
        )}
      </div>
      {pwa.updateAvailable && (
        <>
          <p>È disponibile una nuova versione. Aggiorna quando nessuna partita è in corso.</p>
          <button className="primary" onClick={pwa.applyUpdate}>
            Aggiorna ora
          </button>
        </>
      )}
    </section>
  );
}

function OrganizerAccess() {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(sharedApi!.hasToken());
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);
  const client = useQueryClient();
  const api = sharedApi!;
  const server = useQuery({ queryKey: ['server-info'], queryFn: () => api.serverInfo() });
  return (
    <>
      <section className={`panel access ${connected ? 'on' : ''}`} aria-labelledby="access-title">
        <div className="access-head">
          <span className="access-icon" aria-hidden="true">
            <Lock />
          </span>
          <div>
            <h2 id="access-title">Accesso organizzatore</h2>
            <span role="status">
              {connected ? 'Connesso · comandi abilitati' : 'Non connesso · solo consultazione'}
            </span>
          </div>
        </div>
        {connected ? (
          <>
            <dl className="access-facts">
              <dt>Ruolo</dt>
              <dd>Organizzatore</dd>
              {verifiedAt && (
                <>
                  <dt>Verificato</dt>
                  <dd>
                    oggi,{' '}
                    {verifiedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  </dd>
                </>
              )}
              <dt>Validità</dt>
              <dd>fino alla chiusura della scheda</dd>
            </dl>
            <Link to="/" className="button">
              Torna alla Home
            </Link>
            <button
              className="outline"
              onClick={async () => {
                await client.cancelQueries();
                api.setToken('');
                client.clear();
                setConnected(false);
              }}
            >
              Disconnetti questa scheda
            </button>
          </>
        ) : (
          <form
            className="sheet-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              api.setToken(token.trim());
              try {
                // An authenticated read: 200 means the server accepts the token.
                await api.players('', 0, 'active');
                await client.cancelQueries();
                client.clear();
                setConnected(true);
                setVerifiedAt(new Date());
                setToken('');
              } catch (err) {
                api.setToken('');
                client.clear();
                setError(
                  err instanceof ApiError && ['UNAUTHORIZED', 'HTTP_401'].includes(err.code)
                    ? 'Token non accettato dal server (401). Controlla il valore in .env.'
                    : err instanceof Error
                      ? err.message
                      : 'Verifica non riuscita.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Inserisci l’<strong>ORGANIZER_TOKEN</strong> configurato sul server. Serve per creare
              partite, registrare punteggi e confermare i risultati.
            </p>
            <label className="field" htmlFor="token">
              Token
            </label>
            <div className="token-row">
              <input
                id="token"
                className={error ? 'invalid' : ''}
                type={visible ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="64 caratteri esadecimali"
                aria-describedby="token-help"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError('');
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? 'Nascondi token' : 'Mostra token'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <small id="token-help" className="hint">
              Resta solo in questa scheda del browser. Non viene salvato nell’app né nell’URL.
            </small>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !token.trim()}>
              {busy ? 'Verifica…' : 'VERIFICA E USA'}
            </button>
          </form>
        )}
      </section>
      <section className="panel rows-panel" aria-labelledby="server-title">
        <h2 id="server-title">Server del locale</h2>
        <div className="settings-row">
          <span>Stato</span>
          <strong className="dot-label">
            <span
              aria-hidden="true"
              className={server.data?.reachable ? 'dot ok' : server.data ? 'dot off' : 'dot'}
            />
            {server.isPending ? 'Verifica…' : server.data?.reachable ? 'Raggiungibile' : 'Non raggiungibile'}
          </strong>
        </div>
        <div className="settings-row">
          <span>Indirizzo</span>
          <code>{window.location.host}</code>
        </div>
        <div className="settings-row">
          <span>API</span>
          <strong>v1</strong>
        </div>
        <div className="settings-row">
          <span className="row-label">
            <span>Letture pubbliche</span>
            <small>Classifiche visibili senza token</small>
          </span>
          <span className="tag-box">
            {server.data?.publicReads == null
              ? '—'
              : server.data.publicReads
                ? 'Attive'
                : 'Disattivate'}
          </span>
        </div>
      </section>
      <p className="hint">
        Backup, migrazioni e letture pubbliche si configurano sul server (PUBLIC_READS, db:backup).
        Da qui non è possibile modificarle.
      </p>
    </>
  );
}
