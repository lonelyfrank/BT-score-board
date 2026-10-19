# Report — Local-first e giochi del totem

Data: 19 ottobre 2026. Branch `feat/standalone-pwa`, su commit `5ee4234` più le modifiche non committate già presenti (rifiniture UI, e2e, screenshot), che sono state mantenute.

## 1. Audit iniziale e classificazione

Il punto di partenza era già local-first: dominio puro, servizi applicativi con comandi versionati e idempotenti, IndexedDB (`idb`) con una transazione per comando e controllo di revisione fra schede, backup JSON verificato, PWA con aggiornamenti su conferma. Baseline: typecheck OK, 103/103 test Vitest.

Le lacune rispetto alla specifica erano funzionali, non infrastrutturali: una sola modalità (Hi-Score) registrata **turno per turno o per freccetta**; catalogo della «Nuova partita» con modalità inesistenti sul totem (701, 1001, Cricket, Around the Clock) disabilitate; formato rapido che rifiutava meno iscritti dei finalisti; nessuna decisione dell'organizzatore sulle parità, nessun ritiro né incontro annullato; correzioni su fasi confermate solo tramite riapertura amministrativa non esposta; classifiche dei gironi basate sui punteggi grezzi; statistiche per configurazione Hi-Score.

| Componente                                                     | Classificazione                   | Esito                                                                               |
| -------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/domain` (calendario, tabellone, spareggi, stati)     | Mantenere / adattare              | Esteso con giochi, risultati, ritiri, decisioni                                     |
| `packages/application` `Backend`, porte                        | Mantenere / adattare              | Nuovi comandi, statistiche per gioco, interfacce repository                         |
| `packages/local-store` (MemoryStore, IndexedDB, backup)        | Mantenere / adattare              | Schema v2 con migrazione, import di backup v1                                       |
| `idb` (invece di Dexie), TanStack Query (invece di Zustand)    | Mantenere                         | Motivazione in [architettura](../standalone/ARCHITECTURE.md#perché-idb-e-non-dexie) |
| Design system CSS (invece di Tailwind)                         | Mantenere                         | Solo aggiunte con i token esistenti                                                 |
| PWA (vite-plugin-pwa, Workbox, prompt)                         | Mantenere                         | Invariata, verificata offline                                                       |
| Motore a turni (`RecordScore`, `CompleteTurn`, schermata Live) | Adattare → da eliminare in futuro | Solo per tornei creati prima; nessun torneo nuovo lo usa                            |
| Catalogo fittizio della Nuova partita, opzione «Squadre»       | Sostituire                        | Otto giochi del totem, tutti avviabili                                              |
| Modalità condivisa (Fastify + SQLite, `HttpAdapter`)           | Da eliminare (da confermare)      | Mantenuta compilante e testata: migrazione 0002, lettura dei dati vecchi            |
| Giochi, risultati finali, formato partita singola              | Implementare                      | Fatto                                                                               |

Nessuna dipendenza nuova. Nessuna chiamata remota nella build standalone (verificato in e2e: zero richieste `/api`).

## 2. Architettura

```text
React (features/*)  ── services/rules.ts → regole del dominio (catalogo, dipendenze)
  └─ GameAdapter: LocalGameAdapter (standalone, predefinito) | HttpAdapter (shared)
       └─ LocalEngine: coda seriale → Backend (comandi) → MemoryStore (overlay)
            └─ LocalDatabase: un commit IndexedDB strict per comando, CAS fra schede
Dominio puro: games/catalog · tournaments/engine · tournaments/results · standings · upgrade
```

Il motore dei tornei non conosce né la UI né IndexedDB: dipende solo dalla porta `Store`, ora scomposta in `PlayerRepository`, `TournamentRepository`, `MatchRepository` (`packages/application/src/ports.ts`). Una futura sincronizzazione sostituisce o estende quell'implementazione. `BackupService` corrisponde a `exportBackup / readBackup / importBackup` del `LocalGameAdapter`.

## 3. Schema dati (IndexedDB v2)

Store: `meta`, `players`, `events`, `tournaments` (aggregato), `audit`, `outbox`, `commands`. Indici: `audit.tournamentId`, `outbox.tournamentId`, `commands.createdAt`.

```ts
type GameMode = '301' | '301_DOUBLE_IN_OUT' | '501' | 'HI_SCORE' | '301_MASTERS' | 'EXACTA' | 'ODD_EVEN' | 'SHANGHAI';
type TournamentFormat = 'QUICK_HIGH_SCORE' | 'GROUPS' | 'SINGLE_MATCH';   // campo `mode`
type TournamentStatus = 'draft' | 'registration' | 'ready' | 'active' | 'paused' | 'completed' | 'cancelled';

Player      { id, displayName, nickname|null, avatar|null, status: 'active'|'inactive', createdAt, updatedAt }
Tournament  { id, eventId|null, name, mode, gameMode, recording: 'result'|'turns', scoringConfiguration,
              tournamentConfiguration, status, currentPhase, createdAt, startedAt, completedAt, version,
              entries[], stages[], groups[], matches[], results[] }
TournamentConfiguration { qualifiers, groupCount, qualifiersPerGroup, winPoints, drawPoints, lossPoints,
              allowDraws, groupRanking: 'POINTS_SCORE'|'POINTS_WINS'|null, playingOrder, groupAssignments,
              tiePolicy, tieBreakTurns, finalScoring }            // ultimi tre: solo dati a turni
TournamentEntry (partecipante) { id, tournamentId, playerId, displayNameAtRegistration, seed,
              status: 'registered'|'qualified'|'eliminated'|'winner'|'withdrawn', registeredAt }
Stage       { id, kind: 'qualification'|'group'|'semifinal'|'elimination_N'|'final', ordering,
              status: 'open'|'finalized'|'invalidated', qualifiedEntryIds, excludedEntryIds, … }
Group       { id, stageId, name, ordering, status, entryIds }
Match       { id, stageId, groupId, matchType: 'qualification'|'group'|'knockout'|'final'|'tiebreak',
              status, sequence (ordine al bersaglio), scheduleRound, participants[], winnerEntryId,
              tieTarget, version, result: MatchResult|null, turns[], scores[] /* solo dati a turni */ }
MatchResult { scores: Record<entryId, number|null>, declaredWinnerEntryId, targetScore, special: 'SHANGHAI'|null,
              walkover, decision: { order, reason }|null, notes, recordedAt, updatedAt, recordedBy }
TournamentResult (piazzamenti) { tournamentEntryId, finalPlacement, points, statistics }
meta        { deviceId, revision, lastCommitAt, lastBackupAt, changesSinceBackup, lastImport }
```

Scelte: `MatchResult` dentro `Match` (1:1, stessa transazione); classifiche e statistiche sempre derivate; UUID per ogni entità; date ISO 8601 UTC; criteri di ordinamento in `Standing.criteria`. Versione schema: `SCHEMA_VERSION = migrations.length = 2`.

## 4. Servizi

| Comando / funzione                     | Effetto                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `RecordResult` (`/matches/:id/result`) | Registra o corregge il risultato; Hi-Score anche un giocatore alla volta; completa l'incontro quando completo                             |
| `resultDependencies` (dominio)         | Fase da riaprire, fasi/incontri successivi, spareggi, risultato ufficiale che una correzione invaliderebbe                                |
| `DecideTie` (`tiebreaks/decide`)       | Ordine esplicito dei pari con motivo, registrato come spareggio deciso                                                                    |
| `WithdrawEntry` (`entries/withdraw`)   | Ritiro: vittorie a tavolino negli incontri a due, esclusione in qualifica/finale                                                          |
| `CancelMatch` (`/matches/:id/cancel`)  | Incontro dei gironi o spareggio non giocato                                                                                               |
| `UnregisterPlayer` (`entries/remove`)  | Toglie un iscritto prima dell'avvio                                                                                                       |
| `statistics(playerId)`                 | Tornei giocati/vinti, partite, V/N/P, % vittorie, per gioco (Hi-Score per round), record e media Hi-Score, piazzamenti, ultime 20 partite |
| `upgradeTournament`, `upgradePlayer`   | Porta i dati v1 al modello attuale (migrazione IndexedDB, backup v1, letture SQLite)                                                      |

I comandi esistenti (avvio, conferma qualifica, generazione finale/tabellone, avanzamento, conclusione, pausa, annullamento) sono invariati e valgono per ogni gioco. Regole dettagliate: [giochi e risultati](../scoring-rules.md), [formati](../tournament-modes.md).

## 5. Stato delle fasi

| Fase                      | Stato               | Note                                                                                                |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| A — Audit e progettazione | Completa            | Sezione 1                                                                                           |
| B — Persistenza           | Completa            | Schema v2, migrazione, integrità dei risultati, SQLite 0002                                         |
| C — Domain engine         | Completa            | Giochi, risultati, formati, parità, ritiri, correzioni, statistiche                                 |
| D — Integrazione UI       | Completa            | Nuova partita, Nuovo torneo, Registra risultato, Hi-Score Nights, Gironi, Giocatori, Home, Archivio |
| E — Backup e PWA          | Completa            | Nome file `bt-darts-backup-YYYY-MM-DD.json`, import v1; PWA invariata e riverificata offline        |
| F — Validazione           | Completa con limiti | Vedi 6–8; nessuna verifica su telefono fisico in questa sessione                                    |

## 6. Test

- `npm run check`: TypeScript strict (root e web), **122/122 test Vitest** (10 file), build server, build web standalone e shared — tutto superato.
- Nuovi: `tests/results.test.ts` (14: catalogo e validazione per gioco, formato rapido con 8 giocatori, parità al 4° con decisione e con spareggio, finale diretta con 3, ritiro in qualifica, gironi 501 con numero dispari e tabellone, classifica Hi-Score per differenza, walkover e incontro annullato, correzioni libere e con dipendenze, idempotenza e doppio tocco, partita singola e statistiche per gioco); `tests/local-first.test.ts` (4: risultati dopo riavvio, transazione fallita senza tracce, migrazione v1→v2 su IndexedDB, import di un backup v1); SQLite 0001→0002 in `tests/persistence.test.ts`.
- I test esistenti a turni girano con `recording: 'turns'` e passano invariati: copertura dei dati preesistenti.
- **Playwright 11/11** (Chromium 1243): partita singola di Odd & Even, Exacta, Shanghai; Hi-Score Night con 8 giocatori, ricarica a metà, parità decisa, finale, riapertura; gironi 501 con correzione che chiede conferma; serata e giocatori con avatar; backup su nuovo dispositivo; doppio tocco; avvio, registrazione e navigazione offline; aggiornamento in attesa durante l'inserimento; modalità shared con schermata a turni per un torneo vecchio.
- `pnpm seed` e `pnpm smoke` aggiornati e funzionanti.

## 7. Build

`vite build` standalone: precache 28 file (1,19 MB); gzip: React 66 kB, app 49 kB, motore 27 kB, Zod 27 kB, CSS 13 kB. L'app è cresciuta di circa 11 kB gzip per la nuova schermata risultati.

## 8. Limitazioni note

- **Regole del totem da confermare**: Odd & Even a esattamente 2 giocatori (Dispari = primo nell'ordine); limite 2–4 giocatori per partita; massimo Hi-Score 7 × 180, Exacta 5 × 180, Shanghai 252. Sono nel catalogo (`games/catalog.ts`), modificabili in un punto.
- Tutto l'archivio è caricato in memoria all'avvio (aggregati compatti, senza turni per i nuovi tornei): adeguato a centinaia di tornei, non a decine di migliaia.
- Gli avatar sono colori preset, senza immagini (nessun file nel database né nel backup).
- Ritiro supportato solo per tornei a risultati; quelli a turni mantengono la chiusura anticipata della qualifica.
- Nessuna verifica su dispositivi fisici in questa sessione: resta la [checklist smartphone](../standalone/MOBILE_CHECKLIST.md). Persistenza dello storage chiesta al browser ma non garantibile; il backup resta la protezione principale.
- Le specifiche e2e e gli screenshot in `docs/frontend/screenshots` erano modifiche in corso: le specifiche sono state riscritte per i risultati finali, gli screenshot rigenerati dal test shared.

## 9. Decisioni da confermare

1. **Rimuovere la modalità condivisa** (Fastify, SQLite, `HttpAdapter`: circa 2.150 righe compresi i test): la specifica esclude backend persistenti. È stata mantenuta funzionante per non eliminare codice senza conferma.
2. **Rimuovere il motore a turni** dopo la conclusione dei tornei esistenti (o convertendoli): oggi serve solo ai dati creati prima.
3. Regole del totem del punto 8 (Odd & Even, giocatori per partita).
4. Ritiro nei gironi: oggi gli incontri non giocati vanno a tavolino all'avversario. Alternativa: annullarli tutti come se il giocatore non fosse mai stato iscritto.
5. Formato rapido con esattamente 4 iscritti: oggi si gioca qualifica e poi finale fra gli stessi 4 («meno di quattro» → finale diretta). Si può estendere a «4 o meno».

## 10. Esecuzione e deploy

```sh
pnpm install --frozen-lockfile
pnpm dev:web                       # http://127.0.0.1:5173, standalone, service worker disattivato
pnpm check                         # typecheck, Vitest, build
pnpm --filter @bt/web build && pnpm --filter @bt/web preview   # build PWA reale
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… pnpm test:e2e
```

Vercel: nessun cambiamento a `vercel.json` (build `apps/web`, output `apps/web/dist`, fallback SPA, `sw.js` senza cache, bundle immutabili). Root Directory = radice del repository, Node 22.x/24.x, nessuna variabile d'ambiente, nessun dato sui server Vercel. Procedura: [VERCEL.md](../standalone/VERCEL.md). Dopo il deploy, i telefoni con una versione precedente vedono «Nuova versione disponibile» fuori dalle schermate di inserimento; all'aggiornamento la migrazione v2 converte l'archivio locale in una transazione. Consigliato esportare un backup prima di aggiornare.
