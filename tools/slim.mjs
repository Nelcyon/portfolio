// Turns the world's glTF models into small, flat-colored low-poly props that match the
// Quaternius people: each material's photo texture becomes its average color, normals
// are dropped (the world draws them with flatShading), dense meshes are simplified,
// and everything is quantized and meshopt-compressed. Leaves and other cut-out materials
// keep a tiny alpha-only texture so their shapes survive.
// Usage, from a folder with @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp:
//   node slim.mjs file.glb [file.glb ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, simplify, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const MAX_TRIS = 4000; // per model; more than a low-poly prop needs
// Ground cover is drawn hundreds of times, so it gets far fewer.
const MAX_TRIS_FOR = { fern_02: 700, shrub_sorrel_01: 300 };
const MIN_KEEP = { covered_car: 0.5, DiffuseTransmissionPlant: 0.15 };

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
async function average(image) {
  const { data, info } = await sharp(Buffer.from(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0]; let w = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] / 255;
    for (let k = 0; k < 3; k++) sum[k] += toLinear(data[i + k] / 255) * a;
    w += a;
  }
  return sum.map((v) => v / Math.max(w, 1e-6));
}
async function alphaOnly(image) {
  // White RGB, original alpha, 128 px: the factor color shows through, the shape stays.
  const a = await sharp(Buffer.from(image)).ensureAlpha().extractChannel(3).resize(128, 128, { fit: 'inside' }).toBuffer();
  const meta = await sharp(a).metadata();
  const white = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return sharp(white).joinChannel(a).webp({ quality: 80 }).toBuffer();
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)) {
  const name = path.basename(file, '.glb');
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  const root = doc.getRoot();
  const keepTex = new Set();
  for (const m of root.listMaterials()) {
    const t = m.getBaseColorTexture();
    if (t) {
      const avg = await average(t.getImage());
      const f = m.getBaseColorFactor();
      m.setBaseColorFactor([f[0] * avg[0], f[1] * avg[1], f[2] * avg[2], f[3]]);
      if (m.getAlphaMode() !== 'OPAQUE') {
        const cut = doc.createTexture(t.getName() + '_alpha').setImage(await alphaOnly(t.getImage())).setMimeType('image/webp');
        m.setBaseColorTexture(cut);
        keepTex.add(cut);
      } else m.setBaseColorTexture(null);
    }
    const e = m.getEmissiveTexture();
    if (e) {
      const avg = await average(e.getImage());
      const f = m.getEmissiveFactor();
      m.setEmissiveFactor([f[0] * avg[0], f[1] * avg[1], f[2] * avg[2]]);
    }
  }
  // Sample models can carry studio lights (KHR_lights_punctual) and fancy material
  // extensions; both make extra shaders in the browser, so they go.
  for (const e of root.listExtensionsUsed()) if (/^KHR_(lights_punctual|materials_)/.test(e.extensionName)) e.dispose();
  // Every other map (normal, roughness, sheen, clearcoat...) goes.
  for (const t of root.listTextures()) if (!keepTex.has(t)) t.dispose();
  // People keep their skins; everything loses normals so shared corners weld together.
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    p.getAttribute('NORMAL')?.dispose();
    p.getAttribute('TANGENT')?.dispose();
  }
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const ratio = Math.max(MIN_KEEP[name] ?? 0.05, Math.min(1, (MAX_TRIS_FOR[name] ?? MAX_TRIS) / tris));
  const steps = [weld(), dedup()];
  if (ratio < 1 && !file.includes('people')) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02 }));
  steps.push(prune({ keepAttributes: false }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...steps);
  await io.write(file, doc);
  console.log(`${name}: ${(before / 1024).toFixed(0)}K -> ${(fs.statSync(file).size / 1024).toFixed(0)}K`);
}
