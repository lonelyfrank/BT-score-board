# Deploy su Vercel

La build standalone è un sito statico. Non servono processi server, SQLite o variabili d'ambiente segrete.

## Impostazioni del progetto

| Impostazione     | Valore                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Repository       | `lonelyfrank/BT-score-board`, branch di produzione a scelta (es. `main`)                      |
| Root Directory   | radice del repository (vuoto / `./`)                                                          |
| Framework Preset | Other: `vercel.json` imposta `"framework": null`                                              |
| Node.js Version  | 22.x o 24.x (pnpm 12 richiede Node ≥ 22.19)                                                   |
| Install Command  | da `vercel.json`: `npx --yes pnpm@12.14.0 install --frozen-lockfile --ignore-scripts`         |
| Build Command    | da `vercel.json`: `npm run build --prefix apps/web`                                           |
| Output Directory | da `vercel.json`: `apps/web/dist`                                                             |
| Env variables    | nessuna; `VERCEL_GIT_COMMIT_SHA` è fornita da Vercel e compare nella versione in Impostazioni |

Non serve duplicare questi valori nel pannello: `vercel.json` ha la precedenza.

`--ignore-scripts` evita di compilare `better-sqlite3`, che serve solo al backend; la build web non esegue script di installazione. La build esegue anche il typecheck di `apps/web`.

## Routing e cache

- `rewrites`: ogni percorso che non è un file reale serve `index.html`, quindi `/partite/<id>`, `/tornei/<id>` e `/hiscore/<id>` funzionano anche al primo accesso. Vercel serve sempre prima i file esistenti.
- `/static/*` contiene solo bundle con hash: `Cache-Control: public, max-age=31536000, immutable`.
- `/sw.js`: `no-cache`, così il browser scopre subito le nuove versioni. Gli altri file, inclusi `/assets` del brand senza hash, usano la cache predefinita di Vercel (rivalidazione).
- Offline, il service worker serve app e deep link dalla propria cache.

## Verifica prima del deploy

```sh
npx --yes pnpm@12.14.0 install --frozen-lockfile --ignore-scripts
npm run build --prefix apps/web
npm run preview --prefix apps/web    # http://127.0.0.1:4173
```

Comandi verificati da un clone pulito il 18 ottobre 2026: install 24 s senza cache, build 8 s. Output: `index.html`, `manifest.webmanifest`, `sw.js`, `workbox-*.js`, `static/`, `assets/`, `icons/`.

## Dopo il primo deploy

Non ancora effettuato: va eseguito dal proprietario del progetto Vercel. Verificare:

1. `https://<dominio>/` si apre; `https://<dominio>/tornei/qualsiasi` mostra l'app (non il 404 di Vercel).
2. `https://<dominio>/manifest.webmanifest` e `/sw.js` rispondono 200; `curl -I` su un file di `/static/` mostra `immutable`.
3. Chrome DevTools → Application: manifest valido, service worker attivo, «Installabile».
4. Poi la [checklist smartphone](MOBILE_CHECKLIST.md).
