// 键盘 / 鼠标输入管理:down = 持续按住, pressed = 本帧刚按下
export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.wheelDelta = 0;

    window.addEventListener('keydown', (e) => {
      // 防止方向键/空格/Tab 滚动页面或切换焦点
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button <= 2) { this.mouseDown[e.button] = true; this.mousePressed[e.button] = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.mouseDown[e.button] = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheelDelta += e.deltaY; e.preventDefault(); }, { passive: false });
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  // 每帧结束时调用,清掉"刚按下"状态
  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false];
    this.wheelDelta = 0;
  }
}
