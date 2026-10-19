# Verifica visuale e funzionale — 18 ottobre 2026

Reference: cinque schermate Bite the Trouble consegnate nell'handoff. Implementazione verificata con screenshot Chromium a 390×844, DPR 2. I file `-full.png` documentano anche il contenuto scorrevole; la bottom nav rimane ancorata al viewport, quindi nei full-page compare all'altezza del viewport originale.

| Schermata        | Screenshot                                                                                        | Confronto e differenze                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home             | [390×844](screenshots/01-home.png) · [completa](screenshots/01-home-full.png)                     | Hero, logo e footer provvisori dall'handoff, gerarchia fucsia/scuro, font originali. Icone generiche Lucide e freccette SVG; nessuna cornice telefono/status bar fittizia.                                  |
| Nuova partita    | [390×844](screenshots/02-nuova-partita.png) · [completa](screenshots/02-nuova-partita-full.png)   | Griglia e selezione neon conservate. Hi-Score disponibile; altre modalità attenuate. Form reale più lungo della reference: selezione/ordine giocatori e impostazioni reali, scroll intenzionale.            |
| Live             | [390×844](screenshots/03-partita-live.png)                                                        | Punteggio Anton su carta, turno evidenziato, tasti e colpi rapidi. Contenuto entro 844 px senza scroll in verticale. Totali Hi-Score, non residui 301. Statistiche reali; nessun dato doppio-out inventato. |
| Torneo           | [390×844](screenshots/04-torneo.png) · [completa](screenshots/04-torneo-full.png)                 | Configurazione reale con partecipanti, gironi e qualificati. Schermata scorrevole, CTA raggiungibile sopra la nav quando portata in vista.                                                                  |
| Hi-Score Nights  | [390×844](screenshots/05-hiscore-nights.png) · [completa](screenshots/05-hiscore-nights-full.png) | Classifica da API, badge posizione, ordine ufficiale. I dati della prova hanno due partecipanti; nessuna lista demo fissa di dodici nomi. Finale unica coerente con il backend.                             |
| Live orizzontale | [844×390](screenshots/06-live-landscape.png) · [completa](screenshots/06-live-landscape-full.png) | Colonne affiancate, tastierino raggiungibile, nessun overflow orizzontale.                                                                                                                                  |

## Verifiche

- Typecheck strict backend e frontend e build produzione.
- Suite Vitest: **79 test superati**, su dominio, API, persistenza e adapter frontend.
- Suite Playwright: **3 flussi superati** (Hi-Score, gironi/eliminazione, spareggio), con creazione giocatori, avvio, tastiera/C/cestino/limite input, scoring, reload, undo, qualifica, finale ufficiale, gironi e semifinale/finale, spareggio reale.
- Controllo overflow su Home, setup partita, setup torneo e giocatori a 360, 430 e 1024 px.
- API ancora protette senza bearer; i file di configurazione non sono esposti dalla route asset.
- Screenshot esaminati rispetto a palette, font, gerarchie e proporzioni delle reference. Non è un confronto pixel-perfect automatizzato.

## Residui visuali e di verifica

- Hero e footer sono ritagli raster provvisori; possono contenere tracce dei controlli del mockup. Servono asset brand separati ad alta risoluzione.
- Gli splash SVG e i bordi della carta sono sostituti semplici; non riproducono ancora la grana organica delle reference.
- Avatar con iniziali. L'API non gestisce avatarUrl.
- Home e form scorrono; la reference illustrata ha proporzioni più alte del viewport reale. Il vincolo senza scroll è verificato soltanto per la partita live nel viewport indicato.
- Non eseguiti: axe, Lighthouse, Safari/iOS e dispositivi fisici. Font, layout e safe-area sono predisposti, ma non si dichiara una verifica su quei dispositivi.
