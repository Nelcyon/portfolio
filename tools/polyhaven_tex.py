# Downloads Poly Haven 1K texture maps and writes web-sized JPGs.
# Usage: python3 tools/polyhaven_tex.py <download cache dir> assets/tex [name ...]
import sys, os, subprocess
from PIL import Image, ImageOps
S, OUT = sys.argv[1], sys.argv[2]
MAP = {  # our name: (polyhaven id, extra maps)
  'bark': ('metasequoia_bark', []), 'floor': ('mud_forest', []), 'asphalt': ('asphalt_02', ['rough']),
  'gravel': ('gravel_floor_02', []), 'siding': ('weathered_plank_siding', []), 'shingle': ('roof_slates_02', []),
  'planks': ('wood_floor', []), 'tile': ('interior_tiles', ['rough']), 'carpet': ('dirty_carpet', []),
  'concrete': ('brushed_concrete', []), 'plaster': ('painted_plaster_wall', []), 'deck': ('wood_floor_deck', []),
  'oak': ('oak_wood_planks', []),
}
def get(id, kind):
    p = f'{S}/{id}_{kind}.jpg'
    if not os.path.exists(p):
        subprocess.run(['curl', '-sfL', '-o', p, f'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{id}/{id}_{kind}_1k.jpg'], check=True)
    return Image.open(p)
SMALL = {'carpet', 'plaster', 'concrete', 'gravel'}
only = sys.argv[3:] or list(MAP)
for name in only:
    id, extra = MAP[name]
    if name != 'plaster':
        c = get(id, 'diff').convert('RGB')
        if name == 'carpet':  # neutral, light base so carpet(color) tints it
            g = ImageOps.grayscale(c); g = ImageOps.autocontrast(g, cutoff=1)
            g = g.point(lambda v: int(150 + v * 0.42)); c = g.convert('RGB')
        if name in SMALL: c = c.resize((512, 512), Image.LANCZOS)
        c.save(f'{OUT}/{name}_col.jpg', quality=78, optimize=True, progressive=True)
    n = get(id, 'nor_gl').convert('RGB')
    if name in SMALL: n = n.resize((512, 512), Image.LANCZOS)
    n.save(f'{OUT}/{name}_nrm.jpg', quality=78, optimize=True)
    if 'rough' in extra:
        get(id, 'rough').convert('L').resize((512, 512), Image.LANCZOS).save(f'{OUT}/{name}_rgh.jpg', quality=85)
    print(name, 'ok')
