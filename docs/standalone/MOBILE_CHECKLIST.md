# Checklist su smartphone

Verifiche automatiche già superate in Chromium desktop con viewport telefono (390×844 e orizzontale): flussi completi Quick e gironi, refresh, riapertura, offline, deep link, aggiornamento, backup e import, doppio tocco. Dalla V1.2 anche: 19 giocatori su 5 manche con reload e inserimento tardivo, squadre disomogenee con rotazione, round per round con riconciliazione, trasferimento di un torneo in corso, layout a 320×568, 360×800, 390×844, 430×932, 768×1024 e 844×390, barra nascosta con la tastiera su touch emulato. Sono emulazioni Chromium: quanto segue **non è stato verificato su dispositivi fisici** e va eseguito sul telefono che userà il locale, dopo il deploy HTTPS. La procedura completa di una serata di prova è nel [report V1.2](../release/V1_2_OPERATIONAL_READINESS.md#checklist-di-accettazione-manuale).

## Installazione

- [ ] Android, Chrome: «Installa app» compare; l'icona BT Darts appare nel launcher, ritagliata correttamente (icona maskable).
- [ ] iPhone, Safari: Condividi → «Aggiungi a Home»; icona, nome «BT Darts», avvio a schermo intero.
- [ ] Barra di stato e notch: header e tastierino non finiscono sotto le aree di sistema (safe-area), in verticale e in orizzontale.

## Offline

- [ ] Prima apertura online, poi Impostazioni → App: «Uso senza connessione: Pronta».
- [ ] Modalità aereo, chiusura completa dell'app, riapertura dall'icona: Home visibile.
- [ ] Offline: nuova partita, punteggi, refresh, riapertura; il turno corretto è conservato.

## Serata reale (un solo telefono)

- [ ] Inserire 8–16 giocatori di fila dalla tastiera del telefono (nome, Invio, nome…).
- [ ] Quick High Score completo: qualifica, spareggio, finale, conferma risultato, podio.
- [ ] Torneo a gironi completo.
- [ ] Tastierino con una mano: tasti leggibili, conferma senza ritardi percepibili, nessun doppio inserimento con tocchi rapidi.
- [ ] Rotazione del telefono durante la partita.
- [ ] Bloccare lo schermo per 10 minuti a metà partita, poi sbloccare: stesso giocatore al tiro.
- [ ] Chiudere il browser dal multitasking a metà turno: alla riapertura «Riprendi partita» mostra giocatore, turno e ultimo punteggio.

## Manche, squadre e round (V1.2)

- [ ] Hi-Score con più iscritti dei posti (es. 9): finita una manche compare «MANCHE N COMPLETATA», il tastierino è spento finché non si avvia la successiva o si tocca un giocatore da correggere.
- [ ] «Completa manche» con un risultato mancante: il dialog elenca chi manca; il valore si inserisce dopo toccando la manche.
- [ ] Squadre: la rotazione «Tira X · poi Y» avanza con il round, non avanza correggendo un round; due tocchi rapidi su «prossimo tiratore» lo spostano una volta sola.
- [ ] Digitare un totale per un giocatore scelto a mano, bloccare il telefono o ricaricare: le cifre ricompaiono sotto lo stesso giocatore.

## Tastiera virtuale e barra

- [ ] Android e iPhone: aprendo un campo di testo (nuovo giocatore, motivo) la barra flottante sparisce, e torna chiudendo la tastiera; nessun salto della pagina.
- [ ] Contenuti chiari o colorati sotto la barra (Home, immagini): etichette leggibili; con «Riduci trasparenza» (iOS) la barra resta opaca e leggibile.
- [ ] Zoom del testo di sistema al massimo: etichette della barra e tasti del tastierino ancora leggibili.

## Dati

- [ ] Impostazioni: «Archiviazione persistente» (Chrome installato di solito «Attiva»; Safari può restare «Non garantita»).
- [ ] Esporta backup → il file si salva o si condivide (WhatsApp, Drive, File).
- [ ] Importa lo stesso file su un secondo telefono: dati e partita in corso identici.
- [ ] Dopo un torneo concluso la Home suggerisce il backup; dopo l'export il suggerimento sparisce.

## Aggiornamenti

- [ ] Pubblicare una nuova versione durante una partita: nessun reload e nessun avviso in partita; l'avviso compare in Home o in classifica e «Aggiorna» mantiene i dati.
- [ ] Con l'anteprima di un backup aperta in Impostazioni l'avviso non compare e «Aggiorna ora» è disabilitato; chiusa l'anteprima torna disponibile.
- [ ] Chiudere completamente l'app installata con un aggiornamento in attesa e riaprirla: nuova versione attiva, partita in corso intatta.

## Noti da tenere presenti

- iOS può cancellare i dati di un sito non installato dopo un lungo periodo di inutilizzo: installare l'app sulla schermata Home ed esportare backup regolari.
- In navigazione privata l'archivio può mancare (l'app lo segnala con un avviso) oppure essere temporaneo e sparire alla chiusura senza avviso: non usare la navigazione privata per le serate.
- Cancellare i dati del sito dal browser elimina l'archivio, che si recupera solo da backup.
