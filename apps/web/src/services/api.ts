import type { GameAdapter } from './game';
import { HttpAdapter } from './http';
import { LocalGameAdapter } from './local';

export * from './game';
export { HttpAdapter } from './http';
export { LocalGameAdapter } from './local';

/** Chosen at build time: `vite build` is standalone, `vite build --mode shared` uses Fastify. */
export const dataMode: GameAdapter['mode'] =
  import.meta.env.VITE_DATA_MODE === 'shared' ? 'shared' : 'standalone';
export const appVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

const http = dataMode === 'shared' ? new HttpAdapter() : null;
const local = dataMode === 'standalone' ? new LocalGameAdapter({ app: appVersion }) : null;
export const api: GameAdapter = (local ?? http)!;
/** Present only in shared mode: organizer token. */
export const sharedApi = http;
/** Present only in standalone mode: device storage, backup and restore. */
export const localData = local;
/** Shared mode polls for changes made on other devices; locally every change is notified. */
export const pollInterval = dataMode === 'shared' ? 5000 : false;
