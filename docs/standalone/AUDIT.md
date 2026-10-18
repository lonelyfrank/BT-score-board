# Audit iniziale — conversione Standalone PWA

Data: 18 ottobre 2026. Branch di partenza `feat/design-bite-trouble-ui` (commit `9481719`).

## Struttura e dipendenze effettive

| Modulo                 | Dipende da                                   | Note per il browser                                                         |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/domain`      | nulla                                        | TypeScript puro, nessun I/O: eseguibile nel browser senza modifiche         |
| `packages/contracts`   | zod                                          | Utilizzabile nel browser                                                    |
| `packages/application` | domain, contracts, zod, **`node:crypto`**    | Unica dipendenza server-only: `randomUUID` e `createHash('sha256')`         |
| `packages/database`    | better-sqlite3, drizzle, `node:fs`, crypto   | Solo server                                                                 |
| `apps/api`             | Fastify, application, database               | Solo server; serve anche `apps/web/dist`                                    |
| `apps/web`             | React, TanStack Query, Router; tipi contracts | Unico punto di I/O: `HttpAdapter` in `services/api.ts`, istanza unica `api` |

Il frontend non importa codice di dominio a runtime: usa solo tipi derivati dagli schemi Zod di risposta. Tutte le schermate passano dall'oggetto `api`, quindi un'interfaccia comune può sostituirlo senza duplicare le schermate.

## Servizi di gioco

`Backend.execute` esegue in una sola `store.transaction` sincrona: validazione Zod, lookup idempotente (fingerprint SHA-256 di nome, ID, input, operatore), caricamento dell'aggregato Tournament, controllo `expectedVersion`/`expectedMatchVersion`, comando di dominio, `version++`, `saveTournament(t, versionePrecedente)` con controllo CAS, audit, outbox ed eventuale risposta idempotente. Un'eccezione annulla tutto.

La porta `Store` è **sincrona** (`transaction<T>(work: () => T): T`). IndexedDB è asincrono: non è possibile chiamarlo dentro la transazione senza riscrivere application e SQLite. È questo il vincolo che guida la strategia di conversione.

L'aggregato di consistenza è il Tournament (match, turni, punteggi e risultati inclusi). SQLite salva lo snapshot JSON come fonte delle query di dominio, più proiezioni normalizzate con vincoli (unicità degli slot punteggio, FK, trigger append-only).

## Flussi frontend

- Creazione: `createTournament` → un `RegisterPlayer` per giocatore → `StartTournament` → per la partita rapida `StartMatch`. La bozza è ripresa tramite ID se un passaggio fallisce.
- Live: `RecordScore` e `CompleteTurn` sono due comandi HTTP distinti. I comandi incerti sono conservati in `sessionStorage` con la stessa Idempotency-Key e recuperati dopo reload.
- Polling ogni 5 s su Live e dettaglio torneo.

## Baseline eseguita

| Verifica                    | Esito                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit` root e web   | OK                                                                                                          |
| Vitest                      | 79/79 superati (6 file)                                                                                     |
| Build backend + web         | OK, bundle 268 kB (83 kB gzip)                                                                              |
| Playwright (3 flussi)       | 3/3 superati usando `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: nella cache c'è Chromium 1243, la 1.64 cerca 1248 |

## Differenze fra documentazione e codice

- `docs/delivery-report.md` cita 75 test; il codice ne contiene 79 (allineato in `IMPLEMENTATION_STATUS.md`).
- `listTournaments` ordina per `id DESC`, ma gli ID sono UUID v4 casuali: l'elenco tornei non è cronologico, benché l'interfaccia lo presenti come tale. `tournamentsForPlayer` non ha ordinamento esplicito.
- La mappa messaggi del client cita `MATCH_ALREADY_ACTIVE` e `MATCH_VERSION_CONFLICT`, che il dominio non emette (usa `BOARD_BUSY` e `VERSION_CONFLICT`).
- `IMPLEMENTATION_STATUS.md` dichiara correttamente PWA/offline non implementati.

## Rischi individuati

1. **Store sincrono contro IndexedDB asincrono**: serve uno store in memoria con commit differito, non un adapter che "attende" dentro la transazione.
2. **Più schede**: due snapshot in memoria possono sovrascriversi a vicenda; serve un controllo di revisione nella transazione IndexedDB.
3. **Crescita dei dati**: SQLite conserva la risposta completa per ogni chiave idempotente (uno snapshot del torneo per comando). In locale, su telefono, questo moltiplicherebbe archivio e backup.
4. **`crypto.randomUUID`** è disponibile solo in contesti sicuri; in sviluppo via LAN (`http://192.168…`) mancherebbe.
5. **Due transazioni per turno** (`RecordScore` + `CompleteTurn`): in locale si possono rendere atomiche senza cambiare la semantica dei comandi.

## Strategia adottata

- `packages/application`: sostituire `node:crypto` con funzioni portabili (UUID con fallback, SHA-256 sincrono identico a Node). Estrarre la vista partita live e la mappa percorso→comando, oggi definite nelle rotte, per riusarle dall'adapter locale.
- `packages/local-store` (nuovo): `MemoryStore` implementa la porta `Store` esistente su un overlay transazionale. Ogni comando produce un change set che viene salvato in **una** transazione IndexedDB. Solo dopo l'evento `complete` lo stato in memoria viene aggiornato e la UI riceve conferma.
- Persistenza IndexedDB con snapshot per aggregato, audit/outbox append-only, record dei comandi, metadati e revisione globale (CAS fra schede). Backup JSON versionato con digest SHA-256.
- `apps/web`: interfaccia `GameAdapter` comune; `LocalGameAdapter` predefinito, `HttpAdapter` conservato per la modalità condivisa (`vite --mode shared`).
- PWA con vite-plugin-pwa in modalità `prompt` (nessun reload forzato), deploy statico Vercel.
