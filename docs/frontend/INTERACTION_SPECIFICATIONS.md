# Interazioni implementate

- Cifre: massimo dato dalla configurazione backend (180 nei nuovi incontri); il superamento mantiene l'input precedente e mostra un messaggio.
- Colpi rapidi: sostituzione dell'input, senza invio automatico.
- C / Backspace: elimina una cifra. Cestino: svuota input. Enter / conferma verde: invio del turno.
- Undo / Ctrl+Z: dialog di conferma, poi VoidScore con versioni correnti. Il backend riapre il turno; le fasi finalizzate possono rifiutare l'operazione.
- Punteggi: nessun aggiornamento ottimistico. Input mantenuto su errore, recupero esplicito su risposta incerta, tastierino disabilitato durante la richiesta.
- Input persistito associato al turnId: un aggiornamento di un altro dispositivo non trasferisce una bozza al giocatore successivo.
- Giocatori: rimozione dalla selezione, pulsante per anticipare nell'ordine, aggiunta e creazione in dialog. Backend convalida il nome; limite reale di 120 caratteri.
- Modali: dialog nativo con focus confinato, Escape e ripristino del focus. Durante l'avvio del torneo la chiusura è impedita.
- Tabs: stato nella query string, frecce/Home/End per navigazione da tastiera.
- Riduzione movimento tramite prefers-reduced-motion; focus visibile, output aria-live e messaggi di errore role=alert.
- Input a totale turno: non vengono mostrati dardi individuali inventati.
