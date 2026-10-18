# Modalità torneo

## Quick High Score

Registrare almeno `qualifiers` partecipanti (default 4; minimo 2). Un numero inferiore viene rifiutato all'avvio: il backend non riduce automaticamente il numero di finalisti. Le iscrizioni sono ordinate per registrazione oppure per seed esplicito di ogni giocatore.

StartTournament crea una partita di qualificazione generale. Completarla per tutti, poi chiamare FinalizeQualification. Il comando rifiuta turni incompleti e pareggi che attraversano la soglia di qualificazione. Non promuove chi è momentaneamente nei primi quattro.

Un pareggio decisivo richiede CreateTieBreak sul match di qualificazione, con esattamente tutti gli iscritti del gruppo a pari posizione. Viene creata una nuova prova HIGH_SCORE con `tieBreakTurns` (default 1). Dopo averla giocata, richiamare FinalizeQualification. Se persiste una parità, un nuovo spareggio deve coinvolgere l'intero sottogruppo ancora pari. Un pareggio fra qualificati già certi può restare irrisolto, perché l'ordine della finale segue la configurazione di gioco.

GenerateFinal crea una prova nuova; nessun punto della qualificazione viene trasferito. `finalScoring` può cambiare i parametri HIGH_SCORE della finale; null riutilizza quelli iniziali. Completare i turni, eventuale spareggio per il primo posto, quindi CompleteTournament. Le altre posizioni possono rimanere condivise.

Chiusura anticipata: `qualification/close-early` è riservato alla qualificazione Quick attiva. L'organizzatore deve indicare **esattamente tutti** i partecipanti incompleti da escludere e un motivo. Devono restare almeno abbastanza prove complete da riempire i posti qualificanti. Le registrazioni restano conservate; i turni mancanti diventano skipped, gli esclusi non vengono classificati. Confermare poi normalmente la qualificazione.

## Gironi e singola eliminazione

Gironi automatici con distribuzione a serpentina sull'ordine configurato, oppure `groupAssignments` contenente gli **ID delle iscrizioni**, non dei giocatori. Per assegnazioni manuali: iscrivere, poi ConfigureTournament prima dell'avvio. Ogni giocatore deve comparire una volta, ogni girone avere almeno due giocatori e almeno `qualifiersPerGroup` iscritti.

Calendario round-robin tramite rotazione: ogni coppia si incontra una volta, nessun giocatore compare due volte nello stesso `scheduleRound`, i gruppi dispari hanno riposi impliciti. `sequence` è l'ordine di utilizzo del bersaglio; ReorderMatches richiede tutti i match ancora ready della fase. Modificare l'ordine non cambia gli accoppiamenti del tabellone.

Ogni incontro usa HIGH_SCORE. I punti classifica (default vittoria 3, pareggio 1, sconfitta 0) sono configurabili e distinti dai punti segnati/subiti. Con `allowDraws: false`, un incontro pari richiede uno spareggio sul suo match prima di contare nella classifica; i punti dello spareggio non si sommano ai punti segnati/subiti.

Catena di classifica fissa e documentata: punti, differenza, punti segnati, scontro diretto solo se il gruppo ancora pari contiene esattamente due giocatori, spareggio esplicito sul gruppo. Non viene inventata una mini-classifica per parità multiple. Sono richiesti spareggi anche fra posti qualificanti pari quando influenzano il seeding.

Dopo FinalizeQualification, i seed sono assegnati per posizione nel girone, poi per `Group.ordering`: tutti i primi, tutti i secondi, ecc. Non si confrontano punteggi grezzi fra gironi di dimensioni diverse. Il tabellone usa posizioni standard 1–8, 4–5, 2–7, 3–6; i bye vanno ai seed migliori. Non è implementata la separazione obbligatoria fra giocatori dello stesso girone.

GenerateFinal crea il primo turno eliminatorio, eventuali bye inclusi. Ogni fase completata con vincitori certi genera automaticamente quella successiva; pareggi richiedono spareggio sul match. Semifinali e finale sono rappresentate come Stage distinti. Dopo una riapertura amministrativa di semifinali o altri turni eliminatori già conclusi, correggere e usare `elimination/advance` per riconfermare l'avanzamento.

CompleteTournament conferma la finale. Secondo posto al finalista perdente, terzo condiviso ai semifinalisti eliminati, quinto ai quarti, ecc. Gli eliminati ai gironi condividono la posizione successiva al numero dei qualificati: nessun confronto arbitrario fra gironi.

## Fuori dall'MVP

X01 eseguibile, doppia eliminazione, finale Quick cumulativa, semifinali Quick, terzo posto, sorteggi casuali e rilevamento automatico dei tiri. Non esistono opzioni API che promettono questi comportamenti senza implementarli.
