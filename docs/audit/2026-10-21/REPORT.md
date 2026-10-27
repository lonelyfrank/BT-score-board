# BT Darts Score Board — analisi e test

Data del rapporto: **21 ottobre 2026**, fuso Europe/Rome.
Commit analizzato: `ad39df7d158bb5c22abf6d3c6785866f941aa7ad`.
Ambiente: Linux, Node `22.23.1`, npm `10.9.8`, dipendenze già installate.

## Esito

Il progetto supera i **220 test automatici Vitest**, i controlli TypeScript,
la formattazione e le build server, standalone e shared. Superato anche lo smoke test
HTTP con creazione dati e recupero dopo riavvio. Sono stati riprodotti **due difetti
funzionali non intercettati dalla suite esistente**, descritti sotto.

Anche i **23 test Playwright sono superati** (3 shared e 20 standalone), in circa
2,4 minuti, con Chromium visibile e tracce di tutte le prove. Totale delle suite:
**243 test superati**. Le due prove diagnostiche aggiuntive hanno invece confermato
i difetti descritti sotto.

L'attività riguarda analisi e verifica: il codice applicativo non è stato modificato.
Il rapporto e le evidenze sono nuovi file. I test lavorano con dati di prova, SQLite
temporaneo/in memoria e contesti browser isolati.

## Struttura e funzionamento

La webapp è un companion manuale del totem Pub Time Darts. Gestisce otto giochi,
giocatori, squadre, serate, partite libere, Hi-Score Nights, gironi e fasi a eliminazione.
Il risultato ufficiale inserito dall'organizzatore resta distinto dalle osservazioni
sui round e dalle freccette registrate.

| Area                            | Responsabilità                                                                  | Valutazione                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                      | React, React Router, TanStack Query, Vite, interfaccia mobile                   | Schermate e adapter condivisi fra le due modalità; tastierino, bozze, correzioni e guida dei turni hanno test dedicati.                               |
| `packages/domain`               | Giochi, punteggi, round, turni, squadre, manche, classifiche, calendari e stati | Logica indipendente da HTTP e database; scenari di pareggio, ritiro, riapertura e bust verificati dalla suite.                                        |
| `packages/contracts`            | Schemi Zod e contratti di input/output                                          | Validazione utilizzata dal backend e dall'API; OpenAPI verificato.                                                                                    |
| `packages/application`          | Comandi, autorizzazione, versioni, idempotenza, audit e outbox                  | Un servizio applicativo comune permette di confrontare SQLite e motore locale.                                                                        |
| `packages/local-store`          | MemoryStore, IndexedDB, migrazioni, backup                                      | Scritture serializzate; commit atomico prima della conferma; controllo della revisione fra schede; backup con checksum e validazione dei riferimenti. |
| `packages/database`             | SQLite e proiezioni relazionali                                                 | Transazioni, WAL, chiavi esterne, migrazioni con checksum, audit append-only e backup verificati.                                                     |
| `apps/api`                      | Fastify, autenticazione bearer, rate limit, errori e file statici               | Letture protette per default; modalità spectator opzionale; difetto confermato nel routing di `/serate`.                                              |
| `scripts` e configurazione      | Build, smoke, seed, OpenAPI, deploy statico Vercel                              | Build riuscite. Lo smoke usa un database temporaneo. Nessun deploy effettuato.                                                                        |
| `tests`, `apps/web/e2e`, `docs` | Verifiche automatiche e documentazione                                          | Copertura funzionale ampia; numeri dei test nel README obsoleti.                                                                                      |

In **standalone**, il percorso è React → adapter locale → servizio applicativo →
dominio → MemoryStore/IndexedDB. La PWA memorizza la shell per l'uso offline;
l'archivio resta sul dispositivo e viene trasferito tramite backup.

In **shared**, React usa l'adapter HTTP → Fastify → lo stesso servizio applicativo e
dominio → SQLite. Il token dell'organizzatore è conservato per scheda in
`sessionStorage`. Non è implementata una sincronizzazione automatica tra archivio
standalone e backend shared.

## Verifiche eseguite

| Verifica                               | Risultato                                             | Evidenza                                       |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| TypeScript server, package e web       | Superata                                              | `evidence/check.log`                           |
| Vitest                                 | **18 file, 220 test superati**                        | `evidence/check.log`                           |
| Build server, PWA standalone e shared  | Superate                                              | `evidence/check.log`                           |
| Prettier sull'intero progetto iniziale | Superato                                              | `evidence/format.log`                          |
| Smoke HTTP del codice compilato        | Superato dopo autorizzazione delle porte locali       | `evidence/smoke.txt`                           |
| OpenAPI salvato rispetto al generato   | Identici; **59 percorsi**                             | `evidence/probes.json`                         |
| Percorsi HTML del server shared        | 4 percorsi di controllo corretti; `/serate` difettoso | `evidence/probes.json`                         |
| Ripresa con archivio di 101 tornei     | Difetto riprodotto                                    | `evidence/pagination.json`                     |
| Playwright Chromium                    | **23/23 superati**, nessun test saltato               | `evidence/e2e.txt`, report Playwright e tracce |

Lo smoke controlla davvero health HTTP, rifiuto di letture senza token, creazione di
un giocatore, chiusura e riapertura del server e lettura del dato persistito.
Il primo tentativo nel sandbox ha ricevuto `listen EPERM`: è un limite dell'ambiente,
superato con l'autorizzazione, non un errore dell'applicazione.

La suite Vitest include dominio, modalità torneo, API, SQLite, equivalenza degli
store, IndexedDB simulato con fake-indexeddb, rollback, backup e trasferimento,
idempotenza, schede obsolete, guida dei turni e adapter frontend.
Il numero di test superati non equivale a una percentuale di copertura del codice:
non è stata misurata la coverage.

Playwright ha verificato flussi completi shared, guida con tre freccette e totali,
squadre disomogenee, correzioni e undo, layout, tastiera, serata da 19 partecipanti,
ripristino dopo reload, doppio tap, trasferimento di un torneo in corso con 12
giocatori, uso offline, aggiornamento PWA, gironi 501, Odd & Even, Exacta,
Shanghai, Game Night, backup e manche multiple. Gli screenshot raccolti in
`evidence/screenshots` provengono da questa esecuzione; due schermate della guida
sono state anche ispezionate visivamente. Non è un confronto pixel per pixel.

## Difetti confermati

### 1. Shared: apertura diretta di Game Night non funzionante

**Priorità media.** File: `apps/api/src/plugins/web.ts:16`.

Il frontend registra `/serate` in `apps/web/src/main.tsx` e la Home contiene il link
Game Night, ma Fastify non include questo percorso tra quelli che servono l'HTML.
La navigazione interna può funzionare, mentre il ricaricamento o un segnalibro
falliscono.

| Richiesta                                         | Atteso              | Osservato     |
| ------------------------------------------------- | ------------------- | ------------- |
| `GET /serate`, senza token                        | 200, HTML della SPA | **401**, JSON |
| `GET /serate`, con token                          | 200, HTML della SPA | **404**, JSON |
| `GET /`, `/tornei`, `/giocatori`, `/impostazioni` | 200, HTML           | 200, HTML     |

Riproduzione effettuata con Fastify `inject` sul server compilato e SQLite in memoria.
Intervento proposto: aggiungere `/serate` al routing statico e un controllo dei link
diretti delle pagine frontend in modalità shared.

### 2. Home: la ripresa ignora i tornei oltre la prima pagina

**Priorità media, attivata da archivi più grandi.** File:
`apps/web/src/services/session.ts:20`.

`activeSession()` cerca un torneo attivo o sospeso solo nella prima chiamata a
`api.tournaments()`. Entrambi gli adapter restituiscono al massimo 100 elementi.

Riproduzione con adapter locale reale e IndexedDB simulato:

1. Creare e avviare un torneo con due giocatori: la sessione viene trovata.
2. Creare altri 100 tornei in bozza.
3. Richiamare `activeSession()`: restituisce **null**.
4. Leggere `api.tournaments(100)`: il torneo originale è ancora **active**.

Il collegamento «Riprendi» scompare dalla Home, anche se i dati e il torneo restano
presenti. Non è stata osservata una perdita di dati. Intervento proposto: ricercare
gli stati attivi sullo store/API o scorrere le pagine fino a trovare la sessione.
Anche `recentResults()` usa solo la prima pagina e merita la stessa revisione;
quest'ultima osservazione deriva dalla lettura del codice, non da una prova separata.

## Manutenzione e lacune

- **README non aggiornato:** dichiara 178 test Vitest e 20 flussi E2E; la suite attuale
  contiene 220 test Vitest e 23 scenari Playwright.
- **Comando di controllo incompleto per un rilascio:** `npm run check` esegue
  TypeScript, Vitest e build; E2E, smoke e formattazione sono comandi separati.
  Non risultano workflow GitHub Actions versionati nel repository analizzato.
- **Componenti grandi:** `Guided.tsx` ha 1.860 righe, `Result.tsx` 1.147 e il servizio
  `backend.ts` 847. È un costo di manutenzione, non un difetto funzionale dimostrato.
  Separare responsabilità e sezioni dell'interfaccia aiuterebbe modifiche future.
- **Prove su dispositivi reali ancora necessarie:** i test di layout usano sei
  viewport Chromium, da 320×568 a 844×390. Safari iOS, installazione su telefoni
  reali, tastiera del sistema, pressione sullo storage e comportamento del totem
  non sono certificati da queste prove.

La revisione ha attraversato tutte le aree del repository e approfondito i percorsi
di dati, persistenza, API, navigazione, scoring e verifica. Non è una certificazione
di assenza di bug, un penetration test, un audit delle vulnerabilità delle dipendenze
o una prova di carico. Le assunzioni sulle regole del totem già indicate nella
documentazione di rilascio restano da verificare sul dispositivo fisico.

## Consultazione in ChatGPT nel browser

Questo file è pensato per essere allegato a una chat o a un progetto ChatGPT.
Contiene contesto, commit, risultati, difetti e limiti anche senza accesso al repository.
`report.html` contiene la versione leggibile nel browser e gli screenshot incorporati.

Testo da usare dopo aver allegato il rapporto:

> Usa questo rapporto come contesto del progetto BT Darts Score Board, verificato il
> 21 ottobre 2026 sul commit ad39df7. Distingui i test superati dai due difetti
> riprodotti: /serate in shared e Riprendi oltre 100 tornei. Non considerare i difetti
> già corretti. Per modificare il codice chiedi accesso alla versione attuale.

Non è stata effettuata una scrittura nella memoria personale di ChatGPT né un upload
automatico. In questa sessione non erano disponibili documenti ChatGPT collegati.
La documentazione ufficiale descrive l'uso dei file caricati e dei progetti per
condividere il contesto fra le chat del progetto:
[Projects and chats](https://learn.chatgpt.com/docs/projects).

## Ripetere le verifiche

Dalla radice del repository, con dipendenze e Chromium Playwright già installati:

```sh
npm run check
npm run format:check
npm run smoke
PLAYWRIGHT_HTML_OPEN=never npm run test:e2e --prefix apps/web -- --reporter=line,html --trace on
```

Per consultare passi, tempi e tracce della sessione browser:

```sh
cd apps/web
./node_modules/.bin/playwright show-report playwright-report --host 127.0.0.1
```

Il report Playwright e i suoi allegati si trovano in `apps/web/playwright-report`;
gli output per test in `apps/web/test-results`. Queste directory sono escluse da Git
e vengono sovrascritte dalle esecuzioni successive. Per conservarle integralmente,
copiarle prima di rilanciare la suite. Il presente rapporto e le sue evidenze hanno
una directory dedicata per data.
