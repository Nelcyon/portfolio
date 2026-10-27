# Converts a .glb to embedded glTF JSON (for hosts that cannot serve .glb). Usage: python3 tools/glb2json.py in.glb out.gltf.json
import sys, json, struct, base64, os
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
magic, ver, length = struct.unpack_from('<4sII', b, 0)
assert magic == b'glTF'
off = 12; js = None; bin_ = None
while off < length:
    clen, ctype = struct.unpack_from('<II', b, off); off += 8
    chunk = b[off:off + clen]; off += clen
    if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf8').rstrip(' \x00'))
    elif ctype == 0x004E4942: bin_ = chunk
js['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(bin_).decode()
open(dst, 'w').write(json.dumps(js, separators=(',', ':')))
print(os.path.basename(dst), os.path.getsize(dst))
