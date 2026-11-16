// Pure ES module: no three.js, no DOM, no I/O, no environment reads.
// T-junction detection + conforming repair for triangle meshes.
// A T-junction is a vertex that lies strictly inside another triangle's edge.
// Repair splits that edge (and fans the triangle through its centroid) without
// moving any pre-existing vertex, so the represented surface is unchanged.

const EDGE_EPS_FRAC = 1e-9; // tolerance is relative to the bbox diagonal

export function bboxOf(vertices) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    diag: Math.hypot(dx, dy, dz), dims: [dx, dy, dz] };
}

// Exact duplicate weld. The generated corpus duplicates seam vertices with
// bit-identical coordinates, so exact keys are the honest baseline: no vertex
// is moved, and the repair contract "surface unchanged" stays exact.
export function weldExact(vertices, triangles) {
  const map = new Map();
  const out = [];
  const remap = new Int32Array(vertices.length / 3);
  for (let v = 0; v < vertices.length / 3; v++) {
    const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2];
    const k = x + '|' + y + '|' + z;
    let id = map.get(k);
    if (id === undefined) { id = out.length / 3; map.set(k, id); out.push(x, y, z); }
    remap[v] = id;
  }
  const tris = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = remap[triangles[t]], b = remap[triangles[t + 1]], c = remap[triangles[t + 2]];
    if (a === b || b === c || a === c) continue; // collapsed by weld
    tris.push(a, b, c);
  }
  return { vertices: out, triangles: tris, welded: vertices.length / 3 - out.length / 3 };
}

function gridKey(ix, iy, iz) { return ix + ',' + iy + ',' + iz; }

function buildVertexGrid(vertices, cell) {
  const grid = new Map();
  for (let v = 0; v < vertices.length / 3; v++) {
    const ix = Math.floor(vertices[v * 3] / cell);
    const iy = Math.floor(vertices[v * 3 + 1] / cell);
    const iz = Math.floor(vertices[v * 3 + 2] / cell);
    const k = gridKey(ix, iy, iz);
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
    a.push(v);
  }
  return grid;
}

// Grid-accelerated detection. Correctness is independent of the cell size:
// cells only shrink the candidate set, the exact point-segment test decides.
export function detectTJunctions(vertices, triangles, opts = {}) {
  const diag = opts.diag ?? bboxOf(vertices).diag;
  const eps = (opts.relEps ?? EDGE_EPS_FRAC) * diag;
  const cells = opts.cells ?? 18;
  const cell = Math.max(diag / cells, eps * 2 || Number.MIN_VALUE);
  const grid = opts.grid ?? buildVertexGrid(vertices, cell);
  const stamp = new Int32Array(vertices.length / 3).fill(-1);
  let stampId = 0;
  const out = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      stampId++;
      const ux = vertices[u * 3], uy = vertices[u * 3 + 1], uz = vertices[u * 3 + 2];
      const vx = vertices[v * 3], vy = vertices[v * 3 + 1], vz = vertices[v * 3 + 2];
      const dx = vx - ux, dy = vy - uy, dz = vz - uz;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 === 0) continue;
      const minX = Math.min(ux, vx) - eps, maxX = Math.max(ux, vx) + eps;
      const minY = Math.min(uy, vy) - eps, maxY = Math.max(uy, vy) + eps;
      const minZ = Math.min(uz, vz) - eps, maxZ = Math.max(uz, vz) + eps;
      const ix0 = Math.floor(minX / cell), ix1 = Math.floor(maxX / cell);
      const iy0 = Math.floor(minY / cell), iy1 = Math.floor(maxY / cell);
      const iz0 = Math.floor(minZ / cell), iz1 = Math.floor(maxZ / cell);
      for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const bucket = grid.get(gridKey(ix, iy, iz));
          if (!bucket) continue;
          for (const w of bucket) {
            if (w === a || w === b || w === c) continue;
            if (stamp[w] === stampId) continue;
            stamp[w] = stampId;
            const wx = vertices[w * 3], wy = vertices[w * 3 + 1], wz = vertices[w * 3 + 2];
            if (wx < minX || wx > maxX || wy < minY || wy > maxY || wz < minZ || wz > maxZ) continue;
            let s = ((wx - ux) * dx + (wy - uy) * dy + (wz - uz) * dz) / len2;
            if (s <= 0 || s >= 1) continue;
            const px = ux + s * dx, py = uy + s * dy, pz = uz + s * dz;
            const dist = Math.hypot(wx - px, wy - py, wz - pz);
            if (dist > eps) continue;
            const len = Math.sqrt(len2);
            // strictly interior, in absolute distance from both endpoints
            if (s * len <= eps || (1 - s) * len <= eps) continue;
            out.push({ vertex: w, tri: t / 3, edgeA: u, edgeB: v, t: s, dist });
          }
        }
      }
    }
  }
  return out;
}

// O(V*E) reference detector used as the in-repo baseline (and by verify as a
// second implementation with a different candidate strategy).
export function detectTJunctionsNaive(vertices, triangles, opts = {}) {
  const diag = opts.diag ?? bboxOf(vertices).diag;
  const eps = (opts.relEps ?? EDGE_EPS_FRAC) * diag;
  const out = [];
  const V = vertices.length / 3;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ux = vertices[u * 3], uy = vertices[u * 3 + 1], uz = vertices[u * 3 + 2];
      const vx = vertices[v * 3], vy = vertices[v * 3 + 1], vz = vertices[v * 3 + 2];
      const dx = vx - ux, dy = vy - uy, dz = vz - uz;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 === 0) continue;
      const len = Math.sqrt(len2);
      for (let w = 0; w < V; w++) {
        if (w === a || w === b || w === c) continue;
        const wx = vertices[w * 3], wy = vertices[w * 3 + 1], wz = vertices[w * 3 + 2];
        if (wx < Math.min(ux, vx) - eps || wx > Math.max(ux, vx) + eps) continue;
        if (wy < Math.min(uy, vy) - eps || wy > Math.max(uy, vy) + eps) continue;
        if (wz < Math.min(uz, vz) - eps || wz > Math.max(uz, vz) + eps) continue;
        const s = ((wx - ux) * dx + (wy - uy) * dy + (wz - uz) * dz) / len2;
        if (s <= 0 || s >= 1) continue;
        const px = ux + s * dx, py = uy + s * dy, pz = uz + s * dz;
        const dist = Math.hypot(wx - px, wy - py, wz - pz);
        if (dist > eps) continue;
        if (s * len <= eps || (1 - s) * len <= eps) continue;
        out.push({ vertex: w, tri: t / 3, edgeA: u, edgeB: v, t: s, dist });
      }
    }
  }
  return out;
}

// Split every edge at its detected T-junction vertices, then fan the triangle
// through its centroid. Every inserted point lies on the original plane:
// centroid = mean of a planar loop; split points are pre-existing vertices.
export function healTJunctions(vertices, triangles, opts = {}) {
  const welded = weldExact(vertices, triangles);
  let verts = welded.vertices;
  // weld can merge vertices; re-index is done, so geometry is identical.
  const diag = opts.diag ?? bboxOf(verts).diag;
  const tjs = detectTJunctions(verts, triangles = welded.triangles, { ...opts, diag });
  const splits = new Map(); // `${tri}|${min}|${max}` -> Map(vertex -> t)
  for (const j of tjs) {
    const a = Math.min(j.edgeA, j.edgeB), b = Math.max(j.edgeA, j.edgeB);
    const k = j.tri + '|' + a + '|' + b;
    let m = splits.get(k); if (!m) { m = new Map(); splits.set(k, m); }
    // t is measured along the directed triangle edge; normalise to low->high.
    const t = j.edgeA < j.edgeB ? j.t : 1 - j.t;
    if (!m.has(j.vertex)) m.set(j.vertex, t);
  }
  if (splits.size === 0) {
    return { vertices: verts, triangles: welded.triangles, stats: {
      welded: welded.welded, tJunctions: 0, splitTriangles: 0, addedTriangles: 0, addedVertices: 0 } };
  }
  const newTris = [];
  let splitTriangles = 0, addedVertices = 0;
  for (let t = 0; t < welded.triangles.length; t += 3) {
    const a = welded.triangles[t], b = welded.triangles[t + 1], c = welded.triangles[t + 2];
    const triIdx = t / 3;
    const edges = [[a, b], [b, c], [c, a]];
    const hasSplit = edges.some(([u, v]) => splits.has(triIdx + '|' + Math.min(u, v) + '|' + Math.max(u, v)));
    if (!hasSplit) { newTris.push(a, b, c); continue; }
    splitTriangles++;
    const loop = [];
    for (const [u, v] of edges) {
      loop.push(u);
      const m = splits.get(triIdx + '|' + Math.min(u, v) + '|' + Math.max(u, v));
      if (!m) continue;
      const arr = [...m.entries()].sort((p, q) => p[1] - q[1]);
      // t is low->high; reverse when traversing the edge high->low.
      const ordered = u < v ? arr : arr.slice().reverse();
      for (const [w] of ordered) loop.push(w);
    }
    // centroid keeps the fan exact and avoids choosing a corner that was split.
    const cx = loop.reduce((s, w) => s + verts[w * 3], 0) / loop.length;
    const cy = loop.reduce((s, w) => s + verts[w * 3 + 1], 0) / loop.length;
    const cz = loop.reduce((s, w) => s + verts[w * 3 + 2], 0) / loop.length;
    const ci = verts.length / 3;
    verts.push(cx, cy, cz);
    addedVertices++;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      if (p === q) continue;
      newTris.push(ci, p, q);
    }
  }
  return { vertices: verts, triangles: newTris, stats: {
    welded: welded.welded, tJunctions: tjs.length, splitTriangles,
    addedTriangles: newTris.length / 3 - welded.triangles.length / 3, addedVertices } };
}

export function surfaceArea(vertices, triangles) {
  let area = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += 0.5 * Math.hypot(nx, ny, nz);
  }
  return area;
}

export function signedVolume(vertices, triangles) {
  let vol = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
    const bx = vertices[b], by = vertices[b + 1], bz = vertices[b + 2];
    const cx = vertices[c], cy = vertices[c + 1], cz = vertices[c + 2];
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

export function auditMesh(vertices, triangles, opts = {}) {
  const bbox = bboxOf(vertices);
  const eps = (opts.relEps ?? EDGE_EPS_FRAC) * bbox.diag;
  const edges = new Map();
  let degenerate = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = Math.min(u, v) + ',' + Math.max(u, v);
      let e = edges.get(k); if (!e) { e = { count: 0, sign: 0 }; edges.set(k, e); }
      e.count++; e.sign += u < v ? 1 : -1;
    }
  }
  let boundary = 0, nonManifold = 0, orientationConflicts = 0;
  for (const e of edges.values()) {
    if (e.count === 1) boundary++;
    else if (e.count > 2) nonManifold++;
    if (e.count === 2 && e.sign !== 0) orientationConflicts++;
  }
  const tjs = opts.skipTJ ? [] : detectTJunctions(vertices, triangles, { ...opts, diag: bbox.diag });
  const volume = signedVolume(vertices, triangles);
  return {
    vertices: vertices.length / 3, triangles: triangles.length / 3, edges: edges.size,
    boundaryEdges: boundary, nonManifoldEdges: nonManifold, orientationConflicts,
    degenerateFaces: degenerate, tJunctions: tjs.length,
    watertight: boundary === 0 && nonManifold === 0 && orientationConflicts === 0 && degenerate === 0,
    area: surfaceArea(vertices, triangles), volume: Math.abs(volume),
    bboxDiag: bbox.diag
  };
}

// FNV-1a over float64 bits + indices; browser-safe (no node:crypto).
export function meshHash(vertices, triangles) {
  let h = 0x811c9dc5;
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  const mix = (n) => {
    dv.setFloat64(0, n, true);
    for (let i = 0; i < 8; i++) { h ^= dv.getUint8(i); h = Math.imul(h, 0x01000193) >>> 0; }
  };
  for (let i = 0; i < vertices.length; i++) mix(vertices[i]);
  for (let i = 0; i < triangles.length; i++) {
    h ^= triangles[i] & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (triangles[i] >>> 8) & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (triangles[i] >>> 16) & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function surfacePlaneDeviation(vertices, triangles, triIndex, pointIndex) {
  const a = triangles[triIndex * 3] * 3, b = triangles[triIndex * 3 + 1] * 3, c = triangles[triIndex * 3 + 2] * 3;
  const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
  const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  return Math.abs((vertices[pointIndex * 3] - vertices[a]) * nx / nl
    + (vertices[pointIndex * 3 + 1] - vertices[a + 1]) * ny / nl
    + (vertices[pointIndex * 3 + 2] - vertices[a + 2]) * nz / nl);
}