# Makes the few images the 3D world still loads:
#   assets/shots/w/*.webp   screenshots shown on in-world screens, max 768 px
#   assets/tex/bark.webp    redwood bark, 256 px, from Poly Haven's Metasequoia Bark
#                           (python3 tools/webtex.py path/to/bark_col.jpg)
#   assets/tex/*_a.webp     leaf silhouettes (alpha only, as grayscale) from a cut-out PNG
#                           dropped into assets/tex/ (the PNG is removed afterwards)
# Everything else in the world is flat-colored (see SURFACE in js/world.js).
# Usage: python3 tools/webtex.py   (from the repo root)
import glob, os, sys
from PIL import Image

for f in sorted(glob.glob('assets/shots/*.jpg') + glob.glob('assets/shots/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGB')
    im.thumbnail((768, 768), Image.LANCZOS)
    os.makedirs('assets/shots/w', exist_ok=True)
    im.save(f'assets/shots/w/{name}.webp', 'WEBP', quality=82, method=6)

for f in sorted(glob.glob('assets/tex/*.png')):
    name = os.path.splitext(os.path.basename(f))[0]
    a = Image.open(f).convert('RGBA').split()[3]
    Image.merge('RGB', (a, a, a)).save(f'assets/tex/{name}_a.webp', 'WEBP', quality=80, method=6)
    os.remove(f)

if len(sys.argv) > 1:
    Image.open(sys.argv[1]).convert('RGB').resize((256, 256), Image.LANCZOS).save('assets/tex/bark.webp', 'WEBP', quality=70, method=6)
