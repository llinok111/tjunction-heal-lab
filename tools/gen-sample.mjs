// Deterministic sample generator: multi-resolution cube/box faces.
// Adjacent surface tiles use alternating grid resolutions (2 or 4), which
// produces real T-junctions along tile borders while the surface stays exactly
// planar. No randomness, no timestamps: same bytes on every run.
import { writeFileSync, mkdirSync } from 'node:fs';
import * as C from '../src/core.mjs';

const FACES = {
  '+X': { o: [0.5, -0.5, -0.5], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
  '-X': { o: [-0.5, -0.5, -0.5], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
  '+Y': { o: [-0.5, 0.5, -0.5], u: [0, 0, 1], v: [1, 0, 0], n: [0, 1, 0] },
  '-Y': { o: [-0.5, -0.5, -0.5], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  '+Z': { o: [-0.5, -0.5, 0.5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  '-Z': { o: [-0.5, -0.5, -0.5], u: [0, 1, 0], v: [1, 0, 0], n: [0, 0, -1] }
};

function tileResolution(ti, tj) { return (ti + tj) % 2 === 0 ? 2 : 4; }

function buildFace(dims, faceKey, k) {
  const { o, u, v } = FACES[faceKey];
  const origin = [o[0] * dims[0], o[1] * dims[1], o[2] * dims[2]];
  // The unit basis is scaled independently per axis; u/v are axis-aligned.
  const U = [u[0] * dims[0], u[1] * dims[1], u[2] * dims[2]];
  const V = [v[0] * dims[0], v[1] * dims[1], v[2] * dims[2]];
  const verts = [], tris = [];
  for (let ti = 0; ti < k; ti++) for (let tj = 0; tj < k; tj++) {
    const r = tileResolution(ti, tj);
    const base = verts.length / 3;
    for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) {
      const p = (ti + i / r) / k, q = (tj + j / r) / k;
      verts.push(
        origin[0] + p * U[0] + q * V[0],
        origin[1] + p * U[1] + q * V[1],
        origin[2] + p * U[2] + q * V[2]
      );
    }
    const idx = (i, j) => base + j * (r + 1) + i;
    for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
      tris.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
      tris.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }
  }
  return { verts, tris };
}

function makeCorpus(name, dims, k) {
  const verts = [], tris = [];
  for (const face of Object.keys(FACES)) {
    const f = buildFace(dims, face, k);
    const base = verts.length / 3;
    for (const x of f.verts) verts.push(x);
    for (const t of f.tris) tris.push(t + base);
  }
  const area = 2 * (dims[0] * dims[1] + dims[0] * dims[2] + dims[1] * dims[2]);
  const volume = dims[0] * dims[1] * dims[2];
  return { name, dims, k, vertices: verts, triangles: tris, truth: { area, volume } };
}

const corpora = [
  makeCorpus('cube-k8', [2, 2, 2], 8),
  makeCorpus('box-k6', [2, 1, 3], 6),
  makeCorpus('plate-k5', [2, 0.25, 1], 5)
];

mkdirSync('data', { recursive: true });
writeFileSync('data/corpus.json', JSON.stringify({ version: 1, corpora }) + '\n');

// Node-baked reference so the browser can prove it runs the same core.
const reference = { version: 1, corpora: {} };
for (const c of corpora) {
  const tj = C.detectTJunctions(C.weldExact(c.vertices, c.triangles).vertices, C.weldExact(c.vertices, c.triangles).triangles, {});
  const healed = C.healTJunctions(c.vertices, c.triangles, {});
  const audit = C.auditMesh(healed.vertices, healed.triangles, {});
  reference.corpora[c.name] = {
    tJunctions: tj.length, watertight: audit.watertight,
    area: audit.area, volume: audit.volume,
    addedTriangles: healed.stats.addedTriangles, addedVertices: healed.stats.addedVertices,
    hash: C.meshHash(healed.vertices, healed.triangles)
  };
}
writeFileSync('data/reference.json', JSON.stringify(reference, null, 2) + '\n');
console.log('wrote data/corpus.json');
for (const c of corpora) {
  console.log(`${c.name}: vertices=${c.vertices.length / 3} triangles=${c.triangles.length / 3} ` +
    `truthArea=${c.truth.area} truthVolume=${c.truth.volume}`);
}