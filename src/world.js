import * as THREE from 'three';

// ---------- 卡通渐变材质 ----------
let _gradient = null;
export function getGradientMap() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([110, 170, 230, 255]);
  _gradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  _gradient.minFilter = THREE.NearestFilter;
  _gradient.magFilter = THREE.NearestFilter;
  _gradient.needsUpdate = true;
  return _gradient;
}
export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap(), ...opts });
}

// ---------- 噪声 ----------
function hash2(ix, iz) {
  let n = (ix * 374761393 + iz * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}
function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const fbm = (x, z) => valueNoise(x, z) * 0.65 + valueNoise(x * 2.13 + 5.2, z * 2.13 + 1.3) * 0.35;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (d, r) => Math.exp(-(d * d) / (r * r));
const dist2 = (x, z, a, b) => Math.hypot(x - a, z - b);

export const POND = { x: 26, z: 14, r: 10.5 };
export const WATER_Y = -0.45;
export const PLAY_RADIUS = 58;
export const CYCLE = 240; // 一昼夜秒数

// 天空关键帧:[t, 天空色, 雾色, 太阳强度, 环境强度, 太阳色]
const SKY_STOPS = [
  [0.00, 0xf0a36a, 0xf6c79c, 1.3, 0.55, 0xffc890],
  [0.08, 0x6fb6ee, 0xc9e4f6, 2.6, 0.95, 0xfff2dd],
  [0.40, 0x5fa8e6, 0xbedcf2, 2.7, 0.95, 0xffeed0],
  [0.50, 0xf08c52, 0xf6b285, 1.5, 0.6, 0xffb070],
  [0.56, 0x3a3a68, 0x4e4e78, 0.35, 0.42, 0x9090c0],
  [0.62, 0x141c44, 0x222c54, 0.0, 0.4, 0x8090c0],
  [0.93, 0x141c44, 0x222c54, 0.0, 0.4, 0x8090c0],
  [0.98, 0x4c3a56, 0x6c5a70, 0.3, 0.42, 0xd0a0a0],
  [1.00, 0xf0a36a, 0xf6c79c, 1.3, 0.55, 0xffc890],
];

export function groundHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = (fbm(x * 0.045, z * 0.045) - 0.5) * 2 * 2.0;
  h *= smoothstep(8, 26, d);
  h += smoothstep(54, 72, d) * 9;
  h += gauss(dist2(x, z, 0, -70), 18) * 5;
  h += gauss(dist2(x, z, -30, -22), 10) * 1.8;
  const pd = dist2(x, z, POND.x, POND.z);
  if (pd < POND.r) {
    const k = 1 - smoothstep(3.5, POND.r, pd);
    h = lerp(h, -1.3, k);
  }
  return h;
}

export class World {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.t = 0.06; // 清晨开始
    this.nightFactor = 0;
    this.rainT = 0;
    this.rainFactor = 0;
    this.lightningTimer = 0;
    this.colliders = [];
    this.trees = [];

    this._buildLights();
    this._buildTerrain();
    this._buildWater();
    this._buildSky();
    this._buildVegetation();
    this._buildLandmarks();
  }

  groundHeight(x, z) { return groundHeight(x, z); }

  waterDepth(x, z) {
    if (dist2(x, z, POND.x, POND.z) > POND.r - 0.8) return 0;
    const h = groundHeight(x, z);
    return Math.max(0, WATER_Y - h);
  }

  // ---------- 灯光 ----------
  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38;
    sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8aa0d8, 0);
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a4a, 0.95);
    this.scene.add(this.hemi);
  }

  // ---------- 地形 ----------
  _buildTerrain() {
    const SIZE = 176, SEG = 130;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x55a04a);
    const cGrassLight = new THREE.Color(0x74be57);
    const cDirt = new THREE.Color(0xa8845c);
    const cSand = new THREE.Color(0xc4ad7c);
    const cMud = new THREE.Color(0x70624a);
    const cRock = new THREE.Color(0x8d8d85);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = groundHeight(x, z);
      pos.setY(i, h);

      // 基础草色随噪声斑驳
      const n = fbm(x * 0.12 + 9, z * 0.12 + 3);
      tmp.copy(cGrass).lerp(cGrassLight, n);

      // 北侧土路 + 出生点空地
      const onPath = Math.abs(x) < 2.6 && z < 2 && z > -58;
      const spawnPatch = Math.hypot(x, z) < 4.5;
      if (onPath || spawnPatch) tmp.lerp(cDirt, 0.82);

      // 水塘:水下泥 + 岸边沙
      const pd = dist2(x, z, POND.x, POND.z);
      if (pd < POND.r - 1.2) tmp.lerp(cMud, 0.9);
      else if (pd < POND.r + 1.8) tmp.lerp(cSand, 0.7);

      // 陡坡与外缘露岩
      const slope = Math.abs(groundHeight(x + 0.9, z) - h) + Math.abs(groundHeight(x, z + 0.9) - h);
      if (slope > 1.0 || h > 6.5) tmp.lerp(cRock, Math.min(1, (slope - 0.7) * 0.9));

      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = toonMat(0xffffff, { vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  _buildWater() {
    const geo = new THREE.CircleGeometry(POND.r - 0.6, 36);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      color: 0x3f7fd0, gradientMap: getGradientMap(),
      transparent: true, opacity: 0.78,
    }));
    this.water.position.set(POND.x, WATER_Y, POND.z);
    this.scene.add(this.water);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(POND.r - 0.8, POND.r - 0.3, 40),
      new THREE.MeshBasicMaterial({ color: 0xbfe4f8, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(POND.x, WATER_Y + 0.03, POND.z);
    this.scene.add(rim);
  }

  // ---------- 天空 ----------
  _buildSky() {
    this.scene.background = new THREE.Color(0x6fb6ee);
    this.scene.fog = new THREE.Fog(0xc9e4f6, 48, 150);

    const sunGeo = new THREE.CircleGeometry(7, 24);
    this.sunDisc = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xfff4c0, fog: false }));
    this.scene.add(this.sunDisc);

    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(5, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false }));
    this.scene.add(this.moonDisc);

    // 星空
    const starCount = 500;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.46 + 0.06;
      const r = 210;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * r;
      sp[i * 3 + 1] = Math.sin(e) * r;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sgeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false,
    }));
    this.scene.add(this.stars);
  }

  // ---------- 植被与障碍 ----------
  _buildVegetation() {
    const treeTrunkMat = toonMat(0x6a4a2c);
    const leafMatA = toonMat(0x3f8f3a);
    const leafMatB = toonMat(0x2f7a30);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 7);
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);

    const placed = [];
    const tryPlace = (x, z) => {
      const d = Math.hypot(x, z);
      if (d < 8 || d > 64) return false;
      if (Math.abs(x) < 4 && z < 2 && z > -58) return false;            // 路上不种树
      if (dist2(x, z, POND.x, POND.z) < POND.r + 3) return false;        // 水塘附近不种
      if (dist2(x, z, -30, -22) < 5) return false;                       // 宝箱丘顶留空
      for (const p of placed) if (dist2(x, z, p[0], p[1]) < 5) return false;
      return true;
    };

    let made = 0, guard = 0;
    while (made < 44 && guard++ < 800) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 54;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!tryPlace(x, z)) continue;
      placed.push([x, z]);
      made++;

      const h = groundHeight(x, z);
      const g = new THREE.Group();
      const scale = 0.85 + Math.random() * 0.7;
      const trunkH = 1.7 * scale;
      const trunk = new THREE.Mesh(trunkGeo, treeTrunkMat);
      trunk.scale.set(scale, trunkH, scale);
      trunk.position.y = trunkH / 2;
      trunk.castShadow = true;
      g.add(trunk);

      const leaf1 = new THREE.Mesh(leafGeo, Math.random() < 0.5 ? leafMatA : leafMatB);
      leaf1.scale.setScalar(1.35 * scale);
      leaf1.position.y = trunkH + 0.75 * scale;
      leaf1.castShadow = true;
      g.add(leaf1);
      const leaf2 = new THREE.Mesh(leafGeo, leafMatB);
      leaf2.scale.setScalar(0.95 * scale);
      leaf2.position.y = trunkH + 1.55 * scale;
      leaf2.castShadow = true;
      g.add(leaf2);

      g.position.set(x, h - 0.05, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(g);
      this.trees.push({ x, z, r: 0.5, group: g, shakeT: 0, cooldown: 0 });
      this.colliders.push({ x, z, r: 0.5 });
    }

    // 岩石
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = toonMat(0x8d8d85);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 46;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!tryPlace(x, z)) continue;
      placed.push([x, z]);
      const s = 0.5 + Math.random() * 0.9;
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.scale.set(s, s * 0.75, s);
      rock.position.set(x, groundHeight(x, z) + s * 0.18, z);
      rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.4);
      rock.castShadow = true;
      this.scene.add(rock);
      this.colliders.push({ x, z, r: s * 0.85 });
    }

    // 北路两侧的栅栏
    const postGeo = new THREE.BoxGeometry(0.18, 1.0, 0.18);
    const railGeo = new THREE.BoxGeometry(0.08, 0.09, 2.1);
    const woodMat = toonMat(0x8a6840);
    for (const side of [-4.2, 4.2]) {
      for (let z = -6; z >= -22; z -= 2) {
        const x = side;
        const h = groundHeight(x, z);
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(x, h + 0.5, z);
        post.castShadow = true;
        this.scene.add(post);
        if (z > -22) {
          for (const ry of [0.38, 0.78]) {
            const rail = new THREE.Mesh(railGeo, woodMat);
            const h2 = groundHeight(x, z - 1);
            rail.position.set(x, (h + h2) / 2 + ry, z - 1);
            this.scene.add(rail);
          }
        }
        this.colliders.push({ x, z, r: 0.25 });
      }
    }
  }

  // ---------- 远景地标 ----------
  _buildLandmarks() {
    // 海拉鲁城堡(北方高台,仅观赏)
    const castle = new THREE.Group();
    const wallMat = toonMat(0xd8d2c2);
    const roofMat = toonMat(0x3a5a9e);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(7, 9, 6), wallMat);
    keep.position.y = 4.5;
    castle.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(5, 4.5, 4), roofMat);
    keepRoof.position.y = 11.2;
    keepRoof.rotation.y = Math.PI / 4;
    castle.add(keepRoof);
    for (const [tx, tz] of [[-5, -3.5], [5, -3.5], [-5, 3.5], [5, 3.5]]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 11, 10), wallMat);
      tower.position.set(tx, 5.5, tz);
      castle.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.4, 10), roofMat);
      roof.position.set(tx, 12.7, tz);
      castle.add(roof);
    }
    for (const [tx, tz] of [[-5, 0], [5, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 7), wallMat);
      wall.position.set(tx, 3, tz);
      castle.add(wall);
    }
    // 旗帜
    for (const tx of [-5, 5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 5), toonMat(0xcccccc));
      pole.position.set(tx, 14.6, -3.5);
      castle.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshBasicMaterial({ color: 0xc03030, side: THREE.DoubleSide }));
      flag.position.set(tx + 0.75, 15.6, -3.5);
      castle.add(flag);
    }
    const ch = groundHeight(0, -70);
    castle.position.set(0, ch - 0.4, -70);
    castle.scale.setScalar(1.15);
    this.scene.add(castle);

    // 死亡之山(东北远景火山 + 烟圈)
    const mtn = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(24, 34, 9), toonMat(0x7a5a48));
    cone.position.y = 14;
    mtn.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(7, 7, 9), toonMat(0x9a7a5e));
    cap.position.y = 30;
    mtn.add(cap);
    this.smokeRing = new THREE.Mesh(
      new THREE.TorusGeometry(10, 2.6, 10, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8e0d4, transparent: true, opacity: 0.55, fog: false })
    );
    this.smokeRing.rotation.x = Math.PI / 2;
    this.smokeRing.position.y = 36;
    mtn.add(this.smokeRing);
    mtn.position.set(66, -2, -62);
    this.scene.add(mtn);

    // 出生点告示牌
    const sign = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), toonMat(0x7a5a36));
    sp.position.y = 0.5;
    sign.add(sp);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.62, 0.09), toonMat(0x9a7848));
    board.position.y = 1.05;
    board.castShadow = true;
    sign.add(board);
    const sh = groundHeight(2.6, 3.4);
    sign.position.set(2.6, sh, 3.4);
    sign.rotation.y = -0.5;
    this.scene.add(sign);
    this.signPos = new THREE.Vector3(2.6, sh, 3.4);
    this.colliders.push({ x: 2.6, z: 3.4, r: 0.3 });
  }

  // ---------- 树木摇晃(翻滚撞树) ----------
  shakeTreeNear(x, z) {
    for (const t of this.trees) {
      if (t.cooldown <= 0 && dist2(x, z, t.x, t.z) < t.r + 0.9) {
        t.shakeT = 0.7;
        t.cooldown = 9;
        return t;
      }
    }
    return null;
  }

  // ---------- 昼夜 ----------
  _skyAt(t) {
    let i = 0;
    while (i < SKY_STOPS.length - 1 && SKY_STOPS[i + 1][0] < t) i++;
    const a = SKY_STOPS[i], b = SKY_STOPS[Math.min(i + 1, SKY_STOPS.length - 1)];
    const span = Math.max(1e-5, b[0] - a[0]);
    const k = Math.min(1, Math.max(0, (t - a[0]) / span));
    return {
      sky: new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), k),
      fog: new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), k),
      sunI: lerp(a[3], b[3], k),
      hemiI: lerp(a[4], b[4], k),
      sunC: new THREE.Color(a[5]).lerp(new THREE.Color(b[5]), k),
    };
  }

  toggleDayNight() {
    this.t = this.nightFactor > 0.5 ? 0.005 : 0.58;
  }

  startRain(duration = 26) {
    this.rainT = duration;
    this.ctx.audio.setRain(true);
    this.ctx.effects.setRain(true);
    this.lightningTimer = 1.2;
  }

  get isNight() { return this.nightFactor > 0.5; }

  update(dt, playerPos) {
    this.t = (this.t + dt / CYCLE) % 1;

    // 夜晚系数
    const up = smoothstep(0.52, 0.62, this.t);
    const down = 1 - smoothstep(0.95, 1.0, this.t);
    this.nightFactor = Math.min(up, down);

    // 雨
    if (this.rainT > 0) {
      this.rainT -= dt;
      this.rainFactor = Math.min(1, this.rainFactor + dt * 1.5);
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 2.5 + Math.random() * 4.5;
        this.ctx.ui.flashWhite(0.35);
        this.ctx.audio.thunder(0.18 + Math.random() * 0.3);
      }
      if (this.rainT <= 0) {
        this.ctx.audio.setRain(false);
        this.ctx.effects.setRain(false);
      }
    } else {
      this.rainFactor = Math.max(0, this.rainFactor - dt * 0.7);
    }

    const s = this._skyAt(this.t);
    const grey = new THREE.Color(0x3e4a58);
    const greyFog = new THREE.Color(0x55606c);
    if (this.rainFactor > 0) {
      s.sky.lerp(grey, this.rainFactor * 0.8);
      s.fog.lerp(greyFog, this.rainFactor * 0.8);
      s.sunI *= 1 - this.rainFactor * 0.65;
      s.hemiI *= 1 - this.rainFactor * 0.3;
    }

    this.scene.background.copy(s.sky);
    this.scene.fog.color.copy(s.fog);
    this.sun.intensity = s.sunI;
    this.sun.color.copy(s.sunC);
    this.hemi.intensity = s.hemiI;
    this.moon.intensity = this.nightFactor * 0.85;

    // 太阳/月亮方位
    const dayK = Math.min(1, this.t / 0.58);
    const sunA = Math.PI * (1 - dayK);
    const sunDir = new THREE.Vector3(Math.cos(sunA) * 0.85, Math.sin(sunA), -0.45).normalize();
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    this.sun.position.set(px + sunDir.x * 50, Math.max(2, sunDir.y * 55), pz + sunDir.z * 50);
    this.sun.target.position.set(px, 0, pz);
    this.sunDisc.position.set(sunDir.x * 190, sunDir.y * 190, sunDir.z * 190);
    this.sunDisc.lookAt(0, 0, 0);
    this.sunDisc.visible = sunDir.y > -0.05 && this.rainFactor < 0.6;

    const nightK = Math.min(1, Math.max(0, (this.t - 0.58) / 0.4));
    const moonA = Math.PI * (1 - nightK);
    const moonDir = new THREE.Vector3(Math.cos(moonA) * 0.8, Math.sin(moonA), 0.5).normalize();
    this.moon.position.set(px + moonDir.x * 50, Math.max(2, moonDir.y * 55), pz + moonDir.z * 50);
    this.moon.target.position.set(px, 0, pz);
    this.moonDisc.position.set(moonDir.x * 195, moonDir.y * 195, moonDir.z * 195);
    this.moonDisc.lookAt(0, 0, 0);
    this.moonDisc.visible = this.nightFactor > 0.05;

    this.stars.material.opacity = this.nightFactor * (1 - this.rainFactor) * 0.95;

    // 水面微动
    this.water.position.y = WATER_Y + Math.sin(performance.now() * 0.0011) * 0.03;

    // 烟圈旋转
    this.smokeRing.rotation.z += dt * 0.12;
    this.smokeRing.position.y = 36 + Math.sin(performance.now() * 0.0004) * 0.8;

    // 树摇晃动画
    for (const t of this.trees) {
      if (t.cooldown > 0) t.cooldown -= dt;
      if (t.shakeT > 0) {
        t.shakeT -= dt;
        const k = Math.max(0, t.shakeT / 0.7);
        t.group.rotation.z = Math.sin(t.shakeT * 30) * 0.06 * k;
        t.group.rotation.x = Math.sin(t.shakeT * 26 + 1) * 0.05 * k;
      }
    }

    this.ctx.audio.setNight(this.nightFactor);
  }
}
