import * as THREE from 'three';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Effects } from './effects.js';
import { World } from './world.js';
import { Items } from './items.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Ocarina } from './ocarina.js';

// ---------- 渲染器 ----------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 420);
camera.position.set(0, 3, 7);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 游戏上下文 ----------
const ctx = {
  scene, camera, renderer,
  mode: 'title', // title | playing | gameover
  state: { rupees: 0, halves: 6, maxHalves: 6, timeSlowT: 0 },
  flags: {},
};

ctx.input = new Input(canvas);
ctx.audio = new AudioEngine();
ctx.ui = new UI(ctx);
ctx.effects = new Effects(scene, camera);
ctx.world = new World(scene, ctx);
ctx.items = new Items(scene, ctx);
ctx.enemies = new Enemies(scene, ctx);
ctx.player = new Player(scene, ctx);
ctx.ocarina = new Ocarina(ctx);

ctx.addRupees = (n) => {
  ctx.state.rupees = Math.min(999, ctx.state.rupees + n);
  ctx.ui.updateRupees(true);
};
ctx.onGameOver = () => {
  ctx.mode = 'gameover';
  setTimeout(() => ctx.ui.gameOver(), 900);
};

window.__game = ctx; // 调试入口

// ---------- 开始游戏 ----------
let playT = 0;
let beepT = 0;

function startGame() {
  if (ctx.mode !== 'title') return;
  ctx.mode = 'playing';
  ctx.audio.init();
  ctx.audio.startChime();
  ctx.ui.hideTitle();
}
document.getElementById('press-start').addEventListener('click', startGame);
document.getElementById('title-screen').addEventListener('click', startGame);

// ---------- 教学提示 ----------
function updateHints() {
  const { flags, items, player, world } = ctx;

  if (!flags.intro && playT > 1.6) {
    flags.intro = true;
    items.naviSay('嘿!听着!WASD 移动、J 挥剑、空格翻滚。先去割草丛找点卢比吧!', null, 6);
  }
  if (!flags.pondHint && Math.hypot(player.pos.x - 26, player.pos.z - 14) < 15) {
    flags.pondHint = true;
    items.naviSay('小心!水塘里的章鱼怪会吐石头。按住 K 举盾,可以把石头反弹回去!', new THREE.Vector3(26, 0, 14), 6);
  }
  if (!flags.nightHint && world.isNight) {
    flags.nightHint = true;
    items.naviSay('天黑了……骷髅兵会从地下爬出来!按 Tab 锁定敌人再战斗!', null, 6);
  }
  if (!flags.chestHint && Math.hypot(player.pos.x + 30, player.pos.z + 22) < 11 && !flags.chestOpened) {
    flags.chestHint = true;
    const cp = new THREE.Vector3(-30, world.groundHeight(-30, -22), -22);
    items.naviSay('看!山丘上有个宝箱!走过去按 E 打开它!', cp, 5.5);
  }
  if (!flags.ocarinaHint && playT > 50 && !flags.ocarinaUsed && player.state === 'normal') {
    flags.ocarinaHint = true;
    items.naviSay('对了,按 O 可以吹奏陶笛!试试 → ↓ ↑ → ↓ ↑,那是太阳之歌!', null, 7);
  }
  if (!flags.sunHintDone && flags.sunSongUsed) {
    flags.sunHintDone = true;
    setTimeout(() => items.naviSay('太阳之歌能颠倒昼夜!还有风暴之歌(空格↓↑空格↓↑)、摇篮曲(←↑→←↑→)……', null, 7), 2600);
  }
}

// ---------- 主循环 ----------
let lastT = performance.now();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const { input, world, player, enemies, items, ocarina, effects, ui } = ctx;

  if (ctx.mode === 'title') {
    if (input.wasPressed('Enter')) startGame();
    // 标题背景缓慢旋转
    const t = performance.now() * 0.0001;
    camera.position.set(Math.sin(t) * 14, 5, Math.cos(t) * 14);
    camera.lookAt(0, 1, 0);
    world.update(dt * 0.3, player.pos);
    effects.update(dt, player.pos);
    renderer.render(scene, camera);
    input.endFrame();
    return;
  }

  if (ctx.mode === 'gameover' && input.wasPressed('Enter')) {
    location.reload();
    return;
  }

  if (input.wasPressed('KeyH')) ui.toggleControls();

  playT += dt;
  if (ctx.state.timeSlowT > 0) ctx.state.timeSlowT -= dt;

  world.update(dt, player.pos);

  if (ctx.mode === 'playing') {
    updateHints();
    ocarina.update(dt);
    player.update(dt);

    const dtE = ctx.state.timeSlowT > 0 ? dt * 0.42 : dt;
    enemies.update(dtE, player);
    items.update(dt, player);

    // 交互
    const inter = items.interactableNear;
    ui.prompt(inter && !ocarina.active ? inter.label : null);
    if (inter && !ocarina.active && input.wasPressed('KeyE')) inter.cb();

    // 低血量警报
    if (ctx.state.halves <= 2 && ctx.state.halves > 0) {
      beepT -= dt;
      if (beepT <= 0) { beepT = 1.15; ctx.audio.lowHpBeep(); }
    }
  } else {
    // 死亡后世界继续呼吸
    player.update(dt);
    enemies.update(dt * 0.4, player);
    items.update(dt, player);
    ui.prompt(null);
  }

  effects.update(dt, player.pos);
  player.updateCamera(camera, dt);
  effects.applyShake(camera);
  ui.update(dt);
  ui.updateTimeIcon(world);

  renderer.render(scene, camera);
  input.endFrame();
}

loop();
