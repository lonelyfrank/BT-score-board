# Persistenza, migrazioni e backup

SQLite tramite better-sqlite3 e Drizzle ORM. `SqliteStore` applica migrazioni all'apertura. `pnpm db:migrate` permette di eseguirle esplicitamente. La migrazione versionata `packages/database/src/migrations/0001.ts` è SQL incorporato nel build: non dipende da file nella directory dei sorgenti dopo la compilazione.

`schema_migrations` conserva versione, checksum SHA-256 e data. La riapertura è idempotente; una versione ignota o un checksum modificato interrompe l'avvio. Per evolvere lo schema, aggiungere una nuova migrazione e un nuovo passo nel runner: non cambiare la migrazione 0001 dopo il rilascio. Il runner attuale gestisce la versione iniziale 1. La definizione Drizzle rappresenta i tipi e le colonne; il SQL versionato è autorevole per vincoli compositi, CHECK e trigger.

Impostazioni: foreign_keys ON, WAL per file su disco, synchronous FULL, busy_timeout 5000 ms. Le transazioni di comando sono immediate e atomiche. I limiti del database comprendono FK di appartenenza composte, iscrizioni e seed unici per torneo, ordine unico dei partecipanti, turni unici per giocatore, slot di punteggio unici se non annullati e punteggi interi non negativi. I trigger impediscono di aggiornare/cancellare audit ed eventi e di mescolare totale e singoli lanci.

Lo snapshot JSON del torneo è la fonte di verità dell'aggregato applicativo. Tabelle relazionali: players, events, tournaments, tournament_entries, stages, competition_groups, matches, match_participants, turns, score_entries, tournament_results. Le proiezioni si aggiornano insieme allo snapshot; non modificarle manualmente. Audit e outbox sono append-only. Idempotency conserva fingerprint e risposta originale senza scadenza automatica per garantire replay dopo riavvio.

I dati sono conservati sul filesystem locale. Non mettere il file SQLite in cartelle di sincronizzazione cloud o filesystem di rete. Proteggere directory, database, WAL, backup e `.env` tramite permessi del sistema operativo. I dati non sono cifrati a riposo dal backend.

## Backup online

```sh
DATABASE_PATH=./data/darts.sqlite pnpm db:backup ./backups/serata-01.sqlite
```

Lo script usa la SQLite Online Backup API; funziona con WAL e scritture concorrenti. Rifiuta una destinazione già esistente e lo stesso percorso del sorgente. Non copiare soltanto il file principale mentre il server è in esecuzione: il WAL potrebbe contenere gli ultimi risultati.

## Ripristino

1. Arrestare il server e qualsiasi processo che accede al database.
2. Conservare il database corrente e i suoi sidecar per eventuale recupero.
3. Scegliere un **nuovo percorso** per il database ripristinato, copiarvi il backup e configurare DATABASE_PATH. Non affiancargli vecchi file `-wal` o `-shm`.
4. Eseguire `pnpm db:migrate`; opzionalmente verificare con `sqlite3 <file> 'PRAGMA integrity_check; PRAGMA foreign_key_check;'`.
5. Avviare il server e rileggere il torneo/turno corrente.

Le prove automatiche verificano riavvio durante la partita, retry dopo riavvio, backup e apertura del backup, checksum migrazioni, rollback a metà comando e conflitti fra connessioni indipendenti. SQLite non può proteggere dalla perdita fisica dell'intero dispositivo: conservare copie periodiche dei backup su un supporto separato.
