import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// standalone (default): static PWA, all data in IndexedDB, deployable on Vercel.
// shared (`--mode shared`): served by Fastify from dist-shared, data through /api/v1.
export default defineConfig(({ mode }) => {
  const shared = mode === 'shared';
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return {
    define: {
      'import.meta.env.VITE_DATA_MODE': JSON.stringify(shared ? 'shared' : 'standalone'),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(
        commit ? `${pkg.version}+${commit}` : pkg.version,
      ),
    },
    server: shared ? { proxy: { '/api': 'http://127.0.0.1:3000' } } : {},
    plugins: [
      VitePWA({
        // Shared mode stays a plain page served by Fastify; the module still resolves (no-op).
        disable: shared,
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          id: '/',
          name: 'BT Darts Score Board',
          short_name: 'BT Darts',
          description:
            'Bite Trouble — partite, tornei e Hi-Score Nights gestiti da un solo telefono, anche senza connessione.',
          lang: 'it',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#09090b',
          theme_color: '#09090b',
          categories: ['sports', 'games', 'utilities'],
          icons: [
            { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The whole app shell, fonts and brand images: everything needed to start offline.
          globPatterns: ['**/*.{js,css,html,woff2,png,jpg,svg,webmanifest}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          // A new version waits until the organizer applies it (see services/pwa.ts).
          skipWaiting: false,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      outDir: shared ? 'dist-shared' : 'dist',
      emptyOutDir: true,
      // Hashed bundles get a folder of their own so the host can cache them as immutable;
      // /assets keeps the unhashed brand files from public/.
      assetsDir: shared ? 'assets' : 'static',
      rollupOptions: {
        onwarn(warning, warn) {
          // Harmless in a client-only bundle: "use client" directives and comment annotations.
          if (['MODULE_LEVEL_DIRECTIVE', 'INVALID_ANNOTATION'].includes(warning.code ?? '')) return;
          warn(warning);
        },
        output: {
          // Stable vendor chunks: an app update re-downloads only what changed.
          manualChunks(id: string) {
            if (
              /node_modules\/.pnpm\/(react|react-dom|scheduler|react-router|@remix-run|@tanstack)[@+]/.test(
                id,
              )
            )
              return 'react';
            if (/node_modules\/.pnpm\/zod@/.test(id)) return 'zod';
            if (/\/packages\/|node_modules\/.pnpm\/idb@/.test(id)) return 'engine';
          },
        },
      },
    },
  };
});
