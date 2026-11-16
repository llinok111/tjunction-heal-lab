// Verify: every assertion below is executed on generated data and prints its
// measured value. Exit 0 only if all pass.
import { readFileSync } from 'node:fs';
import * as C from '../src/core.mjs';
import { oracleAudit, makeParityOracle, lcg } from './oracle.mjs';
import { detectNaive } from '../baseline/naive.mjs';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS ${name} :: ${detail}`); }
  else { failed++; console.log(`FAIL ${name} :: ${detail}`); }
}
const rel = (a, b) => Math.abs(a / b - 1);
const near = (a, b, tol = 1e-12) => rel(a, b) <= tol;

// Independent T-junction oracle: cross-product distance + barycentric parameter.
// Deliberately uses a different tolerance (1e-7*diag) and a different formula
// than core's projection-based test; it does not import repair code.
function independentTJ(vertices, triangles, diag) {
  const tol = 1e-7 * diag;
  const V = vertices.length / 3;
  const out = [];
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e], b = triangles[t + (e + 1) % 3];
      const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
      const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
      const ex = bx - ax, ey = by - ay, ez = bz - az;
      const L = Math.hypot(ex, ey, ez);
      if (L === 0) continue;
      for (let w = 0; w < V; w++) {
        if (w === triangles[t] || w === triangles[t + 1] || w === triangles[t + 2]) continue;
        const wx = vertices[w * 3], wy = vertices[w * 3 + 1], wz = vertices[w * 3 + 2];
        const px = wx - ax, py = wy - ay, pz = wz - az;
        const cx = ey * pz - ez * py, cy = ez * px - ex * pz, cz = ex * py - ey * px;
        const dist = Math.hypot(cx, cy, cz) / L;
        if (dist > tol) continue;
        const s = (px * ex + py * ey + pz * ez) / (L * L);
        if (s * L > tol && (1 - s) * L > tol) out.push({ vertex: w, tri: t / 3, a, b, t: s });
      }
    }
  }
  return out;
}

const data = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url)));
check('corpus count', data.corpora.length === 3, `corpora=${data.corpora.length}`);

let totalTJ = 0, totalTris = 0;
for (const c of data.corpora) {
  const tag = c.name;
  const diag = C.bboxOf(c.vertices).diag;
  const w = C.weldExact(c.vertices, c.triangles);
  const tjGrid = C.detectTJunctions(w.vertices, w.triangles, {});
  const tjNaive = detectNaive(w.vertices, w.triangles, {});
  const tjOracle = independentTJ(w.vertices, w.triangles, diag);
  totalTJ += tjOracle.length; totalTris += c.triangles.length / 3;
  check(`${tag}: welded seam duplicates`, w.welded > 0, `welded=${w.welded}`);
  check(`${tag}: T-junctions found`, tjOracle.length > 0,
    `grid=${tjGrid.length} naive=${tjNaive.length} independent=${tjOracle.length}`);
  check(`${tag}: two detectors agree on count`, tjGrid.length === tjNaive.length && tjGrid.length === tjOracle.length,
    `grid=${tjGrid.length} naive=${tjNaive.length} oracle=${tjOracle.length}`);

  // union of (vertex,tri) witnesses must match between implementations
  const key = (j) => `${j.vertex}|${j.tri}`;
  const sg = new Set(tjGrid.map(key)), so = new Set(tjOracle.map(key));
  let sym = 0; for (const k of sg) if (!so.has(k)) sym++; for (const k of so) if (!sg.has(k)) sym++;
  check(`${tag}: witness set symmetric difference 0`, sym === 0, `symDiff=${sym} (${sg.size} witnesses)`);

  const healed = C.healTJunctions(c.vertices, c.triangles, {});
  const healed2 = C.healTJunctions(healed.vertices, healed.triangles, {});
  const audit = C.auditMesh(healed.vertices, healed.triangles, {});
  const oa = oracleAudit(healed.vertices, healed.triangles);
  const tjAfterCore = C.detectTJunctions(healed.vertices, healed.triangles, {});
  const tjAfterOracle = independentTJ(healed.vertices, healed.triangles, diag);
  const h = C.meshHash(healed.vertices, healed.triangles);

  check(`${tag}: healed T-junctions 0 (both oracles)`, tjAfterCore.length === 0 && tjAfterOracle.length === 0,
    `core=${tjAfterCore.length} independent=${tjAfterOracle.length}`);
  check(`${tag}: watertight half-edge (core)`,
    audit.boundaryEdges === 0 && audit.nonManifoldEdges === 0 && audit.orientationConflicts === 0,
    `boundary=${audit.boundaryEdges} nonManifold=${audit.nonManifoldEdges} orientation=${audit.orientationConflicts}`);
  check(`${tag}: watertight half-edge (independent sort census)`,
    oa.boundary === 0 && oa.nonManifold === 0 && oa.conflicts === 0,
    `boundary=${oa.boundary} nonManifold=${oa.nonManifold} conflicts=${oa.conflicts}`);
  check(`${tag}: surface area preserved (<1e-12 rel)`, near(audit.area, c.truth.area, 1e-12),
    `area=${audit.area} truth=${c.truth.area} relErr=${rel(audit.area, c.truth.area).toExponential(3)}`);
  check(`${tag}: volume preserved (<1e-12 rel)`, near(audit.volume, c.truth.volume, 1e-12),
    `volume=${audit.volume} truth=${c.truth.volume} relErr=${rel(audit.volume, c.truth.volume).toExponential(3)}`);
  check(`${tag}: deterministic heal (bit-identical hash)`,
    h === C.meshHash(healed2.vertices, healed2.triangles), `hash=0x${h.toString(16)}`);
  check(`${tag}: heal is a no-op on healed mesh`,
    healed2.stats.addedTriangles === 0 && healed2.stats.tJunctions === 0,
    `secondPass addedTriangles=${healed2.stats.addedTriangles} tJunctions=${healed2.stats.tJunctions}`);
  check(`${tag}: split adds only centroids (one per split triangle)`,
    healed.stats.addedVertices === healed.stats.splitTriangles,
    `addedVertices=${healed.stats.addedVertices} splitTriangles=${healed.stats.splitTriangles}`);
  check(`${tag}: triangle growth bounded (<80%)`,
    healed.stats.addedTriangles / (healed.triangles.length / 3 - healed.stats.addedTriangles) < 0.8,
    `before=${healed.triangles.length / 3 - healed.stats.addedTriangles} after=${healed.triangles.length / 3}`);

  if (tag === 'cube-k8') {
    // Analytic membership check via +X ray parity, independent of both audits.
    const half = c.dims.map((d) => d / 2);
    const po = makeParityOracle(healed.vertices, healed.triangles, 48);
    const rnd = lcg(0xC0FFEE);
    const margin = 0.005 * diag;
    let checked = 0, inside = 0, outside = 0, mismatch = 0;
    for (let i = 0; i < 190000; i++) {
      const x = (rnd() * 2 - 1) * half[0] * 1.35;
      const y = (rnd() * 2 - 1) * half[1] * 1.35;
      const z = (rnd() * 2 - 1) * half[2] * 1.35;
      const dx = half[0] - Math.abs(x), dy = half[1] - Math.abs(y), dz = half[2] - Math.abs(z);
      if (Math.abs(dx) < margin || Math.abs(dy) < margin || Math.abs(dz) < margin) continue;
      const truth = dx > 0 && dy > 0 && dz > 0;
      checked++; if (truth) inside++; else outside++;
      if (po.inside(x, y, z) !== truth) mismatch++;
    }
    check('cube-k8: 12k+ ray-parity points match analytic membership',
      checked >= 12000 && mismatch === 0 && inside > 1000 && outside > 1000,
      `checked=${checked} inside=${inside} outside=${outside} mismatch=${mismatch}`);

    // Negative control: the oracle must reject a mesh with one face removed.
    const onPlane = (v) => Math.abs(healed.vertices[v * 3] - half[0]) < 1e-9;
    const hole = [];
    for (let t = 0; t < healed.triangles.length; t += 3) {
      const a = healed.triangles[t], b = healed.triangles[t + 1], cc = healed.triangles[t + 2];
      if (onPlane(a) && onPlane(b) && onPlane(cc)) continue;
      hole.push(a, b, cc);
    }
    const holeAudit = oracleAudit(healed.vertices, hole);
    const poHole = makeParityOracle(healed.vertices, hole, 48);
    let hm = 0, hc = 0;
    const rnd2 = lcg(0xBADC0DE);
    for (let i = 0; i < 40000; i++) {
      const x = (rnd2() * 2 - 1) * half[0] * 1.35;
      const y = (rnd2() * 2 - 1) * half[1] * 1.35;
      const z = (rnd2() * 2 - 1) * half[2] * 1.35;
      const dx = half[0] - Math.abs(x), dy = half[1] - Math.abs(y), dz = half[2] - Math.abs(z);
      if (Math.abs(dx) < margin || Math.abs(dy) < margin || Math.abs(dz) < margin) continue;
      hc++;
      if (poHole.inside(x, y, z) !== (dx > 0 && dy > 0 && dz > 0)) hm++;
    }
    check('negative control: removed face is not watertight and ray oracle detects it',
      holeAudit.watertight === false && holeAudit.boundary > 0 && hm > 0,
      `boundary=${holeAudit.boundary} parityMismatch=${hm}/${hc}`);

    // Scale behaviour: same geometry at 1e-6..1e6. Is the conclusion invariant?
    const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
    let scaleBad = 0, scaleCounts = [];
    for (const s of scales) {
      const sv = c.vertices.map((x) => x * s);
      const sh = C.healTJunctions(sv, c.triangles, {});
      const sa = C.auditMesh(sh.vertices, sh.triangles, {});
      const sAreaErr = rel(sa.area, c.truth.area * s * s);
      const sVolErr = rel(sa.volume, c.truth.volume * s * s * s);
      scaleCounts.push(sa.tJunctions);
      if (sa.tJunctions !== 0 || !sa.watertight || sAreaErr > 1e-12 || sVolErr > 1e-12) scaleBad++;
    }
    check('scale invariance 1e-6..1e6: 0 remnants, watertight, area/volume relative invariant',
      scaleBad === 0, `scales=[${scales.join(',')}] failures=${scaleBad} tjAfter=[${scaleCounts.join(',')}]`);
  }
}

check('total T-junctions across corpus', totalTJ > 2500, `totalTJ=${totalTJ} over ${totalTris} triangles`);
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);