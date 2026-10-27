# Re-encodes the world's images as WebP in the sizes the world loads:
#   assets/tex/*.webp     surface textures at their own size (max 1024), for computers
#   assets/tex/m/*.webp   the same at max 512, for phones
#   assets/shots/w/*.webp screenshots shown on in-world screens, max 768 px
#   assets/hdri/forest_slope_sky.webp (+ _m for phones) and a half-size forest_slope.png
# Usage: python3 tools/webtex.py   (from the repo root; run once after adding a texture)
import glob, os
import numpy as np
from PIL import Image

def save(im, path, size, q):
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6)

for f in sorted(glob.glob('assets/tex/*.jpg') + glob.glob('assets/tex/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f)
    q = 78 if name.endswith('_nrm') else 72  # normal maps show blockiness sooner
    save(im, f'assets/tex/{name}.webp', 1024, q)
    save(im, f'assets/tex/m/{name}.webp', 512, q)
    os.remove(f)

for f in sorted(glob.glob('assets/shots/*.jpg') + glob.glob('assets/shots/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    save(Image.open(f).convert('RGB'), f'assets/shots/w/{name}.webp', 768, 82)

sky = 'assets/hdri/forest_slope_sky.jpg'
if os.path.exists(sky):
    im = Image.open(sky)
    im.resize((2048, 512), Image.LANCZOS).save('assets/hdri/forest_slope_sky.webp', 'WEBP', quality=70, method=6)
    im.resize((1024, 256), Image.LANCZOS).save('assets/hdri/forest_slope_sky_m.webp', 'WEBP', quality=70, method=6)
    os.remove(sky)

# The image light is only ever seen blurred, so half size is plenty. Decode the
# RGBE PNG (top half mantissas, bottom half exponents), average 2x2, re-encode.
hdr = 'assets/hdri/forest_slope.png'
px = np.asarray(Image.open(hdr).convert('RGB'), np.float64)
h = px.shape[0] // 2
if px.shape[1] > 256:
    rgb = px[:h] * np.exp2(px[h:, :, :1] - 136)
    rgb = rgb.reshape(h // 2, 2, -1, 2, 3).mean(axis=(1, 3))
    m = rgb.max(axis=2, keepdims=True)
    e = np.ceil(np.log2(np.maximum(m, 1e-30) / 255.999))
    e = np.clip(e, -128, 127)
    mant = np.clip(np.round(rgb / np.exp2(e)), 0, 255)
    out = np.concatenate([mant, np.repeat(e + 136, 3, axis=2)], axis=0).astype(np.uint8)
    Image.fromarray(out).save(hdr, optimize=True)
