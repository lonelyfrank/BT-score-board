# Macchine a stati

| Torneo da    | Transizioni ordinarie ammesse   |
| ------------ | ------------------------------- |
| draft        | registration, cancelled         |
| registration | ready, cancelled                |
| ready        | registration, active, cancelled |
| active       | paused, completed, cancelled    |
| paused       | active, cancelled               |
| completed    | nessuna                         |
| cancelled    | nessuna                         |

La prima iscrizione apre registration. StartTournament da registration esegue ReadyTournament e Start nella stessa transazione, dopo tutti i controlli. ConfigureTournament accetta solo draft/registration/ready; da ready riporta a registration per imporre una nuova verifica. Regole e partecipanti non cambiano dopo l'avvio.

| Partita da | Transizioni ordinarie ammesse |
| ---------- | ----------------------------- |
| scheduled  | ready, cancelled              |
| ready      | active, cancelled             |
| active     | paused, completed, cancelled  |
| paused     | active, cancelled             |
| completed  | nessuna                       |
| cancelled  | nessuna                       |

Il generatore crea partite ready. Una partita non può diventare completed con turni obbligatori mancanti. Gli unici casi speciali sono bye dichiarati dal tabellone e chiusura anticipata Quick con esclusioni esplicite. Una partita completata pari può richiedere uno spareggio: completezza dei dati e decisione del vincitore sono condizioni distinte.

PauseTournament sospende anche la partita attiva; ResumeTournament la riprende senza muovere il turno. Non si registrano risultati in un torneo paused/completed/cancelled. Una partita paused continua a occupare il bersaglio del torneo.

Le fasi passano da open a finalized. Una finale non viene generata prima della conferma della qualificazione. Il passaggio dei turni eliminatori è automatico solo quando tutte le partite del turno hanno un vincitore valido.

Operazioni amministrative eccezionali, con audit:

- ReopenStage riporta la fase a open, il torneo ad active e invalida tutte le fasi successive. È ammessa anche su tornei completed, ma non cancelled.
- VoidScore può riportare una partita completed a ready se la sua fase è open, riaprendo il turno interessato.
- Gli spareggi dipendenti da risultati corretti vengono cancelled.

Queste eccezioni non sono transizioni ordinarie accessibili modificando un campo status: passano per comandi nominati, controllo versione, autorizzazione e audit.
