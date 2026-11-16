// Timing harness: 1 warmup + 7 measured repetitions, cold start recorded
// separately. Reports min / median / p95 / stddev / relSD (stddev / median).
import { readFileSync, writeFileSync } from 'node:fs';
import * as C from '../src/core.mjs';
import { detectNaive } from '../baseline/naive.mjs';

const data = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url)));
const c = data.corpora.find((x) => x.name === 'cube-k8');
const welded = C.weldExact(c.vertices, c.triangles);
const opts = {};

function stats(samples) {
  const s = samples.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const median = n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  return {
    samples: s.map((x) => Number(x.toFixed(3))),
    min: Number(s[0].toFixed(3)),
    median: Number(median.toFixed(3)),
    p95: Number(s[Math.ceil(0.95 * n) - 1].toFixed(3)),
    mean: Number(mean.toFixed(3)),
    stddev: Number(sd.toFixed(3)),
    relSD: Number((sd / median).toFixed(4))
  };
}

function measure(fn, reps = 7, inner = 1) {
  const cold = performance.now(); fn(); const coldMs = performance.now() - cold;
  fn(); // warmup
  const samples = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    for (let k = 0; k < inner; k++) fn();
    samples.push((performance.now() - t0) / inner);
  }
  return { cold: Number(coldMs.toFixed(3)), inner, ...stats(samples) };
}

const grid = measure(() => C.detectTJunctions(welded.vertices, welded.triangles, opts));
const naive = measure(() => detectNaive(welded.vertices, welded.triangles, opts));
const heal = measure(() => C.healTJunctions(c.vertices, c.triangles, opts), 9, 10);

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  corpus: { name: c.name, vertices: welded.vertices.length / 3, triangles: welded.triangles.length / 3,
    weldedDuplicates: welded.welded, tJunctions: gridCount() },
  detection: { grid, naive, speedupMedian: Number((naive.median / grid.median).toFixed(2)),
    speedupCold: Number((naive.cold / grid.cold).toFixed(2)) },
  healing: heal,
  method: '1 cold run + 1 warmup + 7 measured (healing: 9 samples x 10 inner runs, reported per run); p95 = nearest-rank index ceil(0.95*n)-1; relSD = stddev/median'
};
function gridCount() { return C.detectTJunctions(welded.vertices, welded.triangles, opts).length; }

writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));