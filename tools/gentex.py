# Generates the tileable PBR textures in assets/tex/. Usage: python3 tools/gentex.py assets/tex [spray]
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def spectral(h, w, beta=2.0, ax=1.0, ay=1.0, seed=None, lo=0.0):
    """Tileable fractal noise via FFT. ax/ay stretch frequencies (anisotropy)."""
    r = np.random.default_rng(seed)
    fy = np.fft.fftfreq(h)[:, None] * h * ay
    fx = np.fft.fftfreq(w)[None, :] * w * ax
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    amp = 1.0 / f ** (beta / 2)
    amp[f < lo] = 0
    amp[0, 0] = 0
    ph = r.uniform(0, 2 * np.pi, (h, w))
    n = np.real(np.fft.ifft2(amp * np.exp(1j * ph)))
    n -= n.min(); n /= n.max()
    return n


def worley(h, w, n, seed=None):
    """Tileable cellular noise: F1 distance and cell id."""
    r = np.random.default_rng(seed)
    pts = r.uniform(0, 1, (n, 2)) * [h, w]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    best = np.full((h, w), 1e9, np.float32); second = best.copy(); idx = np.zeros((h, w), np.int32)
    for i, (py, px) in enumerate(pts):
        dy = np.abs(yy - py); dy = np.minimum(dy, h - dy)
        dx = np.abs(xx - px); dx = np.minimum(dx, w - dx)
        d = np.sqrt(dx * dx + dy * dy)
        m = d < best
        second = np.where(m, best, np.minimum(second, d))
        idx = np.where(m, i, idx)
        best = np.where(m, d, best)
    return best, second, idx


def normal_from_height(hgt, strength=4.0):
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * strength
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * strength
    nz = np.ones_like(hgt)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / l, dy / l, nz / l], -1)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


def ramp(t, stops):
    """Color ramp: stops = [(pos, (r,g,b)), ...]"""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    ps = [s[0] for s in stops]
    for c in range(3):
        out[..., c] = np.interp(t, ps, [s[1][c] for s in stops])
    return out


def save(img, name, q=86):
    p = os.path.join(OUT, name)
    if isinstance(img, np.ndarray):
        img = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    if name.endswith('.jpg'):
        img.convert('RGB').save(p, quality=q, optimize=True, progressive=True)
    else:
        img.save(p, optimize=True)
    print(name, os.path.getsize(p))


def gray(a):
    return np.clip(a * 255, 0, 255).astype(np.uint8)


# --- Redwood bark: deep vertical fibrous furrows, reddish brown -----------------
def bark():
    H, W = 1024, 512
    fib = spectral(H, W, 2.2, ax=1.0, ay=14, seed=1)        # long vertical fibers
    fine = spectral(H, W, 1.6, ax=1.0, ay=4, seed=2)
    big = spectral(H, W, 2.6, ax=1.0, ay=5, seed=3)
    ridges = 1 - np.abs(fib * 2 - 1)                           # ridge lines
    hgt = 0.55 * ridges ** 1.5 + 0.25 * big + 0.2 * fine
    hgt = (hgt - hgt.min()) / (hgt.max() - hgt.min())
    col = ramp(hgt, [(0, (38, 17, 10)), (0.35, (86, 38, 22)), (0.6, (128, 62, 38)), (0.85, (150, 88, 62)), (1, (160, 128, 108))])
    weather = spectral(H, W, 2.4, seed=4)
    col = col * (0.85 + 0.3 * weather[..., None])
    save(col, 'bark_col.jpg')
    save(normal_from_height(hgt, 9), 'bark_nrm.jpg')


# --- Forest floor: redwood needle duff, twigs, a little sorrel ---------------------
def forest_floor():
    N = 1024
    base = spectral(N, N, 2.4, seed=10)
    col = ramp(base, [(0, (52, 32, 20)), (0.5, (84, 54, 34)), (1, (112, 76, 48))])
    img = Image.fromarray(col.astype(np.uint8))
    hmap = Image.fromarray(gray(base * 0.4))
    d = ImageDraw.Draw(img); dh = ImageDraw.Draw(hmap)
    r = np.random.default_rng(11)
    for i in range(26000):  # needles, drawn with wrap-around copies so it tiles
        x, y = r.uniform(0, N, 2)
        a = r.uniform(0, np.pi)
        L = r.uniform(6, 22)
        dx, dy = math.cos(a) * L, math.sin(a) * L
        t = r.uniform()
        c = (int(70 + 80 * t), int(38 + 45 * t), int(20 + 25 * t)) if r.uniform() > 0.08 else (int(140 + 40 * t), int(110 + 30 * t), int(70))
        hv = int(110 + 120 * r.uniform())
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                if -30 < x + ox < N + 30 and -30 < y + oy < N + 30:
                    d.line([(x + ox, y + oy), (x + ox + dx, y + oy + dy)], fill=c, width=3)
                    dh.line([(x + ox, y + oy), (x + ox + dx, y + oy + dy)], fill=hv, width=2)
    for i in range(240):  # twigs
        x, y = r.uniform(0, N, 2); a = r.uniform(0, np.pi); L = r.uniform(30, 90)
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                p0 = (x + ox, y + oy); p1 = (x + ox + math.cos(a) * L, y + oy + math.sin(a) * L)
                d.line([p0, p1], fill=(58, 38, 26), width=3); dh.line([p0, p1], fill=255, width=4)
    col = np.asarray(img).astype(np.float32)
    # Sorrel / moss patches
    patch = spectral(N, N, 3.0, seed=12)
    m = np.clip((patch - 0.62) * 6, 0, 1)[..., None]
    leaf = spectral(N, N, 0.8, seed=13)[..., None]
    green = np.concatenate([62 + 40 * leaf, 88 + 50 * leaf, 34 + 18 * leaf], -1)
    col = col * (1 - m * 0.85) + green * m * 0.85
    shade = spectral(N, N, 2.8, seed=14)[..., None]
    col *= 0.8 + 0.35 * shade
    save(col, 'floor_col.jpg')
    h = np.asarray(hmap.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    save(normal_from_height(h, 3), 'floor_nrm.jpg')


# --- Asphalt ---------------------------------------------------------------------------
def asphalt():
    N = 1024
    grain = np.random.default_rng(20).uniform(0, 1, (N, N))
    grain = np.asarray(Image.fromarray(gray(grain)).filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255
    mid = spectral(N, N, 2.0, seed=21)
    big = spectral(N, N, 3.0, seed=22)
    stones = (grain > 0.62).astype(np.float32)
    v = 0.30 + 0.18 * (grain - 0.5) + 0.12 * stones + 0.1 * (mid - 0.5) + 0.14 * (big - 0.5)
    col = np.stack([v * 255 * 0.98, v * 255 * 0.98, v * 255 * 1.02], -1)
    save(col, 'asphalt_col.jpg')
    hgt = 0.6 * grain + 0.4 * stones
    save(normal_from_height(hgt, 2.5), 'asphalt_nrm.jpg')
    rough = 0.82 + 0.15 * (1 - stones) - 0.12 * big
    save(gray(rough), 'asphalt_rgh.jpg')


# --- Gravel ------------------------------------------------------------------------------
def gravel():
    N = 512
    f1, f2, idx = worley(N, N, 900, seed=30)
    edge = np.clip((f2 - f1) / 6, 0, 1)
    tone = np.random.default_rng(31).uniform(0.6, 1.1, 900)[idx]
    hue = np.random.default_rng(32).uniform(-1, 1, 900)[idx]
    hgt = np.sqrt(edge) * tone
    v = (0.25 + 0.45 * hgt * tone)
    col = np.stack([v * (150 + 20 * hue), v * (140 + 10 * hue), v * (128 - 10 * hue)], -1) * 1.15
    save(col, 'gravel_col.jpg')
    save(normal_from_height(hgt, 5), 'gravel_nrm.jpg')


# --- Redwood lap siding (horizontal boards, 4 boards per tile) --------------------------------
def siding():
    H, W = 512, 1024
    grain = spectral(H, W, 2.0, ax=25, ay=1.0, seed=40)
    fine = spectral(H, W, 1.2, ax=10, ay=1.0, seed=41)
    y = np.arange(H)[:, None] / H * 4
    t = y % 1
    lap = t  # each board thicker at the bottom
    shadow = np.clip((t - 0.93) / 0.07, 0, 1)
    board = np.floor(y).astype(int) % 4
    tone = np.array([1.0, 0.92, 1.05, 0.96])[board]
    hgt = lap * 0.8 - shadow * 0.8 + 0.1 * grain
    v = (0.55 + 0.35 * grain + 0.15 * fine) * tone
    col = ramp(v / 1.2, [(0, (60, 28, 16)), (0.5, (118, 58, 34)), (1, (168, 98, 62))])
    col *= (1 - 0.55 * shadow)[..., None]
    save(col, 'siding_col.jpg')
    save(normal_from_height(hgt, 6), 'siding_nrm.jpg')


# --- Roof shingles (staggered tabs) ---------------------------------------------------------
def shingles():
    N = 512
    rows = 8
    yy, xx = np.mgrid[0:N, 0:N] / N
    row = np.floor(yy * rows).astype(int)
    t = (yy * rows) % 1
    off = (row % 2) * 0.5 / 4
    tab = np.floor(((xx + off) * 4) % 4).astype(int)
    tid = (row * 7 + tab * 13) % 23
    tone = np.random.default_rng(50).uniform(0.75, 1.15, 23)[tid]
    sx = ((xx + off) * 4) % 1
    gap = (sx < 0.012) | (sx > 0.988)
    grit = np.random.default_rng(51).uniform(0, 1, (N, N))
    v = (0.22 + 0.1 * grit) * tone
    v = np.where(gap, 0.06, v)
    v *= 1 - 0.5 * np.clip((0.12 - t) / 0.12, 0, 1)
    col = np.stack([v * 255 * 1.0, v * 255 * 0.98, v * 255 * 0.95], -1)
    save(col, 'shingle_col.jpg')
    hgt = t * 0.7 + grit * 0.15 - gap * 0.5
    save(normal_from_height(hgt, 5), 'shingle_nrm.jpg')


# --- Wood floor planks -------------------------------------------------------------------
def planks():
    H, W = 1024, 1024
    nP = 8
    yy, xx = np.mgrid[0:H, 0:W]
    pr = (yy * nP // H)
    off = np.random.default_rng(60).uniform(0, 1, nP)[pr]
    plen = 0.5
    u = (xx / W + off) % 1
    pid = pr * 3 + np.floor(u / plen).astype(int)
    tone = np.random.default_rng(61).uniform(0.78, 1.12, 64)[pid % 64]
    grain = spectral(H, W, 2.0, ax=30, ay=1.0, seed=62)
    knots = spectral(H, W, 3.2, ax=3, ay=1.0, seed=63)
    v = (0.45 + 0.45 * grain + 0.1 * knots) * tone
    col = ramp(v / 1.15, [(0, (92, 56, 30)), (0.5, (150, 102, 62)), (1, (196, 150, 104))])
    ty = (yy * nP / H) % 1; tu = (u / plen) % 1
    seam = (ty < 0.008) | (ty > 0.992) | (tu < 0.003) | (tu > 0.997)
    col[seam] *= 0.45
    save(col, 'planks_col.jpg')
    save(normal_from_height(grain * 0.3 - seam * 0.6, 3), 'planks_nrm.jpg')


# --- Plaster / painted drywall (neutral, tinted by material color) ------------------------------
def plaster():
    N = 512
    h = 0.6 * spectral(N, N, 1.4, seed=70) + 0.4 * spectral(N, N, 2.6, seed=71)
    save(normal_from_height(h, 1.2), 'plaster_nrm.jpg')


def carpet():
    N = 512
    g = np.random.default_rng(80).uniform(0, 1, (N, N))
    g = np.asarray(Image.fromarray(gray(g)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255
    big = spectral(N, N, 2.5, seed=81)
    v = 0.8 + 0.25 * (g - 0.5) + 0.12 * (big - 0.5)
    save(gray(v), 'carpet_col.jpg')
    save(normal_from_height(g, 3), 'carpet_nrm.jpg')


def tile():
    N = 512; n = 4
    yy, xx = np.mgrid[0:N, 0:N]
    tx = (xx * n / N) % 1; ty = (yy * n / N) % 1
    grout = (tx < 0.02) | (tx > 0.98) | (ty < 0.02) | (ty > 0.98)
    noise = spectral(N, N, 2.0, seed=90)
    v = np.where(grout, 0.62, 0.9 + 0.06 * noise)
    col = np.stack([v * 236, v * 232, v * 224], -1)
    save(col, 'tile_col.jpg')
    save(normal_from_height(-grout.astype(np.float32) * 0.6 + noise * 0.05, 3), 'tile_nrm.jpg')


def concrete():
    N = 512
    a = spectral(N, N, 2.2, seed=100); b = np.random.default_rng(101).uniform(0, 1, (N, N))
    v = 0.62 + 0.12 * (a - 0.5) + 0.06 * (b - 0.5)
    col = np.stack([v * 255, v * 250, v * 240], -1)
    save(col, 'concrete_col.jpg')
    save(normal_from_height(0.7 * a + 0.3 * b, 1.5), 'concrete_nrm.jpg')


# --- Fern frond (alpha) -------------------------------------------------------------------
def fern():
    W, H = 256, 1024
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(110)
    cx = W / 2
    # rachis
    d.line([(cx, H), (cx, 10)], fill=(58, 82, 30, 255), width=6)
    n = 34
    for i in range(n):
        t = i / n
        y = H - 30 - t * (H - 60)
        L = (W * 0.46) * math.sin(min(1, (1 - t) * 1.25) * math.pi * 0.5) * (0.35 + 0.65 * min(1, t * 4))
        for s in (-1, 1):
            g = int(80 + 40 * r.uniform()); col = (int(40 + 20 * r.uniform()), g + 40, int(28 + 15 * r.uniform()), 255)
            tip = (cx + s * L, y - L * 0.25)
            w2 = 9 * (1 - t * 0.6)
            d.polygon([(cx, y + w2), (cx + s * L * 0.5, y - L * 0.08 + w2 * 0.9), tip, (cx + s * L * 0.5, y - L * 0.12 - w2 * 0.6), (cx, y - w2)], fill=col)
            d.line([(cx, y), tip], fill=(46, 92, 30, 255), width=1)
    img = img.filter(ImageFilter.SMOOTH)
    save(img, 'fern.png')


# --- Redwood foliage spray (alpha): a flat ovate spray of branchlets with two-ranked needles ---
def spray():
    W, H = 512, 512
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(121)
    def needles(x, y, x2, y2, nl, dens):
        L = math.hypot(x2 - x, y2 - y); a = math.atan2(y2 - y, x2 - x)
        steps = max(2, int(L / dens))
        for k in range(steps):
            t = k / steps
            px, py = x + (x2 - x) * t, y + (y2 - y) * t
            ln = nl * (0.55 + 0.45 * math.sin(math.pi * min(1, t * 1.1 + 0.08)))
            for sd in (-1, 1):
                na = a + sd * r.uniform(1.0, 1.3)
                g = r.uniform()
                c = (int(26 + 30 * g), int(64 + 50 * g), int(26 + 20 * g), 255)
                if r.uniform() < 0.06: c = (96, 112, 52, 255)
                d.line([(px, py), (px + math.cos(na) * ln, py + math.sin(na) * ln)], fill=c, width=3)
        d.line([(x, y), (x2, y2)], fill=(84, 70, 40, 255), width=2)
    # main axis from bottom center to top
    bx0, by0, bx1, by1 = W * 0.5, H * 0.99, W * 0.5 + r.uniform(-20, 20), H * 0.04
    n = 18
    for i in range(n):
        t = 0.08 + 0.88 * i / n
        px, py = bx0 + (bx1 - bx0) * t, by0 + (by1 - by0) * t
        span = W * 0.42 * math.sin(math.pi * min(1, t * 1.05)) ** 0.8
        for sd in (-1, 1):
            if r.uniform() < 0.1: continue
            ang = -math.pi / 2 + sd * r.uniform(0.75, 1.05)
            L = span * r.uniform(0.7, 1.0)
            ex, ey = px + math.cos(ang) * L, py + math.sin(ang) * L
            needles(px, py, ex, ey, r.uniform(15, 19), 2.6)
            # a sub-branchlet
            if L > 60 and r.uniform() < 0.7:
                tt = r.uniform(0.3, 0.6); qx, qy = px + (ex - px) * tt, py + (ey - py) * tt
                a2 = ang - sd * r.uniform(0.5, 0.8)
                needles(qx, qy, qx + math.cos(a2) * L * 0.4, qy + math.sin(a2) * L * 0.4, 13, 2.6)
    needles(bx0, by0, bx1, by1, 16, 2.6)
    save(img, 'spray.png')


for f in [spray] if len(sys.argv) > 2 else [bark, forest_floor, asphalt, gravel, siding, shingles, planks, plaster, carpet, tile, concrete, fern, spray]:
    f()
