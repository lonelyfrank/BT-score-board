# Partecipazione flessibile, manche e tracciamento progressivo

Evoluzione del modello per serate reali del Bite the Trouble: iscritti senza limiti legati al totem, singoli e squadre disomogenee, manche multiple, rotazioni, risultati finali o round per round. Il totem resta l'unica autorità sulle regole e sui risultati; l'app organizza e registra.

## Livelli del modello

| Livello           | Tipo                                 | Dove vive            | Ruolo                                                         |
| ----------------- | ------------------------------------ | -------------------- | ------------------------------------------------------------- |
| Persona           | `Player`                             | store `players`      | Anagrafica del locale                                         |
| Unità competitiva | `TournamentEntry` (CompetitionEntry) | `tournament.entries` | Singolo o squadra: un posto sul totem, una riga in classifica |
| Manche            | `Heat`                               | `match.heats`        | Sessione fisica al bersaglio, solo contenitore                |
| Incontro          | `Match`                              | `tournament.matches` | Prova competitiva: decide classifica e vincitore              |
| Competizione      | `Tournament` (+ `Stage`, `Group`)    | aggregato            | Fasi, qualificazioni, risultati ufficiali                     |

Relazioni: un `Player` appartiene al massimo a una `TournamentEntry` per torneo (`members`); un `Match` contiene le entry che si confrontano e, se sono più dei posti del totem, le distribuisce in `Heat`. **La classifica è sempre quella del Match**: nella Hi-Score Night la qualifica è un unico match con N iscritti, le manche sono turni al bersaglio e i migliori 4 si scelgono su tutti i punteggi. Girone (`Group`), incontro (`Match`) e manche (`Heat`) restano concetti distinti.

Tutto è dentro l'aggregato `Tournament`, l'unità di consistenza già usata da IndexedDB e SQLite: ogni comando è un commit atomico con controllo di versione (nessuna scrittura parziale, conflitto fra schede = `STALE_DATA`).

### CompetitionEntry

`TournamentEntry` è esteso con `kind` (`single` | `team`), `name` e `members` (in ordine di tiro). `playerId` resta il primo membro per compatibilità con dati, API e vincoli SQLite esistenti; `displayNameAtRegistration` è il nome della squadra o «Frank + Marco». Tutto il motore (gironi, tabellone, spareggi, ritiri, risultati) lavora sulle entry: una squadra si comporta come un partecipante.

Invarianti: 1–8 membri per unità, massimo 256 unità per torneo (limite tecnico di memoria e schermo, non del totem), ogni giocatore in una sola unità, composizione modificabile solo prima dell'avvio con un unico comando `ComposeEntries` (tutto o niente).

La composizione è pura e indipendente dalla UI (`competition/teams.ts`): `buildTeams` (in ordine, casuale, bilanciata con rating facoltativi; numero di squadre `ceil(n/size)`, dimensioni che differiscono al massimo di 1: 7 in coppie → 2·2·2·1), `reshuffleTeams` (conserva squadre bloccate, numero e dimensioni), `swapPlayers`, `movePlayer`, `reverseTeam`, `swapTeams`, `renameTeam`, `dissolveTeam`, `checkComposition` (errori bloccanti: duplicati, mancanti, sconosciuti; avviso: squadre disomogenee, confermabile).

### Heat

```
pending ⇄ ready → active → completed
   └────────┴──────┴→ cancelled (solo se tutti gli iscritti della manche si ritirano)
```

- Capacità: `tournamentConfiguration.heatCapacity` (null = massimo del gioco, 4; Odd & Even 2), da 1 a 8.
- Strategie (`planHeats`): **sequenziale** riempie nell'ordine (19 → 4·4·4·4·3, 17 → 4·4·4·4·1), **bilanciata** (predefinita) distribuisce in modo uniforme (17 → 4·4·3·3·3), **casuale** mescola con dimensioni uniformi. Nessuna manche è invalida perché non piena.
- Create automaticamente quando le entry di un match superano la capacità (qualifica e finale Hi-Score, partita libera, spareggi numerosi). Partite a 2–4 restano senza manche: nessun passaggio in più.
- Modifiche solo alle manche non iniziate: `ArrangeHeats` (disposizione completa: sposta, scambia, unisce, divide, crea, riordina), `GenerateHeats` (rigenera solo le `pending`; `ready`, giocate e attive restano), `LockHeat` (conferma ⇄ sblocca).
- Un bersaglio: una sola manche `active` per torneo (`HEAT_BUSY`), e nessun altro incontro in corso (`BOARD_BUSY`). Registrare un valore per una manche in attesa la porta al bersaglio se il bersaglio è libero.
- Una manche si completa da sola quando ha tutti i risultati; `CompleteHeat` la chiude anche con risultati mancanti, che restano visibili come mancanti e si possono inserire dopo. La qualifica non si conferma finché manca un risultato (o il giocatore non è ritirato).
- Match su più manche: confronto solo per punteggio, e solo per giochi a punti (`comparableAcrossHeats`: Hi-Score, Shanghai). Nessun vincitore dichiarato né vittoria Shanghai globale. Una partita libera con più unità dei posti è rifiutata per X01, Exacta e Odd & Even (punti rimasti, distanze da obiettivi diversi e progressioni non sono confrontabili fra manche).

### Tracciamento progressivo

`tournament.tracking`: `FINAL_ONLY` (predefinito, comportamento precedente), `ROUND_BY_ROUND` (prima del risultato finale ogni round va registrato o saltato esplicitamente, nei giochi a round fissi), `FLEXIBLE` (round facoltativi).

`RoundRecord` (`match.rounds`) conserva incontro, entry, round, giocatore della squadra, valore, tipo (`points` | `remaining` | `progress`), stato, correzione, motivo, origine, autore e ora. Stati: `recorded`, `skipped` (non osservato, mai zero), `corrected` (sostituito dal record che lo punta), `voided`; `missing` è derivato (nessun record). Comandi: `RecordRound` (nuovo valore o correzione, idempotente; stesso valore = nessuna correzione), `VoidRound` (annulla o ripristina il valore precedente).

Semantica per gioco (`trackingSpec`): Hi-Score, Exacta e Shanghai punti per round (Shanghai max 9 × numero del round) e totale; X01 punti rimasti (predefinito, l'ultimo valore) o punti fatti (`x01Entry: 'SCORED'`, partenza − somma; un totale oltre la partenza indica un bust non registrato e non viene proposto); Odd & Even numero raggiunto. Nessun bust, apertura o chiusura viene dedotto.

`roundProgress` restituisce round, mancanti, saltati, valore parziale, `computed` (solo con progressione completa), migliore e media. **Il risultato ufficiale prevale**: la classifica usa solo `match.result`. Se il valore del totem differisce da una progressione completa, `RecordResult` risponde `RESULT_DIFFERS_FROM_ROUNDS` finché non si indica un motivo; entrambi i valori restano in `result.reconciliation` e i round non vengono mai ritoccati. Le correzioni dei risultati ufficiali continuano a passare da `resultDependencies` (riapertura fasi, annullamento finali e spareggi con conferma esplicita).

### Rotation Manager

`match.rotations`: ordine dei membri, posizione del tiratore previsto, pausa, cronologia per l'annullamento. Comando `RotateTeam` (`advance`, `undo`, `pause`, `resume`, `reorder`). Avanzare non registra mai un punteggio; `RecordRound` con `advanceRotation` attribuisce il round al tiratore previsto e passa al successivo. In pausa (modalità libera) nessun tiratore viene assunto. La rotazione fra manche è derivata da `heatOverview` (al bersaglio, prossima, giocate, in attesa).

## Persistenza e migrazioni

| Archivio    | Versione   | Cosa fa                                                                                                                                                                                                                                                                                                |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IndexedDB   | 2 → 3      | Nella transazione di upgrade riscrive ogni torneo con `upgradeTournament`: entry singole con il giocatore come unico membro, match con `heats`/`rounds`/`rotations` vuoti, `tracking: FINAL_ONLY`, `reconciliation: []`. Tutto o niente.                                                               |
| Backup JSON | schema 1–2 | Importati con lo stesso upgrade prima della validazione Zod (i contratti hanno default per ogni campo nuovo, altrimenti verrebbero scartati).                                                                                                                                                          |
| SQLite      | 0003       | Tabella `entry_members` con `UNIQUE(tournament_id, player_id)`, popolata dalle iscrizioni esistenti; lo storico di un giocatore include le squadre. Le iscrizioni rimosse o ricomposte prima dell'avvio vengono cancellate anche dalle righe relazionali. I documenti JSON sono aggiornati in lettura. |

L'integrità locale (`integrity.ts`) verifica membri, manche (una entry in una sola manche viva, una sola attiva), round (un solo record effettivo per round, tiratore membro dell'unità) e rotazioni prima di ogni commit.

## Limiti e verifiche ancora necessarie sul totem

- **Posti per manche**: impostati a 4 (Odd & Even 2) secondo il catalogo; va verificato sul Pub Time Darts del 1987 se una coppia può davvero condividere un posto alternando i tiri e se esistono giochi a 1 giocatore.
- **Odd & Even**: l'assegnazione dispari/pari per ordine di tiro e il limite di 2 restano un'ipotesi da confermare.
- **Shanghai**: massimo per round (9 × numero) e numero di round (7) da confermare; la vittoria Shanghai non è ammessa nei match su più manche.
- **X01**: il totem mostra i punti rimasti? La modalità predefinita lo assume; «punti fatti» è disponibile ma non deduce bust.
- **Exacta**: l'obiettivo cambia per manche, per questo non si confronta fra manche.
- Una partita libera X01/Exacta/Odd & Even con più unità dei posti non è supportata: usare un torneo a gironi (le squadre sono ammesse) o più partite.
- La composizione a squadre si fa alla creazione del torneo o della partita; il pannello iscrizioni di una bozza salvata aggiunge solo singoli.
- Il rating della composizione bilanciata non è ancora alimentato dalle statistiche nella UI (senza rating la bilanciata segue l'ordine a serpentina).
