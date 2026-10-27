// Shrinks the world's glTF models for phones: welds and quantizes vertices, simplifies
// the heaviest meshes, caps texture size and re-encodes everything with meshopt.
// Safe to run again on files it already slimmed. People keep their skeletons and node names.
// Usage, from a folder with @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp:
//   node slim.mjs file.glb [file.glb ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, simplify, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Fraction of triangles to keep, for meshes much denser than they look at walking distance.
const KEEP = {
  fern_02: 0.3, shrub_sorrel_01: 0.4, SpecularSilkPouf: 0.12, DiffuseTransmissionPlant: 0.3,
  SheenChair: 0.35, SheenWoodLeatherSofa: 0.4, IridescenceLamp: 0.4, CarConcept: 0.4,
  rock_moss_set_01: 0.4, tree_stump_01: 0.4, wheelchair_01: 0.6, ChairDamaskPurplegold: 0.6,
};
// Big furniture keeps 512 px textures; small props and ground cover get 256.
const BIG = new Set(['GlamVelvetSofa', 'SheenWoodLeatherSofa', 'ChairDamaskPurplegold', 'SheenChair', 'CarConcept', 'covered_car', 'dining_table', 'tree_stump_01']);

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const file of process.argv.slice(2)) {
  const name = path.basename(file, '.glb');
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  // Normal maps work without stored tangents (three.js derives them per pixel).
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.getAttribute('TANGENT')?.dispose();
  const tex = BIG.has(name) ? 512 : 256;
  const steps = [weld(), dedup()];
  if (KEEP[name]) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: KEEP[name], error: 0.01 }));
  steps.push(
    prune({ keepAttributes: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [tex, tex] }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await doc.transform(...steps);
  await io.write(file, doc);
  console.log(`${name}: ${(before / 1024).toFixed(0)}K -> ${(fs.statSync(file).size / 1024).toFixed(0)}K`);
}
