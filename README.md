# BT Darts Score Board

Applicativo locale TypeScript con frontend Bite Trouble mobile-first: giocatori, Quick High Score, gironi round-robin ed eliminazione diretta, punteggi manuali, spareggi e recupero dopo riavvio. Nessun collegamento elettronico al Pub Time Darts.

## Avvio

Requisiti: Node **24 LTS** consigliato; verificato anche con Node 22.23.1. Il vincolo minimo della linea 22 è 22.19. pnpm **12.14.0** è fissato in package.json. Se pnpm non è installato, è possibile usare `npm exec --yes --package pnpm@12.14.0 -- pnpm <comando>`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -hex 32
```

Inserire il segreto generato in `ORGANIZER_TOKEN` nel file `.env`, sostituendo il valore di esempio. Poi:

```sh
pnpm build
pnpm start
```

Il server carica `.env`, crea `./data/darts.sqlite`, applica le migrazioni e ascolta su `http://127.0.0.1:3000`. `pnpm dev` avvia il watcher. Nessuna credenziale predefinita consente scritture. Per usare la rete locale impostare `HOST=0.0.0.0` e mantenere la protezione del token.

Aprire **http://127.0.0.1:3000** per il frontend. In **Impostazioni** inserire il valore di `ORGANIZER_TOKEN` configurato sul server: viene conservato soltanto nella sessione della scheda. La build include frontend e API, serviti sulla stessa origine. I dati di gioco rimangono nel database esistente.

Per sviluppare l'interfaccia, eseguire `pnpm dev` e, in un secondo terminale, `pnpm dev:web`: Vite espone `http://127.0.0.1:5173` e inoltra le chiamate API al server sulla porta 3000.

Sono operative **Hi-Score e le modalità torneo già presenti**. 301/501, squadre e altre modalità della reference sono indicate come non disponibili. Quick High Score usa una finale unica tra i qualificati; semifinali ed eliminazione diretta appartengono al formato a gironi.

Documentazione dell'integrazione: [stato e limiti](docs/frontend/IMPLEMENTATION_STATUS.md), [architettura](docs/frontend/FRONTEND_ARCHITECTURE.md), [flussi](docs/frontend/USER_FLOWS.md), [verifiche visuali e screenshot](docs/frontend/VISUAL_QA.md).

```sh
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer $ORGANIZER_TOKEN" http://127.0.0.1:3000/api/v1/tournaments
```

La variabile del secondo comando deve essere esportata nella shell; il caricamento di `.env` nel server non modifica la shell chiamante.

## Dati dimostrativi e verifiche

```sh
pnpm seed
DATABASE_PATH=./data/demo.sqlite pnpm start
pnpm openapi
pnpm check
pnpm smoke
```

Il seed crea un database **separato** `data/demo.sqlite`, otto giocatori, una serata, un Quick completato e un torneo a gironi in corso. Rifiuta database già popolati senza modificarne i dati. Il valore DATABASE_PATH esportato nella shell prevale sul file `.env`.

```sh
DATABASE_PATH=./data/darts.sqlite pnpm db:migrate
DATABASE_PATH=./data/darts.sqlite pnpm db:backup ./backups/serata-01.sqlite
```

Gli script database/seed leggono le variabili di ambiente della shell; il caricamento automatico di `.env` riguarda l'avvio del server.

## Moduli e documenti

```text
apps/api/src/{server,routes,middleware,plugins}
apps/web/src/{components,features,services,styles}
packages/domain/src/{rules,scoring,matches,standings,tournaments}
packages/application/src/services
packages/database/src/{schema,migrations,repositories}
packages/contracts/src/schemas
tests/
scripts/
docs/
```

Le entità piccole Player/Event e i tipi condivisi sono in `domain/src/model.ts`; comandi e query sono raccolti in `application/src/services/backend.ts`, senza cartelle vuote o classi wrapper per ogni operazione.

- [Architettura](docs/architecture.md) e [modello di dominio](docs/domain-model.md)
- [Regole di punteggio](docs/scoring-rules.md), [modalità torneo](docs/tournament-modes.md), [macchine a stati](docs/state-machines.md)
- [API ed endpoint](docs/api.md), [OpenAPI generato](docs/openapi.json), [contratto frontend ed esempi JSON](docs/frontend-integration.md)
- [Database, migrazioni e backup](docs/database.md), [test](docs/testing.md)

L'API usa `/api/v1`; ogni comando critico richiede versioni attese e RecordScore richiede Idempotency-Key. I pareggi decisivi richiedono uno spareggio registrato. Una fase già confermata si corregge tramite riapertura amministrativa, con invalidazione esplicita delle fasi successive.

## Configurazione

| Variabile       | Default               | Significato                          |
| --------------- | --------------------- | ------------------------------------ |
| ORGANIZER_TOKEN | obbligatoria          | Segreto di almeno 32 caratteri       |
| DATABASE_PATH   | `./data/darts.sqlite` | Database persistente                 |
| HOST / PORT     | `127.0.0.1` / `3000`  | Bind HTTP                            |
| PUBLIC_READS    | `false`               | Abilita GET spectator, escluso audit |
| LOG_LEVEL       | `info`                | Livello Pino, token oscurati         |
| RATE_LIMIT_MAX  | `300`                 | Richieste per IP al minuto           |

Dipendenze verificate sul registro npm prima dell'installazione e fissate nel lockfile: Fastify 5.12.7, Drizzle 0.45.4, better-sqlite3 13.0.3, Zod 4.6.7, Vitest 5.0.5, TypeScript 7.0.2. Compatibilità di riferimento: [Node release schedule](https://github.com/nodejs/Release), [Fastify v5](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/), [Drizzle SQLite](https://orm.drizzle.team/docs/get-started-sqlite).

## Limiti intenzionali

HIGH_SCORE è completo; X01 è un contratto di estensione. Nessun websocket, sincronizzazione offline, account pubblici o integrazione hardware. SQLite e snapshot di aggregato sono pensati per piccoli tornei; massimi di configurazione non equivalgono a una promessa di capacità sotto carico. Un bersaglio alla volta è imposto all'interno di ciascun torneo; l'assegnazione del bersaglio fra tornei diversi resta responsabilità dell'organizzatore. HTTPS e proxy per un'eventuale esposizione in rete sono esterni al processo API.

## Test frontend

`pnpm check` verifica i tipi, esegue i test di dominio/API/adapter e compila l'applicativo. Per i test browser, dopo la build:

```sh
pnpm --filter @bt/web exec playwright install chromium
pnpm test:e2e
```

Playwright avvia un backend separato su porta 3107, con SQLite in memoria e token di prova; non modifica `data/darts.sqlite`. Gli screenshot finiscono in `docs/frontend/screenshots`. Per usare un Chromium già installato, impostare `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` al suo percorso. La suite verifica Hi-Score, reload, undo, gironi/eliminazione e layout responsive.
