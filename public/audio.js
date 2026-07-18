// CP-Pacman audio engine.
//
// All sound is synthesised at runtime with the Web Audio API -- no audio files
// are shipped, so the whole game stays offline-friendly for the booth. Two
// buses (SFX and music) each have an independent volume + mute, persisted to
// localStorage so booth staff settings survive a reload.

const AudioEngine = (() => {
  const STORAGE_KEY = 'cp_pacman_audio_v1';

  let ctx = null;
  let masterGain, sfxBus, musicBus;
  let started = false;

  const settings = {
    sfxVolume: 0.75,
    musicVolume: 0.45,
    sfxMuted: false,
    musicMuted: false,
  };

  // ---- persistence ----------------------------------------------------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---- setup ----------------------------------------------------------

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.connect(masterGain);
    musicBus = ctx.createGain();
    musicBus.connect(masterGain);
    applyVolumes();
  }

  let _duck = 1;                        // music duck factor (lowered during Freiversuch)
  function applyVolumes() {
    if (!ctx) return;
    sfxBus.gain.value = settings.sfxMuted ? 0 : settings.sfxVolume;
    musicBus.gain.value = settings.musicMuted ? 0 : settings.musicVolume * 0.6 * _duck;
  }

  // Must be called from a user gesture to satisfy autoplay policies.
  function unlock() {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
  }

  // ---- low level ------------------------------------------------------

  function blip(bus, { type = 'square', freq = 440, freqEnd = null, dur = 0.12,
    attack = 0.005, gain = 0.3, delay = 0, curve = 'exp' }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(bus, { dur = 0.2, gain = 0.3, delay = 0, hp = 400 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(bus);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // ---- SFX ------------------------------------------------------------

  let chompFlip = false;
  const sfx = {
    chomp() {
      chompFlip = !chompFlip;
      blip(sfxBus, { type: 'square', freq: chompFlip ? 320 : 200, freqEnd: chompFlip ? 160 : 300, dur: 0.06, gain: 0.18 });
    },
    power() {
      // upbeat, high-stakes fanfare when a Freiversuch is grabbed
      const seq = [[392, 0], [523, 0.05], [659, 0.1], [784, 0.16], [988, 0.22], [1319, 0.3]];
      seq.forEach(([f, d]) => blip(sfxBus, { type: 'square', freq: f, dur: 0.13, gain: 0.2, delay: d }));
      blip(sfxBus, { type: 'sawtooth', freq: 130, freqEnd: 62, dur: 0.4, gain: 0.3 });   // sub thump
      blip(sfxBus, { type: 'triangle', freq: 660, freqEnd: 1320, dur: 0.4, gain: 0.12, delay: 0.28 });
    },
    eatGhost() {
      const notes = [330, 440, 550, 660, 880];
      notes.forEach((f, i) => blip(sfxBus, { type: 'square', freq: f, dur: 0.09, gain: 0.22, delay: i * 0.05 }));
    },
    bonus() {
      [523, 659, 784, 1046].forEach((f, i) => blip(sfxBus, { type: 'triangle', freq: f, dur: 0.12, gain: 0.28, delay: i * 0.06 }));
    },
    death() {
      const notes = [660, 620, 560, 500, 440, 380, 300, 220, 150];
      notes.forEach((f, i) => blip(sfxBus, { type: 'sawtooth', freq: f, freqEnd: f * 0.9, dur: 0.13, gain: 0.24, delay: i * 0.11 }));
      noiseBurst(sfxBus, { dur: 0.3, gain: 0.15, delay: notes.length * 0.11, hp: 300 });
    },
    extraLife() {
      [523, 784, 1046, 1318].forEach((f, i) => blip(sfxBus, { type: 'triangle', freq: f, dur: 0.16, gain: 0.3, delay: i * 0.09 }));
    },
    start() {
      const seq = [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36], [784, 0.5], [1046, 0.62]];
      seq.forEach(([f, d]) => blip(sfxBus, { type: 'square', freq: f, dur: 0.14, gain: 0.26, delay: d }));
    },
    boardClear() {
      const seq = [[784, 0], [880, 0.1], [988, 0.2], [1046, 0.3], [1318, 0.42], [1568, 0.56]];
      seq.forEach(([f, d]) => blip(sfxBus, { type: 'triangle', freq: f, dur: 0.16, gain: 0.28, delay: d }));
    },
    menuMove() { blip(sfxBus, { type: 'square', freq: 440, dur: 0.05, gain: 0.15 }); },
    menuSelect() {
      blip(sfxBus, { type: 'square', freq: 523, dur: 0.08, gain: 0.2 });
      blip(sfxBus, { type: 'square', freq: 784, dur: 0.1, gain: 0.2, delay: 0.07 });
    },
    pause() { blip(sfxBus, { type: 'sine', freq: 400, freqEnd: 300, dur: 0.12, gain: 0.2 }); },
    unpause() { blip(sfxBus, { type: 'sine', freq: 300, freqEnd: 460, dur: 0.12, gain: 0.2 }); },
  };

  // ---- music: lookahead sequencer ------------------------------------

  // A cheerful-but-tense chiptune loop. Bass + arpeggio + lead, 16 steps.
  const TEMPO = 132;
  const STEP = (60 / TEMPO) / 2; // eighth notes
  const N = { C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0 };

  const bassPattern = ['A3', null, 'A3', 'E3', 'F3', null, 'F3', 'C3', 'G3', null, 'G3', 'D3', 'A3', null, 'E3', 'E3'];
  const leadPattern = ['A4', 'C5', 'E5', 'C5', 'F4', 'A4', 'C5', 'A4', 'G4', 'B4', 'D5', 'B4', 'A4', 'E5', 'C5', 'E5'];
  const arpPattern = ['A4', 'E4', 'A4', 'E4', 'F4', 'C4', 'F4', 'C4', 'G4', 'D4', 'G4', 'D4', 'A4', 'E4', 'A4', 'E4'];

  let musicTimer = null;
  let nextStepTime = 0;
  let step = 0;
  let musicOn = false;

  function scheduleNote(freq, time, dur, type, gain, bus) {
    if (freq == null) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function scheduler() {
    if (!musicOn) return;
    while (nextStepTime < ctx.currentTime + 0.15) {
      const i = step % 16;
      scheduleNote(N[bassPattern[i]] || null, nextStepTime, STEP * 1.6, 'triangle', 0.5, musicBus);
      scheduleNote(N[arpPattern[i]] || null, nextStepTime, STEP * 0.5, 'square', 0.12, musicBus);
      if (i % 2 === 0) scheduleNote(N[leadPattern[i]] || null, nextStepTime, STEP * 0.9, 'square', 0.16, musicBus);
      // hi-hat-ish tick
      if (i % 2 === 1) noiseBurst(musicBus, { dur: 0.04, gain: 0.05, hp: 6000 });
      nextStepTime += STEP;
      step++;
    }
    musicTimer = setTimeout(scheduler, 25);
  }

  function startMusic() {
    ensure();
    if (musicOn) return;
    musicOn = true;
    step = 0;
    nextStepTime = ctx.currentTime + 0.1;
    scheduler();
  }
  function stopMusic() {
    musicOn = false;
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  }

  // ---- Freiversuch (frightened) tension pulse -------------------------

  let _frightOn = false, _frightAcc = 0;
  function startFright() {
    ensure();
    _frightOn = true; _frightAcc = 999;   // fire immediately
    _duck = 0.4; applyVolumes();
  }
  function endFright() {
    _frightOn = false;
    _duck = 1; applyVolumes();
  }
  // Call every frame while frightened. progress = timeLeft / windowLength (1 -> 0).
  function frightPulse(dt, progress) {
    if (!ctx || !_frightOn) return;
    progress = Math.max(0, Math.min(1, progress));
    const interval = 0.14 + 0.5 * progress;          // 0.64s at start -> 0.14s at the end
    _frightAcc += dt;
    if (_frightAcc >= interval) {
      _frightAcc = 0;
      const urg = 1 - progress;                       // 0 -> 1 as it counts down
      const lo = 180 + urg * 170;
      blip(sfxBus, { type: 'square', freq: lo, freqEnd: lo * 1.5, dur: 0.09, gain: 0.12 + urg * 0.07 });
      if (urg > 0.55) blip(sfxBus, { type: 'square', freq: lo * 2, dur: 0.05, gain: 0.06, delay: 0.05 });
    }
  }

  // ---- public setters -------------------------------------------------

  load();

  return {
    unlock,
    ensureStarted: () => started,
    sfx: new Proxy(sfx, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { if (ctx) t[k](...a); } : t[k]) }),
    startMusic,
    stopMusic,
    startFright,
    endFright,
    frightPulse,
    isMusicOn: () => musicOn,
    getSettings: () => ({ ...settings }),
    setSfxVolume(v) { settings.sfxVolume = Math.max(0, Math.min(1, v)); applyVolumes(); save(); },
    setMusicVolume(v) { settings.musicVolume = Math.max(0, Math.min(1, v)); applyVolumes(); save(); },
    setSfxMuted(m) { settings.sfxMuted = !!m; applyVolumes(); save(); },
    setMusicMuted(m) { settings.musicMuted = !!m; applyVolumes(); save(); },
  };
})();
