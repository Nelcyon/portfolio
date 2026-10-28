// The Redwoods: a small first-person world where a family uses the projects.
//
// Units are meters. North is -Z, east is +X. A two-lane road runs east-west
// through an old-growth redwood forest. North of the road, up a gravel drive, is
// the family's house in a clearing; south of the road a second house sits in a
// smaller clearing. The bus stop is on the north side of the road, east of the
// house. The visitor starts on the road facing north toward the house.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PROJECTS, projectById } from './projects.js';
import { posePerson } from './people.js';

const SHOTS = 'assets/shots/';
const TEX = 'assets/tex/';
const MODELS = 'assets/models/';
const PEOPLE = 'assets/people/';
const EYE = 1.65;
const RADIUS = 0.3; // visitor's body radius for collisions
const STEP = 0.45; // highest step the visitor can walk up
const isTouch = matchMedia('(pointer: coarse)').matches;
const LOW = isTouch || /[?&]low\b/.test(location.search); // phones: smaller textures, lighter shadows

// Road: a gentle curve along x
const RW = 3.6; // asphalt half width
const SHOULDER = 1.3;
const roadZ = (x) => 4 * Math.sin((x - 10) / 32);
// A small world: the road, the bus stop, the family's drive and house, ending just behind it.
// A small world: the house sits a few steps off the road with the bus stop beside it,
// all inside a ring of painted forest that stands just behind the house.
const WORLD_C = { x: 0.5, z: -11 }; // center of the world
const WORLD_R = { x: 24, z: 22 }; // the ground fades into the void past this
const WALL = 0.94; // the forest wall, as a fraction of WORLD_R
const ellipseD = (x, z) => Math.hypot((x - WORLD_C.x) / WORLD_R.x, (z - WORLD_C.z) / WORLD_R.z);
// The road runs from wall to wall, and its ends tuck in behind it
const ROAD_X = [-1, 1].map((dir) => { let x = WORLD_C.x; while (ellipseD(x, roadZ(x)) < WALL + 0.03) x += dir * 0.5; return x; });

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
const MAX_PR = Math.min(window.devicePixelRatio, LOW ? 1.5 : 2);
renderer.setPixelRatio(MAX_PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
// Nothing that casts a shadow moves, so the sun's shadow map is drawn only when
// something new appears (see refreshShadows) instead of every frame.
renderer.shadowMap.autoUpdate = false;
let shadowTimer = 0;
function refreshShadows() {
  clearTimeout(shadowTimer);
  shadowTimer = setTimeout(() => { renderer.shadowMap.needsUpdate = true; }, 150);
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const FOG = new THREE.Color(0x29332d);
scene.fog = new THREE.FogExp2(FOG, 0.016);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 320);
camera.rotation.order = 'YXZ';

// Light: soft sky fill, a low-ish sun filtering through the canopy, and the sky
// gradient (below) for reflections and ambient color.
const hemi = new THREE.HemisphereLight(0xc9dcff, 0x8a7d6c, 0.55);
scene.add(hemi);
const SUN_DIR = new THREE.Vector3(0.45, 0.82, 0.36).normalize();
const sun = new THREE.DirectionalLight(0xffe2b8, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.target.position.set(WORLD_C.x, 0, WORLD_C.z);
sun.position.add(sun.target.position);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 10, far: 260 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// Sky: a plain gradient, pale green-blue overhead, sinking into the dark at the
// horizon. The same colors, blurred, light the scene's reflections.
const SKY = { top: new THREE.Color(0xb7cfc9), mid: new THREE.Color(0x56675d), low: new THREE.Color(0x000000) };
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY.top }, mid: { value: SKY.mid }, low: { value: SKY.low } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, low; varying vec3 vp;
      void main(){
        float h = vp.y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
let loadPanorama;
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial()));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  // The visible sky starts as the same gradient, then the redwoods panorama (70 KB)
  // fades in over it once the world is on screen. Same shader before and after, so
  // nothing recompiles. Only its top shows above the forest wall.
  const skyMat = skyMaterial();
  skyMat.uniforms.map = { value: null };
  skyMat.uniforms.k = { value: 0 };
  skyMat.fragmentShader = `uniform vec3 top, mid, low; uniform sampler2D map; uniform float k; varying vec3 vp;
    void main(){
      float h = vp.y;
      vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h));
      // The panorama's trees start just under the horizon (its own forest floor, too close
      // to read at this size, is left out) and run to straight up, then sink into the void.
      float v = 0.18 + 0.82 * (asin(clamp(h, -1.0, 1.0)) + 0.06) / 1.6308;
      vec3 p = texture2D(map, vec2(atan(vp.z, vp.x) * 0.15915494 + 0.5, clamp(v, 0.002, 0.998))).rgb;
      p = mix(low, p * 0.92, smoothstep(-0.09, -0.01, h));
      gl_FragColor = vec4(mix(c, p, k), 1.0);
    }`;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  let fadeFrom = 0;
  sky.onBeforeRender = () => {
    sky.position.copy(camera.position);
    if (fadeFrom) skyMat.uniforms.k.value = Math.min(1, (performance.now() - fadeFrom) / 900);
  };
  const panoLoader = new THREE.TextureLoader(new THREE.LoadingManager());
  const usePano = (t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = false; // mip levels would show a seam where the panorama wraps
    t.minFilter = THREE.LinearFilter;
    const old = skyMat.uniforms.map.value;
    skyMat.uniforms.map.value = t;
    old?.dispose();
    fadeFrom ||= performance.now();
  };
  loadPanorama = () => {
    panoLoader.load(TEX + 'redwoods_sky_m.webp', usePano);
    loadForestWall();
  };
}

// ---------------------------------------------------------------------------
// Textures and materials
//
// Surface textures are photo-scanned Poly Haven maps (see assets/CREDITS.md). Materials
// that use them carry userData.uv = [meters per tile across, meters per tile up]
// and boxes built with them get world-scaled UVs, so boards and tiles line up.

const loader = new THREE.TextureLoader();
const manager = THREE.DefaultLoadingManager;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = new Map();
// The world is low-poly and flat-colored, like the people: surfaces get a single color
// each (the average of the Poly Haven scan they used to wear). The only images left
// are the screenshots on screens (768 px copies in shots/w/), a small redwood bark
// texture and two leaf silhouettes used as alpha maps (see tools/webtex.py).
const SURFACE = {
  asphalt: 0x5e5d58, bark: 0x5a402e, carpet: 0xcccccc, concrete: 0x6b6459, deck: 0x713612,
  fern: 0x2f7f21, floor: 0x3a2917, grass: 0x7b9c45, gravel: 0xada99e, oak: 0xa37654,
  planks: 0x806043, shingle: 0x948979, siding: 0x4d3e32, spray: 0x335925, tile: 0xac9986,
};
const surface = (name, tint = 0xffffff) => new THREE.Color(SURFACE[name]).multiply(new THREE.Color(tint));
function loadTex(path, srgb = true) {
  path = path.replace(/\.(jpg|png)$/, '.webp');
  if (!texCache.has(path)) {
    const t = loader.load(path);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(path, t);
  }
  return texCache.get(path);
}
const tex = (file) => loadTex(SHOTS + 'w/' + file);
const ptex = (file, srgb = true) => loadTex(TEX + file, srgb);

function pbr(name, uv, opts = {}) {
  const { color = 0xffffff, ...rest } = opts.mat ?? {};
  return new THREE.MeshStandardMaterial({ roughness: 0.85, ...rest, color: surface(name, color) });
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
    paintCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
  }
  return paintCache.get(color);
}
function carpet(color) {
  const m = pbr('carpet', [0.6, 0.6], { mat: { color, roughness: 1 } });
  return m;
}

const M = {
  siding: pbr('siding', [1.57, 1.57], { mat: { color: 0xd8c8b8, roughness: 0.8 } }),
  shingle: pbr('shingle', [3, 3], { mat: { roughness: 0.9 } }),
  planks: pbr('planks', [1.7, 1.7], { mat: { roughness: 0.45 } }),
  deck: pbr('deck', [1.8, 1.8], { mat: { color: 0xb8a898, roughness: 0.75 } }),
  tile: pbr('tile', [1.9, 1.9], { mat: { roughness: 1 } }),
  concrete: pbr('concrete', [2.5, 2.5]),
  gravel: pbr('gravel', [2, 2], { mat: { roughness: 1 } }),
  asphalt: pbr('asphalt', [3, 3], { mat: { roughness: 1 } }),
  // Redwood bark keeps a small photo texture (256 px): the trunks fill most of the view.
  bark: new THREE.MeshStandardMaterial({ map: ptex('bark.webp'), roughness: 0.95 }),
  trim: mat(0xf2efe6, { roughness: 0.6 }),
  darkTrim: mat(0x2e2a26, { roughness: 0.6 }),
  stone: pbr('concrete', [1.6, 1.6], { mat: { color: 0x9c958c } }),
  wood: pbr('oak', [1.2, 1.2], { mat: { color: 0xf0e2d0, roughness: 0.45 } }),
  darkWood: pbr('oak', [1.2, 1.2], { mat: { color: 0x8a6448, roughness: 0.45 } }),
  counter: mat(0x3d3b38, { roughness: 0.25 }),
  white: mat(0xf4f2ee, { roughness: 0.35 }),
  steel: mat(0xc9ccd0, { metalness: 0.85, roughness: 0.3 }),
  black: mat(0x161616, { roughness: 0.4 }),
};
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

// Every distinct material setup is its own GPU shader, and on Windows each one can take
// a few hundred ms to compile, freezing the page. So glTF materials are swapped for a
// few shared flat-colored MeshStandardMaterials (only color/roughness/... differ, which
// doesn't need a new shader), and each model's shaders compile in the background
// (compileAsync) before it is shown.
const unified = new Map();
function lowPoly(m) {
  if (!m.isMeshStandardMaterial) return m;
  const glassy = m.transmission > 0;
  const p = {
    color: m.color.getHex(), emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity,
    roughness: +m.roughness.toFixed(2), metalness: +m.metalness.toFixed(2),
    map: m.alphaTest > 0 || m.transparent ? m.map : null, alphaTest: m.alphaTest,
    transparent: m.transparent || glassy, opacity: glassy ? 0.45 : m.opacity, side: m.side, flatShading: true,
  };
  const key = JSON.stringify({ ...p, map: p.map?.uuid ?? null, name: m.name });
  if (!unified.has(key)) unified.set(key, new THREE.MeshStandardMaterial({ ...p, name: m.name }));
  return unified.get(key);
}
const prepare = (obj) => renderer.compileAsync(obj, camera, scene).catch(() => {});
const modelCache = new Map();
function model(name) {
  if (!modelCache.has(name)) {
    // Hosts that can't serve .glb (the Claude preview) get the same model as embedded glTF JSON.
    const load = (url, ok, fail) => gltf.load(url, ok, undefined, fail);
    modelCache.set(name, new Promise((resolve) => {
      const done = (g) => {
        // Some sample models ship their own studio lights; a light appearing mid-load
        // would recompile every shader in the scene, so drop them.
        const lights = [];
        g.scene.traverse((o) => { if (o.isLight) lights.push(o); });
        lights.forEach((l) => l.removeFromParent());
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          // Flat-colored low-poly props (tools/slim.mjs) with faceted shading, like the people.
          o.material = Array.isArray(o.material) ? o.material.map(lowPoly) : lowPoly(o.material);
          for (const m of [o.material].flat()) if (m.map) m.map.channel = 0;
        });
        prepare(g.scene).then(() => resolve(g.scene));
      };
      load(MODELS + name + '.glb', done, () => load(MODELS + name + '.gltf.json', done, () => resolve(null)));
    }));
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
    refreshShadows();
  });
  return holder;
}
// Many copies of a model (ground cover) as one instanced mesh per mesh in the model.
function scatter(name, mats) {
  if (!mats.length) return;
  model(name).then((root) => {
    if (!root) return;
    root.updateMatrixWorld(true);
    // Center the model on its spot: some packs put the plant off its origin, which
    // would grow it a few meters from where it was planted (under floors, say).
    const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    const shift = new THREE.Matrix4().makeTranslation(-c.x, 0, -c.z);
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      if (!o.isMesh) return;
      // Ground cover reads too yellow once flat-colored; pull it toward forest green.
      const gm = o.material.clone();
      gm.color.multiply(new THREE.Color(0.75, 0.95, 0.7));
      const im = new THREE.InstancedMesh(o.geometry, gm, mats.length);
      mats.forEach((w, i) => im.setMatrixAt(i, m.multiplyMatrices(w, shift).multiply(o.matrixWorld)));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      prepare(im).then(() => { scene.add(im); refreshShadows(); });
    });
    refreshShadows();
  });
}
function spin(x, y, z, s, ry = R(0, 6.28)) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
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

function cloth(color) { return mat(color, { roughness: 0.95 }); }

// People: Quaternius characters (CC0) packed by tools/people.mjs, posed in js/people.js.
const characterCache = new Map();
function character(name) {
  if (!characterCache.has(name)) {
    const load = (url, ok, fail) => gltf.load(url, ok, undefined, fail);
    characterCache.set(name, new Promise((resolve) => {
      // Their files carry no normals (tools/slim.mjs), so shade each face flat as designed.
      const done = (g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          // Some GPUs skip meshes with no normals at all; cheap to rebuild once here.
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          o.material = lowPoly(o.material);
        });
        prepare(g.scene).then(() => resolve(g));
      };
      load(PEOPLE + name + '.glb', done, () => load(PEOPLE + name + '.gltf.json', done, () => resolve(null)));
    }));
  }
  return characterCache.get(name);
}

// Pose presets. sit is the seat height; hands are measured from the middle of the body outward.
const POSES = {
  phone: (sit) => ({ sit, lean: 0.15, head: 0.45, phone: [0, sit + 0.47, 0.3], elbows: [0.3, -0.35, -0.1] }),
  // Right hand on the mouse, left on the keyboard: y is the desk top, z how far out they reach.
  desk: (sit, y, z) => ({ sit, lean: 0.25, head: 0.12, hands: [[0.26, y + 0.03, z], [0.08, y + 0.035, z]], along: [0.05, -0.12, 1], grip: 0.25 }),
  lap: (sit) => ({ sit, head: 0.05, hands: [[0.13, sit + 0.15, 0.3], [0.13, sit + 0.15, 0.3]], along: [0.1, -0.35, 1], grip: 0.3 }),
  standPhone: { head: 0.4, phone: [0, 1.2, 0.3], elbows: [0.3, -0.35, -0.1] },
};

// A person, facing +Z, origin on the floor under them. Fills in when the model loads.
// colors recolors materials by name ('Hair' covers every hair material); phone puts that
// screenshot on a phone in their hands; project/shot make them clickable.
function person(name, pose = {}, { s = 1, colors = {}, phone: phoneShot, project, shot } = {}) {
  const holder = new THREE.Group();
  holder.name = 'person:' + name;
  holder.scale.setScalar(s);
  character(name).then((g) => {
    if (!g) return;
    const o = cloneSkinned(g.scene);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true;
      const key = Object.keys(colors).find((k) => m.material.name === k || (k === 'Hair' && m.material.name.startsWith('Hair')));
      if (key) { m.material = m.material.clone(); m.material.color.set(colors[key]); }
    });
    const b = posePerson(o, g.animations[0], { ...pose, scale: s });
    // o is still at the origin, so bone world positions are in the holder's own space.
    if (phoneShot) {
      const ph = phone(phoneShot);
      ph.position.copy(b.phone.position);
      ph.quaternion.copy(b.phone.quaternion);
      ph.scale.setScalar(1 / s);
      holder.add(ph);
    }
    holder.add(o);
    refreshShadows();
    if (project) tag(holder, project, shot);
    holder.traverse((m) => { if (m.isMesh) pickables.push(m); });
  });
  return holder;
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

// QuadStick mouthpiece on a gooseneck, clamped to Dad's wheelchair in front of his face
function quadStick() {
  const frame = mat(0x30343b, { metalness: 0.7, roughness: 0.3 });
  return group(limb(new THREE.Vector3(0.27, 0.6, 0.15), new THREE.Vector3(0.12, 1.05, 0.32), 0.012, frame), bx(0.1, 0.05, 0.05, M.black, 0.04, 1.08, 0.3));
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
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
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

// Older game art hung as a vintage print: yellowed, faded paper on a cream mat in an ornate frame.
function vintagePoster(file, w, h) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round((512 * h) / w);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  new THREE.ImageLoader().load(SHOTS + 'w/' + file.replace(/\.(jpg|png)$/, '.webp'), (img) => {
    const g = c.getContext('2d');
    // Fade toward old newsprint: desaturate, warm, lift the blacks (a canvas filter,
    // not a per-pixel loop, so it doesn't stall the page).
    g.fillStyle = '#28190a'; g.fillRect(0, 0, c.width, c.height);
    g.filter = 'saturate(45%) sepia(35%) contrast(80%)';
    g.globalAlpha = 0.85;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.filter = 'none'; g.globalAlpha = 1;
    const v = g.createRadialGradient(c.width / 2, c.height / 2, c.width * 0.3, c.width / 2, c.height / 2, c.height * 0.62);
    v.addColorStop(0, 'rgba(120,80,30,0)'); v.addColorStop(1, 'rgba(110,70,25,0.45)');
    g.fillStyle = v; g.fillRect(0, 0, c.width, c.height);
    // Foxing spots and an old fold across the middle (Math.random: this runs after the seeded world is built).
    const rr = (lo, hi) => lo + (hi - lo) * Math.random();
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${rr(110, 150) | 0},${rr(70, 95) | 0},30,${rr(0.05, 0.18)})`;
      g.beginPath(); g.arc(rr(0, c.width), rr(0, c.height), rr(1, 6), 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(255,245,220,0.18)'; g.fillRect(0, c.height / 2 - 1, c.width, 2);
    g.fillStyle = 'rgba(60,40,15,0.12)'; g.fillRect(0, c.height / 2 + 1, c.width, 2);
    t.needsUpdate = true;
  });
  const print = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  print.position.z = 0.012;
  const matBoard = bx(w + 0.1, h + 0.1, 0.01, mat(0xe9dfc8, { roughness: 1 }), 0, 0, 0.004);
  const holder = group(print, matBoard);
  model('fancy_picture_frame_01').then((root) => {
    if (!root) return;
    const o = root.clone(true);
    // Drop the frame's own picture; it's the one mesh that is a single quad.
    o.traverse((m) => { if (m.isMesh && m.geometry.attributes.position.count <= 4) m.visible = false; });
    // The frame is landscape (0.6 x 0.46 m): stand it on end and stretch it around the mat.
    o.rotation.z = Math.PI / 2;
    o.scale.set((h + 0.2) / 0.6, (w + 0.2) / 0.46, 1.4);
    o.position.z = -0.006;
    holder.add(o);
  });
  return holder;
}

// Keyboard at the origin with the mouse dx along X, both resting on y = 0.
function keyboardAndMouse(dx = -0.34, color = 0x1f2329) {
  const body = mat(color, { roughness: 0.6 });
  const keys = new THREE.Group();
  const keyM = mat(0x3a3f47, { roughness: 0.7 });
  for (let r = 0; r < 5; r++) keys.add(bx(0.4, 0.008, 0.019, keyM, 0, 0.022, -0.045 + r * 0.023));
  const mouse = mesh(new THREE.SphereGeometry(1, 16, 10), body, dx, 0.012, 0.02);
  mouse.scale.set(0.032, 0.02, 0.055);
  const pad = bx(0.22, 0.003, 0.19, mat(0x2a2d33, { roughness: 1 }), dx, 0.0015, 0.02);
  return group(bx(0.44, 0.018, 0.14, body, 0, 0.009, 0), keys, pad, mouse);
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
  const glow = mesh(new THREE.PlaneGeometry(0.7, 0.35), mat(0xff7a2a, { emissive: 0xff6a1a, emissiveIntensity: 2 }), 0, 0.3, 0.27);
  const g = group(...parts, glow);
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
  const d = ellipseD(x, z) + (noise2(x * 0.05, z * 0.05) - 0.5) * 0.06;
  return THREE.MathUtils.clamp((1 - d) / 0.1, 0, 1);
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
  const W = 2.5 * WORLD_R.x, D = 2.5 * WORLD_R.z, segX = 48, segZ = 48;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WORLD_C.x, 0, WORLD_C.z);
  const pos = geo.attributes.position, uv = geo.attributes.uv, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.setXY(i, x / 2.4, z / 2.4);
    const n = 0.72 + 0.4 * noise2(x * 0.06, z * 0.06) + 0.15 * noise2(x * 0.2 + 7, z * 0.2);
    const f = voidFade(x, z) * n;
    col.push(f, f * 0.98, f * 0.95);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.MeshStandardMaterial({ color: surface('floor', 0xd8c8b0), roughness: 1, vertexColors: true });
  const ground = new THREE.Mesh(geo, m);
  ground.receiveShadow = true;
  scene.add(ground);

  // Asphalt, gravel shoulders and paint
  const gravelM = M.gravel.clone(); gravelM.color.set(0xa9a399);
  ribbon(roadPts, -RW - SHOULDER, -RW + 0.05, 0.012, gravelM, [2, 2]);
  ribbon(roadPts, RW - 0.05, RW + SHOULDER, 0.012, gravelM, [2, 2]);
  ribbon(roadPts, -RW, RW, 0.02, M.asphalt, [3, 3]);
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
  const uRep = Math.max(1, Math.round((2 * Math.PI * Rb) / 1.9));
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
      uv.push((j / segs) * uRep, y / 1.9);
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

const leafMat = new THREE.MeshStandardMaterial({ alphaMap: ptex('spray_a.png', false), alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, color: surface('spray', 0xd6e6c4) });
leafMat.alphaMap.wrapS = leafMat.alphaMap.wrapT = THREE.ClampToEdgeWrapping;

const TREE_KINDS = [
  { H: 78, Rb: 2.2, start: 30, crown: 7.5 },
  { H: 64, Rb: 1.6, start: 24, crown: 6.2 },
  { H: 50, Rb: 1.1, start: 17, crown: 5.0 },
  { H: 22, Rb: 0.38, start: 4.5, crown: 2.8 },
];

const trees = []; // { x, z, kind, s, rot }
// The house with its porch, ramp and parking pad, and the bus stop with its sign:
// nothing grows there
const onLot = (x, z, m = 0) =>
  (x > HOUSE.x - 19 - m && x < HOUSE.x + 9 + m && z > HOUSE.z - 7 - m && z < HOUSE.z + 10 + m) ||
  (x > BUS.x - 4.2 - m && x < BUS.x + 5 + m && z > BUS.z - 2.2 - m && z < BUS.z + 2.3 + m);
function clearOf(x, z, r) {
  if (Math.abs(z - roadZ(x)) < RW + SHOULDER + 1.2 + r) return false;
  if (onLot(x, z, r + 1)) return false;
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

const inWorld = () => [WORLD_C.x + R(-WORLD_R.x, WORLD_R.x), WORLD_C.z + R(-WORLD_R.z, WORLD_R.z)];

function plantForest() {
  // Fairy rings: old trees surrounded by younger ones, plus solitary giants
  for (let c = 0; c < 120; c++) {
    const [x, z] = inWorld();
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
  for (let i = 0; i < 160; i++) {
    const [x, z] = inWorld();
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
  const fm = new THREE.MeshStandardMaterial({ alphaMap: ptex('fern_a.png', false), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: surface('fern', 0xc8dcae) });
  fm.alphaMap.wrapS = fm.alphaMap.wrapT = THREE.ClampToEdgeWrapping;
  const spots = [];
  for (let i = 0; i < 2000 && spots.length < 260; i++) {
    let x, z;
    if (rand() < 0.55 && trees.length) {
      const t = trees[Math.floor(rand() * trees.length)];
      const a = R(0, 6.28), d = TREE_KINDS[t.kind].Rb * t.s * 1.6 + R(0.8, 6);
      x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d;
    } else [x, z] = inWorld();
    if (Math.abs(z - roadZ(x)) < RW + SHOULDER + 0.8) continue;
    if (onLot(x, z, 1.6)) continue; // fern fronds reach about 1.5 m out
    if (CLEARINGS.some((c) => ((x - c.x) / (c.rx - 2)) ** 2 + ((z - c.z) / (c.rz - 2)) ** 2 < 1)) continue;
    if (PATHS.some((p) => p.pts.some(([px, pz]) => Math.hypot(x - px, z - pz) < p.w + 0.8))) continue;
    if (voidFade(x, z) < 0.1) continue;
    spots.push([x, z]);
  }
  // The ferns nearest the houses and the road are scanned sword ferns; the rest are cards.
  const near = ([x, z]) => Math.min(Math.hypot(x - HOUSE.x, z - HOUSE.z) * 0.8, Math.abs(z - roadZ(x)) * 1.6);
  spots.sort((a, b) => near(a) - near(b));
  const nReal = LOW ? 120 : 340;
  scatter('fern_02', spots.slice(0, nReal).map(([x, z]) => spin(x, 0, z, R(2.6, 3.6))));
  spots.splice(0, nReal);
  // Redwood sorrel carpets around the closer trunks
  const sorrel = [];
  for (const t of trees) {
    if (sorrel.length >= (LOW ? 160 : 420)) break;
    if (Math.hypot(t.x - HOUSE.x, t.z - HOUSE.z) > 48 && Math.abs(t.z - roadZ(t.x)) > 16) continue;
    const r0 = TREE_KINDS[t.kind].Rb * t.s * 1.7;
    for (let k = 0; k < 6; k++) {
      const a = R(0, 6.28), d = r0 + R(0.2, 3);
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (Math.abs(z - roadZ(x)) < RW + SHOULDER + 0.5 || onLot(x, z, 1)) continue;
      sorrel.push(spin(x, 0, z, R(2.2, 3.2)));
    }
  }
  scatter('shrub_sorrel_01', sorrel);
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
    const [x, z] = inWorld();
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

// The edge of the world: a ring wall painted with the redwoods panorama, its top cut
// along a line of treetops so the sky shows between them. The picture streams in
// after the first frame; until then the wall is see-through (its placeholder is a
// clear pixel), and the same texture object is reused, so nothing recompiles.
const wallTex = new THREE.Texture(Object.assign(document.createElement('canvas'), { width: 1, height: 1 }));
wallTex.colorSpace = THREE.SRGBColorSpace;
wallTex.wrapS = THREE.RepeatWrapping;
wallTex.anisotropy = maxAniso;
wallTex.needsUpdate = true;
function forestWall() {
  const seg = 160, H = 30, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = WORLD_C.x + Math.cos(a) * WORLD_R.x * WALL, z = WORLD_C.z + Math.sin(a) * WORLD_R.z * WALL;
    pos.push(x, -0.3, z, x, H, z);
    uv.push(1 - i / seg, 0, 1 - i / seg, 1);
    if (i < seg) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: wallTex, alphaTest: 0.5, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  scene.add(m);
}
function loadForestWall() {
  new THREE.ImageLoader().load(TEX + (LOW ? 'redwoods_wall_m.webp' : 'redwoods_wall.webp'), (img) => {
    wallTex.dispose(); // the GPU copy is sized for the placeholder; make a new one
    wallTex.image = img;
    wallTex.needsUpdate = true;
  });
}

// ---------------------------------------------------------------------------
// Street furniture

function hydrant(x, z) {
  const p = new Place(x, z, 0.4);
  placeModel(p, 'fire_hydrant', 0, 0, 0, 0, 1.05);
  p.collider(0, 0, 0.18, 0.18, 0, 0.8);
}

function mailbox(x, z, ry, name) {
  // A classic rural mailbox: D-shaped steel body, door facing the road (local -Z), flag on the side.
  const p = new Place(x, z, ry);
  p.box(0.09, 1.1, 0.09, 0, 0.55, 0, M.darkWood, { collide: true });
  p.box(0.24, 0.03, 0.4, 0, 1.115, 0, M.darkWood);
  const steel = mat(0x2b2f33, { metalness: 0.6, roughness: 0.4 });
  const profile = (r, h) => {
    const s = new THREE.Shape();
    s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h); s.absarc(0, h, r, 0, Math.PI, false); s.lineTo(-r, 0);
    return s;
  };
  const extrude = (shape, depth, bevel) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  const body = new THREE.Mesh(extrude(profile(0.1, 0.1), 0.46, 0.006), steel);
  body.position.set(0, 1.135, -0.23);
  const door = new THREE.Mesh(extrude(profile(0.106, 0.1), 0.012, 0.003), mat(0x23272b, { metalness: 0.6, roughness: 0.35 }));
  door.position.set(0, 1.132, -0.25);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 16, Math.PI), M.steel);
  handle.position.set(0, 1.3, -0.27);
  handle.rotation.x = Math.PI / 2;
  // Flag down on the right side, on a little pivot.
  const red = mat(0xc0302a, { roughness: 0.5 });
  const pivot = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), M.steel, 0.112, 1.2, 0.12);
  pivot.rotation.z = Math.PI / 2;
  const arm = bx(0.006, 0.018, 0.2, red, 0.118, 1.2, 0.04);
  const flag = bx(0.006, 0.06, 0.07, red, 0.118, 1.225, -0.04);
  for (const m of [body, door, handle, pivot, arm, flag]) { m.castShadow = true; m.receiveShadow = true; p.group.add(m); }
  void name;
}

function busStop(x, z, rot = 0) {
  // Shelter facing south toward the road
  const p = new Place(x, z, rot);
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
  const sp = new Place(...p.world(4.3, 1.4), rot);
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
  const a = person('bus_punk', POSES.phone(0.6), { colors: { Skin: 0xa86b45 }, phone: 'roadway-phone.jpg', project: 'roadway-rivals', shot: 'roadway-phone.jpg' });
  p.add(a, -1.1, Y - 0.12, -0.92, 0.1);
  // B: standing, playing Bridge Defender
  const b = person('bus_suit', POSES.standPhone, { phone: 'bridge-defender-gameplay.jpg', project: 'bridge-defender', shot: 'bridge-defender-gameplay.jpg' });
  p.add(b, 0.9, Y, 0.15, -0.35);
  p.collider(0.9, 0.15, 0.25, 0.25, 0, 1.8);
  // C: waiting, looking down the road for the bus
  const cc = person('bus_worker', { head: -0.05 }, { colors: { Skin: 0x6e4329 } });
  p.add(cc, 2.3, Y, 0.4, Math.PI / 2 + 0.3);
  p.collider(2.3, 0.4, 0.25, 0.25, 0, 1.8);
  // D: on the bench, hands in lap
  const d = person('bus_farmer', POSES.lap(0.6));
  p.add(d, -2.0, Y - 0.12, -0.92, -0.05);

  const [ix, iz] = p.world(-1.1, -0.8), [jx, jz] = p.world(0.9, 0.2);
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
  const sx0 = 1.2, sx1 = 2.4, sTop = -0.6, sBot = 4.4; // stairs, rising toward the back
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
  iw(2.5, Z0, 2.5, Z1, 0, [door(3.8, 5.0), door(10.6, 11.7)]); // hall | grandparents/den (den door past the foot of the stairs)
  iw(2.5, 0, X1, 0, 0, []); // grandparents | den
  iw(-1, -3.5, 2.5, -3.5, 0, [door(0.4, 1.3)]); // bathroom
  // Upstairs
  iw(-1, Z0, -1, Z1, 1, [door(4.5, 5.5), door(7.0, 8.0)]); // son/parents | hall
  iw(2.5, Z0, 2.5, Z1, 1, [door(4.0, 5.0), door(10.9, 11.9)]); // hall | daughter/bath
  iw(X0, 0, -1, 0, 1, []);
  iw(2.5, 0, X1, 0, 1, []);

  // Stairs: open on the hall side with a handrail, so they read as stairs from the
  // front door. 18 risers of 17 cm and 28 cm treads, like a real house.
  const steps = 18, run = (sBot - sTop) / steps, rise = LEVEL / steps;
  for (let i = 0; i < steps; i++) {
    const top = FL + (i + 1) * rise;
    h.box(sx1 - sx0, top, run, (sx0 + sx1) / 2, top / 2, sBot - (i + 0.5) * run, [M.darkWood, M.darkWood, M.planks, M.darkWood, paint(0xf1ede4), M.darkWood], { shadow: false });
  }
  h.floor((sx0 + sx1) / 2, (sTop + sBot) / 2, (sx1 - sx0) / 2, (sBot - sTop) / 2, (lx, lz) => FL + THREE.MathUtils.clamp(0.5 - lz / (sBot - sTop), 0, 1) * LEVEL);
  // Side rail: keeps the visitor on the treads and off the hall floor below
  h.collider(sx0 - 0.04, (sTop + sBot - 0.4) / 2, 0.04, (sBot - sTop - 0.4) / 2, 0, UP - 0.3);
  const rail = M.darkWood, baluster = M.trim;
  const slope = Math.atan2(LEVEL, sBot - sTop);
  const hand = h.box(0.06, 0.06, Math.hypot(LEVEL, sBot - sTop), 0, 0, 0, rail, { localUV: true });
  hand.rotation.x = slope;
  hand.position.set(sx0 - 0.03, FL + LEVEL / 2 + 0.9, (sTop + sBot) / 2);
  for (let i = 1; i < steps; i += 2) {
    const top = FL + (i + 1) * rise;
    h.box(0.03, 0.88, 0.03, sx0 - 0.03, top + 0.44, sBot - (i + 0.5) * run, baluster, { shadow: false });
  }
  h.box(0.1, 1.05, 0.1, sx0 - 0.03, FL + 0.52, sBot - 0.1, rail); // newel post
  // Railings around the stairwell upstairs
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
  // The ramp leaves the west end of the porch, toward the drive
  const rampL = 5.4, rz0 = Z1 + 0.6, rz1 = Z1 + 1.9, RE = PX0, rs = -1;
  const rampGeo = new THREE.BoxGeometry(rampL, 0.1, rz1 - rz0);
  planarUV(rampGeo, 0, 0, 0, M.deck);
  const ramp = new THREE.Mesh(rampGeo, M.deck);
  ramp.position.set(RE + (rs * rampL) / 2, FL / 2 - 0.02, (rz0 + rz1) / 2);
  ramp.rotation.z = -rs * Math.atan2(FL, rampL);
  ramp.receiveShadow = ramp.castShadow = true;
  h.group.add(ramp);
  h.floor(RE + (rs * rampL) / 2, (rz0 + rz1) / 2, rampL / 2, (rz1 - rz0) / 2, (lx) => FL * (0.5 - (rs * lx) / rampL));
  for (const rz of [rz0 - 0.03, rz1 + 0.03]) {
    h.box(rampL, 0.05, 0.05, RE + (rs * rampL) / 2, FL / 2 + 0.9, rz, rail);
    h.collider(RE + (rs * rampL) / 2, rz, rampL / 2, 0.04, 0, 1.4);
    for (let k = 0; k <= 4; k++) h.box(0.06, 1.0, 0.06, RE + (rs * k * rampL) / 4, FL * (1 - k / 4) + 0.45, rz, M.trim, { shadow: false });
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
  h.box(0.06, 0.06, rz0 - PZ0, RE - rs * 0.03, FL + 0.9, (PZ0 + rz0) / 2, M.trim);
  h.box(0.06, 0.06, PZ1 - rz1, RE - rs * 0.03, FL + 0.9, (rz1 + PZ1) / 2, M.trim);
  h.collider(RE - rs * 0.03, (PZ0 + rz0) / 2, 0.05, (rz0 - PZ0) / 2, FL, FL + 1);
  h.collider(RE - rs * 0.03, (rz1 + PZ1) / 2, 0.05, (PZ1 - rz1) / 2, FL, FL + 1);
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
  placeModel(h, 'throw_pillows_01', swX + 0.35, FL + 0.51, swZ - 0.08, 0, 0.75);
  h.collider(swX, swZ, 0.8, 0.35, FL, FL + 1.4);
  const grandpa = person('grandpa', POSES.phone(0.51), { colors: { LightBrown: 0x5b2a2a }, phone: 'fct-phone.jpg', project: 'family-card-table', shot: 'fct-phone.jpg' });
  h.add(grandpa, swX - 0.3, FL, swZ + 0.05);
  const [gpx, gpz] = h.world(swX, swZ);
  addIcon('family-card-table', gpx, 3.7, gpz);
  plant(h, PX1 - 0.6, FL, PZ1 - 0.6, 1.0);
  placeModel(h, 'SheenChair', -6, FL, Z1 + 1.2, 0.3, 1.2);
  placeModel(h, 'Rockingchair_01', -4.7, FL, Z1 + 1.3, -0.3, 1.05);

  // ---- Living room: Mom on the sofa, playing Roadway Rivals with her son ----
  h.add(fireplace(), X0 + 0.35, FL, 3.0, Math.PI / 2);
  h.collider(X0 + 0.35, 3.0, 0.3, 1.0, FL, FL + 1.3);
  const tv = tvScreen(1.5); h.add(tv, X0 + 0.15, FL + 2.0, 3.0, Math.PI / 2);
  h.add(rug(2.8, 2.0, ['#7b4b3a', '#d8c7a8', '#3f2a22']), -4.6, FL, 3.0);
  placeModel(h, 'GlamVelvetSofa', -2.6, FL, 3.0, -Math.PI / 2, 1.05);
  h.collider(-2.4, 3.0, 0.45, 1.15, FL, FL + 0.8);
  const mom = person('mom', POSES.phone(0.47), { colors: { White: 0x2a9d8f, Orange: 0x2b3a55, Hair: 0x5a3417 }, phone: 'roadway-phone.jpg', project: 'roadway-rivals', shot: 'roadway-phone.jpg' });
  h.add(mom, -2.65, FL, 3.3, -Math.PI / 2);
  placeModel(h, 'CoffeeTable_01', -4.4, FL, 3.0, Math.PI / 2, 0.78);
  placeModel(h, 'ceiling_fan', -3.4, FL + LEVEL - 0.05, 3.0, 0, 1.0);
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
  placeModel(h, 'electric_stove', -1.9, FL, Z0 + 0.36, 0, 1.25);
  placeModel(h, 'potted_plant_04', -6.6, FL + 0.9, Z0 + 0.45, 0.6, 1.2);
  placeModel(h, 'wall_clock', X0 + 0.11, FL + 2.05, Z0 + 1.2, Math.PI / 2, 1.0);
  h.box(0.8, 0.5, 0.5, -1.9, FL + 2.0, Z0 + 0.35, M.steel);
  h.add(fridge(), X0 + 0.5, FL, -1.0, Math.PI / 2);
  h.collider(X0 + 0.5, -1.0, 0.38, 0.45, FL, FL + 1.9);
  placeModel(h, 'dining_table', -4.3, FL, -2.7, 0, 1, (o) => o.scale.set(0.72, 0.865, 0.8));
  h.collider(-4.3, -2.7, 0.8, 0.48, FL, FL + 0.8);
  const lap = laptop('fct-desktop.jpg');
  h.add(lap, -4.3, FL + 0.76, -2.42, 0);
  tag(lap, 'family-card-table', 'fct-desktop.jpg');
  placeModel(h, 'dining_chair_02', -4.3, FL, -1.75, Math.PI, 1.05);
  const grandma = person('grandma', { ...POSES.desk(0.48), hands: [[0.1, 0.795, 0.5], [0.1, 0.795, 0.5]] }, { colors: { Hair: 0xd1d5db }, project: 'family-card-table', shot: 'fct-desktop.jpg' });
  h.add(grandma, -4.3, FL, -1.75, Math.PI);
  for (const [cx2, cz2, r2] of [[-5.35, -2.7, Math.PI / 2], [-3.25, -2.7, -Math.PI / 2], [-4.3, -3.65, 0]]) placeModel(h, 'dining_chair_02', cx2, FL, cz2, r2, 1.05);
  const vaseB = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.18, 16), mat(0x5a7f8f, { roughness: 0.2 }), 0, 0.09, 0);
  h.add(group(vaseB), -3.8, FL + 0.76, -2.55);
  const [gx, gz] = h.world(-4.3, -1.8);
  addIcon('family-card-table', gx, FL + 2.0, gz);

  // ---- Dad's den: wheelchair, 40" monitor with RubeCube and BetterTalk ----
  placeModel(h, 'metal_office_desk', X1 - 0.5, FL, 2.5, -Math.PI / 2, 0.93);
  h.collider(X1 - 0.5, 2.5, 0.4, 0.9, FL, FL + 0.8);
  const big = monitor(0.885, 0.498, 'screen-rubecube-bettertalk.jpg', 0.16);
  h.add(big, X1 - 0.38, FL + 0.74, 2.5, -Math.PI / 2);
  // Clicking the corner of this screen opens BetterTalk; the rest is RubeCube.
  tag(big, 'rubecube', 'rubecube-desktop.jpg');
  big.userData.screen.userData.split = { project: 'bettertalk', shot: 'bettertalk-main.png', u0: 0.69, v1: 0.37 };
  placeModel(h, 'wheelchair_01', X1 - 1.65, FL, 2.5, Math.PI / 2, 1.0);
  h.add(quadStick(), X1 - 1.65, FL, 2.5, Math.PI / 2);
  // Dad drives everything with the QuadStick, so his hands rest in his lap.
  const dad = person('dad', { ...POSES.lap(0.5), head: -0.05 }, { colors: { Purple: 0x34568b }, project: 'bettertalk', shot: 'bettertalk-main.png' });
  h.add(dad, X1 - 1.65, FL, 2.5, Math.PI / 2);
  h.collider(X1 - 1.65, 2.5, 0.45, 0.45, FL, FL + 1.4);
  const [btx, btz] = h.world(X1 - 1.3, 1.1), [rcx, rcz] = h.world(X1 - 1.3, 3.9);
  addIcon('bettertalk', btx, FL + 2.4, btz);
  addIcon('rubecube', rcx, FL + 1.9, rcz);
  // Sofa on the back wall and books on the hall wall, clear of the door by the stairs
  placeModel(h, 'SheenWoodLeatherSofa', 5.0, FL, 0.55, 0, 1.0);
  h.collider(5.0, 0.55, 1.35, 0.45, FL, FL + 0.9);
  h.add(bookshelf(1.2, 2.0), 2.75, FL, 2.4, Math.PI / 2);
  h.collider(2.75, 2.4, 0.2, 0.6, FL, FL + 2);
  plant(h, X1 - 0.5, FL, Z1 - 0.5, 1.0);
  h.add(rug(2.2, 1.6, ['#3b4a5a', '#c8b48a', '#1f2a36']), 5.4, FL, 2.5);

  // ---- Grandparents' room ----
  h.add(bed(1.6, 2.05, 0x8a6f9e), 5.2, FL, Z0 + 1.15);
  h.collider(5.2, Z0 + 1.15, 0.85, 1.08, FL, FL + 0.7);
  for (const nx of [4.0, 6.4]) { placeModel(h, 'ClassicNightstand_01', nx, FL, Z0 + 0.3, 0, 1.0); placeModel(h, 'IridescenceLamp', nx, FL + 0.7, Z0 + 0.3, 0, 0.9); }
  h.add(dresser(1.2), X1 - 0.35, FL, -1.2, -Math.PI / 2);
  placeModel(h, 'SheenChair', 3.3, FL, -0.8, 2.4, 1.2);
  h.add(rug(1.8, 1.2, ['#b9a07a', '#6b4f3a', '#efe3c8']), 5.2, FL, -2.0);

  // ---- Downstairs bathroom and hall ----
  h.add(toilet(), 1.9, FL, Z0 + 0.4);
  h.add(vanity(0.9), -0.35, FL, Z0 + 0.35);
  h.add(rug(1.2, 0.7, ['#5c6b5a', '#d9d2c3', '#38443a']), 0.5, FL, 2.0);
  h.add(table(0.9, 0.35, 0.8, M.darkWood, M.darkWood), -0.7, FL, 4.8, Math.PI / 2);

  // ---- Upstairs: the son's room ----
  placeModel(h, 'metal_office_desk', -4.9, UP, Z0 + 0.55, 0, 0.95);
  placeModel(h, 'gamepad', -4.3, UP + 0.75, Z0 + 0.62, 0.4, 1.0);
  h.add(keyboardAndMouse(-0.34), -5.08, UP + 0.75, Z0 + 0.74, Math.PI);
  h.collider(-4.9, Z0 + 0.5, 1.0, 0.38, UP, UP + 0.8);
  const m1 = monitor(0.6, 0.34, 'roadway-desktop.jpg');
  h.add(m1, -5.35, UP + 0.75, Z0 + 0.4);
  tag(m1, 'roadway-rivals', 'roadway-desktop.jpg');
  const m2 = monitor(0.3, 0.53, 'bridge-defender-gameplay.jpg', 0.1);
  h.add(m2, -4.3, UP + 0.75, Z0 + 0.4, -0.25);
  tag(m2, 'bridge-defender', 'bridge-defender-gameplay.jpg');
  h.add(officeChair(0xb91c1c), -5.0, UP, Z0 + 1.3, Math.PI);
  const son = person('son', POSES.desk(0.51, 0.76, 0.5), { s: 0.82, colors: { Purple: 0x2f855a }, project: 'roadway-rivals', shot: 'roadway-desktop.jpg' });
  h.add(son, -5.0, UP, Z0 + 1.3, Math.PI);
  h.add(bed(1.0, 2.0, 0x2b6cb0), X0 + 0.6, UP, -2.0);
  h.collider(X0 + 0.6, -2.0, 0.55, 1.03, UP, UP + 0.7);
  h.add(vintagePoster('roadway-title-phone.jpg', 0.45, 0.8), -2.6, UP + 1.6, -0.08, Math.PI);
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
  placeModel(h, 'desk_lamp_arm_01', 6.1, UP + 0.75, Z0 + 0.35, -0.5, 0.8);
  h.add(keyboardAndMouse(-0.34, 0xe5e7eb), 5.42, UP + 0.75, Z0 + 0.74, Math.PI);
  tag(m3, 'seraph', 'seraph-gameplay.jpg');
  h.add(officeChair(0x6b46c1), 5.5, UP, Z0 + 1.3, Math.PI);
  const daughter = person('daughter', POSES.desk(0.51, 0.76, 0.5), { s: 0.9, project: 'seraph', shot: 'seraph-gameplay.jpg' });
  h.add(daughter, 5.5, UP, Z0 + 1.3, Math.PI);
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
  for (const nz of [1.6, 4.4]) { placeModel(h, 'ClassicNightstand_01', X0 + 0.3, UP, nz, Math.PI / 2, 1.0); placeModel(h, 'IridescenceLamp', X0 + 0.3, UP + 0.7, nz, 0, 0.9); }
  h.add(dresser(1.4, M.darkWood), -3.0, UP, 0.3, 0);
  placeModel(h, 'ChairDamaskPurplegold', -2.0, UP, 5.0, -2.4, 1.2);
  h.add(rug(2.4, 1.8, ['#d9cdb4', '#7a5c44', '#f2ead8']), -4.6, UP, 3.0);

  // ---- Upstairs bathroom ----
  h.add(bathtub(), X1 - 0.5, UP, 2.0);
  h.collider(X1 - 0.5, 2.0, 0.4, 0.85, UP, UP + 0.6);
  h.add(vanity(1.2), 5.0, UP, 0.35);
  h.add(toilet(), 3.3, UP, 0.4);

  // Lights inside: a warm fixture in each room, but only five real lights. Every light
  // costs every pixel, and changing how many there are recompiles every shader.
  const lit = new Set([0, 1, 2, 5, 6]);
  [[-4.5, FL + 2.5, 3, 5], [-4.3, FL + 2.5, -2.7, 5], [5.2, FL + 2.5, 2.5, 4], [5.2, FL + 2.5, -3, 3], [0.6, FL + 2.5, 2, 3], [-4.5, UP + 2.4, -3, 4], [5.2, UP + 2.4, -3, 4], [-4.5, UP + 2.4, 3, 3], [0.2, UP + 2.4, 1.5, 3]].forEach(([lx, ly, lz, i], k) => {
    if (lit.has(k)) {
      const l = new THREE.PointLight(0xffd9a8, i * 1.6, 11, 1.4);
      const [wx, wz] = h.world(lx, lz);
      l.position.set(wx, ly, wz);
      scene.add(l);
    }
    const fixture = mesh(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfff3dd, { emissive: 0xffe2b0, emissiveIntensity: 1.5 }));
    fixture.rotation.x = Math.PI;
    h.add(fixture, lx, ly + 0.45, lz);
  });
  return h;
}

// ---------------------------------------------------------------------------
// Build the world

const HOUSE = { x: 0, z: -20 }; // family house, front facing the road (south), porch steps 5 m from it
const DRIVE_X = HOUSE.x - 17; // drive on the west side, up to Dad's ramp
// Bus stop east of the front walk, its slab right on the road shoulder and square to the road
const BUS_X = HOUSE.x + 13, BUS_ROT = -Math.atan((4 / 32) * Math.cos((BUS_X - 10) / 32));
const BUS = { x: BUS_X, z: roadZ(BUS_X) - RW - SHOULDER - 1.7 / Math.cos(BUS_ROT) };

const frontWalk = polyline([[HOUSE.x + 0.25, HOUSE.z + 9.5], [HOUSE.x + 0.25, HOUSE.z + 11.5], [HOUSE.x - 0.5, roadZ(HOUSE.x) - RW]]);
const drive = polyline([[DRIVE_X, roadZ(DRIVE_X) - RW + 0.2], [DRIVE_X + 1.5, HOUSE.z + 10], [DRIVE_X + 1.5, HOUSE.z + 3]]);
const PATHS = [{ pts: frontWalk, w: 0.8 }, { pts: drive, w: 1.8 }];
const CLEARINGS = [
  { x: HOUSE.x - 3, z: HOUSE.z, rx: 15, rz: 8 },
  { x: HOUSE.x - 2, z: HOUSE.z + 11, rx: 14, rz: 5 },
  { x: BUS.x, z: BUS.z - 0.5, rx: 6, rz: 4 },
  { x: 1, z: roadZ(1), rx: 5, rz: 6 }, // keep the spawn view open
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
  const m = new THREE.MeshStandardMaterial({ alphaMap: am, transparent: true, depthWrite: false, color: surface('grass', 0x7d9c5c), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const msh = new THREE.Mesh(geo, m);
  msh.receiveShadow = true;
  msh.renderOrder = 1;
  scene.add(msh);
}
lawn(HOUSE.x - 2, HOUSE.z + 11, 12, 4.5);
lawn(HOUSE.x + 2, HOUSE.z - 8, 9, 2.5);
const gravelPath = M.gravel.clone(); gravelPath.color.set(0xc2b8a8);
ribbon(frontWalk, -0.75, 0.75, 0.014, M.concrete, [2.5, 2.5]);
ribbon(drive, -1.7, 1.7, 0.013, gravelPath, [2, 2]);
// Parking pad by Dad's ramp
ribbon(polyline([[DRIVE_X + 1.5, HOUSE.z + 10], [DRIVE_X + 1.5, HOUSE.z + 2]]), -2.8, 2.8, 0.0135, gravelPath, [2, 2]);

const LOGS = [[16, -22, 0.4, 8, 0.8], [12, 8, 0.3, 10, 0.9], [-9, 7, 2.2, 8, 0.7]];
for (const [lx, lz, lr, len, r] of LOGS) {
  const dx = (Math.cos(lr) * len) / 2, dz = (-Math.sin(lr) * len) / 2;
  PATHS.push({ pts: [[lx - dx, lz - dz], [lx + dx, lz + dz]], w: r });
}
plantForest();
plantUndergrowth();
for (const l of LOGS) fallenLog(...l);
for (const [sx, sz, sr] of [[14, -16, 1.4], [19, -9, 1.6], [-3, 8, 1.2], [-9, -28, 1.8]]) if (clearOf(sx, sz, sr)) stump(sx, sz, sr);
// Mossy boulders and an old stump or two
for (let i = 0, n = 0; i < 400 && n < 9; i++) {
  const [x, z] = inWorld();
  if (!clearOf(x, z, 2.5)) continue;
  n++;
  const p = new Place(x, z, R(0, 6.28));
  if (n % 3 === 0) { placeModel(p, 'tree_stump_01', 0, 0.1, 0, 0, R(1.3, 1.8)); p.collider(0, 0, 0.9, 0.9, 0, 0.9); } else placeModel(p, 'rock_moss_set_01', 0, 0, 0, 0, R(0.5, 0.8));
}
lightShafts();
forestWall();

const family = familyHouse(HOUSE.x, HOUSE.z, 0);
busStop(BUS.x, BUS.z, BUS_ROT);
hydrant(HOUSE.x - 5, roadZ(HOUSE.x - 5) - RW - SHOULDER - 0.4);
mailbox(DRIVE_X - 2.2, roadZ(DRIVE_X - 2) - RW - SHOULDER - 0.2, Math.PI, 'family');

// Dad's old project car, under a tarp in the drive
const carPlace = new Place(DRIVE_X + 0.7, HOUSE.z + 5, -0.03);
placeModel(carPlace, 'covered_car', 0, 0, 0, 0, 1.0);
carPlace.collider(0, 0, 0.95, 2.2, 0, 1.4);

// ---------------------------------------------------------------------------
// Player

const player = { pos: new THREE.Vector3(1, 0, roadZ(1)), y: 0, yaw: 0, pitch: 0.02, vy: 0 };
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
  start: { x: 1, z: roadZ(1) + 1.5, y: 0, yaw: -0.15, pitch: 0.04 },
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
  // Keep the visitor a step inside the forest wall
  const d = ellipseD(player.pos.x, player.pos.z), dMax = WALL - 0.04;
  if (d > dMax) {
    player.pos.x = WORLD_C.x + ((player.pos.x - WORLD_C.x) * dMax) / d;
    player.pos.z = WORLD_C.z + ((player.pos.z - WORLD_C.z) * dMax) / d;
  }
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
  const near = pickables.filter((o) => o.visible && (o.userData.merged || o.getWorldPosition(_v).distanceToSquared(camera.position) < 200));
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
// Draw calls: the houses are hundreds of small boxes. Every plain, static, opaque mesh
// built so far is merged with the others that share its material, so the GPU draws
// a few dozen batches instead of ~800 boxes. Clickable things stay separate.

function mergeStatic() {
  const buckets = new Map(), done = [];
  const add = (geo, material, o) => {
    const key = [material.uuid, o.castShadow, o.receiveShadow, Object.keys(geo.attributes).sort().join()].join('|');
    if (!buckets.has(key)) buckets.set(key, { material, o, geos: [] });
    buckets.get(key).geos.push(geo);
  };
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.transparent) || o.renderOrder !== 0 || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    for (let a = o; a; a = a.parent) if (a.userData.project || a.userData.split) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (Array.isArray(o.material)) {
      // A box with a material per face: one piece per face group.
      for (const gr of g.groups) {
        const part = g.clone();
        part.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count)));
        part.clearGroups();
        add(part, o.material[gr.materialIndex], o);
      }
      g.dispose();
    } else add(g, o.material, o);
    done.push(o);
  });
  for (const { material, o, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, material);
    m.castShadow = o.castShadow;
    m.receiveShadow = o.receiveShadow;
    m.userData.merged = true;
    scene.add(m);
  }
  for (const o of done) o.removeFromParent();
}
// Faceted shading everywhere: matches the low-poly look and lets the built-in surfaces
// share one shader with the models.
scene.traverse((o) => { for (const m of [o.material ?? []].flat()) if (m.isMeshStandardMaterial) m.flatShading = true; });
mergeStatic();

// ---------------------------------------------------------------------------
// Loop

goTo(SPOTS[location.hash.slice(1)] ?? SPOTS.start);
// No waiting: the world is walkable as soon as it's built, and textures, furniture
// and people stream in behind the visitor. A thin bar at the top shows the progress.
const barEl = document.getElementById('load-bar');
manager.onProgress = (url, done, total) => {
  barEl.firstElementChild.style.width = Math.round((done / total) * 100) + '%';
  refreshShadows(); // leaf and fern cutouts shape their shadows
};
manager.onLoad = () => {
  barEl.hidden = true;
  collectPickables();
};
collectPickables();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let frame = 0;
// Dynamic resolution: if frames take too long (a phone, an old laptop), render fewer
// pixels; when there's headroom again, go back up.
let pr = MAX_PR, prTime = 0, prFrames = 0;
function adaptResolution(raw) {
  prTime += Math.min(raw, 0.25); prFrames++;
  if (prTime < 2) return;
  const ms = (prTime / prFrames) * 1000;
  const next = ms > 34 ? Math.max(0.6, pr - 0.25) : ms < 20 ? Math.min(MAX_PR, pr + 0.25) : pr;
  if (next !== pr) { pr = next; renderer.setPixelRatio(pr); }
  prTime = prFrames = 0;
}
function loop() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  if (started) adaptResolution(raw);
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
  timing.firstFrame ??= Math.round(performance.now());
}
// Compile the shaders in the background (parallel where the browser can) so the
// page stays responsive, then start drawing.
const timing = { built: Math.round(performance.now()) };
renderer.compileAsync(scene, camera).catch(() => {}).then(() => {
  renderer.setAnimationLoop(loop);
  // The panorama waits until the first frame is up
  requestAnimationFrame(() => setTimeout(loadPanorama, 0));
});

// For testing in a headless browser
window.__world = { timing, player, keys, goTo, SPOTS, start, scene, THREE, renderer, camera, colliders, trees, pick, update };
