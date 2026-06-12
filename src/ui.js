// DOM HUD:红心 / 卢比 / 对话 / 横幅 / 陶笛音符 / 标题与结算
const HEART_PATH = 'M12 21 C 4 14, 0 9, 0 5.5 C 0 2, 2.5 0, 5.5 0 C 8 0, 10.5 1.5, 12 4 C 13.5 1.5, 16 0, 18.5 0 C 21.5 0, 24 2, 24 5.5 C 24 9, 20 14, 12 21 Z';

const NOTE_LABEL = { up: '▲', down: '▼', left: '◀', right: '▶', a: 'A' };

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = {
      hearts: document.getElementById('hearts'),
      rupees: document.getElementById('rupees'),
      timeIcon: document.getElementById('time-icon'),
      prompt: document.getElementById('action-prompt'),
      dialog: document.getElementById('dialog'),
      songBanner: document.getElementById('song-banner'),
      itemBanner: document.getElementById('itemget-banner'),
      ocarinaUI: document.getElementById('ocarina-ui'),
      staff: document.getElementById('ocarina-staff'),
      flashWhite: document.getElementById('flash-white'),
      flashRed: document.getElementById('flash-red'),
      title: document.getElementById('title-screen'),
      gameover: document.getElementById('gameover-screen'),
      controls: document.getElementById('controls-panel'),
    };
    this.dialogState = null;
    this.lastHeartsKey = '';
    this.lastRupees = -1;
    this.lastTimeKey = '';
    this.updateHearts();
    this.updateRupees();
  }

  // ---------- 红心 ----------
  updateHearts() {
    const { halves, maxHalves } = this.ctx.state;
    const key = `${halves}/${maxHalves}`;
    if (key === this.lastHeartsKey) return;
    this.lastHeartsKey = key;
    const hearts = maxHalves / 2;
    let html = '';
    for (let i = 0; i < hearts; i++) {
      const filled = Math.min(2, Math.max(0, halves - i * 2)); // 0 | 1 | 2
      let fill;
      if (filled === 2) fill = `<path d="${HEART_PATH}" fill="#e82848" stroke="#5a0a18" stroke-width="1.6"/>`;
      else if (filled === 1) fill = `
        <path d="${HEART_PATH}" fill="#3a3148" stroke="#5a0a18" stroke-width="1.6"/>
        <clipPath id="half${i}"><rect x="0" y="0" width="12" height="24"/></clipPath>
        <path d="${HEART_PATH}" fill="#e82848" clip-path="url(#half${i})"/>`;
      else fill = `<path d="${HEART_PATH}" fill="#3a3148" stroke="#5a0a18" stroke-width="1.6"/>`;
      html += `<svg viewBox="-2 -2 28 26">${fill}</svg>`;
    }
    this.el.hearts.innerHTML = html;
  }

  // ---------- 卢比 ----------
  updateRupees(pulse = false) {
    const n = this.ctx.state.rupees;
    if (n === this.lastRupees && !pulse) return;
    this.lastRupees = n;
    this.el.rupees.innerHTML = `
      <svg viewBox="0 0 16 26">
        <polygon points="8,0 16,7 16,19 8,26 0,19 0,7" fill="#35c04a" stroke="#0a5a1a" stroke-width="1.4"/>
        <polygon points="8,4 13,8 13,18 8,22 3,18 3,8" fill="#7ae88a" opacity="0.75"/>
      </svg><span>${String(n).padStart(3, '0')}</span>`;
    if (pulse) {
      const span = this.el.rupees.querySelector('span');
      span.animate(
        [{ transform: 'scale(1.35)', color: '#aaffbb' }, { transform: 'scale(1)', color: '#fff' }],
        { duration: 260, easing: 'ease-out' }
      );
    }
  }

  // ---------- 时间图标 ----------
  updateTimeIcon(world) {
    const key = world.rainFactor > 0.4 ? 'rain' : world.isNight ? 'night' : 'day';
    if (key === this.lastTimeKey) return;
    this.lastTimeKey = key;
    if (key === 'day') {
      let rays = '';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        rays += `<line x1="${22 + Math.cos(a) * 13}" y1="${22 + Math.sin(a) * 13}" x2="${22 + Math.cos(a) * 18}" y2="${22 + Math.sin(a) * 18}" stroke="#ffd84a" stroke-width="2.6" stroke-linecap="round"/>`;
      }
      this.el.timeIcon.innerHTML = `<circle cx="22" cy="22" r="9" fill="#ffd84a" stroke="#c89018" stroke-width="1.5"/>${rays}`;
    } else if (key === 'night') {
      this.el.timeIcon.innerHTML = `
        <path d="M 28 6 A 15 15 0 1 0 38 28 A 12 12 0 0 1 28 6 Z" fill="#e8ecff" stroke="#8890c0" stroke-width="1.4"/>
        <circle cx="10" cy="12" r="1.5" fill="#fff"/><circle cx="15" cy="6" r="1" fill="#fff"/>`;
    } else {
      this.el.timeIcon.innerHTML = `
        <ellipse cx="18" cy="18" rx="11" ry="8" fill="#aab8c8"/>
        <ellipse cx="28" cy="21" rx="10" ry="7" fill="#92a2b4"/>
        <line x1="16" y1="30" x2="13" y2="37" stroke="#7fb0e0" stroke-width="2.4" stroke-linecap="round"/>
        <line x1="25" y1="31" x2="22" y2="38" stroke="#7fb0e0" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  }

  // ---------- 提示 ----------
  prompt(label) {
    if (!label) {
      this.el.prompt.style.display = 'none';
      return;
    }
    this.el.prompt.innerHTML = `按 <b>E</b> ${label}`;
    this.el.prompt.style.display = 'block';
  }

  // ---------- 对话(打字机) ----------
  say(speaker, text, dur = 4.5) {
    this.dialogState = { speaker, text, shown: 0, holdT: dur, done: false };
    this.el.dialog.style.display = 'block';
    this._renderDialog();
  }

  _renderDialog() {
    const d = this.dialogState;
    if (!d) return;
    const sp = d.speaker ? `<span class="speaker">${d.speaker}</span>` : '';
    this.el.dialog.innerHTML = sp + d.text.slice(0, Math.floor(d.shown));
  }

  update(dt) {
    const d = this.dialogState;
    if (d) {
      if (d.shown < d.text.length) {
        d.shown = Math.min(d.text.length, d.shown + dt * 38);
        this._renderDialog();
      } else {
        d.holdT -= dt;
        if (d.holdT <= 0) {
          this.dialogState = null;
          this.el.dialog.style.display = 'none';
        }
      }
    }
  }

  // ---------- 横幅 ----------
  songBanner(text) {
    const b = this.el.songBanner;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this._songT);
    this._songT = setTimeout(() => b.classList.remove('show'), 2300);
  }

  itemGetBanner(text) {
    const b = this.el.itemBanner;
    b.textContent = text;
    b.style.opacity = 1;
    clearTimeout(this._itemT);
    this._itemT = setTimeout(() => { b.style.opacity = 0; }, 2800);
  }

  // ---------- 闪屏 ----------
  flashWhite(strength = 0.8) {
    const f = this.el.flashWhite;
    f.style.transition = 'none';
    f.style.opacity = strength;
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.7s ease-out';
      f.style.opacity = 0;
    });
  }

  flashRed() {
    const f = this.el.flashRed;
    f.style.transition = 'none';
    f.style.opacity = 1;
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.5s ease-out';
      f.style.opacity = 0;
    });
  }

  // ---------- 陶笛 ----------
  showOcarina(on) {
    this.el.ocarinaUI.style.display = on ? 'flex' : 'none';
    if (on) this.el.staff.innerHTML = '';
  }

  addNote(name) {
    const chip = document.createElement('div');
    chip.className = `note-chip n-${name}`;
    chip.textContent = NOTE_LABEL[name];
    this.el.staff.appendChild(chip);
    while (this.el.staff.children.length > 8) this.el.staff.removeChild(this.el.staff.firstChild);
  }

  // ---------- 画面流程 ----------
  hideTitle() { this.el.title.classList.add('hidden'); }
  gameOver() { this.el.gameover.classList.add('show'); }
  toggleControls() {
    const c = this.el.controls;
    c.style.display = c.style.display === 'block' ? 'none' : 'block';
  }
}
