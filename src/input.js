/** Keyboard + mouse + gamepad + touch, merged into one poll() result. */
export class Input {
  constructor(el) {
    this.keys = new Set();
    this.zoom = 0;
    this.singTap = false;     // a sing press that may already be released by the next poll
    this.pressedEdge = new Set();
    this.dragging = false;
    this.lookX = 0; this.lookY = 0;
    this.mouseSing = false;
    this.touch = { mx: 0, my: 0, jump: false, sing: false, id: null, ox: 0, oy: 0, lookId: null, lx: 0, ly: 0 };
    this.enabled = true;
    this._lastPad = { a: false, start: false };
    this.allowLock = false;
    this.lockedOnce = false;
    const k = (e, down) => {
      if (e.repeat) return;
      const c = e.code;
      if (down) { this.keys.add(c); this.pressedEdge.add(c); if (c === 'KeyE' || c === 'KeyQ' || c === 'KeyF') this.singTap = true; } else this.keys.delete(c);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    };
    window.addEventListener('keydown', (e) => k(e, true));
    window.addEventListener('keyup', (e) => k(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseSing = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 2) { this.mouseSing = true; this.singTap = true; } else this.dragging = true;
      // capture the mouse for free look once the journey has begun
      if (this.allowLock && e.button === 0 && !document.pointerLockElement && el.requestPointerLock) {
        try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* not allowed here */ }
      }
    });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) this.lockedOnce = true; });
    window.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') return; if (e.button === 2) this.mouseSing = false; else this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.dragging || document.pointerLockElement) { this.lookX += e.movementX; this.lookY += e.movementY; }
    });
    this._setupTouch(el);
  }

  _setupTouch(el) {
    if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
    const t = this.touch;
    const mk = (label, side, key) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = `position:fixed;bottom:${side === 'fly' ? 110 : 30}px;right:28px;width:76px;height:76px;border-radius:50%;border:1px solid rgba(255,230,190,.6);color:#ffe9c8;display:flex;align-items:center;justify-content:center;font:12px sans-serif;letter-spacing:.2em;background:rgba(255,200,120,.12);z-index:8;touch-action:none;user-select:none`;
      b.addEventListener('touchstart', (e) => { t[key] = true; if (key === 'sing') this.singTap = true; else this.pressedEdge.add('Space'); e.preventDefault(); }, { passive: false });
      b.addEventListener('touchend', (e) => { t[key] = false; e.preventDefault(); });
      document.body.appendChild(b);
    };
    mk('FLY', 'fly', 'jump'); mk('SING', 'sing', 'sing');
    el.addEventListener('touchstart', (e) => {
      for (const c of e.changedTouches) {
        if (c.clientX < innerWidth * 0.45 && t.id === null) { t.id = c.identifier; t.ox = c.clientX; t.oy = c.clientY; }
        else if (t.lookId === null) { t.lookId = c.identifier; t.lx = c.clientX; t.ly = c.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const c of e.changedTouches) {
        if (c.identifier === t.id) { t.mx = Math.max(-1, Math.min(1, (c.clientX - t.ox) / 55)); t.my = Math.max(-1, Math.min(1, -(c.clientY - t.oy) / 55)); }
        else if (c.identifier === t.lookId) { this.lookX += (c.clientX - t.lx) * 1.2; this.lookY += (c.clientY - t.ly) * 1.2; t.lx = c.clientX; t.ly = c.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const c of e.changedTouches) {
        if (c.identifier === t.id) { t.id = null; t.mx = t.my = 0; }
        if (c.identifier === t.lookId) t.lookId = null;
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }

  anyKeyPressed() { return this.pressedEdge.size > 0; }

  poll() {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let jump = k.has('Space');
    let sing = k.has('KeyE') || k.has('KeyQ') || k.has('KeyF') || this.mouseSing || this.singTap;
    this.singTap = false;
    let lookX = this.lookX, lookY = this.lookY;
    this.lookX = this.lookY = 0;
    mx += this.touch.mx; my += this.touch.my; jump ||= this.touch.jump; sing ||= this.touch.sing;
    let padStart = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(p.axes[0] || 0); my += -dz(p.axes[1] || 0);
      lookX += dz(p.axes[2] || 0) * 14; lookY += dz(p.axes[3] || 0) * 10;
      jump ||= !!(p.buttons[0] && p.buttons[0].pressed) || !!(p.buttons[7] && p.buttons[7].pressed);
      sing ||= !!(p.buttons[2] && p.buttons[2].pressed) || !!(p.buttons[1] && p.buttons[1].pressed) || !!(p.buttons[6] && p.buttons[6].pressed);
      const st = !!(p.buttons[9] && p.buttons[9].pressed);
      padStart = st && !this._lastPad.start; this._lastPad.start = st;
      break;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const anyKey = this.pressedEdge.size > 0;
    const jumpPressed = this.pressedEdge.has('Space') || (jump && !this._lastPad.a);
    this._lastPad.a = jump;
    const pausePressed = this.pressedEdge.has('Escape') || this.pressedEdge.has('KeyP') || padStart;
    const zoom = this.zoom; this.zoom = 0;
    this.pressedEdge.clear();
    return { mx, my, jump, jumpPressed, sing, lookX, lookY, anyKey, pausePressed, zoom };
  }
}
