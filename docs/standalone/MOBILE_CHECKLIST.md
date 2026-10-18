# Checklist su smartphone

Verifiche automatiche già superate in Chromium desktop con viewport telefono (390×844 e orizzontale): flussi completi Quick e gironi, refresh, riapertura, offline, deep link, aggiornamento, backup e import, doppio tocco. Quanto segue **non è stato verificato su dispositivi fisici** e va eseguito sul telefono che userà il locale, dopo il deploy HTTPS.

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

## Dati

- [ ] Impostazioni: «Archiviazione persistente» (Chrome installato di solito «Attiva»; Safari può restare «Non garantita»).
- [ ] Esporta backup → il file si salva o si condivide (WhatsApp, Drive, File).
- [ ] Importa lo stesso file su un secondo telefono: dati e partita in corso identici.
- [ ] Dopo un torneo concluso la Home suggerisce il backup; dopo l'export il suggerimento sparisce.

## Aggiornamenti

- [ ] Pubblicare una nuova versione durante una partita: nessun reload e nessun avviso in partita; l'avviso compare in Home o in classifica e «Aggiorna» mantiene i dati.

## Noti da tenere presenti

- iOS può cancellare i dati di un sito non installato dopo un lungo periodo di inutilizzo: installare l'app sulla schermata Home ed esportare backup regolari.
- In navigazione privata l'archivio può mancare (l'app lo segnala con un avviso) oppure essere temporaneo e sparire alla chiusura senza avviso: non usare la navigazione privata per le serate.
- Cancellare i dati del sito dal browser elimina l'archivio, che si recupera solo da backup.
