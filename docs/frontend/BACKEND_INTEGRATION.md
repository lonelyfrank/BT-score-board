# Integrazione con il backend reale

I contratti preliminari dell'handoff non vengono presentati come API esistenti. Fonte autorevole: `packages/contracts/src/schemas/index.ts`, `docs/openapi.json`, [contratto applicativo](../frontend-integration.md).

| UI               | API                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------- |
| Giocatori        | GET/POST `/players`, PATCH `/players/:id`, GET `/players/:id/statistics`                |
| Configurazione   | POST `/tournaments`, poi `/tournaments/:id/players` e `/start`                          |
| Live             | GET `/matches/:id`: `turnState`, `tournamentVersion`, `scoreboard`                      |
| Invio turno      | POST `/matches/:id/scores`, poi `/turns/complete`                                       |
| Annullamento     | POST `/scores/:scoreId/void` con motivo e versioni                                      |
| Classifiche      | GET `/tournaments/:id/standings`, nell'ordine ufficiale                                 |
| Qualifica/finale | POST `/qualification/finalize`, `/finals/generate`, `/elimination/advance`, `/complete` |
| Spareggio        | POST `/tournaments/:id/tiebreaks`, poi il normale flusso incontro                       |

Tutti i path hanno prefisso `/api/v1`. Bearer inserito in Impostazioni; nessun segreto incorporato nel bundle. Gli ID di iscrizione sono distinti dai playerId: gli abbinamenti usano `TournamentEntry.id`.

## Retry

Ogni comando conserva path, body completo e Idempotency-Key. Errori di rete, risposte 5xx o 429 lasciano il comando recuperabile. I retry ripetono lo stesso body e la stessa chiave. Una risposta valida è seguita da una lettura corrente: il replay potrebbe restituire uno snapshot precedente. I conflitti rimuovono il comando incerto e ricaricano la partita, lasciando all'utente il controllo prima di un nuovo tentativo.

RecordScore e CompleteTurn sono due transazioni. Un totale salvato ma non ancora chiuso viene mostrato come da recuperare. Un CompleteTurn incerto viene ritentato prima di qualsiasi nuovo punteggio: non si assegna lo stesso valore al giocatore successivo. Il tastierino è bloccato durante l'invio e durante il recupero è modificabile soltanto la conferma.

CreateTournament non supporta idempotenza nell'API attuale: in caso di risposta persa all'atto di creazione, l'interfaccia rimanda alla lista per verificare la bozza prima di ricrearla. Se l'ID è noto, le iscrizioni e l'avvio possono essere ripresi senza duplicare gli iscritti.

## Differenze dall'handoff

HIGH_SCORE soltanto; niente bust/checkout/doppi fittizi. Finale Quick unica. Nessun endpoint catalogo, restart-leg, team o semantica definitiva della categoria 02. Il codice non implementa regole di gioco nel browser.
