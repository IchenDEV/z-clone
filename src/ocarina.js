import * as THREE from 'three';

const NOTE_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Space: 'a',
};

export class Ocarina {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.buffer = [];
    this.lockT = 0;

    this.songs = [
      {
        id: 'sun', name: '太阳之歌', notes: ['right', 'down', 'up', 'right', 'down', 'up'],
        effect: () => {
          this.ctx.ui.flashWhite(0.9);
          this.ctx.world.toggleDayNight();
          this.ctx.flags.sunSongUsed = true;
        },
      },
      {
        id: 'lullaby', name: '塞尔达的摇篮曲', notes: ['left', 'up', 'right', 'left', 'up', 'right'],
        effect: () => {
          const p = this.ctx.player;
          p.heal(this.ctx.state.maxHalves);
          this.ctx.effects.sparkle(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xffc8e0, 26);
          this.ctx.audio.heart();
          this.ctx.ui.say('', '温柔的旋律抚平了伤口,体力全满!', 3.5);
        },
      },
      {
        id: 'saria', name: '萨利亚之歌', notes: ['down', 'right', 'left', 'down', 'right', 'left'],
        effect: () => {
          const p = this.ctx.player;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            this.ctx.effects.sparkle(
              p.pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 0.8 + Math.random(), Math.sin(a) * 1.6)),
              0x70e070, 8
            );
          }
          this.ctx.items.naviSay('森林的旋律……总觉得有位绿发的朋友在远方跟着一起哼唱。', null, 5);
        },
      },
      {
        id: 'storms', name: '风暴之歌', notes: ['a', 'down', 'up', 'a', 'down', 'up'],
        effect: () => {
          this.ctx.world.startRain(26);
          this.ctx.ui.say('', '乌云聚拢,雨落了下来……', 3);
        },
      },
      {
        id: 'time', name: '时之歌', notes: ['right', 'a', 'down', 'right', 'a', 'down'],
        effect: () => {
          this.ctx.state.timeSlowT = 10;
          this.ctx.ui.flashWhite(0.4);
          this.ctx.ui.say('', '时间的流速变慢了……(敌人减速 10 秒)', 3.5);
        },
      },
    ];
  }

  update(dt) {
    const { input, player, ui, audio } = this.ctx;
    if (this.lockT > 0) {
      this.lockT -= dt;
      return;
    }

    if (input.wasPressed('KeyO')) {
      if (!this.active && player.setOcarina(true)) {
        this.active = true;
        this.buffer.length = 0;
        ui.showOcarina(true);
        audio.ocarinaNote('a', { dur: 0.18, gain: 0.12 });
        this.ctx.flags.ocarinaUsed = true;
      } else if (this.active) {
        this._exit();
      }
      return;
    }
    if (!this.active) return;
    if (input.wasPressed('Escape')) {
      this._exit();
      return;
    }
    if (player.state !== 'ocarina') {
      // 被打断(受击等)
      this._exit(false);
      return;
    }

    for (const [code, note] of Object.entries(NOTE_KEYS)) {
      if (input.wasPressed(code)) {
        audio.ocarinaNote(note);
        ui.addNote(note);
        player.ocarinaNoteBob();
        this.buffer.push(note);
        if (this.buffer.length > 10) this.buffer.shift();
        this._checkSongs();
        break;
      }
    }
  }

  _checkSongs() {
    for (const song of this.songs) {
      const n = song.notes.length;
      if (this.buffer.length < n) continue;
      const tail = this.buffer.slice(-n);
      if (tail.every((x, i) => x === song.notes[i])) {
        this._playSong(song);
        return;
      }
    }
  }

  _playSong(song) {
    const { ui, audio } = this.ctx;
    this.buffer.length = 0;
    this.lockT = 2.6;
    ui.songBanner(`♪ ${song.name} ♪`);
    setTimeout(() => audio.songCorrect(), 120);
    setTimeout(() => audio.playSongBack(song.notes), 600);
    setTimeout(() => {
      song.effect();
      this._exit(false);
    }, 2450);
  }

  _exit(sound = true) {
    this.active = false;
    this.ctx.player.setOcarina(false);
    this.ctx.ui.showOcarina(false);
  }
}
