# Punteggi e turni

HIGH_SCORE è l'unica modalità di punteggio eseguibile. X01 dispone dei tipi `X01Configuration`, `X01Input`, `X01State` e dell'interfaccia `X01Rule`, ma non di un'implementazione attivabile. Il contratto prevede bust, vittoria e dichiarazione manuale del tipo di chiusura; il backend non deduce caratteristiche del Pub Time Darts.

Default HIGH_SCORE: 3 turni, 3 freccette per turno, massimo 60 per freccetta e 180 per turno. Sono ipotesi configurabili, non descrizioni del bersaglio vintage. Se omesso, `maxTurnScore` è `dartsPerTurn * maxDartScore`. Limiti: 1–100 turni, 1–12 freccette, massimo lancio fino a 1000 e massimo turno fino a 12000. Non si verifica se un totale è combinatoriamente ottenibile sui settori di un particolare bersaglio.

Per ogni turno scegliere uno dei due formati:

```json
{
  "expectedVersion": 12,
  "expectedMatchVersion": 3,
  "turnId": "11111111-1111-4111-8111-111111111111",
  "score": 120
}
```

```json
{
  "expectedVersion": 12,
  "expectedMatchVersion": 3,
  "turnId": "11111111-1111-4111-8111-111111111111",
  "score": 40,
  "dartIndex": 1
}
```

I due formati non possono essere mescolati. Un singolo lancio è unico per `(turnId, dartIndex)`; uno zero è un risultato valido e va registrato esplicitamente. Il turno termina con `CompleteTurn`, dopo un totale oppure tutti i lanci configurati. Il comando rifiuta doppi avanzamenti e turni non correnti. Si ruota fra tutti i partecipanti prima di passare al turno successivo.

La classifica riflette immediatamente ogni punteggio registrato valido. `turns`, `bestTurn`, `average` e `progression` si riferiscono invece ai turni completati; durante un turno incompleto il totale è provvisorio. Tutti i turni obbligatori devono essere completati prima di qualificare. L'ultimo CompleteTurn completa automaticamente la partita; la conferma del vincitore del torneo rimane esplicita.

Ordinamento HIGH_SCORE: totale decrescente; opzionalmente migliore turno decrescente; poi parità irrisolta e spareggio. Posizioni condivise usano ranking competitivo (1, 1, 3). Gli UUID ordinano soltanto la presentazione dei pari e non decidono qualificazione o vittoria. `gapToLeader` è un distacco di punteggio; nei gironi è un distacco di punti di classifica.

`CorrectScore` modifica il valore corrente con audit del precedente. `VoidScore` richiede un motivo, conserva la registrazione annullata e riapre il turno necessario. È quindi possibile reinserire il lancio o il totale con un nuovo ID e una nuova chiave di idempotenza. Una correzione invalida gli spareggi dipendenti; gli spareggi cancellati restano visibili.

Se la fase è finalized, inviare prima `ReopenStage` con un motivo. L'operazione invalida tutte le fasi dipendenti e i relativi risultati. Correggere, confermare di nuovo e generare la nuova finale. Le iscrizioni escluse tramite chiusura anticipata non possono essere rimesse in gara tramite correzione del punteggio.
