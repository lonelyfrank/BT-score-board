# BT Darts — V1.4 Mobile-first

Data: 21 ottobre 2026. Implementazione nella repository locale, branch `feat/v1.4-mobile-first` (da `main` a `9235de0`). Nessun deploy.

Fonte: canvas «BT Darts V1.4 · Mobile-first» (27 artboard 390 × 844, foglio `bt.css` con token 1:1 di `tokens.css`). Il principio del canvas guida tutto il lavoro: **una schermata, un'attività**. Ogni schermata ha un header fisso, una sola azione principale sopra la barra e il contenuto che scorre in mezzo.

Dominio, contratti, store locale e API sono invariati: è un lavoro di sola interfaccia. Unica eccezione lato server: la rotta client `/regole` aggiunta al fallback SPA (`apps/api/src/plugins/web.ts`).

## Cosa cambia

| Area              | Prima (V1.3.1)                                                       | V1.4                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipografia        | Font di sistema                                                      | **Oswald** (titoli, CTA) e **Barlow Condensed** (interfaccia), già in precache: si chiude la scelta del font rimasta aperta in V1.3                                                                                  |
| Fogli di stile    | `app.css` unico, 6.300 righe stratificate (V1, v2, V1.3, glass)      | `base.css` (vocabolario comune) + `home`, `setup`, `match`, `competitions`, `people`: ~4.600 righe, CSS di produzione 82 kB (prima: 6.300 righe)                                                                     |
| Home              | Quattro azioni, Game Night come card                                 | Strumenti in alto (Impostazioni · Regole del totem · Game Night), ripresa, tre azioni, avviso backup, ultimi due risultati                                                                                           |
| Nuova partita     | Un modulo lungo con opzioni avanzate e dialog «Pronti al bersaglio?» | **Due passi**: Gioco (griglia degli 8 giochi, registrazione) → Giocatori (ordine di tiro, posto libero, aggiunta rapida, squadre e manche)                                                                           |
| Nuovo torneo      | Un modulo lungo                                                      | **Wizard a 5 passi**: Formato · Giocatori · Manche/Gironi · Regole · Riepilogo, con «Modifica» per tornare a un passo. Bozza salvata in automatico sul dispositivo. Nuovo formato selezionabile qui: Partita singola |
| Live              | Scoreboard, tastierino con colpi rapidi, pausa «Round completato»    | Striscia round con pip, card «Al bersaglio» con ordine di tiro del round, freccette o carta del totale, undo + CTA «Conferma 80». Il round successivo parte subito                                                   |
| Fine manche       | Card «Manche completata»                                             | Schermata «Manche N chiusa!»: classifica della manche con posizione provvisoria, «Chiama al totem» per la manche seguente, «Rivedi M2»                                                                               |
| Matrice           | Tabella + pannello inline                                            | Tab manche, tabella `R1…R7/TOT`, avviso «turni da verificare»; ogni cella apre lo **sheet Correggi turno** (Freccette o Totale, Prima → Dopo, cronologia)                                                            |
| Organizza manche  | Dialog a slot                                                        | Sheet con manche bloccate in alto, righe ordinabili (↑ anticipa, ⇄ sposta), slot liberi visibili                                                                                                                     |
| Classifica        | Ordine / Provvisoria / Tutti i round                                 | Qualifica o Manche N, riepilogo Soglia finale · Giocati · In attesa, linea «FINALE · TOP 4»                                                                                                                          |
| Risultati         | Card punteggio + tastierino                                          | Righe con confronto companion/totem, carta e tastierino 3 × 4, podio con «Vince X!» e RISULTATO UFFICIALE                                                                                                            |
| Tornei / Hi-Score | Card evento                                                          | Gruppi «Al bersaglio / In corso / Iscrizioni aperte / Archivio», chip di stato; in Hi-Score la card «Stasera» con In testa · Soglia · Mancano                                                                        |
| Torneo a gironi   | Pulsanti in fondo alla panoramica                                    | Fasi in tre box, card VS «Al bersaglio», «Prossimi»; pausa, ritiro, riordino e annullamento nel menu «Altre azioni»                                                                                                  |
| Giocatori         | Riga + profilo lungo                                                 | Ricerca, filtro, scheda in sheet con colore avatar (salvato al tocco), Tornei · Vittorie · Miglior pos., ultime partite, per gioco, storico                                                                          |
| Impostazioni      | Pannelli                                                             | Backup in evidenza (Esporta / Ripristina), dati del dispositivo, server, app                                                                                                                                         |
| Regole del totem  | —                                                                    | **Nuova** (`/regole`): istruzioni del pannello Pub Time Darts, spie, bersaglio e regole degli 8 giochi; «Gioca a X» apre Nuova partita sul gioco                                                                     |

La barra di navigazione Liquid Glass resta quella di `9235de0` (il canvas la riporta come rendering statico di `NavigationSurface`). Cambiano solo l'icona di Partite (mirino, come nel canvas) e la marcatura di sezione: Regole, Game Night e Impostazioni evidenziano Home con `aria-current="location"`. La barra è nascosta nel wizard e nel passo 2 di Nuova partita.

## Scelte dove il canvas semplifica il dominio

- **Fine manche.** Il canvas va da «Conferma e chiudi manche» a «Inizia Manche 3». Il dominio però considera ufficiali solo i totali del totem: finché mancano, il pulsante principale è «Totali del totem →» (tab Risultati); quando ci sono diventa «Inizia Manche N».
- **Pausa tra i round.** La schermata «Round N completato» è stata tolta: l'ordine di tiro mostra «poi Round N» e il toast conferma il turno con «Annulla».
- **Nome della partita libera.** Il campo è sparito come nel canvas; il nome è automatico, «Hi-Score · 21 ott».
- **Distribuzione casuale nel wizard.** Il sorteggio resta nel dominio, all'avvio: l'anteprima mostra l'ordine di iscrizione e dopo l'avvio si apre Organizza manche per vederlo e cambiarlo. Anche «Manuale» parte dalla bilanciata e apre Organizza manche.
- **Dopo «Avvia torneo».** Hi-Score rapido e Partita singola aprono subito la partita, come nel canvas; i gironi aprono la Panoramica.
- **Elenco giocatori.** La colonna MEDIA del canvas non è stata implementata: richiederebbe le statistiche di ogni giocatore a ogni apertura della lista. La media resta nella scheda del giocatore.
- **Opzioni non disegnate ma conservate:** registrazione Flessibile (terza scelta accanto a Round per round e Solo finale), punti fatti/rimasti per X01, squadre, serata collegata, salvataggio come bozza, ritiro, chiusura anticipata, spareggi e decisioni, tabellone.
- **Palette avatar** più satura, come nel canvas; le chiavi dei preset salvati (`rosa`, `blu`, …) non cambiano.

## Verifiche

| Controllo                                                                   | Esito                               |
| --------------------------------------------------------------------------- | ----------------------------------- |
| `npm run check` (TypeScript strict, Vitest, build server/standalone/shared) | 19 file, **265/265** test; build ok |
| `npm run smoke`                                                             | HTTP smoke passato                  |
| `prettier --check .`                                                        | ok                                  |
| Playwright shared + standalone (9 file, 6 viewport nel test di layout)      | **31/31** in un’unica esecuzione    |

Gli E2E sono stati riscritti sui nuovi flussi senza togliere controlli: stesse serate, stessi casi limite (parità, correzioni che riaprono una fase, backup su un altro dispositivo, offline, aggiornamento PWA trattenuto, manche da un giocatore, squadre disomogenee). Gli helper nuovi sono `newTournament`, `nextStep` e `gameRadio` in `e2e/helpers.ts`.

Screenshot: `docs/release/screenshots-v1.4/` (Live, freccette, matrice, risultato, Organizza a 320 px). Gli screenshot V1.3/V1.3.1 restano com'erano; quelli di `docs/frontend/screenshots/` sono rigenerati dalla suite shared e ora mostrano la V1.4.

## Da verificare

- **Telefono reale** (checklist `docs/standalone/MOBILE_CHECKLIST.md`): safe area con la striscia del round, tastiera virtuale nel wizard e negli sheet, Safari iOS con la lente della barra, leggibilità di Barlow Condensed al bancone.
- **Palette avatar**: le iniziali bianche su `#0e8f8e` arrivano a 3,9:1 (su `#c4532a` a 4,5:1). Sono decorative (`aria-hidden`, il nome è sempre scritto accanto), ma vanno guardate dal vivo.
- Dati reali di una serata: altezza della card «Chiama al totem» con 4 giocatori dai nomi lunghi.
