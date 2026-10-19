# Giochi del totem e risultati

Il totem Pub Time Darts (1987) gestisce gioco, dardi, punteggi, turni e vittoria. L'app non comunica con la macchina e non conta i dardi: l'organizzatore registra il **risultato finale** che il totem mostra. Le regole qui sotto servono a configurare i tornei, spiegare il gioco e validare i risultati. Fonte unica nel codice: `packages/domain/src/games/catalog.ts`.

## Catalogo

| Modalità (`GameMode`) | Regola                                                         | Si registra                                     | Punteggio (facoltativo salvo Hi-Score)   | Pareggio possibile |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- | ------------------ |
| `301`                 | Da 301 a zero, chiusura esatta                                 | Vincitore                                       | Punti rimasti, 0–301 (meno è meglio)     | No                 |
| `301_DOUBLE_IN_OUT`   | Apertura e chiusura con doppio                                 | Vincitore                                       | Punti rimasti, 0–301                     | No                 |
| `501`                 | Da 501 a zero, chiusura esatta                                 | Vincitore                                       | Punti rimasti, 0–501                     | No                 |
| `HI_SCORE`            | Punteggio più alto dopo 7 round                                | **Punteggio finale di ogni giocatore**          | Obbligatorio, 0–1260 (7 × 180)           | Sì                 |
| `301_MASTERS`         | Chiusura con doppio, triplo o centro                           | Vincitore                                       | Punti rimasti, 0–301                     | No                 |
| `EXACTA`              | Obiettivo casuale 250–350 in 5 round, vince il più vicino      | Vincitore, oppure obiettivo + totali            | Totale finale 0–900; obiettivo 250–350   | Sì                 |
| `ODD_EVEN`            | Progressione sui numeri dispari o pari assegnati               | Vincitore                                       | Numero raggiunto 0–20 (solo informativo) | No                 |
| `SHANGHAI`            | Numeri 1–7: punteggio più alto o vittoria immediata «Shanghai» | Vincitore, oppure punti completi; flag Shanghai | Punti 0–252 (9 × (1+…+7))                | Sì                 |

Giocatori per partita sul totem: 2–4; **Odd & Even esattamente 2**, il primo nell'ordine di tiro sui dispari, il secondo sui pari (assunzione da confermare sulla macchina, vedi report).

## Validazione (`evaluateResult`)

- I punteggi sono interi nel limite della modalità; solo giocatori dell'incontro (i ritirati sono esclusi).
- Hi-Score: il risultato è completo quando ogni giocatore ha il suo totale; si può inserire un giocatore alla volta (qualifica di una serata). Vince il totale più alto; totali pari = nessun vincitore.
- Altre modalità: serve il vincitore indicato dal totem **nello stesso inserimento**. Se però tutti i punteggi sono presenti e decidono (meno punti rimasti, più punti, più vicino all'obiettivo Exacta), il vincitore si deduce. Un vincitore dichiarato che contraddice i punteggi è rifiutato (`RESULT_INCONSISTENT`).
- Shanghai: il flag `special: 'SHANGHAI'` richiede il vincitore e prevale sui punti.
- Exacta: l'obiettivo è facoltativo; senza obiettivo i totali non decidono.

## Classifica di un incontro

Chiave (decrescente): vincitore, risultato registrato, poi il punteggio letto secondo la modalità (punti, −punti rimasti, −distanza dall'obiettivo). Hi-Score usa solo [registrato, totale]. Chi non ha ancora un risultato resta in fondo e non viene segnalato come pari. Spareggi e decisioni dell'organizzatore dividono i gruppi a pari merito; ranking competitivo (1, 1, 3).

## Correzioni

`RecordResult` su un incontro già registrato è una correzione: i valori nuovi sostituiscono quelli vecchi (`null` cancella un punteggio e riapre l'incontro Hi-Score). Lo stato precedente resta nell'audit. Se la correzione tocca qualcosa di già usato — fase confermata, fasi successive generate, spareggi o decisioni sulla stessa classifica, torneo concluso — il comando risponde `RESULT_HAS_DEPENDENTS` con l'elenco delle conseguenze e non modifica nulla. Con `confirmInvalidation: true` la fase viene riaperta (fasi successive invalidate, loro incontri annullati, risultato ufficiale ritirato) e la correzione applicata nella stessa transazione. L'interfaccia mostra le conseguenze prima di inviare (`resultDependencies`).

Le statistiche non sono salvate: si ricalcolano dai risultati, quindi seguono subito ogni correzione.

## Inserimento turno per turno (dati esistenti)

I tornei creati prima dei risultati finali (`recording: 'turns'`) restano Hi-Score con inserimento per turno o per freccetta (`RecordScore`, `CompleteTurn`, `CorrectScore`, `VoidScore`, `CloseQualificationEarly`) e la loro schermata, finché non si concludono. I nuovi tornei usano sempre `recording: 'result'`. Il motore a turni non è più raggiungibile da un torneo nuovo; la sua rimozione è una decisione aperta (vedi report).
