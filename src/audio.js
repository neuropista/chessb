/* Modulo SFX: efectos de sonido chiptune sintetizados con Web Audio. Sin assets. */
const SFX = (function () {
  var ctx = null;          // AudioContext perezoso
  var master = null;       // ganancia global
  var muted = false;
  var volume = 0.7;
  var EPS = 0.0001;        // nunca 0 en rampas exponenciales
  var noiseCache = null;   // buffer de ruido reutilizable (2 s)

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function safeDisconnect(node) {
    try { if (node && node.disconnect) node.disconnect(); } catch (e) {}
  }

  // Programa la parada y la limpieza de un nodo fuente y su cadena.
  function endAt(src, when, chain) {
    try { src.stop(when); } catch (e) {}
    src.onended = function () {
      safeDisconnect(src);
      if (chain) {
        for (var i = 0; i < chain.length; i++) safeDisconnect(chain[i]);
      }
    };
  }

  // Envolvente percusiva: ataque corto y caida exponencial.
  function env(param, t0, peak, attack, decay) {
    var p = peak > EPS ? peak : EPS;
    param.setValueAtTime(EPS, t0);
    param.exponentialRampToValueAtTime(p, t0 + (attack > 0 ? attack : 0.001));
    param.exponentialRampToValueAtTime(EPS, t0 + (attack > 0 ? attack : 0.001) + (decay > 0 ? decay : 0.01));
  }

  function makeGain(value) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(value === undefined ? EPS : value, now());
    return g;
  }

  function makeFilter(type, freq, q) {
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, now());
    if (q !== undefined && f.Q) f.Q.setValueAtTime(q, now());
    return f;
  }

  function noiseBuffer() {
    if (noiseCache) return noiseCache;
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseCache = buf;
    return buf;
  }

  // Un tono simple con envolvente y opcionalmente barrido de frecuencia.
  function tone(o) {
    var t0 = o.t;
    var osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined && o.f1 > 0) {
      osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    }
    var g = makeGain();
    env(g.gain, t0, (o.gain === undefined ? 0.5 : o.gain), o.attack === undefined ? 0.006 : o.attack, o.dur);
    var chain = [g];
    var out = g;
    if (o.filter) {
      var f = makeFilter(o.filter, o.cutoff || 1200, o.q);
      g.connect(f);
      f.connect(master);
      chain.push(f);
    } else {
      g.connect(master);
    }
    osc.connect(out);
    endAt(osc, t0 + o.dur + 0.05, chain);
    try { osc.start(t0); } catch (e) {}
    return osc;
  }

  // Ruido filtrado (percusion, choques, silbidos).
  function noise(o) {
    var t0 = o.t;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    if (o.rate !== undefined && src.playbackRate) src.playbackRate.setValueAtTime(o.rate, t0);
    var f = makeFilter(o.filter || 'bandpass', o.cutoff || 1800, o.q === undefined ? 1 : o.q);
    if (o.sweep && o.sweep > 0) {
      f.frequency.exponentialRampToValueAtTime(o.sweep, t0 + o.dur);
    }
    var g = makeGain();
    env(g.gain, t0, o.gain === undefined ? 0.4 : o.gain, o.attack === undefined ? 0.004 : o.attack, o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    endAt(src, t0 + o.dur + 0.05, [f, g]);
    try { src.start(t0); } catch (e) {}
    return src;
  }

  function seq(notes, t0, o) {
    o = o || {};
    for (var i = 0; i < notes.length; i++) {
      tone({
        t: t0 + i * (o.step === undefined ? 0.07 : o.step),
        f0: notes[i],
        type: o.type || 'square',
        gain: o.gain === undefined ? 0.35 : o.gain,
        dur: o.dur === undefined ? 0.12 : o.dur,
        attack: o.attack
      });
    }
  }

  var VOICES = {
    select: function (t) {
      tone({ t: t, f0: 880, f1: 1320, type: 'square', gain: 0.35, dur: 0.09 });
    },
    deny: function (t) {
      tone({ t: t, f0: 320, f1: 110, type: 'square', gain: 0.4, dur: 0.22 });
      tone({ t: t + 0.02, f0: 300, f1: 100, type: 'sawtooth', gain: 0.18, dur: 0.2 });
    },
    move: function (t) {
      noise({ t: t, filter: 'lowpass', cutoff: 900, sweep: 260, q: 1, gain: 0.3, dur: 0.11 });
      tone({ t: t, f0: 150, f1: 90, type: 'triangle', gain: 0.25, dur: 0.1 });
    },
    land: function (t) {
      noise({ t: t, filter: 'lowpass', cutoff: 1600, sweep: 200, q: 1, gain: 0.45, dur: 0.16 });
      tone({ t: t, f0: 190, f1: 60, type: 'square', gain: 0.4, dur: 0.15 });
    },
    clash: function (t) {
      noise({ t: t, filter: 'bandpass', cutoff: 4200, sweep: 2200, q: 4, gain: 0.45, dur: 0.32 });
      tone({ t: t, f0: 2100, f1: 1500, type: 'square', gain: 0.18, dur: 0.3 });
      tone({ t: t + 0.01, f0: 3170, f1: 2300, type: 'square', gain: 0.12, dur: 0.28 });
      tone({ t: t + 0.03, f0: 4700, f1: 3600, type: 'triangle', gain: 0.09, dur: 0.24 });
    },
    slash: function (t) {
      noise({ t: t, filter: 'bandpass', cutoff: 900, sweep: 6000, q: 2.5, gain: 0.35, dur: 0.24, attack: 0.05 });
      noise({ t: t + 0.16, filter: 'highpass', cutoff: 3000, sweep: 1200, q: 1, gain: 0.2, dur: 0.14 });
    },
    magic: function (t) {
      seq([523, 659, 784, 1047, 1319, 1568], t, { type: 'triangle', step: 0.05, dur: 0.16, gain: 0.28 });
      tone({ t: t + 0.3, f0: 2093, f1: 3136, type: 'sine', gain: 0.2, dur: 0.35 });
    },
    stone: function (t) {
      tone({ t: t, f0: 110, f1: 40, type: 'square', gain: 0.5, dur: 0.28 });
      noise({ t: t, filter: 'lowpass', cutoff: 700, sweep: 150, q: 1, gain: 0.4, dur: 0.3 });
      noise({ t: t + 0.06, filter: 'bandpass', cutoff: 2600, sweep: 800, q: 6, gain: 0.16, dur: 0.22 });
    },
    death: function (t) {
      tone({ t: t, f0: 660, f1: 90, type: 'square', gain: 0.35, dur: 0.55 });
      tone({ t: t + 0.05, f0: 500, f1: 70, type: 'triangle', gain: 0.22, dur: 0.5 });
      noise({ t: t + 0.5, filter: 'lowpass', cutoff: 800, sweep: 180, q: 1, gain: 0.3, dur: 0.18 });
    },
    capture: function (t) {
      noise({ t: t, filter: 'lowpass', cutoff: 2400, sweep: 180, q: 1, gain: 0.55, dur: 0.26 });
      tone({ t: t, f0: 260, f1: 55, type: 'square', gain: 0.5, dur: 0.24 });
      tone({ t: t + 0.02, f0: 130, f1: 45, type: 'sawtooth', gain: 0.3, dur: 0.22 });
    },
    check: function (t) {
      var ch = [440, 622, 740];
      for (var i = 0; i < ch.length; i++) {
        tone({ t: t, f0: ch[i], type: 'square', gain: 0.22, dur: 0.45 });
        tone({ t: t + 0.24, f0: ch[i] * 1.05, type: 'square', gain: 0.2, dur: 0.4 });
      }
    },
    castle: function (t) {
      VOICES.stone(t);
      VOICES.stone(t + 0.2);
    },
    promote: function (t) {
      seq([523, 659, 784, 1047], t, { type: 'square', step: 0.08, dur: 0.14, gain: 0.3 });
      tone({ t: t + 0.32, f0: 1047, type: 'triangle', gain: 0.3, dur: 0.4 });
    },
    win: function (t) {
      seq([523, 659, 784, 1047, 1319], t, { type: 'square', step: 0.11, dur: 0.16, gain: 0.32 });
      tone({ t: t + 0.55, f0: 1568, type: 'square', gain: 0.35, dur: 0.5 });
      tone({ t: t + 0.55, f0: 1047, type: 'triangle', gain: 0.25, dur: 0.5 });
    },
    lose: function (t) {
      seq([392, 349, 311, 262], t, { type: 'triangle', step: 0.13, dur: 0.2, gain: 0.3 });
      tone({ t: t + 0.52, f0: 233, f1: 98, type: 'sawtooth', gain: 0.3, dur: 0.55 });
    },
    tick: function (t) {
      tone({ t: t, f0: 1600, type: 'square', gain: 0.18, dur: 0.03, attack: 0.002 });
      noise({ t: t, filter: 'highpass', cutoff: 4000, q: 1, gain: 0.12, dur: 0.03, attack: 0.002 });
    }
  };

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      return ctx;
    }
    try {
      var AC = typeof AudioContext !== 'undefined' ? AudioContext
        : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.setValueAtTime(muted ? EPS : volume, ctx.currentTime);
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function play(name, opts) {
    if (!ctx || !master || muted) return;
    var voice = VOICES[name];
    if (!voice) return;
    try {
      opts = opts || {};
      var t = now() + (opts.delay > 0 ? opts.delay : 0);
      voice(t);
    } catch (e) {
      // nunca propagar errores de audio al juego
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (master) {
      try { master.gain.setValueAtTime(muted ? EPS : (volume > EPS ? volume : EPS), now()); } catch (e) {}
    }
  }

  function isMuted() {
    return muted;
  }

  function setVolume(v) {
    v = typeof v === 'number' && isFinite(v) ? v : 0;
    volume = v < 0 ? 0 : (v > 1 ? 1 : v);
    if (master && !muted) {
      try { master.gain.setValueAtTime(volume > EPS ? volume : EPS, now()); } catch (e) {}
    }
  }

  return {
    init: init,
    play: play,
    setMuted: setMuted,
    isMuted: isMuted,
    setVolume: setVolume
  };
})();
