"""Builds the app icons in apps/web/public/icons from docs/brand/app-icon.png.

The artwork is a pink rounded square on black corners. Three variants come out of it:
  - "any" (favicon, PWA 192/512): the rounded square with transparent corners;
  - apple-touch-icon: full-bleed pink square (iOS rounds the corners itself);
  - maskable-512: full-bleed pink with the artwork inside the 80% safe zone.
Run: python3 apps/web/scripts/app-icons.py
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

root = Path(__file__).resolve().parents[3]
out = root / 'apps/web/public/icons'
src = Image.open(root / 'docs/brand/app-icon.png').convert('RGB')
w, h = src.size

# Black corners outside the rounded square: flood-filled from the four corners.
dark = src.convert('L').point(lambda v: 255 if v < 40 else 0)
mask = Image.new('L', src.size, 0)
for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    seed = dark.copy()
    ImageDraw.floodfill(seed, corner, 128, thresh=0)
    mask = ImageChops.lighter(mask, seed.point(lambda v: 255 if v == 128 else 0))
# Cover the anti-aliased rim too.
mask = mask.filter(ImageFilter.MaxFilter(9))

pink = (251, 47, 197)
square = src.copy()
square.paste(pink, mask=mask)  # full-bleed pink square

rounded = src.convert('RGBA')
rounded.putalpha(ImageChops.invert(mask).filter(ImageFilter.GaussianBlur(1.2)))
bbox = rounded.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
rounded = rounded.crop(bbox)


def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)


out.mkdir(parents=True, exist_ok=True)
fit(square, 180).save(out / 'apple-touch-icon.png', optimize=True)
fit(rounded, 512).save(out / 'pwa-512.png', optimize=True)
fit(rounded, 192).save(out / 'pwa-192.png', optimize=True)
fit(rounded, 48).save(out / 'favicon-48.png', optimize=True)
fit(rounded, 32).save(out / 'favicon-32.png', optimize=True)

maskable = Image.new('RGB', (512, 512), pink)
inner = fit(square, 410)
maskable.paste(inner, ((512 - 410) // 2, (512 - 410) // 2))
maskable.save(out / 'maskable-512.png', optimize=True)
print('icons written to', out)
