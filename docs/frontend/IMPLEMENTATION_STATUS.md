# Stato integrazione frontend — 18 ottobre 2026

Ambito concordato: integrare prima le modalità già operative. Il frontend usa il backend reale; nessun risultato simulato e nessun motore X01 aggiunto.

| Schermata       | Implementato                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home            | Branding, quattro azioni, navigazione, avviso esplicito per Game Night                                                                                  |
| Nuova partita   | Hi-Score, selezione/creazione/riordino giocatori, turni, riepilogo, avvio reale; catalogo della reference con modalità non supportate disabilitate      |
| Partita live    | Totali e statistiche server, tastierino e tastiera, colpi rapidi, C/cestino, conferma, recupero invii, cronologia, annullamento con conferma, risultato |
| Torneo          | Creazione, iscrizione, avvio, gironi, calendario, classifiche, conferma qualifica, eliminazione diretta, finale, risultati                              |
| Hi-Score Nights | Qualifica, classifica, finale unica tra qualificati, spareggi con incontro reale, conferma risultati                                                    |
| Giocatori       | Ricerca, paginazione, creazione, modifica nome e statistiche ufficiali                                                                                  |
| Impostazioni    | Accesso organizzatore, verifica token, disconnessione                                                                                                   |

## Decisioni di integrazione

- Hi-Score accumula punti; non visualizza un residuo 301 fittizio.
- Quick High Score richiede almeno due giocatori; una partita rapida crea una qualifica con tutti i partecipanti ammessi alla finale. Il risultato dell'incontro non è automaticamente il risultato ufficiale del torneo.
- Il backend Quick prevede una finale unica, non semifinali 1-vs-4/2-vs-3. Il torneo a gironi supporta invece eliminazione diretta e semifinali.
- L'API non espone catalogo modalità: la griglia dichiara la sola capacità disponibile HIGH_SCORE. Le altre etichette restano riferimenti visivi non avviabili.
- Il backend restituisce `scoreboard` nella lettura della partita: media, totale, best e turni vengono calcolati nel dominio esistente.
- Le bozze di punteggio sono legate all'ID del turno. Una nuova scheda recupera lo stato server; il token deve essere inserito nella propria sessione.

## Limiti ancora presenti

- X01, Cricket, altre modalità, squadre, set/leg e double-out non implementati dal backend.
- Game Night, PWA/offline e display spettatore dedicato non implementati.
- Nessun endpoint di restart-leg: non viene esposto un reset fittizio. Annullamento reale tramite VoidScore; fasi finalizzate richiedono la procedura amministrativa di riapertura, non disponibile in questa UI.
- Nessun MockAdapter in produzione: i test usano API vere e SQLite in memoria; il seed esistente rimane disponibile per demo separate.
- Asset hero/footer ancora temporanei dal mockup. Logo e graffiti definitivi rimangono da fornire.
- Storybook, Lighthouse e audit axe non eseguiti.

Verificati: build produzione, TypeScript strict, 79 test Vitest e 3 flussi Playwright.

Verifiche e screenshot: [VISUAL_QA.md](VISUAL_QA.md). Avvio: [README](../../README.md).
