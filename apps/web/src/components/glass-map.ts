/** Our geometric model, in CSS pixels; not parameters of Apple's shader. */
export const glassGeometry = { band: 12, displacement: 5 };

/** Signed distance to a rounded rectangle, plus its outward normal.
 * Only the inner curved band displaces the backdrop. The centre stays neutral.
 * Canvas generates a small data map; it never reads or copies the page content.
 */
export function createGlassMap(width: number, height: number, radius: number, band: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  const r = Math.min(radius, width / 2, height / 2);
  const curve = Math.max(1, Math.min(band, r));
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x + 0.5 - width / 2;
      const py = y + 0.5 - height / 2;
      const qx = Math.abs(px) - (width / 2 - r);
      const qy = Math.abs(py) - (height / 2 - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -distance;
      const profile = depth > 0 && depth < curve ? Math.sin((Math.PI * depth) / curve) ** 2 : 0;
      const nx = length ? (ox / length) * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
      const ny = length ? (oy / length) * Math.sign(py) : qy >= qx ? Math.sign(py) : 0;
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = Math.round(127.5 + 127.5 * nx * profile);
      pixels.data[i + 1] = Math.round(127.5 + 127.5 * ny * profile);
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

/** Conservative gate: only the desktop Chromium major actually raster-tested.
 * CSS.supports alone is NOT a rendering test. Extend after glass-verify.mjs.
 * Mobile and unverified versions retain CSS satin.
 */
export function verifiedGlassRefraction() {
  return (
    typeof navigator !== 'undefined' &&
    /(?:HeadlessChrome|Chrome)\/156\./.test(navigator.userAgent) &&
    !/Android|Mobile|Edg\/|OPR\//.test(navigator.userAgent) &&
    CSS.supports('backdrop-filter', 'url("#bt-glass")')
  );
}
