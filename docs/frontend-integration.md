# Contratto per il frontend

Il frontend può importare i tipi/schemi di `@bt/contracts` nel workspace o generare un client da `docs/openapi.json`. Il dominio non dipende dal frontend. Tutti gli ID negli esempi sotto sono segnaposto UUID: usare quelli ricevuti dalle API.

Usare `Content-Type: application/json` e il bearer organizzatore. Non incorporare il token negli asset pubblici, negli URL o in un display spettatore. Per un browser su origine diversa, utilizzare un reverse proxy sulla stessa origine: il server non configura CORS. Se esposto fuori dal dispositivo, usare HTTPS tramite reverse proxy; CORS non sostituisce l'autenticazione.

## Flusso Quick completo

1. `POST /api/v1/players` per i partecipanti:

```json
{ "displayName": "Giulia", "nickname": "Ace" }
```

2. `POST /api/v1/tournaments`:

```json
{
  "name": "Finale del venerdì",
  "mode": "QUICK_HIGH_SCORE",
  "scoringConfiguration": {
    "kind": "HIGH_SCORE",
    "turns": 3,
    "dartsPerTurn": 3,
    "maxDartScore": 60
  },
  "tournamentConfiguration": {
    "qualifiers": 4,
    "tiePolicy": "PLAYOFF",
    "playingOrder": "registration"
  }
}
```

3. `POST /api/v1/tournaments/{tournamentId}/players` una volta per giocatore. Usare la nuova versione restituita dopo ogni comando:

```json
{ "expectedVersion": 0, "playerId": "11111111-1111-4111-8111-111111111111", "seed": 1 }
```

La risposta contiene `entries[].id`, distinto da `entries[].playerId`. Gli ID dei partecipanti nelle partite e negli spareggi sono ID di iscrizione.

4. `POST .../tournaments/{id}/start` con `{"expectedVersion":4}`; leggere il match in `matches`. `POST .../matches/{matchId}/start` con le versioni correnti:

```json
{ "expectedVersion": 5, "expectedMatchVersion": 0 }
```

5. Leggere `GET .../matches/{matchId}`. La risposta espone `tournamentVersion`, `version`, `turnState.currentTurn`, `nextTurn`, `turnsRemaining` e `completedEntryIds`. Mostrare il giocatore del turno corrente tramite `participantId` → TournamentEntry → Player.

6. `POST .../matches/{matchId}/scores` con `Idempotency-Key: <UUID della singola operazione>`:

```json
{
  "expectedVersion": 6,
  "expectedMatchVersion": 1,
  "turnId": "22222222-2222-4222-8222-222222222222",
  "score": 120
}
```

Per singole freccette aggiungere `dartIndex` (da 1 a dartsPerTurn), uno per richiesta. Un turno non può contenere sia totale sia singoli lanci.

7. `POST .../matches/{matchId}/turns/complete`, con nuove versioni e lo stesso `turnId`:

```json
{
  "expectedVersion": 7,
  "expectedMatchVersion": 2,
  "turnId": "22222222-2222-4222-8222-222222222222"
}
```

Ripetere fino alla fine. L'ultima chiusura completa la partita automaticamente. Gli incrementi di versione possono essere maggiori di uno quando un comando chiude anche partita o fase: non calcolarli nel client.

8. `GET .../tournaments/{id}/standings` restituisce una raccolta per fase/target. Esempio di una riga:

```json
{
  "tournamentEntryId": "33333333-3333-4333-8333-333333333333",
  "placement": 1,
  "tied": false,
  "total": 360,
  "bestTurn": 140,
  "average": 120,
  "turns": 3,
  "gapToLeader": 0,
  "progression": [100, 240, 360],
  "played": 0,
  "wins": 0,
  "draws": 0,
  "losses": 0,
  "points": 0,
  "scored": 0,
  "conceded": 0,
  "difference": 0,
  "criteria": [360]
}
```

9. `POST .../tournaments/{id}/qualification/finalize` con la versione corrente. La risposta include:

```json
{
  "kind": "qualification",
  "status": "finalized",
  "qualifiedEntryIds": [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666"
  ]
}
```

Questo è un estratto di Stage, non l'intera risposta. Su `TIE_REQUIRES_PLAYOFF`, rileggere la classifica e creare `/tiebreaks` con il target e l'intero gruppo pari:

```json
{
  "expectedVersion": 60,
  "targetId": "77777777-7777-4777-8777-777777777777",
  "entryIds": ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"]
}
```

Giocare il nuovo match con lo stesso protocollo. Il backend determina l'ordine dai risultati: non accetta un vincitore dichiarato senza prova.

10. `POST .../tournaments/{id}/finals/generate` con `expectedVersion`. La risposta contiene una nuova Stage final e un nuovo match senza score. Avviare e giocare questo match, poi `POST .../tournaments/{id}/complete`. Eventuale parità del vincitore segue il protocollo di spareggio.

11. `GET .../tournaments/{id}/results`:

```json
[
  {
    "tournamentId": "88888888-8888-4888-8888-888888888888",
    "tournamentEntryId": "33333333-3333-4333-8333-333333333333",
    "finalPlacement": 1,
    "points": 390,
    "statistics": {
      "kind": "HIGH_SCORE",
      "total": 390,
      "turns": 3,
      "bestTurn": 150,
      "average": 130
    }
  }
]
```

L'esempio mostra soltanto il vincitore; la risposta reale comprende tutte le iscrizioni.

## Concorrenza, retry e correzioni

Conservare body e chiave della richiesta fino a esito certo. Dopo un timeout ripetere **esattamente** quella richiesta con la stessa chiave; non aggiornare la versione durante un retry. Dopo un 409 VERSION_CONFLICT, rileggere il torneo, mostrare il dato attuale e preparare un nuovo comando con una nuova chiave. Un replay può restituire lo snapshot originale ormai vecchio: rileggere lo stato corrente prima di proseguire da una sessione interrotta.

Una correzione usa `/scores/{scoreId}/correct`, versioni correnti, nuovo score e motivo facoltativo. Per uno score di una fase finalized, richiedere all'organizzatore la procedura esplicita `/tournaments/{id}/stages/reopen` con stageId e reason. Informarlo che le fasi successive verranno invalidate, poi applicare la correzione e riconfermare/rigenerare. Mostrare le vecchie partite come cancellate, non come finali correnti.

Polling semplice: GET del torneo oppure `/changes?after=<ultimo cursore>`; sugli eventi rileggere il read model necessario. Non assumere push, supporto offline o sincronizzazione automatica multi-device.

## Frontend Bite the Trouble integrato

`apps/web` usa questi contratti direttamente attraverso `HttpAdapter`. `GET /matches/:id` espone anche `scoreboard[]`, con `tournamentEntryId`, `total`, `turns`, `bestTurn`, `average` e `progression`. I valori sono prodotti da `playerPerformance` nel dominio: il browser li presenta senza ricalcolarli.

La build del frontend è servita da Fastify sulla stessa origine delle API. HTML e asset compilati sono pubblici; i read model e i comandi conservano l'autenticazione prevista. Consultare [integrazione frontend](frontend/BACKEND_INTEGRATION.md) per protocollo di recupero degli invii e differenze dal mockup.
