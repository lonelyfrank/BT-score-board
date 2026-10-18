# Verso la modalità condivisa

La prima release usa solo la modalità standalone. Nulla di quanto segue è implementato: niente sincronizzazione cloud, WebSocket, SSE o peer-to-peer. Il documento fissa le scelte già fatte perché il passaggio resti possibile.

## Cosa è già compatibile

- **Stesso dominio e stessi comandi**: `Backend` gira invariato su SQLite e su IndexedDB. I test di equivalenza garantiscono che lo stesso comando produca lo stesso stato.
- **ID globali**: giocatori, tornei, partite, turni e punteggi usano UUID v4 generati sul dispositivo. Archivi di dispositivi diversi non collidono e si possono fondere senza riassegnare ID.
- **Versioni**: ogni Tournament ha `version` (+1 per comando) e ogni Match la propria. Sono gli stessi campi usati dall'optimistic concurrency dell'API.
- **Storia append-only**: audit e outbox locali hanno lo stesso formato di `audit_log` e `application_events`, con `sequence` locale. L'outbox registra gli eventi di dominio (ScoreRecorded, TurnCompleted, …) con la versione risultante.
- **Identità del dispositivo**: `meta.deviceId` e `revision`, esportati nel backup (`source`).
- **Formato di backup versionato** e validato con gli stessi schemi Zod dell'API.
- **Adapter HTTP esistente**: le schermate funzionano già contro Fastify (`vite build --mode shared`), con idempotency key e versioni attese.

## Migrazione di un archivio standalone su un backend condiviso

Endpoint futuro proposto: `POST /api/v1/imports`, autenticato come organizzatore, con il file di backup standalone come body.

1. Il server riesegue la stessa validazione di `readBackup` (digest, schemi, riferimenti).
2. In una transazione SQLite `BEGIN IMMEDIATE`:
   - **Players / Events**: insert se l'ID non esiste. Se esiste con contenuto diverso, prevale `updatedAt` più recente; la differenza va in audit (`PlayerMerged`).
   - **Tournaments**: insert se l'ID non esiste, con `SqliteStore.saveTournament(t)` (proiezioni normalizzate e vincoli SQL inclusi). Se esiste:
     - stessa `version`: niente da fare;
     - versione locale maggiore e nessuna modifica server dopo la base comune: sostituzione;
     - altrimenti conflitto da risolvere (vedi sotto).
   - **Audit / outbox**: aggiunti con nuova sequenza server, mantenendo `id` e `createdAt` originali; `operator` = `device:<deviceId>`.
   - **Commands**: importati come chiavi idempotenti, così una ripetizione dal dispositivo non duplica nulla.
3. La risposta riporta, per ogni torneo: importato, invariato o in conflitto.

## Conflitti

Il modello è ad aggregato con un solo scrittore. La regola consigliata è che **un torneo abbia un solo dispositivo proprietario alla volta** (lease registrato sul server: `ownerDeviceId`, scadenza). Così il conflitto è un'eccezione e non il caso normale. Se comunque due copie divergono dalla stessa versione base:

- non si fondono automaticamente i punteggi: un merge automatico potrebbe attribuire un turno al giocatore sbagliato;
- il server conserva la propria versione e salva la copia del dispositivo come «ramo» in sola lettura;
- l'organizzatore sceglie quale tenere. La scelta è registrata in audit e la copia scartata resta esportabile.

Per una sincronizzazione continua basterebbe trasmettere i comandi (nome, input, chiave idempotente, versioni attese), non gli snapshot. Il server li riapplica con `Backend.execute`. Quelli che falliscono per `VERSION_CONFLICT` indicano esattamente dove serve una decisione umana. I record `commands` e l'outbox locale sono già la base di questa coda.

## Lavoro da fare quando servirà

- Endpoint di import ed export dell'archivio sul backend.
- Lease del torneo e scelta del dispositivo proprietario.
- Coda locale dei comandi in uscita e invio quando la rete c'è, riusando `HttpAdapter` per idempotenza e retry.
- Trasporto di notifica (SSE o WebSocket) sopra `NotificationAdapter` e l'outbox già esistenti.
- Unione dei giocatori con lo stesso nome ma ID diversi: oggi è un caso legittimo (omonimi), quindi solo manuale.
