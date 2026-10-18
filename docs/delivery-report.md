# Report tecnico di consegna

Il backend implementa l'intero percorso operativo via REST, dalla creazione dei giocatori alla conferma del vincitore, senza frontend o dipendenze cloud.

## Architettura e moduli

Workspace pnpm con `apps/api`, `packages/domain`, `packages/application`, `packages/database` e `packages/contracts`. Dominio TypeScript puro; Fastify per HTTP; Zod per input/output e OpenAPI; SQLite/Drizzle per snapshot coerenti e proiezioni relazionali; audit ed eventi append-only. I dettagli e le scelte di consistenza sono in [architecture.md](./architecture.md).

## Funzioni consegnate

- Giocatori omonimi, nickname non unici, disattivazione, ricerca, storico e statistiche separate per configurazione.
- Eventi con più tornei; configurazioni bloccate dopo l'avvio.
- HIGH_SCORE configurabile, totale di turno o singoli lanci, controllo ordine, rotazione, completamento, pausa/ripresa.
- Quick High Score con qualificazione completa, top 4 di default, spareggi registrati, finale da zero e proclamazione esplicita.
- Gironi automatici/manuali, calendario round-robin, punti configurabili, catena di spareggio esplicita, seeding, bye, semifinali e finale a eliminazione singola.
- Correzioni e annullamenti con provenienza, versione e audit; riapertura amministrativa con invalidazione delle fasi successive.
- Idempotenza persistente dei punteggi, optimistic concurrency, transazioni, migrazioni controllate, recupero e backup online.
- Autenticazione bearer organizzatore, letture spectator opzionali, rate limiting, configurazione validata ed errori standard.
- Eventi persistenti e polling con cursore, interfaccia per futuri adapter push.

## API e integrazione

Endpoint sotto `/api/v1` per players, events, tournaments, matches e scores, con comandi espliciti di stato, qualificazione, spareggio, correzione e finale. Elenco completo in [api.md](./api.md), schema macchina in [openapi.json](./openapi.json), esempi di integrazione in [frontend-integration.md](./frontend-integration.md).

Il frontend deve conservare gli ID delle iscrizioni, leggere le versioni restituite, inviare `expectedVersion` e `expectedMatchVersion` e assegnare una Idempotency-Key stabile a ogni operazione di punteggio. Non deve ricostruire autonomamente qualificazioni o vincitori.

## Verifiche

Alla consegna del backend, 75 test automatici coprivano (oggi 101, vedi [testing](testing.md)) dominio, due modalità torneo, API complete, autorizzazioni, vincoli, rollback, concorrenza, idempotenza, riavvio e validazione formale OpenAPI. Typecheck strict e build completati; formattazione uniforme verificata. Seed dimostrativo verificato con otto giocatori, un Quick concluso e un torneo a gironi attivo; secondo seed rifiutato senza sostituire dati. Backup verificato con integrity_check e foreign_key_check.

Le verifiche sono state eseguite con Node 22.23.1; `.nvmrc` indica Node 24 LTS come runtime consigliato. Il comando `pnpm smoke` permette di ripetere la verifica HTTP reale del build, inclusa la persistenza dopo riavvio.

## Avvio

Seguire [README.md](../README.md): installazione da lockfile, `.env` con token casuale, `pnpm build`, `pnpm start`. `pnpm seed` crea un database demo separato. `pnpm check` esegue typecheck, suite e build.

## Limiti residui dichiarati

X01 è soltanto un'interfaccia di estensione. Non sono implementati integrazione hardware, push SSE/WebSocket, sincronizzazione offline, account pubblici, doppia eliminazione o varianti Quick cumulative. L'assegnazione di un bersaglio fra tornei contemporanei non è modellata. Il backend è pensato per piccoli tornei locali, non per carichi distribuiti; TLS e distribuzione sono esterni al processo. Nessuno di questi limiti impedisce i due flussi MVP richiesti.
