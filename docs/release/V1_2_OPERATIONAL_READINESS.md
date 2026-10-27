# BT Darts Score Board — V1.2 Operational Readiness

Report dell'intervento del 20 ottobre 2026 sul branch `feat/v1.2-operational-readiness`, partito da `feat/standalone-pwa` @ `d004035` (V1.1). Nessun push e nessun merge su `main`.

La V1.2 è un consolidamento: nessuna nuova modalità, nessun servizio esterno, schema IndexedDB invariato (versione 3), modello di dominio e adapter invariati salvo la correzione della rotazione descritta sotto. Il totem resta l'unica autorità su regole e risultati; l'app non vi si collega.

## Baseline

| Voce                    | Stato iniziale (HEAD `d004035`)                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Ambiente                | Fedora 44, Node 22.23.1; pnpm non installato globalmente, usato via `npx pnpm@12.14.0` (versione fissata nel repo) |
| `pnpm install --frozen` | OK, lockfile già allineato; nessuna dipendenza modificata in tutto l'intervento                                    |
| Dipendenze chiave       | TypeScript 7.0.2, Vitest 5.0.5, Vite 6.4.4, vite-plugin-pwa 1.3.0, workbox-window 7.4.1, Playwright 1.64.1         |
| Typecheck               | Pulito (server, web, config Node)                                                                                  |
| Test Vitest             | 155/155 in 12 file                                                                                                 |
| Build standalone/shared | OK entrambe                                                                                                        |
| E2E Playwright          | 12/13: fallito `starts, navigates and saves scores offline…` sul controllo del font Oswald                         |
| `format:check`          | Fallito su `apps/web/index.html`                                                                                   |
| Linting                 | Il repository non ha ESLint configurato: l'unico controllo di stile è Prettier                                     |
| Script                  | Gli script `pnpm check/test/test:e2e` invocano `npm run` internamente: funzionano con entrambi i gestori           |
| Documentazione          | In parte superata: schema IndexedDB indicato come v2 (è v3), «squadre non previste», catalogo «solo HI_SCORE»      |

## Audit

### Implementazioni individuate

| Elemento                                                    | Dove                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ResultEntry`                                               | `apps/web/src/features/Result.tsx`, montata da `features/Match.tsx`                      |
| `HeatEditor`, `HeatTimeline`                                | `apps/web/src/components/Heats.tsx`                                                      |
| `RoundScoreEntry`, `RotationManager`, `ScoreReconciliation` | `apps/web/src/components/Rounds.tsx`                                                     |
| `TeamBuilder`                                               | `apps/web/src/components/TeamBuilder.tsx` su `packages/domain/src/competition/teams.ts`  |
| `LocalGameAdapter`                                          | `apps/web/src/services/local.ts` su `LocalEngine` (`packages/local-store/src/engine.ts`) |
| Migrazioni IndexedDB                                        | `packages/local-store/src/indexeddb.ts` (`migrations`, 3 versioni) + `domain/upgrade.ts` |
| Backup export/import                                        | `packages/local-store/src/backup.ts`, UI in `features/Settings.tsx`                      |
| Ciclo di aggiornamento PWA                                  | `apps/web/src/services/pwa.ts`, `components/AppStatus.tsx`, `vite.config.ts`             |
| Navigation bar e layout mobile                              | `components/ui.tsx` (`BottomNavigation`), `styles/app.css`, `styles/tokens.css`          |

### Stato verificato

- **Dominio**: invarianti solide e già testate (composizione senza duplicati, manche mai piene per forza, nessun round mancante contato come zero, risultato ufficiale prevalente, riconciliazione con motivo, dipendenze delle correzioni con conferma esplicita).
- **Persistenza**: ogni comando è una transazione IndexedDB `durability: 'strict'` con CAS sulla revisione; la memoria si aggiorna solo dopo il commit; comandi serializzati; doppio tocco gestito da versioni ottimistiche e chiavi di idempotenza; import atomico con anteprima e conferma.
- **PWA**: precache completo, fallback SPA, `registerType: 'prompt'` senza `skipWaiting`, avviso mai in partita live.

### Problemi reali trovati

| #   | Gravità | Problema                                                                                                                                                                                                                                                    | Codice                       |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Alta    | Finita una manche, la schermata risultati selezionava da sola il primo giocatore **già registrato** con il tastierino attivo: il totale del primo giocatore della manche successiva, digitato senza toccare «AVVIA MANCHE», sovrascriveva il suo punteggio. | `Result.tsx` (`current`)     |
| 2   | Alta    | La bozza digitata e non confermata sopravviveva al reload senza il giocatore: dopo il reload ricompariva sotto il nome del primo giocatore in ordine, pronta a essere confermata per la persona sbagliata.                                                  | `Result.tsx` (`input`)       |
| 3   | Media   | Correggere un round di squadra lo attribuiva al tiratore successivo; annullare e reinserire un round faceva avanzare la rotazione una seconda volta.                                                                                                        | `domain/scoring/rounds.ts`   |
| 4   | Media   | «Aggiorna» della PWA restava disponibile durante l'anteprima o l'importazione di un backup: un reload poteva interrompere un ripristino.                                                                                                                    | `services/pwa.ts`, Settings  |
| 5   | Media   | Con la tastiera virtuale aperta la barra flottante poteva salire sopra la tastiera (Chrome con `resizes-content`, iOS) coprendo i campi.                                                                                                                    | `styles/app.css`             |
| 6   | Bassa   | Doppio tocco su «prossimo tiratore»: il secondo comando falliva con un errore di versione visibile (nessun dato sbagliato, ma un allarme inutile).                                                                                                          | `components/Rounds.tsx`      |
| 7   | Bassa   | Chiusura di una manche incompleta con `window.confirm`: non stilizzato, poco accessibile, senza i nomi dei mancanti.                                                                                                                                        | `Result.tsx`                 |
| 8   | Bassa   | Sottotitolo «0 da registrare» a manche completata anche con altre manche da giocare: contava solo la manche visualizzata.                                                                                                                                   | `Result.tsx`                 |
| 9   | Bassa   | A 320 px il quarto posto del totem finiva fuori dal tabellone (scorrimento interno), spesso proprio il giocatore in inserimento.                                                                                                                            | `Result.tsx`, `app.css`      |
| 10  | Test    | Il test PWA offline controllava il font con `document.fonts.check()` senza attenderne il caricamento: falliva per una race, non per l'app.                                                                                                                  | `e2e/standalone-pwa.spec.ts` |
| 11  | Doc     | Commento di `syncHeats` che descriveva una riapertura automatica delle manche non implementata; documentazione con riferimenti superati.                                                                                                                    | `heats.ts`, `docs/`          |

### Rischi valutati e lasciati invariati

- Il pulsante «annulla» del tastierino Hi-Score cancella il punteggio del giocatore selezionato senza ulteriore conferma. Dopo la correzione #1 è attivo solo su un giocatore toccato esplicitamente; l'operazione è reversibile e passa comunque dal controllo delle dipendenze. Nessuna conferma aggiuntiva introdotta (non prevista).
- Un valore digitato su una manche **in attesa** mentre il bersaglio è libero la avvia (comportamento di dominio esistente, `heatForEntry`): la schermata mostra già quella manche come «prossima», quindi i dati non finiscono altrove. Con una manche al bersaglio il dominio rifiuta (`HEAT_BUSY`) senza scrivere nulla (test dedicato).
- Riordinare gli oggetti nel backup dopo la validazione Zod cambia l'ordine delle chiavi JSON: il backup riesportato ha un digest diverso ma valido e dati identici (test dedicato). Non è un difetto.

### Criteri di accettazione adottati

Quelli della Definition of Done del mandato (sezione finale), con la regola che un comportamento è «verificato» solo se un test automatico lo esercita e fallisce senza la correzione, oppure se è stato controllato a vista e lo si dichiara come tale.

## Modifiche eseguite

| Commit    | Contenuto                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `1d8e6c3` | Formattazione di `index.html`; test offline dei font senza race                                                                      |
| `2920654` | Rotazione: tiratore ereditato dalle osservazioni precedenti, avanzamento solo alla prima; test operativi di dominio                  |
| `685cf6a` | Test di trasferimento backup di una serata in corso e di import interrotto                                                           |
| `df580a7` | Schermata risultati (#1, #2, #6–#9), `services/result-flow.ts`, test unitari e nuovi E2E operativi, helper E2E condivisi             |
| `5e6e99c` | Aggiornamento PWA trattenuto durante i backup (#4), barra e tastiera virtuale (#5), spazio per l'avviso di aggiornamento, E2E layout |
| (questo)  | Documentazione e verifica offline dell'esportazione backup                                                                           |

### Refactor

- `apps/web/src/services/result-flow.ts`: logica pura «chi è in inserimento», «chi viene dopo il salvataggio», serializzazione delle bozze. Estratta perché era la sede del difetto #1/#2 e non era testabile dentro il componente; ora ha test unitari. Le regole di dominio restano nel dominio.
- `apps/web/e2e/helpers.ts`: helper prima locali a `standalone.spec.ts`, spostati senza modifiche per condividerli con le nuove suite.
- `Result.tsx` resta un componente grande: una decomposizione ulteriore (form dei giochi a vincitore, pannello manche) sarebbe solo estetica senza nuovi test a supporto ed è stata rimandata.

### UX della schermata risultati

- Area operativa invariata nel linguaggio visivo V1.1 (card dei posti, carta del punteggio, tastierino in basso per l'uso a una mano).
- Stato esplicito a manche completata: «MANCHE N COMPLETATA», tastierino spento, indicazione «Avvia la manche N+1 per continuare, oppure tocca un giocatore per correggerlo».
- Conferma riconoscibile del salvataggio: «Salvato: Ada 410» e bordo verde breve sulla card (rispetta `prefers-reduced-motion`).
- Dialog accessibile (`alertdialog`) per completare una manche incompleta, con i nomi dei mancanti.
- Nessun nuovo pulsante di punteggio rapido.

### Navigation glass

Invariata nell'aspetto. Aggiunti: scomparsa con la tastiera virtuale su schermi touch (via `:has()`, senza JavaScript; dove `:has()` manca resta il comportamento V1.1); spazio in fondo alla pagina quando l'avviso di aggiornamento è visibile. Il fallback senza `backdrop-filter` era già presente (`@supports not`).

## Test e risultati

Comandi eseguiti al termine (HEAD del branch):

| Comando                                      | Esito                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npx pnpm@12.14.0 install --frozen-lockfile` | OK                                                                                    |
| `npm run check`                              | OK: typecheck, **178/178** test Vitest in 15 file, build server + standalone + shared |
| `npx prettier --check .`                     | OK                                                                                    |
| `npm run test:e2e`                           | OK: **20/20**                                                                         |

Nuovi test Vitest (+23): `tests/operational-readiness.test.ts` (13), `tests/backup-transfer.test.ts` (3), `tests/result-flow.test.ts` (7).

Suite E2E (Playwright, Chromium headless, emulazione telefono 390×844 salvo dove indicato): 3 flussi shared + 17 standalone/PWA = **20**. Nuovi: 5 in `standalone-operations.spec.ts`, 2 in `standalone-layout.spec.ts`; estesi i 2 di `standalone-pwa.spec.ts` (aggiornamento trattenuto durante un backup, esportazione offline). Esito dell'ultima esecuzione completa: vedi la sezione [Esito finale](#esito-finale).

Copertura degli scenari obbligatori:

| Scenario                | Dove                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1 Quick Hi-Score        | `standalone.spec.ts` «Hi-Score night for 8 players…» (preesistente): 8 giocatori, parità sulla soglia, finale, podio, archivio |
| 2 19 partecipanti       | `standalone-operations.spec.ts`: 5 manche, reload fra manche, chiusura incompleta, inserimento tardivo, top 4 globale, finale  |
| 3 Squadre disomogenee   | `standalone-operations.spec.ts`: 7 giocatori 2·2·2·1, rotazione, risultati, classifica                                         |
| 4 Round-by-round        | `standalone-operations.spec.ts`: round, salto, correzione, ufficiale, discrepanza, riconciliazione, cronologia dopo reload     |
| 5 Recovery              | `standalone-operations.spec.ts`: reload dopo il salvataggio, bozza col giocatore giusto, doppio tocco, ripresa dalla Home      |
| 6 Backup transfer       | `standalone-operations.spec.ts` (12 giocatori, torneo in corso, profilo isolato, prosecuzione) e `backup-transfer.test.ts`     |
| 7 PWA offline           | `standalone-pwa.spec.ts` (preesistente, esteso): offline, risultato, reload, deep link, export backup                          |
| 8 Tournament correction | `standalone-operations.spec.ts` (qualifica Hi-Score corretta dopo la finale) e `standalone.spec.ts` (gironi 501)               |

I due E2E che riproducono #1 e #2 (19 giocatori e recovery) sono stati eseguiti anche sulla schermata risultati della V1.1: falliscono lì («PUNTEGGIO DI G01» invece di «MANCHE 1 COMPLETATA»; «PUNTEGGIO DI Sara» invece di «Tino») e passano con la correzione. Il test di dominio sulla correzione di un round di squadra fallisce sulla V1.1 (tiratore successivo) e passa ora. Il controllo «contenuto sotto la barra» del test di layout è stato provato in negativo.

### Esito finale

Ultima esecuzione completa sullo stato finale del branch (20 ottobre 2026, Chromium headless di Playwright 1.64.1):

- `npx pnpm@12.14.0 install --frozen-lockfile`: OK.
- `npm run check`: OK. Typecheck pulito, **178/178** test Vitest in 15 file, build server, standalone e shared.
- `npx prettier --check .`: OK.
- `npm run test:e2e`: **20/20** (3 shared, 17 standalone/PWA/layout), 1,1 minuti.

Dopo questa esecuzione è stata rimossa una variabile inutilizzata in `Result.tsx` e ripetuti typecheck, Vitest e build: tutti verdi. Nessun test saltato o disattivato.

## Migrazioni verificate

- IndexedDB 1 → 3 e 2 → 3 in place, backup di schema 1 e 2 importati con lo stesso upgrade: test preesistenti in `local-first.test.ts` e `flexible-local.test.ts`, tutti verdi.
- Nessuna nuova migrazione nella V1.2. Il cambio della rotazione riguarda solo i nuovi round: i record esistenti non vengono riletti né riscritti.
- Le bozze di risultato delle versioni precedenti (`sessionStorage`, solo cifre) vengono scartate: al massimo si perde un numero digitato e mai confermato.

## Compatibilità

- Dati: piena compatibilità con archivi e backup V1.0–V1.1.
- Modalità shared: stesso dominio e stessi servizi; suite API, SQLite, equivalenza standalone/SQLite e i 3 E2E shared verdi. Nessuna modifica a `apps/api` o `packages/database`.
- Browser: `:has()` richiesto solo per nascondere la barra con la tastiera (Safari 15.4+, Chrome 105+); senza, comportamento V1.1. Nessuna API ES2023 nel bundle web (verificato dal typecheck con `lib: ES2022`).
- Bundle: JS app +1,9 kB (+0,6 kB gzip), CSS +0,7 kB (+0,2 kB gzip); precache 1257 KiB (prima 1255).

## Limitazioni residue

- Nessuna verifica su dispositivi fisici, Safari/WebKit o Chrome Android reali: i viewport sono emulati in Chromium desktop.
- Nessun audit automatico di accessibilità (axe/Lighthouse non installati; non sono state aggiunte dipendenze). Controllati a mano: etichette dei controlli, `dialog` nativi con focus gestito dal browser, `role="alert"`/`status` per errori e salvataggi, stati disabilitati, `prefers-reduced-motion`. Contrasto non misurato strumentalmente.
- Performance: nessun collo di bottiglia dimostrato con 19 partecipanti; nessuna ottimizzazione introdotta. Ogni comando riscrive l'aggregato del torneo in IndexedDB (scelta di consistenza esistente).
- Terminazione del processo durante una scrittura: verificata solo con guasti simulati di IndexedDB (transazione che fallisce a metà). La sopravvivenza a crash fisici dipende dal browser e non è garantibile.
- Background/foreground e blocco schermo: l'app riparte dallo stato in IndexedDB, ma il comportamento del sistema operativo va provato sul telefono.
- `Result.tsx` resta ampio (vedi Refactor).

## Rischi

| Rischio                                                                       | Mitigazione                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| iOS elimina i dati di un sito non installato dopo lunga inattività            | Installare l'app, backup prima e dopo ogni serata (avviso in Home già presente)                                      |
| Tastiera virtuale con comportamenti diversi fra iOS e Android                 | Barra nascosta via CSS; verifica manuale in checklist                                                                |
| Posti per manche (4) e regole di alcuni giochi ancora da confermare sul totem | Elenco in [architettura competizioni](../competition/ARCHITECTURE.md#limiti-e-verifiche-ancora-necessarie-sul-totem) |
| Aggiornamento applicato a metà di un modulo non coperto dal trattenimento     | Avviso mai sulle rotte critiche; applicazione sempre manuale                                                         |

## Checklist di accettazione

| Criterio (Definition of Done)                    | Stato                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| TypeScript pulito                                | Sì                                                                                          |
| Build standalone e shared                        | Sì                                                                                          |
| Tutti i test esistenti passano                   | Sì (vedi Esito finale)                                                                      |
| Nuovi scenari critici coperti                    | Sì, tabella sopra                                                                           |
| Migrazioni legacy verificate                     | Sì, test preesistenti verdi; nessuna nuova migrazione                                       |
| Export/import non alterano i risultati           | Sì, confronto profondo prima/dopo e riesportazione                                          |
| Classifiche solo da risultati ufficiali          | Sì, test con riconciliazione                                                                |
| Nessun doppio tap genera duplicati               | Sì: risultato, round, rotazione                                                             |
| Manche attiva sopravvive a reload e riapertura   | Sì (E2E 19 giocatori, test IndexedDB)                                                       |
| Rotazioni non avanzano inaspettatamente          | Sì, dopo la correzione #3                                                                   |
| Aggiornamenti PWA non interrompono il workflow   | Sì in emulazione; da confermare su telefono                                                 |
| Navigation glass non copre i controlli           | Sì su 6 viewport emulati; tastiera virtuale da confermare su telefono                       |
| Schermata risultati utilizzabile con una mano    | Tastierino in basso, target ≥ 44 px verificati; ergonomia reale da provare                  |
| Azioni distruttive con le conferme previste      | Sì (correzioni con dipendenze, annullamento incontro, sostituzione dati, manche incompleta) |
| Nessun servizio o database obbligatorio aggiunto | Sì                                                                                          |
| Modalità shared senza regressioni                | Sì, suite shared verde                                                                      |
| Documentazione allineata                         | Sì: README, stato frontend, QA visuale, architetture, checklist, test                       |
| Controlli su dispositivi fisici identificati     | Sì: [checklist smartphone](../standalone/MOBILE_CHECKLIST.md) e sezione seguente            |

**Il superamento dei test automatici non equivale a una validazione su hardware reale.** La release definitiva resta subordinata alla prova sullo smartphone del locale.

## Checklist di accettazione manuale

Prova di una serata, con il telefono del locale, dopo il deploy HTTPS. Tempo stimato: 45 minuti.

1. **Preparazione**: installare l'app dalla schermata Home; Impostazioni → «Uso senza connessione: Pronta», «Archiviazione persistente» annotata; esportare un backup vuoto di prova.
2. **Giocatori**: inserire 12–19 nomi di fila con la tastiera del telefono, inclusi due omonimi (il secondo con soprannome).
3. **Hi-Score rapido con manche**: avviare il torneo con almeno 9 iscritti; registrare la manche 1; verificare «MANCHE 1 COMPLETATA» e tastierino spento; avviare la manche 2.
4. **Interruzioni**: a metà manche bloccare lo schermo 5 minuti, poi riaprire; chiudere l'app dal multitasking e riaprirla dall'icona; digitare un totale senza confermare, ricaricare e controllare che ricompaia sotto lo stesso giocatore.
5. **Doppio tocco**: confermare un totale con due tocchi rapidi; verificare un solo valore.
6. **Manche incompleta**: «Completa manche» con un mancante; leggere i nomi nel dialog; inserirlo dopo dalla linguetta della manche.
7. **Qualifica e finale**: confermare la qualifica (anche con parità sulla soglia: spareggio o decisione), generare e giocare la finale, confermare il risultato, controllare il podio.
8. **Correzione**: correggere un totale della qualifica dopo la finale; leggere le conseguenze nel dialog; confermare e rigenerare la finale.
9. **Squadre**: partita libera con 7 giocatori in coppie (2·2·2·1), tracciamento flessibile; tre round con rotazione, una correzione di round (la rotazione non deve muoversi), risultati finali.
10. **Round per round**: partita con «Round per round»; un round saltato, una correzione, un ufficiale diverso dai round con motivo; verificare la nota «ufficiale X, round Y — motivo».
11. **Offline**: modalità aereo; nuova partita, risultato, ricarica; esportare il backup offline.
12. **Tastiera e barra**: aprire «Nuovo giocatore»: la barra sparisce con la tastiera e torna alla chiusura; ruotare il telefono in partita.
13. **Backup**: esportare, importare su un secondo telefono o profilo, riprendere il torneo e concluderlo lì.
14. **Aggiornamento**: con una partita in corso pubblicare una nuova versione; nessun avviso in partita; in Home «Aggiorna» mantiene i dati; con l'anteprima di un backup aperta l'aggiornamento non è proposto.

Annotare per ogni punto: esito, modello del telefono, versione del sistema e del browser.
