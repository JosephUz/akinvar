// Akın Var — Three.js çizimi. Her model parçası (gövde, baş, silahlar, kalkan, at, ok) tek InstancedMesh:
// binlerce askerde bile birkaç çizim çağrısı. Matrisler Object3D'siz, doğrudan diziye yazılır.
import * as T from 'three';
import { ARROW } from './config.js';
import { VCELL, visibleTo } from './sim.js';
import { CLASSES } from './units.js';

const UP = 0.17;      // yere yatan gövdenin yarı kalınlığı
const SADDLE = 0.78;  // atlının ata göre yüksekliği
const MAX_ARROWS = 4000;

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
const box = (w, h, d, x, y, z) => at(new T.BoxGeometry(w, h, d), x, y, z);

// Asker ayakları orijinde, yüzü +z yönünde. Gövde oyuncu rengine boyanır (vertex rengi × örnek rengi).
const GEO = {
  body: () => merge([[box(0.42, 0.5, 0.26, 0, 0.25, 0), '#5a5a5a'], [box(0.52, 0.62, 0.32, 0, 0.81, 0), '#ffffff'], [box(0.56, 0.1, 0.36, 0, 0.56, 0), '#3c3428']]),
  head: () => merge([[at(new T.SphereGeometry(0.17, 8, 6), 0, 1.3, 0), '#d8b48c']]),
  // Miğfer ve omuzluk beyaz çizilir; örnek rengi zırhın malzemesini verir (deri, zincir, çelik). Zırhsızda yoktur.
  helm: () => merge([[at(new T.SphereGeometry(0.19, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.33, 0), '#ffffff'], [at(new T.ConeGeometry(0.16, 0.2, 8), 0, 1.58, 0), '#ffffff'], [box(0.04, 0.16, 0.05, 0, 1.3, 0.18), '#ffffff']]),
  // Omuzluklar ve etek; gövdenin ortası takım renginde kalır.
  armor: () => merge([[box(0.2, 0.16, 0.38, -0.33, 1.06, 0), '#ffffff'], [box(0.2, 0.16, 0.38, 0.33, 1.06, 0), '#ffffff'], [box(0.56, 0.2, 0.36, 0, 0.6, 0), '#ffffff'], [box(0.58, 0.06, 0.38, 0, 0.72, 0), '#5c4630']]),
  shield: () => merge([[box(0.08, 0.62, 0.5, 0.36, 0.82, 0.12), '#ffffff'], [box(0.1, 0.2, 0.18, 0.37, 0.82, 0.12), '#c9b27a']]),
  horse: () => merge([
    [box(0.5, 0.55, 1.45, 0, 0.98, 0), '#6b4a2e'],
    ...[[-0.18, 0.5], [0.18, 0.5], [-0.18, -0.5], [0.18, -0.5]].map(([x, z]) => [box(0.13, 0.72, 0.13, x, 0.36, z), '#4d3420']),
    [box(0.24, 0.62, 0.3, 0, 1.38, 0.72), '#6b4a2e'], [box(0.22, 0.24, 0.44, 0, 1.62, 0.92), '#5a3d25'],
  ]),
  // Silahlar el noktasına göre (sağ el) çizilir; matris eli döndürür.
  spear: () => merge([[at(new T.CylinderGeometry(0.03, 0.03, 2.4, 5), 0, 0.7, 0), '#7a5a36'], [at(new T.ConeGeometry(0.06, 0.24, 5), 0, 2.0, 0), '#c9ccd0']]),
  sword: () => merge([[box(0.07, 0.75, 0.025, 0, 0.45, 0), '#d5d8dc'], [box(0.24, 0.05, 0.06, 0, 0.08, 0), '#5c4a2c']]),
  great: () => merge([[box(0.09, 1.25, 0.03, 0, 0.7, 0), '#d5d8dc'], [box(0.32, 0.06, 0.07, 0, 0.08, 0), '#5c4a2c'], [box(0.05, 0.3, 0.05, 0, -0.1, 0), '#3c2c18']]),
  bow: () => merge([[box(0.05, 1.15, 0.05, 0, 0.1, 0.12), '#6d4b2a'], [box(0.01, 1.1, 0.01, 0, 0.1, 0.02), '#e9e2cf']]),
  crossbow: () => merge([[box(0.08, 0.08, 0.7, 0, 0, 0.25), '#5c4126'], [box(0.62, 0.05, 0.06, 0, 0.02, 0.5), '#7d5a33']]),
  arrow: () => merge([[box(0.035, 0.035, 0.9, 0, 0, 0), '#d9c9a4'], [box(0.07, 0.07, 0.14, 0, 0, 0.47), '#9aa0a6']]),
};
const HAND = { x: -0.33, y: 0.85, z: 0.05 };
const WEAPON_MESH = { spear: 'spear', sword: 'sword', great: 'great', bow: 'bow', crossbow: 'crossbow', fist: null };

// Malzemenin rengi: kalkan, miğfer, omuzluk ve silah örneklerine çarpan olarak. Çelik parlak, demir gri, tahta ve deri kahve.
const MAT_COLOR = { wo: '#8a6438', le: '#7a5232', ir: '#7f8790', ch: '#9aa3ad', st: '#f4f8ff' };
const WEAPON_TINT = { wo: [0.8, 0.62, 0.42], ir: [0.72, 0.75, 0.8], st: [1.3, 1.32, 1.4] };

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
    this.meshes = {}; this.world = null; this.team = 0; this.selected = new Set(); this.fogOn = true;
    new ResizeObserver(() => this.resize()).observe(container); this.resize();
  }

  setShadows(on) {
    this.shadows = on; this.renderer.shadowMap.enabled = on; this.sun.castShadow = on;
    for (const m of Object.values(this.meshes)) m.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.left = -this.zoom * w / h; this.camera.right = this.zoom * w / h;
    this.camera.top = this.zoom; this.camera.bottom = -this.zoom;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Yeni savaş: zemin, sis, alan sınırı ve asker örnekleri baştan kurulur.
   * team: ekranın sahibi; colors[savaştaki oyuncu no] = gövde rengi; selected: seçili askerin rengi.
   */
  build(w, { team = 0, colors = [], selected = '#ffffff' } = {}) {
    if (this.root) { this.scene.remove(this.root); this.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); }); }
    this.root = new T.Group(); this.scene.add(this.root); this.world = w; this.team = team; this.selected = new Set();
    const R = w.radius;

    // Çayır: hafif dalgalı renk; arena dışı kararır.
    const size = R * 3, seg = 140, ground = new T.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const cols = [], c = new T.Color(), p = ground.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k), n = Math.sin(x * 0.07) * Math.cos(z * 0.09) + Math.sin((x + z) * 0.023) * 0.8 + Math.sin(x * 0.31 + z * 0.17) * 0.25;
      c.set('#7f9a5a').offsetHSL(n * 0.012, 0, n * 0.03);
      { const d = Math.hypot(x, z) - R; if (d > 0) c.multiplyScalar(Math.max(0.16, 0.5 - d * 0.02)); }
      cols.push(c.r, c.g, c.b);
    }
    ground.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    const groundMesh = new T.Mesh(ground, new T.MeshLambertMaterial({ vertexColors: true }));
    groundMesh.receiveShadow = true; this.root.add(groundMesh);

    // Sis ve alan dışı: görüş ızgarası boyutunda bir doku, zeminin hemen üstünde.
    const { span, off } = w.vgrid;
    this.fogData = new Uint8Array(span * span * 4); this.fogNow = new Float32Array(span * span * 4);
    this.fogTex = new T.DataTexture(this.fogData, span, span, T.RGBAFormat);
    this.fogTex.magFilter = this.fogTex.minFilter = T.LinearFilter; this.fogTex.needsUpdate = true;
    const fog = new T.Mesh(new T.PlaneGeometry(span * VCELL, span * VCELL).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false }));
    fog.position.set(-off + (span * VCELL) / 2, 0.05, -off + (span * VCELL) / 2); fog.renderOrder = 1;
    this.root.add(fog); this.fogFirst = true;

    const ring = new T.Mesh(new T.RingGeometry(R - 0.4, R + 0.4, 180).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#e4c77a', transparent: true, opacity: 0.35 }));
    ring.position.y = 0.06; this.root.add(ring);
    this.zoneLine = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0.9, depthWrite: false }));
    this.zoneLine.position.y = 0.08; this.zoneLine.renderOrder = 2; this.root.add(this.zoneLine); this.zoneR = -1;
    this.marker = new T.Mesh(new T.RingGeometry(0.8, 1.2, 32).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#f3d67c', transparent: true, depthWrite: false }));
    this.marker.position.y = 0.1; this.marker.visible = false; this.marker.renderOrder = 3; this.root.add(this.marker);
    this.flagGroup = new T.Group(); this.root.add(this.flagGroup);

    // Model parçaları. Kullanılmayan örnekler sıfır matrisle görünmez.
    const n = Math.max(1, w.N);
    const mk = (name, count = n) => {
      const m = new T.InstancedMesh(GEO[name](), new T.MeshLambertMaterial({ vertexColors: true }), count);
      m.frustumCulled = false; m.castShadow = !!this.shadows;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.instanceMatrix.array.fill(0);
      this.root.add(m); return m;
    };
    this.meshes = {};
    for (const name of ['body', 'head', 'helm', 'armor', 'shield', 'horse', 'spear', 'sword', 'great', 'bow', 'crossbow']) this.meshes[name] = mk(name);
    this.meshes.arrow = mk('arrow', MAX_ARROWS); this.arrowsShown = 0;
    // Bölük başına model bilgisi
    this.bmodel = Array.from({ length: w.B }, (_, b) => {
      const cls = CLASSES[w.bcls[b]], wm = WEAPON_MESH[cls.model];
      const [wk, sk, , ak] = cls.key.split('-');
      return { weapon: wm ? this.meshes[wm].instanceMatrix.array : null, wmesh: wm, wmat: wk.split(':')[1], smat: sk.split(':')[1], amat: ak === 'no' ? null : ak,
        model: cls.model, shield: cls.shield > 0, armor: ak !== 'no', mounted: cls.mounted };
    });
    // Malzeme renkleri bölük başına bir kez boyanır.
    const tint = new T.Color(), paint = new Set();
    for (let i = 0; i < w.N; i++) {
      const md = this.bmodel[w.boluk[i]];
      if (md.shield) { this.meshes.shield.setColorAt(i, tint.set(MAT_COLOR[md.smat] ?? '#8a6438')); paint.add('shield'); }
      if (md.armor) { tint.set(MAT_COLOR[md.amat]); this.meshes.helm.setColorAt(i, tint); this.meshes.armor.setColorAt(i, tint); paint.add('helm').add('armor'); }
      if (md.wmesh) { const k = WEAPON_TINT[md.wmat] ?? [1, 1, 1]; this.meshes[md.wmesh].setColorAt(i, tint.setRGB(k[0], k[1], k[2])); paint.add(md.wmesh); }
    }
    for (const name of paint) this.meshes[name].instanceColor.needsUpdate = true;
    this.colors = colors.map((x) => new T.Color(x));
    this.deadColors = this.colors.map((x) => x.clone().multiplyScalar(0.45));
    this.selColor = new T.Color(selected);
    this.dimmed = new Uint8Array(n); this.gone = new Uint8Array(n);
    for (let i = 0; i < w.N; i++) this.meshes.body.setColorAt(i, this.colors[w.bowner[w.boluk[i]]] ?? this.selColor);
    if (w.N) this.meshes.body.instanceColor.needsUpdate = true;
    this.target.set(0, 0, 0); this.zoom = Math.min(R * 0.55, 70); this.resize();
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -R; this.sun.shadow.camera.right = this.sun.shadow.camera.top = R;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = R * 4; this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Bayrak evresi: bayraklar dikilir. flags: [{x, z}], colors: bayrak sahibinin rengi. */
  buildFlags(flags, colors) {
    for (const g of this.flagGroup.children) g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.flagGroup.clear();
    flags.forEach((f, k) => {
      const g = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(0.08, 0.1, 5, 6), new T.MeshLambertMaterial({ color: '#5b4329' }));
      pole.position.y = 2.5;
      const cloth = new T.Mesh(new T.BoxGeometry(0.06, 1.4, 2.2), new T.MeshLambertMaterial({ color: colors[k] }));
      cloth.position.set(0, 4.2, 1.15);
      const base = new T.Mesh(new T.CylinderGeometry(1.1, 1.3, 0.25, 16), new T.MeshLambertMaterial({ color: '#6d6450' }));
      base.position.y = 0.12;
      g.add(pole, cloth, base); g.position.set(f.x, 0, f.z); g.userData.cloth = cloth;
      this.flagGroup.add(g);
    });
  }

  /** Seçili bölüklerin askerleri açık renge boyanır. */
  setSelection(set) {
    const w = this.world, old = this.selected, body = this.meshes.body; this.selected = new Set(set);
    for (let i = 0; i < w.N; i++) {
      const b = w.boluk[i];
      if (old.has(b) === this.selected.has(b) || w.hp[i] <= 0) continue;
      body.setColorAt(i, this.selected.has(b) ? this.selColor : this.colors[w.bowner[b]]);
    }
    if (w.N) body.instanceColor.needsUpdate = true;
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
    const fogOn = this.fogOn && w.phase === 'battle';
    const now = this.fogNow, data = this.fogData, k = this.fogFirst ? 1 : Math.min(1, dt * 6);
    for (let gz = 0; gz < span; gz++) {
      const z = gz * VCELL - off + VCELL / 2, row = (span - 1 - gz) * span; // doku satırı 0 = +z ucu
      for (let gx = 0; gx < span; gx++) {
        const x = gx * VCELL - off + VCELL / 2, o = (row + gx) * 4;
        const d2 = x * x + z * z;
        if (d2 > edge2) { data[o + 3] = 0; continue; } // arena dışı: zemin zaten karanlık
        const out = w.phase === 'battle' && d2 > zr2, hidden = fogOn && !vis[gz * span + gx]; // bayrak evresinde alan yok
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
    const M = this.meshes, bm = M.body.instanceMatrix.array, hm = M.head.instanceMatrix.array;
    const shm = M.shield.instanceMatrix.array, horm = M.horse.instanceMatrix.array, helm = M.helm.instanceMatrix.array, arm = M.armor.instanceMatrix.array;
    const { x, z, px, pz, face, hp, diedAt, swing, boluk, team, spent } = w, me = this.team;
    const fogOn = this.fogOn && w.phase === 'battle';
    let colors = false;
    for (let i = 0; i < w.N; i++) {
      const o = i * 16, bi = boluk[i], md = this.bmodel[bi];
      if (spent[i]) {
        if (!this.gone[i]) { this.gone[i] = 1; for (const a of [bm, hm, helm, arm, shm, horm, md.weapon]) if (a) hide(a, o); }
        continue;
      }
      const xi = px[i] + (x[i] - px[i]) * alpha, zi = pz[i] + (z[i] - pz[i]) * alpha;
      // Sisin içindeki düşman (ölüsü dahil) görünmez.
      if (fogOn && team[i] !== me && !visibleTo(w, me, xi, zi)) {
        for (const a of [bm, hm, md.armor && helm, md.armor && arm, md.shield && shm, md.mounted && horm, md.weapon]) if (a) hide(a, o);
        continue;
      }
      const f = face[i], s = Math.sin(f), c = Math.cos(f);
      let pitch = 0, y = 0, bob = 0;
      if (hp[i] <= 0) {
        // Ölenin rengi koyulaşır: yığın içinde canlılar seçilsin.
        if (!this.dimmed[i]) { this.dimmed[i] = 1; M.body.setColorAt(i, this.deadColors[w.bowner[bi]]); colors = true; }
        const k = Math.min(1, (w.t - diedAt[i]) / 0.45); pitch = -Math.PI / 2 * k; y = UP * k;
      } else if (Math.abs(x[i] - px[i]) + Math.abs(z[i] - pz[i]) > 0.02) bob = Math.abs(Math.sin(now * (md.mounted ? 12 : 9) + i)) * (md.mounted ? 0.1 : 0.07);
      const ry = y + bob + (md.mounted && hp[i] > 0 ? SADDLE : 0);
      if (md.mounted) writeMatrix(horm, o, xi, y + bob * 0.5, zi, s, c, pitch);
      writeMatrix(bm, o, xi, ry, zi, s, c, pitch);
      writeMatrix(hm, o, xi, ry, zi, s, c, pitch);
      if (md.armor) { writeMatrix(helm, o, xi, ry, zi, s, c, pitch); writeMatrix(arm, o, xi, ry, zi, s, c, pitch); }
      if (md.shield) writeMatrix(shm, o, xi, ry, zi, s, c, pitch);
      if (md.weapon) {
        // El noktası: gövde döndürmesinden sonra dünyada. Vuruşta silah öne iner (mızrak), savrulur (kılıç), yay gerilir.
        const sp = Math.sin(pitch), cp = Math.cos(pitch);
        const hy = HAND.y * cp - HAND.z * sp, hz = HAND.y * sp + HAND.z * cp;
        const hx = xi + c * HAND.x + s * hz, hzW = zi - s * HAND.x + c * hz;
        const sw = swing[i] > 0 ? Math.sin((1 - swing[i] / 0.35) * Math.PI) : 0;
        const wp = hp[i] <= 0 ? pitch : pitch + ({ spear: 0.25 + sw * 1.1, sword: 0.5 + sw * 1.4, great: 0.35 + sw * 1.6, bow: 0.05 - sw * 0.2, crossbow: 0 }[md.model] ?? 0);
        writeMatrix(md.weapon, o, hx, ry + hy, hzW, s, c, wp);
      }
    }
    if (colors) M.body.instanceColor.needsUpdate = true;

    // Oklar: yay çizerek uçar.
    const am = M.arrow.instanceMatrix.array, arrows = w.phase === 'battle' ? w.arrows : [];
    let k = 0;
    for (const a of arrows) {
      if (k >= MAX_ARROWS) break;
      const u = Math.min(1, Math.max(0, (w.t + alpha / 20 - a.t0) / (a.t1 - a.t0)));
      const dx = a.tx - a.sx, dz = a.tz - a.sz, d = Math.hypot(dx, dz) || 1;
      const ax = a.sx + dx * u, az = a.sz + dz * u, ay = 1.3 + Math.sin(Math.PI * u) * d * ARROW.arc - u * 0.8;
      if (fogOn && !visibleTo(w, me, ax, az)) continue;
      const slope = Math.PI * Math.cos(Math.PI * u) * ARROW.arc - 0.8 / d;
      writeMatrix(am, k * 16, ax, ay, az, dx / d, dz / d, -Math.atan(slope)); k++;
    }
    if (this.arrowsShown > k) am.fill(0, k * 16, this.arrowsShown * 16);
    this.arrowsShown = k;
    for (const m of Object.values(M)) m.instanceMatrix.needsUpdate = true;

    // Daralan alan çizgisi
    this.zoneLine.visible = w.phase === 'battle';
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
    for (const g of this.flagGroup.children) g.userData.cloth.rotation.y = Math.sin(now * 3 + g.position.x) * 0.15;
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

  /** Çok nokta için: tuval kutusu bir kez okunur (bölük sancakları her karede). */
  projector() {
    const r = this.renderer.domElement.getBoundingClientRect(), v = new T.Vector3(), cam = this.camera;
    return (x, z, y = 0.8) => { v.set(x, y, z).project(cam); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; };
  }

  /** Dünya noktasının ekrandaki yeri (kutu seçimi, bayrak yazıları). */
  toScreen(x, z, y = 0.8) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new T.Vector3(x, y, z).project(this.camera);
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
