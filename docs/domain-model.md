# Modello di dominio

Le interfacce sono in `packages/domain/src/model.ts`. Gli identificatori sono UUID stabili, le date stringhe ISO UTC, i punteggi interi non negativi.

- **Player**: identità permanente, displayName, nickname non univoco, stato active/inactive e timestamp. Disattivare non cancella lo storico.
- **PubEvent**: serata con nome, descrizione, data opzionale e stato planned/active/completed/cancelled. Può contenere più tornei.
- **Tournament**: mode, scoringConfiguration, tournamentConfiguration, stato, fase corrente, timestamp e versione.
- **TournamentEntry**: iscrizione separata dall'identità Player; unique `(tournamentId, playerId)`. Include seed opzionale unico nel torneo e nome al momento dell'iscrizione.
- **Stage**: fase identificata da `kind` stringa estensibile, ordine, stato open/finalized/invalidated, qualificati ed eventuali esclusi dalla chiusura anticipata.
- **Group**: girone con appartenenze esplicite e ordine di seeding.
- **Match**: appartiene a torneo/fase/girone, contiene configurazione congelata, tipo, ordine di gioco `sequence`, round del calendario `scheduleRound`, stato, versione e vincitore opzionale.
- **MatchParticipant**: iscrizione partecipante, ordine, punteggio finale, posizione e outcome.
- **Turn**: turno di un partecipante, numero progressivo per quel partecipante, stato e timestamp. Il round del calendario è un concetto diverso.
- **ScoreEntry**: totale di turno (`dartIndex: null`) oppure singolo lancio indicizzato da 1. Sorgente manual, operatore, data, valore corrente e flag voided.
- **TournamentResult**: risultato confermato con posizione e statistiche dell'ultima prova regolare del giocatore; rimane vuoto fino alla conferma del torneo.
- **Operation**: registro append-only con before/after, data, operatore e motivo. Le correzioni conservano il valore precedente e quello nuovo.

Totali, medie, classifiche e progressioni sono derivati dai punteggi validi; i risultati e gli outcome confermati sono materializzati atomicamente per lo storico. Non esiste un endpoint per modificare manualmente una classifica.

Le partite invalidate rimangono consultabili come cancelled; le fasi come invalidated. Non si eliminano punteggi per rigenerare una finale. La riapertura amministrativa rimuove i risultati correnti, conserva nell'audit quelli precedenti e invalida tutte le fasi successive.

Le statistiche individuali raggruppano per configurazione completa HIGH_SCORE: numero turni, numero freccette e massimi. Gli spareggi e i bye non entrano nelle medie o nel numero di incontri disputati. I tornei cancellati sono esclusi dalle statistiche, ma rimangono nello storico.
