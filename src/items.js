import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMat, POND } from './world.js';

const RUPEE_COLORS = { 1: 0x35c04a, 5: 0x3a6ae0, 20: 0xd03838 };

// 心形贴图(掉落用)
let _heartTex = null;
function heartTexture() {
  if (_heartTex) return _heartTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 34);
  g.fillStyle = '#e83048';
  g.beginPath();
  g.moveTo(0, 18);
  g.bezierCurveTo(-26, -2, -16, -24, 0, -10);
  g.bezierCurveTo(16, -24, 26, -2, 0, 18);
  g.fill();
  g.strokeStyle = '#7a1020';
  g.lineWidth = 3;
  g.stroke();
  _heartTex = new THREE.CanvasTexture(c);
  _heartTex.colorSpace = THREE.SRGBColorSpace;
  return _heartTex;
}

// ============ 掉落物 ============
class Drop {
  constructor(scene, ctx, pos, kind, value = 1) {
    this.scene = scene;
    this.ctx = ctx;
    this.kind = kind; // 'rupee' | 'heart'
    this.value = value;
    this.life = 16;
    this.bounced = false;

    if (kind === 'rupee') {
      const geo = new THREE.OctahedronGeometry(0.2, 0);
      geo.scale(0.75, 1.25, 0.45);
      this.mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
        color: RUPEE_COLORS[value], emissive: new THREE.Color(RUPEE_COLORS[value]).multiplyScalar(0.25),
      }));
      this.mesh.castShadow = true;
    } else {
      this.mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture(), transparent: true }));
      this.mesh.scale.setScalar(0.46);
    }
    this.mesh.position.copy(pos);
    this.mesh.position.y += 0.3;
    const a = Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3(Math.cos(a) * 1.4, 4.0 + Math.random(), Math.sin(a) * 1.4);
    scene.add(this.mesh);
  }

  update(dt, player) {
    this.life -= dt;
    const p = this.mesh.position;
    const gh = this.ctx.world.groundHeight(p.x, p.z) + 0.32;

    // 磁吸
    const toP = player.pos.clone().add(new THREE.Vector3(0, 0.7, 0)).sub(p);
    const d = toP.length();
    if (d < 1.7 && player.alive) {
      this.vel.addScaledVector(toP.normalize(), dt * 60);
      this.vel.multiplyScalar(0.9);
    } else {
      this.vel.y -= 11 * dt;
      this.vel.x *= 0.985;
      this.vel.z *= 0.985;
    }
    p.addScaledVector(this.vel, dt);

    if (p.y < gh) {
      p.y = gh;
      if (!this.bounced && this.vel.y < -2) {
        this.vel.y *= -0.42;
        this.bounced = true;
      } else {
        this.vel.set(0, 0, 0);
      }
    }

    if (this.kind === 'rupee') {
      this.mesh.rotation.y += dt * 3.2;
    }
    if (this.vel.lengthSq() < 0.01) {
      p.y = gh + Math.sin(performance.now() * 0.003 + p.x * 7) * 0.05;
    }

    // 即将消失时闪烁
    this.mesh.visible = this.life > 3 || Math.floor(this.life * 9) % 2 === 0;

    // 拾取
    if (d < 0.6 && player.alive) {
      if (this.kind === 'rupee') {
        this.ctx.addRupees(this.value);
        this.ctx.audio.rupee();
        this.ctx.effects.sparkle(p.clone(), RUPEE_COLORS[this.value], 8);
      } else {
        player.heal(2);
        this.ctx.audio.heart();
        this.ctx.effects.sparkle(p.clone(), 0xff7088, 10);
      }
      this.life = 0;
    }

    if (this.life <= 0) this.scene.remove(this.mesh);
    return this.life > 0;
  }
}

const DROP_TABLES = {
  grass:     [[0.45, null], [0.80, ['rupee', 1]], [0.92, ['heart']], [1.0, ['rupee', 5]]],
  stalchild: [[0.30, null], [0.65, ['rupee', 1]], [0.85, ['heart']], [1.0, ['rupee', 5]]],
  octorok:   [[0.25, ['rupee', 1]], [0.60, ['rupee', 5]], [0.78, ['heart']], [1.0, ['rupee', 20]]],
  tree:      [[0.50, null], [0.85, ['rupee', 1]], [1.0, ['rupee', 5]]],
};

// ============ 物品管理器(草丛/掉落/宝箱/告示牌/妖精) ============
export class Items {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.drops = [];
    this.interactableNear = null;
    this._buildGrass();
    this._buildChest();
    this._buildNavi();
  }

  // ---------- 草丛(InstancedMesh,三叶尖草 × 两个朝向) ----------
  _buildGrass() {
    const makeBlades = () => {
      const tris = [];
      const blade = (cx, h, w, lean) => {
        tris.push(cx - w, 0, 0, cx + w, 0, 0, cx + lean, h, 0);
      };
      blade(-0.21, 0.44, 0.075, -0.3);
      blade(0, 0.66, 0.085, 0.02);
      blade(0.2, 0.5, 0.075, 0.3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
      g.computeVertexNormals();
      return g;
    };
    const p1 = makeBlades();
    const p2 = makeBlades();
    p2.rotateY(Math.PI / 2);
    const geo = mergeGeometries([p1, p2]);
    const mat = toonMat(0x4f9c3c, { side: THREE.DoubleSide });

    this.grassCount = 120;
    this.grassMesh = new THREE.InstancedMesh(geo, mat, this.grassCount);
    this.grassMesh.castShadow = true;
    this.grass = [];
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    let placed = 0, guard = 0;
    while (placed < this.grassCount && guard++ < 4000) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 42;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 4 && z < 2 && z > -58) continue;
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) continue;
      const h = this.ctx.world.groundHeight(x, z);
      const slope = Math.abs(this.ctx.world.groundHeight(x + 1, z) - h) + Math.abs(this.ctx.world.groundHeight(x, z + 1) - h);
      if (slope > 0.9) continue;

      const s = 0.8 + Math.random() * 0.55;
      dummy.position.set(x, h, z);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.grassMesh.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.3 + Math.random() * 0.04, 0.55, 0.32 + Math.random() * 0.12);
      this.grassMesh.setColorAt(placed, col);
      this.grass.push({ x, z, h, s, rot: dummy.rotation.y, cut: false, regrow: 0, idx: placed });
      placed++;
    }
    this.grassMesh.count = placed;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.grassMesh);
    this._dummy = dummy;
  }

  _setGrassScale(g, k) {
    this._dummy.position.set(g.x, g.h, g.z);
    this._dummy.rotation.set(0, g.rot, 0);
    this._dummy.scale.setScalar(Math.max(0.001, g.s * k));
    this._dummy.updateMatrix();
    this.grassMesh.setMatrixAt(g.idx, this._dummy.matrix);
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  cutGrassAt(pos, radius) {
    let cutAny = false;
    for (const g of this.grass) {
      if (g.cut) continue;
      if (Math.hypot(pos.x - g.x, pos.z - g.z) > radius) continue;
      g.cut = true;
      g.regrow = 40;
      this._setGrassScale(g, 0.001);
      const p = new THREE.Vector3(g.x, g.h + 0.4, g.z);
      this.ctx.effects.grassClip(p);
      this.dropAt(p, 'grass');
      cutAny = true;
    }
    if (cutAny) {
      this.ctx.audio.noise({ dur: 0.12, filter: 'bandpass', freq: 2000, gain: 0.14 });
    }
    return cutAny;
  }

  dropAt(pos, tableName) {
    const table = DROP_TABLES[tableName];
    const r = Math.random();
    for (const [p, item] of table) {
      if (r <= p) {
        if (item) {
          this.drops.push(new Drop(this.scene, this.ctx, pos, item[0], item[1] || 1));
        }
        return;
      }
    }
  }

  treeDrop(tree) {
    this.dropAt(new THREE.Vector3(tree.x, this.ctx.world.groundHeight(tree.x, tree.z) + 1.5, tree.z), 'tree');
  }

  // ---------- 宝箱 ----------
  _buildChest() {
    const x = -30, z = -22;
    const h = this.ctx.world.groundHeight(x, z);
    const g = new THREE.Group();
    const wood = toonMat(0x8a5a30);
    const gold = toonMat(0xd8a838, { emissive: 0x402800 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.66), wood);
    base.position.y = 0.275;
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.1, 0.7), gold);
    band1.position.y = 0.12;
    g.add(base, band1);

    this.chestLid = new THREE.Group();
    this.chestLid.position.set(0, 0.55, -0.33);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 0.66), wood);
    lid.position.set(0, 0.13, 0.33);
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.28, 0.14), gold);
    lidBand.position.set(0, 0.13, 0.33);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.08), gold);
    lock.position.set(0, 0.05, 0.68);
    this.chestLid.add(lid, lidBand, lock);
    g.add(this.chestLid);

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(x, h, z);
    g.rotation.y = 0.8;
    this.scene.add(g);
    this.chest = { group: g, x, z, opened: false, opening: 0 };
    this.ctx.world.colliders.push({ x, z, r: 0.7 });

    // 开箱光柱
    this.chestBeam = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 3.2, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.chestBeam.position.set(x, h + 1.9, z);
    this.scene.add(this.chestBeam);
  }

  _makeHeartContainer() {
    const g = new THREE.Group();
    const mat = toonMat(0xe03048, { emissive: 0x500818 });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat);
    l.position.set(-0.1, 0.08, 0);
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat);
    r.position.set(0.1, 0.08, 0);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 4), mat);
    b.rotation.set(Math.PI, Math.PI / 4, 0);
    b.scale.set(1.15, 1, 0.8);
    b.position.y = -0.1;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 18), toonMat(0xd8a838, { emissive: 0x403000 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.22;
    g.add(l, r, b, ring);
    return g;
  }

  _openChest() {
    const c = this.chest;
    c.opened = true;
    c.opening = 0.0001;
    this.ctx.audio.duckMusic(4.5);
    this.ctx.audio.chestOpen();
    this.ctx.flags.chestOpened = true;

    setTimeout(() => {
      this.ctx.audio.fanfare();
      const item = this._makeHeartContainer();
      item.position.set(c.x, this.ctx.world.groundHeight(c.x, c.z) + 1, c.z);
      this.scene.add(item);
      this.ctx.effects.sparkle(item.position, 0xffe8a0, 22);
      this.ctx.player.startItemGet(item, 2.8, () => {
        this.ctx.state.maxHalves += 2;
        this.ctx.state.halves = this.ctx.state.maxHalves;
        this.ctx.ui.updateHearts();
        this.ctx.effects.sparkle(item.position, 0xff8098, 18);
        this.scene.remove(item);
      });
      this.ctx.ui.itemGetBanner('获得了 心之容器 !');
      this.ctx.ui.say('', '生命上限提升了!勇气会指引你走得更远。', 4);
    }, 620);
  }

  // ---------- 妖精纳薇 ----------
  _buildNavi() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xd8ecff })
    );
    // 光晕
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const gg = c.getContext('2d');
    const grad = gg.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(190,225,255,0.9)');
    grad.addColorStop(0.5, 'rgba(140,190,255,0.32)');
    grad.addColorStop(1, 'rgba(120,170,255,0)');
    gg.fillStyle = grad;
    gg.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.naviGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.naviGlow.scale.setScalar(0.62);
    // 翅膀
    const wingGeo = new THREE.PlaneGeometry(0.13, 0.22);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    this.naviWings = [];
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(sx * 0.1, 0.06, -0.02);
      g.add(w);
      this.naviWings.push({ mesh: w, sx });
    }
    this.naviLight = new THREE.PointLight(0x9fc8ff, 2.2, 7, 2);
    g.add(core, this.naviGlow, this.naviLight);
    g.position.set(0.8, 1.8, 0.5);
    this.scene.add(g);
    this.navi = g;
    this.naviHintT = 0;
    this.naviTarget = null;
  }

  naviSay(text, targetPos = null, dur = 4.5) {
    this.ctx.audio.naviHey();
    this.ctx.ui.say('纳薇', text, dur);
    if (targetPos) {
      this.naviTarget = targetPos.clone();
      this.naviHintT = 2.6;
    } else {
      this.naviHintT = 0.8;
      this.naviTarget = null;
    }
  }

  // ---------- 交互检测 ----------
  getInteractable(player) {
    if (!player.alive || player.state !== 'normal') return null;
    const c = this.chest;
    if (!c.opened && Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < 2.2) {
      return { label: '打开宝箱', cb: () => this._openChest() };
    }
    const sp = this.ctx.world.signPos;
    if (sp && player.pos.distanceTo(sp) < 2.0) {
      return {
        label: '阅读告示牌',
        cb: () => this.ctx.ui.say('告示牌',
          '【海拉鲁平原】北:海拉鲁城堡(游客止步)。东:湖畔水塘,小心吐石头的章鱼怪。夜晚骷髅出没,新手冒险者请备好剑盾。', 6),
      };
    }
    return null;
  }

  update(dt, player) {
    // 掉落物
    this.drops = this.drops.filter((d) => d.update(dt, player));

    // 草再生
    for (const g of this.grass) {
      if (!g.cut) continue;
      g.regrow -= dt;
      if (g.regrow <= 0) {
        g.cut = false;
        this._setGrassScale(g, 1);
        this.ctx.effects.sparkle(new THREE.Vector3(g.x, g.h + 0.3, g.z), 0x80e060, 4);
      }
    }

    // 宝箱开盖动画 + 光柱
    const c = this.chest;
    if (c.opened && c.opening < 1) {
      c.opening = Math.min(1, c.opening + dt * 1.9);
      this.chestLid.rotation.x = -1.92 * c.opening * c.opening;
      this.chestBeam.material.opacity = 0.5 * Math.sin(Math.min(1, c.opening * 1.2) * Math.PI);
    } else if (c.opened) {
      this.chestBeam.material.opacity = Math.max(0, this.chestBeam.material.opacity - dt * 0.25);
    }

    // 纳薇飞行
    const t = performance.now() * 0.001;
    let want;
    if (this.naviHintT > 0 && this.naviTarget) {
      this.naviHintT -= dt;
      want = this.naviTarget.clone();
      want.y += 1.6 + Math.sin(t * 6) * 0.18;
    } else {
      want = player.pos.clone();
      want.x += Math.cos(t * 0.8) * 1.05;
      want.z += Math.sin(t * 0.8) * 1.05;
      want.y += 2.05 + Math.sin(t * 1.7) * 0.18;
    }
    this.navi.position.lerp(want, 1 - Math.exp(-3.2 * dt));
    for (const w of this.naviWings) {
      w.mesh.rotation.y = w.sx * (0.5 + Math.sin(t * 22) * 0.7);
    }
    this.naviGlow.scale.setScalar(0.6 + Math.sin(t * 5) * 0.08);
    this.naviLight.intensity = 1.9 + Math.sin(t * 5) * 0.5;

    // 交互提示
    this.interactableNear = this.getInteractable(player);
  }
}
