# BT Darts Score Board — V1.3 Guided Scoring Experience

Branch di lavoro `feat/v1.3-guided-scoring`, costruito sopra `feat/v1.2-operational-readiness`
(la V1.2 non era ancora su `main`; la V1.3 ne usa la correzione della rotazione).

| Commit             | Contenuto                                                                             |
| ------------------ | ------------------------------------------------------------------------------------- |
| `247c341`          | Dominio, contratti, backend, API, archivio locale: freccette e coordinatore dei turni |
| `9fcd92f`          | Schermata Guided Scoring (Live, Matrice, Classifica, Risultati), E2E e screenshot     |
| (questo documento) | Report tecnico                                                                        |

Design di riferimento: prototipo «BT Darts V1.1» con le tavole Guided Scoring V1.3 (artifact
claude.ai `8uTfSy8zQL3ent9XTQU6gs`).

## 1. Stato iniziale verificato

- `npm run typecheck`: superato. `vitest`: 15 file, 178 test superati.
- I round sono `RoundRecord` dentro il documento JSON della partita (IndexedDB e SQLite), con un
  solo valore: nessuna freccetta. Una correzione aggiunge un record e marca il precedente
  `corrected`; l'annullamento lo marca `voided`, con eventuale ripristino del precedente.
- La rotazione delle squadre (`Rotation`) avanza solo alla prima osservazione di un round
  (correzione V1.2): una correzione non la muove di nuovo.
- Nessuna nozione persistita di «chi è al bersaglio»: la schermata risultati sceglieva il
  concorrente nello stato React (`selected`), perso con un reload in modalità round.
- `turn-manager.ts` gestiva solo i `Turn` della vecchia registrazione turno per turno.
- Le operazioni sono transazionali: `Backend.execute` lavora in `store.transaction`, con
  versione del torneo e della partita e chiave di idempotenza; `LocalEngine.write` applica le
  modifiche in memoria solo dopo il commit IndexedDB.
- I backup sono validati con schemi zod `z.object`, che **scartano** le chiavi sconosciute: un
  campo nuovo non dichiarato nei contratti sarebbe andato perso in esportazione/importazione.

### Risposte ai punti dell'audit

1. Round: un record per osservazione; quello effettivo è `recorded` o `skipped` (non osservato).
2. Correzioni: nuovo record con `correctsId`; storico completo; ripristino con `restorePrevious`.
3. Prossimo giocatore: prima di V1.3 solo «il primo senza risultato finale» (`result-flow.ts`).
4. Rotazioni: per squadra, avanzate con `advanceRotation` alla prima osservazione del round.
5. Manche: `Heat` in `competition/heats.ts`; un valore avvia la manche se il totem è libero.
6. Risultati progressivi: `roundProgress` (somma, `start − somma` o ultimo valore).
7. Transazioni: ogni comando del backend; un comando = un commit.
8. Round non osservati: `value: null` → `skipped`, mai zero.
9. Ripresa: dati persistiti sì; posizione del turno no (stato React).
10. Ufficiale vs calcolato: `MatchResult.scores` è ufficiale; `Progress.computed` solo se la
    progressione è completa; differenze spiegate in `reconciliation`.

`Progress.complete` (ogni round con un valore registrato) e il controllo `ROUNDS_MISSING` di
`ROUND_BY_ROUND` (ogni round registrato **o saltato**) restano distinti di proposito: un round
saltato consente il risultato ufficiale ma rende il totale non confrontabile. `FLEXIBLE` resta
senza vincoli.

## 2. Problemi individuati

- Posizione del turno non ricostruibile dopo reload, altro tab o backup.
- Nessun dettaglio delle freccette; nessuna distinzione fuori / non osservata / zero per regola.
- Selezione manuale del concorrente come unico flusso: niente sequenza guidata.
- Campi nuovi a rischio di perdita nei backup (vedi sopra).

## 3. Modifiche al dominio

- `model.ts`: `DartThrow { kind, sector }` con `kind` tra singolo, doppio, triplo, bull 25,
  bull 50, `miss` (fuori, zero) e `unobserved` (mai zero). `RoundRecord.darts?` facoltativo
  (assente/null = solo valore). `Match.guide?: TurnGuide` con le sole scelte dell'organizzatore:
  `pick` (turno scelto a mano), `replay` (turni annullati da riproporre), `paused`.
- `scoring/darts.ts` (nuovo): `evaluateTurn` applica le regole documentate alle sole freccette
  osservate. Hi-Score ed Exacta sommano; Shanghai conta solo il numero del round (altri settori
  valgono zero per regola) e riconosce lo Shanghai; X01 sottrae dal residuo con bust (il turno
  vale 0) e chiusura; Double In/Out apre e chiude con un doppio, Masters chiude con doppio,
  triplo o bull 50, 1 residuo = bust. Freccetta non osservata o residuo sconosciuto (un round
  precedente mancante) → turno non deciso: il valore si legge sul totem. `assertTurn` rifiuta
  freccette dopo la fine del turno e turni con meno di tre freccette non conclusi in anticipo.
- `scoring/rounds.ts`: `recordRound` accetta `darts`; senza `value` lo ricava dalle freccette;
  freccette e valore discordi richiedono un motivo (`DARTS_MISMATCH`); una correzione del solo
  valore conserva le freccette già inserite (segnalate «da verificare»). `RoundView` aggiunge
  `state` (complete, early, partial, skipped, review, reenter, missing), `darts`, `dartsValue`,
  `bust`. `remainingBefore` calcola il residuo X01 solo da round effettivi.
- `matches/turn-manager.ts`: coordinatore dei turni. `turnPlan` ricava dai round la frontiera
  (ultimo turno osservato in ordine di tiro) e propone: turno scelto, turni da riproporre, poi il
  turno successivo; tiratore effettivo (quello già annotato sul round, altrimenti la rotazione);
  prossimo turno; stato `ready | in_progress | paused | interrupted | completed`; seggi chiusi
  (X01 a zero), turni passati senza valore (`gaps`), Shanghai, valore prima del turno.
  `recordTurn` conferma solo il turno al bersaglio (`TURN_MOVED` altrimenti) e avanza la
  rotazione; `guideTurn` gestisce `pick`, `undo` (annulla il valore, lo ripropone con il suo
  tiratore senza riavanzare la rotazione), `pause`, `resume`.

Correzioni e annullamenti dalla matrice non toccano né la frontiera né la rotazione: il turno al
bersaglio non cambia.

## 4. Modifiche ai contratti e al backend

- `dartThrow`, `recordRound.darts`, nuovi comandi `recordTurn` e `guideTurn`.
- `roundResponse.darts` e `matchResponse.guide` **facoltativi**: i record precedenti passano da
  un backup invariati, i nuovi conservano freccette e scelte.
- `liveMatchResponse`: `progress[].rounds[]` con `state`, `darts`, `dartsValue`, `bust`;
  `turnPlans` (un piano per manche).
- Backend: `RecordTurn` (`/matches/:id/turns/record`, Idempotency-Key obbligatoria come
  `RecordRound`) e `GuideTurn` (`/matches/:id/turns/guide`). OpenAPI rigenerato.

## 5. Persistenza e migrazioni

Nessuna migrazione: il modello effettivo non la richiede. Freccette e guida sono campi
facoltativi del documento JSON della partita (IndexedDB e SQLite). I round storici senza
freccette continuano a funzionare con `darts: null` nella vista, senza dati inventati.
`integrity.ts` verifica freccette e guida anche all'importazione di un backup.

## 6. Componenti UI

- `features/Guided.tsx` (nuovo): schermata della partita con round tracciati, barra di vetro
  della partita (Live, Matrice, Classifica, Risultati) al posto della navigazione globale.
  - Live: round e avanzamento, card «Ora al bersaglio» (squadra, tiratore, «Dopo»),
    Freccette/Totale, riepilogo turno (precedente, punti, provvisorio o residuo, bust, chiusura,
    Shanghai), CTA contestuale «CONFERMA ROUND → SALVO», avviso con Annulla, pausa di fine
    round, fine manche, controlli del turno (salta, scegli chi tira, rotazione della squadra,
    annulla avanzamento, pausa), riepilogo compatto della manche.
  - Matrice: tabella con nome fisso, celle con freccette, bust, saltati, da reinserire,
    parziali, da verificare; pannello cella con valori prima/dopo, freccette, cronologia,
    Modifica / Annulla round / Ripristina.
  - Classifica: ordine di tiro, classifica provvisoria etichettata, tutti i round, prossimi turni.
  - Risultati: companion contro totem per riga (da inserire, coincide, differenza, confermato,
    round incompleti) e l'inserimento ufficiale esistente (`ResultEntry` integrato).
- `components/DartPad.tsx` (nuovo): tre celle e tastierino a 4 colonne (settore + S/D/T, BULL
  ×2 = 50, ✕, ⌫), selettore del tipo in pagina, tastiera fisica.
- `services/guided.ts` (nuovo): tastierino, conferma e bozze testabili fuori da React.
- `features/Match.tsx`: le partite con round tracciati usano la nuova schermata; `FINAL_ONLY`
  resta sulla schermata risultati.
- `NumberKeypad` riutilizzato per il totale e per le correzioni; `RotationManager`,
  `HeatTimeline`, `ResultEntry` riutilizzati. Stili in `app.css` (sezione V1.3), solo token
  esistenti; riduzione del movimento rispettata.

## 7. Test aggiunti

| File                                         | Copertura                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/guided.test.ts` (19)                  | Scenari A (4 giocatori × 7 round), B (fuori, zero per regola, non osservata, non usata, discrepanze), C (solo totale), D (correzione, annullamento, undo, scelta, pausa), E (tre coppie e un singolo), F (17 iscritti, 5 manche, classifica unica), G (X01 bust, chiusura, residuo, round mancante, Double In/Out, Masters), integrità (doppio tap, turno stale, chiave obbligatoria, Shanghai) |
| `tests/guided-local.test.ts` (7)             | Scenario H (chiusura e riapertura), I (doppio tap, due tab, errore IndexedDB, backup con freccette e guida, partita V1.2 senza freccette), modalità shared via HTTP                                                                                                                                                                                                                             |
| `tests/guided-ui.test.ts` (12)               | Tastierino, conferma, bozze                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/web/e2e/standalone-guided.spec.ts` (3) | Flusso completo con screenshot, squadre disomogenee con undo e pausa, round per round con differenza e cronologia                                                                                                                                                                                                                                                                               |

Le tre prove E2E del vecchio flusso «Round per round» sono state portate alla nuova schermata.

## 8. Risultati dei controlli

- `npm run typecheck`: superato.
- `npm run format:check`: superato.
- `vitest`: 18 file, 216 test superati.
- Nota: durante il lavoro il portatile era a batteria con profilo `low-power` (CPU 400–800 MHz);
  in quella condizione alcune prove lunghe (`api.test.ts`, `groups.test.ts`) superano il
  timeout di 15 s **anche sul commit di partenza** `75a9272`. Con timeout esteso, e poi di nuovo
  con la CPU normale, l'intera suite è passata.
- E2E Playwright (`npm run test:e2e`, progetti shared e standalone): 22 test superati.

## 9. Screenshot

`docs/release/screenshots-v1.3/`: turno attivo, tre freccette, prossimo giocatore, round
completato, matrice dei round, risultato finale.

## 10. Limitazioni residue

- Le regole Double In/Out e Masters seguono il testo del catalogo; bull 50 conta come «centro»
  per Masters e non come doppio per Double In/Out: da confermare sul totem.
- Dopo una chiusura X01 gli altri continuano: l'app non presume che il totem fermi la partita e
  propone di registrare il risultato.
- Odd & Even: solo valore (numero raggiunto), nessun dettaglio per freccetta.
- «Prossimi turni» in Classifica mostra il turno attuale e il successivo, non l'intera coda.
- Le bozze di freccette sono per tab (sessionStorage), come le bozze dei risultati.

## 11. Checklist di validazione manuale su smartphone

- [ ] Hi-Score 4 giocatori: tre freccette per turno, il nome cambia solo dopo il salvataggio.
- [ ] 20 S, ✕, 20 T dà 80; BULL due volte dà 50; «Non osservata» blocca la conferma finché non si
      inserisce il totale.
- [ ] Doppio tap rapido sulla CTA: un solo round in matrice.
- [ ] Annulla dall'avviso: torna lo stesso giocatore, la squadra non salta un tiratore.
- [ ] Correzione e annullamento dalla matrice: il giocatore al bersaglio non cambia.
- [ ] Coppie e singolo: il tiratore effettivo alterna correttamente round dopo round.
- [ ] 501: bust (il residuo resta), chiusura con meno di tre freccette.
- [ ] Hi-Score Night con più manche: la manche successiva parte dopo la prima.
- [ ] Chiudere la PWA a metà manche e riaprirla offline: stesso turno, stessi valori.
- [ ] Risultati: valore del totem diverso dai round → motivo richiesto, entrambi conservati.
- [ ] Barra della partita: non copre tastierino e CTA; safe area rispettata.
- [ ] Backup esportato e importato su un secondo telefono: freccette presenti in matrice.
