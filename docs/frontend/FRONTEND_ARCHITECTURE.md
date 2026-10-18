# Architettura frontend

`apps/web` è un package del workspace pnpm: React 18, TypeScript strict, Vite, React Router, TanStack Query, Lucide. CSS nativo usa i token dell'handoff; non sono state introdotte dipendenze Tailwind, Zustand o React Hook Form senza necessità. I piccoli form usano stato React e validazioni di forma; l'API valida le regole.

- `src/components`: header, nav, dialog nativo, avatar, tab accessibili, stepper, tastierino e icone freccette.
- `src/features`: Home, Setup, Live, Tournaments, Players, Settings.
- `src/services/api.ts`: HttpAdapter, tipi derivati dai contratti reali, errori e registro dei comandi incerti.
- `src/styles`: token importati, font locali con licenze, layout ed effetti.
- `public/assets`: immagini temporanee dell'handoff, font incorporati nell'HTML originale, splash SVG sostituibile.
- `e2e`: browser su backend reale con database in memoria.

Route: `/`, `/partite/nuova`, `/partite/:gameId` (gameId corrisponde a matchId), `/tornei`, `/tornei/nuovo`, `/tornei/:id`, `/hiscore`, `/hiscore/:id`, `/giocatori`, `/impostazioni`. Tab in `?tab=`. Risultato dell'incontro nella route live, risultato ufficiale nel torneo.

Stato server in TanStack Query, polling a 5 secondi nelle viste live e torneo. Nessuna mutazione ottimistica dei punteggi. Stato di input e modali locale; sessionStorage contiene token di sessione, input associato al turno e comandi da recuperare. Accessi allo storage protetti da try/catch; senza storage resta disponibile la memoria della scheda, non il recupero dei comandi dopo reload.

Produzione: `pnpm build` compila API e frontend; Fastify serve `apps/web/dist` sulla stessa origine. Soltanto HTML e asset compilati sono pubblici. `/api/v1` conserva autenticazione e protezioni esistenti. Sviluppo: Vite inoltra `/api` a `127.0.0.1:3000`.
