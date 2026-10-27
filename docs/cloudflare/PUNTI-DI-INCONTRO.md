# Punti di incontro, segnapunti e live dei partecipanti

Questo documento descrive ciò che il codice fa **oggi** (branch `feat/play-spaces`, derivato da `feat/cloudflare-accounts` al commit `003f5c2`). Non descrive funzioni future. L'app resta un companion: nessuna connessione al totem, nessuna acquisizione automatica dei tiri; il risultato ufficiale è quello mostrato dal totem e registrato dal segnapunti.

## Guida breve

| Voglio…                 | Come                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Giocare al BT           | **Nuova partita** (o **Nuovo torneo**) → «State giocando al Bite the Trouble?» → **Sì, siamo al BT**. Il punto canonico ha un id fisso e una scoreboard sua.                                                                                          |
| Giocare altrove         | Stessa domanda → **No, giochiamo altrove** → scegli un punto disponibile o **Crea punto di incontro** (nome obbligatorio; luogo e descrizione del bersaglio facoltativi, niente coordinate). Il punto nuovo viene creato solo alla conferma finale.   |
| Condividere un punto    | **Punti di incontro → [punto] → Condividi punto di incontro**: link e QR d'invito. Chi lo accetta (dopo l'accesso) entra nello stesso punto, con la stessa scoreboard. L'invito si può revocare e scade dopo 30 giorni.                               |
| Far seguire una partita | Dalla partita, come segnapunti: **Fai seguire** (link e QR `/segui/<id>`). Si apre solo quella partita, in sola lettura, per chi ha un account collegato a un giocatore della partita (o è membro del punto). Non iscrive al punto e non dà permessi. |
| Passare il segnapunti   | Dalla partita: **Passa il segnapunti** → scegli un account collegato a un giocatore della partita. Il tuo permesso termina nello stesso momento.                                                                                                      |
| Usare un altro telefono | Il secondo telefono mostra «Questa partita è segnata su un altro tuo dispositivo» e **Segna da qui**: da quel momento il primo è rifiutato.                                                                                                           |

## Modello

- `PlaySpace`: id stabile, nome, luogo e bersaglio facoltativi, autore, `canonical`, versione. Il **BT** ha id fisso `00000000-0000-4000-8000-00000000b7d1`, esiste sempre (non è salvato: è implicito, quindi la «creazione» è idempotente) e **non si riconosce dal nome**. Un punto chiamato «BT» o «Bite the Trouble» è un punto diverso. Un backup che prova a definire il punto canonico viene rifiutato.
- Ogni torneo (anche `SINGLE_MATCH`) ha `playSpaceId`; gli incontri lo ereditano dal torneo. `null` solo per i dati precedenti: **non classificati**.
- Giocatori e account restano globali. Le comitive possono avere `playSpaceIds` e un `favoritePlaySpaceId` (solo un default).
- Spostare un torneo (`moveTournament`) è un comando esplicito: richiede `confirm: true`, controlla la versione, scrive l'audit `TournamentMoved` ed è un'unica scrittura; le scoreboard sono derivate, quindi il vecchio e il nuovo punto si ricalcolano insieme, senza doppi conteggi.

## Scoreboard, record e XP

- `computeProgression` riceve solo i tornei di un punto (`inPlaySpace`). Statistiche, migliori personali, record, titoli e badge di un punto non vedono altro. Le **carte** (livelli da altri telefoni) non hanno un punto e non entrano mai nelle scoreboard dei punti.
- La vista personale (`progression()` senza punto) conta gli **XP generali** su tutto ciò che il dispositivo conosce, ma **non assegna record**: nessuna classifica globale competitiva. Il profilo del giocatore ha il filtro «Statistiche e record nel punto» e lo storico personale complessivo, etichettato.
- Le comitive mostrano i record nel contesto di un punto scelto.
- Query key del client: `['progression', playSpaceId]`, `['crew-progression', id, playSpaceId]`.
- Rimane com'era: comparabilità per gioco, numero di round e singolo/squadra (`entryPerformance`).

### Politica XP (contributi)

- Ogni XP è un **contributo identificabile**: `regola|partita-o-torneo|giocatore` (partecipazione, vittoria, record personale, torneo completato, torneo vinto), con data.
- Una carta nuova trasporta i contributi. Lo stesso contributo incontrato due volte conta una volta (doppia importazione, storie sovrapposte). Un contributo di una partita che il dispositivo **conosce** (anche rimossa) è sostituito dai dati locali: una correzione o un annullamento ritira quello vecchio. Storie disgiunte si **sommano**.
- Una carta **legacy** (solo un totale) non ha provenienza: si conserva così com'è (`legacyXp`), non riconciliata. Regola: il legacy vale `max(totale legacy, XP locali fino alla data della carta)`, più tutto ciò che il dispositivo deriva **dopo** quella data. Il caso «100 XP e una partita indipendente da 22» dà 122 se la partita è successiva alla carta; non si aumenta né si riduce nulla in silenzio, e nessuna partita viene inventata.
- Regole e pesi degli XP non sono cambiati.

## Migrazioni e backup

- IndexedDB schema 6: crea gli store `playSpaces` e `variants` e riporta ogni torneo a `playSpaceId: null` (idempotente, nello stesso `versionchange`, niente viene cancellato). SQLite del Durable Object: gli stessi record come righe di `engine_records`; le tabelle nuove (`space_members`, `space_invites`, `match_access`, `access_audit`, `rpc_commands`) si creano con `IF NOT EXISTS`.
- **Dati precedenti**: restano nello storico e sono esclusi da ogni scoreboard dei punti finché non li assegni. **Punti di incontro → Partite da assegnare**: elenco, selezione multipla, scelta del punto, conferma esplicita, una sola scrittura (audit per ogni torneo). Non si assume che siano tutte del BT.
- Backup vecchi (senza `playSpaceId`): vengono letti con i tornei «non classificati». L'importazione non crea punti BT. Gli id dei punti si conservano; nessuna unione per nome. Riferimenti a punti sconosciuti, alias che formano cicli e punti «canonici» definiti dal file sono rifiutati.
- Un backup **non** assegna permessi: membership, inviti e segnapunti vivono in tabelle del server che un ripristino non tocca (nemmeno le tabelle degli account). Un file che unisce due giocatori con un account è rifiutato (`BOTH_HAVE_ACCOUNT`).

## Integrità dei dati

- **Tornei divergenti**: ogni versione ha un'impronta (`lineage`). Una copia ne continua un'altra solo se le sue impronte ne sono il prefisso. Una versione maggiore **non** prova discendenza. Senza prova, o con storie diverse, si ha un **conflitto**: la copia locale resta, l'altra è conservata come _variante_, esclusa da ogni scoreboard, e l'anteprima di unione la segnala. La risoluzione è esplicita (`resolveVariant`: tieni la locale, oppure usa la variante; la copia sostituita diventa a sua volta una variante, così un'interruzione non perde nulla). I tornei esistenti prima di questa versione non hanno impronte: unire due loro copie diverse è trattato come conflitto, per prudenza.
- **Membri rimossi**: la comitiva registra operazioni datate (`joinedAt`, `removedMembers`). Vince l'operazione più recente; a parità vince la rimozione. Importare una copia vecchia non riporta indietro un membro rimosso; un rientro successivo vince su una vecchia rimozione. La rimozione non cancella il giocatore né il suo storico.
- **Merge «invariato»**: `unchanged` tiene conto di audit, eventi, comandi, punti, varianti e alias, non solo dei dati di prodotto.
- **Alias**: un collegamento che chiude un ciclo o contraddice uno già presente non viene applicato e viene contato (`linksRejected`).

## Permessi (matrice effettiva)

Tutto è deciso sul server, su tabelle sue, mai sugli oggetti o sugli `accountId` inviati dal client.

| Azione                                                                                                  | Admin/owner                                  | Membro del punto            | Partecipante (account collegato) | Segnapunti                                         |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------- | -------------------------------- | -------------------------------------------------- |
| Leggere il BT                                                                                           | sì                                           | sì (ogni account abilitato) | sì                               | sì                                                 |
| Leggere un punto privato e le sue partite                                                               | sì                                           | sì                          | solo le partite a cui partecipa  | sì                                                 |
| Creare un punto                                                                                         | sì                                           | sì (ogni account)           | sì                               | sì                                                 |
| Creare un invito al punto / revocarlo                                                                   | sì                                           | sì (non per il BT)          | no                               | —                                                  |
| Creare una partita in un punto                                                                          | sì                                           | sì                          | solo se membro                   | diventa segnapunti                                 |
| Inserire turni/risultati, correggere, annullare, avanzare, pausa, concludere, struttura, spostare punto | **no**                                       | **no**                      | **no**                           | **sì**, solo dalla sessione che detiene la partita |
| Trasferire il segnapunti                                                                                | no                                           | no                          | no                               | sì (a un account abilitato che vede la partita)    |
| Recupero amministrativo (partita senza segnapunti)                                                      | sì, esplicito e tracciato (`ADMIN_RECOVERY`) | no                          | no                               | —                                                  |
| Assegnare i dati precedenti a un punto                                                                  | sì                                           | no                          | no                               | no                                                 |
| Backup, ripristino, unione, rimozione tornei, utenti                                                    | sì                                           | no                          | no                               | no                                                 |
| Creare un giocatore ospite                                                                              | sì                                           | sì                          | sì                               | sì                                                 |

Una partita senza record di accesso (creata prima di questa versione) è **non assegnata**: nessuno la modifica finché un admin non assume il segnapunti dalla vista della partita («Assumi il segnapunti», con conferma e traccia).

Il segnapunti è legato a una **sessione** (un dispositivo) e a un'**epoca** che cresce a ogni trasferimento o cambio di dispositivo: una sessione precedente riceve `SCORER_ELSEWHERE`. Dopo un trasferimento il nuovo segnapunti lega la sua sessione con la prima scrittura.

## Live

- `GET /api/live/<tournamentId>` con `Upgrade: websocket`. Prima dell'upgrade: sessione valida, `Origin` uguale a quello della pagina (obbligatorio), id ben formato, accesso alla partita. Poi `ctx.acceptWebSocket` (**WebSocket Hibernation API**); id partita, account e hash della sessione stanno nell'allegato del socket, quindi sopravvivono all'ibernazione. `ping` ha una risposta automatica che non sveglia l'oggetto.
- Messaggio `state`: stato completo del torneo e della partita corrente, con `version` (la versione del torneo). Il client applica solo versioni più nuove: duplicati e fuori ordine sono innocui, un buco è riparato dall'aggiornamento successivo. `resync` richiede lo stato completo. Non c'è un buffer di replay: la riconnessione parte sempre da uno snapshot.
- Ordine: l'oggetto serializza richieste, messaggi e pubblicazioni. L'aggiornamento parte **dopo** il commit del comando.
- Dopo ogni scrittura, logout, disattivazione, cambio ruolo, collegamento o uscita da un punto, ogni socket aperto viene ricontrollato: sessione scaduta o account disattivato → chiusura `4401`; accesso perso → `4403`.
- Comandi: ogni scrittura porta un `commandId`; un tentativo ripetuto con lo stesso id restituisce l'esito memorizzato (48 ore) e non esegue nulla. Il client, in caso di rete assente, ritenta fino a 3 volte con lo stesso id e, se non riesce, segnala un esito incerto invece di mostrare il dato come salvato.
- Fallback: con il canale chiuso, un solo polling lento (5 s, solo se la pagina è visibile) e riconnessione con attesa crescente (anche su `online`).
- Vista partecipante: turno corrente, «Tocca a te» / «Sei il prossimo», ordine, tiratore della squadra se c'è una rotazione, round, punteggi, stato di connessione; nessun tastierino. Con la connessione interrotta la schermata dice «Stato fermo» e **non** mostra «Tocca a te». Con registrazione solo del risultato finale non si inventa nessun turno. La vibrazione è facoltativa (feature detection) e funziona solo con l'app aperta.

## Test

| Suite                                | Cosa verifica                                                                                                                                                                                                                                                         | Come si esegue      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `tests/play-spaces.test.ts`          | identità dei punti, isolamento scoreboard/record/titoli, spostamento, dati non classificati, XP (disgiunti, sovrapposti, legacy, doppia importazione), varianti, membri rimossi, alias, backup                                                                        | `pnpm test`         |
| `tests/access.test.ts`               | matrice dei permessi via API diretta, un solo segnapunti, due dispositivi, trasferimento, recupero admin, inviti, letture limitate, backup senza privilegi                                                                                                            | `pnpm test`         |
| `tests/follow.test.ts`               | «Tocca a te»/«Sei il prossimo», stato fermo, solo risultato finale, ordine degli aggiornamenti                                                                                                                                                                        | `pnpm test`         |
| `tests/workers/live.workers.test.ts` | **runtime Workers reale** (`wrangler dev`/workerd): upgrade rifiutato senza sessione/Origin/accesso, retry con lo stesso `commandId`, aggiornamento al partecipante senza reload (misurata la latenza), attesa di 12 s senza traffico, chiusura su logout e su revoca | `pnpm test:workers` |

Vedi la sezione «Esito dei test» della consegna per i risultati dell'ultima esecuzione.

## Limiti e cose non verificate

- **Serve la connessione** in cloud: senza rete l'app mostra l'ultimo stato ricevuto e lo dichiara fermo, ma non registra nulla. Una coda offline con sincronizzazione **non è implementata**: sarebbe un lavoro a parte (ordinamento dei comandi in coda, conflitti con il segnapunti, riconciliazione al ritorno della rete) e non va dichiarata come disponibile. La build standalone resta la via per serate senza connessione.
- **Nessuna notifica in background**: «Tocca a te» vale solo con l'app aperta; le push con app chiusa non sono previste.
- L'ibernazione è stata esercitata aspettando 12 s senza traffico su `wrangler dev`; non c'è una prova diretta che l'oggetto sia stato davvero espulso dalla memoria in quel test.
- Non è stata eseguita copertura WebKit/iOS né prova su telefoni reali (touch, tastiera, navbar su dispositivi veri): vanno fatte a mano.
- Il deployment Cloudflare **non è stato eseguito né verificato**: i test usano `wrangler dev` locale.
- Un guest senza account non può seguire la partita da solo: lo registra il segnapunti e partecipa senza vista personale. Per una vista personale serve l'invito esistente.
- Le carte non entrano nelle scoreboard dei punti: un record visto solo come migliore personale su un altro telefono non compare in uno spazio finché la partita non è nei dati.
- Le comitive restano un dato condiviso e modificabile dagli admin (come prima).
