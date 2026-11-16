import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './src/core.mjs';

const [corpusRes, refRes] = await Promise.all([
  fetch('./data/corpus.json').then((r) => r.json()),
  fetch('./data/reference.json').then((r) => r.json())
]);

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.6, 2.1, 3.1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xd7dee8, 0x161b22, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x58a6ff, 1.0);
rim.position.set(-4, -2, -3);
scene.add(rim);

const group = new THREE.Group();
scene.add(group);
const state = { index: 0, raw: true, rotate: false, cores: [], metrics: {} };

function buildEdges(vertices, triangles) {
  const set = new Set();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e], b = triangles[t + (e + 1) % 3];
      set.add(Math.min(a, b) + ',' + Math.max(a, b));
    }
  }
  const pos = [];
  for (const k of set) {
    const [a, b] = k.split(',').map(Number);
    pos.push(vertices[a * 3], vertices[a * 3 + 1], vertices[a * 3 + 2]);
    pos.push(vertices[b * 3], vertices[b * 3 + 1], vertices[b * 3 + 2]);
  }
  return pos;
}

function normalizedPositions(verts, center, scale) {
  const out = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    out[i] = (verts[i] - center.x) * scale;
    out[i + 1] = (verts[i + 1] - center.y) * scale;
    out[i + 2] = (verts[i + 2] - center.z) * scale;
  }
  return out;
}

function renderCorpus(idx) {
  state.index = idx;
  while (group.children.length) {
    const ch = group.children.pop();
    ch.geometry?.dispose();
    ch.material?.dispose();
    group.remove(ch);
  }
  const c = corpusRes.corpora[idx];
  const welded = C.weldExact(c.vertices, c.triangles);
  const tjs = C.detectTJunctions(welded.vertices, welded.triangles, {});
  const healed = C.healTJunctions(c.vertices, c.triangles, {});
  const audit = C.auditMesh(healed.vertices, healed.triangles, {});
  const hash = C.meshHash(healed.vertices, healed.triangles);
  const ref = refRes.corpora[c.name];
  state.metrics = { tjs: tjs.length, audit, hash, ref, added: healed.stats };

  const bb = C.bboxOf(healed.vertices);
  const center = new THREE.Vector3(...bb.min).add(new THREE.Vector3(...bb.max)).multiplyScalar(0.5);
  const scale = 2.6 / bb.diag;
  const pos = normalizedPositions(healed.vertices, center, scale);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(healed.triangles);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x9aa7b8, metalness: 0.15, roughness: 0.55, flatShading: true,
    side: THREE.DoubleSide
  }));
  group.add(mesh);

  const edgePos = normalizedPositions(buildEdges(welded.vertices, welded.triangles), center, scale);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePos), 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: 0xd29922, transparent: true, opacity: 0.55
  }));
  edges.name = 'raw';
  group.add(edges);

  const tp = [];
  const seen = new Set();
  for (const j of tjs) {
    if (seen.has(j.vertex)) continue;
    seen.add(j.vertex);
    tp.push((welded.vertices[j.vertex * 3] - center.x) * scale,
      (welded.vertices[j.vertex * 3 + 1] - center.y) * scale,
      (welded.vertices[j.vertex * 3 + 2] - center.z) * scale);
  }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tp), 3));
  const points = new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: 0xf85149, size: 0.035 }));
  points.name = 'tj';
  group.add(points);

  edges.visible = points.visible = state.raw;
  writeStats(c, idx);
}

function writeStats(c, idx) {
  const { tjs, audit, hash, ref, added } = state.metrics;
  const hashOk = hash === ref.hash;
  const tjOk = tjs === ref.tJunctions;
  const wtOk = audit.watertight === ref.watertight;
  const areaErr = Math.abs(audit.area / c.truth.area - 1);
  const volErr = Math.abs(audit.volume / c.truth.volume - 1);
  const fmt = (n) => n.toExponential(3);
  document.getElementById('stats').innerHTML = `
    <div class="row"><span class="k">corpus</span><span class="v">${c.name} (${c.dims.join('×')})</span></div>
    <div class="row"><span class="k">input triangles</span><span class="v">${(c.triangles.length / 3).toLocaleString()}</span></div>
    <div class="row"><span class="k">T-junctions detected</span><span class="v ${tjOk ? 'ok' : 'bad'}">${tjs.toLocaleString()} ${tjOk ? '= node' : '≠ node'}</span></div>
    <div class="row"><span class="k">after healing</span><span class="v">${(audit.triangles).toLocaleString()} tris (+${added.addedTriangles.toLocaleString()})</span></div>
    <div class="row"><span class="k">watertight</span><span class="v ${wtOk && audit.watertight ? 'ok' : 'bad'}">${audit.watertight} (boundary ${audit.boundaryEdges}, non-manifold ${audit.nonManifoldEdges})</span></div>
    <div class="row"><span class="k">area error</span><span class="v">${fmt(areaErr)}</span></div>
    <div class="row"><span class="k">volume error</span><span class="v">${fmt(volErr)}</span></div>
    <div class="row"><span class="k">mesh hash</span><span class="v ${hashOk ? 'ok' : 'bad'}">0x${hash.toString(16)} ${hashOk ? '= node' : '≠ node'}</span></div>
    <div class="row"><span class="k">node reference</span><span class="v ok">0x${ref.hash.toString(16)}</span></div>`;
}

const buttons = document.getElementById('corpora');
corpusRes.corpora.forEach((c, i) => {
  const b = document.createElement('button');
  b.textContent = `${c.name} — ${c.dims.join(' × ')}`;
  b.onclick = () => {
    [...buttons.children].forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    renderCorpus(i);
  };
  if (i === 0) b.classList.add('active');
  buttons.appendChild(b);
});

document.getElementById('showRaw').onchange = (e) => {
  state.raw = e.target.checked;
  for (const ch of group.children) if (ch.name === 'raw' || ch.name === 'tj') ch.visible = state.raw;
};
document.getElementById('rotate').onchange = (e) => { state.rotate = e.target.checked; };

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderCorpus(0);

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state.rotate) group.rotation.y += dt * 0.4;
  controls.update();
  renderer.render(scene, camera);
});