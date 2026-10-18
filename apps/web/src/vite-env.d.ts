/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Defined by vite.config.ts from the build mode. */
  readonly VITE_DATA_MODE: 'standalone' | 'shared';
  readonly VITE_APP_VERSION: string;
}
