import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { linkResolver } from '../../../../packages/domain/src/index.js';
import { cloudApi, localData, sharedApi } from './api';
import { isAdmin, useAccount } from './cloud';

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

/**
 * The player this phone belongs to, following links to the record that was kept. In cloud mode
 * it is the player an admin linked to the signed-in account.
 */
export function useMe(): string | null {
  const device = useSyncExternalStore(subscribe, read, () => null);
  const account = useAccount();
  const stored = cloudApi ? (account?.playerId ?? null) : device;
  const links = useQuery({
    queryKey: ['links'],
    queryFn: () => localData!.links(),
    enabled: !!localData,
  });
  if (!stored) return null;
  return linkResolver(links.data ?? [])(stored);
}

/** Whether shared data may be changed from here: always on a device, by admins in cloud mode. */
export function useCanManage(): boolean {
  const account = useAccount();
  return !cloudApi || isAdmin(account);
}

export type Role = { id: 'ospite' | 'privato' | 'organizzatore'; label: string; hint: string };

const roles: Record<Role['id'], Role> = {
  ospite: {
    id: 'ospite',
    label: 'Ospite',
    hint: 'Solo consultazione: per i comandi serve l’accesso organizzatore',
  },
  privato: { id: 'privato', label: 'Privato', hint: 'Crei, segni e correggi i tuoi tornei' },
  organizzatore: {
    id: 'organizzatore',
    label: 'Organizzatore',
    hint: 'Puoi segnare, correggere e cambiare il torneo',
  },
};

/**
 * Who this phone is for the tournaments: the owner of the data on the device (private), the
 * holder of the venue server's token or a cloud admin (organizer), or a visitor who only reads.
 * The server keeps the last word on every command: this only decides what the screens offer.
 */
export function useRole(): Role {
  const account = useAccount();
  if (sharedApi) return roles[sharedApi.hasToken() ? 'organizzatore' : 'ospite'];
  if (cloudApi) return roles[isAdmin(account) ? 'organizzatore' : 'privato'];
  return roles.privato;
}
