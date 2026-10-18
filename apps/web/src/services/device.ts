export interface StorageInfo {
  /** null: the browser exposes no persistence API. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  const [persisted, estimate] = await Promise.all([
    storage?.persisted?.().catch(() => null) ?? null,
    storage?.estimate?.().catch(() => null) ?? null,
  ]);
  return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}

let requested: Promise<boolean | null> | null = null;
/**
 * Asks the browser not to evict local data under storage pressure. Browsers may refuse or
 * decide silently (Chrome grants installed apps, Firefox asks, Safari applies its own policy).
 */
export function requestPersistence(): Promise<boolean | null> {
  requested ??= (async () => {
    const storage = navigator.storage;
    if (!storage?.persist) return null;
    if (await storage.persisted()) return true;
    return storage.persist().catch(() => false);
  })();
  return requested;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Uses the share sheet when the device can share files (mobile: WhatsApp, Drive, Files…). */
export async function shareFile(name: string, content: string, type = 'application/json') {
  const file = new File([content], name, { type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (error) {
    if ((error as Error).name === 'AbortError') return true;
    throw error;
  }
}
export function canShareFiles() {
  try {
    return !!navigator.canShare?.({
      files: [new File([''], 'test.json', { type: 'application/json' })],
    });
  } catch {
    return false;
  }
}
