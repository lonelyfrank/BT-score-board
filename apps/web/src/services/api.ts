import type { GameAdapter } from './game';
import { HttpAdapter } from './http';
import { LocalGameAdapter } from './local';
import { createCloud, type EngineApi } from './cloud';

export * from './game';
export { HttpAdapter } from './http';
export { LocalGameAdapter } from './local';

/**
 * Chosen at build time: `vite build` is standalone, `--mode shared` uses Fastify and
 * `--mode cloud` the Cloudflare Worker with accounts.
 */
export const dataMode: GameAdapter['mode'] = import.meta.env.VITE_DATA_MODE;
export const appVersion: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

const http = dataMode === 'shared' ? new HttpAdapter() : null;
const local = dataMode === 'standalone' ? new LocalGameAdapter({ app: appVersion }) : null;
const cloud = dataMode === 'cloud' ? createCloud() : null;
export const api: GameAdapter = (local ?? cloud ?? http)!;
/** Present only in shared mode: organizer token. */
export const sharedApi = http;
/** Present only in cloud mode: accounts, passkeys and their administration. */
export const cloudApi = cloud;
/**
 * The engine with crews, levels and backups: on this device (standalone) or on the server for
 * the signed-in account (cloud).
 */
export const localData: EngineApi | null = local ?? cloud;
/** Shared mode polls for changes made on other devices; the engine notifies them itself. */
export const pollInterval = dataMode === 'shared' ? 5000 : false;
