# Design system integrato

Fonte dei valori: `apps/web/src/styles/tokens.css`, importato dall'handoff. Fucsia #FF238B, sfondo #09090B, superfici scure, carta #ECE8E3, verde conferma #00B987. Bordo neon per selezione e turno attivo.

Oswald per titoli, Barlow Condensed per UI, Anton per punteggi, Permanent Marker per graffiti. Font latin recuperati dall'HTML consegnato e serviti localmente; licenze in `apps/web/public/assets/FONT-LICENSES.txt`. Nessuna richiesta font esterna.

Componenti comuni in `src/components`: header/nav, pulsanti, tab, avatar con iniziali, dialog, stepper, error/loading/empty, tastierino. Icone generiche Lucide, freccette SVG dedicate. Hero/footer restano asset provvisori dell'handoff. Splash SVG sostituibile con materiale definitivo del brand.

Il CSS usa layout adattivi e mantiene la gerarchia mobile. Nessuna status bar o cornice telefono fittizia. Effetti limitati a texture CSS, neon sulla selezione e press feedback; reduced-motion elimina transizioni.
