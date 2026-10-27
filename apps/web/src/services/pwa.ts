import { useEffect, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface PwaState {
  supported: boolean;
  /** The service worker controls the app: it starts without network. */
  offlineReady: boolean;
  /** A new version is installed and waits; it is applied only when the user asks. */
  updateAvailable: boolean;
  /** Operations in progress that a reload would interrupt (an import, an export). */
  holds: number;
}
let state: PwaState = { supported: false, offlineReady: false, updateAvailable: false, holds: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
let applyUpdate: (reload?: boolean) => Promise<void> = async () => undefined;

export function registerPwa() {
  if (import.meta.env.VITE_DATA_MODE === 'shared' || !('serviceWorker' in navigator)) return;
  set({ supported: true, offlineReady: !!navigator.serviceWorker.controller });
  applyUpdate = registerSW({
    onOfflineReady: () => set({ offlineReady: true }),
    // Never reloads by itself: a match in progress keeps running on the current version.
    onNeedRefresh: () => set({ updateAvailable: true }),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      if (registration.active) set({ offlineReady: true });
      // Cheap periodic check; no polling while hidden or offline.
      setInterval(() => {
        if (navigator.onLine && document.visibilityState === 'visible')
          void registration.update().catch(() => undefined);
      }, 3600_000);
    },
  });
}

export function usePwa() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => state,
  );
  return {
    ...current,
    /** True when the update can be applied now without interrupting anything. */
    canApply: current.updateAvailable && current.holds === 0,
    applyUpdate: () => {
      if (state.holds === 0) void applyUpdate(true);
    },
  };
}

/** Keeps a waiting version from being applied while `active` (e.g. a backup being imported). */
export function useUpdateHold(active: boolean) {
  useEffect(() => {
    if (!active) return;
    set({ holds: state.holds + 1 });
    return () => set({ holds: state.holds - 1 });
  }, [active]);
}

/** Screens where a reload would interrupt the organizer: live scoring and setup forms. */
export const isCriticalRoute = (pathname: string) =>
  pathname.startsWith('/partite/') || pathname === '/tornei/nuovo';
