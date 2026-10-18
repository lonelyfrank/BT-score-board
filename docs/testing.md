# Verifica automatica

```sh
pnpm typecheck
pnpm openapi
pnpm test
pnpm build
pnpm format:check
pnpm smoke
```

`pnpm check` esegue typecheck, test e build. Il documento OpenAPI è generato dai medesimi schemi delle rotte; rigenerarlo quando cambiano i contratti. Vitest usa database temporanei o in-memory, senza server cloud. Le prove HTTP usano Fastify inject ed eseguono la reale validazione, autenticazione, serializzazione, applicazione e SQLite.

| Suite       | Verifica                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | Accumulo, massimi, valori non validi, state machine, proprietà del calendario per 2–20 partecipanti, bracket e bye                      |
| quick       | 4/8 giocatori, qualificazioni, finali nuove, pareggi al limite, spareggi ripetuti, correzioni, turni singoli, sospensione e storico     |
| groups      | Gironi pari/dispari, assegnazione manuale, punti e differenza, spareggi, seeding, bye, semifinali, finale, ordine di gioco e riaperture |
| persistence | Migrazioni, FK/UNIQUE, audit append-only, atomicità, idempotenza, versioni fra connessioni, backup e riavvio                            |
| api         | Due tornei completi via REST, schemi, errori, paginazione, token, letture spectator, rate limit e validatore OpenAPI swagger-parser     |

Le proprietà del calendario controllano tutte le coppie e l'assenza di doppie presenze nello stesso round; non si limitano a confrontare uno snapshot. Le prove di rollback iniettano un errore dopo il salvataggio delle proiezioni per assicurare che nemmeno score, eventi o chiave di idempotenza rimangano parzialmente scritti.

`pnpm smoke` avvia davvero il build compilato su una porta locale temporanea: verifica health, autenticazione, creazione e lettura dopo riavvio usando un database temporaneo poi rimosso. Richiede la possibilità di aprire una porta locale.

I test non simulano hardware né certificano le regole di un bersaglio specifico. Non sono inclusi carichi distribuiti, crash fisici del disco o prestazioni da grandi eventi: lo scope è un piccolo backend locale per tornei da pub.
