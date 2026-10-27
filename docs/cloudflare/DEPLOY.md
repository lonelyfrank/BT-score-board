# Modalità cloud su Cloudflare

L'app gira su un Worker Cloudflare con un solo Durable Object (`GameRoom`). Il Durable Object esegue lo stesso motore della modalità standalone (`LocalEngine`), ma salva su SQLite invece che su IndexedDB. A questo si aggiungono gli account. Usa Workers, static assets e Durable Objects con SQLite, disponibili anche nel piano gratuito entro i suoi limiti (da verificare nella documentazione corrente: qui non si promette un uso gratuito illimitato).

```text
telefono (PWA) ──/api/*──▶ Worker ──▶ GameRoom (Durable Object, SQLite)
               ◀─ static ─ Worker static assets (apps/web/dist-cloud)
```

| Parte                          | File                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Worker, routing, backup        | `apps/worker/src/index.ts`, `wrangler.jsonc`                                                                        |
| Durable Object e API           | `apps/worker/src/room.ts`                                                                                           |
| Account, sessioni, inviti      | `apps/worker/src/accounts.ts`                                                                                       |
| Passkey (WebAuthn)             | `apps/worker/src/passkeys.ts`                                                                                       |
| Permessi sui metodi del motore | `apps/worker/src/rpc.ts`, `methods.ts`                                                                              |
| Motore su SQLite               | `packages/local-store/src/sql-database.ts`                                                                          |
| Punti, membership, segnapunti  | `apps/worker/src/access.ts`                                                                                         |
| Canale live (WebSocket)        | `apps/worker/src/live.ts`, `room.ts`                                                                                |
| Client                         | `apps/web/src/services/cloud.ts`, `live.ts`, `features/Login.tsx`, `features/Follow.tsx`, `features/PlaySpaces.tsx` |

## Ruoli

- **Proprietario (owner)**: è il primo account, creato con il codice di configurazione. Nomina e revoca gli admin. Il suo ruolo non si può cambiare né disattivare.
- **Admin**: crea partite, tornei, serate e giocatori. **Non** registra i punteggi delle partite altrui: segna solo le partite di cui è segnapunti (vedi [punti di incontro](PUNTI-DI-INCONTRO.md)). Invita i giocatori, collega gli account ai giocatori, genera codici per reimpostare la password e disattiva gli account dei giocatori. Fa backup e ripristini del server.
- **Giocatore**: accede al Bite the Trouble e ai punti di cui è membro, crea partite e punti di incontro, e ne è il segnapunti. Segue in sola lettura le partite a cui partecipa. Modifica nome, soprannome e colore del giocatore collegato al proprio account.

I permessi sono controllati sul server, metodo per metodo. Il client nasconde soltanto i pulsanti che l'utente non può usare. Quando un comando riguarda un torneo o un incontro, il server usa la propria copia dei dati: del client tiene solo l'id e le versioni, così un dato vecchio viene rifiutato e un client non può iniettare punteggi.

## Sicurezza

- Le password sono salvate con PBKDF2-SHA256 (100.000 iterazioni, sale per utente). Sessioni, inviti e codici di reset sono salvati solo come hash.
- Il cookie di sessione è `HttpOnly; Secure; SameSite=Strict` e vale 60 giorni, rinnovati con l'uso. Ogni `POST` controlla anche l'header `Origin`.
- Dopo 10 tentativi falliti in 15 minuti, per username o per IP, gli accessi vengono bloccati per qualche minuto.
- Gli inviti valgono 7 giorni e una sola registrazione. I codici di reset valgono 24 ore.
- Il cookie è tecnico e non c'è tracciamento, quindi non serve il banner dei cookie.

## Primo deploy

Requisiti: un account Cloudflare gratuito e le dipendenze installate (`pnpm install`).

```sh
cd apps/worker
npx wrangler login
# Codice per creare l'account del proprietario: lungo, casuale, da non condividere.
openssl rand -base64 24 | npx wrangler secret put OWNER_SETUP_CODE
cd ../..
pnpm deploy:cloud        # build della PWA in apps/web/dist-cloud, poi wrangler deploy
```

Wrangler stampa l'indirizzo, ad esempio `https://bt-darts.<account>.workers.dev`.

1. Apri l'indirizzo. La schermata **Primo avvio** chiede username, password e il codice di configurazione: quell'account diventa il proprietario.
2. Da **Impostazioni → Passkey** aggiungi una passkey per entrare con impronta o volto.

Le passkey sono legate al nome di dominio. Se in seguito passi a un dominio tuo, gli account e le password restano, ma le passkey vanno aggiunte di nuovo.

## Passare dai dati attuali (telefono) al cloud

1. Sul telefono con l'app standalone: **Impostazioni → Backup → Esporta backup**.
2. Nell'app cloud, entrando come proprietario: **Impostazioni → Backup → Ripristina**, poi scegli il file.
   - Se il server è vuoto i dati vengono importati.
   - Altrimenti puoi **unire** i dati, senza cancellare nulla. Per backup di più telefoni ripeti l'unione.
3. Per ogni persona che ha già giocato: **Giocatori → profilo → Account → Crea invito per questo giocatore**, poi condividi il codice. L'account creato con quell'invito è già collegato al suo storico.
4. Chi si è registrato con un invito generico si collega dal profilo del giocatore (**Oppure collega un account esistente**) o da **Impostazioni → Utenti**.
5. Collega anche il tuo account al tuo giocatore: **Impostazioni → Utenti → tu**.

Un doppione dello stesso giocatore, per esempio creato su due telefoni, si unisce come prima con **È un doppione di un altro giocatore?**.

## Aggiornare un'installazione esistente

Il binding `ROOM`, la classe `GameRoom`, l'istanza `main` e la migrazione `v1` **non cambiano**: nessun dato si sposta. Le tabelle nuove si creano da sole al primo avvio.

1. **Prima** di distribuire, con la versione attuale: **Impostazioni → Backup → Esporta backup**. Questo file (schema 5) si legge anche dalle versioni precedenti; i backup scritti dopo l'aggiornamento (schema 6) no.
2. Distribuisci (`pnpm deploy:cloud`). Gli account, le passkey, le sessioni e i collegamenti ai giocatori restano com'erano.
3. I tornei esistenti diventano **non classificati**: restano nello storico ma non contano in nessuna scoreboard. Da **Punti di incontro → Partite da assegnare** scegli quali assegnare al BT o ad altro punto.
4. Le partite esistenti **non hanno un segnapunti**. Per proseguire una partita in corso, un admin apre la partita e usa **Assumi il segnapunti** (con conferma; resta tracciato).
5. Verifica con un secondo account: crea una partita al BT con il primo, aprila con il secondo (sola lettura, aggiornamenti senza ricaricare).

**Rollback**: ridistribuire la versione precedente funziona (i dati aggiunti vengono ignorati; account e partite restano). Non sono previste migrazioni distruttive. Per tornare indietro con i dati conviene il backup del punto 1. Le partite create dopo l'aggiornamento restano nel Durable Object ma i nuovi punti di incontro e la divisione per punto non sono visibili alla versione vecchia.

## Configurazione

Nessun nuovo secret né binding. Il canale live usa la WebSocket Hibernation API sullo stesso Durable Object. I limiti e i costi di richieste, durata e messaggi WebSocket dipendono dal piano Cloudflare e cambiano nel tempo: non li ho verificati, controllali nella documentazione corrente. Questo progetto non dichiara un uso gratuito illimitato.

## Backup

- In qualunque momento: **Impostazioni → Backup → Esporta backup** (solo admin). Il file è lo stesso formato della modalità standalone.
- Backup automatico giornaliero: crea un bucket R2 (`npx wrangler r2 bucket create bt-darts-backups`), poi togli il commento a `r2_buckets` in `wrangler.jsonc` e rifai il deploy. Il cron delle 05:00 UTC scrive `backups/bt-darts-AAAA-MM-GG.json`. Il piano gratuito di R2 include 10 GB. Per attivare R2 potrebbe servire aggiungere un metodo di pagamento all'account, anche se si resta nei limiti gratuiti: verifica nella dashboard.

## Sviluppo locale

```sh
printf 'OWNER_SETUP_CODE=prova-locale\n' > apps/worker/.dev.vars
pnpm dev:cloud           # build cloud + wrangler dev su http://127.0.0.1:8787
```

Per lavorare sull'interfaccia con hot reload, tieni attivo `wrangler dev` e in un altro terminale lancia `pnpm --filter @bt/web dev:cloud` (Vite su 5173, `/api` inoltrato a 8787).

I test (`pnpm test`, file `tests/cloud.test.ts`) eseguono motore, account e permessi in Node: lo storage del Durable Object è sostituito da better-sqlite3.

## Limiti noti

- Chi segue una partita riceve gli aggiornamenti dal canale live (WebSocket); il resto dell'app e il ripiego senza canale usano il controllo della revisione ogni 5 secondi, solo mentre l'app è visibile.
- Senza rete l'app si apre (PWA) ma non carica né salva dati. Per serate senza connessione resta disponibile la build standalone.
- Chi non è il segnapunti vede la partita in sola lettura, senza controlli per inserire, correggere, annullare o mettere in pausa. Il controllo vero è sul server, anche con chiamate dirette all'API.
- «Tocca a te» vale solo con l'app aperta e la connessione attiva: non ci sono notifiche in background. Non esiste una coda offline.
