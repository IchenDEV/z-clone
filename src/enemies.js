import * as THREE from 'three';
import { toonMat, POND, WATER_Y, PLAY_RADIUS } from './world.js';

const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ============ 骷髅小兵(夜晚出没) ============
class Stalchild {
  constructor(scene, ctx, x, z) {
    this.scene = scene;
    this.ctx = ctx;
    this.alive = true;
    this.hp = 2;
    this.state = 'emerge';
    this.t = 0;
    this.height = 1.45;
    this.flashT = 0;
    this.attackCd = 0.9;

    this.boneMat = toonMat(0xded6b8);
    this.darkMat = toonMat(0x8a8268);

    const g = new THREE.Group();
    this.rig = new THREE.Group();
    g.add(this.rig);

    // 大脑袋
    this.headG = new THREE.Group();
    this.headG.position.y = 1.12;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), this.boneMat);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.3), this.darkMat);
    jaw.position.set(0, -0.24, 0.04);
    const eyeGeo = new THREE.PlaneGeometry(0.11, 0.13);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x301808 });
    const eL = new THREE.Mesh(eyeGeo, eyeMat); eL.position.set(0.1, 0.03, 0.205);
    const eR = new THREE.Mesh(eyeGeo, eyeMat); eR.position.set(-0.1, 0.03, 0.205);
    const glowGeo = new THREE.PlaneGeometry(0.05, 0.05);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb030 });
    const gL = new THREE.Mesh(glowGeo, glowMat); gL.position.set(0.1, 0.03, 0.21);
    const gR = new THREE.Mesh(glowGeo, glowMat); gR.position.set(-0.1, 0.03, 0.21);
    this.headG.add(skull, jaw, eL, eR, gL, gR);
    this.rig.add(this.headG);

    // 躯干
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.22), this.boneMat);
    torso.position.y = 0.72;
    const rib1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.26), this.darkMat);
    rib1.position.y = 0.8;
    const rib2 = rib1.clone(); rib2.position.y = 0.68;
    this.rig.add(torso, rib1, rib2);

    // 手臂(带爪)
    const armGeo = new THREE.BoxGeometry(0.09, 0.5, 0.09);
    armGeo.translate(0, -0.25, 0);
    const clawGeo = new THREE.ConeGeometry(0.05, 0.16, 4);
    this.armL = new THREE.Group(); this.armL.position.set(0.24, 0.92, 0);
    this.armR = new THREE.Group(); this.armR.position.set(-0.24, 0.92, 0);
    for (const arm of [this.armL, this.armR]) {
      const a = new THREE.Mesh(armGeo, this.boneMat);
      arm.add(a);
      for (let i = 0; i < 3; i++) {
        const claw = new THREE.Mesh(clawGeo, this.darkMat);
        claw.position.set((i - 1) * 0.05, -0.56, 0.02);
        claw.rotation.x = Math.PI;
        arm.add(claw);
      }
      this.rig.add(arm);
    }

    // 腿
    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    legGeo.translate(0, -0.25, 0);
    this.legL = new THREE.Group(); this.legL.position.set(0.11, 0.5, 0);
    this.legR = new THREE.Group(); this.legR.position.set(-0.11, 0.5, 0);
    this.legL.add(new THREE.Mesh(legGeo, this.boneMat));
    this.legR.add(new THREE.Mesh(legGeo, this.boneMat));
    this.rig.add(this.legL, this.legR);

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    g.position.set(x, ctx.world.groundHeight(x, z), z);
    this.group = g;
    this.rig.position.y = -1.5; // 从地下钻出
    scene.add(g);

    ctx.effects.dirtBurst(g.position.clone(), 16);
    ctx.audio.emerge();
  }

  get pos() { return this.group.position; }

  hurt(dmg, fromDir) {
    if (!this.alive || this.state === 'emerge' || this.state === 'dying') return false;
    this.hp -= dmg;
    this.flashT = 0.12;
    this.boneMat.emissive = new THREE.Color(0xffffff);
    this.darkMat.emissive = new THREE.Color(0xffffff);
    this.group.position.addScaledVector(fromDir, 0.9);
    if (this.hp <= 0) {
      this.state = 'dying';
      this.t = 0;
      this.ctx.audio.enemyDie();
    } else {
      this.state = 'stagger';
      this.t = 0;
      this.ctx.audio.enemyHit();
    }
    return true;
  }

  forceSink() {
    if (this.state !== 'dying' && this.state !== 'sinking') {
      this.state = 'sinking';
      this.t = 0;
    }
  }

  _remove() {
    this.alive = false;
    this.scene.remove(this.group);
  }

  update(dt, player) {
    if (!this.alive) return;
    this.t += dt;
    const tNow = performance.now() * 0.001;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.boneMat.emissive = new THREE.Color(0x000000);
        this.darkMat.emissive = new THREE.Color(0x000000);
      }
    }

    const toPlayer = player.pos.clone().sub(this.pos).setY(0);
    const dist = toPlayer.length();

    switch (this.state) {
      case 'emerge': {
        const k = Math.min(1, this.t / 0.9);
        this.rig.position.y = -1.5 * (1 - k * k);
        this.rig.rotation.y = Math.sin(this.t * 10) * 0.1 * (1 - k);
        if (k >= 1) this.state = 'chase';
        break;
      }
      case 'chase': {
        if (player.alive && dist > 1.25) {
          const dir = toPlayer.normalize();
          const speed = 2.0;
          this.group.position.addScaledVector(dir, speed * dt);
        }
        this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        // 蹒跚动画:双臂前伸晃动
        this.armL.rotation.x = -1.9 + Math.sin(tNow * 7) * 0.25;
        this.armR.rotation.x = -1.9 + Math.cos(tNow * 7) * 0.25;
        this.legL.rotation.x = Math.sin(tNow * 9) * 0.55;
        this.legR.rotation.x = -Math.sin(tNow * 9) * 0.55;
        this.headG.rotation.z = Math.sin(tNow * 5) * 0.12;
        this.rig.position.y = Math.abs(Math.sin(tNow * 9)) * 0.05;
        this.attackCd -= dt;
        // 玩家处于受击无敌时不起手,避免被多只骷髅轮流连击
        if (dist < 1.55 && this.attackCd <= 0 && player.alive && player.invuln <= 0) {
          this.state = 'windup';
          this.t = 0;
        }
        break;
      }
      case 'windup': {
        const k = Math.min(1, this.t / 0.5);
        this.armR.rotation.x = -1.9 + k * 1.2;
        this.armR.rotation.z = -k * 1.4;
        this.rig.rotation.x = -0.12 * k;
        if (this.t >= 0.5) {
          this.state = 'swipe';
          this.t = 0;
          if (dist < 1.7 && player.alive) {
            player.takeDamage(1, this.pos);
          }
        }
        break;
      }
      case 'swipe': {
        const k = Math.min(1, this.t / 0.22);
        this.armR.rotation.x = -0.7 - k * 1.4;
        this.armR.rotation.z = -1.4 + k * 2.0;
        this.rig.rotation.x = -0.12 + k * 0.25;
        if (this.t >= 0.22) {
          this.state = 'chase';
          this.attackCd = 2.2;
          this.rig.rotation.x = 0;
        }
        break;
      }
      case 'stagger': {
        if (this.t >= 0.32) this.state = 'chase';
        break;
      }
      case 'dying': {
        const k = Math.min(1, this.t / 0.45);
        this.rig.scale.y = 1 - k * 0.85;
        this.rig.rotation.z = k * 0.6;
        if (this.t >= 0.45) {
          this.ctx.effects.bonePoof(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
          this.ctx.audio.bonePoof();
          this.ctx.items.dropAt(this.pos.clone(), 'stalchild');
          this._remove();
        }
        break;
      }
      case 'sinking': {
        this.rig.position.y = -1.6 * (this.t / 0.8);
        if (this.t >= 0.8) {
          this.ctx.effects.dirtBurst(this.pos.clone(), 8);
          this._remove();
        }
        break;
      }
    }

    if (this.alive && this.state !== 'sinking') {
      this.group.position.y = this.ctx.world.groundHeight(this.pos.x, this.pos.z);
      const d = Math.hypot(this.pos.x, this.pos.z);
      if (d > PLAY_RADIUS) {
        this.pos.x *= PLAY_RADIUS / d;
        this.pos.z *= PLAY_RADIUS / d;
      }
    }
  }
}

// ============ 章鱼怪(水塘) ============
class Octorok {
  constructor(scene, ctx, x, z) {
    this.scene = scene;
    this.ctx = ctx;
    this.alive = true;
    this.height = 0.8;
    this.spitCd = 2.2 + Math.random() * 2;
    this.flashT = 0;

    this.bodyMat = toonMat(0xc84848);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), this.bodyMat);
    body.scale.y = 0.92;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), toonMat(0xe8d8b0));
    belly.position.set(0, -0.08, 0.18);
    belly.scale.set(0.85, 0.7, 0.7);
    this.snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.3, 8), this.bodyMat);
    this.snout.rotation.x = Math.PI / 2;
    this.snout.position.set(0, 0.05, 0.45);
    const eyeW = new THREE.SphereGeometry(0.1, 8, 6);
    const eL = new THREE.Mesh(eyeW, toonMat(0xf8f8f0)); eL.position.set(0.2, 0.25, 0.26);
    const eR = new THREE.Mesh(eyeW, toonMat(0xf8f8f0)); eR.position.set(-0.2, 0.25, 0.26);
    const pGeo = new THREE.SphereGeometry(0.045, 6, 4);
    const pMat = new THREE.MeshBasicMaterial({ color: 0x101010 });
    const pL = new THREE.Mesh(pGeo, pMat); pL.position.set(0.2, 0.25, 0.35);
    const pR = new THREE.Mesh(pGeo, pMat); pR.position.set(-0.2, 0.25, 0.35);
    // 头顶小凸起
    for (let i = 0; i < 3; i++) {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), this.bodyMat);
      const a = (i - 1) * 0.7;
      bump.position.set(Math.sin(a) * 0.2, 0.42, Math.cos(a) * 0.05 - 0.1);
      g.add(bump);
    }
    g.add(body, belly, this.snout, eL, eR, pL, pR);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    g.position.set(x, WATER_Y - 0.05, z);
    this.group = g;
    scene.add(g);
  }

  get pos() { return this.group.position; }

  hurt(dmg, fromDir) {
    if (!this.alive) return false;
    this._die();
    return true;
  }

  _die() {
    this.alive = false;
    this.ctx.audio.enemyDie();
    this.ctx.effects.splash(this.pos.clone());
    this.ctx.effects.burst(this.pos.clone(), { count: 14, color: 0xc84848, speed: 2.5, up: 3, life: 0.6, size: 0.15 });
    this.ctx.items.dropAt(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 'octorok');
    this.scene.remove(this.group);
  }

  update(dt, player) {
    if (!this.alive) return;
    const tNow = performance.now() * 0.001;
    this.group.position.y = WATER_Y - 0.05 + Math.sin(tNow * 2 + this.pos.x) * 0.06;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.bodyMat.emissive = new THREE.Color(0x000000);
    }

    const toPlayer = player.pos.clone().sub(this.pos).setY(0);
    const dist = toPlayer.length();
    if (dist < 13.5 && player.alive) {
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      let d = angleDiff(this.group.rotation.y, targetYaw);
      this.group.rotation.y += d * Math.min(1, dt * 4);

      this.spitCd -= dt;
      if (this.spitCd <= 0 && Math.abs(d) < 0.25 && dist > 2.2) {
        this.spitCd = 3.2 + Math.random() * 1.6;
        // 吐石头
        const dir = toPlayer.normalize();
        const from = this.pos.clone().addScaledVector(dir, 0.6);
        from.y = WATER_Y + 0.5;
        const vel = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(from).normalize().multiplyScalar(7);
        this.ctx.enemies.spawnRock(from, vel, this);
        this.ctx.audio.spit();
        // 后坐
        this.group.scale.set(1.15, 0.85, 1.15);
        setTimeout(() => this.alive && this.group.scale.set(1, 1, 1), 120);
      }
    }
  }
}

// ============ 管理器 ============
export class Enemies {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.list = [];
    this.rocks = [];
    this.spawnTimer = 0;
    this.octorokSpots = [
      { x: POND.x - 3.5, z: POND.z - 2, respawn: 0, e: null },
      { x: POND.x + 3, z: POND.z + 2.5, respawn: 0, e: null },
      { x: POND.x + 0.5, z: POND.z - 4, respawn: 0, e: null },
    ];
    this.rockGeo = new THREE.SphereGeometry(0.17, 8, 6);
    this.rockMat = toonMat(0x8a8278);
    this.killCount = 0;
  }

  spawnRock(pos, vel, owner) {
    const mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.rocks.push({ mesh, vel: vel.clone(), life: 3.2, owner, deflected: false });
  }

  // 玩家挥剑命中判定
  applyPlayerAttack({ pos, yaw, range, arcDeg, dmg }) {
    let hits = 0;
    const arc = (arcDeg * Math.PI) / 180 / 2;
    for (const e of this.list) {
      if (!e.alive) continue;
      const to = e.pos.clone().sub(pos).setY(0);
      const d = to.length();
      if (d > range + 0.4) continue;
      const ang = Math.abs(angleDiff(yaw, Math.atan2(to.x, to.z)));
      if (ang > arc && d > 0.9) continue;
      const dir = d > 0.001 ? to.normalize() : new THREE.Vector3(0, 0, 1);
      if (e.hurt(dmg, dir)) {
        hits++;
        if (!e.alive || e.state === 'dying') this.killCount++;
      }
    }
    return hits;
  }

  // 剑反弹石头
  tryDeflectRocks(pos, facing, range) {
    let n = 0;
    for (const r of this.rocks) {
      if (r.deflected) continue;
      const to = r.mesh.position.clone().sub(pos).setY(0);
      if (to.length() > range) continue;
      if (facing.dot(to.normalize()) < 0.3) continue;
      this._deflect(r);
      n++;
    }
    return n;
  }

  _deflect(r) {
    r.deflected = true;
    r.life = 3;
    const back = r.owner && r.owner.alive
      ? r.owner.pos.clone().add(new THREE.Vector3(0, 0.4, 0)).sub(r.mesh.position).normalize()
      : r.vel.clone().negate().normalize();
    r.vel.copy(back.multiplyScalar(13));
    this.ctx.audio.shieldClang();
    this.ctx.effects.deflectSpark(r.mesh.position.clone());
  }

  nearestTargetable(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (!e.alive || e.state === 'emerge') continue;
      const d = e.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt, player) {
    const { world } = this.ctx;

    // —— 夜晚生成骷髅 ——
    if (world.isNight && player.alive) {
      this.spawnTimer -= dt;
      const count = this.list.filter((e) => e.alive && e instanceof Stalchild).length;
      if (this.spawnTimer <= 0 && count < 4) {
        this.spawnTimer = 3.4;
        const a = Math.random() * Math.PI * 2;
        const r = 11 + Math.random() * 6;
        const x = player.pos.x + Math.cos(a) * r;
        const z = player.pos.z + Math.sin(a) * r;
        const dCenter = Math.hypot(x, z);
        const inPond = Math.hypot(x - POND.x, z - POND.z) < POND.r + 1;
        if (dCenter < PLAY_RADIUS - 2 && !inPond) {
          this.list.push(new Stalchild(this.scene, this.ctx, x, z));
        }
      }
    } else {
      // 天亮:全部沉回地下
      for (const e of this.list) {
        if (e instanceof Stalchild && e.alive) e.forceSink();
      }
    }

    // —— 章鱼怪驻点 ——
    for (const spot of this.octorokSpots) {
      if (spot.e && !spot.e.alive) {
        spot.e = null;
        spot.respawn = 22;
      }
      if (!spot.e) {
        spot.respawn -= dt;
        if (spot.respawn <= 0) {
          spot.e = new Octorok(this.scene, this.ctx, spot.x, spot.z);
          this.list.push(spot.e);
        }
      }
    }

    for (const e of this.list) e.update(dt, player);
    this.list = this.list.filter((e) => e.alive);

    // —— 石头弹丸 ——
    for (const r of this.rocks) {
      r.life -= dt;
      r.mesh.position.addScaledVector(r.vel, dt);

      if (r.deflected) {
        // 反弹回去命中发射者
        if (r.owner && r.owner.alive && r.mesh.position.distanceTo(r.owner.pos) < 0.9) {
          r.owner.hurt(1, r.vel.clone().setY(0).normalize());
          this.killCount++;
          r.life = 0;
        }
      } else if (player.alive) {
        const d2 = r.mesh.position.distanceTo(player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
        if (d2 < 0.62) {
          if (player.isBlockingToward(r.mesh.position)) {
            this._deflect(r);
          } else {
            player.takeDamage(1, r.mesh.position);
            r.life = 0;
          }
        }
      }

      const gh = world.groundHeight(r.mesh.position.x, r.mesh.position.z);
      if (r.mesh.position.y < gh + 0.1) {
        this.ctx.effects.dirtBurst(r.mesh.position.clone(), 6);
        r.life = 0;
      }
      if (r.life <= 0) this.scene.remove(r.mesh);
    }
    this.rocks = this.rocks.filter((r) => r.life > 0);
  }
}
