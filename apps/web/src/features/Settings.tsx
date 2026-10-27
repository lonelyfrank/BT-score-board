import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff, Lock } from 'lucide-react';
import { ApiError, appVersion, cloudApi, localData, sharedApi } from '../services/api';
import { useAccount, isAdmin } from '../services/cloud';
import type { BackupFile, BackupSummary } from '../../../../packages/local-store/src/index.js';
import {
  canShareFiles,
  downloadFile,
  formatBytes,
  requestPersistence,
  shareFile,
  storageInfo,
} from '../services/device';
import { usePwa, useUpdateHold } from '../services/pwa';
import { gameModes, games } from '../services/rules';
import { Header, ErrorMessage, Modal } from '../components/ui';
import { MergeFlow } from './Crews';
import { WhoAmISheet, useKnowsMe } from '../components/WhoAmI';
import { AccountSection, AdminSection } from './Account';

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
  const account = useAccount();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <>
      <Header
        title="Impostazioni"
        subtitle={
          cloudApi
            ? isAdmin(account)
              ? 'Account, utenti, backup e app'
              : 'Account e app'
            : localData
              ? 'Dati, backup e app'
              : 'Accesso, server e app'
        }
        back="/"
        backLabel="Indietro alla Home"
      />
      <main className="settings">
        {cloudApi ? (
          <>
            <AccountSection />
            {isAdmin(account) && (
              <>
                <AdminSection />
                <DeviceData />
              </>
            )}
          </>
        ) : localData ? (
          <DeviceData />
        ) : (
          <OrganizerAccess />
        )}
        <AppSection />
        <p className="hint">
          Gli otto giochi del totem Pub Time Darts:{' '}
          {gameModes.map((id) => games[id].label).join(', ')}. Il totem calcola i punti: l’app
          registra i risultati, senza alcun collegamento alla macchina.
        </p>
      </main>
    </>
  );
}

/** bt-darts-backup-YYYY-MM-DD.json, in local time; the device renames same-day copies. */
export function backupName(at: string) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bt-darts-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** The device's archive, or in cloud mode (admins) the server's: same backup and restore. */
function DeviceData() {
  const server = !!cloudApi;
  const where = server ? 'del server' : 'di questo dispositivo';
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['local-status'], queryFn: () => localData!.status() });
  const storage = useQuery({ queryKey: ['storage-info'], queryFn: storageInfo });
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ backup: BackupFile; summary: BackupSummary }>();
  const [merging, setMerging] = useState(false);
  const [choosingMe, setChoosingMe] = useState(false);
  const knows = useKnowsMe();
  const myName = knows.players.find((p) => p.id === knows.me)?.displayName;
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
      setMessage(
        server ? 'Backup ripristinato sul server.' : 'Backup ripristinato su questo dispositivo.',
      );
      void client.invalidateQueries();
    },
  });
  const persist = useMutation({
    mutationFn: requestPersistence,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['storage-info'] }),
  });
  // An app update never reloads the page in the middle of a backup or of its preview.
  useUpdateHold(
    !!preview || readFile.isPending || importBackup.isPending || exportBackup.isPending,
  );
  const s = status.data;
  const counts = s?.counts;
  const hasData = !!counts && counts.players + counts.tournaments + counts.events > 0;
  const info = storage.data;
  return (
    <>
      <section
        className={`card pad backup ${s?.backupRecommended ? 'warn' : ''}`}
        id="backup"
        aria-labelledby="backup-title"
      >
        <div className="sec-h">
          <h2 id="backup-title">Backup</h2>
          {s?.backupRecommended ? (
            <span className="chip warn">CONSIGLIATO</span>
          ) : (
            s && <span className="chip ok">AGGIORNATO</span>
          )}
        </div>
        {s && (
          <div className="backup-facts">
            <div>
              <span className="field-l">Ultimo backup</span>
              <b>{dateTime(s.meta.lastBackupAt)}</b>
            </div>
            <div>
              <span className="field-l">Modifiche dopo</span>
              <strong className={s.backupRecommended ? 'warn' : ''}>
                {s.meta.changesSinceBackup}
              </strong>
            </div>
          </div>
        )}
        <div className="backup-actions">
          <button
            type="button"
            className="btn cta"
            disabled={exportBackup.isPending}
            onClick={() => exportBackup.mutate('download')}
          >
            {exportBackup.isPending ? 'Preparazione…' : 'Esporta backup'}
          </button>
          <label className="btn file-button">
            Ripristina
            <input
              ref={fileInput}
              type="file"
              aria-label="Importa backup"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile.mutate(file);
              }}
            />
          </label>
        </div>
        {canShareFiles() && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={exportBackup.isPending}
            onClick={() => exportBackup.mutate('share')}
          >
            Condividi backup
          </button>
        )}
        {server ? (
          <p className="hint">
            I dati restano sul server; una copia esportata ogni tanto protegge da errori. Per
            portare qui i dati di un telefono, esporta il backup sul telefono e ripristinalo o
            uniscilo da qui.
          </p>
        ) : (
          <p className="hint">
            Esporta prima e dopo ogni serata e conserva il file fuori dal telefono. Cancellare i
            dati del browser o cambiare telefono elimina l’archivio locale.
          </p>
        )}
        {message && (
          <p className="form-reason ok" role="status">
            {message}
          </p>
        )}
        <ErrorMessage error={exportBackup.error ?? readFile.error} />
      </section>
      {server ? (
        s && (
          <div className="card">
            <div className="row">
              <span className="k">Giocatori · tornei sul server</span>
              <span className="v">
                {s.counts.players} · {s.counts.tournaments}
              </span>
            </div>
          </div>
        )
      ) : (
        <>
          <h2 className="set-h">Questo telefono</h2>
          <div className="card">
            <div className="row">
              <span className="k">Io sono</span>
              <button type="button" className="btn sm" onClick={() => setChoosingMe(true)}>
                {myName ?? 'Scegli il tuo giocatore'}
              </button>
            </div>
          </div>
          {choosingMe && <WhoAmISheet close={() => setChoosingMe(false)} />}
          <h2 className="set-h" id="device-title">
            Dati su questo dispositivo
          </h2>
          <ErrorMessage error={status.error} retry={() => void status.refetch()} />
          <div className="card" aria-labelledby="device-title">
            <div className="row">
              <span className="k">Archiviazione persistente</span>
              {info?.persisted ? (
                <span className="chip ok">ATTIVA</span>
              ) : info?.persisted === false ? (
                <span className="chip warn">NON GARANTITA</span>
              ) : (
                <span className="v">—</span>
              )}
            </div>
            {s && (
              <div className="row">
                <span className="k">Giocatori · tornei</span>
                <span className="v">
                  {s.counts.players} · {s.counts.tournaments}
                </span>
              </div>
            )}
            {info?.usage != null && info.quota != null && (
              <div className="row">
                <span className="k">Spazio usato</span>
                <span className="v">
                  {formatBytes(info.usage)} di {formatBytes(info.quota)}
                </span>
              </div>
            )}
          </div>
          {info?.persisted === false && (
            <>
              <p className="hint">
                Il browser potrebbe cancellare i dati se lo spazio scarseggia. Installare l’app
                sulla schermata Home aiuta; il backup resta comunque la protezione principale.
              </p>
              <button
                type="button"
                className="btn"
                disabled={persist.isPending}
                onClick={() => persist.mutate()}
              >
                Richiedi archiviazione persistente
              </button>
            </>
          )}
          {persist.data === false && (
            <p className="hint" role="status">
              Il browser non ha concesso l’archiviazione persistente.
            </p>
          )}
          <h2 className="set-h">Server del locale</h2>
          <div className="card">
            <div className="row">
              <span>
                <b className="row-title">Modalità condivisa</b>
                <small className="hint">Non configurata · i dati restano sul telefono</small>
              </span>
            </div>
          </div>
        </>
      )}
      {preview && (merging || preview.summary.scope === 'crew') && (
        <MergeFlow
          {...preview}
          close={() => {
            setPreview(undefined);
            setMerging(false);
          }}
        />
      )}
      {preview && !merging && preview.summary.scope !== 'crew' && (
        <Modal
          title="Ripristinare questo backup?"
          subtitle={`Backup del ${dateTime(preview.summary.exportedAt)}`}
          close={() => !importBackup.isPending && setPreview(undefined)}
          footer={
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={importBackup.isPending}
                onClick={() => setPreview(undefined)}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn cta"
                disabled={importBackup.isPending}
                onClick={() => importBackup.mutate()}
              >
                {importBackup.isPending
                  ? 'Ripristino…'
                  : hasData
                    ? 'Sostituisci i dati'
                    : 'Importa'}
              </button>
            </>
          }
        >
          <p>
            {count(preview.summary.counts.players, 'giocatore', 'giocatori')},{' '}
            {count(preview.summary.counts.tournaments, 'torneo', 'tornei')}.
          </p>
          {preview.summary.tournaments.length > 0 && (
            <ul className="list">
              {preview.summary.tournaments.map((t) => (
                <li key={t.createdAt + t.name} className="mrow">
                  <span>{t.name}</span>
                  <small>{new Date(t.createdAt).toLocaleDateString('it-IT')}</small>
                </li>
              ))}
            </ul>
          )}
          {hasData ? (
            <>
              <p>
                <b>Unisci</b> aggiunge questi dati a quelli {server ? 'del server' : 'del telefono'}{' '}
                senza cancellare nulla (ad esempio il backup di un altro telefono).
              </p>
              <button type="button" className="btn cta" onClick={() => setMerging(true)}>
                Unisci ai dati attuali
              </button>
              <p className="note warn">
                <AlertTriangle aria-hidden="true" />
                <span>
                  Sostituirà tutti i dati attuali {where} (
                  {count(counts.players, 'giocatore', 'giocatori')},{' '}
                  {count(counts.tournaments, 'torneo', 'tornei')}). L’operazione non si può
                  annullare.
                </span>
              </p>
              <button
                type="button"
                className="btn"
                disabled={exportBackup.isPending}
                onClick={() => exportBackup.mutate('download')}
              >
                Scarica prima i dati attuali
              </button>
            </>
          ) : (
            <p className="hint">
              {server ? 'Il server' : 'Il dispositivo'} non contiene dati: il backup verrà
              importato.
            </p>
          )}
          <ErrorMessage error={importBackup.error} />
        </Modal>
      )}
    </>
  );
}

function AppSection() {
  const pwa = usePwa();
  return (
    <>
      <h2 className="set-h" id="app-title">
        App
      </h2>
      <div className="card" aria-labelledby="app-title">
        <div className="row">
          <span className="k">Versione</span>
          <span className="v">{appVersion}</span>
        </div>
        <div className="row">
          <span className="k">Modalità</span>
          <span className="v">
            {cloudApi
              ? 'Cloud · account'
              : localData
                ? 'Standalone · PWA'
                : 'Condivisa · server del locale'}
          </span>
        </div>
        {pwa.supported && (
          <div className="row">
            <span className="k">Uso senza connessione</span>
            {pwa.offlineReady ? (
              <span className="chip ok">PRONTO</span>
            ) : (
              <span className="chip warn">IN PREPARAZIONE</span>
            )}
          </div>
        )}
      </div>
      {pwa.updateAvailable && (
        <>
          <p className="hint">
            È disponibile una nuova versione. Aggiorna quando nessuna partita è in corso.
          </p>
          <button
            type="button"
            className="btn cta"
            disabled={!pwa.canApply}
            onClick={pwa.applyUpdate}
          >
            Aggiorna ora
          </button>
        </>
      )}
    </>
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
      <section
        className={`card pad access ${connected ? 'on' : 'warn'}`}
        aria-labelledby="access-title"
      >
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
            <Link to="/" className="btn">
              Torna alla Home
            </Link>
            <button
              type="button"
              className="btn ghost"
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
                className="ibtn box"
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
              <p className="form-reason" role="alert">
                {error}
              </p>
            )}
            <button className="btn cta" disabled={busy || !token.trim()}>
              {busy ? 'Verifica…' : 'VERIFICA E USA'}
            </button>
          </form>
        )}
      </section>
      <h2 className="set-h" id="server-title">
        Server del locale
      </h2>
      <section className="card" aria-labelledby="server-title">
        <div className="row">
          <span className="k">Stato</span>
          <strong className="v dot-label">
            <span
              aria-hidden="true"
              className={server.data?.reachable ? 'dot ok' : server.data ? 'dot off' : 'dot'}
            />
            {server.isPending
              ? 'Verifica…'
              : server.data?.reachable
                ? 'Raggiungibile'
                : 'Non raggiungibile'}
          </strong>
        </div>
        <div className="row">
          <span className="k">Indirizzo</span>
          <code className="v">{window.location.host}</code>
        </div>
        <div className="row">
          <span className="k">API</span>
          <strong className="v">v1</strong>
        </div>
        <div className="row">
          <span>
            <span className="k">Letture pubbliche</span>
            <small className="hint"> · classifiche visibili senza token</small>
          </span>
          <span className="v">
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
