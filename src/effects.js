import * as THREE from 'three';

// 粒子池 + 剑光轨迹 + 雨 + 屏幕震动
const MAX_PARTICLES = 800;

class ParticlePool {
  constructor(scene, { additive = false } = {}) {
    this.capacity = MAX_PARTICLES;
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.vel = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.grav = new Float32Array(this.capacity);
    this.baseSize = new Float32Array(this.capacity);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    });
    // 用 size attribute 控制每粒子大小
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float size;', 'attribute float size;')
    };

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(pos, vel, color, life, size, grav = 9) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions.set([pos.x, pos.y, pos.z], i * 3);
    this.vel.set([vel.x, vel.y, vel.z], i * 3);
    this.colors.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.baseSize[i] = size;
    this.sizes[i] = size;
  }

  update(dt) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.sizes[i] = 0; continue; }
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.positions[i3] += this.vel[i3] * dt;
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.sizes[i] = this.baseSize[i] * (0.4 + 0.6 * k);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.normal = new ParticlePool(scene);
    this.glow = new ParticlePool(scene, { additive: true });
    this.shakeAmp = 0;
    this._tmp = new THREE.Vector3();

    // ---- 剑光轨迹 ----
    this.trailSegs = 14;
    const tGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailSegs * 2 * 3);
    this.trailAlpha = new Float32Array(this.trailSegs * 2);
    tGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tGeo.setAttribute('alpha', new THREE.BufferAttribute(this.trailAlpha, 1));
    const idx = [];
    for (let i = 0; i < this.trailSegs - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    tGeo.setIndex(idx);
    const tMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        attribute float alpha;
        varying float vA;
        void main() {
          vA = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          gl_FragColor = vec4(0.75, 0.9, 1.0, vA * 0.75);
        }`,
    });
    this.trail = new THREE.Mesh(tGeo, tMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
    this.trailHistory = [];

    // ---- 雨 ----
    this.rainOn = false;
    this.rainCount = 620;
    const rGeo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(this.rainCount * 6);
    rGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainDrops = [];
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * 50,
        y: Math.random() * 22,
        z: (Math.random() - 0.5) * 50,
        s: 14 + Math.random() * 8,
      });
    }
    const rMat = new THREE.LineBasicMaterial({ color: 0xaac4e4, transparent: true, opacity: 0.55 });
    this.rain = new THREE.LineSegments(rGeo, rMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  // ---------- 粒子便捷函数 ----------
  burst(pos, { count = 10, color = 0xffffff, speed = 3, up = 2.5, life = 0.6, size = 0.14, grav = 9, glow = false, spread = 1 } = {}) {
    const pool = glow ? this.glow : this.normal;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed * spread;
      const v = new THREE.Vector3(Math.cos(a) * r, up * (0.4 + Math.random() * 0.9), Math.sin(a) * r);
      const cc = c.clone().multiplyScalar(0.8 + Math.random() * 0.35);
      pool.spawn(pos, v, cc, life * (0.6 + Math.random() * 0.7), size * (0.7 + Math.random() * 0.7), grav);
    }
  }

  dirtBurst(pos, count = 14) { this.burst(pos, { count, color: 0x8a6a42, speed: 2.4, up: 3.2, life: 0.7, size: 0.17 }); }
  bonePoof(pos) {
    this.burst(pos, { count: 18, color: 0xe8e2cc, speed: 3, up: 3.4, life: 0.8, size: 0.16 });
    this.burst(pos, { count: 10, color: 0x9a9484, speed: 2, up: 2, life: 0.6, size: 0.12 });
  }
  grassClip(pos) { this.burst(pos, { count: 12, color: 0x4fa838, speed: 2.2, up: 3.4, life: 0.75, size: 0.13, grav: 7 }); }
  sparkle(pos, color = 0xfff2a8, count = 14) {
    this.burst(pos, { count, color, speed: 1.6, up: 1.8, life: 0.8, size: 0.12, grav: 1.5, glow: true });
  }
  splash(pos) {
    this.burst(pos, { count: 10, color: 0x7fb8e8, speed: 1.6, up: 2.4, life: 0.5, size: 0.12, grav: 10, glow: true });
  }
  hitSpark(pos) {
    this.burst(pos, { count: 8, color: 0xffe9b0, speed: 2.6, up: 1.4, life: 0.3, size: 0.15, grav: 4, glow: true });
  }
  deflectSpark(pos) {
    this.burst(pos, { count: 16, color: 0xaad4ff, speed: 3.4, up: 2, life: 0.4, size: 0.16, grav: 3, glow: true });
  }

  // ---------- 剑光 ----------
  trailPush(base, tip) {
    this.trailHistory.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    if (this.trailHistory.length > this.trailSegs) this.trailHistory.pop();
    this.trail.visible = true;
  }
  trailClear() {
    this.trailHistory.length = 0;
    this.trail.visible = false;
  }

  shake(amp) { this.shakeAmp = Math.max(this.shakeAmp, amp); }

  setRain(on) {
    this.rainOn = on;
    this.rain.visible = on;
  }

  update(dt, playerPos) {
    this.normal.update(dt);
    this.glow.update(dt);

    // 剑光老化
    if (this.trailHistory.length) {
      let anyAlive = false;
      for (let i = 0; i < this.trailSegs; i++) {
        const h = this.trailHistory[i];
        const i6 = i * 6;
        if (h) {
          h.age += dt;
          const a = Math.max(0, 1 - h.age / 0.16);
          if (a > 0) anyAlive = true;
          this.trailPos.set([h.b.x, h.b.y, h.b.z, h.t.x, h.t.y, h.t.z], i6);
          this.trailAlpha[i * 2] = a * 0.4;
          this.trailAlpha[i * 2 + 1] = a;
        } else {
          this.trailAlpha[i * 2] = 0;
          this.trailAlpha[i * 2 + 1] = 0;
        }
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.alpha.needsUpdate = true;
      if (!anyAlive) this.trailClear();
    }

    // 雨(跟随玩家的下落线段)
    if (this.rainOn && playerPos) {
      for (let i = 0; i < this.rainCount; i++) {
        const d = this.rainDrops[i];
        d.y -= d.s * dt;
        if (d.y < 0) {
          d.y = 18 + Math.random() * 6;
          d.x = (Math.random() - 0.5) * 50;
          d.z = (Math.random() - 0.5) * 50;
        }
        const x = playerPos.x + d.x, y = d.y, z = playerPos.z + d.z;
        this.rainPos.set([x, y, z, x - 0.08, y - 0.65, z - 0.04], i * 6);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // 屏幕震动衰减
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 2.6);
  }

  applyShake(camera) {
    if (this.shakeAmp <= 0) return;
    const a = this.shakeAmp * 0.12;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
  }
}
