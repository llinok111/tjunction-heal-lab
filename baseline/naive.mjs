// Baseline: O(V*E) T-junction detector, projection-based, no spatial index.
// Kept in-repo so the speedup claimed in README is reproducible with one command.
import { bboxOf } from '../src/core.mjs';

export function detectNaive(vertices, triangles, opts = {}) {
  const diag = opts.diag ?? bboxOf(vertices).diag;
  const eps = (opts.relEps ?? 1e-9) * diag;
  const V = vertices.length / 3;
  const out = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ux = vertices[u * 3], uy = vertices[u * 3 + 1], uz = vertices[u * 3 + 2];
      const vx = vertices[v * 3], vy = vertices[v * 3 + 1], vz = vertices[v * 3 + 2];
      const dx = vx - ux, dy = vy - uy, dz = vz - uz;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 === 0) continue;
      const len = Math.sqrt(len2);
      const minX = Math.min(ux, vx) - eps, maxX = Math.max(ux, vx) + eps;
      const minY = Math.min(uy, vy) - eps, maxY = Math.max(uy, vy) + eps;
      const minZ = Math.min(uz, vz) - eps, maxZ = Math.max(uz, vz) + eps;
      for (let w = 0; w < V; w++) {
        if (w === a || w === b || w === c) continue;
        const wx = vertices[w * 3], wy = vertices[w * 3 + 1], wz = vertices[w * 3 + 2];
        if (wx < minX || wx > maxX || wy < minY || wy > maxY || wz < minZ || wz > maxZ) continue;
        const s = ((wx - ux) * dx + (wy - uy) * dy + (wz - uz) * dz) / len2;
        if (s <= 0 || s >= 1) continue;
        const px = ux + s * dx, py = uy + s * dy, pz = uz + s * dz;
        if (Math.hypot(wx - px, wy - py, wz - pz) > eps) continue;
        if (s * len <= eps || (1 - s) * len <= eps) continue;
        out.push({ vertex: w, tri: t / 3, edgeA: u, edgeB: v, t: s });
      }
    }
  }
  return out;
}