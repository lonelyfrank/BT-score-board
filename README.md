# BT Darts Score Board

Webapp mobile-first, companion del totem **Pub Time Darts (1987)** del Bite Trouble: giocatori, partite singole, Hi-Score Nights (qualifica + finale dei migliori 4), gironi round-robin ed eliminazione diretta, spareggi o decisioni dell'organizzatore, classifiche, statistiche e storico. Il totem gioca e calcola; l'app registra solo i **risultati finali** degli otto giochi della macchina (301, 301 Double In/Out, 501, Hi-Score, 301 Masters, Exacta, Odd & Even, Shanghai). Nessun collegamento con il totem.

L'app funziona in due modalità che condividono schermate, dominio e servizi applicativi:

| Modalità                     | Dati                         | Uso                                                        |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------- |
| **Standalone** (predefinita) | IndexedDB del browser        | Un telefono, nessun server, offline; deploy statico Vercel |
| **Shared** (opzionale)       | SQLite tramite l'API Fastify | Base per una futura gestione multi-dispositivo             |

## Uso standalone

Si apre l'indirizzo pubblicato dal telefono e si installa l'app («Aggiungi a schermata Home» su iPhone, «Installa app» su Android). Dopo la prima apertura online l'app parte anche senza connessione. Tutte le regole di gioco girano nel browser, con lo stesso codice di dominio del backend.

I dati restano **solo su quel dispositivo**. Esportare un backup da **Impostazioni → Backup** prima e dopo ogni serata, e conservarlo fuori dal telefono. Cancellare i dati del sito, disinstallare il browser o perdere il telefono elimina l'archivio. Il browser può negare l'archiviazione persistente: l'app lo segnala, ma non può garantirla. Lo stesso backup si importa su un nuovo dispositivo.

Dettagli: [architettura standalone](docs/standalone/ARCHITECTURE.md), [checklist smartphone](docs/standalone/MOBILE_CHECKLIST.md), [audit iniziale](docs/standalone/AUDIT.md), [report local-first e giochi del totem](docs/local-first/REPORT.md).

## Sviluppo locale

Requisiti: Node **24 LTS** consigliato (verificato con 22.23.1; minimo 22.19). pnpm **12.14.0** è fissato in `package.json`; senza pnpm installato si può usare `npm exec --yes --package pnpm@12.14.0 -- pnpm <comando>`.

```sh
pnpm install --frozen-lockfile
pnpm dev:web            # standalone su http://127.0.0.1:5173, senza backend
pnpm check              # typecheck, test Vitest, build server + web
pnpm --filter @bt/web build && pnpm --filter @bt/web preview   # build statica con PWA
```

In sviluppo il service worker è disattivato; si verifica con `build` + `preview`. Da un telefono nella stessa rete servono HTTPS o `localhost` per il service worker; IndexedDB e il gioco funzionano anche via `http://<ip-del-pc>`.

## Deploy su Vercel

`vercel.json` contiene la configurazione: install con pnpm 12.14.0 senza script nativi, build di `apps/web`, output `apps/web/dist`, fallback SPA e cache immutabile per i bundle con hash. Nel progetto Vercel: **Root Directory** = radice del repository, Node 22.x o 24.x, nessuna variabile d'ambiente. Procedura e verifiche in [docs/standalone/VERCEL.md](docs/standalone/VERCEL.md).

## Modalità condivisa (backend Fastify)

Il backend resta completo e testato: API REST `/api/v1`, SQLite con migrazioni, autenticazione organizzatore, outbox, idempotenza e OpenAPI.

```sh
cp .env.example .env
openssl rand -hex 32     # valore per ORGANIZER_TOKEN in .env
pnpm build               # server + web standalone (dist) + web shared (dist-shared)
pnpm start               # http://127.0.0.1:3000, frontend shared con token in Impostazioni
pnpm dev                 # watcher API; con `pnpm dev:web:shared` Vite inoltra /api alla porta 3000
```

Il server crea `./data/darts.sqlite` e applica le migrazioni. Nessuna credenziale predefinita consente scritture. Per usare la rete locale impostare `HOST=0.0.0.0` e mantenere il token. Strategia per migrare un archivio standalone su questo backend: [docs/standalone/FUTURE_SHARED_MODE.md](docs/standalone/FUTURE_SHARED_MODE.md).

```sh
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer $ORGANIZER_TOKEN" http://127.0.0.1:3000/api/v1/tournaments
pnpm seed                                   # database demo separato data/demo.sqlite
DATABASE_PATH=./data/darts.sqlite pnpm db:backup ./backups/serata-01.sqlite
pnpm openapi && pnpm smoke
```

| Variabile       | Default               | Significato                          |
| --------------- | --------------------- | ------------------------------------ |
| ORGANIZER_TOKEN | obbligatoria          | Segreto di almeno 32 caratteri       |
| DATABASE_PATH   | `./data/darts.sqlite` | Database persistente                 |
| HOST / PORT     | `127.0.0.1` / `3000`  | Bind HTTP                            |
| PUBLIC_READS    | `false`               | Abilita GET spectator, escluso audit |
| LOG_LEVEL       | `info`                | Livello Pino, token oscurati         |
| RATE_LIMIT_MAX  | `300`                 | Richieste per IP al minuto           |

## Moduli

```text
apps/web/src/{components,features,services,styles}   React; services/{local,http}.ts sono i due adapter
apps/api/src/{server,routes,middleware,plugins}      Fastify (modalità shared)
packages/domain        regole, turni, classifiche, spareggi, calendario, tabellone (puro)
packages/contracts     schemi Zod di input/output
packages/application   Backend: comandi, versioni, audit, idempotenza; porta Store
packages/local-store   MemoryStore, IndexedDB, motore locale, backup (browser)
packages/database      SqliteStore, migrazioni, backup (server)
tests/                 Vitest: dominio, modalità, API, SQLite, equivalenza, IndexedDB
apps/web/e2e/          Playwright: progetti shared e standalone
```

Documenti: [architettura](docs/architecture.md), [modello di dominio](docs/domain-model.md), [regole di punteggio](docs/scoring-rules.md), [modalità torneo](docs/tournament-modes.md), [macchine a stati](docs/state-machines.md), [API](docs/api.md), [OpenAPI](docs/openapi.json), [database](docs/database.md), [test](docs/testing.md), [stato frontend](docs/frontend/IMPLEMENTATION_STATUS.md).

## Test

```sh
pnpm test                                        # 122 test Vitest
pnpm --filter @bt/web exec playwright install chromium
pnpm test:e2e                                    # 11 flussi: 3 shared + 8 standalone/PWA
```

Playwright costruisce entrambe le versioni da sé. Fastify gira sulla porta 3107 con SQLite in memoria; la build statica è servita sulla 3108. Per usare un Chromium già installato, impostare `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Limiti intenzionali

Gli otto giochi si registrano come risultato finale; l'app non conta dardi né turni (i tornei a turni creati prima restano leggibili e giocabili fino alla fine). Odd & Even è limitato a 2 giocatori in attesa di conferma sul totem. In standalone non esistono sincronizzazione, account o condivisione fra dispositivi: un solo telefono è la fonte dei dati. Il backend shared resta pensato per piccoli tornei locali; HTTPS e proxy sono esterni al processo API. Un bersaglio alla volta è imposto all'interno di ciascun torneo.
