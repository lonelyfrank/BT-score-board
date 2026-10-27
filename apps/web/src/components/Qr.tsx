import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code drawn as an image from the link itself; nothing leaves the device. */
export function Qr({ value, label }: { value: string; label: string }) {
  const src = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    return code.createDataURL(6, 8);
  }, [value]);
  return <img className="qr" src={src} alt={label} width={192} height={192} />;
}

/** Shares a link with the system sheet when there is one, else copies it. */
export async function shareLink(
  title: string,
  url: string,
): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
