// 全合成音频引擎:音效 / 陶笛 / 背景音乐,均由 WebAudio 实时生成,无任何素材文件
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 陶笛五音(时之笛设定):A=D4  C↓=F4  C→=A4  C←=B4  C↑=D5
export const OCARINA_FREQ = {
  a: midiHz(62),
  down: midiHz(65),
  right: midiHz(69),
  left: midiHz(71),
  up: midiHz(74),
};

// ---- 白天 BGM:原创田园小调(避开任天堂原曲),8 小节循环 ----
const CHORDS = [
  [48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48],
  [48, 52, 55], [43, 47, 50], [41, 45, 48], [48, 52, 55],
];
const MELODY = [
  [64, 0, 2], [67, 2, 1], [69, 3, 1], [67, 4, 2], [64, 6, 2],
  [62, 8, 3], [64, 11, 1], [62, 12, 2], [59, 14, 2],
  [57, 16, 2], [60, 18, 1], [62, 19, 1], [64, 20, 3], [62, 23, 1],
  [60, 24, 2], [62, 26, 1], [64, 27, 1], [67, 28, 4],
  [64, 32, 2], [67, 34, 1], [69, 35, 1], [71, 36, 2], [69, 38, 2],
  [67, 40, 3], [64, 43, 1], [67, 44, 2], [62, 46, 2],
  [64, 48, 2], [62, 50, 1], [60, 51, 1], [57, 52, 3], [60, 55, 1],
  [60, 56, 6],
];
const TOTAL_EIGHTHS = 64;
const ARP_SEQ = [0, 1, 2, 3, 2, 1, 2, 3];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.nightMix = 0;
  }

  init() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    this.started = true;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.42;
    this.musicBus.connect(this.master);

    this.dayBus = ctx.createGain();
    this.dayBus.gain.value = 1;
    this.dayBus.connect(this.musicBus);
    this.nightBus = ctx.createGain();
    this.nightBus.gain.value = 0;
    this.nightBus.connect(this.musicBus);

    // 雨声层
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer();
    rainSrc.loop = true;
    const rainLP = ctx.createBiquadFilter();
    rainLP.type = 'lowpass';
    rainLP.frequency.value = 1400;
    rainSrc.connect(rainLP).connect(this.rainGain).connect(this.master);
    rainSrc.start();

    // BGM 调度器
    this.tempo = 96;
    this.eighthDur = 60 / this.tempo / 2;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this._schedule();
  }

  noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // ---------- 通用合成原语 ----------
  tone({ freq, type = 'sine', dur = 0.2, attack = 0.005, release = 0.08, gain = 0.2, when = 0, slideTo = null, vibrato = 0, dest = null, detune = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.value = detune;
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + release);
    if (vibrato > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0 + 0.12);
      lfo.stop(t0 + dur + release);
    }
    osc.connect(g).connect(dest || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + release + 0.02);
  }

  noise({ dur = 0.2, filter = 'lowpass', freq = 1000, sweepTo = null, Q = 1, gain = 0.25, when = 0, attack = 0.002, dest = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(dest || this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  bell(freq, { when = 0, gain = 0.18, dur = 0.7 } = {}) {
    this.tone({ freq, type: 'sine', dur, release: dur * 0.6, gain, when });
    this.tone({ freq: freq * 2.76, type: 'sine', dur: dur * 0.4, release: 0.2, gain: gain * 0.3, when });
  }

  // ---------- 游戏音效 ----------
  swordSwing(combo = 0) {
    this.noise({ dur: 0.14, filter: 'bandpass', freq: 900 + combo * 250, sweepTo: 2600 + combo * 400, Q: 1.4, gain: 0.22 });
  }
  swordHit() {
    this.tone({ freq: 160, type: 'square', dur: 0.06, gain: 0.18 });
    this.noise({ dur: 0.1, filter: 'bandpass', freq: 2200, Q: 2, gain: 0.2 });
  }
  shieldClang() {
    this.tone({ freq: 1180, type: 'triangle', dur: 0.18, gain: 0.22, detune: 8 });
    this.tone({ freq: 1770, type: 'triangle', dur: 0.12, gain: 0.13, detune: -6 });
    this.noise({ dur: 0.08, filter: 'highpass', freq: 3000, gain: 0.12 });
  }
  playerHurt() {
    this.tone({ freq: 330, type: 'sawtooth', dur: 0.18, slideTo: 140, gain: 0.22 });
    this.noise({ dur: 0.12, filter: 'lowpass', freq: 800, gain: 0.18 });
  }
  enemyHit() {
    this.tone({ freq: 220, type: 'square', dur: 0.07, slideTo: 130, gain: 0.16 });
    this.noise({ dur: 0.09, filter: 'bandpass', freq: 1500, gain: 0.16 });
  }
  enemyDie() {
    this.noise({ dur: 0.45, filter: 'lowpass', freq: 1600, sweepTo: 200, gain: 0.26 });
    this.tone({ freq: 280, type: 'square', dur: 0.3, slideTo: 60, gain: 0.12 });
  }
  bonePoof() {
    this.noise({ dur: 0.3, filter: 'bandpass', freq: 700, sweepTo: 300, Q: 0.8, gain: 0.22 });
  }
  emerge() {
    this.noise({ dur: 0.6, filter: 'lowpass', freq: 240, gain: 0.3 });
  }
  rupee() {
    this.tone({ freq: 988, type: 'sine', dur: 0.07, gain: 0.2 });
    this.tone({ freq: 1319, type: 'sine', dur: 0.18, gain: 0.2, when: 0.07 });
  }
  heart() {
    this.bell(880, { gain: 0.14, dur: 0.4 });
    this.bell(1109, { when: 0.09, gain: 0.12, dur: 0.5 });
  }
  naviHey() {
    this.tone({ freq: 2350, type: 'square', dur: 0.06, gain: 0.07 });
    this.tone({ freq: 2800, type: 'square', dur: 0.09, gain: 0.07, when: 0.08 });
  }
  roll() {
    this.noise({ dur: 0.22, filter: 'lowpass', freq: 1200, sweepTo: 300, gain: 0.13 });
  }
  splash() {
    this.noise({ dur: 0.25, filter: 'highpass', freq: 1200, gain: 0.1 });
    this.noise({ dur: 0.3, filter: 'lowpass', freq: 600, gain: 0.12 });
  }
  spit() {
    this.noise({ dur: 0.12, filter: 'bandpass', freq: 500, sweepTo: 1200, gain: 0.16 });
  }
  chestOpen() {
    this.tone({ freq: 90, type: 'sawtooth', dur: 0.5, slideTo: 160, gain: 0.1 });
    this.noise({ dur: 0.4, filter: 'lowpass', freq: 500, gain: 0.12 });
  }
  fanfare() {
    // 原创"获得物品"号角(规避原版旋律)
    const seq = [[67, 0, 0.16], [72, 0.16, 0.16], [76, 0.32, 0.16], [79, 0.5, 0.9]];
    for (const [m, t, d] of seq) {
      this.tone({ freq: midiHz(m), type: 'sawtooth', dur: d, gain: 0.13, when: t, attack: 0.01, release: 0.12 });
      this.tone({ freq: midiHz(m), type: 'triangle', dur: d, gain: 0.12, when: t, detune: 6 });
    }
    for (const [m, t] of [[55, 0.5], [62, 0.5], [67, 0.5]]) {
      this.tone({ freq: midiHz(m), type: 'triangle', dur: 0.9, gain: 0.07, when: t });
    }
  }
  songCorrect() {
    [72, 76, 79, 84].forEach((m, i) => this.bell(midiHz(m), { when: i * 0.09, gain: 0.13, dur: 0.6 }));
  }
  lowHpBeep() {
    this.tone({ freq: 1480, type: 'square', dur: 0.07, gain: 0.05 });
    this.tone({ freq: 1480, type: 'square', dur: 0.07, gain: 0.05, when: 0.14 });
  }
  thunder(delay = 0) {
    this.noise({ dur: 1.8, filter: 'lowpass', freq: 320, sweepTo: 60, gain: 0.4, when: delay, attack: 0.02 });
    this.tone({ freq: 55, type: 'sine', dur: 1.2, slideTo: 30, gain: 0.25, when: delay });
  }
  deathSting() {
    [[57, 0], [53, 0.5], [50, 1.0], [45, 1.6]].forEach(([m, t]) =>
      this.tone({ freq: midiHz(m), type: 'triangle', dur: 0.55, gain: 0.16, when: t }));
  }
  startChime() {
    this.bell(midiHz(76), { gain: 0.16 });
    this.bell(midiHz(83), { when: 0.1, gain: 0.14 });
  }

  // ---------- 陶笛 ----------
  ocarinaNote(name, { dur = 0.45, gain = 0.3 } = {}) {
    const f = OCARINA_FREQ[name];
    if (!f || !this.ctx) return;
    this.tone({ freq: f, type: 'sine', dur, attack: 0.025, release: 0.22, gain, vibrato: 7 });
    this.tone({ freq: f * 2, type: 'triangle', dur, attack: 0.03, release: 0.2, gain: gain * 0.16 });
    this.noise({ dur: dur * 0.6, filter: 'bandpass', freq: f * 4, Q: 6, gain: 0.025 });
  }
  playSongBack(notes) {
    notes.forEach((n, i) => {
      const f = OCARINA_FREQ[n];
      this.tone({ freq: f, type: 'sine', dur: 0.26, gain: 0.26, when: i * 0.3, vibrato: 6, release: 0.18 });
      this.tone({ freq: f * 2, type: 'triangle', dur: 0.26, gain: 0.05, when: i * 0.3 });
    });
  }

  // ---------- BGM 调度 ----------
  _schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this._scheduleStep(this.step, this.nextTime);
      this.step = (this.step + 1) % TOTAL_EIGHTHS;
      this.nextTime += this.eighthDur;
    }
    setTimeout(() => this._schedule(), 50);
  }

  _scheduleStep(step, t) {
    const when = t - this.ctx.currentTime;
    const bar = Math.floor(step / 8);
    const sub = step % 8;
    const chord = CHORDS[bar];

    // —— 白天:竖琴琶音 + 旋律 + 贝斯 ——
    const arpIdx = ARP_SEQ[sub];
    const tone = arpIdx < chord.length ? chord[arpIdx] : chord[0] + 12;
    this.tone({ freq: midiHz(tone + 12), type: 'triangle', dur: 0.22, gain: 0.05, when, release: 0.25, dest: this.dayBus });
    if (sub === 0) {
      this.tone({ freq: midiHz(chord[0] - 12), type: 'triangle', dur: 1.6, gain: 0.085, when, attack: 0.02, release: 0.5, dest: this.dayBus });
    }
    for (const [m, st, d] of MELODY) {
      if (st === step) {
        this.tone({ freq: midiHz(m + 12), type: 'sine', dur: d * this.eighthDur * 0.92, gain: 0.105, when, attack: 0.03, release: 0.2, vibrato: 4, dest: this.dayBus });
      }
    }

    // —— 夜晚:慢和声垫 + 蟋蟀 ——
    if (sub === 0 && bar % 2 === 0) {
      const padChord = bar % 4 === 0 ? [45, 48, 52, 57] : [41, 45, 48, 55];
      for (const m of padChord) {
        this.tone({ freq: midiHz(m), type: 'sine', dur: this.eighthDur * 14, gain: 0.05, when, attack: 1.4, release: 1.6, dest: this.nightBus, detune: Math.random() * 8 - 4 });
      }
    }
    if (Math.random() < 0.16) {
      const f = 4100 + Math.random() * 500;
      for (let i = 0; i < 3; i++) {
        this.tone({ freq: f, type: 'sine', dur: 0.025, gain: 0.018, when: when + i * 0.045, dest: this.nightBus });
      }
    }
  }

  setNight(f) {
    if (!this.ctx) return;
    if (Math.abs(f - this.nightMix) < 0.01) return;
    this.nightMix = f;
    const t = this.ctx.currentTime;
    this.dayBus.gain.setTargetAtTime(1 - f, t, 0.8);
    this.nightBus.gain.setTargetAtTime(f * 1.15, t, 0.8);
  }

  setRain(on) {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 1.2);
  }

  duckMusic(seconds = 2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.06, t, 0.1);
    this.musicBus.gain.setTargetAtTime(0.42, t + seconds, 0.8);
  }
}
