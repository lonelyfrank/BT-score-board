# Architettura

BT Darts Score Board è un monolite TypeScript ESM, per un organizzatore e un bersaglio fisico con inserimento manuale. Nessuna comunicazione hardware, UI, servizio cloud o account pubblico.

| Modulo                 | Responsabilità                                                         | Dipendenze consentite                  |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| `packages/domain`      | Regole, stato, turni, classifiche, spareggi, calendario e tabellone    | Nessuna libreria infrastrutturale      |
| `packages/contracts`   | Zod, DTO pubblici, input e output HTTP                                 | Zod                                    |
| `packages/application` | Comandi autorizzati, query, transazioni, versioni, audit e idempotenza | Dominio, contratti, porta Store        |
| `packages/database`    | Adapter Store, Drizzle, SQLite, migrazioni e backup                    | Dominio e tipi della porta applicativa |
| `packages/local-store` | Store in memoria, IndexedDB, motore locale, backup (solo browser)      | Dominio, application, contracts, idb   |
| `apps/api`             | Fastify, autenticazione, rate limit, Pino, OpenAPI                     | Application, contracts, database       |
| `apps/web`             | React; adapter standalone (predefinito) e HTTP                         | Contracts, application, local-store    |

Il dominio riceve un Context con generatore di ID, orologio e operatore. Le regole non leggono variabili d'ambiente né aprono connessioni. L'application valida gli input anche quando viene chiamata senza HTTP. Il ruolo organizer è necessario per ogni scrittura; spectator è solo lettura.

Ogni comando esegue una transazione SQLite `BEGIN IMMEDIATE`: cerca prima un'eventuale risposta idempotente, carica il torneo, confronta versioni, applica le invarianti, salva snapshot e proiezioni relazionali, aggiunge audit/eventi e memorizza la risposta. Un errore annulla tutto. Due processi sullo stesso file non possono sovrascrivere silenziosamente un torneo.

Il torneo è l'aggregato di consistenza. Lo snapshot JSON tipizzato è la fonte delle query di dominio; le tabelle normalizzate mantengono appartenenza, indici, vincoli e accesso per ID. Le due rappresentazioni si aggiornano nella stessa transazione, senza cache esterna. Questa scelta favorisce recuperabilità e semplicità per piccoli tornei; non è destinata a competizioni massive. SQLite e il dominio sono sincroni: non introdurre attese async all'interno delle transazioni.

Gli eventi applicativi sono persistiti in un outbox ordinato. `/changes?after=...` permette polling incrementale. `NotificationAdapter` definisce il punto di estensione per futuri SSE/WebSocket; nessun trasporto push è implementato e il core non dipende da esso.

La versione del torneo cambia per ogni comando accettato; la versione della partita cambia quando cambiano dati o stato di quella partita. La risposta idempotente resta quella originale: può contenere una versione ormai superata, quindi un client che riprende una sessione deve leggere lo stato corrente.

Un solo incontro può occupare il bersaglio per torneo, incluse partite sospese. Tornei diversi possono essere gestiti indipendentemente: l'assegnazione di un bersaglio condiviso tra tornei non è modellata.

La modalità standalone esegue lo stesso Backend nel browser: `MemoryStore` implementa la porta Store e ogni comando viene confermato in una transazione IndexedDB prima di aggiornare la memoria. Dettagli in [standalone/ARCHITECTURE.md](standalone/ARCHITECTURE.md).
