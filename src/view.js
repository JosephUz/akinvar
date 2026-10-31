// Akın Var — Three.js çizimi. Her asker parçası (gövde, baş, mızrak, kılıç) tek InstancedMesh:
// 20 bin askerde bile dört çizim çağrısı. Matrisler Object3D'siz, doğrudan diziye yazılır.
import * as T from 'three';
import { TEAMS } from './config.js';
import { VCELL, visibleTo } from './sim.js';

const UP = 0.17; // yere yatan gövdenin yarı kalınlığı

// İndekssiz geometrileri, her birine sabit bir renk vererek tek geometride birleştirir.
function merge(parts) {
  const pos = [], nor = [], col = [];
  for (const [g, color] of parts) {
    const n = g.index ? g.toNonIndexed() : g, c = new T.Color(color);
    pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array);
    for (let k = 0; k < n.attributes.position.count; k++) col.push(c.r, c.g, c.b);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  return g;
}
const at = (g, x, y, z) => g.translate(x, y, z);

// Asker ayakları orijinde, yüzü +z yönünde. Gövde takım rengine boyanır (vertex rengi × örnek rengi).
const bodyGeo = () => merge([
  [at(new T.BoxGeometry(0.42, 0.5, 0.26), 0, 0.25, 0), '#5a5a5a'],          // bacaklar
  [at(new T.BoxGeometry(0.52, 0.62, 0.32), 0, 0.81, 0), '#ffffff'],         // gövde (takım rengi)
  [at(new T.BoxGeometry(0.56, 0.1, 0.36), 0, 0.56, 0), '#3c3428'],          // kemer
]);
const headGeo = () => merge([
  [at(new T.SphereGeometry(0.17, 8, 6), 0, 1.3, 0), '#d8b48c'],
  [at(new T.ConeGeometry(0.2, 0.22, 8), 0, 1.47, 0), '#8c9096'],            // miğfer
]);
// Silahlar el noktasına göre (sağ el) çizilir; matris eli döndürür.
const HAND = { x: -0.33, y: 0.85, z: 0.05 };
const spearGeo = () => merge([
  [at(new T.CylinderGeometry(0.03, 0.03, 2.4, 5), 0, 0.7, 0), '#7a5a36'],
  [at(new T.ConeGeometry(0.06, 0.24, 5), 0, 2.0, 0), '#c9ccd0'],
]);
const swordGeo = () => merge([
  [at(new T.BoxGeometry(0.07, 0.75, 0.025), 0, 0.45, 0), '#d5d8dc'],
  [at(new T.BoxGeometry(0.24, 0.05, 0.06), 0, 0.08, 0), '#5c4a2c'],
]);

// Sis ve alan dışı renkleri (RGBA, 0–255)
const FOG = [16, 26, 20, 165], OUT = [120, 34, 26, 125];

export class View {
  constructor(container) {
    this.container = container;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#1f281c');
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.append(this.renderer.domElement);

    this.camera = new T.OrthographicCamera(-30, 30, 20, -20, 0.1, 2000);
    this.target = new T.Vector3(); this.zoom = 45; this.angle = Math.PI / 4; this.tilt = 0.95;
    this.scene.add(new T.HemisphereLight('#f1ecd6', '#6f7f58', 2.6));
    this.sun = new T.DirectionalLight('#fff1cf', 2.1);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.parts = []; this.world = null; this.team = 0; this.selected = new Set(); this.fogOn = true;
    new ResizeObserver(() => this.resize()).observe(container); this.resize();
  }

  setShadows(on) {
    this.shadows = on; this.renderer.shadowMap.enabled = on; this.sun.castShadow = on;
    for (const m of this.parts) m.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.left = -this.zoom * w / h; this.camera.right = this.zoom * w / h;
    this.camera.top = this.zoom; this.camera.bottom = -this.zoom;
    this.camera.updateProjectionMatrix();
  }

  /** Yeni savaş: zemin, sis, alan sınırı ve asker örnekleri baştan kurulur. `team`: ekranın sahibi. */
  build(w, team = 0) {
    if (this.root) { this.scene.remove(this.root); this.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
    this.root = new T.Group(); this.scene.add(this.root); this.world = w; this.team = team; this.selected = new Set();
    const R = w.radius;

    // Çayır: hafif dalgalı renk; arena dışı daha koyu.
    const size = R * 3, seg = 140, ground = new T.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const cols = [], c = new T.Color(), p = ground.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k), n = Math.sin(x * 0.07) * Math.cos(z * 0.09) + Math.sin((x + z) * 0.023) * 0.8 + Math.sin(x * 0.31 + z * 0.17) * 0.25;
      c.set('#7f9a5a').offsetHSL(n * 0.012, 0, n * 0.03);
      { const d = Math.hypot(x, z) - R; if (d > 0) c.multiplyScalar(Math.max(0.16, 0.5 - d * 0.02)); } // arena dışı kararır
      cols.push(c.r, c.g, c.b);
    }
    ground.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    const groundMesh = new T.Mesh(ground, new T.MeshLambertMaterial({ vertexColors: true }));
    groundMesh.receiveShadow = true; this.root.add(groundMesh);

    // Sis ve alan dışı: görüş ızgarası boyutunda bir doku, zeminin hemen üstünde. Askerler üstünden geçer.
    const { span, off } = w.vgrid;
    this.fogData = new Uint8Array(span * span * 4); this.fogNow = new Float32Array(span * span * 4);
    this.fogTex = new T.DataTexture(this.fogData, span, span, T.RGBAFormat);
    this.fogTex.magFilter = this.fogTex.minFilter = T.LinearFilter; this.fogTex.needsUpdate = true;
    const fog = new T.Mesh(new T.PlaneGeometry(span * VCELL, span * VCELL).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false }));
    fog.position.set(-off + (span * VCELL) / 2, 0.05, -off + (span * VCELL) / 2); fog.renderOrder = 1;
    this.root.add(fog); this.fogFirst = true;

    // Arena sınırı (soluk) ve daralan alan çizgisi (her karede yeniden).
    const ring = new T.Mesh(new T.RingGeometry(R - 0.4, R + 0.4, 180).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#e4c77a', transparent: true, opacity: 0.35 }));
    ring.position.y = 0.06; this.root.add(ring);
    this.zoneLine = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0.9, depthWrite: false }));
    this.zoneLine.position.y = 0.08; this.zoneLine.renderOrder = 2; this.root.add(this.zoneLine); this.zoneR = -1;

    // Emir işareti
    this.marker = new T.Mesh(new T.RingGeometry(0.8, 1.2, 32).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#f3d67c', transparent: true, depthWrite: false }));
    this.marker.position.y = 0.1; this.marker.visible = false; this.marker.renderOrder = 3; this.root.add(this.marker);

    const mk = (geo, tinted) => {
      const m = new T.InstancedMesh(geo, new T.MeshLambertMaterial({ vertexColors: true }), w.N);
      m.frustumCulled = false; m.castShadow = !!this.shadows; m.receiveShadow = false;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.root.add(m); return m;
    };
    this.body = mk(bodyGeo(), true); this.head = mk(headGeo(), false);
    this.spear = mk(spearGeo(), false); this.sword = mk(swordGeo(), false);
    this.parts = [this.body, this.head, this.spear, this.sword];
    this.teamColors = TEAMS.map((t) => new T.Color(t.color));
    this.deadColors = this.teamColors.map((c) => c.clone().multiplyScalar(0.45));
    this.selColor = new T.Color(TEAMS[team].selected || '#ffffff');
    this.dimmed = new Uint8Array(w.N);
    for (let i = 0; i < w.N; i++) this.body.setColorAt(i, this.teamColors[w.team[i]]);
    this.target.set(0, 0, 0); this.zoom = Math.min(R * 0.55, 70); this.resize();
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -R; this.sun.shadow.camera.right = this.sun.shadow.camera.top = R;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = R * 4; this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Seçili bölüklerin askerleri açık renge boyanır. */
  setSelection(set) {
    const w = this.world, old = this.selected; this.selected = new Set(set);
    for (let i = 0; i < w.N; i++) {
      const b = w.boluk[i];
      if (old.has(b) === this.selected.has(b) || w.hp[i] <= 0) continue;
      this.body.setColorAt(i, this.selected.has(b) ? this.selColor : this.teamColors[w.team[i]]);
    }
    this.body.instanceColor.needsUpdate = true;
  }

  showMarker(x, z, attack) {
    this.marker.position.x = x; this.marker.position.z = z;
    this.marker.material.color.set(attack ? '#ff6b4f' : '#f3d67c');
    this.marker.visible = true; this.markerAt = performance.now();
  }

  updateCamera() {
    const R = this.world?.radius ?? 100;
    const r = Math.hypot(this.target.x, this.target.z);
    if (r > R * 1.1) this.target.multiplyScalar((R * 1.1) / r);
    const dist = 600, hor = Math.cos(this.tilt) * dist;
    this.camera.position.set(this.target.x + Math.sin(this.angle) * hor, Math.sin(this.tilt) * dist, this.target.z + Math.cos(this.angle) * hor);
    this.camera.lookAt(this.target);
    this.sun.position.set(-0.6 * R, 1.6 * R, 0.4 * R); this.sun.target.position.set(0, 0, 0);
  }

  // Sis dokusu: görünmeyen hücreler karanlık, alan dışı kızıl. Yumuşak geçiş için her karede hedefe yaklaşır.
  updateFog(w, dt) {
    const { span, off } = w.vgrid, vis = w.vis[this.team], zr2 = w.zone * w.zone, edge2 = (w.radius + VCELL) ** 2;
    const now = this.fogNow, data = this.fogData, k = this.fogFirst ? 1 : Math.min(1, dt * 6);
    for (let gz = 0; gz < span; gz++) {
      const z = gz * VCELL - off + VCELL / 2, row = (span - 1 - gz) * span; // doku satırı 0 = +z ucu
      for (let gx = 0; gx < span; gx++) {
        const x = gx * VCELL - off + VCELL / 2, o = (row + gx) * 4;
        const d2 = x * x + z * z;
        if (d2 > edge2) { data[o + 3] = 0; continue; } // arena dışı: zemin zaten karanlık
        const out = d2 > zr2, hidden = this.fogOn && !vis[gz * span + gx];
        const t = out ? OUT : hidden ? FOG : null;
        for (let q = 0; q < 4; q++) {
          const target = t ? (out && hidden && q === 3 ? Math.max(OUT[3], FOG[3]) : t[q]) : q === 3 ? 0 : now[o + q];
          now[o + q] += (target - now[o + q]) * k; data[o + q] = now[o + q];
        }
      }
    }
    this.fogTex.needsUpdate = true; this.fogFirst = false;
  }

  render(w, alpha, now, dt = 1 / 60) {
    const N = w.N, bm = this.body.instanceMatrix.array, hm = this.head.instanceMatrix.array;
    const sm = this.spear.instanceMatrix.array, km = this.sword.instanceMatrix.array;
    const { x, z, px, pz, face, hp, diedAt, swing, boluk, team } = w, kind = w.bkind, me = this.team;
    let colors = false;
    for (let i = 0; i < N; i++) {
      const o = i * 16;
      const xi = px[i] + (x[i] - px[i]) * alpha, zi = pz[i] + (z[i] - pz[i]) * alpha;
      // Sisin içindeki düşman (ölüsü dahil) görünmez.
      if (this.fogOn && team[i] !== me && !visibleTo(w, me, xi, zi)) {
        hide(bm, o); hide(hm, o); hide(sm, o); hide(km, o); continue;
      }
      const f = face[i], s = Math.sin(f), c = Math.cos(f);
      let pitch = 0, y = 0;
      if (hp[i] <= 0) {
        // Ölenin rengi koyulaşır: yığın içinde canlılar seçilsin.
        if (!this.dimmed[i]) { this.dimmed[i] = 1; this.body.setColorAt(i, this.deadColors[team[i]]); colors = true; }
        const k = Math.min(1, (w.t - diedAt[i]) / 0.45); pitch = -Math.PI / 2 * k; y = UP * k;
      } else if (Math.abs(x[i] - px[i]) + Math.abs(z[i] - pz[i]) > 0.02) y = Math.abs(Math.sin(now * 9 + i)) * 0.07;
      writeMatrix(bm, o, xi, y, zi, s, c, pitch);
      writeMatrix(hm, o, xi, y, zi, s, c, pitch);
      // El noktası: gövde döndürmesinden sonra dünyada. Vuruşta silah öne iner (mızrak) ya da savrulur (kılıç).
      const sp = Math.sin(pitch), cp = Math.cos(pitch);
      const hy = HAND.y * cp - HAND.z * sp, hz = HAND.y * sp + HAND.z * cp;
      const hx = xi + c * HAND.x + s * hz, hzW = zi - s * HAND.x + c * hz;
      const sw = swing[i] > 0 ? Math.sin((1 - swing[i] / 0.35) * Math.PI) : 0;
      const spear = kind[boluk[i]] === 0;
      const wp = hp[i] <= 0 ? pitch : pitch + (spear ? 0.25 + sw * 1.1 : 0.5 + sw * 1.4);
      writeMatrix(spear ? sm : km, o, hx, y + hy, hzW, s, c, wp);
      hide(spear ? km : sm, o);
    }
    if (colors) this.body.instanceColor.needsUpdate = true;
    for (const m of this.parts) m.instanceMatrix.needsUpdate = true;

    // Daralan alan çizgisi
    if (Math.abs(this.zoneR - w.zone) > 0.05) {
      this.zoneR = w.zone; this.zoneLine.geometry.dispose();
      this.zoneLine.geometry = w.zone > 0.5 ? new T.RingGeometry(w.zone - 0.35, w.zone + 0.35, 200).rotateX(-Math.PI / 2) : new T.BufferGeometry();
    }
    this.updateFog(w, dt);
    if (this.marker.visible) {
      const a = (performance.now() - this.markerAt) / 700;
      if (a >= 1) this.marker.visible = false;
      else { this.marker.material.opacity = 1 - a; this.marker.scale.setScalar(1 + a * 1.5); }
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  /** Ekran noktasının yerdeki karşılığı (seçim ve emir için). */
  groundAt(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = new T.Vector3();
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }

  /** Dünya noktasının ekrandaki yeri (kutu seçimi için). */
  toScreen(x, z) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new T.Vector3(x, 0.8, z).project(this.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }
}

function hide(a, o) { a.fill(0, o, o + 16); }

// M = Ry(yaw) · Rx(pitch), sütun öncelikli. s/c: sin/cos(yaw).
function writeMatrix(a, o, x, y, z, s, c, pitch) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
  a[o + 4] = s * sp; a[o + 5] = cp; a[o + 6] = c * sp; a[o + 7] = 0;
  a[o + 8] = s * cp; a[o + 9] = -sp; a[o + 10] = c * cp; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}
