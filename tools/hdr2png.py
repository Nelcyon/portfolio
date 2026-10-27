# Packs a Radiance .hdr into an opaque PNG the browser can always load:
# top half = RGB mantissas, bottom half = shared exponent (RGBE, no alpha).
# Usage: python3 tools/hdr2png.py in.hdr out.png [width]
import sys
import numpy as np
from PIL import Image

def read_hdr(path):
    data = open(path, 'rb').read()
    i = 0
    while True:  # header ends with a blank line, then the resolution line
        j = data.index(b'\n', i)
        line = data[i:j]; i = j + 1
        if line.startswith(b'-Y'):
            _, h, _, w = line.split(); h, w = int(h), int(w); break
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        if data[i] == 2 and data[i + 1] == 2:  # new-style RLE scanline, one channel at a time
            i += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = data[i]; i += 1
                    if n > 128:
                        n -= 128; out[y, x:x + n, c] = data[i]; i += 1
                    else:
                        out[y, x:x + n, c] = np.frombuffer(data, np.uint8, n, i); i += n
                    x += n
        else:  # flat
            out[y] = np.frombuffer(data, np.uint8, w * 4, i).reshape(w, 4); i += w * 4
    return out

rgbe = read_hdr(sys.argv[1])
if len(sys.argv) > 3:  # box-filter down in linear light, then re-encode
    k = rgbe.shape[1] // int(sys.argv[3])
    f = rgbe[:, :, :3].astype(np.float64) * np.ldexp(1.0, rgbe[:, :, 3:4].astype(int) - 136)
    f = f.reshape(f.shape[0] // k, k, f.shape[1] // k, k, 3).mean((1, 3))
    m = f.max(2, keepdims=True)
    e = np.where(m > 1e-32, np.floor(np.log2(np.maximum(m, 1e-32))) + 1, -128)
    rgb = np.where(m > 1e-32, f / np.ldexp(1.0, e.astype(int)) * 256, 0)
    rgbe = np.concatenate([np.clip(rgb, 0, 255), np.clip(e + 128, 0, 255)], 2).astype(np.uint8)
h, w, _ = rgbe.shape
img = np.zeros((h * 2, w, 3), np.uint8)
img[:h] = rgbe[:, :, :3]
img[h:] = rgbe[:, :, 3:4]
Image.fromarray(img).save(sys.argv[2], optimize=True)
print(sys.argv[2], w, h)
