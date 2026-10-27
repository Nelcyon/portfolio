// The Cul-de-sac: a small first-person world where people use the projects.
//
// Units are meters. North is -Z, east is +X. The cul-de-sac bulb is on the west
// end of a short east-west street. The visitor starts in the middle of the street
// where it opens into the bulb, facing north toward the bus stop corner.

import * as THREE from 'three';
import { PROJECTS, projectById } from './projects.js';

const SHOTS = 'assets/shots/';
const EYE = 1.65;
const RADIUS = 0.3; // visitor's body radius for collisions
const STEP = 0.45; // highest step the visitor can walk up

// Street layout
const BULB = new THREE.Vector2(-20, 0); // cul-de-sac center
const BULB_R = 13; // asphalt radius
const WALK_W = 2.2; // sidewalk width
const STREET_HALF = 5; // asphalt half width
const STREET_END = 46;
const GROUND = { x0: -64, z0: -55, size: 110 };
const BOUNDS = { x0: -58, x1: 42, z0: -44, z1: 44 };

// ---------------------------------------------------------------------------
// Renderer, scene, camera

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 38, 70);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 140);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a4630, 1.1));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
sun.position.set(28, 48, 22);
sun.target.position.set(-12, 0, -4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---------------------------------------------------------------------------
// Materials and textures

const loader = new THREE.TextureLoader();
const manager = THREE.DefaultLoadingManager;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const texCache = new Map();
function tex(file) {
  if (!texCache.has(file)) {
    const t = loader.load(SHOTS + file);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    texCache.set(file, t);
  }
  return texCache.get(file);
}

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
const glass = new THREE.MeshStandardMaterial({ color: 0x9cc7e6, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.1, depthWrite: false });
const darkGlass = mat(0x2b3a48, { roughness: 0.2, metalness: 0.3 });
function screenMat(file) {
  return new THREE.MeshBasicMaterial({ map: tex(file), toneMapped: false });
}

// ---------------------------------------------------------------------------
// Collision and floors
//
// Colliders and floor patches are boxes in the local frame of a "place" (a house,
// or the world itself), so rotated houses work the same as the street.

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
      const [lx, lz] = toLocal(o, pos.x, pos.z);
      if (Math.abs(lx) > o.hx + RADIUS || Math.abs(lz) > o.hz + RADIUS) continue;
      const qx = THREE.MathUtils.clamp(lx, -o.hx, o.hx);
      const qz = THREE.MathUtils.clamp(lz, -o.hz, o.hz);
      let dx = lx - qx, dz = lz - qz;
      let d = Math.hypot(dx, dz);
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
    return { cx, cz, c: this.c, s: this.s, hx, hz };
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
  // Box by size and center. opts.collide adds a matching collider.
  box(w, h, d, x, y, z, material, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    this.group.add(m);
    if (opts.collide) this.collider(x, z, w / 2, d / 2, y - h / 2, y + h / 2);
    return m;
  }
  // A wall along a local axis line, with door and window openings.
  // openings: [{ a0, a1, y0, y1, glass }] measured along the wall from its start.
  wall(x0, z0, x1, z1, yBase, height, material, openings = [], t = 0.2) {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const dir = alongX ? Math.sign(x1 - x0) : Math.sign(z1 - z0);
    const cuts = [...new Set([0, L, ...openings.flatMap((o) => [o.a0, o.a1])])].sort((a, b) => a - b);
    const piece = (u, v, y0, y1) => {
      if (y1 - y0 < 0.01 || v - u < 0.01) return;
      const mid = (u + v) / 2;
      const cx = alongX ? x0 + dir * mid : x0;
      const cz = alongX ? z0 : z0 + dir * mid;
      const w = alongX ? v - u : t, d = alongX ? t : v - u;
      this.box(w, y1 - y0, d, cx, yBase + (y0 + y1) / 2, cz, material, { collide: true });
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const u = cuts[i], v = cuts[i + 1], mid = (u + v) / 2;
      const o = openings.find((op) => op.a0 <= mid && op.a1 >= mid);
      if (!o) { piece(u, v, 0, height); continue; }
      piece(u, v, 0, o.y0);
      piece(u, v, o.y1, height);
      if (o.glass) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(v - u, o.y1 - o.y0), glass);
        const cx = alongX ? x0 + dir * mid : x0, cz = alongX ? z0 : z0 + dir * mid;
        g.position.set(cx, yBase + (o.y0 + o.y1) / 2, cz);
        if (!alongX) g.rotation.y = Math.PI / 2;
        this.group.add(g);
        // Glass still stops you.
        this.collider(cx, cz, alongX ? (v - u) / 2 : t / 2, alongX ? t / 2 : (v - u) / 2, yBase + o.y0, yBase + o.y1);
      }
    }
  }
}

const world = new Place(0, 0, 0);

// ---------------------------------------------------------------------------
// Interactive things: screens, phones, people and floating icons

const interactive = []; // meshes with userData.project
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(1.6, 0.5, 1);
  s.renderOrder = 10;
  return s;
}

function addIcon(projectId, x, y, z) {
  const p = projectById(projectId);
  const s = iconSprite(p);
  s.position.set(x, y, z);
  s.userData = { project: projectId, baseY: y, phase: Math.random() * 6 };
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
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, standH, 0.04), mat(0x222326));
  neck.position.set(0, standH / 2, -0.03);
  const base = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.3, w * 0.6), 0.015, 0.18), mat(0x222326));
  base.position.set(0, 0.008, -0.02);
  g.add(bez, scr, neck, base);
  g.userData.screen = scr;
  return g;
}

function laptop(file) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), mat(0xb8bcc2, { metalness: 0.5, roughness: 0.35 }));
  base.position.y = 0.01;
  const lid = new THREE.Group();
  lid.position.set(0, 0.02, -0.12);
  lid.rotation.x = -0.28;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.012), mat(0xb8bcc2, { metalness: 0.5, roughness: 0.35 }));
  back.position.y = 0.115;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.195), screenMat(file));
  scr.position.set(0, 0.118, 0.007);
  lid.add(back, scr);
  g.add(base, lid);
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
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 8), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86b45, 0x6e4329, 0xe8b894];
// A simple person, facing +Z, origin on the floor under them.
// pose: 'stand' | 'sit'. hands: 'phone' | 'desk' | 'side' | 'lap'. s scales kids.
function person({ s = 1, pose = 'stand', hands = 'side', shirt = 0x3b82f6, pants = 0x2d3340, skin = SKIN[0], hair = 0x2b1d14, seatH = 0.48, handReach = 0.42, handY } = {}) {
  const g = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x * s, y * s, z * s);
  const mSkin = mat(skin), mShirt = mat(shirt), mPants = mat(pants), mHair = mat(hair), mShoe = mat(0x1d1d1f);
  let hipY, shoulderY, headY;
  if (pose === 'stand') {
    hipY = 0.92; shoulderY = 1.42; headY = 1.6;
    for (const sx of [-0.1, 0.1]) {
      g.add(limb(V(sx, hipY, 0), V(sx, 0.09, 0.0), 0.065 * s, mPants));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.24 * s), mShoe);
      shoe.position.copy(V(sx, 0.035, 0.05));
      g.add(shoe);
    }
  } else {
    const hy = seatH / s + 0.06;
    hipY = hy; shoulderY = hy + 0.5; headY = hy + 0.68;
    for (const sx of [-0.1, 0.1]) {
      g.add(limb(V(sx, hy, 0.02), V(sx, hy, 0.42), 0.07 * s, mPants));
      g.add(limb(V(sx, hy, 0.44), V(sx, 0.08, 0.5), 0.06 * s, mPants));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.22 * s), mShoe);
      shoe.position.copy(V(sx, 0.035, 0.56));
      g.add(shoe);
    }
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 * s, (shoulderY - hipY - 0.2) * s, 4, 10), mShirt);
  torso.scale.z = 0.7;
  torso.position.copy(V(0, (hipY + shoulderY) / 2, 0));
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115 * s, 16, 12), mSkin);
  head.position.copy(V(0, headY, 0.01));
  head.castShadow = true;
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.122 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mHair);
  hairM.position.copy(V(0, headY + 0.01, -0.01));
  hairM.rotation.x = -0.25;
  g.add(head, hairM);

  // Arms: shoulder → elbow → hand
  const hand = {
    phone: (sx) => V(sx * 0.35, shoulderY - 0.3, 0.3),
    desk: (sx) => V(sx * 0.9, handY != null ? handY / s : shoulderY - 0.33, handReach / s),
    side: (sx) => V(sx * 1.05, shoulderY - 0.62, 0.02),
    lap: (sx) => V(sx * 0.5, hipY + 0.06, 0.3),
  }[hands];
  for (const sx of [-0.2, 0.2]) {
    const sh = V(sx * 1.05, shoulderY - 0.04, 0);
    const hd = hand(sx);
    const el = sh.clone().lerp(hd, 0.5);
    el.y -= 0.08 * s;
    el.x += Math.sign(sx) * 0.05 * s;
    if (hands === 'side') el.copy(sh).lerp(hd, 0.5);
    g.add(limb(sh, el, 0.05 * s, mShirt), limb(el, hd, 0.045 * s, mSkin));
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

function chair(color = 0x2c2f36) {
  const g = new THREE.Group();
  const m = mat(color);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), m);
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.05), m);
  back.position.set(0, 0.74, -0.22);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42), mat(0x777a80));
  post.position.y = 0.22;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 5), mat(0x333333));
  foot.position.y = 0.03;
  g.add(seat, back, post, foot);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function wheelchair() {
  const g = new THREE.Group();
  const frame = mat(0x30343b, { metalness: 0.6, roughness: 0.35 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.44), mat(0x1f2933));
  seat.position.y = 0.48;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.05), mat(0x1f2933));
  back.position.set(0, 0.78, -0.23);
  g.add(seat, back);
  for (const sx of [-0.29, 0.29]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 28), mat(0x222222));
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(sx, 0.31, -0.08);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.008, 6, 28), frame);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(sx * 1.08, 0.31, -0.08);
    const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), mat(0x222222));
    caster.rotation.z = Math.PI / 2;
    caster.position.set(sx * 0.8, 0.06, 0.32);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.5), frame);
    rail.position.set(sx * 0.85, 0.66, 0.0);
    g.add(wheel, rim, caster, rail);
  }
  // QuadStick mouthpiece on a gooseneck in front of the face
  const neck = limb(new THREE.Vector3(0.27, 0.6, 0.15), new THREE.Vector3(0.12, 1.05, 0.32), 0.012, frame);
  const qs = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), mat(0x111111));
  qs.position.set(0.04, 1.08, 0.3);
  g.add(neck, qs);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function desk(place, w, d, x, z, ry = 0, color = 0xc49a6c) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat(color));
  top.position.y = 0.74;
  g.add(top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), mat(0x3a3a3a));
    leg.position.set(sx * (w / 2 - 0.05), 0.36, sz * (d / 2 - 0.05));
    g.add(leg);
  }
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------
// Ground: one painted texture for grass, sidewalks, driveways and asphalt

const doorPaths = []; // [{ from:[x,z], to:[x,z], w }]

function paintGround() {
  const N = 2048, S = GROUND.size;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const P = (x, z) => [((x - GROUND.x0) / S) * N, ((z - GROUND.z0) / S) * N];
  const M = (m) => (m / S) * N;

  g.fillStyle = '#4f6b35';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = `hsla(${85 + Math.random() * 25},${30 + Math.random() * 20}%,${22 + Math.random() * 16}%,0.55)`;
    g.fillRect(Math.random() * N, Math.random() * N, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }

  const concrete = '#b8b4aa';
  g.fillStyle = concrete;
  let [bx, bz] = P(BULB.x, BULB.y);
  g.beginPath(); g.arc(bx, bz, M(BULB_R + WALK_W), 0, Math.PI * 2); g.fill();
  let [sx, sz] = P(BULB.x, -STREET_HALF - WALK_W);
  g.fillRect(sx, sz, M(STREET_END - BULB.x + 5), M(2 * (STREET_HALF + WALK_W)));
  // Bus stop pad
  [sx, sz] = P(-5.6, -10.4);
  g.fillRect(sx, sz, M(7.4), M(3.3));
  // Walkways and driveways
  g.strokeStyle = concrete;
  g.lineCap = 'butt';
  for (const p of doorPaths) {
    g.lineWidth = M(p.w);
    g.beginPath(); g.moveTo(...P(...p.from)); g.lineTo(...P(...p.to)); g.stroke();
  }
  // Sidewalk joints
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  for (let x = -6; x < STREET_END; x += 1.6) {
    for (const zz of [-STREET_HALF - WALK_W, STREET_HALF]) {
      const [a, b] = P(x, zz); g.beginPath(); g.moveTo(a, b); g.lineTo(a, b + M(WALK_W)); g.stroke();
    }
  }

  // Asphalt and curb
  g.fillStyle = '#3b3d41';
  g.beginPath(); g.arc(bx, bz, M(BULB_R), 0, Math.PI * 2); g.fill();
  [sx, sz] = P(BULB.x, -STREET_HALF);
  g.fillRect(sx, sz, M(STREET_END - BULB.x + 5), M(2 * STREET_HALF));
  g.save();
  g.beginPath(); g.arc(bx, bz, M(BULB_R), 0, Math.PI * 2); g.rect(sx, sz, M(STREET_END - BULB.x + 5), M(2 * STREET_HALF)); g.clip();
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    g.fillRect(Math.random() * N, Math.random() * N, 3, 3);
  }
  g.restore();
  g.strokeStyle = '#8f8b83'; g.lineWidth = M(0.18);
  const a0 = Math.asin(STREET_HALF / BULB_R);
  g.beginPath(); g.arc(bx, bz, M(BULB_R), a0, Math.PI * 2 - a0); g.stroke();
  for (const zz of [-STREET_HALF, STREET_HALF]) {
    const x0 = BULB.x + Math.sqrt(BULB_R ** 2 - STREET_HALF ** 2);
    g.beginPath(); g.moveTo(...P(x0, zz)); g.lineTo(...P(STREET_END + 5, zz)); g.stroke();
  }
  // Faded center line on the straight street
  g.strokeStyle = 'rgba(230,190,60,0.7)'; g.lineWidth = M(0.12);
  g.setLineDash([M(3), M(3)]);
  g.beginPath(); g.moveTo(...P(-2, 0)); g.lineTo(...P(STREET_END + 5, 0)); g.stroke();
  g.setLineDash([]);
  // Bus stop marking
  g.strokeStyle = 'rgba(240,240,240,0.8)'; g.lineWidth = M(0.12);
  [sx, sz] = P(-5, -STREET_HALF + 0.2);
  g.strokeRect(sx, sz, M(6.5), M(2.4));
  g.fillStyle = 'rgba(240,240,240,0.8)';
  g.font = `bold ${M(0.9)}px sans-serif`; g.textAlign = 'center';
  g.fillText('BUS', ...P(-1.75, -3.3));

  // Fade the edges into the black void
  const fade = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
  };
  const F = M(9);
  fade(0, 0, F, 0); g.fillRect(0, 0, F, N);
  fade(N, 0, N - F, 0); g.fillRect(N - F, 0, F, N);
  fade(0, 0, 0, F); g.fillRect(0, 0, N, F);
  fade(0, N, 0, N - F); g.fillRect(0, N - F, N, F);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(GROUND.x0 + S / 2, 0, GROUND.z0 + S / 2);
  plane.receiveShadow = true;
  scene.add(plane);
}

// ---------------------------------------------------------------------------
// Street furniture

function hydrant(x, z) {
  const p = new Place(x, z);
  const red = mat(0xc8262b, { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 16), red);
  body.position.y = 0.3;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red);
  cap.position.y = 0.6;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 6), mat(0xb8b8b0));
  top.position.y = 0.76;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), red);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.y = 0.42;
  const front = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), red);
  front.rotation.x = Math.PI / 2;
  front.position.set(0, 0.36, 0.14);
  p.group.add(body, cap, top, nozzle, front);
  p.group.traverse((o) => (o.castShadow = true));
  p.collider(0, 0, 0.18, 0.18, 0, 0.8);
}

function streetLight(x, z, ry) {
  const p = new Place(x, z, ry);
  const pole = mat(0x4a4d52, { metalness: 0.5, roughness: 0.5 });
  p.box(0.12, 5, 0.12, 0, 2.5, 0, pole, { collide: true });
  p.box(0.1, 0.1, 1.6, 0, 4.95, 0.8, pole);
  p.box(0.35, 0.12, 0.6, 0, 4.88, 1.55, mat(0xfff6d8, { emissive: 0xfff2cc, emissiveIntensity: 0.6 }));
}

function tree(x, z, s = 1) {
  const p = new Place(x, z, Math.random() * 6);
  p.box(0.3 * s, 2.2 * s, 0.3 * s, 0, 1.1 * s, 0, mat(0x5a3d26), { collide: true });
  const leaf = mat([0x3f6b2a, 0x4b7a31, 0x36602a][Math.floor(Math.random() * 3)]);
  for (const [dx, dy, dz, r] of [[0, 3.0, 0, 1.5], [0.7, 2.6, 0.3, 1.1], [-0.6, 2.7, -0.4, 1.15], [0.1, 3.7, 0.2, 1.0]]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), leaf);
    m.position.set(dx * s, dy * s, dz * s);
    m.castShadow = true;
    p.group.add(m);
  }
}

function car(x, z, ry, color) {
  const p = new Place(x, z, ry);
  const paint = mat(color, { roughness: 0.35, metalness: 0.4 });
  p.box(1.8, 0.7, 4.3, 0, 0.62, 0, paint);
  const cab = p.box(1.6, 0.6, 2.3, 0, 1.25, -0.2, darkGlass);
  p.box(1.62, 0.06, 2.0, 0, 1.56, -0.25, paint);
  for (const sx of [-0.85, 0.85]) for (const sz of [-1.35, 1.35]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18), mat(0x111111));
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.34, sz);
    w.castShadow = true;
    p.group.add(w);
  }
  p.box(1.5, 0.12, 0.05, 0, 0.75, 2.16, mat(0xfff6dd, { emissive: 0xfff6dd, emissiveIntensity: 0.2 }), { shadow: false });
  p.box(1.5, 0.12, 0.05, 0, 0.75, -2.16, mat(0x9b1c1c, { emissive: 0x9b1c1c, emissiveIntensity: 0.2 }), { shadow: false });
  p.collider(0, 0, 0.95, 2.2, 0, 1.6);
  return cab;
}

function busStop() {
  const p = new Place(-2, -8.8);
  const frame = mat(0x2f3338, { metalness: 0.6, roughness: 0.4 });
  // Shelter: 6 m long, 2.2 m deep, open to the street (south)
  for (const x of [-3, 3]) for (const z of [-1.1, 1.0]) p.box(0.1, 2.6, 0.1, x, 1.3, z, frame, { collide: true });
  const roof = p.box(6.5, 0.12, 2.6, 0, 2.66, -0.05, mat(0x3a4a5c, { metalness: 0.3 }));
  roof.rotation.x = -0.05;
  p.box(6.0, 0.1, 0.1, 0, 2.55, 1.0, frame);
  // Back and side glass
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), glass);
  back.position.set(0, 1.3, -1.1);
  p.group.add(back);
  p.collider(0, -1.1, 3, 0.06, 0, 2.6);
  for (const x of [-3, 3]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), glass);
    side.rotation.y = Math.PI / 2;
    side.position.set(x, 1.3, -0.4);
    p.group.add(side);
    p.collider(x, -0.4, 0.06, 0.7, 0, 2.6);
  }
  // Bench along the back
  p.box(4.4, 0.06, 0.45, -0.3, 0.45, -0.8, mat(0x8a6a48), { collide: false });
  p.box(4.4, 0.4, 0.06, -0.3, 0.75, -1.02, mat(0x8a6a48));
  for (const x of [-2.3, -0.3, 1.7]) p.box(0.06, 0.45, 0.4, x, 0.22, -0.8, frame);
  p.collider(-0.3, -0.85, 2.2, 0.28, 0, 0.5);
  // Map and route board on the east end
  const board = p.box(0.08, 1.3, 1.0, 3.06, 1.35, -0.4, mat(0x1d4ed8, { emissive: 0x0b2a80, emissiveIntensity: 0.3 }));
  // Bus stop sign
  const sp = new Place(2.3, -7.4);
  sp.box(0.07, 2.8, 0.07, 0, 1.4, 0, frame, { collide: true });
  const sign = document.createElement('canvas');
  sign.width = 256; sign.height = 320;
  const g = sign.getContext('2d');
  g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#fff'; g.font = 'bold 92px sans-serif'; g.textAlign = 'center';
  g.fillText('BUS', 128, 120); g.font = 'bold 40px sans-serif'; g.fillText('STOP', 128, 180);
  g.font = '28px sans-serif'; g.fillText('Route 7', 128, 250); g.fillText('Downtown', 128, 290);
  const st = new THREE.CanvasTexture(sign); st.colorSpace = THREE.SRGBColorSpace;
  const signM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.02), [frame, frame, frame, frame, new THREE.MeshStandardMaterial({ map: st }), new THREE.MeshStandardMaterial({ map: st })]);
  signM.position.set(0, 2.5, 0);
  signM.castShadow = true;
  sp.group.add(signM);

  // People waiting. A: on the bench playing Roadway Rivals with the kid upstairs.
  const a = person({ pose: 'sit', hands: 'phone', shirt: 0x7c3aed, pants: 0x1f2937, skin: SKIN[2], hair: 0x111111 });
  p.add(a, -1.6, 0, -0.98, 0.15);
  tag(a, 'roadway-rivals', 'roadway-phone.jpg');
  tag(givePhone(a, 'roadway-phone.jpg'), 'roadway-rivals', 'roadway-phone.jpg');
  // B: standing, playing Bridge Defender
  const b = person({ hands: 'phone', shirt: 0xf97316, pants: 0x334155, skin: SKIN[0], hair: 0x8b5a2b });
  p.add(b, 0.9, 0, 0.15, -0.35);
  tag(b, 'bridge-defender', 'bridge-defender-portrait.jpg');
  tag(givePhone(b, 'bridge-defender-portrait.jpg'), 'bridge-defender', 'bridge-defender-portrait.jpg');
  p.collider(0.9, 0.15, 0.25, 0.25, 0, 1.8);
  // C: waiting, looking down the street for the bus
  const cc = person({ shirt: 0x0f766e, pants: 0x3f3f46, skin: SKIN[3], hair: 0x1c1917 });
  p.add(cc, 2.3, 0, 0.4, Math.PI / 2 + 0.3);
  p.collider(2.3, 0.4, 0.25, 0.25, 0, 1.8);
  // D: on the bench, hands in lap
  const d = person({ pose: 'sit', hands: 'lap', shirt: 0xbe123c, pants: 0x44403c, skin: SKIN[1], hair: 0x9ca3af });
  p.add(d, -2.6, 0, -0.98, -0.1);

  addIcon('roadway-rivals', -3.6, 3.4, -9.6);
  addIcon('bridge-defender', -1.1, 3.4, -8.6);
}

// ---------------------------------------------------------------------------
// Houses
//
// Each house is 11 m wide (local X) and 9 m deep (local Z), two floors, with its
// front facing local +Z. Floors sit 0.1 m above the ground.

const HW = 11, HD = 9, LEVEL = 3, FL = 0.1;
const ext = (o) => ({ ...o, glass: o.glass ?? true });

function houseShell(place, { wallColor, trimColor, roofColor, frontOpen, sideOpen = [], backOpen = [], upperFront, enterable }) {
  const wallM = mat(wallColor);
  const xL = -HW / 2, xR = HW / 2, zB = -HD / 2, zF = HD / 2;
  // Foundation + ground floor slab
  place.box(HW, FL, HD, 0, FL / 2, 0, mat(0x9b958a), { shadow: false });
  if (enterable) place.box(HW - 0.4, 0.01, HD - 0.4, 0, FL + 0.005, 0, mat(0xb08a62), { shadow: false });
  for (let lvl = 0; lvl < 2; lvl++) {
    const y = FL + lvl * LEVEL;
    const fo = lvl === 0 ? frontOpen : upperFront;
    const win = (a0, a1) => ext({ a0, a1, y0: 1.0, y1: 2.2 });
    place.wall(xL, zF, xR, zF, y, LEVEL, wallM, fo);
    place.wall(xL, zB, xR, zB, y, LEVEL, wallM, lvl === 0 ? backOpen : [win(2, 4), win(7, 9)]);
    place.wall(xL, zB, xL, zF, y, LEVEL, wallM, lvl === 0 ? sideOpen : [win(3.5, 5.5)]);
    place.wall(xR, zB, xR, zF, y, LEVEL, wallM, lvl === 0 ? sideOpen : [win(3.5, 5.5)]);
  }
  // Trim band between floors
  place.box(HW + 0.1, 0.18, HD + 0.1, 0, FL + LEVEL, 0, mat(trimColor), { shadow: false });
  // Gable roof (ridge parallel to the front)
  const shape = new THREE.Shape();
  shape.moveTo(-HD / 2 - 0.5, 0); shape.lineTo(HD / 2 + 0.5, 0); shape.lineTo(0, 2.6); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: HW + 0.6, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-(HW + 0.6) / 2, 0, 0);
  const roof = new THREE.Mesh(geo, mat(roofColor, { side: THREE.DoubleSide }));
  roof.position.y = FL + 2 * LEVEL;
  roof.castShadow = true;
  place.group.add(roof);
  // Floor so the visitor can stand inside
  place.floor(0, 0, HW / 2, HD / 2, FL);
}

function windowsFront(doorX, opts = {}) {
  // Ground floor front: a door at doorX (local X) and two windows away from it.
  const a = doorX + HW / 2;
  const o = [{ a0: a - 0.6, a1: a + 0.6, y0: 0, y1: 2.2, glass: false }];
  for (const wa of opts.windows ?? [1.2, 8.6]) if (Math.abs(wa + 0.9 - a) > 1.6) o.push(ext({ a0: wa, a1: wa + 1.8, y0: 0.9, y1: 2.2 }));
  return o;
}

function closedDoor(place, doorX, color) {
  place.box(1.2, 2.2, 0.08, doorX, FL + 1.1, HD / 2 + 0.15, mat(color));
  place.box(0.06, 0.06, 0.06, doorX + 0.45, FL + 1.05, HD / 2 + 0.22, mat(0xd4af37, { metalness: 0.8, roughness: 0.3 }));
}

function porchSteps(place, doorX, width = 1.6) {
  place.box(width, 0.1, 0.5, doorX, 0.05, HD / 2 + 0.35, mat(0xa8a399), { shadow: false });
}

// House 1, by the bus stop: wheelchair user downstairs, kids upstairs.
function house1(x, z, rot) {
  const h = new Place(x, z, rot);
  const doorX = 2.5;
  houseShell(h, {
    wallColor: 0xe9dfcc, trimColor: 0xffffff, roofColor: 0x5b4b45, enterable: true,
    frontOpen: windowsFront(doorX, { windows: [1.0, 4.4] }),
    upperFront: [ext({ a0: 1.2, a1: 3.4, y0: 1.0, y1: 2.2 }), ext({ a0: 6.0, a1: 8.2, y0: 1.0, y1: 2.2 })],
    sideOpen: [ext({ a0: 3.5, a1: 5.5, y0: 1.0, y1: 2.2 })],
    backOpen: [ext({ a0: 6, a1: 8, y0: 1.0, y1: 2.2 })],
  });
  porchSteps(h, doorX);

  // Upstairs floor with a stairwell along the west wall.
  const sx0 = -HW / 2 + 0.1, sx1 = -4.2, szTop = -1.8, szBot = 3.0;
  const upY = FL + LEVEL;
  const slab = mat(0xf3efe6);
  const slabPart = (x0, x1, z0, z1) => {
    h.box(x1 - x0, 0.2, z1 - z0, (x0 + x1) / 2, upY - 0.1, (z0 + z1) / 2, slab, { shadow: true });
    h.box(x1 - x0, 0.02, z1 - z0, (x0 + x1) / 2, upY + 0.01, (z0 + z1) / 2, mat(0xa98258), { shadow: false });
    h.floor((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, upY);
  };
  slabPart(sx1, HW / 2 - 0.1, -HD / 2 + 0.1, HD / 2 - 0.1);
  slabPart(sx0, sx1, -HD / 2 + 0.1, szTop);
  slabPart(sx0, sx1, szBot, HD / 2 - 0.1);
  // Ceiling up top
  h.box(HW - 0.2, 0.1, HD - 0.2, 0, upY + LEVEL - 0.05, 0, mat(0xf3efe6), { shadow: false });

  // Stairs: 16 steps rising toward the back
  const steps = 16, run = (szBot - szTop) / steps, rise = LEVEL / steps;
  const stairM = mat(0x8b6a4a);
  for (let i = 0; i < steps; i++) {
    const top = FL + (i + 1) * rise;
    h.box(sx1 - sx0, top, run, (sx0 + sx1) / 2, top / 2, szBot - (i + 0.5) * run, stairM, { shadow: false });
  }
  h.floor((sx0 + sx1) / 2, (szTop + szBot) / 2, (sx1 - sx0) / 2, (szBot - szTop) / 2,
    (lx, lz) => FL + THREE.MathUtils.clamp((szBot - lz) / (szBot - szTop), 0, 1) * LEVEL);
  // Side panel of the stairs on the ground floor, and railings around the well upstairs.
  h.collider(sx1 + 0.05, (szTop + szBot) / 2 - 0.4, 0.05, (szBot - szTop) / 2 - 0.4, 0, upY - 0.2);
  const rail = mat(0xffffff);
  h.box(0.06, 1.0, szBot - szTop, sx1 + 0.03, upY + 0.5, (szTop + szBot) / 2, rail, { collide: true });
  h.box(sx1 - sx0, 1.0, 0.06, (sx0 + sx1) / 2, upY + 0.5, szBot + 0.03, rail, { collide: true });

  // Downstairs: the 40" monitor on a desk against the east wall
  const deskG = desk(h, 1.8, 0.8, 0, 0);
  h.add(deskG, 5.0, FL, -0.5, Math.PI / 2);
  h.collider(5.0, -0.5, 0.4, 0.9, 0, 0.8);
  const tv = monitor(0.885, 0.498, 'screen-rubecube-bettertalk.jpg', 0.16);
  h.add(tv, 5.12, FL + 0.76, -0.5, -Math.PI / 2);
  // Clicking the corner of this screen opens BetterTalk; the rest is RubeCube.
  tag(tv, 'rubecube', 'rubecube-desktop.jpg');
  tv.userData.screen.userData.split = { project: 'bettertalk', shot: 'bettertalk-main.png', u0: 0.69, v1: 0.37 };
  const wc = wheelchair();
  h.add(wc, 3.85, FL, -0.5, Math.PI / 2);
  const rider = person({ pose: 'sit', hands: 'lap', shirt: 0x2563eb, pants: 0x374151, skin: SKIN[4], hair: 0x5b3a1e, seatH: 0.5 });
  h.add(rider, 3.85, FL, -0.5, Math.PI / 2);
  tag(rider, 'bettertalk', 'bettertalk-main.png');
  h.collider(3.85, -0.5, 0.45, 0.45, 0, 1.4);
  const [btx, btz] = h.world(4.2, -1.3);
  addIcon('bettertalk', btx, 2.5, btz);
  const [rcx, rcz] = h.world(4.2, 0.4);
  addIcon('rubecube', rcx, 2.5, rcz);

  // A sofa, a rug, a plant and a lamp
  h.box(2.2, 0.45, 0.85, 0.5, FL + 0.22, 3.7, mat(0x6b7280), { collide: true });
  h.box(2.2, 0.5, 0.2, 0.5, FL + 0.6, 4.05, mat(0x6b7280));
  h.box(2.6, 0.01, 1.8, 0.5, FL + 0.01, 2.2, mat(0x9f3a38), { shadow: false });
  h.box(0.9, 0.4, 0.5, 0.5, FL + 0.2, 2.2, mat(0x7a5a3a), { collide: true });
  h.box(0.35, 0.4, 0.35, -3.6, FL + 0.2, -3.9, mat(0x8a5a3a), { collide: true });
  const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0x2f6b2f));
  h.add(plant, -3.6, FL + 0.85, -3.9);
  h.box(1.6, 1.9, 0.4, 1.5, FL + 0.95, -4.15, mat(0x7a5a3a), { collide: true }); // bookshelf

  // Upstairs: the shared kids' room
  // Kid 1: Roadway Rivals on the main monitor, Bridge Defender on a vertical second monitor
  h.add(desk(h, 2.2, 0.75), -1.9, upY, -3.95);
  h.collider(-1.9, -3.95, 1.1, 0.38, upY, upY + 0.8);
  const m1 = monitor(0.6, 0.34, 'roadway-desktop.jpg');
  h.add(m1, -2.35, upY + 0.76, -4.05);
  tag(m1, 'roadway-rivals', 'roadway-desktop.jpg');
  const m2 = monitor(0.3, 0.53, 'bridge-defender-portrait.jpg', 0.1);
  h.add(m2, -1.3, upY + 0.76, -4.05, -0.25);
  tag(m2, 'bridge-defender', 'bridge-defender-portrait.jpg');
  h.add(chair(0xdc2626), -2.0, upY, -3.15, Math.PI);
  const kid1 = person({ s: 0.74, pose: 'sit', hands: 'desk', shirt: 0x22c55e, pants: 0x1e3a8a, skin: SKIN[0], hair: 0xd4a017, seatH: 0.5, handReach: 0.45, handY: 0.8 });
  h.add(kid1, -2.0, upY, -3.15, Math.PI);
  tag(kid1, 'roadway-rivals', 'roadway-desktop.jpg');
  // Kid 2: Seraph
  h.add(desk(h, 1.6, 0.75), 2.0, upY, -3.95);
  h.collider(2.0, -3.95, 0.8, 0.38, upY, upY + 0.8);
  const m3 = monitor(0.6, 0.34, 'seraph-placeholder.jpg');
  h.add(m3, 2.0, upY + 0.76, -4.05);
  tag(m3, 'seraph', 'seraph-placeholder.jpg');
  h.add(chair(0x1d4ed8), 2.0, upY, -3.15, Math.PI);
  const kid2 = person({ s: 0.8, pose: 'sit', hands: 'desk', shirt: 0x9333ea, pants: 0x27272a, skin: SKIN[3], hair: 0x111111, seatH: 0.5, handReach: 0.45, handY: 0.8 });
  h.add(kid2, 2.0, upY, -3.15, Math.PI);
  tag(kid2, 'seraph', 'seraph-placeholder.jpg');
  // Two beds along the east wall
  for (const bz of [-0.9, 2.4]) {
    h.box(1.0, 0.45, 2.0, 4.85, upY + 0.22, bz, mat(0x7c5a3a), { collide: true });
    h.box(0.95, 0.12, 1.95, 4.85, upY + 0.5, bz, mat(bz < 0 ? 0x60a5fa : 0xf472b6));
    h.box(0.7, 0.12, 0.35, 4.85, upY + 0.6, bz - 0.75, mat(0xffffff));
  }
  h.box(1.2, 0.01, 1.6, 0.5, upY + 0.01, 0.6, mat(0x38bdf8), { shadow: false }); // rug
  const kidsAt = (lx, lz) => h.world(lx, lz);
  addIcon('roadway-rivals', kidsAt(-2.6, -3.4)[0], 5.4, kidsAt(-2.6, -3.4)[1]);
  addIcon('bridge-defender', kidsAt(-0.9, -3.4)[0], 5.0, kidsAt(-0.9, -3.4)[1]);
  addIcon('seraph', kidsAt(2.0, -3.4)[0], 5.4, kidsAt(2.0, -3.4)[1]);

  // Lights inside
  for (const [lx, ly, lz] of [[2, FL + 2.3, 0], [-2, FL + 2.3, 1.5], [0, upY + 2.3, -1.2]]) {
    const l = new THREE.PointLight(0xffe7c4, 14, 11, 1.5);
    const [wx, wz] = h.world(lx, lz);
    l.position.set(wx, ly, wz);
    scene.add(l);
  }
  return h;
}

// House 2: Family Card Table. Grandma on a laptop at the kitchen table,
// Grandpa in the same game on his phone on the porch swing.
function house2(x, z, rot) {
  const h = new Place(x, z, rot);
  const doorX = 1.5;
  houseShell(h, {
    wallColor: 0xb7cbd6, trimColor: 0xffffff, roofColor: 0x3f4752, enterable: true,
    frontOpen: windowsFront(doorX, { windows: [0.8, 9.0] }),
    upperFront: [ext({ a0: 1.5, a1: 3.5, y0: 1.0, y1: 2.2 }), ext({ a0: 7.5, a1: 9.5, y0: 1.0, y1: 2.2 })],
    sideOpen: [ext({ a0: 3.5, a1: 5.5, y0: 1.0, y1: 2.2 })],
    backOpen: [ext({ a0: 4.5, a1: 6.5, y0: 1.0, y1: 2.2 })],
  });
  h.box(HW - 0.2, 0.2, HD - 0.2, 0, FL + LEVEL - 0.1, 0, mat(0xf3efe6), { shadow: false }); // ceiling

  // Porch
  const px0 = -2.0, px1 = 5.4, pz0 = HD / 2, pz1 = HD / 2 + 2.6, porchY = 0.4;
  h.box(px1 - px0, porchY, pz1 - pz0, (px0 + px1) / 2, porchY / 2, (pz0 + pz1) / 2, mat(0x9a7b5a), { shadow: false });
  h.floor((px0 + px1) / 2, (pz0 + pz1) / 2, (px1 - px0) / 2, (pz1 - pz0) / 2, porchY);
  h.box(1.8, 0.2, 0.5, doorX, 0.1, pz1 + 0.25, mat(0x9a7b5a), { shadow: false });
  h.floor(doorX, pz1 + 0.25, 0.9, 0.25, 0.2);
  for (const px of [px0 + 0.1, px1 - 0.1]) h.box(0.15, 2.6, 0.15, px, porchY + 1.3, pz1 - 0.1, mat(0xffffff), { collide: true });
  h.box(px1 - px0 + 0.4, 0.12, pz1 - pz0 + 0.3, (px0 + px1) / 2, porchY + 2.65, (pz0 + pz1) / 2, mat(0x3f4752));
  // Railing along the front except at the steps
  h.box(doorX - 0.9 - px0, 0.8, 0.06, (px0 + doorX - 0.9) / 2, porchY + 0.4, pz1 - 0.1, mat(0xffffff), { collide: true });
  h.box(px1 - doorX - 0.9, 0.8, 0.06, (doorX + 0.9 + px1) / 2, porchY + 0.4, pz1 - 0.1, mat(0xffffff), { collide: true });
  // Porch swing hanging from the porch roof, facing the street
  const swX = 3.9, swZ = pz0 + 1.2;
  h.box(1.5, 0.06, 0.5, swX, porchY + 0.48, swZ, mat(0x7a5a3a));
  h.box(1.5, 0.45, 0.05, swX, porchY + 0.75, swZ - 0.25, mat(0x7a5a3a));
  for (const dx of [-0.72, 0.72]) h.box(0.02, 2.1, 0.02, swX + dx, porchY + 1.55, swZ, mat(0x777777), { shadow: false });
  h.collider(swX, swZ, 0.8, 0.35, porchY, porchY + 1.4);
  const grandpa = person({ pose: 'sit', hands: 'phone', shirt: 0x7f1d1d, pants: 0x57534e, skin: SKIN[1], hair: 0xe5e7eb, seatH: 0.48 });
  h.add(grandpa, swX - 0.3, porchY, swZ - 0.05);
  tag(grandpa, 'family-card-table', 'fct-phone.jpg');
  tag(givePhone(grandpa, 'fct-phone.jpg'), 'family-card-table', 'fct-phone.jpg');

  // Kitchen table with Grandma on a laptop (facing the back wall, so you see her screen as you walk in)
  const tbl = desk(h, 1.6, 0.95, 0, 0, 0, 0xe2c9a0);
  h.add(tbl, 0.6, FL, 0.2);
  h.collider(0.6, 0.2, 0.8, 0.48, 0, 0.8);
  const lap = laptop('fct-desktop.jpg');
  h.add(lap, 0.6, FL + 0.76, 0.05, 0);
  tag(lap, 'family-card-table', 'fct-desktop.jpg');
  h.add(chair(0x7a5a3a), 0.6, FL, 1.05, Math.PI);
  const grandma = person({ pose: 'sit', hands: 'desk', shirt: 0xdb2777, pants: 0x4b5563, skin: SKIN[0], hair: 0xd1d5db, seatH: 0.48, handReach: 0.42, handY: 0.8 });
  h.add(grandma, 0.6, FL, 1.05, Math.PI);
  tag(grandma, 'family-card-table', 'fct-desktop.jpg');
  h.add(chair(0x7a5a3a), -0.2, FL, -0.65, 0);
  // Kitchen counters and fridge along the back wall
  h.box(4.5, 0.9, 0.65, -2.3, FL + 0.45, -4.05, mat(0xf5f5f4), { collide: true });
  h.box(4.5, 0.05, 0.7, -2.3, FL + 0.92, -4.05, mat(0x44403c));
  h.box(0.9, 1.9, 0.75, 1.0, FL + 0.95, -4.0, mat(0xd6d3d1, { metalness: 0.4, roughness: 0.3 }), { collide: true });
  const l = new THREE.PointLight(0xffe7c4, 14, 11, 1.5);
  const [wx, wz] = h.world(0.5, 0);
  l.position.set(wx, FL + 2.3, wz);
  scene.add(l);

  const [gx, gz] = h.world(0.6, 1.05);
  addIcon('family-card-table', gx, 2.5, gz);
  const [px, pz] = h.world(swX, swZ);
  addIcon('family-card-table', px, 3.5, pz);
  return h;
}

// Houses 3 to 5: closed, lived-in looking houses.
function plainHouse(x, z, rot, wallColor, roofColor, doorColor) {
  const h = new Place(x, z, rot);
  const doorX = 0;
  houseShell(h, {
    wallColor, trimColor: 0xffffff, roofColor, enterable: false,
    frontOpen: [ext({ a0: 1.2, a1: 3.4, y0: 0.9, y1: 2.2 }), ext({ a0: 7.6, a1: 9.8, y0: 0.9, y1: 2.2 })],
    upperFront: [ext({ a0: 1.5, a1: 3.5, y0: 1.0, y1: 2.2 }), ext({ a0: 7.5, a1: 9.5, y0: 1.0, y1: 2.2 })],
  });
  closedDoor(h, doorX, doorColor);
  porchSteps(h, doorX);
  // Curtains behind the glass so nobody sees an empty house
  h.box(HW - 0.5, 2 * LEVEL - 0.2, HD - 0.5, 0, FL + LEVEL, 0, mat(0xe7dcc8), { shadow: false });
  return h;
}

// ---------------------------------------------------------------------------
// Build the world

const ring = (deg, r = 29) => {
  const t = THREE.MathUtils.degToRad(deg);
  return [BULB.x + r * Math.cos(t), BULB.y + r * Math.sin(t)];
};
const faceBulb = (x, z) => Math.atan2(BULB.x - x, BULB.y - z);

// Five houses equally spaced around the cul-de-sac. House 1 sits behind the bus
// stop facing the street; house 5 mirrors it on the south side.
const H = [-42, -111, -180, -249, -318].map((d) => ring(d));
const houseRot = [0, faceBulb(...H[1]), faceBulb(...H[2]), faceBulb(...H[3]), Math.PI];

// Front walks and driveways (painted on the ground before it is drawn)
function walkTo(i, lx, w) {
  const c = Math.cos(houseRot[i]), s = Math.sin(houseRot[i]);
  const [hx, hz] = H[i];
  const from = [hx + c * lx + s * (HD / 2), hz - s * lx + c * (HD / 2)];
  let to;
  if (i === 0) to = [from[0], -STREET_HALF];
  else if (i === 4) to = [from[0], STREET_HALF];
  else {
    const dx = BULB.x - from[0], dz = BULB.y - from[1], d = Math.hypot(dx, dz);
    to = [from[0] + (dx / d) * (d - BULB_R + 0.1), from[1] + (dz / d) * (d - BULB_R + 0.1)];
  }
  doorPaths.push({ from, to, w });
  return { from, to };
}
walkTo(0, 2.5, 1.3);
walkTo(1, 1.5, 1.3);
const drive = [null, walkTo(1, -3.6, 3.2), walkTo(2, -3.6, 3.2), walkTo(3, -3.6, 3.2), walkTo(4, -3.6, 3.2)];
walkTo(2, 0, 1.3);
walkTo(3, 0, 1.3);
walkTo(4, 0, 1.3);

paintGround();
busStop();
hydrant(-6.8, -6.6);
house1(...H[0], houseRot[0]);
house2(...H[1], houseRot[1]);
plainHouse(...H[2], houseRot[2], 0xd9c6a5, 0x6b3f2a, 0x1e3a8a);
plainHouse(...H[3], houseRot[3], 0xcfd8c4, 0x3b3b3b, 0x7f1d1d);
plainHouse(...H[4], houseRot[4], 0xe5d3d0, 0x4a3f3a, 0x14532d);

// Cars parked in driveways and along the curb
const inDrive = (i, color) => {
  const d = drive[i];
  const x = d.from[0] + (d.to[0] - d.from[0]) * 0.5, z = d.from[1] + (d.to[1] - d.from[1]) * 0.5;
  car(x, z, Math.atan2(d.to[0] - d.from[0], d.to[1] - d.from[1]), color);
};
inDrive(1, 0x9ca3af);
inDrive(3, 0x1e40af);
inDrive(4, 0xf5f5f4);
car(13, -3.7, Math.PI / 2, 0xb91c1c);
car(9, 3.7, -Math.PI / 2, 0x111827);
{
  const [cx, cz] = ring(180, BULB_R - 1.3);
  car(cx, cz, 0, 0x15803d);
}

// Trees, lights and a few touches
for (const [x, z, s] of [[12, -14, 1.1], [22, -12, 0.9], [30, 13, 1.2], [18, 15, 1], [-38, -40, 1.1], [-42, 38, 1], [-56, -16, 1.2], [-56, 18, 0.9], [-12, -34, 1], [-12, 34, 1.1], [34, -13, 1]]) tree(x, z, s);
for (const deg of [-75, 150, 75]) {
  const [x, z] = ring(deg, BULB_R + 1.6);
  streetLight(x, z, Math.atan2(BULB.x - x, BULB.y - z));
}
streetLight(20, -6.4, 0);
streetLight(20, 6.4, Math.PI);

// ---------------------------------------------------------------------------
// Player

const player = { pos: new THREE.Vector3(-6, 0, 0), y: 0, yaw: 0, pitch: -0.04, vy: 0 };
const keys = new Set();
const joy = { x: 0, y: 0 };

// Viewpoints for jumping straight to a project (#bettertalk etc.)
function viewFrom(place, from, at, lift = 0) {
  const [x, z] = place.world(...from);
  const [ax, az] = place.world(at[0], at[2]);
  const dy = at[1] - (lift + EYE);
  return { x, z, y: lift, yaw: Math.atan2(-(ax - x), -(az - z)), pitch: Math.atan2(dy, Math.hypot(ax - x, az - z)) };
}
const h1 = new Place(...H[0], houseRot[0], new THREE.Group());
const h2 = new Place(...H[1], houseRot[1], new THREE.Group());
const SPOTS = {
  start: { x: -6, z: 0, y: 0, yaw: 0, pitch: -0.04 },
  bettertalk: viewFrom(h1, [2.7, 0.3], [5.1, FL + 1.1, -0.5], FL),
  rubecube: viewFrom(h1, [2.7, 0.3], [5.1, FL + 1.1, -0.5], FL),
  'roadway-rivals': viewFrom(h1, [-2.3, -1.4], [-2.2, FL + LEVEL + 1.0, -4.05], FL + LEVEL),
  'bridge-defender': viewFrom(h1, [-1.2, -1.6], [-1.3, FL + LEVEL + 1.1, -4.05], FL + LEVEL),
  seraph: viewFrom(h1, [2.0, -1.4], [2.0, FL + LEVEL + 1.0, -4.05], FL + LEVEL),
  'family-card-table': viewFrom(h2, [1.6, 1.9], [0.6, FL + 0.85, 0.05], FL),
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

function pick(ndc) {
  ray.setFromCamera(ndc, camera);
  ray.far = 60;
  const hitIcon = ray.intersectObjects(icons.filter((s) => s.visible), false)[0];
  if (hitIcon) return { project: hitIcon.object.userData.project, shot: null };
  ray.far = 9;
  const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && h.object.material !== glass && !h.object.isSprite);
  if (!hit || !hit.object.userData.project) return null;
  const split = hit.object.userData.split;
  if (split && hit.uv && hit.uv.x > split.u0 && hit.uv.y < split.v1) return { project: split.project, shot: split.shot };
  return { project: hit.object.userData.project, shot: hit.object.userData.shot };
}

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

const isTouch = matchMedia('(pointer: coarse)').matches;
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
  `<button type="button" data-id="start"><span>🏁</span>Back to the street</button>`;
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
manager.onLoad = () => {
  document.getElementById('loading').textContent = '';
  document.getElementById('start').disabled = false;
};
document.getElementById('start').disabled = true;
setTimeout(() => { document.getElementById('start').disabled = false; document.getElementById('loading').textContent = ''; }, 6000);

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
  for (const s of icons) {
    s.position.y = s.userData.baseY + Math.sin(t * 1.6 + s.userData.phase) * 0.08;
    const d = s.position.distanceTo(camera.position);
    // Fade out up close so icons never cover the screens they point at.
    s.material.opacity = THREE.MathUtils.clamp((d - 2.5) / 3, 0, 1);
    s.visible = s.material.opacity > 0.02;
    // Keep far icons readable: never smaller on screen than one seen from 9 m.
    const k = Math.max(1, d / 9);
    s.scale.set(1.3 * k, 0.41 * k, 1);
  }
  if (started && panel.hidden && !isTouch && (frame++ % 3 === 0)) showHint(pick(center));
  renderer.render(scene, camera);
});

// For testing in a headless browser
window.__world = { player, goTo, SPOTS, start };
