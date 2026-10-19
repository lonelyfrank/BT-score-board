# Stato integrazione frontend — 19 ottobre 2026

Il frontend usa il motore reale (locale o server); nessun risultato simulato. Dalla Fase 2 l'app registra i risultati finali degli otto giochi del totem Pub Time Darts; non conta dardi né turni.

Il frontend segue il design **v2 · Backend reale** (canvas BT Darts Score Board, 9 artboard).

| Schermata       | Implementato (v2)                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home            | Ripresa compatta «In corso · riprendi», quattro azioni, Game Night attiva; in modalità shared stato accesso e avviso token                                                                                                                                                                                                  |
| Nuova partita   | Gli otto giochi del totem (tutti avviabili, regola e limiti giocatori), giocatori ordinati con anticipa/rimuovi, lato Dispari/Pari per Odd & Even, conferma «Pronti al bersaglio?»                                                                                                                                          |
| Partita live    | Registrazione risultato: Hi-Score un totale alla volta dal tastierino (salvato subito, passa al giocatore seguente); altri giochi tocco sul vincitore, punteggi/obiettivo Exacta/Shanghai facoltativi; correzione con elenco delle conseguenze; prossimo incontro. Tornei a turni preesistenti: schermata a turni invariata |
| Nuovo torneo    | Serata facoltativa, formato, partecipanti con seed, freccette, gironi con anteprima a serpentina o composizione manuale (`groupAssignments`), punti V/N/P, pareggi, finale Hi-Score, parità e ordine, bozza                                                                                                                 |
| Torneo a gironi | Panoramica con fasi e «Al bersaglio», classifiche G/V/N/P/Diff/Pti, calendario per round con riordino, tabellone, statistiche, pausa, annullamento, spareggi                                                                                                                                                                |
| Hi-Score Nights | Totali dal totem, parità sulla soglia con spareggio o decisione dell'organizzatore, linea finale, finale diretta con meno di 4 iscritti, ritiro giocatore, finale unica, risultati ufficiali                                                                                                                                |
| Giocatori       | Ricerca, filtro attivi/disattivati, soprannome, omonimi, profilo con statistiche per configurazione e storico piazzamenti, disattiva/riattiva                                                                                                                                                                               |
| Game Night      | Serate in programma/concluse, creazione con data e descrizione, apertura e chiusura, tornei collegati, aggiunta torneo alla serata                                                                                                                                                                                          |
| Impostazioni    | Standalone: dati del dispositivo e backup. Shared: accesso organizzatore v2 (mostra/nascondi token, 401 esplicito) e stato del server del locale                                                                                                                                                                            |

## Decisioni di integrazione

- Hi-Score accumula punti; non visualizza un residuo 301 fittizio.
- Quick High Score richiede almeno due giocatori; una partita rapida crea una qualifica con tutti i partecipanti ammessi alla finale. Il risultato dell'incontro non è automaticamente il risultato ufficiale del torneo.
- Il backend Quick prevede una finale unica, non semifinali 1-vs-4/2-vs-3. Il torneo a gironi supporta invece eliminazione diretta e semifinali.
- L'API non espone catalogo modalità: la griglia dichiara la sola capacità disponibile HIGH_SCORE. Le altre etichette restano riferimenti visivi non avviabili.
- Il backend restituisce `scoreboard` nella lettura della partita: media, totale, best e turni vengono calcolati nel dominio esistente.
- Le regole non sono copiate nel frontend: anteprima dei gironi e accoppiamenti del tabellone usano `distributeGroups` e `seededBracket` del dominio; parità, ordine e qualificati arrivano dalle classifiche del backend.
- L'annullamento rimuove l'intero ultimo turno (anche se inserito per freccetta); le freccette non ancora confermate si tolgono senza motivo.
- I nomi dei gironi salvati dal dominio («Group 1») sono mostrati come «Girone A».
- Le bozze di punteggio sono legate all'ID del turno. Una nuova scheda recupera lo stato server; il token deve essere inserito nella propria sessione.

## Limiti ancora presenti

- Squadre e set/leg non previsti; nessun conteggio di dardi o turni per i nuovi tornei (lo fa il totem).
- Display spettatore dedicato non implementato. PWA, offline e persistenza locale sono disponibili dalla Fase 1 standalone (vedi sotto).
- Nessun endpoint di restart-leg: non viene esposto un reset fittizio. Annullamento reale tramite VoidScore; fasi finalizzate richiedono la procedura amministrativa di riapertura, non disponibile in questa UI.
- Nessun MockAdapter in produzione: i test usano API vere e SQLite in memoria; il seed esistente rimane disponibile per demo separate.
- Asset hero/footer ancora temporanei dal mockup. Logo e graffiti definitivi rimangono da fornire.
- Storybook, Lighthouse e audit axe non eseguiti.

## Fase 1 — Standalone PWA (18 ottobre 2026)

- Modalità predefinita standalone: dominio e servizi applicativi nel browser, IndexedDB, nessuna richiesta HTTP; HttpAdapter conservato per la modalità shared.
- Home con ripresa della partita in corso e risultati recenti; Impostazioni con dati del dispositivo, archiviazione persistente, backup e ripristino.
- PWA installabile, avvio offline, aggiornamenti mai forzati durante lo scoring.
- Nessun reset, MockAdapter o dato simulato in produzione.

Verificati (19 ottobre 2026, v2): build produzione standalone e shared, TypeScript strict, 103 test Vitest, 11 flussi Playwright (3 shared, 8 standalone/PWA). Verifiche su dispositivi fisici: [checklist](../standalone/MOBILE_CHECKLIST.md).

## Fase 2 — Giochi del totem e risultati finali (19 ottobre 2026)

- Catalogo degli otto giochi nel dominio; formato e gioco indipendenti (partita singola, gironi con ogni gioco, Hi-Score rapido solo Hi-Score).
- Schermata «Registra risultato» al posto del tastierino a turni, con lo stesso linguaggio visivo (scoreboard, carta, tastierino).
- Classifiche dei gironi per punti e vittorie fuori da Hi-Score; spareggio o decisione dell'organizzatore per ogni parità decisiva; ritiri, incontri annullati, rimozione iscrizioni.
- Profilo giocatore: statistiche per gioco, percentuale vittorie, record e media Hi-Score, ultime partite, avatar preset facoltativo. Tornei con filtro archivio.

Verificati (19 ottobre 2026, Fase 2): `npm run check` (TypeScript strict, 122 test Vitest, build server, standalone e shared), 11 flussi Playwright (3 shared, 8 standalone/PWA), seed e smoke. Dettagli: [report](../local-first/REPORT.md).

Verifiche e screenshot: [VISUAL_QA.md](VISUAL_QA.md). Avvio: [README](../../README.md).
