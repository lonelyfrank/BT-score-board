# BT Darts — Flexible Heat Management V1.3.1

Data: 21 ottobre 2026. Implementazione nella repository locale; nessun deploy o collegamento al totem.

## Baseline e audit

- Branch iniziale: `main`.
- Commit iniziale: `366779e8053c48685d92a58ae337018e47abdb5b`.
- Working tree iniziale: soltanto `docs/audit/` non tracciata, lasciata intatta.
- Baseline automatica: **18 file, 220 test Vitest passati**.
- Nessuna nuova dipendenza, nessuna ricostruzione dell'applicazione.

| Modulo analizzato                                               | Funzioni esistenti e risultato dell'audit                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `competition/heats.ts`                                          | `planHeats`, `GenerateHeats`, `ArrangeHeats`, `LockHeat`, start/complete, overview già disponibili. Il planner sequenziale era corretto, ma non predefinito. Capacità configurabile fino a 8, senza limite effettivo del gioco. Riorganizzazione basata sul solo stato; le manche avviate venivano spostate in testa. |
| `competition/entries.ts`, `teams.ts`                            | Singoli e squadre già modellati come unità competitive; composizione atomica, membri ordinati, massimo 256 unità e 8 membri per squadra. Riutilizzati.                                                                                                                                                                |
| `competition/rotation.ts`                                       | Rotazione interna, pausa/ripresa, undo e riordino indipendenti dai posti delle squadre. Riutilizzati.                                                                                                                                                                                                                 |
| `matches/turn-manager.ts`                                       | Il piano guidato usa già `heat.entryIds`, esclude ritirati e non inventa posti. Gestisce un singolo partecipante. Un pick manuale non giocato poteva prevalere sull'ordine appena modificato.                                                                                                                         |
| `scoring/rounds.ts`                                             | Round con storico, correzioni, bust, freccette, rotazione soltanto alla prima osservazione. Riutilizzato senza cambiare scoring.                                                                                                                                                                                      |
| `tournaments/engine.ts`, catalogo giochi                        | Hi-Score Night già usa una qualifica globale e i criteri esistenti. Gironi/knockout mantengono match separati. Mancava una protezione contro suddivisioni manuali di giochi non confrontabili.                                                                                                                        |
| `contracts/schemas/index.ts`, `application/services/backend.ts` | Stessi comandi per locale e REST; versioni torneo/match, audit e idempotenza già presenti. Default di creazione bilanciato.                                                                                                                                                                                           |
| `local-store`                                                   | Snapshot in memoria, commit IndexedDB atomico, revisione globale contro tab concorrenti, validazione integrità, backup con checksum e upgrade storici già disponibili. Nessun nuovo adapter necessario.                                                                                                               |
| `database/repositories/sqlite-store.ts`                         | Aggregati JSON persistiti con le proiezioni relazionali esistenti: nessuna colonna aggiuntiva richiesta.                                                                                                                                                                                                              |
| `Heats.tsx`                                                     | Scambi e spostamenti già presenti, ma senza posti vuoti visibili, ordine delle manche, reset e proposta automatica prima del salvataggio.                                                                                                                                                                             |
| `Setup.tsx`, `TournamentSetup.tsx`, `services/rules.ts`         | Anteprime sempre bilanciate; nelle partite libere nessun selettore. Anteprima torneo non seguiva la strategia selezionata.                                                                                                                                                                                            |
| `Guided.tsx`, `Result.tsx`                                      | Gestione manche accessibile solo dai risultati, limitata alle partite con più manche. I lati Odd & Even usavano ancora l'ordine di iscrizione.                                                                                                                                                                        |
| `styles`, componenti UI                                         | Riutilizzati dialog nativo, Segmented, colori, superfici, icone e dimensioni touch. Nessuna libreria drag-and-drop.                                                                                                                                                                                                   |

## Modifiche

### Distribuzione e vincoli

`sequential` è il default del planner, dei nuovi tornei e delle anteprime. Restano disponibili bilanciata, personalizzata e casuale. L'anteprima bilanciata usa lo stesso `planHeats` del dominio.

Capacità delle **nuove configurazioni**: massimo quattro slot, o meno secondo il catalogo (Odd & Even: due). Il limite tecnico delle iscrizioni rimane 256 **unità competitive**, indipendentemente dal numero dei membri. Nessun partecipante fittizio o bye aggiunto per riempire una manche.

`ArrangeHeats` verifica presenza esatta di ogni partecipante, unicità, appartenenza, capacità, posizioni, riferimenti delle manche e stato. Una manche confermata va sbloccata per modificare composizione, slot o posizione. Le manche avviate, completate, annullate o contenenti cronologia restano fisse, anche se giocate fuori ordine. Annullare un round non rende modificabile la sua manche.

Le proposte automatiche riguardano soltanto le manche pendenti senza cronologia. Se eliminare manche precedenti sposterebbe una manche protetta, il comando viene rifiutato con una spiegazione. Gli ID delle manche riutilizzate restano stabili; un'esplicita rigenerazione può sostituire solo i contenitori non giocati. Round, risultati, rotazioni e qualificazioni esistenti non vengono riscritti.

Il dominio impedisce di dividere un confronto X01, Exacta o Odd & Even in manche indipendenti: non viene introdotta una classifica globale non prevista. Per questi giochi resta disponibile il riordino degli slot dell'unico incontro prima dell'avvio. Gironi, bye e avanzamento restano quelli del motore esistente.

### Ordine e persistenza

`entryIds` rimane l'unica fonte dell'ordine di tiro. È aggiunto il solo campo opzionale `slotPositions`, allineato a `entryIds`, strettamente crescente e senza duplicati:

```json
{ "entryIds": ["A", "B"], "slotPositions": [1, 4] }
```

Indica A al primo slot e B al quarto; il coordinatore visita A e B, senza turni per gli slot 2 e 3. L'ordine delle entry da solo non poteva rappresentare questa informazione. Non sono stati introdotti identificatori di slot né un secondo ordinamento indipendente.

Campo assente: posti consecutivi 1…N, come nei dati precedenti. Nessuna migrazione IndexedDB/SQLite è necessaria: i contenitori JSON esistenti conservano il campo opzionale, validato anche in importazione. Versione schema IndexedDB invariata (4), formato backup invariato (1). Il default storico `balanced` nell'upgrade e nei contratti di lettura resta invariato; le manche salvate non vengono ricalcolate. I backup storici con capacità superiore a quattro restano leggibili; la nuova organizzazione rispetta il limite fisico e non riscrive le manche già giocate.

I comandi conservano versioni, transazioni, audit e idempotenza esistenti. Una schermata diventata obsoleta non può sovrascrivere modifiche altrui. I test iniettano un errore nella scrittura dei metadati **dopo** l'accodamento delle altre scritture per verificare il rollback completo.

### Organizza manche

- Tre scelte principali: Riempimento, Bilanciata, Personalizzata; Casuale conservata come azione aggiuntiva.
- Slot numerati, liberi visibili, stato e occupazione per manche.
- Due tocchi per spostare verso un posto specifico o scambiare due partecipanti, anche nella stessa manche.
- Pulsanti Prima/Dopo, nuova manche e rimozione esplicita delle manche vuote.
- Modifiche automatiche e manuali in bozza; nessun riequilibrio implicito dopo uno spostamento.
- Ripristina distribuzione e Conferma organizzazione; validazione prima del commit.
- Indicatori e messaggi specifici per manche protette, aggiornamenti concorrenti e configurazioni incompatibili.
- Accesso dalla creazione (Personalizzata apre l'editor prima del primo tiro), dal Live guidato e dai risultati. Per un torneo salvato senza avvio, l'organizzazione è disponibile quando il motore crea i match all'avvio.
- Dialog nativo con focus confinato, controlli da tastiera, feedback `role="status"`, nessuna nuova animazione. Slot vuoti con stile dedicato per evitare collisioni con `.empty`.

Il Guided Scoring continua a derivare i turni dalle entry ordinate. I pick manuali non ancora giocati vengono azzerati quando si conferma una nuova organizzazione, senza modificare replay e cronologia delle manche protette. Il numero dello slot e i lati Odd & Even seguono la posizione effettiva. Rotazione dei membri, pausa/ripresa, undo, correzione, bust e chiusura anticipata mantengono le regole esistenti.

## Matrice dei test

| Scenario                        | Copertura automatica                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribuzioni richieste         | Tabelle 1, 3, 4, 5, 7, 8, 11, 13, 15, 17, 19; default planner e creazione; bilanciata 13/17; quattro distribuzioni personalizzate da 13.                                                          |
| Modifiche manuali               | Spostamento, scambio, ordine interno/manche, nuova/rimossa, vuoti intermedi, duplicati, mancanti, capacità, slot invalidi, riferimenti sconosciuti/duplicati, blocco e sblocco. Dominio e UI E2E. |
| A — 11, 4+4+3                   | Tutti i 77 round guidati e risultati ufficiali nel dominio; E2E completo con risultati finali.                                                                                                    |
| B — 13, 4+4+4+1                 | Tutti i 91 round guidati, ultima manche singola e classifica finale; dominio ed E2E.                                                                                                              |
| C — 15, 4+4+4+3                 | Qualifica globale dei quattro migliori, finale e conclusione nel dominio; qualifica e finale E2E.                                                                                                 |
| D — personalizzata e riapertura | Riordino con posto 4 occupato e 1–3 liberi; reopen IndexedDB, backup su altro dispositivo, reload PWA offline a 320 px.                                                                           |
| E — squadre miste               | Due coppie e singoli, squadra sola in una manche, rotazione, pausa/ripresa, undo e correzione; suite E2E guidata preesistente con squadre.                                                        |
| F — competizione in corso       | Manche giocata fuori ordine preservata con numero, ID, round e tiratore; riorganizzazione/ripianificazione delle rimanenti; E2E modifica durante round 2.                                         |
| G — backup storico              | Import V1.3 senza slotPositions e con strategia storica bilanciata; regressioni preesistenti upgrade schema 2 e backup legacy.                                                                    |
| H — errore IndexedDB            | QuotaExceededError durante commit: memoria, dati persistiti, audit, comando e revisione immutati, verificati dopo riapertura.                                                                     |
| I — due tab                     | Due LocalEngine sullo stesso IndexedDB avviano riorganizzazioni simultanee: un solo commit, l'altro STALE_DATA. REST verifica versione obsoleta e replay idempotente.                             |
| J — confronto incompatibile     | X01, Exacta e Odd & Even rifiutano manche separate; accettano il riordino dell'unico confronto. Limite Odd & Even non aggirabile.                                                                 |
| Compatibilità shared            | Round-trip REST Fastify/SQLite di slot vuoti e ordine, piano singleton di sette turni, idempotenza e concorrenza; suite API/E2E shared preesistente.                                              |

File aggiunti: `tests/flexible-heats-v131.test.ts`, `apps/web/e2e/standalone-heats.spec.ts`. Estesa `tests/api.test.ts`. Le fixture che richiedono deliberatamente distribuzioni bilanciate ora le richiedono esplicitamente; il test da 17 usa il nuovo default 4+4+4+4+1. Rimossa una capacità fittizia 8 da una fixture di spareggio, mantenendo il caso competitivo.

## Verifiche finali

Verifiche eseguite sulla modifica locale.

- Baseline: `npm test` — 220/220.
- Documentazione API: `npm run openapi`, aggiornato `docs/openapi.json`.
- `npm run check` — **PASS**: typecheck root/web, **19 file / 263 test Vitest**, build standalone e shared.
- `npm run test:e2e --prefix apps/web` — **31/31 PASS**, Chromium: 3 shared e 28 standalone (2,8 minuti).
- Dopo le ultime rifiniture: nuova verifica dei flussi da 11, 13 e 15 — **3/3 PASS**; test dedicato `--grep "custom slots"` — **1/1 PASS**, inclusi selettore a 320 px, slot Live, riapertura offline e modifica durante il gioco. Le build statiche di entrambe le modalità sono state rigenerate anche in questa esecuzione.
- `git diff --check` — **PASS**. Prettier applicato ai file di codice modificati e al report.

I comandi tsx/OpenAPI e Playwright richiedono socket e server locali: dopo l'errore EPERM nella sandbox sono stati eseguiti con l'autorizzazione prevista. Nessuna dipendenza scaricata per la funzionalità.

Screenshot del nuovo editor: [320 px](screenshots-v1.3.1/organizza-320.png). A 320 px il selettore dispone le tre opzioni in verticale per mantenerle leggibili; non introduce scroll orizzontale. Gli screenshot storici rigenerati incidentalmente dalla suite sono stati ripristinati alla baseline.

Regressioni intercettate e risolte durante il lavoro: serializzazione Fastify del vincolo numerico (`min(1)` compatibile), fixture dipendenti dal vecchio default, stile globale `.empty` applicato per errore ai posti liberi, etichette del selettore troppo larghe a 320 px. I test E2E per le partite singole verificano il titolo esistente «Partita conclusa», distinto dal titolo della finale torneo.

## Accettazione nel locale e limiti residui

- [ ] Provare su Chrome Android reale e Safari iOS reale a 320–390 px, tastiera virtuale, orientamento e safe area.
- [ ] Iscrivere 13 unità, confermare 4+4+4+1, verificare sul totem la corrispondenza dei posti e l'ultima manche singola.
- [ ] Spostare una squadra nello slot 4 lasciando uno slot intermedio libero; verificare ordine squadre e rotazione interna.
- [ ] Giocare una manche, riorganizzare le rimanenti e verificare risultati/storico immutati.
- [ ] Verificare sul dispositivo fisico l'uso di slot non consecutivi e il limite documentato di Odd & Even; l'app non comunica con l'hardware.
- [ ] Chiudere e riaprire la PWA offline, esportare un backup, importarlo su un secondo dispositivo.
- [ ] Aprire due tab e verificare che il conflitto richieda di ricaricare la distribuzione prima di riprovare.

La verifica automatica usa Chromium e IndexedDB simulato nei test unitari; Safari iOS, ergonomia con una mano e comportamento del totem richiedono prova fisica. Nessuna variante hardware da più di quattro posti è stata introdotta. Le manche vuote sono ammesse soltanto nella bozza e devono essere riempite o eliminate prima della conferma. Le manche storiche avviate non vengono mai riorganizzate automaticamente.
