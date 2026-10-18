# API REST v1

Contratto generato: [`openapi.json`](./openapi.json). A server avviato: `GET /api/v1/openapi.json`. Nessuna Swagger UI o pagina frontend viene installata. Le risposte vengono validate e proiettate mediante DTO Zod; non sono righe ORM.

Tutte le rotte, salvo `/health` e `/api/v1/health`, richiedono `Authorization: Bearer <ORGANIZER_TOKEN>`. Con `PUBLIC_READS=true`, le GET sono pubbliche tranne `/audit`. Il documento OpenAPI descrive conservativamente l'autenticazione organizzatore anche per le letture opzionalmente pubbliche. Mutazioni sempre protette. Nessun ruolo è accettato dal body o da un header dichiarato dal client.

| Metodo     | Percorso sotto `/api/v1`                                                             | Funzione                                                |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| GET, POST  | `/players`                                                                           | Ricerca / creazione                                     |
| GET, PATCH | `/players/:id`                                                                       | Dettaglio / modifica e disattivazione                   |
| GET        | `/players/:id/history`, `/players/:id/statistics`                                    | Partecipazioni / statistiche compatibili                |
| GET, POST  | `/events`                                                                            | Lista / creazione serate                                |
| GET, PATCH | `/events/:id`                                                                        | Dettaglio / modifica                                    |
| GET, POST  | `/tournaments`                                                                       | Lista / creazione                                       |
| GET        | `/tournaments/:id`                                                                   | Snapshot completo e versioni                            |
| GET, POST  | `/tournaments/:id/players`                                                           | Iscrizioni / iscrizione giocatore                       |
| POST       | `/tournaments/:id/registration/open`, `/ready`, `/configure`                         | Preparazione torneo                                     |
| POST       | `/tournaments/:id/start`, `/pause`, `/resume`, `/cancel`, `/complete`                | Comandi di ciclo vita                                   |
| GET        | `/tournaments/:id/stages`, `/groups`, `/matches`, `/standings`, `/results`           | Read model                                              |
| POST       | `/tournaments/:id/qualification/finalize`, `/qualification/close-early`              | Conferma qualificazione / esclusioni esplicite          |
| POST       | `/tournaments/:id/finals/generate`, `/elimination/advance`                           | Generazione finale/tabellone / riconferma eliminazione  |
| POST       | `/tournaments/:id/tiebreaks`, `/stages/reopen`, `/matches/reorder`                   | Spareggio / riapertura amministrativa / ordine di gioco |
| GET        | `/tournaments/:id/audit`, `/changes`                                                 | Audit paginato / eventi da cursore                      |
| GET        | `/matches/:id`, `/matches/:id/scores`, `/matches/:id/turns`                          | Partita / registrazioni / turn manager                  |
| POST       | `/matches/:id/start`, `/pause`, `/resume`, `/scores`, `/turns/complete`, `/complete` | Comandi partita                                         |
| POST       | `/scores/:id/correct`, `/scores/:id/void`                                            | Correzione / annullamento                               |

I percorsi abbreviati nelle celle condividono il prefisso prima dell'ID: per esempio `/tournaments/:id/pause` e `/matches/:id/pause` sono distinti.

Le liste players/events/tournaments/history/audit accettano `limit` (default 25, massimo 100) e `offset` (default 0). Ricerca `search` e filtro `status` su players/events/tournaments/history; `eventId` filtra tournaments. In search `%` e `_` sono wildcard SQLite LIKE, sempre tramite parametri bindati. Le altre collezioni sono limitate dalla dimensione del torneo e restituite interamente. `/changes` usa `after` (sequenza esclusiva, default 0) e `limit` (default 50, massimo 100).

```json
{ "items": [], "total": 0, "limit": 25, "offset": 0 }
```

Creazioni: 201. Letture e comandi: 200. Richiesta malformata/schema HTTP: 400. Token assente/errato: 401. Ruolo insufficiente: 403. Risorsa assente: 404. Stato/versione/chiave/duplicato incoerente: 409. Violazione di validazione applicativa o regola numerica: 422. Rate limit: 429. Database occupato: 503. Errore interno: 500, senza stack o SQL.

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Tournament version has changed",
    "requestId": "req-7"
  }
}
```

Ogni comando torneo richiede `expectedVersion`; ogni comando partita o punteggio richiede anche `expectedMatchVersion`. Le versioni sono interi di controllo, non timestamp. Le risposte torneo espongono ETag, ma `If-Match` non è implementato: utilizzare i campi del body.

`Idempotency-Key` è obbligatorio per RecordScore, raccomandato e supportato per gli altri comandi. Formato: 8–128 caratteri `[A-Za-z0-9._:-]`. Ambito globale del database. Stessa chiave e stessa richiesta restituiscono la risposta originale; chiave riutilizzata per un input, percorso, comando od operatore diverso genera 409. Le semplici creazioni di giocatori/eventi/tornei non supportano questa semantica: dopo un timeout verificarne l'esito tramite le liste prima di ripetere.

Le operazioni emettono eventi persistenti tra cui TournamentStarted, ScoreRecorded, TurnCompleted, MatchCompleted, StandingsUpdated, QualificationCompleted, FinalStarted e TournamentCompleted. Il cursore è monotono globale, quindi le sequenze di un singolo torneo possono avere intervalli.
