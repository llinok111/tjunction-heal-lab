// Independent oracle. Does NOT import src/core.mjs.
// 1) watertightness via a sort-string half-edge census (different data layout)
// 2) inside/outside via +X ray parity over a y/z bin grid, compared with the
//    analytic box membership of the generated corpora.
import { bboxOf } from '../src/core.mjs'; // only bbox is shared; no repair/audit code

export function oracleAudit(vertices, triangles) {
  const V = vertices.length / 3;
  const keys = new Array(triangles.length / 3 * 3);
  const dirs = new Array(triangles.length / 3 * 3);
  for (let t = 0, q = 0; t < triangles.length; t += 3, q++) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      keys[q * 3 + e] = Math.min(a, b) + ':' + Math.max(a, b);
      dirs[q * 3 + e] = a < b ? 1 : -1;
    }
  }
  // canonical sort: same edge strings adjacent
  const idx = Array.from({ length: keys.length }, (_, i) => i).sort((i, j) => keys[i] < keys[j] ? -1 : keys[i] > keys[j] ? 1 : 0);
  let boundary = 0, nonManifold = 0, conflicts = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i + 1;
    while (j < idx.length && keys[idx[j]] === keys[idx[i]]) j++;
    const n = j - i;
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
    if (n === 2) {
      const s = dirs[idx[i]] + dirs[idx[j - 1]];
      if (s !== 0) conflicts++;
    }
    i = j;
  }
  let area = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { V, boundary, nonManifold, conflicts, area, watertight: boundary === 0 && nonManifold === 0 && conflicts === 0 };
}

// Axis +X ray parity. bins partition (y,z); each triangle is registered in every
// bin its y/z bounding box touches. This is intentionally a different algorithm
// from the half-edge audit in core.mjs.
export function makeParityOracle(vertices, triangles, bins = 64) {
  const bb = bboxOf(vertices);
  const pad = bb.diag * 0.01 + 1e-12;
  const y0 = bb.min[1] - pad, z0 = bb.min[2] - pad;
  const sy = (bb.dims[1] + 2 * pad) / bins, sz = (bb.dims[2] + 2 * pad) / bins;
  const cells = Array.from({ length: bins * bins }, () => []);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ymin = Math.min(vertices[a + 1], vertices[b + 1], vertices[c + 1]);
    const ymax = Math.max(vertices[a + 1], vertices[b + 1], vertices[c + 1]);
    const zmin = Math.min(vertices[a + 2], vertices[b + 2], vertices[c + 2]);
    const zmax = Math.max(vertices[a + 2], vertices[b + 2], vertices[c + 2]);
    const iy0 = Math.max(0, Math.floor((ymin - y0) / sy)), iy1 = Math.min(bins - 1, Math.floor((ymax - y0) / sy));
    const iz0 = Math.max(0, Math.floor((zmin - z0) / sz)), iz1 = Math.min(bins - 1, Math.floor((zmax - z0) / sz));
    for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) cells[iy * bins + iz].push(t);
  }
  const EPS = 1e-12;
  function inside(x, y, z) {
    const iy = Math.floor((y - y0) / sy), iz = Math.floor((z - z0) / sz);
    if (iy < 0 || iy >= bins || iz < 0 || iz >= bins) return false;
    const list = cells[iy * bins + iz];
    let crossings = 0;
    for (const t of list) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
      const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
      const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
      const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];
      // Moller-Trumbore, ray origin (x,y,z), direction +X.
      const e1y = by - ay, e1z = bz - az, e2y = cy - ay, e2z = cz - az;
      const py = y - ay, pz = z - az;
      const det = e1z * e2y - e1y * e2z;
      if (Math.abs(det) < 1e-18) continue;
      const u = (pz * e2y - py * e2z) / det;
      const v = (py * e1z - pz * e1y) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const hitX = ax + u * (bx - ax) + v * (cx - ax);
      if (hitX - x > bb.diag * EPS) crossings++;
    }
    return (crossings & 1) === 1;
  }
  return { inside, bbox: bb };
}

// Deterministic LCG for points; the oracle itself is deterministic.
export function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}