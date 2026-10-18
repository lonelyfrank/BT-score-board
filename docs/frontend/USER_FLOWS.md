# Flussi implementati

1. **Accesso:** Home → Impostazioni → token organizzatore → verifica → Home. Senza token le operazioni protette mostrano un errore esplicito.
2. **Partita rapida:** Nuova partita → Hi-Score → aggiungi/crea giocatori → riordina → turni → riepilogo → avvio → punteggi → risultato dell'incontro → classifica torneo. La finale ufficiale si disputa separatamente.
3. **Hi-Score Nights:** crea torneo → qualifica → risultati → conferma qualifica → genera finale unica → gioca finale → conferma risultato ufficiale.
4. **Gironi:** nuovo torneo → A gironi → partecipanti/impostazioni → incontri → conferma qualifica → genera eliminazione diretta → avanzamento automatico del backend → finale → risultato ufficiale.
5. **Spareggio:** classifica con parità → seleziona target e intero gruppo pari → crea incontro → gioca → conferma di nuovo l'avanzamento. Il backend verifica validità e gruppo selezionato.
6. **Giocatori:** elenco con ricerca/paginazione → crea oppure modifica nome → statistiche server.
7. **Recupero:** reload della route live → lettura server → recupero eventuale comando incerto → prosecuzione. I totali non provengono dallo storage del browser.

Game Night è un avviso esplicito, non una simulazione. Le modalità non operative sono disabilitate nel catalogo.
