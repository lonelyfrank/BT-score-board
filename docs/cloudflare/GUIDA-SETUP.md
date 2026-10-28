# Guida: mettere online BT Darts su Cloudflare

BT Darts è l'app per segnare i punteggi delle serate a freccette. Qui la mettiamo online su Cloudflare, gratis, con account e password per ogni giocatore. Questa guida porta dal computer pulito all'app funzionante. Ci vogliono circa 20 minuti.

## Cosa serve

- Un computer con **Node.js 22.19 o più recente** (controlla con `node --version`).
- **pnpm** (se manca: `npm install -g pnpm`).
- **Git**.
- Un account **Cloudflare gratuito**. Si crea su https://dash.cloudflare.com/sign-up. Non serve la carta di credito.
- Il codice del progetto, scaricato con `git clone` dall'indirizzo che ti è stato passato. Il lavoro è sul branch `feat/cloudflare-accounts`:

```sh
git clone <indirizzo-del-progetto> BT-score-board
cd BT-score-board
git checkout feat/cloudflare-accounts
pnpm install
```

## Passo 1: collega il terminale a Cloudflare

```sh
cd apps/worker
npx wrangler login
```

Si apre il browser: accedi a Cloudflare e premi **Allow**. Se il terminale non ha un browser, copia il link che stampa e aprilo a mano.

## Passo 2: pubblica l'app

Dalla cartella principale del progetto:

```sh
cd ../..
pnpm deploy:cloud
```

Alla fine Wrangler stampa l'indirizzo dell'app, simile a:

```text
https://bt-darts.<nome-account>.workers.dev
```

**Copialo e conservalo**: è l'indirizzo che useranno tutti. Se Wrangler chiede di scegliere un nome per il sottodominio `workers.dev`, scegline uno a piacere.

## Passo 3: imposta il codice del proprietario

Il primo account che si crea diventa il **proprietario** dell'app (può nominare gli admin e fare i backup). Per evitare che lo crei un estraneo, serve un codice segreto, da usare una sola volta.

1. Genera il codice e **salvalo in un posto sicuro** (password manager, nota privata):

   ```sh
   openssl rand -base64 24
   ```

2. Caricalo su Cloudflare:

   ```sh
   cd apps/worker
   npx wrangler secret put OWNER_SETUP_CODE
   ```

   Quando lo chiede, incolla il codice e premi Invio.

Il codice non è più visibile dopo questo passaggio, quindi tienine una copia.

## Passo 4: crea l'account proprietario

1. Apri l'indirizzo dell'app dal telefono o dal computer.
2. Nella schermata **Primo avvio** inserisci username, password e il codice del passo 3.
3. Vai in **Impostazioni → Passkey** e aggiungi una passkey, così le volte dopo si entra con impronta o volto.

La passkey vale per quell'indirizzo. Se un giorno si cambia indirizzo, le password restano valide ma le passkey vanno aggiunte di nuovo.

## Passo 5: porta i dati esistenti (se ce ne sono)

Su un telefono che usa già la versione precedente dell'app:

1. **Impostazioni → Backup → Esporta backup**, e invia il file al proprietario.
2. Nell'app online, da proprietario: **Impostazioni → Backup → Ripristina**, e scegli il file.
   - Se l'app è vuota i dati vengono importati.
   - Altrimenti puoi **unire** i dati, senza cancellare nulla. Se i backup sono di più telefoni, ripeti l'unione.

## Passo 6: invita i giocatori

Per ogni persona che ha già giocato:

1. **Giocatori → profilo del giocatore → Account → Crea invito per questo giocatore**.
2. Manda il codice di invito alla persona. Vale 7 giorni e una sola registrazione.
3. La persona apre l'indirizzo, sceglie **Ho un invito**, inserisce il codice invito, uno username e una password, e preme **Crea account**: il suo account è già collegato al suo storico.

Per chi si registra con un invito generico: il proprietario lo collega al suo giocatore dal profilo del giocatore (**Oppure collega un account esistente**) o da **Impostazioni → Utenti**.

Non dimenticare di collegare anche il tuo account al tuo giocatore: **Impostazioni → Utenti → il tuo nome**.

## Ruoli in breve

- **Proprietario**: tutto, compresa la nomina degli admin.
- **Admin**: crea partite e tornei, registra i punteggi, invita i giocatori, fa i backup.
- **Giocatore**: vede tutto, ma modifica solo il proprio profilo. Non può inserire punteggi.

## Facoltativo: backup automatico ogni giorno

```sh
cd apps/worker
npx wrangler r2 bucket create bt-darts-backups
```

Poi in `apps/worker/wrangler.jsonc` togli il commento al blocco `r2_buckets` e rifai `pnpm deploy:cloud` dalla cartella principale. Ogni giorno alle 05:00 UTC viene salvato un file in `backups/`.

Attenzione: per attivare R2 Cloudflare può chiedere un metodo di pagamento, anche se poi si resta nei 10 GB gratuiti. Se non vuoi, salta questo passo e fai ogni tanto **Impostazioni → Backup → Esporta backup**.

## Se qualcosa non va

- **`wrangler login` non completa**: riprova, oppure `npx wrangler login --browser=false` e segui le istruzioni.
- **«Primo avvio» non accetta il codice**: controlla di aver incollato proprio quello del passo 3, senza spazi. Se l'hai perso, ripeti il passo 3 con un codice nuovo (funziona finché il proprietario non è stato creato).
- **Password dimenticata**: un admin genera un codice di reset da **Impostazioni → Utenti** (vale 24 ore).
- **Dopo aver cambiato il codice, l'app non si aggiorna**: i secret valgono subito, senza nuovo deploy. Per cambiare l'app, invece, serve rifare `pnpm deploy:cloud`.

## Provare tutto in locale prima di pubblicare (facoltativo)

```sh
printf 'OWNER_SETUP_CODE=prova-locale\n' > apps/worker/.dev.vars
pnpm dev:cloud
```

Poi apri http://127.0.0.1:8787 e usa `prova-locale` come codice. I dati locali non finiscono online.

## Sviluppare in locale con i dati reali

Per provare in locale il codice nuovo con i tuoi account e i dati online:

1. crea `apps/web/.env.local` (non va su git) con l'indirizzo del Worker:
   `BT_API_TARGET=https://bt-darts.<tuo-sottodominio>.workers.dev`
2. avvia `npm run dev:online` e apri `http://127.0.0.1:5173`.

Il frontend gira sul tuo PC, le chiamate `/api` vanno al server online.

- Entra con **username e password**: le passkey sono legate al dominio online e in locale non
  funzionano.
- Ogni modifica (punteggi, giocatori, account) è **reale**: per esperimenti usa
  `npm run dev:cloud` (Worker e dati locali di `wrangler dev`), oppure un tuo account non admin.
- Senza `BT_API_TARGET`, `dev:cloud` del frontend resta collegato al Worker locale
  (`127.0.0.1:8787`).
