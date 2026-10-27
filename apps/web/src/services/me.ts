import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { linkResolver } from '../../../../packages/domain/src/index.js';
import { localData } from './api';

// Which player of the device is its owner. A per-device convenience, not game data: it is
// not part of backups or crew packages, so a new phone simply asks again.
const key = 'bt-me';
const listeners = new Set<() => void>();
const read = () => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const meStore = {
  set(playerId: string | null) {
    try {
      if (playerId) localStorage.setItem(key, playerId);
      else localStorage.removeItem(key);
    } catch {
      /* Not remembered: the app asks again next time. */
    }
    listeners.forEach((listener) => listener());
  },
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};

/** The player this phone belongs to, following links to the record that was kept. */
export function useMe(): string | null {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const links = useQuery({
    queryKey: ['links'],
    queryFn: () => localData!.links(),
    enabled: !!localData,
  });
  if (!stored) return null;
  return linkResolver(links.data ?? [])(stored);
}
