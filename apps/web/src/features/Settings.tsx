import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { appVersion, localData, sharedApi } from '../services/api';
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
            Hi-Score, tornei a gironi, qualificazioni, spareggi e finali. Le modalità 301/501 e le
            squadre non sono ancora disponibili.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [connected, setConnected] = useState(sharedApi!.hasToken());
  const client = useQueryClient();
  const api = sharedApi!;
  return (
    <section className="panel">
      <h2>Accesso organizzatore</h2>
      <p>
        Inserisci il token configurato sul server per gestire giocatori e punteggi. Rimane in questa
        scheda del browser.
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
        <label className="field">
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
  );
}
