# Formati di torneo

Il formato (`Tournament.mode`, tipo `TournamentFormat`) è indipendente dal gioco del totem (`Tournament.gameMode`). Tutti i formati registrano risultati finali (`recording: 'result'`).

| Formato            | Giochi ammessi | Struttura                                                           |
| ------------------ | -------------- | ------------------------------------------------------------------- |
| `SINGLE_MATCH`     | tutti e 8      | Una partita fra 2–4 giocatori (Odd & Even: 2); è la «Nuova partita» |
| `QUICK_HIGH_SCORE` | solo Hi-Score  | Qualifica unica, migliori N (default 4) in una finale nuova         |
| `GROUPS`           | tutti e 8      | Gironi all'italiana, poi eliminazione diretta (semifinali, finale)  |

Il formato rapido confronta i totali di giocatori diversi: ha senso solo per Hi-Score, quindi altre modalità sono rifiutate (`INVALID_GAME_MODE`).

## Partita singola

All'avvio crea una fase `final` con un solo incontro. Quando il risultato decide un vincitore il torneo si conclude da solo con i piazzamenti. Se il risultato è pari (Hi-Score, Exacta, Shanghai) restano uno spareggio sul totem o una decisione dell'organizzatore.

## Hi-Score rapido (formato B)

1. L'organizzatore crea il torneo e iscrive i partecipanti; l'ordine di gioco segue iscrizione o seed.
2. Con **meno partecipanti dei finalisti** (default: meno di 4, minimo 2) non c'è qualifica: all'avvio tutti giocano direttamente la finale. Con almeno 4 si gioca la qualifica, anche se si qualificano tutti.
3. Qualifica: un incontro con tutti; l'organizzatore inserisce il totale finale di ogni giocatore appena il totem lo mostra (anche a gruppi, in qualsiasi ordine). Ogni inserimento è salvato subito.
4. `FinalizeQualification` richiede tutti i totali. Una parità sulla soglia (es. due giocatori al 4° posto) blocca la conferma: si risolve con `CreateTieBreak` (nuova partita Hi-Score fra i soli pari, i cui totali non si sommano) o con `DecideTie` (ordine esplicito + motivo, registrato nello storico). Nessun criterio casuale.
5. `GenerateFinal` crea una partita nuova fra i qualificati: i punti della qualifica non si sommano.
6. `CompleteTournament` richiede un primo posto deciso (spareggio o decisione se pari). Piazzamenti: finalisti per punteggio di finale, poi gli altri per posizione in qualifica.

Ritiri: `WithdrawEntry` esclude il giocatore dalla fase in corso (non si qualifica, i suoi totali già registrati restano nello storico); la qualifica si completa con gli altri.

## Gironi ed eliminazione diretta (formato A)

Gironi automatici a serpentina sull'ordine configurato, oppure composizione manuale (`groupAssignments`, ID delle iscrizioni). Ogni girone ha almeno 2 giocatori e almeno `qualifiersPerGroup`. Calendario round-robin: ogni coppia una volta; con un numero dispari un giocatore riposa a ogni round.

Ogni incontro si registra con il vincitore del totem (Hi-Score: con i due totali). Punti classifica configurabili (default V 3, N 1, P 0). Pareggi solo dove il gioco li prevede (Hi-Score, Exacta, Shanghai) e se `allowDraws`; altrimenti un pari richiede spareggio o decisione sull'incontro.

### Criteri di classifica (`groupRanking`)

| Valore         | Catena dopo i punti                                                 | Default per  |
| -------------- | ------------------------------------------------------------------- | ------------ |
| `POINTS_SCORE` | differenza punteggi, punteggi segnati, scontro diretto (solo tra 2) | Hi-Score     |
| `POINTS_WINS`  | vittorie, scontro diretto (solo tra 2)                              | altri giochi |

`POINTS_SCORE` è ammesso solo per Hi-Score: i punteggi grezzi di 301/501, Exacta, Shanghai o Odd & Even non sono confrontabili e non diventano mai criterio di classifica. Dopo lo scontro diretto restano spareggio o decisione dell'organizzatore.

`FinalizeQualification` richiede tutti gli incontri registrati (o annullati) e nessuna parità che attraversi la soglia o tocchi l'ordine dei qualificati. Seed del tabellone: tutti i primi, poi tutti i secondi, per ordine di girone; accoppiamenti standard 1–8, 4–5, 2–7, 3–6, bye ai seed migliori. Ogni turno eliminatorio con vincitori certi genera il successivo; `CompleteTournament` conferma la finale. Piazzamenti: 2° al finalista, 3° condiviso ai semifinalisti, ecc.; gli eliminati ai gironi condividono la posizione successiva ai qualificati.

### Casi particolari

- **Ritiro** (`WithdrawEntry`): gli incontri non ancora giocati vanno all'avversario a tavolino (`walkover`, punti vittoria all'avversario, esclusi dalle statistiche personali); quelli giocati restano. Due ritirati nello stesso incontro: incontro annullato. Un ritirato non si qualifica mai.
- **Incontro annullato** (`CancelMatch`, con motivo): non si gioca e non conta in classifica. Ammesso per incontri dei gironi e spareggi non giocati; un incontro a eliminazione diretta ha sempre bisogno di un vincitore.
- **Iscrizione rimossa** prima dell'avvio: `UnregisterPlayer`.
- **Partecipanti insufficienti**: rifiutati all'avvio (`INVALID_GROUP_ASSIGNMENTS`, `INSUFFICIENT_PLAYERS`, `INVALID_PLAYER_COUNT`).
- **Correzioni**: vedi [regole di punteggio](scoring-rules.md#correzioni).

## Fuori dall'MVP

Doppia eliminazione, finale a punti cumulativi, semifinali nel formato rapido, finale 3°/4° posto, squadre, sorteggi casuali, separazione obbligatoria fra giocatori dello stesso girone, qualsiasi collegamento con il totem.
