# Architettura standalone

```text
React (features/*)                 nessuna conoscenza della persistenza
  └─ GameAdapter (services/game.ts)
       ├─ LocalGameAdapter         predefinito: tutto nel browser, nessuna richiesta HTTP
       │    └─ LocalEngine         coda seriale dei comandi, commit, schede, backup
       │         ├─ Backend        packages/application, invariato
       │         │    └─ dominio   packages/domain, unica fonte delle regole
       │         ├─ MemoryStore    porta Store su snapshot in memoria con overlay
       │         └─ LocalDatabase  IndexedDB (idb), una transazione per comando
       └─ HttpAdapter              modalità shared: API Fastify + SQLite
```

La modalità si sceglie in build: `vite build` produce la PWA standalone in `apps/web/dist`; `vite build --mode shared` produce in `dist-shared` la versione servita da Fastify, identica a prima e senza service worker. Le schermate sono le stesse; `pollInterval` e il pannello Impostazioni cambiano in base alla modalità.

## Perché uno store in memoria

La porta `Store` dell'application è sincrona (`transaction(work)`), come SQLite. IndexedDB è asincrono e chiude le transazioni se si attende altro codice. Per riusare il `Backend` senza riscriverlo, `MemoryStore` implementa la porta su uno snapshot caricato all'avvio:

1. `LocalEngine.write` esegue il comando nel `Backend` dentro `MemoryStore.stage()`. Le scritture vanno in un overlay, le letture vedono overlay + stato confermato.
2. L'overlay diventa un `ChangeSet` (giocatori, eventi, aggregati Tournament, audit, outbox, record dei comandi).
3. `LocalDatabase.commit` lo scrive in **una** transazione `readwrite` con `durability: 'strict'`, insieme all'incremento della revisione.
4. Solo dopo l'evento `complete` lo stato confermato in memoria viene aggiornato e la promessa del comando si risolve. La UI mostra «Turno salvato» solo a quel punto.
5. Se il dominio rifiuta il comando o IndexedDB fallisce, l'overlay viene scartato: memoria e disco restano allo stato precedente.

I comandi passano da una coda seriale. Le letture vedono sempre e solo stato confermato.

Un risultato (`RecordResult`) è un comando come gli altri: un commit, poi la conferma «Punteggio salvato». La chiave di idempotenza nasce con il risultato che si sta inserendo e cambia solo dopo il successo: un secondo tocco con la stessa chiave è una ripetizione esatta (nessuna scrittura), un tocco su dati ormai cambiati fallisce sul controllo di versione. Per i tornei a turni esistenti `RecordScore` e `CompleteTurn` restano confermati nello stesso commit.

### Perché `idb` e non Dexie

Lo strato IndexedDB esistente usa `idb` (1 kB) ed è già verificato: una transazione `readwrite` con `durability: 'strict'` per comando, controllo di revisione fra schede, migrazioni ordinate, errori di quota tradotti in `STORAGE_FULL`. Dexie aggiungerebbe query reattive e una sintassi di schema, ma qui le letture passano dallo snapshot in memoria e la reattività arriva dagli eventi del motore (`subscribe`, `BroadcastChannel`). Sostituirlo non porterebbe funzionalità e rimetterebbe in gioco codice collaudato; per lo stesso motivo non c'è Zustand (lo stato UI è locale ai componenti e alla cache di TanStack Query, la fonte di verità è IndexedDB) né Tailwind (design system CSS esistente).

## Schema IndexedDB (versione 3)

| Store         | Chiave     | Contenuto                                                                                           |
| ------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `players`     | `id`       | Player (con `avatar` facoltativo, preset)                                                           |
| `events`      | `id`       | PubEvent                                                                                            |
| `tournaments` | `id`       | Aggregato completo: formato, gioco, iscrizioni, fasi, gironi, incontri con `result`, piazzamenti    |
| `audit`       | `sequence` | Operation append-only, indice `tournamentId`                                                        |
| `outbox`      | `sequence` | ApplicationEvent append-only, indice `tournamentId`                                                 |
| `commands`    | `key`      | Record idempotente compatto: chiave, fingerprint, torneo, versione, data (indice `createdAt`)       |
| `meta`        | `key`      | `deviceId`, `revision`, ultimo commit, ultimo backup, modifiche dopo il backup, ultima importazione |

L'aggregato Tournament è l'unità di consistenza, come lo snapshot JSON di SQLite: incontri e risultati non hanno store separati perché ogni comando li aggiorna insieme (un risultato può far avanzare il tabellone o chiudere la partita singola nella stessa scrittura). `MatchResult` vive dentro `Match.result`: rapporto 1:1, stessa transazione, nessun ID in più. Classifiche e statistiche non sono salvate, si calcolano dai risultati.

La migrazione 2 (`indexeddb.ts`) porta i dati della versione 1 al modello con giochi e risultati: ogni torneo esistente diventa `gameMode: 'HI_SCORE'`, `recording: 'turns'` (prosegue con l'inserimento a turni), `result: null` sugli incontri; i giocatori ricevono `avatar: null`. Gira nella transazione di upgrade: o tutto o niente. La stessa funzione (`upgradeTournament`, nel dominio) aggiorna i backup v1 all'importazione e le letture SQLite. `MemoryStore` ricontrolla i vincoli che SQLite impone con chiavi e trigger: unicità di iscrizioni, seed, slot punteggio e turni; riferimenti a giocatori ed eventi; modalità di inserimento coerente.

La migrazione 3 aggiunge squadre, manche, round e rotazioni (vedi [architettura competizioni](../competition/ARCHITECTURE.md#persistenza-e-migrazioni)). La V1.2 non cambia lo schema: resta alla versione 3.

Le migrazioni sono una lista ordinata (`migrations` in `indexeddb.ts`): la migrazione N porta da N a N+1 nella transazione `versionchange`. Un database scritto da una versione più recente non viene aperto (`LOCAL_SCHEMA_NEWER`), così nessun dato viene scartato. Se un'altra scheda aggiorna lo schema, questa chiude la connessione e chiede di ricaricare.

## Differenze rispetto a SQLite

- **Idempotenza**: SQLite salva per ogni chiave la risposta completa, cioè un torneo intero per comando. In locale il record è compatto. Le risposte restano in memoria per la sessione (ultime 200); dopo un riavvio, la ripetizione di una chiave nota restituisce l'aggregato corrente. I client rileggono comunque lo stato dopo ogni comando, quindi il comportamento osservabile è lo stesso.
- **Audit e outbox** non vengono caricati in memoria: si leggono da IndexedDB (`LocalEngine.audit`). In memoria si tiene solo l'ultima sequenza, così la numerazione continua senza buchi.
- **Ordinamento elenchi**: entrambi gli store ordinano i tornei per data di creazione (prima SQLite ordinava per UUID casuale).

I test `tests/standalone-equivalence.test.ts` eseguono gli stessi scenari Quick e a gironi, con ID e orologio deterministici, su SQLite e su MemoryStore. Tornei, classifiche, statistiche, storico, audit, eventi ed errori risultano identici.

## Più schede e ripristino

Ogni commit confronta la revisione in `meta` con quella caricata dalla scheda (CAS nella stessa transazione). Una scheda obsoleta riceve `STALE_DATA`, ricarica lo snapshot e l'utente ripete l'azione: nessuna sovrascrittura silenziosa. Dopo ogni commit un `BroadcastChannel` avvisa le altre schede, che si aggiornano da sole.

Dopo refresh o riavvio l'app ricarica lo snapshot. La Home mostra la partita da riprendere (giocatore al tiro, turno, ultimo punteggio confermato). Non esistono operazioni «a metà»: un commit interrotto non lascia nulla. Il valore digitato e non ancora confermato resta nella sessione della scheda ed è legato al turno (tornei a turni) o al partecipante per cui è stato digitato (risultati finali, V1.2), quindi non viene mai attribuito a un altro giocatore dopo un reload. Le bozze delle versioni precedenti, prive del partecipante, vengono scartate.

Se Safari chiude una connessione inattiva, `LocalDatabase` riapre e riprova, ma solo se la transazione non era ancora partita.

## Backup

Formato JSON `bt-darts-scoreboard-backup`, `formatVersion` 1, `schemaVersion` 2 (lo schema dei dati). File scaricato come `bt-darts-backup-YYYY-MM-DD.json`:

```json
{
  "format": "bt-darts-scoreboard-backup",
  "formatVersion": 1,
  "schemaVersion": 2,
  "exportedAt": "2026-10-18T22:40:00.000Z",
  "source": { "deviceId": "…", "revision": 214, "app": "0.2.0+abc1234" },
  "counts": {
    "players": 12,
    "events": 0,
    "tournaments": 3,
    "audit": 410,
    "outbox": 520,
    "commands": 400
  },
  "integrity": { "algorithm": "SHA-256", "digest": "…" },
  "data": {
    "players": [],
    "events": [],
    "tournaments": [],
    "audit": [],
    "outbox": [],
    "commands": []
  }
}
```

L'export legge tutti gli store in una transazione di sola lettura (copia coerente). Prima di toccare il dispositivo, l'import verifica in quest'ordine:

1. JSON e formato;
2. versione non più recente dell'app;
3. digest SHA-256 di `data`;
4. aggiornamento dei backup con `schemaVersion` precedente (stessa migrazione del database);
5. schemi Zod dei contratti esistenti;
6. conteggi;
7. unicità e riferimenti (giocatori, eventi, tornei, vincoli degli aggregati, risultati che citano solo giocatori dell'incontro).

Se esistono dati, la sostituzione richiede una conferma esplicita: l'interfaccia mostra il contenuto del file e propone di scaricare prima i dati attuali. La sostituzione avviene in una sola transazione, con lo stesso CAS dei comandi.

`changesSinceBackup` conta i commit successivi all'ultimo export. Il backup è consigliato dopo un torneo concluso, o dopo 50 modifiche non esportate.

## PWA

vite-plugin-pwa genera `sw.js` (Workbox) con:

- precache di app, font, immagini e icone;
- `navigateFallback: /index.html` per i deep link;
- `cleanupOutdatedCaches`.

`registerType: 'prompt'` e `skipWaiting: false`: una nuova versione resta in attesa. L'avviso «Nuova versione disponibile» non appare in partita live né nei moduli di creazione; l'utente aggiorna quando vuole, da avviso o da Impostazioni. Dalla V1.2 anche un backup in esportazione, in lettura, in anteprima o in importazione trattiene l'aggiornamento (`useUpdateHold` in `services/pwa.ts`): avviso nascosto e «Aggiorna ora» disabilitato finché l'operazione non termina. Chiudere e riaprire l'app installata attiva la nuova versione: i dati sono già in IndexedDB. Un controllo aggiornamenti parte ogni ora solo con app visibile e online. TanStack Query usa `networkMode: 'always'` in standalone: altrimenti, offline, le letture locali resterebbero in pausa.

Bundle (gzip): React 65 kB, app 25 kB, engine 21 kB, Zod 27 kB. I chunk separati mantengono l'hash fra versioni, quindi un aggiornamento scarica solo ciò che cambia.
