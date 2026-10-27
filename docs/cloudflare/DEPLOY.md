# Modalità cloud su Cloudflare

L'app gira su un Worker Cloudflare con un solo Durable Object (`GameRoom`). Il Durable Object esegue lo stesso motore della modalità standalone (`LocalEngine`), ma salva su SQLite invece che su IndexedDB. A questo si aggiungono gli account. Tutto rientra nel piano gratuito: Workers, static assets e Durable Objects con SQLite.

```text
telefono (PWA) ──/api/*──▶ Worker ──▶ GameRoom (Durable Object, SQLite)
               ◀─ static ─ Worker static assets (apps/web/dist-cloud)
```

| Parte                          | File                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Worker, routing, backup        | `apps/worker/src/index.ts`, `wrangler.jsonc`                                   |
| Durable Object e API           | `apps/worker/src/room.ts`                                                      |
| Account, sessioni, inviti      | `apps/worker/src/accounts.ts`                                                  |
| Passkey (WebAuthn)             | `apps/worker/src/passkeys.ts`                                                  |
| Permessi sui metodi del motore | `apps/worker/src/rpc.ts`, `methods.ts`                                         |
| Motore su SQLite               | `packages/local-store/src/sql-database.ts`                                     |
| Client                         | `apps/web/src/services/cloud.ts`, `features/Login.tsx`, `features/Account.tsx` |

## Ruoli

- **Proprietario (owner)**: è il primo account, creato con il codice di configurazione. Nomina e revoca gli admin. Il suo ruolo non si può cambiare né disattivare.
- **Admin**: crea partite, tornei, serate e giocatori, e registra i punteggi. Invita i giocatori, collega gli account ai giocatori, genera codici per reimpostare la password e disattiva gli account dei giocatori. Fa backup e ripristini del server.
- **Giocatore**: vede tutto. Modifica solo nome, soprannome e colore del giocatore collegato al proprio account.

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

- Le modifiche fatte da altri telefoni arrivano con un controllo della revisione ogni 5 secondi, solo mentre l'app è visibile.
- Senza rete l'app si apre (PWA) ma non carica né salva dati. Per serate senza connessione resta disponibile la build standalone.
- Nella partita live un giocatore non admin vede punteggi e cronologia, ma non i controlli per inserire, correggere, annullare o mettere in pausa. Anche qui il controllo vero è sul server.
