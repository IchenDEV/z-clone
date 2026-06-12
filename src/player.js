import * as THREE from 'three';
import { toonMat, PLAY_RADIUS } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// 盾牌贴图:海利亚盾(蓝底银边 + 金色三角)
function makeShieldTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#aab4c0';
  g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#24407e';
  g.fillRect(10, 10, 108, 124);
  g.beginPath();
  g.moveTo(10, 134); g.lineTo(64, 154); g.lineTo(118, 134); g.closePath();
  g.fill();
  // 三角力量
  g.fillStyle = '#ecc44a';
  const tri = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s); g.lineTo(x - s, y + s); g.closePath(); g.fill(); };
  tri(64, 34, 11); tri(53, 56, 11); tri(75, 56, 11);
  // 红色飞鸟(简化)
  g.strokeStyle = '#c43030';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(24, 92); g.quadraticCurveTo(44, 76, 64, 92); g.quadraticCurveTo(84, 76, 104, 92);
  g.stroke();
  g.beginPath(); g.moveTo(64, 86); g.lineTo(64, 116); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Player {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.state = 'normal'; // normal | roll | attack | damaged | dead | itemGet | ocarina
    this.blocking = false;
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // 初始面向南(镜头看北边城堡)
    this.moveK = 0;
    this.runPhase = 0;
    this.invuln = 0;
    this.stun = 0;
    this.stateT = 0;
    this.combo = 0;
    this.queuedAttack = false;
    this.attackDidHit = false;
    this.comboResetT = 0;
    this.lockTarget = null;
    this.camYaw = 0;
    this.camPitch = 0.34;
    this.camDist = 5.8;
    this.manualCamT = 0;
    this.splashTimer = 0;
    this.itemMesh = null;
    this.itemDone = null;
    this.deadT = 0;

    this._buildModel();
    this._buildReticle();

    this.root.position.set(0, 0, 0);
    scene.add(this.root);
  }

  get pos() { return this.root.position; }
  get alive() { return this.state !== 'dead'; }

  facingDir(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  // ============ 模型 ============
  _buildModel() {
    this.root = new THREE.Group();
    this.spinPivot = new THREE.Group();
    this.spinPivot.position.y = 0.62;
    this.root.add(this.spinPivot);
    this.rig = new THREE.Group();
    this.rig.position.y = -0.62;
    this.spinPivot.add(this.rig);

    const tunic = toonMat(0x2e8b3d);
    const skin = toonMat(0xf0c08a);
    const hair = toonMat(0xe8c84a);
    const white = toonMat(0xe8e4da);
    const boot = toonMat(0x6a4628);

    // 腿
    const legGeo = new THREE.BoxGeometry(0.17, 0.62, 0.2);
    legGeo.translate(0, -0.31, 0);
    const bootGeo = new THREE.BoxGeometry(0.19, 0.18, 0.27);
    this.legL = new THREE.Group(); this.legL.position.set(0.115, 0.74, 0);
    this.legR = new THREE.Group(); this.legR.position.set(-0.115, 0.74, 0);
    for (const leg of [this.legL, this.legR]) {
      const m = new THREE.Mesh(legGeo, white);
      const b = new THREE.Mesh(bootGeo, boot);
      b.position.set(0, -0.66, 0.03);
      leg.add(m, b);
      this.rig.add(leg);
    }

    // 躯干(束腰长袍)
    this.torso = new THREE.Group();
    this.torso.position.y = 0.74;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.3), tunic);
    chest.position.y = 0.26;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.31, 0.22, 8), tunic);
    skirt.position.y = -0.02;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.32), toonMat(0x4a3420));
    belt.position.y = 0.1;
    this.torso.add(chest, skirt, belt);
    this.rig.add(this.torso);

    // 头
    this.head = new THREE.Group();
    this.head.position.y = 0.52;
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), skin);
    face.position.y = 0.16;
    const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), hair);
    bangs.position.y = 0.31;
    const capBase = new THREE.Mesh(new THREE.ConeGeometry(0.235, 0.5, 4), tunic);
    capBase.position.set(0, 0.46, -0.07);
    capBase.rotation.set(-0.55, Math.PI / 4, 0);
    const earGeo = new THREE.BoxGeometry(0.1, 0.07, 0.05);
    const earL = new THREE.Mesh(earGeo, skin); earL.position.set(0.21, 0.18, -0.02);
    const earR = new THREE.Mesh(earGeo, skin); earR.position.set(-0.21, 0.18, -0.02);
    const eyeGeo = new THREE.PlaneGeometry(0.055, 0.1);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a2c4e });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(0.085, 0.17, 0.165);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(-0.085, 0.17, 0.165);
    this.head.add(face, bangs, capBase, earL, earR, eyeL, eyeR);
    this.torso.add(this.head);

    // 手臂
    const armGeo = new THREE.BoxGeometry(0.13, 0.52, 0.14);
    armGeo.translate(0, -0.26, 0);
    this.armR = new THREE.Group(); this.armR.position.set(-0.29, 0.46, 0);
    this.armL = new THREE.Group(); this.armL.position.set(0.29, 0.46, 0);
    for (const [arm, mat] of [[this.armR, tunic], [this.armL, tunic]]) {
      const a = new THREE.Mesh(armGeo, mat);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.13), skin);
      hand.position.y = -0.55;
      arm.add(a, hand);
      this.torso.add(arm);
    }

    // 剑(右手)
    this.sword = new THREE.Group();
    this.sword.position.y = -0.58;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.18, 6), toonMat(0x5a3a8c));
    grip.position.y = 0.06;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.05), toonMat(0x3a6ab0));
    guard.position.y = -0.04;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.74, 0.018), toonMat(0xdce4f0, { emissive: 0x303c50 }));
    blade.position.y = -0.44;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0275, 0.09, 4), toonMat(0xdce4f0));
    tip.rotation.x = Math.PI; tip.rotation.y = Math.PI / 4;
    tip.position.y = -0.855;
    this.sword.add(grip, guard, blade, tip);
    this.swordBaseMarker = new THREE.Object3D(); this.swordBaseMarker.position.y = -0.08;
    this.swordTipMarker = new THREE.Object3D(); this.swordTipMarker.position.y = -0.9;
    this.sword.add(this.swordBaseMarker, this.swordTipMarker);
    this.armR.add(this.sword);

    // 盾(左臂,纹章面朝外)
    this.shield = new THREE.Group();
    this.shield.position.set(0.09, -0.34, 0);
    const steel = toonMat(0x9aa4b0);
    const shieldFace = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.5, 0.4),
      [new THREE.MeshToonMaterial({ map: makeShieldTexture(), gradientMap: null }),
       steel, steel, steel, steel, steel]
    );
    this.shield.add(shieldFace);
    this.armL.add(this.shield);

    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  _buildReticle() {
    const g = new THREE.ConeGeometry(0.17, 0.32, 4);
    this.reticle = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd84a }));
    this.reticle.rotation.x = Math.PI;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  // ============ 受击 ============
  takeDamage(halves, fromPos, { blockable = true } = {}) {
    if (!this.alive || this.invuln > 0 || this.state === 'itemGet') return false;
    if (blockable && this.isBlockingToward(fromPos)) {
      this.ctx.audio.shieldClang();
      const p = this.pos.clone(); p.y += 0.9;
      this.ctx.effects.deflectSpark(p);
      const away = this.pos.clone().sub(fromPos).setY(0).normalize();
      this.vel.addScaledVector(away, 3);
      return false;
    }
    const st = this.ctx.state;
    st.halves = Math.max(0, st.halves - halves);
    this.ctx.ui.updateHearts();
    this.ctx.audio.playerHurt();
    this.ctx.ui.flashRed();
    this.ctx.effects.shake(1.1);
    this.invuln = 1.6;
    this.stun = 0.38;
    const away = this.pos.clone().sub(fromPos).setY(0);
    if (away.lengthSq() < 0.001) away.set(0, 0, 1);
    this.vel.addScaledVector(away.normalize(), 7);
    this.state = 'damaged';
    this.stateT = 0;
    if (st.halves <= 0) this._die();
    return true;
  }

  isBlockingToward(point) {
    if (!this.blocking) return false;
    const to = point.clone().sub(this.pos).setY(0).normalize();
    return this.facingDir().dot(to) > 0.35;
  }

  _die() {
    this.state = 'dead';
    this.deadT = 0;
    this.blocking = false;
    this.lockTarget = null;
    this.reticle.visible = false;
    this.ctx.audio.deathSting();
    this.ctx.onGameOver?.();
  }

  heal(halves) {
    const st = this.ctx.state;
    st.halves = Math.min(st.maxHalves, st.halves + halves);
    this.ctx.ui.updateHearts();
  }

  startItemGet(mesh, dur, onDone) {
    this.state = 'itemGet';
    this.stateT = 0;
    this.itemGetDur = dur;
    this.itemMesh = mesh;
    this.itemDone = onDone;
    this.blocking = false;
  }

  setOcarina(on) {
    if (on && (this.state === 'normal' || this.state === 'attack')) {
      this.state = 'ocarina';
      this.stateT = 0;
      this.blocking = false;
      this.ctx.effects.trailClear();
      return true;
    }
    if (!on && this.state === 'ocarina') {
      this.state = 'normal';
      return true;
    }
    return false;
  }

  ocarinaNoteBob() { this._noteBob = 0.14; }

  // ============ 主更新 ============
  update(dt) {
    const { input, world } = this.ctx;
    this.stateT += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.stun > 0) this.stun -= dt;
    if (this.comboResetT > 0) { this.comboResetT -= dt; if (this.comboResetT <= 0) this.combo = 0; }

    if (this.state === 'dead') { this._updateDead(dt); return; }
    if (this.state === 'itemGet') { this._updateItemGet(dt); return; }

    // —— 锁定 ——
    if (input.wasPressed('Tab')) {
      if (this.lockTarget) this.lockTarget = null;
      else this.lockTarget = this.ctx.enemies.nearestTargetable(this.pos, 17);
    }
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 21)) {
      this.lockTarget = null;
    }
    this.reticle.visible = !!this.lockTarget;
    if (this.lockTarget) {
      const t = performance.now() * 0.001;
      this.reticle.position.copy(this.lockTarget.pos);
      this.reticle.position.y += (this.lockTarget.height || 1.6) + 0.45 + Math.sin(t * 5) * 0.1;
      this.reticle.rotation.y = t * 4;
    }

    // —— 盾牌 ——
    const wantBlock = (input.isDown('KeyK') || input.mouseDown[2]) && this.state === 'normal' && this.stun <= 0;
    this.blocking = wantBlock;

    // —— 攻击输入 ——
    const atkPressed = input.wasPressed('KeyJ') || input.mousePressed[0];
    if (atkPressed && this.stun <= 0) {
      if (this.state === 'normal' && !this.blocking) this._startAttack();
      else if (this.state === 'attack' && this.stateT > 0.12) this.queuedAttack = true;
      else if (this.blocking) this._startAttack(); // 持盾砍
    }

    // —— 翻滚 ——
    if (input.wasPressed('Space') && this.state === 'normal' && this.moveK > 0.2 && this.stun <= 0 && world.waterDepth(this.pos.x, this.pos.z) < 0.15) {
      this.state = 'roll';
      this.stateT = 0;
      this.ctx.audio.roll();
      this.rollDir = this.facingDir(new THREE.Vector3());
    }

    // —— 各状态 ——
    if (this.state === 'attack') this._updateAttack(dt);
    else if (this.state === 'roll') this._updateRoll(dt);
    else if (this.state === 'damaged') {
      if (this.stun <= 0) this.state = 'normal';
    }

    this._updateMove(dt);
    this._updateAnim(dt);

    // 无敌闪烁
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    this.rig.visible = !blink;
  }

  // ============ 移动 ============
  _updateMove(dt) {
    const { input, world } = this.ctx;
    const canControl = (this.state === 'normal' || this.state === 'ocarina') && this.stun <= 0;

    let ix = 0, iz = 0;
    if (this.state !== 'ocarina' && canControl) {
      if (input.isDown('KeyW')) iz += 1;
      if (input.isDown('KeyS')) iz -= 1;
      if (input.isDown('KeyA')) ix -= 1;
      if (input.isDown('KeyD')) ix += 1;
    }
    const hasInput = ix !== 0 || iz !== 0;

    let speed = 5.4;
    const depth = world.waterDepth(this.pos.x, this.pos.z);
    if (depth > 0.12) speed *= 0.55;
    if (this.blocking) speed *= 0.42;

    const target = new THREE.Vector3();
    if (hasInput) {
      let fwd, right;
      if (this.lockTarget) {
        fwd = this.lockTarget.pos.clone().sub(this.pos).setY(0).normalize();
        right = new THREE.Vector3().crossVectors(fwd, UP).negate();
      } else {
        fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
        right = new THREE.Vector3().crossVectors(fwd, UP).negate();
      }
      target.addScaledVector(fwd, iz).addScaledVector(right, ix);
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);
    }

    if (this.state === 'roll') {
      target.copy(this.rollDir).multiplyScalar(7.6);
    } else if (this.state === 'attack') {
      // 攻击时的小步突进
      target.copy(this.facingDir(new THREE.Vector3())).multiplyScalar(this.attackLunge || 0);
    }

    const accel = this.stun > 0 ? 2 : 14;
    this.vel.x += (target.x - this.vel.x) * damp(accel, dt);
    this.vel.z += (target.z - this.vel.z) * damp(accel, dt);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 朝向
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.moveK = Math.min(1, horizSpeed / 5.4);
    if (this.lockTarget && this.state !== 'roll') {
      const to = this.lockTarget.pos.clone().sub(this.pos);
      this.yaw = lerpAngle(this.yaw, Math.atan2(to.x, to.z), damp(14, dt));
    } else if (hasInput && horizSpeed > 0.5 && this.state !== 'attack') {
      this.yaw = lerpAngle(this.yaw, Math.atan2(target.x, target.z), damp(11, dt));
    }
    this.root.rotation.y = this.yaw;

    // 碰撞:树木/岩石等圆柱体
    for (const c of world.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.32;
      if (d < min && d > 0.0001) {
        if (this.state === 'roll') {
          const tree = world.shakeTreeNear(c.x, c.z);
          if (tree) {
            this.ctx.items.treeDrop(tree);
            this.ctx.audio.enemyHit();
            this.ctx.effects.shake(0.5);
            this.ctx.effects.burst(new THREE.Vector3(tree.x, this.pos.y + 2.2, tree.z), { count: 10, color: 0x3f8f3a, speed: 1.5, up: 0.5, life: 0.9, size: 0.14, grav: 6 });
          }
          this.state = 'normal';
          this.vel.multiplyScalar(-0.4);
        }
        this.pos.x = c.x + (dx / d) * min;
        this.pos.z = c.z + (dz / d) * min;
      }
    }

    // 世界边界
    const dCenter = Math.hypot(this.pos.x, this.pos.z);
    if (dCenter > PLAY_RADIUS) {
      this.pos.x *= PLAY_RADIUS / dCenter;
      this.pos.z *= PLAY_RADIUS / dCenter;
    }

    this.pos.y = world.groundHeight(this.pos.x, this.pos.z);

    // 水花
    if (depth > 0.1) {
      this.splashTimer -= dt;
      if (horizSpeed > 1 && this.splashTimer <= 0) {
        this.splashTimer = 0.28;
        const p = this.pos.clone(); p.y += 0.1;
        this.ctx.effects.splash(p);
        this.ctx.audio.splash();
      }
    }
  }

  // ============ 攻击 ============
  _startAttack() {
    this.state = 'attack';
    this.stateT = 0;
    this.attackDidHit = false;
    this.queuedAttack = false;
    this.combo = this.comboResetT > 0 ? (this.combo + 1) % 3 : 0;
    this.comboResetT = 1.0;
    this.ctx.audio.swordSwing(this.combo);
    this.attackLunge = this.combo === 2 ? 3.4 : 1.6;
    // 没锁定时,朝输入方向出剑
    const { input } = this.ctx;
    let ix = 0, iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    if (!this.lockTarget && (ix || iz)) {
      const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const right = new THREE.Vector3().crossVectors(fwd, UP).negate();
      const dir = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
      if (dir.lengthSq() > 0) this.yaw = Math.atan2(dir.x, dir.z);
    }
  }

  _updateAttack(dt) {
    const DUR = this.combo === 2 ? 0.46 : 0.38;
    const t = this.stateT;
    const activeFrom = 0.08, activeTo = 0.24;

    if (t >= activeFrom && !this.attackDidHit) {
      this.attackDidHit = true;
      const dmg = this.combo === 2 ? 2 : 1;
      const hitPos = this.pos.clone().addScaledVector(this.facingDir(new THREE.Vector3()), 1.2);
      hitPos.y += 0.8;
      const hits = this.ctx.enemies.applyPlayerAttack({
        pos: this.pos, yaw: this.yaw, range: 2.3, arcDeg: 150, dmg,
      });
      if (hits > 0) {
        this.ctx.audio.swordHit();
        this.ctx.effects.hitSpark(hitPos);
        this.ctx.effects.shake(0.35);
      }
      this.ctx.items.cutGrassAt(hitPos, 1.6);
      this.ctx.enemies.tryDeflectRocks(this.pos, this.facingDir(new THREE.Vector3()), 2.2);
    }

    // 剑光
    if (t > 0.03 && t < activeTo + 0.08) {
      const b = new THREE.Vector3(), tp = new THREE.Vector3();
      this.swordBaseMarker.getWorldPosition(b);
      this.swordTipMarker.getWorldPosition(tp);
      this.ctx.effects.trailPush(b, tp);
    }

    this.attackLunge = t < activeTo ? (this.combo === 2 ? 3.2 : 1.5) : 0;

    if (t >= DUR) {
      if (this.queuedAttack) this._startAttack();
      else { this.state = 'normal'; this.attackLunge = 0; }
    }
  }

  _updateRoll(dt) {
    if (this.stateT >= 0.52) {
      this.state = 'normal';
      this.spinPivot.rotation.x = 0;
    }
  }

  _updateItemGet(dt) {
    if (this.itemMesh) {
      const t = Math.min(1, this.stateT / 0.5);
      this.itemMesh.position.set(
        this.pos.x, this.pos.y + 1.4 + t * 0.75 + Math.sin(this.stateT * 2.4) * 0.05, this.pos.z
      );
      this.itemMesh.rotation.y += dt * 2.2;
      if (Math.random() < 0.25) {
        this.ctx.effects.sparkle(this.itemMesh.position, 0xfff2a8, 2);
      }
    }
    this._poseItemGet();
    if (this.stateT >= this.itemGetDur) {
      this.state = 'normal';
      const done = this.itemDone;
      this.itemDone = null;
      done?.();
    }
  }

  _updateDead(dt) {
    this.deadT += dt;
    const k = Math.min(1, this.deadT / 0.7);
    this.spinPivot.rotation.z = (Math.PI / 2) * k * k;
    this.spinPivot.position.y = 0.62 - 0.3 * k;
    this.vel.multiplyScalar(1 - damp(6, dt));
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }

  // ============ 动画 ============
  _resetPose() {
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.spinPivot.rotation.x = 0;
    this.sword.rotation.set(0, 0, 0);
  }

  _poseItemGet() {
    this._resetPose();
    this.armL.rotation.x = -2.9;
    this.armR.rotation.x = -2.9;
    this.head.rotation.x = -0.25;
  }

  _updateAnim(dt) {
    if (this.state === 'dead' || this.state === 'itemGet') return;
    this._resetPose();
    const t = performance.now() * 0.001;

    this.runPhase += dt * (4 + this.moveK * 9);
    const swing = Math.sin(this.runPhase) * 0.8 * this.moveK;

    // 跑步骨架
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.torso.rotation.x = 0.1 * this.moveK;
    this.rig.position.y = -0.62 + Math.abs(Math.sin(this.runPhase)) * 0.06 * this.moveK;

    let armLDone = false, armRDone = false;

    if (this.state === 'ocarina') {
      // 双手持笛
      this.armR.rotation.set(-1.95, 0, 0.7);
      this.armL.rotation.set(-1.95, 0, -0.7);
      this.head.rotation.x = 0.12;
      if (this._noteBob > 0) {
        this._noteBob -= dt;
        this.head.rotation.x += Math.sin(this._noteBob * 40) * 0.05;
      }
      armLDone = armRDone = true;
    }

    if (this.blocking) {
      this.armL.rotation.set(-1.25, 0, 0.5);
      this.shield.rotation.y = -0.5;
      armLDone = true;
    } else {
      this.shield.rotation.y = 0;
    }

    if (this.state === 'attack') {
      const DUR = this.combo === 2 ? 0.46 : 0.38;
      const k = Math.min(1, this.stateT / DUR);
      const ease = k < 0.25 ? k / 0.25 * 0.2 : 0.2 + (Math.min(k, 0.65) - 0.25) / 0.4 * 0.8;
      if (this.combo === 0) {
        // 横斩:右→左
        this.armR.rotation.x = -1.5;
        this.armR.rotation.z = -1.25 + ease * 2.3;
        this.torso.rotation.y = 0.5 - ease * 1.0;
      } else if (this.combo === 1) {
        // 回斩:左→右
        this.armR.rotation.x = -1.5;
        this.armR.rotation.z = 1.05 - ease * 2.3;
        this.torso.rotation.y = -0.5 + ease * 1.0;
      } else {
        // 终结突刺
        this.armR.rotation.x = -0.6 - ease * 1.05;
        this.armR.rotation.z = 0;
        this.torso.rotation.x = 0.15 + ease * 0.18;
        this.sword.rotation.x = 0;
      }
      armRDone = true;
    }

    if (this.state === 'roll') {
      const k = Math.min(1, this.stateT / 0.5);
      this.spinPivot.rotation.x = -k * Math.PI * 2;
      this.legL.rotation.x = -1.6;
      this.legR.rotation.x = -1.6;
      this.armL.rotation.x = -1.2;
      this.armR.rotation.x = -1.2;
      armLDone = armRDone = true;
    }

    if (!armRDone) this.armR.rotation.x = -swing * 0.6;
    if (!armLDone) this.armL.rotation.x = swing * 0.6;

    // 非攻击时剑刃略向后收,避免插进地面
    if (this.state !== 'attack') this.sword.rotation.x = 0.55;

    // 待机呼吸
    if (this.moveK < 0.05 && this.state === 'normal') {
      this.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
      this.armL.rotation.z = -0.06 + Math.sin(t * 2.2) * 0.02;
      this.armR.rotation.z = 0.06 - Math.sin(t * 2.2) * 0.02;
    } else {
      this.torso.scale.y = 1;
    }
  }

  // ============ 相机 ============
  updateCamera(camera, dt) {
    const { input, world } = this.ctx;

    // 手动旋转
    let manual = 0;
    if (this.state !== 'ocarina') {
      if (input.isDown('KeyQ') || input.isDown('ArrowLeft')) manual = 1;
      if (input.isDown('ArrowRight')) manual = -1;
      if (input.isDown('ArrowUp')) this.camPitch = Math.min(0.9, this.camPitch + dt * 0.9);
      if (input.isDown('ArrowDown')) this.camPitch = Math.max(0.12, this.camPitch - dt * 0.9);
    }
    if (manual !== 0) {
      this.camYaw += manual * dt * 2.4;
      this.manualCamT = 1.4;
    } else if (this.manualCamT > 0) {
      this.manualCamT -= dt;
    }

    if (input.wheelDelta !== 0) {
      this.camDist = Math.min(9.5, Math.max(3.2, this.camDist + input.wheelDelta * 0.004));
    }

    if (this.state === 'itemGet') {
      // 正面特写
      const want = this.yaw;
      this.camYaw = lerpAngle(this.camYaw, want + Math.PI, damp(4, dt));
      const dir = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
      const pos = this.pos.clone().addScaledVector(dir, 3.6);
      pos.y = this.pos.y + 1.5;
      camera.position.lerp(pos, damp(5, dt));
      camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
      return;
    }

    if (this.lockTarget) {
      const away = this.pos.clone().sub(this.lockTarget.pos).setY(0).normalize();
      this.camYaw = lerpAngle(this.camYaw, Math.atan2(away.x, away.z), damp(4.5, dt));
    } else if (this.manualCamT <= 0 && this.moveK > 0.25) {
      this.camYaw = lerpAngle(this.camYaw, this.yaw + Math.PI, damp(1.1, dt));
    }

    const cosP = Math.cos(this.camPitch), sinP = Math.sin(this.camPitch);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * cosP, sinP, Math.cos(this.camYaw) * cosP);
    const pos = this.pos.clone().addScaledVector(dir, this.camDist);
    pos.y += 1.0;
    const gh = world.groundHeight(pos.x, pos.z);
    if (pos.y < gh + 0.4) pos.y = gh + 0.4;
    camera.position.lerp(pos, damp(8, dt));

    const look = this.pos.clone();
    look.y += 1.25;
    if (this.lockTarget) {
      look.lerp(this.lockTarget.pos.clone().setY(this.lockTarget.pos.y + 1), 0.32);
    }
    camera.lookAt(look);
  }
}
