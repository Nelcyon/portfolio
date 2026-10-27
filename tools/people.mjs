// Packs Quaternius modular characters for the world: keeps only the idle clip
// (poses are built from it in js/people.js), then meshopt-compresses to .glb.
// Usage, from a folder with @gltf-transform/core, /extensions, /functions and meshoptimizer installed:
//   node people.mjs out_dir name=path/to/Character.gltf [name=...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const [out, ...pairs] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const pair of pairs) {
  const [name, src] = pair.split('=');
  const doc = await io.read(src);
  const drop = (a) => { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => { s.dispose(); }); a.dispose(); };
  for (const a of doc.getRoot().listAnimations()) if (!/^Idle(_Neutral)?$/.test(a.getName())) drop(a);
  const idle = doc.getRoot().listAnimations().sort((a) => (/_Neutral$/.test(a.getName()) ? -1 : 1));
  // One idle clip is plenty, and only its first frame is used.
  idle.slice(1).forEach(drop);
  for (const smp of idle[0].listSamplers()) {
    const inp = smp.getInput(), out = smp.getOutput(), n = out.getElementSize();
    const k = smp.getInterpolation() === 'CUBICSPLINE' ? 3 : 1;
    smp.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0])).setBuffer(inp.getBuffer()));
    smp.setOutput(doc.createAccessor().setType(out.getType()).setArray(out.getArray().slice(0, n * k)).setBuffer(out.getBuffer()));
  }
  await doc.transform(weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
  await io.write(`${out}/${name}.glb`, doc);
  console.log(name, doc.getRoot().listAnimations().map((a) => a.getName()));
}
