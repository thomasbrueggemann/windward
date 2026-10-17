// Fully procedural score and sound design (Web Audio). Nothing is sampled; everything is synthesised.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

// chapter moods: root MIDI note + chord offsets + filter brightness
const MOODS = [
  { root: 38, chord: [0, 7, 12, 19], cut: 900 },    // dunes: open fifths, D
  { root: 34, chord: [0, 7, 12, 16], cut: 1200 },   // ruins: warm major, Bb
  { root: 31, chord: [0, 7, 12, 15], cut: 600 },    // depths: dark minor, G
  { root: 38, chord: [0, 7, 14, 19], cut: 800 },    // snow: suspended, D
  { root: 38, chord: [0, 12, 19, 24], cut: 2400 },  // summit: radiant
];
// scale degrees of D dorian (relative to D)
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14];
const PHRASES = [
  [[4, 2.4], [2, 1.2], [3, 1.2], [1, 3.6]],
  [[0, 2.4], [2, 2.4], [4, 4.0]],
  [[4, 1.6], [5, 0.8], [4, 1.2], [2, 1.2], [0, 4.0]],
  [[7, 3.2], [4, 1.2], [5, 1.2], [4, 3.6]],
  [[2, 1.6], [4, 1.6], [7, 3.0], [5, 1.6], [4, 3.2]],
];

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.mood = 0; this.moodPos = 0; this.intensity = 0.3; this._nextNote = 0; this._rechargeT = 0; this.singNodes = null; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const out = ctx.createGain(); out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = 0.02; comp.release.value = 0.35;
    out.connect(comp); comp.connect(ctx.destination);
    this.master = out;
    out.gain.linearRampToValueAtTime(this.volume ?? 0.85, ctx.currentTime + 5);

    // reverb
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(4.4, 2.4);
    const vOut = ctx.createGain(); vOut.gain.value = 0.7;
    this.verb.connect(vOut); vOut.connect(out);
    this.dry = ctx.createGain(); this.dry.connect(out);
    const bus = (dry, wet) => {
      const g = ctx.createGain(); const d = ctx.createGain(), w = ctx.createGain();
      d.gain.value = dry; w.gain.value = wet; g.connect(d); g.connect(w); d.connect(this.dry); w.connect(this.verb); return g;
    };
    this.musicBus = bus(0.8, 0.9);
    this.sfxBus = bus(0.9, 0.55);
    this.ambBus = bus(1.0, 0.1);

    // shared noise
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = nb.getChannelData(0); let b0 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.98 * b0 + 0.02 * w; d[i] = (w * 0.5 + b0 * 6); }
    this.noiseBuf = nb;

    this._buildPad();
    this._buildAmbience();
    this.ready = true;
    this._nextNote = ctx.currentTime + 4;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.3 * t);
        d[i] = lp * Math.pow(1 - t, decay) * 2.2;
      }
    }
    return buf;
  }

  _noiseSrc(loop = true) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop;
    s.loopStart = Math.random() * 1.5; return s;
  }

  _buildPad() {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.4;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    this.padGain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 6);
    this.padFilter.connect(this.padGain); this.padGain.connect(this.musicBus);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(this.padFilter.frequency); lfo.start();
    this.padVoices = [];
    const m = MOODS[0];
    m.chord.forEach((off, i) => {
      const f = mtof(m.root + off);
      const voice = [];
      for (const [type, det, g] of [['sawtooth', -7, 0.25], ['sawtooth', 7, 0.25], ['sine', 0, 0.5]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
        const gg = ctx.createGain(); gg.gain.value = g * (i === 3 ? 0.55 : 1);
        o.connect(gg); gg.connect(this.padFilter); o.start(); voice.push(o);
      }
      this.padVoices.push(voice);
    });
    // high airy strings that bloom with intensity
    this.stringGain = ctx.createGain(); this.stringGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400;
    sf.connect(this.stringGain); this.stringGain.connect(this.musicBus);
    this.stringVoices = [];
    [0, 7, 12, 16].forEach((off) => {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(MOODS[0].root + 24 + off); o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(sf); o.start(); this.stringVoices.push(o);
      }
    });
  }

  _buildAmbience() {
    const ctx = this.ctx;
    // wind
    this.windSrc = this._noiseSrc();
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
    this.windFilter = wf;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    this.windSrc.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.ambBus); this.windSrc.start();
    const wl = ctx.createOscillator(); wl.frequency.value = 0.11; const wlg = ctx.createGain(); wlg.gain.value = 160; wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
    // sand hiss while surfing
    this.sandSrc = this._noiseSrc();
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2200; sf.Q.value = 0.5;
    this.sandFilter = sf;
    this.sandGain = ctx.createGain(); this.sandGain.gain.value = 0;
    this.sandSrc.connect(sf); sf.connect(this.sandGain); this.sandGain.connect(this.ambBus); this.sandSrc.start();
    // air rush while flying
    this.airSrc = this._noiseSrc();
    const af = ctx.createBiquadFilter(); af.type = 'highpass'; af.frequency.value = 1800; af.Q.value = 0.4;
    this.airGain = ctx.createGain(); this.airGain.gain.value = 0;
    this.airSrc.connect(af); af.connect(this.airGain); this.airGain.connect(this.ambBus); this.airSrc.start();
    // flight modes: a dive whoosh that climbs in pitch with speed, a soft broad wind for gliding, a whistling column
    const loop = (type, freq, q) => {
      const src = this._noiseSrc(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.ambBus); src.start();
      return { f, g };
    };
    this.diveN = loop('bandpass', 500, 1.1);
    this.glideN = loop('lowpass', 520, 0.5);
    this.soarN = loop('bandpass', 700, 6);
    const sl = ctx.createOscillator(); sl.frequency.value = 0.35; const slg = ctx.createGain(); slg.gain.value = 180; sl.connect(slg); slg.connect(this.soarN.f.frequency); sl.start();
    // guardian rumble
    this.rumbleOsc = ctx.createOscillator(); this.rumbleOsc.type = 'sawtooth'; this.rumbleOsc.frequency.value = 41;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    const trem = ctx.createOscillator(); trem.frequency.value = 5.5; const tg = ctx.createGain(); tg.gain.value = 0.35;
    trem.connect(tg); tg.connect(this.rumbleGain.gain); trem.start();
    this.rumbleOsc.connect(rf); rf.connect(this.rumbleGain); this.rumbleGain.connect(this.ambBus); this.rumbleOsc.start();
  }

  // -------------------------------------------------------------------- per-frame
  update(dt, s) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // chapter mood from progress
    const p = s.progress;
    const mood = p < 0.30 ? 0 : p < 0.50 ? 1 : p < 0.75 ? 2 : p < 0.985 ? 3 : 4;
    if (mood !== this.mood || !this._moodSet) { this._setMood(mood); this._moodSet = true; }
    this.intensity += (s.intensity - this.intensity) * (1 - Math.exp(-0.5 * dt));
    this.stringGain.gain.setTargetAtTime(0.0 + this.intensity * 0.22 + (mood === 4 ? 0.15 : 0), t, 1.5);
    this.windGain.gain.setTargetAtTime(0.05 + s.snow * 0.5 + Math.min(0.2, s.speed * 0.01), t, 0.6);
    this.windFilter.frequency.setTargetAtTime(380 + s.snow * 500, t, 1);
    this.sandGain.gain.setTargetAtTime(s.surfing ? Math.min(0.28, s.speed * 0.012) : 0, t, 0.15);
    this.sandFilter.frequency.setTargetAtTime(1400 + s.speed * 60, t, 0.2);
    this.airGain.gain.setTargetAtTime(s.flying ? 0.09 : 0, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(Math.min(0.22, s.guardian * 0.22), t, 0.3);
    // flight modes (all optional in the state, default silent)
    const dive = s.dive || 0, glide = s.glide || 0, soar = s.soar || 0;
    const rush = Math.min(1, Math.max(0, (s.airSpeed || 0) - 8) / 32);
    this.diveN.g.gain.setTargetAtTime(dive * (0.04 + 0.22 * rush), t, 0.12);
    this.diveN.f.frequency.setTargetAtTime(380 + 2600 * rush * rush * dive, t, 0.15);
    this.glideN.g.gain.setTargetAtTime(glide * (0.07 + 0.05 * Math.min(1, (s.speed || 0) / 20)), t, 0.4);
    this.glideN.f.frequency.setTargetAtTime(420 + 25 * (s.speed || 0), t, 0.5);
    this.soarN.g.gain.setTargetAtTime(soar * 0.11, t, 0.5);
    this.soarN.f.frequency.setTargetAtTime(650 + 500 * soar, t, 1.5);
    this.rumbleOsc.frequency.setTargetAtTime(38 + s.guardian * 14, t, 0.3);

    // singing voice follows the held button
    if (s.singing && !this.singNodes) this._singStart();
    if (this.singNodes) {
      const g = this.singNodes.gain.gain;
      g.setTargetAtTime(s.singing ? 0.16 * (0.4 + 0.6 * s.sing) : 0, t, s.singing ? 0.12 : 0.35);
      this.singNodes.vib.gain.setTargetAtTime(s.singing ? 4 + 8 * s.sing : 0, t, 0.3);
      if (!s.singing && s.sing < 0.03) { this._singStop(); }
    }

    // melody
    if (t > this._nextNote) this._playPhrase(t);
  }

  _setMood(i) {
    this.mood = i;
    const t = this.ctx.currentTime, m = MOODS[i];
    this.padVoices.forEach((voice, k) => voice.forEach((o) => o.frequency.setTargetAtTime(mtof(m.root + m.chord[k]), t, 3.5)));
    this.padFilter.frequency.setTargetAtTime(m.cut, t, 3);
    for (let i = 0; i < 4; i++) for (let d = 0; d < 2; d++) this.stringVoices[i * 2 + d].frequency.setTargetAtTime(mtof(m.root + 24 + m.chord[i]), t, 3.5);
  }

  _playPhrase(t0) {
    const m = MOODS[this.mood];
    const ph = PHRASES[(Math.random() * PHRASES.length) | 0];
    let t = t0 + 0.1;
    const keyShift = m.root - 38;
    for (const [deg, beats] of ph) {
      const midi = 50 + keyShift + DORIAN[deg % DORIAN.length];
      this._cello(midi, t, beats * 0.95, 0.5 + this.intensity * 0.5);
      if (this.intensity > 0.55 && Math.random() < 0.6) this._cello(midi + 12, t + 0.05, beats * 0.9, 0.25);
      t += beats;
    }
    this._nextNote = t + rand(2.5, 6.5) * (1.3 - this.intensity * 0.6);
  }

  _cello(midi, t, dur, vel) {
    const ctx = this.ctx, f = mtof(midi);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'sawtooth'; o1.frequency.value = o2.frequency.value = f; o1.detune.value = -5; o2.detune.value = 5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(8, t + 0.9);
    lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(900 + 1800 * vel, t + 0.5); lp.frequency.linearRampToValueAtTime(700, t + dur);
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 260; body.gain.value = 5; body.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.28); g.gain.setTargetAtTime(0.1 * vel, t + 0.3, 0.6);
    g.gain.setTargetAtTime(0, t + dur, 0.5);
    o1.connect(lp); o2.connect(lp); lp.connect(body); body.connect(g); g.connect(this.musicBus);
    o1.start(t); o2.start(t); lfo.start(t);
    const end = t + dur + 3;
    o1.stop(end); o2.stop(end); lfo.stop(end);
  }

  // -------------------------------------------------------------------- the traveler's voice
  _singStart() {
    const ctx = this.ctx, t = ctx.currentTime;
    const scale = [62, 64, 67, 69, 71, 74, 76];
    const midi = scale[(Math.random() * scale.length) | 0] + (this.mood === 2 ? -5 : 0);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi) * 2.005;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.4;
    const vg = ctx.createGain(); vg.gain.value = 0; vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(); o2.start(); vib.start();
    this.singNodes = { o, o2, vib: vg, vibOsc: vib, gain: g, midi };
    this.onSingPitch && this.onSingPitch(midi);
  }
  _singStop() {
    const n = this.singNodes; if (!n) return; this.singNodes = null;
    const t = this.ctx.currentTime + 1.2;
    n.o.stop(t); n.o2.stop(t); n.vibOsc.stop(t);
  }

  // -------------------------------------------------------------------- one-shots
  _bell(midi, t, vol = 0.12, dur = 2.5, bus = this.sfxBus) {
    const ctx = this.ctx;
    for (const [mult, v, d] of [[1, 1, 1], [2.01, 0.35, 0.6], [3.98, 0.15, 0.35]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi) * mult;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * d);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur * d + 0.1);
    }
  }
  _noiseBurst(t, dur, freq, q, vol, type = 'bandpass', bus = this.sfxBus) {
    const ctx = this.ctx;
    const s = this._noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.05);
  }

  glyph(n) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const base = 74 + (this.mood === 2 ? -5 : 0);
    [0, 7, 12, 16, 19].forEach((o, i) => this._bell(base + o, t + i * 0.09, 0.1, 3));
    this.intensity = Math.min(1, this.intensity + 0.1);
  }
  awaken() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16].forEach((o, i) => this._bell(62 + o, t + i * 0.14, 0.09, 4));
    this._noiseBurst(t, 1.6, 900, 0.8, 0.05);
    this.intensity = Math.min(1, this.intensity + 0.15);
  }
  recharge() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    if (t < this._rechargeT) return; this._rechargeT = t + 0.22;
    const pent = [74, 76, 79, 81, 83, 86];
    this._bell(pent[(Math.random() * pent.length) | 0], t, 0.05, 1.4);
  }
  step() { if (!this.ready) return; const t = this.ctx.currentTime; this._noiseBurst(t, 0.09, rand(500, 800), 0.7, 0.05, 'lowpass'); }
  jump() { if (!this.ready) return; const t = this.ctx.currentTime; this._noiseBurst(t, 0.25, 1500, 0.8, 0.05); }
  land(impact) { if (!this.ready) return; const t = this.ctx.currentTime; this._noiseBurst(t, 0.25, 400, 0.7, Math.min(0.14, 0.03 * impact), 'lowpass'); }
  /** A cloth flap: soft and low for a glide, brisk for a flutter beat. */
  flap(soft = false) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    this._noiseBurst(t, soft ? 0.32 : 0.16, soft ? rand(260, 380) : rand(600, 850), 0.9, soft ? 0.035 : 0.03, 'lowpass');
  }
  /** Pulling out of a dive: a falling-then-rising whoosh. */
  swoop(strength = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = this._noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.35); f.frequency.exponentialRampToValueAtTime(1300, t + 1.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * Math.min(1.3, strength), t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 1.4);
  }
  /** A ribbon boost: a rising run of bells and a bright rush. */
  ribbon() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const base = 74 + (this.mood === 2 ? -5 : 0);
    [0, 2, 4, 7, 9, 12].forEach((o, i) => this._bell(base + o, t + i * 0.045, 0.05, 1.6));
    this._noiseBurst(t, 0.7, 2600, 0.6, 0.05);
  }
  /** Caught by an updraft. */
  liftoff() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    [62, 69, 74].forEach((m, i) => this._bell(m + (this.mood === 2 ? -5 : 0), t + i * 0.12, 0.04, 3));
    this._noiseBurst(t, 1.2, 900, 0.5, 0.06);
  }
  guardianAlert() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [110, 116.5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 1.8);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(lp); lp.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 2);
    }
  }
  guardianHit() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    this._noiseBurst(t, 0.9, 700, 0.6, 0.22);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 1.5);
    this.intensity = Math.max(0.1, this.intensity - 0.4);
  }
  vision() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const root = 50 + (this.mood === 2 ? -5 : 0);
    [0, 7, 12, 16, 19, 24].forEach((o, i) => {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = mtof(root + o);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(2200, t + 4); f.frequency.linearRampToValueAtTime(500, t + 10);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 3 + i * 0.2); g.gain.linearRampToValueAtTime(0, t + 10);
      osc.connect(f); f.connect(g); g.connect(this.musicBus); osc.start(t); osc.stop(t + 10.5);
    });
    this.intensity = 0.85;
  }
  ending() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    [0, 7, 12, 16, 19, 24, 28].forEach((o, i) => this._bell(62 + o, t + i * 0.35, 0.08, 7));
    this.intensity = 1;
  }
  /** A short sung note from another traveler. pan -1..1, dist in metres; big = the long call after a held song. */
  chirp(pan = 0, dist = 5, big = false) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const scale = [69, 71, 74, 76, 79, 81];
    const midi = scale[(Math.random() * scale.length) | 0] + (this.mood === 2 ? -5 : 0);
    const dur = big ? 1.6 : 0.55;
    const vol = (big ? 0.42 : 0.32) / (1 + dist * 0.045);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(mtof(midi) * 0.94, t); o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.08);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi) * 2.004;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.8; const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(big ? 14 : 6, t + dur * 0.6);
    vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.04); g.gain.setTargetAtTime(vol * 0.7, t + 0.1, 0.2); g.gain.setTargetAtTime(0, t + dur, 0.18);
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
    if (pn) { pn.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(pn); pn.connect(this.sfxBus); } else g.connect(this.sfxBus);
    o.start(t); o2.start(t); vib.start(t);
    const end = t + dur + 1.2; o.stop(end); o2.stop(end); vib.stop(end);
  }
  /** Released after a long held song: a bright chord that rings out. */
  shout() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const base = 69 + (this.mood === 2 ? -5 : 0);
    [0, 7, 12, 16, 24].forEach((o, i) => this._bell(base + o, t + i * 0.03, 0.07, 3.2));
    this._noiseBurst(t, 0.9, 2400, 0.7, 0.03);
  }
  /** Several voices together (a traveler joins, or the group's song parts the storm): a chord, one voice per traveler. */
  chorus(n = 1) {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const base = 66 + (this.mood === 2 ? -5 : 0);
    const notes = [0, 7, 12, 16, 19, 24, 28].slice(0, Math.min(7, 2 + n));
    notes.forEach((o, i) => this._bell(base + o, t + i * 0.16, 0.075, 4.5));
    this.intensity = Math.min(1, this.intensity + 0.1);
  }
  gust(strength = 1) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = this._noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1100, t + 1.2); f.frequency.linearRampToValueAtTime(400, t + 3.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * strength, t + 0.9); g.gain.linearRampToValueAtTime(0, t + 3.4);
    s.connect(f); f.connect(g); g.connect(this.ambBus); s.start(t); s.stop(t + 3.5);
  }
  /** The wind gathering before a gust in the wind gauntlet: a rising, hollow whistle over a swelling roar. */
  gustWarn() {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(980, t + 1.9);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.05, t + 1.2); og.gain.linearRampToValueAtTime(0, t + 2.1);
    o.connect(og); og.connect(this.sfxBus); o.start(t); o.stop(t + 2.2);
    const s = this._noiseSrc(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(900, t + 2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 1.9); g.gain.linearRampToValueAtTime(0.05, t + 2.3);
    s.connect(f); f.connect(g); g.connect(this.ambBus); s.start(t); s.stop(t + 2.4);
  }
  chapter() {
    if (!this.ready) return; const t = this.ctx.currentTime;
    const base = 50 + (this.mood === 2 ? -5 : 0);
    [0, 7, 12, 19].forEach((o, i) => this._bell(base + o, t + i * 0.6, 0.06, 6));
  }
  setVolume(v) { this.volume = v; if (this.ready) this.master.gain.setTargetAtTime(this._ducked ? v * 0.3 : v, this.ctx.currentTime, 0.2); }
  duck(on) { this._ducked = on; if (this.ready) this.master.gain.setTargetAtTime((this.volume ?? 0.85) * (on ? 0.3 : 1), this.ctx.currentTime, 0.25); }
  fadeOut(sec = 6) { if (!this.ready) return; const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(0, t, sec / 4); }
  fadeIn(sec = 4) { if (!this.ready) return; const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(this.volume ?? 0.85, t, sec / 4); }
}
