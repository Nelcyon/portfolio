// The Redwoods: a small first-person world where a family uses the projects.
//
// Units are meters. North is -Z, east is +X. A two-lane road runs east-west
// through an old-growth redwood forest. North of the road, up a gravel drive, is
// the family's house in a clearing; south of the road a second house sits in a
// smaller clearing. The bus stop is on the north side of the road, east of the
// house. The visitor starts on the road facing north toward the house.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROJECTS, projectById } from './projects.js';

const SHOTS = 'assets/shots/';
const TEX = 'assets/tex/';
const MODELS = 'assets/models/';
const EYE = 1.65;
const RADIUS = 0.3; // visitor's body radius for collisions
const STEP = 0.45; // highest step the visitor can walk up
const isTouch = matchMedia('(pointer: coarse)').matches;
const LOW = isTouch || /[?&]low\b/.test(location.search); // lighter shadows for phones

// Road: a gentle curve along x
const RW = 3.6; // asphalt half width
const SHOULDER = 1.3;
const roadZ = (x) => 4 * Math.sin((x - 10) / 32);
const ROAD_X = [-120, 120];
const BOUNDS = { x0: -62, x1: 62, z0: -62, z1: 52 };
const WORLD_R = { x: 95, z: 88 }; // the ground fades into the void past this

// Deterministic randomness so the forest is the same on every visit
let seed = 20261027;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const R = (a, b) => a + (b - a) * rand();

// Smooth value noise for large-scale color variation
function noise2(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------------------------------------------------------------------
// Renderer, scene, camera

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const FOG = new THREE.Color(0x29332d);
scene.fog = new THREE.FogExp2(FOG, 0.016);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 320);
camera.rotation.order = 'YXZ';

// Light: soft sky fill, a low-ish sun filtering through the canopy, and the
// Poly Haven "forest slope" HDRI for reflections and ambient color.
const hemi = new THREE.HemisphereLight(0xc9dcff, 0x8a7d6c, 0.55);
scene.add(hemi);
const SUN_DIR = new THREE.Vector3(0.45, 0.82, 0.36).normalize();
const sun = new THREE.DirectionalLight(0xffe2b8, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.target.position.set(0, 0, -10);
sun.position.add(sun.target.position);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 2048 : 4096, LOW ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 260 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const pmrem = new THREE.PMREMGenerator(renderer);
new EXRLoader().load('assets/hdri/forest.exr', (t) => {
  t.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(t).texture;
  t.dispose();
});

// Sky dome: hazy light overhead through the canopy, sinking into the dark at the horizon
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(280, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0xbdd3e6) }, mid: { value: new THREE.Color(0x56675d) }, low: { value: new THREE.Color(0x000000) } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid, low; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.75, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
  sky.onBeforeRender = () => sky.position.copy(camera.position);
}

// ---------------------------------------------------------------------------
// Textures and materials
//
// Surface textures are generated tileable PBR maps (see assets/CREDITS.md). Materials
// that use them carry userData.uv = [meters per tile across, meters per tile up]
// and boxes built with them get world-scaled UVs, so boards and tiles line up.

const loader = new THREE.TextureLoader();
const manager = THREE.DefaultLoadingManager;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = new Map();
function loadTex(path, srgb = true) {
  if (!texCache.has(path)) {
    const t = loader.load(path);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(path, t);
  }
  return texCache.get(path);
}
const tex = (file) => loadTex(SHOTS + file);
const ptex = (file, srgb = true) => loadTex(TEX + file, srgb);

function pbr(name, uv, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: opts.noMap ? null : ptex(`${name}_col.jpg`),
    normalMap: ptex(`${name}_nrm.jpg`, false),
    roughness: 0.85,
    ...opts.mat,
  });
  if (opts.normal) m.normalScale.set(opts.normal, opts.normal);
  m.userData.uv = uv;
  return m;
}

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
const paintCache = new Map();
function paint(color) {
  if (!paintCache.has(color)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, normalMap: ptex('plaster_nrm.jpg', false) });
    m.normalScale.set(0.5, 0.5);
    m.userData.uv = [2, 2];
    paintCache.set(color, m);
  }
  return paintCache.get(color);
}
function carpet(color) {
  const m = pbr('carpet', [1.2, 1.2], { mat: { color, roughness: 1 } });
  return m;
}

const M = {
  siding: pbr('siding', [1.6, 0.8], { mat: { roughness: 0.8 } }),
  sidingGray: pbr('siding', [1.6, 0.8], { mat: { color: 0x8e9aa0, roughness: 0.8 } }),
  shingle: pbr('shingle', [2, 2], { mat: { roughness: 0.9 } }),
  planks: pbr('planks', [2.4, 2.4], { mat: { roughness: 0.5 } }),
  deck: pbr('planks', [2.4, 2.4], { mat: { color: 0x9a8a78, roughness: 0.8 } }),
  tile: pbr('tile', [1.2, 1.2], { mat: { roughness: 0.25 } }),
  concrete: pbr('concrete', [2, 2]),
  gravel: pbr('gravel', [1.6, 1.6], { mat: { roughness: 1 } }),
  asphalt: pbr('asphalt', [5, 5], { mat: { roughness: 0.9, roughnessMap: ptex('asphalt_rgh.jpg', false) } }),
  bark: new THREE.MeshStandardMaterial({ map: ptex('bark_col.jpg'), normalMap: ptex('bark_nrm.jpg', false), roughness: 0.95 }),
  trim: mat(0xf2efe6, { roughness: 0.6 }),
  darkTrim: mat(0x2e2a26, { roughness: 0.6 }),
  stone: pbr('concrete', [1.2, 1.2], { mat: { color: 0x8c857c } }),
  wood: pbr('planks', [2.4, 2.4], { mat: { color: 0xc9a27a, roughness: 0.45 } }),
  darkWood: pbr('planks', [2.4, 2.4], { mat: { color: 0x6b4a33, roughness: 0.45 } }),
  counter: mat(0x3d3b38, { roughness: 0.25 }),
  white: mat(0xf4f2ee, { roughness: 0.35 }),
  steel: mat(0xc9ccd0, { metalness: 0.85, roughness: 0.3 }),
  black: mat(0x161616, { roughness: 0.4 }),
};
M.bark.normalScale.set(1.4, 1.4);
const glass = new THREE.MeshStandardMaterial({ color: 0x8fa7b5, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.0, depthWrite: false, envMapIntensity: 0.6 });
function screenMat(file) {
  return new THREE.MeshBasicMaterial({ map: tex(file), toneMapped: false });
}

// World-scaled UVs from each face's normal, using each face's material scale.
function planarUV(geo, ox, oy, oz, mats) {
  const arr = Array.isArray(mats) ? mats : [mats];
  if (!arr.some((m) => m?.userData?.uv)) return;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  const scale = new Array(pos.count).fill(null);
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : pos.count, materialIndex: 0 }];
  for (const g of groups) {
    const s = (Array.isArray(mats) ? arr[g.materialIndex ?? 0] : mats)?.userData?.uv;
    if (!s) continue;
    for (let i = g.start; i < g.start + g.count; i++) scale[geo.index ? geo.index.getX(i) : i] = s;
  }
  for (let v = 0; v < pos.count; v++) {
    const s = scale[v];
    if (!s) continue;
    const x = pos.getX(v) + ox, y = pos.getY(v) + oy, z = pos.getZ(v) + oz;
    const nx = Math.abs(nrm.getX(v)), ny = Math.abs(nrm.getY(v)), nz = Math.abs(nrm.getZ(v));
    let a, b;
    if (ny >= nx && ny >= nz) { a = x; b = z; } else if (nx >= nz) { a = z; b = y; } else { a = x; b = y; }
    uv.setXY(v, a / s[0], b / s[1]);
  }
  uv.needsUpdate = true;
}
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// ---------------------------------------------------------------------------
// Collision and floors
//
// Colliders and floor patches are boxes in the local frame of a "place" (a house,
// or the world itself), so rotated houses work the same as the road.

const colliders = []; // { cx, cz, c, s, hx, hz, y0, y1 }
const floors = []; // { cx, cz, c, s, hx, hz, h: number | (lx, lz) => number }

function toLocal(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  return [o.c * dx - o.s * dz, o.s * dx + o.c * dz];
}

function collide(pos, feetY) {
  for (let pass = 0; pass < 2; pass++) {
    for (const o of colliders) {
      if (!(feetY < o.y1 && feetY + 1.7 > o.y0)) continue;
      if (Math.abs(pos.x - o.cx) > o.r + RADIUS || Math.abs(pos.z - o.cz) > o.r + RADIUS) continue;
      const [lx, lz] = toLocal(o, pos.x, pos.z);
      if (Math.abs(lx) > o.hx + RADIUS || Math.abs(lz) > o.hz + RADIUS) continue;
      const qx = THREE.MathUtils.clamp(lx, -o.hx, o.hx);
      const qz = THREE.MathUtils.clamp(lz, -o.hz, o.hz);
      const dx = lx - qx, dz = lz - qz;
      const d = Math.hypot(dx, dz);
      let px, pz;
      if (d > 1e-6) {
        if (d >= RADIUS) continue;
        px = (dx / d) * (RADIUS - d);
        pz = (dz / d) * (RADIUS - d);
      } else {
        // Center is inside the box: leave by the nearest side.
        const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
        if (ex < ez) { px = Math.sign(lx || 1) * (ex + RADIUS); pz = 0; } else { px = 0; pz = Math.sign(lz || 1) * (ez + RADIUS); }
      }
      pos.x += o.c * px + o.s * pz;
      pos.z += -o.s * px + o.c * pz;
    }
  }
}

function floorAt(x, z, feetY) {
  let best = 0;
  for (const f of floors) {
    const [lx, lz] = toLocal(f, x, z);
    if (Math.abs(lx) > f.hx || Math.abs(lz) > f.hz) continue;
    const h = typeof f.h === 'function' ? f.h(lx, lz) : f.h;
    if (h <= feetY + STEP && h > best) best = h;
  }
  return best;
}

// A place is a group with its own position and rotation; everything added to it is
// placed in local coordinates, and its colliders and floors follow its transform.
class Place {
  constructor(x, z, rot = 0, parent = scene) {
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    this.group.rotation.y = rot;
    parent.add(this.group);
    this.x = x; this.z = z; this.rot = rot;
    this.c = Math.cos(rot); this.s = Math.sin(rot);
  }
  world(lx, lz) {
    return [this.x + this.c * lx + this.s * lz, this.z - this.s * lx + this.c * lz];
  }
  frame(lx, lz, hx, hz) {
    const [cx, cz] = this.world(lx, lz);
    return { cx, cz, c: this.c, s: this.s, hx, hz, r: Math.hypot(hx, hz) };
  }
  collider(lx, lz, hx, hz, y0 = 0, y1 = 3) {
    colliders.push({ ...this.frame(lx, lz, hx, hz), y0, y1 });
  }
  floor(lx, lz, hx, hz, h) {
    floors.push({ ...this.frame(lx, lz, hx, hz), h });
  }
  add(obj, x = 0, y = 0, z = 0, ry = 0) {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    this.group.add(obj);
    return obj;
  }
  // Box by size and center. opts.collide adds a matching collider; opts.localUV maps
  // textures in the box's own frame (for boxes that get rotated afterward).
  box(w, h, d, x, y, z, material, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (opts.localUV) planarUV(geo, 0, 0, 0, material); else planarUV(geo, x, y, z, material);
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    this.group.add(m);
    if (opts.collide) this.collider(x, z, w / 2, d / 2, y - h / 2, y + h / 2);
    return m;
  }
  // A wall along a local axis line, with door and window openings.
  // openings: [{ a0, a1, y0, y1, glass }] measured along the wall from its start.
  // out: +1 or -1, which side (along +Z for X walls, +X for Z walls) faces outdoors.
  wall(x0, z0, x1, z1, yBase, height, material, openings = [], { t = 0.2, outMat = null, out = 1, frame = M.trim, base = true } = {}) {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const dir = alongX ? Math.sign(x1 - x0) : Math.sign(z1 - z0);
    const mats = Array(6).fill(material);
    if (outMat) mats[alongX ? (out > 0 ? 4 : 5) : (out > 0 ? 0 : 1)] = outMat;
    const cuts = [...new Set([0, L, ...openings.flatMap((o) => [o.a0, o.a1])])].sort((a, b) => a - b);
    const at = (a) => [alongX ? x0 + dir * a : x0, alongX ? z0 : z0 + dir * a];
    const piece = (u, v, y0, y1) => {
      if (y1 - y0 < 0.01 || v - u < 0.01) return;
      const [cx, cz] = at((u + v) / 2);
      const w = alongX ? v - u : t, d = alongX ? t : v - u;
      this.box(w, y1 - y0, d, cx, yBase + (y0 + y1) / 2, cz, mats, { collide: true });
      // Baseboards on the indoor side(s)
      if (y0 === 0 && base) {
        for (const side of [-1, 1]) {
          if (outMat && side === out) continue;
          const off = side * (t / 2 + 0.008);
          this.box(alongX ? v - u : 0.016, 0.1, alongX ? 0.016 : v - u, cx + (alongX ? 0 : off), yBase + 0.05, cz + (alongX ? off : 0), M.trim, { shadow: false });
        }
      }
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const u = cuts[i], v = cuts[i + 1], mid = (u + v) / 2;
      const o = openings.find((op) => op.a0 <= mid && op.a1 >= mid);
      if (!o) { piece(u, v, 0, height); continue; }
      piece(u, v, 0, o.y0);
      piece(u, v, o.y1, height);
    }
    // Glass, frames and sills
    for (const o of openings) {
      const [cx, cz] = at((o.a0 + o.a1) / 2);
      const w = o.a1 - o.a0, hgt = o.y1 - o.y0, cy = yBase + (o.y0 + o.y1) / 2;
      const fw = 0.07, ft = t + 0.06;
      const bar = (lw, lh, ox, oy) => {
        const [bx, bz] = at((o.a0 + o.a1) / 2 + ox);
        this.box(alongX ? lw : ft, lh, alongX ? ft : lw, bx, cy + oy, bz, frame, { shadow: false });
      };
      bar(fw, hgt + fw * 2, -w / 2 - fw / 2, 0);
      bar(fw, hgt + fw * 2, w / 2 + fw / 2, 0);
      bar(w, fw, 0, hgt / 2 + fw / 2);
      if (o.glass) {
        bar(w, fw, 0, -hgt / 2 - fw / 2);
        // Muntins: one vertical and one horizontal bar
        bar(0.035, hgt, 0, 0);
        bar(w, 0.035, 0, hgt * 0.1);
        const g = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), glass);
        g.position.set(cx, cy, cz);
        if (!alongX) g.rotation.y = Math.PI / 2;
        this.group.add(g);
        this.collider(cx, cz, alongX ? w / 2 : t / 2, alongX ? t / 2 : w / 2, yBase + o.y0, yBase + o.y1);
        // Sill on the outside
        const [sx, sz] = at((o.a0 + o.a1) / 2);
        const off = (t / 2 + 0.06) * out;
        this.box(alongX ? w + 0.2 : 0.14, 0.05, alongX ? 0.14 : w + 0.2, sx + (alongX ? 0 : off), yBase + o.y0 - 0.03, sz + (alongX ? off : 0), frame, { shadow: false });
      }
    }
  }
  // Floor slab with a walkable top
  slab(x0, x1, z0, z1, top, thick, topMat, underMat = paint(0xf4f1ea), walk = true) {
    const mats = [underMat, underMat, topMat, underMat, underMat, underMat];
    this.box(x1 - x0, thick, z1 - z0, (x0 + x1) / 2, top - thick / 2, (z0 + z1) / 2, mats, { shadow: true });
    if (walk) this.floor((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, top);
  }
}

const world = new Place(0, 0, 0);

// ---------------------------------------------------------------------------
// Models (CC0 / CC-BY glTF, meshopt-compressed; see assets/CREDITS.md)

const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();
function model(name) {
  if (!modelCache.has(name)) {
    modelCache.set(name, new Promise((resolve) => gltf.load(MODELS + name + '.glb', (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // Transmission needs an extra render pass; plain transparency looks the same here.
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.45; }
          // Compression dropped unused second UV sets; point any map that wanted one at the first.
          for (const k in m) if (m[k]?.isTexture && m[k].channel > 0 && !o.geometry.attributes['uv' + m[k].channel]) m[k].channel = 0;
        }
      });
      resolve(g.scene);
    }, undefined, () => resolve(null))));
  }
  return modelCache.get(name);
}
// Place a copy of a model in a place. Returns a group that fills in when it loads.
function placeModel(place, name, x, y, z, ry = 0, s = 1, tweak) {
  const holder = new THREE.Group();
  place.add(holder, x, y, z, ry);
  holder.scale.setScalar(s);
  model(name).then((root) => {
    if (!root) return;
    const o = root.clone(true);
    if (tweak) tweak(o);
    holder.add(o);
  });
  return holder;
}

// ---------------------------------------------------------------------------
// Interactive things: screens, phones, people and floating icons

const icons = []; // sprites

function tag(obj, project, shot) {
  obj.traverse((o) => { o.userData.project = project; if (shot) o.userData.shot = shot; });
  return obj;
}

function iconSprite(p) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12,12,14,0.86)';
  g.beginPath(); g.roundRect(6, 6, 500, 148, 74); g.fill();
  g.lineWidth = 6; g.strokeStyle = p.accent; g.stroke();
  g.fillStyle = p.accent;
  g.beginPath(); g.arc(80, 80, 56, 0, Math.PI * 2); g.fill();
  g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(p.icon, 80, 86);
  g.fillStyle = '#fff'; g.textAlign = 'left';
  let size = 54;
  do { g.font = `700 ${size}px "Space Grotesk", Inter, sans-serif`; size -= 2; } while (g.measureText(p.name).width > 340);
  g.fillText(p.name, 152, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false, fog: false }));
  s.scale.set(1.6, 0.5, 1);
  s.renderOrder = 10;
  return s;
}

function addIcon(projectId, x, y, z) {
  const p = projectById(projectId);
  const s = iconSprite(p);
  s.position.set(x, y, z);
  s.userData = { project: projectId, baseY: y, phase: rand() * 6 };
  scene.add(s);
  icons.push(s);
}

// Monitor with its screen centered at local (0, standH + h/2, 0), facing +Z.
function monitor(w, h, file, standH = 0.12) {
  const g = new THREE.Group();
  const bez = new THREE.Mesh(new THREE.BoxGeometry(w + 0.024, h + 0.024, 0.03), mat(0x111214, { roughness: 0.4 }));
  bez.position.y = standH + h / 2;
  bez.castShadow = true;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(file));
  scr.position.set(0, standH + h / 2, 0.016);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, standH, 0.04), mat(0x222326, { metalness: 0.5, roughness: 0.4 }));
  neck.position.set(0, standH / 2, -0.03);
  const base = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.3, w * 0.6), 0.015, 0.18), mat(0x222326, { metalness: 0.5, roughness: 0.4 }));
  base.position.set(0, 0.008, -0.02);
  g.add(bez, scr, neck, base);
  g.userData.screen = scr;
  // A little light spilling from the screen
  const glow = new THREE.PointLight(0x9fc4ff, 0.6, 2.2, 2);
  glow.position.set(0, standH + h / 2, 0.4);
  g.add(glow);
  return g;
}

function laptop(file) {
  const g = new THREE.Group();
  const alu = mat(0xb8bcc2, { metalness: 0.7, roughness: 0.35 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), alu);
  base.position.y = 0.01;
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.1), mat(0x222222));
  keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.021, -0.03);
  const lid = new THREE.Group();
  lid.position.set(0, 0.02, -0.12);
  lid.rotation.x = -0.28;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.012), alu);
  back.position.y = 0.115;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.195), screenMat(file));
  scr.position.set(0, 0.118, 0.007);
  lid.add(back, scr);
  g.add(base, keys, lid);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// A phone, screen facing +Z. Slightly larger than life so it reads from a step away.
function phone(file) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.2, 0.012), mat(0x151517, { roughness: 0.3 }));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.19), screenMat(file));
  scr.position.z = 0.0065;
  g.add(body, scr);
  return g;
}

// Capsule limb between two points.
function limb(a, b, r, material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86b45, 0x6e4329, 0xe8b894];
function cloth(color) { return mat(color, { roughness: 0.95 }); }
// A person, facing +Z, origin on the floor under them.
// pose: 'stand' | 'sit'. hands: 'phone' | 'desk' | 'side' | 'lap'. s scales kids.
function person({ s = 1, pose = 'stand', hands = 'side', shirt = 0x3b82f6, pants = 0x2d3340, skin = SKIN[0], hair = 0x2b1d14, seatH = 0.48, handReach = 0.42, handY, longHair = false, build = 1 } = {}) {
  const g = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x * s, y * s, z * s);
  const mSkin = mat(skin, { roughness: 0.6 }), mShirt = cloth(shirt), mPants = cloth(pants), mHair = mat(hair, { roughness: 0.75 }), mShoe = mat(0x1d1d1f, { roughness: 0.5 });
  let hipY, shoulderY, headY;
  if (pose === 'stand') {
    hipY = 0.92; shoulderY = 1.42; headY = 1.6;
    for (const sx of [-0.1, 0.1]) {
      g.add(limb(V(sx, hipY, 0), V(sx * 0.9, 0.48, 0.01), 0.068 * s, mPants));
      g.add(limb(V(sx * 0.9, 0.48, 0.01), V(sx * 0.9, 0.1, 0.0), 0.055 * s, mPants));
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.048 * s, 0.16 * s, 4, 8), mShoe);
      shoe.rotation.x = Math.PI / 2;
      shoe.position.copy(V(sx * 0.9, 0.05, 0.05));
      g.add(shoe);
    }
  } else {
    const hy = seatH / s + 0.06;
    hipY = hy; shoulderY = hy + 0.5; headY = hy + 0.68;
    for (const sx of [-0.1, 0.1]) {
      g.add(limb(V(sx, hy, 0.02), V(sx, hy, 0.42), 0.072 * s, mPants));
      g.add(limb(V(sx, hy, 0.44), V(sx, 0.1, 0.5), 0.056 * s, mPants));
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.048 * s, 0.15 * s, 4, 8), mShoe);
      shoe.rotation.x = Math.PI / 2;
      shoe.position.copy(V(sx, 0.05, 0.56));
      g.add(shoe);
    }
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 * s * build, (shoulderY - hipY - 0.2) * s, 6, 14), mShirt);
  torso.scale.z = 0.68;
  torso.position.copy(V(0, (hipY + shoulderY) / 2, 0));
  torso.castShadow = true;
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.15 * s * build, 14, 10), mPants);
  hips.scale.set(1.05, 0.6, 0.75);
  hips.position.copy(V(0, hipY + 0.02, 0));
  const neck = limb(V(0, shoulderY - 0.02, 0), V(0, headY - 0.08, 0.005), 0.045 * s, mSkin);
  g.add(torso, hips, neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105 * s, 20, 16), mSkin);
  head.scale.set(0.92, 1.12, 1);
  head.position.copy(V(0, headY, 0.01));
  head.castShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016 * s, 0.04 * s, 8), mSkin);
  nose.rotation.x = Math.PI / 2; nose.position.copy(V(0, headY - 0.01, 0.115));
  const ears = [-1, 1].map((sx) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022 * s, 8, 6), mSkin); e.scale.set(0.5, 1, 0.8); e.position.copy(V(sx * 0.097, headY, 0.0)); return e; });
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.114 * s, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), mHair);
  hairM.scale.set(0.95, 1.12, 1.04);
  hairM.position.copy(V(0, headY + 0.012, -0.008));
  hairM.rotation.x = -0.3;
  g.add(head, nose, ...ears, hairM);
  if (longHair) {
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * s, 0.18 * s, 4, 10), mHair);
    back.scale.z = 0.55;
    back.position.copy(V(0, headY - 0.12, -0.07));
    g.add(back);
  }

  // Arms: shoulder → elbow → hand
  const hand = {
    phone: (sx) => V(sx * 0.35, shoulderY - 0.3, 0.3),
    desk: (sx) => V(sx * 0.9, handY != null ? handY / s : shoulderY - 0.33, handReach / s),
    side: (sx) => V(sx * 1.05, shoulderY - 0.62, 0.02),
    lap: (sx) => V(sx * 0.5, hipY + 0.06, 0.3),
  }[hands];
  for (const sx of [-0.2, 0.2]) {
    const sh = V(sx * 1.05 * build, shoulderY - 0.04, 0);
    const hd = hand(sx);
    const el = sh.clone().lerp(hd, 0.5);
    el.y -= 0.08 * s;
    el.x += Math.sign(sx) * 0.05 * s;
    if (hands === 'side') el.copy(sh).lerp(hd, 0.5);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s, 10, 8), mSkin);
    palm.scale.set(0.8, 1, 0.55);
    palm.position.copy(hd);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 10, 8), mShirt);
    shoulder.position.copy(sh);
    g.add(limb(sh, el, 0.052 * s, mShirt), limb(el, hd, 0.042 * s, mSkin), palm, shoulder);
  }
  g.userData.head = V(0, headY, 0.01);
  g.userData.hands = hand(0);
  return g;
}

// Put a phone in a person's hands, screen tilted up toward their face.
function givePhone(p, file) {
  const ph = phone(file);
  const at = p.userData.hands.clone();
  ph.position.copy(at);
  ph.lookAt(p.userData.head.clone().add(new THREE.Vector3(0, 0.25, 0.25)));
  p.add(ph);
  return ph;
}

// ---------------------------------------------------------------------------
// Furniture (procedural)

function group(...children) { const g = new THREE.Group(); g.add(...children); g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; }); return g; }
function mesh(geo, material, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return m; }
function bx(w, h, d, material, x, y, z) { const geo = new THREE.BoxGeometry(w, h, d); planarUV(geo, 0, 0, 0, material); return mesh(geo, material, x, y, z); }

function officeChair(color = 0x2c2f36) {
  const m = cloth(color);
  const seat = bx(0.48, 0.08, 0.46, m, 0, 0.47, 0);
  const back = bx(0.46, 0.56, 0.07, m, 0, 0.8, -0.23);
  back.rotation.x = -0.08;
  const post = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4), M.steel, 0, 0.25, 0);
  const parts = [seat, back, post];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = bx(0.03, 0.03, 0.3, M.black, Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    const wheel = mesh(new THREE.SphereGeometry(0.03, 8, 6), M.black, Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29);
    parts.push(leg, wheel);
  }
  return group(...parts);
}

function diningChair(woodMat = M.darkWood) {
  const parts = [bx(0.44, 0.04, 0.42, woodMat, 0, 0.46, 0), bx(0.44, 0.06, 0.03, woodMat, 0, 0.88, -0.2), bx(0.44, 0.06, 0.03, woodMat, 0, 0.7, -0.2)];
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.18, 0.18]) parts.push(bx(0.04, sz < 0 ? 0.92 : 0.46, 0.04, woodMat, sx, sz < 0 ? 0.46 : 0.23, sz));
  return group(...parts);
}

function wheelchair() {
  const frame = mat(0x30343b, { metalness: 0.7, roughness: 0.3 });
  const parts = [bx(0.46, 0.07, 0.44, cloth(0x1f2933), 0, 0.48, 0), bx(0.46, 0.5, 0.05, cloth(0x1f2933), 0, 0.78, -0.23)];
  for (const sx of [-0.29, 0.29]) {
    const wheel = mesh(new THREE.TorusGeometry(0.3, 0.028, 10, 36), mat(0x1b1b1b, { roughness: 0.7 }), sx, 0.31, -0.08);
    wheel.rotation.y = Math.PI / 2;
    const rim = mesh(new THREE.TorusGeometry(0.27, 0.008, 6, 36), frame, sx * 1.08, 0.31, -0.08);
    rim.rotation.y = Math.PI / 2;
    for (let k = 0; k < 6; k++) {
      const sp = bx(0.006, 0.54, 0.006, M.steel, sx, 0.31, -0.08);
      sp.rotation.x = (k / 6) * Math.PI;
      parts.push(sp);
    }
    const caster = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14), M.black, sx * 0.8, 0.06, 0.32);
    caster.rotation.z = Math.PI / 2;
    parts.push(wheel, rim, caster, bx(0.03, 0.03, 0.5, frame, sx * 0.85, 0.66, 0.0), bx(0.03, 0.35, 0.03, frame, sx * 0.8, 0.3, 0.3));
  }
  // QuadStick mouthpiece on a gooseneck in front of the face
  parts.push(limb(new THREE.Vector3(0.27, 0.6, 0.15), new THREE.Vector3(0.12, 1.05, 0.32), 0.012, frame), bx(0.1, 0.05, 0.05, M.black, 0.04, 1.08, 0.3));
  return group(...parts);
}

function table(w, d, h = 0.75, top = M.wood, legs = M.darkWood) {
  const parts = [bx(w, 0.04, d, top, 0, h - 0.02, 0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(bx(0.05, h - 0.04, 0.05, legs, sx * (w / 2 - 0.06), (h - 0.04) / 2, sz * (d / 2 - 0.06)));
  return group(...parts);
}

function bed(w, l, blanket, frameMat = M.darkWood) {
  const parts = [
    bx(w + 0.08, 0.3, l + 0.06, frameMat, 0, 0.2, 0),
    bx(w, 0.22, l, mat(0xf3f1ec, { roughness: 0.95 }), 0, 0.46, 0),
    bx(w + 0.04, 0.06, l * 0.72, cloth(blanket), 0, 0.59, l * 0.14),
    bx(w + 0.08, 1.0, 0.06, frameMat, 0, 0.55, -l / 2 - 0.02),
  ];
  const fold = bx(w + 0.05, 0.07, 0.25, mat(0xffffff, { roughness: 0.95 }), 0, 0.6, -l / 2 + l * 0.28 + 0.1);
  parts.push(fold);
  const nP = w > 1.2 ? 2 : 1;
  for (let i = 0; i < nP; i++) {
    const p = mesh(new THREE.CapsuleGeometry(0.1, (w / nP) * 0.6, 4, 10), mat(0xffffff, { roughness: 0.95 }), nP === 1 ? 0 : (i - 0.5) * w * 0.5, 0.64, -l / 2 + 0.25);
    p.rotation.z = Math.PI / 2; p.scale.z = 0.6;
    parts.push(p);
  }
  return group(...parts);
}

function nightstand(m = M.darkWood) {
  return group(bx(0.48, 0.55, 0.4, m, 0, 0.275, 0), bx(0.4, 0.02, 0.01, M.steel, 0, 0.42, 0.205));
}

function dresser(w = 1.3, m = M.wood) {
  const parts = [bx(w, 0.85, 0.5, m, 0, 0.425, 0)];
  for (let r = 0; r < 3; r++) {
    parts.push(bx(w - 0.06, 0.005, 0.01, M.darkTrim, 0, 0.3 + r * 0.25, 0.252));
    for (const sx of [-w / 4, w / 4]) parts.push(bx(0.12, 0.02, 0.02, M.steel, sx, 0.18 + r * 0.25, 0.26));
  }
  return group(...parts);
}

const BOOK = [0x8c2f2f, 0x2f4f8c, 0x2f7a4f, 0xd8c39a, 0x553c7a, 0xb36a2e, 0x1d1d1d, 0xe6e1d3];
function bookshelf(w = 1.2, h = 1.9) {
  const m = M.darkWood;
  const parts = [bx(w, h, 0.04, m, 0, h / 2, -0.16), bx(0.03, h, 0.34, m, -w / 2, h / 2, 0), bx(0.03, h, 0.34, m, w / 2, h / 2, 0)];
  const shelves = 5;
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + (i * (h - 0.08)) / shelves;
    parts.push(bx(w, 0.03, 0.34, m, 0, y, 0));
    if (i === shelves) break;
    let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.08) {
      const bw = R(0.025, 0.05), bh = R(0.2, 0.3);
      if (rand() < 0.12) { x += 0.08; continue; }
      parts.push(bx(bw, bh, R(0.17, 0.24), mat(BOOK[Math.floor(rand() * BOOK.length)], { roughness: 0.8 }), x + bw / 2, y + 0.015 + bh / 2, 0.02));
      x += bw + 0.003;
    }
  }
  return group(...parts);
}

function rug(w, d, colors) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round((512 * d) / w);
  const g = c.getContext('2d');
  g.fillStyle = colors[0]; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = colors[1]; g.lineWidth = 18; g.strokeRect(24, 24, c.width - 48, c.height - 48);
  g.lineWidth = 6; g.strokeStyle = colors[2]; g.strokeRect(54, 54, c.width - 108, c.height - 108);
  g.fillStyle = colors[1];
  for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(c.width / 2, c.height / 2, 30 + i * 30, 20 + i * 18, 0, 0, Math.PI * 2); g.globalAlpha = 0.25; g.fill(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1, normalMap: ptex('carpet_nrm.jpg', false) }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  const holder = new THREE.Group(); holder.add(m); m.position.y = 0.008;
  return holder;
}

function poster(file, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex(file), roughness: 0.6 }));
  const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.02), M.black);
  f.position.z = -0.012;
  return group(m, f);
}

function floorLamp() {
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.3, 24, 1, true), mat(0xf3e6cc, { roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.6 }));
  shade.position.y = 1.5;
  return group(mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 20), M.black, 0, 0.015, 0), mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 8), M.black, 0, 0.72, 0), shade);
}

function tvScreen(w = 1.4) {
  const h = (w * 9) / 16;
  return group(bx(w, h, 0.04, M.black, 0, 0, 0), mesh(new THREE.PlaneGeometry(w - 0.03, h - 0.03), mat(0x05070a, { roughness: 0.08, metalness: 0.2 }), 0, 0, 0.021));
}

function fireplace() {
  const parts = [bx(1.9, 1.2, 0.5, M.stone, 0, 0.6, 0), bx(2.1, 0.08, 0.6, M.darkWood, 0, 1.24, 0.03), bx(1.0, 0.7, 0.05, M.black, 0, 0.45, 0.24)];
  const fire = new THREE.PointLight(0xff8a3a, 1.2, 4, 2);
  fire.position.set(0, 0.4, 0.6);
  const glow = mesh(new THREE.PlaneGeometry(0.7, 0.35), mat(0xff7a2a, { emissive: 0xff6a1a, emissiveIntensity: 2 }), 0, 0.3, 0.27);
  const g = group(...parts, glow);
  g.add(fire);
  return g;
}

function counters(len, withSink = -1) {
  // Base cabinets + counter running along local X, fronts facing +Z
  const parts = [bx(len, 0.86, 0.6, M.white, 0, 0.43, 0), bx(len + 0.02, 0.04, 0.64, M.counter, 0, 0.88, 0.02)];
  const n = Math.round(len / 0.6);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    parts.push(bx(len / n - 0.01, 0.003, 0.003, M.darkTrim, x, 0.65, 0.302), bx(0.12, 0.015, 0.02, M.steel, x, 0.75, 0.31));
  }
  if (withSink >= 0) {
    parts.push(bx(0.6, 0.02, 0.42, M.steel, withSink, 0.895, 0.02), bx(0.03, 0.3, 0.03, M.steel, withSink, 1.05, -0.22));
    const spout = bx(0.025, 0.025, 0.2, M.steel, withSink, 1.19, -0.13);
    parts.push(spout);
  }
  return group(...parts);
}

function upperCabinets(len) {
  const parts = [bx(len, 0.7, 0.34, M.white, 0, 0, 0)];
  const n = Math.round(len / 0.6);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    parts.push(bx(len / n - 0.012, 0.66, 0.004, mat(0xe9e6df, { roughness: 0.4 }), x, 0, 0.172), bx(0.015, 0.12, 0.02, M.steel, x + len / n / 2 - 0.08, -0.22, 0.18));
  }
  return group(...parts);
}

function fridge() {
  return group(bx(0.85, 1.85, 0.72, M.steel, 0, 0.925, 0), bx(0.84, 0.006, 0.01, M.black, 0, 1.25, 0.362), bx(0.025, 0.5, 0.04, M.black, 0.36, 1.55, 0.38), bx(0.025, 0.5, 0.04, M.black, 0.36, 0.8, 0.38));
}

function range() {
  const parts = [bx(0.76, 0.9, 0.62, M.steel, 0, 0.45, 0), bx(0.76, 0.02, 0.62, M.black, 0, 0.91, 0), bx(0.6, 0.35, 0.01, mat(0x111111, { roughness: 0.1 }), 0, 0.5, 0.311)];
  for (const sx of [-0.18, 0.18]) for (const sz of [-0.15, 0.13]) parts.push(mesh(new THREE.TorusGeometry(0.08, 0.01, 6, 20), M.black, sx, 0.925, sz));
  parts.forEach((p) => { if (p.geometry.type === 'TorusGeometry') p.rotation.x = Math.PI / 2; });
  return group(...parts);
}

function toilet() {
  const bowl = mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 20), M.white, 0, 0.2, 0.1);
  bowl.scale.z = 1.3;
  return group(bowl, bx(0.44, 0.4, 0.2, M.white, 0, 0.6, -0.15), bx(0.4, 0.03, 0.5, M.white, 0, 0.42, 0.08));
}

function vanity(w = 1.0) {
  const parts = [bx(w, 0.85, 0.5, M.darkWood, 0, 0.425, 0), bx(w + 0.02, 0.04, 0.52, M.white, 0, 0.87, 0), bx(0.4, 0.02, 0.3, mat(0xdedede, { roughness: 0.1 }), 0, 0.885, 0.02)];
  parts.push(bx(0.025, 0.2, 0.025, M.steel, 0, 0.99, -0.2));
  parts.push(bx(w * 0.8, 0.8, 0.02, mat(0xaab4bd, { metalness: 1, roughness: 0.02 }), 0, 1.65, -0.24));
  return group(...parts);
}

function bathtub() {
  const parts = [bx(0.8, 0.55, 1.7, M.white, 0, 0.275, 0), bx(0.6, 0.02, 1.5, mat(0xd8e4ea, { roughness: 0.1 }), 0, 0.5, 0)];
  return group(...parts);
}

function plant(place, x, y, z, s = 1, ry = 0) {
  return placeModel(place, 'DiffuseTransmissionPlant', x, y, z, ry, s);
}

// ---------------------------------------------------------------------------
// Ground, road and paths

function ribbon(pts, o0, o1, y, material, uvScale = [4, 4], fade = true) {
  const pos = [], uv = [], col = [], idx = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    for (const o of [o0, o1]) {
      const x = p[0] + nx * o, z = p[1] + nz * o;
      pos.push(x, y, z);
      uv.push(o / uvScale[0], s / uvScale[1]);
      const f = fade ? voidFade(x, z) : 1;
      col.push(f, f, f);
    }
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.setIndex(idx); geo.computeVertexNormals();
  }
  const m = material.clone();
  m.vertexColors = true;
  m.polygonOffset = true; m.polygonOffsetFactor = -1 - y * 100; m.polygonOffsetUnits = -1;
  const msh = new THREE.Mesh(geo, m);
  msh.receiveShadow = true;
  scene.add(msh);
  return msh;
}

// 1 inside the world, falling to 0 at its ragged edge
function voidFade(x, z) {
  const d = Math.hypot(x / WORLD_R.x, z / WORLD_R.z) + (noise2(x * 0.05, z * 0.05) - 0.5) * 0.12;
  return THREE.MathUtils.clamp((1 - d) / 0.22, 0, 1);
}

const roadPts = [];
for (let x = ROAD_X[0]; x <= ROAD_X[1]; x += 1) roadPts.push([x, roadZ(x)]);
function polyline(points, step = 0.8) {
  // Resample a polyline at an even spacing
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx2, bz] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx2 - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

function buildGround() {
  const W = 220, D = 200, segX = 110, segZ = 100;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -5);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.setXY(i, x / 3.5, z / 3.5);
    const n = 0.72 + 0.4 * noise2(x * 0.06, z * 0.06) + 0.15 * noise2(x * 0.2 + 7, z * 0.2);
    const f = voidFade(x, z) * n;
    col.push(f, f * 0.98, f * 0.95);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.MeshStandardMaterial({ map: ptex('floor_col.jpg'), normalMap: ptex('floor_nrm.jpg', false), roughness: 1, vertexColors: true });
  const ground = new THREE.Mesh(geo, m);
  ground.receiveShadow = true;
  scene.add(ground);

  // Asphalt, gravel shoulders and paint
  const gravelM = M.gravel.clone(); gravelM.color.set(0xb0a898);
  ribbon(roadPts, -RW - SHOULDER, -RW + 0.05, 0.012, gravelM, [1.6, 1.6]);
  ribbon(roadPts, RW - 0.05, RW + SHOULDER, 0.012, gravelM, [1.6, 1.6]);
  ribbon(roadPts, -RW, RW, 0.02, M.asphalt, [5, 5]);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd9a92a, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7 });
  ribbon(roadPts, -0.18, -0.07, 0.025, yellow, [1, 1]);
  ribbon(roadPts, 0.07, 0.18, 0.025, yellow, [1, 1]);
  ribbon(roadPts, -RW + 0.15, -RW + 0.27, 0.025, white, [1, 1]);
  ribbon(roadPts, RW - 0.27, RW - 0.15, 0.025, white, [1, 1]);
}

// ---------------------------------------------------------------------------
// Redwoods
//
// Each variant is one trunk geometry (flared, buttressed, with world-scaled bark)
// and one crown of flat foliage sprays, drawn as instanced meshes.

function trunkGeo(H, Rb) {
  const segs = 30, ph1 = R(0, 6), ph2 = R(0, 6), ph3 = R(0, 6);
  const ys = [-0.4, 0, 0.12, 0.3, 0.55, 0.9, 1.4, 2.0, 2.8, 3.8, 5, 6.5, 8.5, 11, 14];
  for (let y = 18; y < H; y += 5) ys.push(y);
  ys.push(H);
  const uRep = Math.max(1, Math.round((2 * Math.PI * Rb) / 1.2));
  const pos = [], uv = [], idx = [];
  ys.forEach((y, r) => {
    const t = Math.max(0, y) / H;
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const base = Rb * (1 - 0.86 * Math.pow(t, 0.85));
      const flare = Rb * 0.7 * Math.exp(-Math.max(0, y) / 1.4);
      const butt = Rb * 0.45 * Math.exp(-Math.max(0, y) / 2.2) * Math.pow(0.5 + 0.5 * Math.sin(5 * th + ph1), 3);
      const fluting = Rb * (0.05 * Math.sin(13 * th + ph2) + 0.03 * Math.sin(7 * th + y * 0.4 + ph3)) * (1 - t);
      const rr = y >= H ? 0.02 : base + flare + butt + fluting;
      pos.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      uv.push((j / segs) * uRep, y / 2.4);
    }
    if (r > 0) {
      const a = (r - 1) * (segs + 1), b = r * (segs + 1);
      for (let j = 0; j < segs; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function crownGeo(H, Rb, start, crownR, density = 1) {
  const pos = [], nrm = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const card = (base, dir, L, W, roll) => {
    // dir: unit vector outward (with droop); width axis perpendicular to dir, rolled around it
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    const w = side.clone().applyAxisAngle(dir, roll).multiplyScalar(W / 2);
    const tip = base.clone().addScaledVector(dir, L);
    const n = new THREE.Vector3().crossVectors(dir, w).normalize();
    if (n.y < 0) n.negate();
    n.lerp(up, 0.5).normalize();
    const k = pos.length / 3;
    for (const [p, u, v] of [[base.clone().sub(w), 0, 0], [base.clone().add(w), 1, 0], [tip.clone().sub(w), 0, 1], [tip.clone().add(w), 1, 1]]) {
      pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); uv.push(u, v);
    }
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  };
  const dy = Math.max(0.6, (H - start) / 34) / density;
  for (let y = start; y < H - 0.5; y += dy * R(0.7, 1.3)) {
    const t = (y - start) / (H - start);
    const cr = crownR * Math.pow(1 - t, 0.75) * (t < 0.12 ? 0.55 + t * 3.7 : 1) + 0.6;
    const rt = Rb * (1 - 0.86 * Math.pow(y / H, 0.85));
    const n = Math.max(2, Math.round((2 + cr * 0.9) * density));
    for (let k = 0; k < n; k++) {
      const a = R(0, Math.PI * 2);
      const droop = R(-0.05, 0.45);
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(droop), -Math.sin(droop), Math.sin(a) * Math.cos(droop));
      const base = new THREE.Vector3(Math.cos(a) * rt * 0.8, y, Math.sin(a) * rt * 0.8);
      const L = cr * R(0.75, 1.15);
      card(base, dir, L, L * R(0.6, 0.8), Math.PI / 2 + R(-0.5, 0.5));
      if (rand() < 0.5) card(base.clone().addScaledVector(dir, L * 0.35), dir.clone().applyAxisAngle(up, R(-0.6, 0.6)), L * 0.6, L * 0.45, Math.PI / 2 + R(-0.7, 0.7));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

const leafMat = new THREE.MeshStandardMaterial({ map: ptex('spray.png'), alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, color: 0xd6e6c4 });
leafMat.map.wrapS = leafMat.map.wrapT = THREE.ClampToEdgeWrapping;

const TREE_KINDS = [
  { H: 78, Rb: 2.2, start: 30, crown: 7.5 },
  { H: 64, Rb: 1.6, start: 24, crown: 6.2 },
  { H: 50, Rb: 1.1, start: 17, crown: 5.0 },
  { H: 22, Rb: 0.38, start: 4.5, crown: 2.8 },
];

const trees = []; // { x, z, kind, s, rot }
function clearOf(x, z, r) {
  if (Math.abs(z - roadZ(x)) < RW + SHOULDER + 1.2 + r) return false;
  for (const c of CLEARINGS) {
    const dx = (x - c.x) / (c.rx + r), dz = (z - c.z) / (c.rz + r);
    if (dx * dx + dz * dz < 1) return false;
  }
  for (const p of PATHS) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1], [bx2, bz] = p.pts[i];
      const vx = bx2 - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      const t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
      if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < p.w + r + 1) return false;
    }
  }
  if (voidFade(x, z) < 0.05) return false;
  for (const t of trees) {
    const k = TREE_KINDS[t.kind];
    if (Math.hypot(x - t.x, z - t.z) < (k.Rb * t.s + r) * 1.8 + 0.6) return false;
  }
  return true;
}

function plantForest() {
  // Fairy rings: old trees surrounded by younger ones, plus solitary giants
  for (let c = 0; c < 260; c++) {
    const x = R(-WORLD_R.x, WORLD_R.x), z = R(-WORLD_R.z - 8, WORLD_R.z - 8);
    const big = rand() < 0.55 ? 0 : 1;
    const s = R(0.85, 1.2);
    if (!clearOf(x, z, TREE_KINDS[big].Rb * s)) continue;
    trees.push({ x, z, kind: big, s, rot: R(0, 6.28) });
    const n = Math.floor(R(0, 5));
    for (let i = 0; i < n; i++) {
      const a = R(0, 6.28), d = TREE_KINDS[big].Rb * s * R(2.4, 3.6) + 1;
      const kind = rand() < 0.6 ? 2 : 1, s2 = R(0.75, 1.05);
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      if (clearOf(tx, tz, TREE_KINDS[kind].Rb * s2)) trees.push({ x: tx, z: tz, kind, s: s2, rot: R(0, 6.28) });
    }
  }
  // Young redwoods filling the gaps and edging the clearings
  for (let i = 0; i < 320; i++) {
    const x = R(-WORLD_R.x, WORLD_R.x), z = R(-WORLD_R.z - 8, WORLD_R.z - 8);
    const s = R(0.6, 1.3);
    if (clearOf(x, z, TREE_KINDS[3].Rb * s)) trees.push({ x, z, kind: 3, s, rot: R(0, 6.28) });
  }

  TREE_KINDS.forEach((k, ki) => {
    const list = trees.filter((t) => t.kind === ki);
    if (!list.length) return;
    const tg = trunkGeo(k.H, k.Rb), cg = crownGeo(k.H, k.Rb, k.start, k.crown, ki === 3 ? 1.6 : 1);
    const trunks = new THREE.InstancedMesh(tg, M.bark, list.length);
    const crowns = new THREE.InstancedMesh(cg, leafMat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      sc.setScalar(t.s);
      p.set(t.x, 0, t.z);
      m4.compose(p, q, sc);
      trunks.setMatrixAt(i, m4);
      crowns.setMatrixAt(i, m4);
      if (Math.abs(t.x) < 75 && Math.abs(t.z) < 75) {
        const r = k.Rb * t.s * 0.95;
        colliders.push({ cx: t.x, cz: t.z, c: 1, s: 0, hx: r * 0.8, hz: r * 0.8, r: r * 1.2, y0: -1, y1: 99 });
      }
    });
    for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); }
  });
}

// Sword ferns: a dozen arched fronds per clump
function fernGeo() {
  const geos = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const L = R(0.75, 1.25), W = 0.26, segs = 6;
    const az = (i / n) * Math.PI * 2 + R(-0.2, 0.2);
    const elev = R(0.75, 1.25);
    const g = new THREE.PlaneGeometry(W, L, 1, segs);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + L / 2) / L; // 0 at base, 1 at tip
      const a = elev - t * 1.6; // arch over
      // integrate the arc approximately
      const s = t * L;
      const y = Math.sin(elev) * s - 0.55 * s * s * 0.9;
      const r = Math.cos(elev) * s + 0.25 * s * s;
      pos.setXYZ(v, pos.getX(v) * (1 - t * 0.3), Math.max(0.02, y), r + 0.05);
      void a;
    }
    g.rotateY(az);
    g.computeVertexNormals();
    geos.push(g);
  }
  const geo = mergeGeometries(geos);
  const nr = geo.attributes.normal;
  for (let i = 0; i < nr.count; i++) { const v = new THREE.Vector3(nr.getX(i), Math.abs(nr.getY(i)) + 0.8, nr.getZ(i)).normalize(); nr.setXYZ(i, v.x, v.y, v.z); }
  return geo;
}

function plantUndergrowth() {
  const fm = new THREE.MeshStandardMaterial({ map: ptex('fern.png'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: 0xc8dcae });
  fm.map.wrapS = fm.map.wrapT = THREE.ClampToEdgeWrapping;
  const spots = [];
  for (let i = 0; i < 2600 && spots.length < 1100; i++) {
    let x, z;
    if (rand() < 0.55 && trees.length) {
      const t = trees[Math.floor(rand() * trees.length)];
      const a = R(0, 6.28), d = TREE_KINDS[t.kind].Rb * t.s * 1.6 + R(0.8, 6);
      x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d;
    } else { x = R(-WORLD_R.x, WORLD_R.x); z = R(-WORLD_R.z, WORLD_R.z); }
    if (Math.abs(z - roadZ(x)) < RW + SHOULDER + 0.8) continue;
    if (CLEARINGS.some((c) => ((x - c.x) / (c.rx - 2)) ** 2 + ((z - c.z) / (c.rz - 2)) ** 2 < 1)) continue;
    if (PATHS.some((p) => p.pts.some(([px, pz]) => Math.hypot(x - px, z - pz) < p.w + 0.8))) continue;
    if (voidFade(x, z) < 0.1) continue;
    spots.push([x, z]);
  }
  const im = new THREE.InstancedMesh(fernGeo(), fm, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R(0, 6.28));
    sc.setScalar(R(0.7, 1.35));
    p.set(x, 0, z);
    m4.compose(p, q, sc);
    im.setMatrixAt(i, m4);
  });
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
  scene.add(im);
}

function fallenLog(x, z, rot, len, r) {
  const p = new Place(x, z, rot);
  const geo = scaleUV(new THREE.CylinderGeometry(r * 0.9, r, len, 24, 6, false), Math.round((2 * Math.PI * r) / 1.2), len / 2.4);
  // Sag and lumps
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 + 0.06 * Math.sin(pos.getY(i) * 1.3 + pos.getZ(i) * 4)));
  geo.computeVertexNormals();
  const log = new THREE.Mesh(geo, M.bark);
  log.rotation.z = Math.PI / 2;
  log.position.y = r * 0.8;
  log.castShadow = log.receiveShadow = true;
  p.group.add(log);
  // Moss along the top
  const moss = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 1.02, len * 0.9, 18, 1, true, -0.9, 1.8), mat(0x4f6b2c, { roughness: 1 }));
  moss.rotation.z = Math.PI / 2; moss.rotation.y = 0; moss.position.y = r * 0.8 + 0.01;
  moss.rotation.x = -Math.PI / 2;
  p.group.add(moss);
  p.collider(0, 0, len / 2, r, 0, r * 1.7);
}

function stump(x, z, r) {
  const p = new Place(x, z, R(0, 6));
  const h = R(0.6, 1.6);
  const geo = scaleUV(new THREE.CylinderGeometry(r * 0.95, r * 1.25, h, 24, 2, true), Math.round((2 * Math.PI * r) / 1.2), h / 2.4);
  const side = new THREE.Mesh(geo, M.bark);
  side.position.y = h / 2;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6b3d26'; g.fillRect(0, 0, 256, 256);
  for (let i = 60; i > 0; i--) { g.strokeStyle = i % 2 ? 'rgba(40,20,12,0.5)' : 'rgba(150,90,60,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(128 + Math.sin(i) * 2, 128, i * 2.1, 0, Math.PI * 2); g.stroke(); }
  const tt = new THREE.CanvasTexture(c); tt.colorSpace = THREE.SRGBColorSpace;
  const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24), new THREE.MeshStandardMaterial({ map: tt, roughness: 0.9 }));
  top.rotation.x = -Math.PI / 2; top.position.y = h;
  side.castShadow = top.receiveShadow = side.receiveShadow = true;
  p.group.add(side, top);
  p.collider(0, 0, r, r, 0, h);
}

// Shafts of sunlight slanting down through the canopy
function lightShafts() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const gv = g.createLinearGradient(0, 0, 0, 256);
  gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(0.3, 'rgba(0,0,0,1)'); gv.addColorStop(0.85, 'rgba(0,0,0,0.7)'); gv.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gv; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.MeshBasicMaterial({ map: t, color: 0xffe9c4, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const len = 42;
  for (let i = 0; i < 14; i++) {
    const x = R(-45, 45), z = R(-55, 35);
    if (CLEARINGS.some((c) => ((x - c.x) / c.rx) ** 2 + ((z - c.z) / c.rz) ** 2 < 1)) continue;
    const w = R(1.5, 5);
    const geo = new THREE.PlaneGeometry(w, len);
    for (const rot of [0, Math.PI / 2]) {
      const s = new THREE.Mesh(geo, m);
      // Point the long axis along the sun direction, ending at the ground
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN_DIR);
      s.rotateY(rot);
      s.position.set(x, 0, z).addScaledVector(SUN_DIR, len / 2 - 2);
      s.renderOrder = 5;
      scene.add(s);
    }
  }
}

// ---------------------------------------------------------------------------
// Street furniture

function hydrant(x, z) {
  const p = new Place(x, z);
  const red = mat(0xb5241f, { roughness: 0.45, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 20), red);
  body.position.y = 0.3;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20), red);
  ring.position.y = 0.06;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), red);
  cap.position.y = 0.6;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 6), mat(0xb8b8b0, { metalness: 0.6, roughness: 0.4 }));
  top.position.y = 0.76;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 12), red);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.y = 0.42;
  const front = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12), red);
  front.rotation.x = Math.PI / 2;
  front.position.set(0, 0.36, 0.14);
  p.group.add(body, ring, cap, top, nozzle, front);
  p.group.traverse((o) => (o.castShadow = true));
  p.collider(0, 0, 0.18, 0.18, 0, 0.8);
}

function mailbox(x, z, ry, name) {
  const p = new Place(x, z, ry);
  p.box(0.09, 1.1, 0.09, 0, 0.55, 0, M.darkWood, { collide: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.48, 20, 1, false, 0, Math.PI), mat(0x2b2f33, { metalness: 0.6, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2; body.rotation.z = Math.PI / 2;
  body.position.set(0, 1.12, 0);
  p.group.add(body);
  p.box(0.26, 0.14, 0.48, 0, 1.06, 0, mat(0x2b2f33, { metalness: 0.6, roughness: 0.4 }));
  p.box(0.02, 0.15, 0.04, 0.14, 1.25, -0.15, mat(0xc0302a));
  void name;
}

function busStop(x, z) {
  // Shelter facing south toward the road
  const p = new Place(x, z);
  const frame = mat(0x2f3338, { metalness: 0.6, roughness: 0.4 });
  p.slab(-3.6, 3.6, -1.6, 1.7, 0.12, 0.3, M.concrete);
  for (const fx of [-3, 3]) for (const fz of [-1.1, 1.0]) p.box(0.1, 2.6, 0.1, fx, 1.42, fz, frame, { collide: true });
  const roof = p.box(6.5, 0.12, 2.6, 0, 2.76, -0.05, mat(0x3a4a5c, { metalness: 0.3, roughness: 0.5 }));
  roof.rotation.x = -0.05;
  p.box(6.0, 0.1, 0.1, 0, 2.65, 1.0, frame);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), glass);
  back.position.set(0, 1.42, -1.1);
  p.group.add(back);
  p.collider(0, -1.1, 3, 0.06, 0, 2.6);
  for (const sx of [-3, 3]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), glass);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx, 1.42, -0.4);
    p.group.add(side);
    p.collider(sx, -0.4, 0.06, 0.7, 0, 2.6);
  }
  // Bench along the back
  p.box(4.4, 0.06, 0.45, -0.3, 0.57, -0.8, M.wood);
  p.box(4.4, 0.4, 0.06, -0.3, 0.87, -1.02, M.wood);
  for (const bx2 of [-2.3, -0.3, 1.7]) p.box(0.06, 0.45, 0.4, bx2, 0.34, -0.8, frame);
  p.collider(-0.3, -0.85, 2.2, 0.28, 0, 0.62);
  // Route map on the east end
  p.box(0.08, 1.3, 1.0, 3.06, 1.47, -0.4, mat(0x1d4ed8, { emissive: 0x0b2a80, emissiveIntensity: 0.3 }));
  // Bus stop sign by the road
  const sp = new Place(x + 4.3, z + 1.4);
  sp.box(0.07, 2.8, 0.07, 0, 1.4, 0, frame, { collide: true });
  const sign = document.createElement('canvas');
  sign.width = 256; sign.height = 320;
  const g = sign.getContext('2d');
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#fff'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center';
  g.fillText('BUS', 128, 120); g.font = 'bold 40px sans-serif'; g.fillText('STOP', 128, 180);
  g.font = '28px sans-serif'; g.fillText('Route 7', 128, 250); g.fillText('Redwood Hwy', 128, 290);
  const st = new THREE.CanvasTexture(sign); st.colorSpace = THREE.SRGBColorSpace;
  const signM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.02), [frame, frame, frame, frame, new THREE.MeshStandardMaterial({ map: st }), new THREE.MeshStandardMaterial({ map: st })]);
  signM.position.set(0, 2.5, 0);
  signM.castShadow = true;
  sp.group.add(signM);

  const Y = 0.12;
  // People waiting. A: on the bench playing Roadway Rivals against the son up at the house.
  const a = person({ pose: 'sit', hands: 'phone', shirt: 0x7c3aed, pants: 0x1f2937, skin: SKIN[2], hair: 0x111111, seatH: 0.6 });
  p.add(a, -1.6, Y - 0.12, -0.98, 0.15);
  tag(a, 'roadway-rivals', 'roadway-phone.jpg');
  tag(givePhone(a, 'roadway-phone.jpg'), 'roadway-rivals', 'roadway-phone.jpg');
  // B: standing, playing Bridge Defender
  const b = person({ hands: 'phone', shirt: 0xf97316, pants: 0x334155, skin: SKIN[0], hair: 0x8b5a2b, longHair: true });
  p.add(b, 0.9, Y, 0.15, -0.35);
  tag(b, 'bridge-defender', 'bridge-defender-gameplay.jpg');
  tag(givePhone(b, 'bridge-defender-gameplay.jpg'), 'bridge-defender', 'bridge-defender-gameplay.jpg');
  p.collider(0.9, 0.15, 0.25, 0.25, 0, 1.8);
  // C: waiting, looking down the road for the bus
  const cc = person({ shirt: 0x0f766e, pants: 0x3f3f46, skin: SKIN[3], hair: 0x1c1917 });
  p.add(cc, 2.3, Y, 0.4, Math.PI / 2 + 0.3);
  p.collider(2.3, 0.4, 0.25, 0.25, 0, 1.8);
  // D: on the bench, hands in lap
  const d = person({ pose: 'sit', hands: 'lap', shirt: 0xbe123c, pants: 0x44403c, skin: SKIN[1], hair: 0x9ca3af, seatH: 0.6 });
  p.add(d, -2.6, Y - 0.12, -0.98, -0.1);

  const [ix, iz] = p.world(-1.6, -0.8), [jx, jz] = p.world(0.9, 0.2);
  addIcon('roadway-rivals', ix, 3.5, iz);
  addIcon('bridge-defender', jx, 3.5, jz);
}

// ---------------------------------------------------------------------------
// Houses

const FL = 0.45; // ground floor height (porch level)
const LEVEL = 3.0;
const UP = FL + LEVEL;
const win = (a0, a1, y0 = 0.9, y1 = 2.3) => ({ a0, a1, y0, y1, glass: true });
const door = (a0, a1, y1 = 2.15) => ({ a0, a1, y0: 0, y1 });

// Gable roof over a rectangle, ridge along local X
function gableRoof(place, x0, x1, z0, z1, baseY, rise, overhang = 0.6, sidingMat = M.siding) {
  const w = x1 - x0 + overhang * 2, hd = (z1 - z0) / 2 + overhang, cz = (z0 + z1) / 2, cx = (x0 + x1) / 2;
  const slope = Math.atan2(rise, hd - overhang);
  const L = hd / Math.cos(slope);
  for (const side of [-1, 1]) {
    const m = place.box(w, 0.14, L, 0, 0, 0, [M.darkTrim, M.darkTrim, M.shingle, paint(0xd8d2c6), M.darkTrim, M.darkTrim], { localUV: true });
    m.rotation.x = side * slope;
    m.position.set(cx, baseY + rise - Math.tan(slope) * (hd / 2) + 0.08, cz + side * (hd / 2));
  }
  // Ridge cap
  place.box(w, 0.08, 0.3, cx, baseY + rise + 0.14, cz, M.darkTrim, { shadow: false });
  // Gable ends with siding
  for (const ex of [x0, x1]) {
    const shape = new THREE.Shape();
    shape.moveTo(z0, 0); shape.lineTo(z1, 0); shape.lineTo(cz, rise); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateY(Math.PI / 2);
    // ShapeGeometry in XY rotated so X -> -Z; rebuild positions explicitly
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const zz = -pos.getZ(i); pos.setXYZ(i, 0, pos.getY(i), zz); }
    geo.computeVertexNormals();
    planarUV(geo, ex, baseY, 0, sidingMat);
    const m = new THREE.Mesh(geo, sidingMat.clone());
    m.material.side = THREE.DoubleSide;
    m.position.set(ex, baseY, 0);
    m.castShadow = m.receiveShadow = true;
    place.group.add(m);
  }
}

// The family's house: dad, mom, son, daughter, grandma and grandpa
function familyHouse(x, z, rot) {
  const h = new Place(x, z, rot);
  const X0 = -8, X1 = 8, Z0 = -6, Z1 = 6;
  const T = 0.2, IT = 0.12;
  const ext = (lvl, xa, za, xb, zb, openings, out) => h.wall(xa, za, xb, zb, FL + lvl * LEVEL, LEVEL, paint(0xf1ede4), openings, { t: T, outMat: M.siding, out });

  // Foundation (stone), ground floor slab, upper floor slab with a stairwell, ceiling
  h.box(X1 - X0 + 0.3, FL, Z1 - Z0 + 0.3, 0, FL / 2, 0, M.stone, { shadow: false });
  h.floor(0, 0, (X1 - X0) / 2, (Z1 - Z0) / 2, FL);
  const sx0 = 1.35, sx1 = 2.4, sTop = -0.5, sBot = 4.5; // stairs, rising toward the back
  const upperSlab = (x0, x1, z0, z1, top) => h.slab(x0, x1, z0, z1, UP, 0.25, top);
  // Floors: ground (per room), upper (per room, with the stairwell left open)
  const gFloor = (x0, x1, z0, z1, m) => h.box(x1 - x0, 0.02, z1 - z0, (x0 + x1) / 2, FL + 0.01, (z0 + z1) / 2, m, { shadow: false });
  gFloor(X0 + 0.1, -1, 0, Z1 - 0.1, M.planks); // living
  gFloor(X0 + 0.1, -1, Z0 + 0.1, 0, M.tile); // kitchen
  gFloor(-1, 2.5, Z0 + 0.1, Z1 - 0.1, M.planks); // hall + bath
  gFloor(2.5, X1 - 0.1, 0, Z1 - 0.1, M.planks); // den
  gFloor(2.5, X1 - 0.1, Z0 + 0.1, 0, carpet(0xb9ab95)); // grandparents
  upperSlab(X0 + 0.1, -1, Z0 + 0.1, 0, carpet(0x5f7f9a)); // son
  upperSlab(X0 + 0.1, -1, 0, Z1 - 0.1, carpet(0xcfc4b2)); // parents
  upperSlab(-1, sx0, Z0 + 0.1, Z1 - 0.1, M.planks); // upstairs hall (west of the stairwell)
  upperSlab(sx0, 2.5, Z0 + 0.1, sTop, M.planks);
  upperSlab(sx0, 2.5, sBot, Z1 - 0.1, M.planks);
  upperSlab(2.5, X1 - 0.1, Z0 + 0.1, 0, carpet(0xc7a6b8)); // daughter
  upperSlab(2.5, X1 - 0.1, 0, Z1 - 0.1, M.tile); // bathroom
  h.box(X1 - X0 - 0.2, 0.12, Z1 - Z0 - 0.2, 0, UP + LEVEL - 0.06, 0, paint(0xf4f1ea), { shadow: false });

  // Exterior walls
  ext(0, X0, Z1, X1, Z1, [win(1, 3), win(4.4, 6.4), door(7.7, 8.8), win(11.2, 13), win(14, 15.4)], 1);
  ext(1, X0, Z1, X1, Z1, [win(1.5, 3.3, 1.0, 2.2), win(4.5, 6.3, 1.0, 2.2), win(8.2, 9.2, 1.1, 2.2), win(12.5, 13.7, 1.4, 2.2)], 1);
  ext(0, X0, Z0, X1, Z0, [win(2, 4, 1.15, 2.2), win(5, 6.6, 1.15, 2.2), win(8.4, 9.4, 1.5, 2.1), win(12, 14)], -1);
  ext(1, X0, Z0, X1, Z0, [win(5.2, 6.6, 1.0, 2.2), win(8.4, 9.6, 1.0, 2.2), win(10.9, 12.3, 1.0, 2.2)], -1);
  ext(0, X0, Z0, X0, Z1, [win(2, 3.6, 1.15, 2.2), win(7.5, 9.5)], -1);
  ext(1, X0, Z0, X0, Z1, [win(2, 3.6, 1.0, 2.2), win(8, 10, 1.0, 2.2)], -1);
  ext(0, X1, Z0, X1, Z1, [win(2, 3.6), win(10.4, 11.6)], 1);
  ext(1, X1, Z0, X1, Z1, [win(2, 3.6, 1.0, 2.2), win(9.5, 10.5, 1.4, 2.2)], 1);
  // Corner boards and the band between floors
  for (const [cx, cz] of [[X0, Z0], [X0, Z1], [X1, Z0], [X1, Z1]]) h.box(0.26, 2 * LEVEL, 0.26, cx, FL + LEVEL, cz, M.trim, { shadow: false });
  h.box(X1 - X0 + 0.3, 0.2, 0.06, 0, UP, Z1 + 0.12, M.trim, { shadow: false });
  h.box(X1 - X0 + 0.3, 0.2, 0.06, 0, UP, Z0 - 0.12, M.trim, { shadow: false });
  h.box(0.06, 0.2, Z1 - Z0 + 0.3, X0 - 0.12, UP, 0, M.trim, { shadow: false });
  h.box(0.06, 0.2, Z1 - Z0 + 0.3, X1 + 0.12, UP, 0, M.trim, { shadow: false });
  gableRoof(h, X0, X1, Z0, Z1, FL + 2 * LEVEL, 3.4, 0.6);
  // Chimney on the west end
  h.box(1.0, 9.6, 0.8, X0 - 0.5, 4.8, 3, M.stone, { collide: true });

  // Interior walls, ground floor
  const iw = (xa, za, xb, zb, lvl, openings, color = 0xf1ede4) => h.wall(xa, za, xb, zb, FL + lvl * LEVEL, LEVEL - 0.01, paint(color), openings, { t: IT });
  iw(X0, 0, -1, 0, 0, [{ a0: 2.2, a1: 5.4, y0: 0, y1: 2.4 }]); // living | kitchen, wide opening
  iw(-1, Z0, -1, Z1, 0, [door(2.6, 3.7), { a0: 7, a1: 10, y0: 0, y1: 2.4 }]); // kitchen/living | hall
  iw(2.5, Z0, 2.5, Z1, 0, [door(3.8, 5.0), door(6.7, 7.9)]); // hall | grandparents/den
  iw(2.5, 0, X1, 0, 0, []); // grandparents | den
  iw(-1, -3.5, 2.5, -3.5, 0, [door(0.4, 1.3)]); // bathroom
  // Upstairs
  iw(-1, Z0, -1, Z1, 1, [door(4.5, 5.5), door(7.0, 8.0)]); // son/parents | hall
  iw(2.5, Z0, 2.5, Z1, 1, [door(4.0, 5.0), door(10.9, 11.9)]); // hall | daughter/bath
  iw(X0, 0, -1, 0, 1, []);
  iw(2.5, 0, X1, 0, 1, []);

  // Stairs
  const steps = 16, run = (sBot - sTop) / steps, rise = LEVEL / steps;
  for (let i = 0; i < steps; i++) {
    const top = FL + (i + 1) * rise;
    h.box(sx1 - sx0, top, run, (sx0 + sx1) / 2, top / 2, sBot - (i + 0.5) * run, [M.darkWood, M.darkWood, M.planks, M.darkWood, paint(0xf1ede4), M.darkWood], { shadow: false });
  }
  h.floor((sx0 + sx1) / 2, (sTop + sBot) / 2, (sx1 - sx0) / 2, (sBot - sTop) / 2, (lx, lz) => FL + THREE.MathUtils.clamp(0.5 - lz / (sBot - sTop), 0, 1) * LEVEL);
  h.collider(sx0 - 0.04, (sTop + sBot - 0.4) / 2, 0.04, (sBot - sTop - 0.4) / 2, 0, UP - 0.3);
  h.box(0.06, LEVEL - 0.25, sBot - sTop - 0.4, sx0 - 0.04, FL + (LEVEL - 0.25) / 2, (sTop + sBot - 0.4) / 2, paint(0xf1ede4), { shadow: false });
  // Railings around the stairwell upstairs, and a handrail on the stairs
  const rail = M.darkWood, baluster = M.trim;
  h.box(0.06, 0.06, sBot - sTop, sx0 - 0.03, UP + 0.95, (sTop + sBot) / 2, rail);
  h.box(sx1 - sx0, 0.06, 0.06, (sx0 + sx1) / 2, UP + 0.95, sBot + 0.03, rail);
  h.collider(sx0 - 0.03, (sTop + sBot) / 2, 0.05, (sBot - sTop) / 2, UP, UP + 1);
  h.collider((sx0 + sx1) / 2, sBot + 0.03, (sx1 - sx0) / 2, 0.05, UP, UP + 1);
  for (let zz = sTop + 0.1; zz < sBot; zz += 0.25) h.box(0.03, 0.92, 0.03, sx0 - 0.03, UP + 0.46, zz, baluster, { shadow: false });

  // Front porch with a ramp for Dad, steps by the door, posts and a shed roof
  const PZ0 = Z1, PZ1 = Z1 + 2.6, PX0 = X0 - 0.3, PX1 = X1 + 0.3;
  h.slab(PX0, PX1, PZ0, PZ1, FL, FL, M.deck, M.stone);
  const doorX = 0.25;
  h.slab(doorX - 1.2, doorX + 1.2, PZ1, PZ1 + 0.45, 0.3, 0.3, M.deck, M.stone);
  h.slab(doorX - 1.2, doorX + 1.2, PZ1 + 0.45, PZ1 + 0.9, 0.15, 0.15, M.deck, M.stone);
  const rampL = 5.4, rz0 = Z1 + 0.6, rz1 = Z1 + 1.9;
  const rampGeo = new THREE.BoxGeometry(rampL, 0.1, rz1 - rz0);
  planarUV(rampGeo, 0, 0, 0, M.deck);
  const ramp = new THREE.Mesh(rampGeo, M.deck);
  ramp.position.set(PX1 + rampL / 2, FL / 2 - 0.02, (rz0 + rz1) / 2);
  ramp.rotation.z = -Math.atan2(FL, rampL);
  ramp.receiveShadow = ramp.castShadow = true;
  h.group.add(ramp);
  h.floor(PX1 + rampL / 2, (rz0 + rz1) / 2, rampL / 2, (rz1 - rz0) / 2, (lx) => FL * (0.5 - lx / rampL));
  for (const rz of [rz0 - 0.03, rz1 + 0.03]) {
    h.box(rampL, 0.05, 0.05, PX1 + rampL / 2, FL / 2 + 0.9, rz, rail);
    h.collider(PX1 + rampL / 2, rz, rampL / 2, 0.04, 0, 1.4);
    for (let k = 0; k <= 4; k++) h.box(0.06, 1.0, 0.06, PX1 + (k * rampL) / 4, FL * (1 - k / 4) + 0.45, rz, M.trim, { shadow: false });
  }
  // Porch posts, railing (open at the steps and the ramp) and roof
  for (const px of [PX0 + 0.12, -4, doorX - 1.3, doorX + 1.3, 4.5, PX1 - 0.12]) h.box(0.16, 2.75, 0.16, px, FL + 1.375, PZ1 - 0.12, M.trim, { collide: true });
  const railSeg = (a, b) => {
    h.box(b - a, 0.06, 0.08, (a + b) / 2, FL + 0.9, PZ1 - 0.12, M.trim);
    h.box(b - a, 0.05, 0.05, (a + b) / 2, FL + 0.12, PZ1 - 0.12, M.trim, { shadow: false });
    for (let xx = a + 0.12; xx < b - 0.05; xx += 0.14) h.box(0.03, 0.78, 0.03, xx, FL + 0.5, PZ1 - 0.12, M.trim, { shadow: false });
    h.collider((a + b) / 2, PZ1 - 0.12, (b - a) / 2, 0.06, FL, FL + 1);
  };
  railSeg(PX0 + 0.2, doorX - 1.3);
  railSeg(doorX + 1.3, PX1 - 0.2);
  h.box(0.06, 0.06, rz0 - PZ0, PX1 - 0.03, FL + 0.9, (PZ0 + rz0) / 2, M.trim);
  h.box(0.06, 0.06, PZ1 - rz1, PX1 - 0.03, FL + 0.9, (rz1 + PZ1) / 2, M.trim);
  h.collider(PX1 - 0.03, (PZ0 + rz0) / 2, 0.05, (rz0 - PZ0) / 2, FL, FL + 1);
  h.collider(PX1 - 0.03, (rz1 + PZ1) / 2, 0.05, (PZ1 - rz1) / 2, FL, FL + 1);
  const porchRoof = h.box(PX1 - PX0 + 0.4, 0.12, PZ1 - PZ0 + 0.6, 0, 0, 0, [M.darkTrim, M.darkTrim, M.shingle, paint(0xe9e3d6), M.darkTrim, M.darkTrim], { localUV: true });
  porchRoof.rotation.x = 0.16;
  porchRoof.position.set(0, FL + 2.95, (PZ0 + PZ1) / 2 + 0.25);
  h.box(PX1 - PX0, 0.2, 0.12, 0, FL + 2.75, PZ1 - 0.12, M.trim);
  // Porch lights by the door
  for (const lx of [doorX - 0.9, doorX + 0.9]) {
    h.box(0.14, 0.26, 0.14, lx, FL + 2.0, Z1 + 0.18, mat(0xffe6b0, { emissive: 0xffc870, emissiveIntensity: 1.2 }), { shadow: false });
    h.box(0.18, 0.04, 0.18, lx, FL + 2.15, Z1 + 0.18, M.black, { shadow: false });
  }
  // Front door, swung open
  const doorPanel = new THREE.Group();
  const leaf = bx(1.05, 2.1, 0.05, mat(0x5a2b1f, { roughness: 0.5 }), 0.525, 1.05, 0);
  for (const [px, py] of [[0.27, 1.5], [0.78, 1.5], [0.27, 0.6], [0.78, 0.6]]) doorPanel.add(bx(0.36, 0.6, 0.012, mat(0x4a2318, { roughness: 0.5 }), px, py, 0.03));
  doorPanel.add(leaf, bx(0.04, 0.04, 0.08, mat(0xc9a64a, { metalness: 0.9, roughness: 0.3 }), 0.95, 1.0, 0.05));
  h.add(doorPanel, doorX - 0.55, FL, Z1 - 0.12, -1.75);
  // Door mat and welcome steps
  h.box(0.9, 0.015, 0.55, doorX, FL + 0.008, Z1 + 0.5, mat(0x4a3b2c, { roughness: 1 }), { shadow: false });

  // Porch swing: Grandpa plays Family Card Table on his phone
  const swX = 5.6, swZ = Z1 + 1.0;
  const swing = group(bx(1.5, 0.06, 0.5, M.wood, 0, 0.48, 0), bx(1.5, 0.45, 0.05, M.wood, 0, 0.75, -0.25));
  for (const dx of [-0.72, 0.72]) swing.add(bx(0.02, 1.85, 0.02, M.steel, dx, 1.42, 0));
  h.add(swing, swX, FL, swZ);
  h.collider(swX, swZ, 0.8, 0.35, FL, FL + 1.4);
  const grandpa = person({ pose: 'sit', hands: 'phone', shirt: 0x5b2a2a, pants: 0x57534e, skin: SKIN[1], hair: 0xe5e7eb, seatH: 0.48, build: 1.08 });
  h.add(grandpa, swX - 0.3, FL, swZ - 0.05);
  tag(grandpa, 'family-card-table', 'fct-phone.jpg');
  tag(givePhone(grandpa, 'fct-phone.jpg'), 'family-card-table', 'fct-phone.jpg');
  const [gpx, gpz] = h.world(swX, swZ);
  addIcon('family-card-table', gpx, 3.7, gpz);
  plant(h, PX0 + 0.6, FL, PZ1 - 0.6, 1.0);
  placeModel(h, 'SheenChair', -6, FL, Z1 + 1.2, 0.3, 1.2);
  placeModel(h, 'SheenChair', -4.8, FL, Z1 + 1.3, -0.3, 1.2);

  // ---- Living room: Mom on the sofa, playing Roadway Rivals with her son ----
  h.add(fireplace(), X0 + 0.35, FL, 3.0, Math.PI / 2);
  h.collider(X0 + 0.35, 3.0, 0.3, 1.0, FL, FL + 1.3);
  const tv = tvScreen(1.5); h.add(tv, X0 + 0.15, FL + 2.0, 3.0, Math.PI / 2);
  h.add(rug(2.8, 2.0, ['#7b4b3a', '#d8c7a8', '#3f2a22']), -4.6, FL, 3.0);
  placeModel(h, 'GlamVelvetSofa', -2.6, FL, 3.0, -Math.PI / 2, 1.05);
  h.collider(-2.4, 3.0, 0.45, 1.15, FL, FL + 0.8);
  const mom = person({ pose: 'sit', hands: 'phone', shirt: 0x2a9d8f, pants: 0x2b3a55, skin: SKIN[4], hair: 0x5a3417, seatH: 0.47, longHair: true });
  h.add(mom, -2.75, FL, 3.3, -Math.PI / 2);
  tag(mom, 'roadway-rivals', 'roadway-phone.jpg');
  tag(givePhone(mom, 'roadway-phone.jpg'), 'roadway-rivals', 'roadway-phone.jpg');
  h.add(table(1.1, 0.6, 0.42, M.darkWood, M.darkWood), -4.4, FL, 3.0, Math.PI / 2);
  h.collider(-4.4, 3.0, 0.3, 0.55, FL, FL + 0.45);
  placeModel(h, 'ChairDamaskPurplegold', -5.6, FL, 5.1, 2.6, 1.2);
  h.collider(-5.6, 5.1, 0.45, 0.45, FL, FL + 0.9);
  h.add(floorLamp(), -6.6, FL, 5.4);
  plant(h, -1.6, FL, 5.4, 1.1);
  h.add(bookshelf(1.4, 2.0), -7.0, FL, 0.25, Math.PI);
  h.collider(-7.0, 0.25, 0.7, 0.2, FL, FL + 2);

  // ---- Kitchen: Grandma at the table on a laptop ----
  h.add(counters(5.2, 1.5), -5.2, FL, Z0 + 0.42);
  h.collider(-5.2, Z0 + 0.42, 2.6, 0.32, FL, FL + 0.9);
  h.add(upperCabinets(1.6), -6.9, FL + 1.85, Z0 + 0.27);
  h.add(upperCabinets(1.2), -3.0, FL + 1.85, Z0 + 0.27);
  h.add(range(), -1.9 + 0.0, FL, Z0 + 0.42);
  h.box(0.8, 0.5, 0.5, -1.9, FL + 2.0, Z0 + 0.35, M.steel);
  h.add(fridge(), X0 + 0.5, FL, -1.0, Math.PI / 2);
  h.collider(X0 + 0.5, -1.0, 0.38, 0.45, FL, FL + 1.9);
  const tbl = table(1.6, 0.95, 0.76, M.wood, M.darkWood);
  h.add(tbl, -4.3, FL, -2.7);
  h.collider(-4.3, -2.7, 0.8, 0.48, FL, FL + 0.8);
  const lap = laptop('fct-desktop.jpg');
  h.add(lap, -4.3, FL + 0.76, -2.85, 0);
  tag(lap, 'family-card-table', 'fct-desktop.jpg');
  h.add(diningChair(), -4.3, FL, -1.8, Math.PI);
  const grandma = person({ pose: 'sit', hands: 'desk', shirt: 0xb83280, pants: 0x4b5563, skin: SKIN[0], hair: 0xd1d5db, seatH: 0.48, handReach: 0.42, handY: 0.8 });
  h.add(grandma, -4.3, FL, -1.8, Math.PI);
  tag(grandma, 'family-card-table', 'fct-desktop.jpg');
  for (const [cx2, cz2, r2] of [[-5.3, -2.7, Math.PI / 2], [-3.3, -2.7, -Math.PI / 2], [-4.3, -3.6, 0]]) h.add(diningChair(), cx2, FL, cz2, r2);
  const vaseB = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.18, 16), mat(0x5a7f8f, { roughness: 0.2 }), 0, 0.09, 0);
  h.add(group(vaseB), -3.8, FL + 0.76, -2.55);
  const [gx, gz] = h.world(-4.3, -1.8);
  addIcon('family-card-table', gx, FL + 2.0, gz);

  // ---- Dad's den: wheelchair, 40" monitor with RubeCube and BetterTalk ----
  h.add(table(1.8, 0.8, 0.74, M.wood, M.black), X1 - 0.5, FL, 2.5, Math.PI / 2);
  h.collider(X1 - 0.5, 2.5, 0.4, 0.9, FL, FL + 0.8);
  const big = monitor(0.885, 0.498, 'screen-rubecube-bettertalk.jpg', 0.16);
  h.add(big, X1 - 0.38, FL + 0.74, 2.5, -Math.PI / 2);
  // Clicking the corner of this screen opens BetterTalk; the rest is RubeCube.
  tag(big, 'rubecube', 'rubecube-desktop.jpg');
  big.userData.screen.userData.split = { project: 'bettertalk', shot: 'bettertalk-main.png', u0: 0.69, v1: 0.37 };
  const wc = wheelchair();
  h.add(wc, X1 - 1.65, FL, 2.5, Math.PI / 2);
  const dad = person({ pose: 'sit', hands: 'lap', shirt: 0x34568b, pants: 0x374151, skin: SKIN[4], hair: 0x4a3221, seatH: 0.5, build: 1.06 });
  h.add(dad, X1 - 1.65, FL, 2.5, Math.PI / 2);
  tag(dad, 'bettertalk', 'bettertalk-main.png');
  h.collider(X1 - 1.65, 2.5, 0.45, 0.45, FL, FL + 1.4);
  const [btx, btz] = h.world(X1 - 1.3, 1.1), [rcx, rcz] = h.world(X1 - 1.3, 3.9);
  addIcon('bettertalk', btx, FL + 2.4, btz);
  addIcon('rubecube', rcx, FL + 1.9, rcz);
  placeModel(h, 'SheenWoodLeatherSofa', 4.6, FL, Z1 - 0.55, Math.PI, 1.0);
  h.collider(4.6, Z1 - 0.55, 1.35, 0.45, FL, FL + 0.9);
  h.add(bookshelf(1.2, 2.0), 3.4, FL, 0.25, 0);
  h.collider(3.4, 0.25, 0.6, 0.2, FL, FL + 2);
  plant(h, X1 - 0.5, FL, Z1 - 0.5, 1.0);
  h.add(rug(2.2, 1.6, ['#3b4a5a', '#c8b48a', '#1f2a36']), 5.4, FL, 2.5);

  // ---- Grandparents' room ----
  h.add(bed(1.6, 2.05, 0x8a6f9e), 5.2, FL, Z0 + 1.15);
  h.collider(5.2, Z0 + 1.15, 0.85, 1.08, FL, FL + 0.7);
  for (const nx of [4.0, 6.4]) { h.add(nightstand(), nx, FL, Z0 + 0.3); placeModel(h, 'IridescenceLamp', nx, FL + 0.55, Z0 + 0.3, 0, 0.9); }
  h.add(dresser(1.2), X1 - 0.35, FL, -1.2, -Math.PI / 2);
  placeModel(h, 'SheenChair', 3.3, FL, -0.8, 2.4, 1.2);
  h.add(rug(1.8, 1.2, ['#b9a07a', '#6b4f3a', '#efe3c8']), 5.2, FL, -2.0);

  // ---- Downstairs bathroom and hall ----
  h.add(toilet(), 1.9, FL, Z0 + 0.4);
  h.add(vanity(0.9), -0.35, FL, Z0 + 0.35);
  h.add(rug(1.2, 0.7, ['#5c6b5a', '#d9d2c3', '#38443a']), 0.5, FL, 2.0);
  h.add(table(0.9, 0.35, 0.8, M.darkWood, M.darkWood), -0.7, FL, 4.8, Math.PI / 2);

  // ---- Upstairs: the son's room ----
  h.add(table(2.0, 0.75), -4.9, UP, Z0 + 0.5);
  h.collider(-4.9, Z0 + 0.5, 1.0, 0.38, UP, UP + 0.8);
  const m1 = monitor(0.6, 0.34, 'roadway-desktop.jpg');
  h.add(m1, -5.35, UP + 0.75, Z0 + 0.4);
  tag(m1, 'roadway-rivals', 'roadway-desktop.jpg');
  const m2 = monitor(0.3, 0.53, 'bridge-defender-gameplay.jpg', 0.1);
  h.add(m2, -4.3, UP + 0.75, Z0 + 0.4, -0.25);
  tag(m2, 'bridge-defender', 'bridge-defender-gameplay.jpg');
  h.add(officeChair(0xb91c1c), -5.0, UP, Z0 + 1.3, Math.PI);
  const son = person({ s: 0.8, pose: 'sit', hands: 'desk', shirt: 0x2f855a, pants: 0x1e3a8a, skin: SKIN[4], hair: 0x5a3417, seatH: 0.5, handReach: 0.45, handY: 0.8 });
  h.add(son, -5.0, UP, Z0 + 1.3, Math.PI);
  tag(son, 'roadway-rivals', 'roadway-desktop.jpg');
  h.add(bed(1.0, 2.0, 0x2b6cb0), X0 + 0.6, UP, -2.0);
  h.collider(X0 + 0.6, -2.0, 0.55, 1.03, UP, UP + 0.7);
  h.add(poster('roadway-title-phone.jpg', 0.45, 0.8), -2.6, UP + 1.6, -0.08, Math.PI);
  h.add(poster('bridge-defender-title.jpg', 0.5, 0.8), -1.08, UP + 1.6, -3.0, -Math.PI / 2);
  h.add(rug(1.6, 1.2, ['#1f3b57', '#e2b84a', '#0f2236']), -4.0, UP, -2.6);
  const [kx1, kz1] = h.world(-5.6, Z0 + 0.9), [kx2, kz2] = h.world(-4.1, Z0 + 0.9);
  addIcon('roadway-rivals', kx1, UP + 2.0, kz1);
  addIcon('bridge-defender', kx2, UP + 1.6, kz2);

  // ---- Upstairs: the daughter's room ----
  h.add(table(1.6, 0.75, 0.75, M.white, M.white), 5.5, UP, Z0 + 0.5);
  h.collider(5.5, Z0 + 0.5, 0.8, 0.38, UP, UP + 0.8);
  const m3 = monitor(0.6, 0.34, 'seraph-gameplay.jpg');
  h.add(m3, 5.5, UP + 0.75, Z0 + 0.4);
  tag(m3, 'seraph', 'seraph-gameplay.jpg');
  h.add(officeChair(0x6b46c1), 5.5, UP, Z0 + 1.3, Math.PI);
  const daughter = person({ s: 0.78, pose: 'sit', hands: 'desk', shirt: 0x9333ea, pants: 0x27272a, skin: SKIN[4], hair: 0x3b2314, seatH: 0.5, handReach: 0.45, handY: 0.8, longHair: true });
  h.add(daughter, 5.5, UP, Z0 + 1.3, Math.PI);
  tag(daughter, 'seraph', 'seraph-gameplay.jpg');
  h.add(bed(1.0, 2.0, 0xd53f8c), X1 - 0.6, UP, -2.0);
  h.collider(X1 - 0.6, -2.0, 0.55, 1.03, UP, UP + 0.7);
  placeModel(h, 'SpecularSilkPouf', 4.0, UP, -2.3, 0, 1.0);
  h.add(poster('seraph-gameplay.jpg', 0.9, 0.5), 2.62, UP + 1.6, -3.0, Math.PI / 2);
  plant(h, 3.0, UP, Z0 + 0.5, 0.8);
  const [dx2, dz2] = h.world(5.5, Z0 + 0.9);
  addIcon('seraph', dx2, UP + 2.0, dz2);

  // ---- Upstairs: Mom and Dad's room ----
  h.add(bed(1.8, 2.1, 0x9c8b6e), X0 + 1.15, UP, 3.0, Math.PI / 2);
  h.collider(X0 + 1.15, 3.0, 1.08, 0.95, UP, UP + 0.7);
  for (const nz of [1.6, 4.4]) { h.add(nightstand(), X0 + 0.3, UP, nz, Math.PI / 2); placeModel(h, 'IridescenceLamp', X0 + 0.3, UP + 0.55, nz, 0, 0.9); }
  h.add(dresser(1.4, M.darkWood), -3.0, UP, 0.3, 0);
  placeModel(h, 'ChairDamaskPurplegold', -2.0, UP, 5.0, -2.4, 1.2);
  h.add(rug(2.4, 1.8, ['#d9cdb4', '#7a5c44', '#f2ead8']), -4.6, UP, 3.0);

  // ---- Upstairs bathroom ----
  h.add(bathtub(), X1 - 0.5, UP, 2.0);
  h.collider(X1 - 0.5, 2.0, 0.4, 0.85, UP, UP + 0.6);
  h.add(vanity(1.2), 5.0, UP, 0.35);
  h.add(toilet(), 3.3, UP, 0.4);

  // Lights inside: warm lamps in each room
  for (const [lx, ly, lz, i] of [[-4.5, FL + 2.5, 3, 5], [-4.3, FL + 2.5, -2.7, 5], [5.2, FL + 2.5, 2.5, 4], [5.2, FL + 2.5, -3, 3], [0.6, FL + 2.5, 2, 3], [-4.5, UP + 2.4, -3, 4], [5.2, UP + 2.4, -3, 4], [-4.5, UP + 2.4, 3, 3], [0.2, UP + 2.4, 1.5, 3]]) {
    const l = new THREE.PointLight(0xffd9a8, i, 7.5, 1.6);
    const [wx, wz] = h.world(lx, lz);
    l.position.set(wx, ly, wz);
    scene.add(l);
    const fixture = mesh(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfff3dd, { emissive: 0xffe2b0, emissiveIntensity: 1.5 }));
    fixture.rotation.x = Math.PI;
    h.add(fixture, lx, ly + 0.45, lz);
  }
  return h;
}

// The second house: a smaller closed house in its own clearing
function neighborHouse(x, z, rot) {
  const h = new Place(x, z, rot);
  const X0 = -6, X1 = 6, Z0 = -5, Z1 = 5;
  const outer = M.sidingGray;
  h.box(X1 - X0 + 0.3, FL, Z1 - Z0 + 0.3, 0, FL / 2, 0, M.stone, { shadow: false });
  const w = (lvl, xa, za, xb, zb, o, out) => h.wall(xa, za, xb, zb, FL + lvl * LEVEL, LEVEL, paint(0xe7dcc8), o, { outMat: outer, out });
  w(0, X0, Z1, X1, Z1, [win(1.2, 3.4), door(5.4, 6.6), win(8.6, 10.8)], 1);
  w(1, X0, Z1, X1, Z1, [win(1.5, 3.5, 1, 2.2), win(8.5, 10.5, 1, 2.2)], 1);
  w(0, X0, Z0, X1, Z0, [win(3, 5), win(7.5, 9.5)], -1);
  w(1, X0, Z0, X1, Z0, [win(3, 5, 1, 2.2), win(7.5, 9.5, 1, 2.2)], -1);
  for (const ex of [X0, X1]) for (const lvl of [0, 1]) w(lvl, ex, Z0, ex, Z1, [win(4, 6, 1, 2.2)], ex > 0 ? 1 : -1);
  for (const [cx, cz] of [[X0, Z0], [X0, Z1], [X1, Z0], [X1, Z1]]) h.box(0.26, 2 * LEVEL, 0.26, cx, FL + LEVEL, cz, M.trim, { shadow: false });
  gableRoof(h, X0, X1, Z0, Z1, FL + 2 * LEVEL, 3.0, 0.6, outer);
  // Curtains glowing warmly behind the glass, so nobody sees an empty house
  h.box(X1 - X0 - 0.5, 2 * LEVEL - 0.2, Z1 - Z0 - 0.5, 0, FL + LEVEL, 0, mat(0xe9dcc0, { emissive: 0x6b5030, emissiveIntensity: 0.35 }), { shadow: false });
  // Closed door, stoop and steps
  h.box(1.1, 2.1, 0.06, 0, FL + 1.05, Z1 + 0.12, mat(0x1e3a5f, { roughness: 0.5 }));
  h.box(0.05, 0.05, 0.06, 0.4, FL + 1.0, Z1 + 0.18, mat(0xc9a64a, { metalness: 0.9, roughness: 0.3 }));
  h.slab(-1.4, 1.4, Z1, Z1 + 1.4, FL, FL, M.concrete);
  h.slab(-1.0, 1.0, Z1 + 1.4, Z1 + 1.8, 0.22, 0.22, M.concrete);
  h.box(2.6, 0.12, 1.8, 0, FL + 2.6, Z1 + 0.8, M.darkTrim);
  for (const px of [-1.2, 1.2]) h.box(0.12, 2.6, 0.12, px, FL + 1.3, Z1 + 1.5, M.trim, { collide: true });
  plant(h, -1.1, FL, Z1 + 1.1, 0.9);
  return h;
}

// ---------------------------------------------------------------------------
// Build the world

const HOUSE = { x: -4, z: -36 }; // family house, front facing the road (south)
const HOUSE2 = { x: 30, z: 34 }; // neighbor, front facing the road (north)
const DRIVE_X = 13;
const BUS = { x: 24, z: roadZ(24) - RW - SHOULDER - 2.2 };

const frontWalk = polyline([[HOUSE.x + 0.25, HOUSE.z + 6 + 3.5], [HOUSE.x + 0.25, HOUSE.z + 16], [HOUSE.x - 1, roadZ(HOUSE.x) - RW]]);
const drive = polyline([[DRIVE_X, roadZ(DRIVE_X) - RW + 0.2], [DRIVE_X - 0.5, -18], [DRIVE_X - 1.5, -26], [DRIVE_X - 1.5, -33]]);
const drive2 = polyline([[HOUSE2.x + 9, roadZ(HOUSE2.x + 9) + RW - 0.2], [HOUSE2.x + 9.5, 18], [HOUSE2.x + 9, 30]]);
const walk2 = polyline([[HOUSE2.x, HOUSE2.z - 5 - 1.8], [HOUSE2.x + 0.6, 22], [HOUSE2.x + 1, roadZ(HOUSE2.x) + RW]]);
const PATHS = [{ pts: frontWalk, w: 0.8 }, { pts: drive, w: 1.8 }, { pts: drive2, w: 1.6 }, { pts: walk2, w: 0.7 }];
const CLEARINGS = [
  { x: HOUSE.x + 2, z: HOUSE.z + 1, rx: 19, rz: 15 },
  { x: HOUSE.x + 4, z: HOUSE.z + 13, rx: 15, rz: 7 },
  { x: HOUSE2.x + 2, z: HOUSE2.z - 1, rx: 14, rz: 12 },
  { x: BUS.x, z: BUS.z - 0.5, rx: 6, rz: 3.5 },
  { x: 2, z: roadZ(2), rx: 6, rz: 9 }, // keep the spawn view open
];

buildGround();
// Lawns in the clearings, fading into the forest floor
function lawn(cx, cz, rx, rz) {
  const geo = new THREE.CircleGeometry(1, 64, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * rx + cx, z = pos.getZ(i) * rz + cz;
    pos.setXYZ(i, x, 0.006, z);
    uv.setXY(i, x / 2.5, z / 2.5);
    col.push(1, 1, 1);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const id = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = x / 128 - 1, dy = y / 128 - 1, d = Math.hypot(dx, dy) + (noise2(x * 0.06, y * 0.06) - 0.5) * 0.35;
    const a = THREE.MathUtils.clamp((1 - d) / 0.35, 0, 1) * (0.75 + 0.25 * noise2(x * 0.15 + 9, y * 0.15));
    const k = (y * 256 + x) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = a * 255; id.data[k + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  const am = new THREE.CanvasTexture(c);
  // alphaMap is sampled with the main UVs, so remap them to the circle
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - cx) / rx * 0.5 + 0.5, (pos.getZ(i) - cz) / rz * 0.5 + 0.5);
  const grass = loader.load(TEX + 'grass_col.jpg');
  grass.colorSpace = THREE.SRGBColorSpace; grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.anisotropy = maxAniso; grass.repeat.set(rx / 1.2, rz / 1.2);
  const m = new THREE.MeshStandardMaterial({ map: grass, alphaMap: am, transparent: true, depthWrite: false, color: 0x7d9c5c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const msh = new THREE.Mesh(geo, m);
  msh.receiveShadow = true;
  msh.renderOrder = 1;
  scene.add(msh);
}
lawn(HOUSE.x + 1, HOUSE.z + 13, 15, 7);
lawn(HOUSE.x - 2, HOUSE.z - 9, 11, 5);
lawn(HOUSE2.x, HOUSE2.z - 9, 10, 4.5);
const gravelPath = M.gravel.clone(); gravelPath.color.set(0xc4b9a6);
ribbon(frontWalk, -0.75, 0.75, 0.014, M.concrete, [2, 2]);
ribbon(drive, -1.7, 1.7, 0.013, gravelPath, [1.6, 1.6]);
ribbon(drive2, -1.5, 1.5, 0.013, gravelPath, [1.6, 1.6]);
ribbon(walk2, -0.65, 0.65, 0.014, M.concrete, [2, 2]);
// Parking pad by Dad's ramp
ribbon(polyline([[DRIVE_X - 1.5, -26], [DRIVE_X - 1.5, -34]]), -2.8, 2.8, 0.0135, gravelPath, [1.6, 1.6]);

const LOGS = [[-20, -12, 0.4, 16, 0.9], [36, -20, -1.1, 22, 1.2], [-34, 22, 2.2, 14, 0.8], [8, 22, 0.9, 12, 0.7]];
for (const [lx, lz, lr, len, r] of LOGS) {
  const dx = (Math.cos(lr) * len) / 2, dz = (-Math.sin(lr) * len) / 2;
  PATHS.push({ pts: [[lx - dx, lz - dz], [lx + dx, lz + dz]], w: r });
}
plantForest();
plantUndergrowth();
for (const l of LOGS) fallenLog(...l);
for (const [sx, sz, sr] of [[-14, -22, 1.6], [26, -14, 2.0], [-28, 8, 1.4], [16, 14, 1.2], [-46, -30, 2.2]]) if (clearOf(sx, sz, sr)) stump(sx, sz, sr);
lightShafts();

const family = familyHouse(HOUSE.x, HOUSE.z, 0);
neighborHouse(HOUSE2.x, HOUSE2.z, Math.PI);
busStop(BUS.x, BUS.z);
hydrant(BUS.x - 5, roadZ(BUS.x - 5) - RW - SHOULDER - 0.4);
mailbox(DRIVE_X + 2.2, roadZ(DRIVE_X + 2) - RW - SHOULDER - 0.2, Math.PI, 'family');
mailbox(HOUSE2.x + 11, roadZ(HOUSE2.x + 11) + RW + SHOULDER + 0.2, 0, 'neighbor');

// Cars: Mom and Dad's in the drive, the neighbor's in theirs
function car(x, z, ry, paintColor) {
  const p = new Place(x, z, ry);
  placeModel(p, 'CarConcept', 0, 0, 0, 0, 0.92, (o) => {
    if (!paintColor) return;
    o.traverse((m) => {
      if (m.isMesh && /Paint/.test(m.material.name)) { m.material = m.material.clone(); m.material.color.set(paintColor); }
    });
  });
  p.collider(0, 0.2, 1.15, 2.1, 0, 1.4);
}
car(DRIVE_X - 0.7, -31, 0.03, null);
car(HOUSE2.x + 9, 27.5, Math.PI, 0x24364a);

// ---------------------------------------------------------------------------
// Player

const player = { pos: new THREE.Vector3(2, 0, roadZ(2)), y: 0, yaw: 0, pitch: 0.02, vy: 0 };
const keys = new Set();
const joy = { x: 0, y: 0 };

// Viewpoints for jumping straight to a project (#bettertalk etc.)
function viewFrom(place, from, at, lift = 0) {
  const [x, z] = place.world(...from);
  const [ax, az] = place.world(at[0], at[2]);
  const dy = at[1] - (lift + EYE);
  return { x, z, y: lift, yaw: Math.atan2(-(ax - x), -(az - z)), pitch: Math.atan2(dy, Math.hypot(ax - x, az - z)) };
}
const SPOTS = {
  start: { x: 2, z: roadZ(2) + 1.5, y: 0, yaw: 0.12, pitch: 0.04 },
  bettertalk: viewFrom(family, [5.0, 1.6], [7.6, FL + 1.1, 2.5], FL),
  rubecube: viewFrom(family, [5.0, 1.6], [7.6, FL + 1.1, 2.5], FL),
  'roadway-rivals': viewFrom(family, [-4.9, -1.8], [-5.35, UP + 1.0, -5.6], UP),
  'bridge-defender': viewFrom(family, [-3.9, -2.0], [-4.3, UP + 1.1, -5.6], UP),
  seraph: viewFrom(family, [5.3, -2.0], [5.5, UP + 1.0, -5.6], UP),
  'family-card-table': viewFrom(family, [-3.4, -0.4], [-4.3, FL + 0.85, -2.85], FL),
};

function goTo(spot) {
  player.pos.set(spot.x, 0, spot.z);
  player.y = spot.y;
  player.yaw = spot.yaw;
  player.pitch = spot.pitch;
}

function update(dt) {
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = run ? 6 : 3.2;
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  fx += joy.x; fz += joy.y;
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  player.pos.x += (-sy * fz + cy * fx) * speed * dt;
  player.pos.z += (-cy * fz - sy * fx) * speed * dt;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, BOUNDS.x0, BOUNDS.x1);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, BOUNDS.z0, BOUNDS.z1);
  collide(player.pos, player.y);
  const ground = floorAt(player.pos.x, player.pos.z, player.y);
  if (ground >= player.y) { player.y = ground; player.vy = 0; } else {
    player.vy -= 18 * dt;
    player.y = Math.max(ground, player.y + player.vy * dt);
  }
  camera.position.set(player.pos.x, player.y + EYE, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

// ---------------------------------------------------------------------------
// Looking at and opening projects

const ray = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const hint = document.getElementById('hint');
const cross = document.getElementById('crosshair');
let target = null;
const pickables = [];
function collectPickables() {
  pickables.length = 0;
  scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.material !== glass) pickables.push(o); });
}

function pick(ndc) {
  ray.setFromCamera(ndc, camera);
  ray.far = 60;
  const hitIcon = ray.intersectObjects(icons.filter((s) => s.visible), false)[0];
  if (hitIcon) return { project: hitIcon.object.userData.project, shot: null };
  ray.far = 9;
  const near = pickables.filter((o) => o.visible && o.getWorldPosition(_v).distanceToSquared(camera.position) < 200);
  const hit = ray.intersectObjects(near, false)[0];
  if (!hit || !hit.object.userData.project) return null;
  const split = hit.object.userData.split;
  if (split && hit.uv && hit.uv.x > split.u0 && hit.uv.y < split.v1) return { project: split.project, shot: split.shot };
  return { project: hit.object.userData.project, shot: hit.object.userData.shot };
}
const _v = new THREE.Vector3();

function showHint(t) {
  target = t;
  cross.classList.toggle('on', !!t);
  if (!t || document.body.classList.contains('touch')) { hint.hidden = true; return; }
  const p = projectById(t.project);
  hint.innerHTML = `${p.icon} <b>${p.name}</b> · click to open`;
  hint.hidden = false;
}

const panel = document.getElementById('panel');
function openPanel(t) {
  const p = projectById(t.project);
  document.getElementById('panel-img').src = SHOTS + (t.shot ?? p.cover.replace(SHOTS, ''));
  document.getElementById('panel-img').alt = `${p.name} screenshot`;
  document.getElementById('panel-status').textContent = p.status.label;
  document.getElementById('panel-title').textContent = p.name;
  document.getElementById('panel-tagline').textContent = p.tagline;
  document.getElementById('panel-where').textContent = p.world;
  const primary = p.links.find((l) => ['play', 'download', 'buy'].includes(l.kind));
  document.getElementById('panel-links').innerHTML =
    (primary ? `<a class="primary" href="${primary.url}" target="_blank" rel="noopener">${primary.label}</a>` : '') +
    `<a href="project.html?id=${p.id}">Project page</a>`;
  panel.hidden = false;
  showHint(null);
  keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePanel() {
  panel.hidden = true;
}
document.getElementById('panel-close').addEventListener('click', closePanel);
panel.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });

// ---------------------------------------------------------------------------
// Input: pointer lock on desktop with drag-to-look as a fallback, touch on phones

if (isTouch) document.body.classList.add('touch');
const intro = document.getElementById('intro');
let started = false;

function start() {
  intro.hidden = true;
  started = true;
  if (!isTouch) canvas.requestPointerLock?.()?.catch?.(() => {});
}
document.getElementById('start').addEventListener('click', start);

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !panel.hidden) { closePanel(); return; }
  if (!panel.hidden || !started) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && target) openPanel(target);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const look = (dx, dy, k) => {
  player.yaw -= dx * k;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * k, -1.45, 1.45);
};

let drag = null;
canvas.addEventListener('mousedown', (e) => {
  if (!started || isTouch) return;
  if (document.pointerLockElement === canvas) { if (target) openPanel(target); return; }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.requestPointerLock?.()?.catch?.(() => {});
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0022);
  else if (drag) {
    look(e.clientX - drag.x, e.clientY - drag.y, 0.004);
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
addEventListener('mouseup', (e) => {
  if (drag && drag.moved < 4 && !document.pointerLockElement) {
    const t = pick(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    if (t) openPanel(t);
  }
  drag = null;
});

// Touch: a joystick on the left, drag anywhere else to look, tap to open
const stick = document.getElementById('joystick');
const knob = stick.querySelector('.knob');
let stickId = null;
stick.addEventListener('touchstart', (e) => { stickId = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
const touches = new Map();
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      const r = stick.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy), max = r.width / 2;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / max; joy.y = -dy / max;
    } else if (touches.has(t.identifier)) {
      const p = touches.get(t.identifier);
      look(t.clientX - p.x, t.clientY - p.y, 0.005);
      p.moved += Math.abs(t.clientX - p.x) + Math.abs(t.clientY - p.y);
      p.x = t.clientX; p.y = t.clientY;
    }
  }
}, { passive: true });
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY, moved: 0 });
}, { passive: true });
addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) { stickId = null; joy.x = joy.y = 0; knob.style.transform = ''; }
    const p = touches.get(t.identifier);
    if (p && p.moved < 8 && started && panel.hidden) {
      const hit = pick(new THREE.Vector2((t.clientX / innerWidth) * 2 - 1, -(t.clientY / innerHeight) * 2 + 1));
      if (hit) openPanel(hit);
    }
    touches.delete(t.identifier);
  }
});

// Project menu
const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');
menu.innerHTML = PROJECTS.filter((p) => SPOTS[p.id]).map((p) => `<button type="button" data-id="${p.id}"><span>${p.icon}</span>${p.name}</button>`).join('') +
  `<button type="button" data-id="start"><span>🌲</span>Back to the road</button>`;
menuBtn.addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden && document.pointerLockElement) document.exitPointerLock();
});
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  goTo(SPOTS[b.dataset.id]);
  history.replaceState(null, '', b.dataset.id === 'start' ? location.pathname + location.search : '#' + b.dataset.id);
  menu.hidden = true;
  if (!started) start();
});

// ---------------------------------------------------------------------------
// Loop

goTo(SPOTS[location.hash.slice(1)] ?? SPOTS.start);
const startBtn = document.getElementById('start');
const loadingEl = document.getElementById('loading');
manager.onProgress = (url, done, total) => { loadingEl.textContent = `Loading the forest… ${Math.round((done / total) * 100)}%`; };
manager.onLoad = () => {
  loadingEl.textContent = '';
  startBtn.disabled = false;
  collectPickables();
};
startBtn.disabled = true;
setTimeout(() => { startBtn.disabled = false; loadingEl.textContent = ''; collectPickables(); }, 15000);
collectPickables();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let frame = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started && panel.hidden) update(dt);
  else update(0);
  const t = clock.elapsedTime;
  // Where a project appears more than once, only its nearest icon shows.
  const nearest = new Map();
  for (const s of icons) {
    const d = s.position.distanceTo(camera.position);
    const cur = nearest.get(s.userData.project);
    if (!cur || d < cur.d) nearest.set(s.userData.project, { s, d });
  }
  for (const s of icons) {
    s.position.y = s.userData.baseY + Math.sin(t * 1.6 + s.userData.phase) * 0.08;
    const d = s.position.distanceTo(camera.position);
    // Fade out up close so icons never cover the screens they point at.
    s.material.opacity = THREE.MathUtils.clamp((d - 2.5) / 3, 0, 1);
    s.visible = s.material.opacity > 0.02 && nearest.get(s.userData.project).s === s;
    // Keep far icons readable: never smaller on screen than one seen from 9 m.
    const k = Math.max(1, d / 9);
    s.scale.set(1.3 * k, 0.41 * k, 1);
  }
  if (started && panel.hidden && !isTouch && (frame++ % 3 === 0)) showHint(pick(center));
  renderer.render(scene, camera);
});

// For testing in a headless browser
window.__world = { player, goTo, SPOTS, start, scene, THREE, renderer, camera, colliders, trees, pick, update };
