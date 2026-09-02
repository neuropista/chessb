/* Modulo SFX: efectos de sonido chiptune sintetizados con Web Audio. Sin assets.

   Cadena de salida:  voz -> [panner] -> master -> compresor -> destino
                      voz -> envio de reverb -> convolver (IR sintetizada) -> compresor
   Cada voz puede pedir reverb (verb 0..1), paneo (pan -1..1) y tono (pitch). */
const SFX = (function () {
  var ctx = null;          // AudioContext perezoso
  var master = null;       // ganancia global
  var comp = null;         // compresor: muchas voces a la vez no saturan
  var verbIn = null;       // bus de envio a la reverb
  var muted = false;
  var volume = 0.7;
  var EPS = 0.0001;        // nunca 0 en rampas exponenciales
  var noiseCache = null;   // buffer de ruido reutilizable (2 s)

  /* Estado de la voz en curso: lo fijan play() y lo leen tone()/noise(). */
  var curPan = 0;
  var curPitch = 1;

  /* Antimetralleta: la misma voz no se repite antes de este hueco (s). */
  var lastAt = Object.create(null);
  var MIN_GAP = { magic: 0.07, zap: 0.06, clash: 0.05, sparkle: 0.05, gallop: 0.25, whoosh: 0.06 };
  var DEFAULT_GAP = 0.03;

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

  /* Respuesta al impulso sintetica: ruido con caida exponencial, un poco mas
     larga en el canal derecho para que la cola se abra en estereo. */
  function reverbImpulse(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var k = ch ? 3.6 : 4.0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, k) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  /* Conecta la salida de una voz: paneo opcional, master y envio a reverb. */
  function out(node, verb, chain) {
    var last = node;
    if (curPan && typeof ctx.createStereoPanner === 'function') {
      var pn = ctx.createStereoPanner();
      var pv = curPan < -1 ? -1 : (curPan > 1 ? 1 : curPan);
      try { pn.pan.setValueAtTime(pv, now()); } catch (e) {}
      node.connect(pn);
      last = pn;
      chain.push(pn);
    }
    last.connect(master);
    if (verb > 0 && verbIn) {
      var send = makeGain(verb);
      last.connect(send);
      send.connect(verbIn);
      chain.push(send);
    }
  }

  // Un tono simple con envolvente y opcionalmente barrido de frecuencia.
  function tone(o) {
    var t0 = o.t;
    var pitch = curPitch * (o.pitch || 1);
    var osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0 * pitch, t0);
    if (o.f1 !== undefined && o.f1 > 0) {
      osc.frequency.exponentialRampToValueAtTime(o.f1 * pitch, t0 + o.dur);
    }
    if (o.detune && osc.detune) { try { osc.detune.setValueAtTime(o.detune, t0); } catch (e) {} }
    var g = makeGain();
    env(g.gain, t0, (o.gain === undefined ? 0.5 : o.gain), o.attack === undefined ? 0.006 : o.attack, o.dur);
    var chain = [g];
    var head = g;
    if (o.filter) {
      var f = makeFilter(o.filter, (o.cutoff || 1200), o.q);
      if (o.cutoff2 > 0) f.frequency.exponentialRampToValueAtTime(o.cutoff2, t0 + o.dur);
      g.connect(f);
      head = f;
      chain.push(f);
    }
    out(head, o.verb || 0, chain);
    osc.connect(g);
    endAt(osc, t0 + o.dur + 0.05, chain);
    try { osc.start(t0); } catch (e) {}
    return osc;
  }

  // Ruido filtrado (percusion, choques, silbidos).
  function noise(o) {
    var t0 = o.t;
    var pitch = curPitch * (o.pitch || 1);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    if (o.rate !== undefined && src.playbackRate) src.playbackRate.setValueAtTime(o.rate, t0);
    var f = makeFilter(o.filter || 'bandpass', (o.cutoff || 1800) * pitch, o.q === undefined ? 1 : o.q);
    if (o.sweep && o.sweep > 0) {
      f.frequency.exponentialRampToValueAtTime(o.sweep * pitch, t0 + o.dur);
    }
    var g = makeGain();
    env(g.gain, t0, o.gain === undefined ? 0.4 : o.gain, o.attack === undefined ? 0.004 : o.attack, o.dur);
    src.connect(f);
    f.connect(g);
    out(g, o.verb || 0, [f, g]);
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
        attack: o.attack,
        verb: o.verb || 0
      });
    }
  }

  /* Golpe metalico: parciales inarmonicos como los de una campana o una hoja. */
  function metal(t, base, gain, dur, verb) {
    var ratios = [1, 2.0, 2.76, 5.4, 8.9];
    for (var i = 0; i < ratios.length; i++) {
      tone({
        t: t + i * 0.004, f0: base * ratios[i], f1: base * ratios[i] * 0.94,
        type: i < 2 ? 'square' : 'sine', gain: gain / (1 + i * 0.9), dur: dur * (1 - i * 0.12),
        verb: verb
      });
    }
  }

  var VOICES = {
    /* ------------------------------ interfaz ------------------------------ */
    select: function (t) {
      tone({ t: t, f0: 880, f1: 1320, type: 'square', gain: 0.30, dur: 0.09 });
      tone({ t: t + 0.03, f0: 1760, type: 'sine', gain: 0.12, dur: 0.08 });
    },
    deny: function (t) {
      tone({ t: t, f0: 320, f1: 110, type: 'square', gain: 0.4, dur: 0.22 });
      tone({ t: t + 0.02, f0: 300, f1: 100, type: 'sawtooth', gain: 0.18, dur: 0.2 });
    },
    tick: function (t) {
      tone({ t: t, f0: 1600, type: 'square', gain: 0.18, dur: 0.03, attack: 0.002 });
      noise({ t: t, filter: 'highpass', cutoff: 4000, q: 1, gain: 0.12, dur: 0.03, attack: 0.002 });
    },
    swoosh: function (t) {              // cambiar de vista o de camara
      noise({ t: t, filter: 'bandpass', cutoff: 600, sweep: 2600, q: 1.2, gain: 0.28, dur: 0.26, attack: 0.06, verb: 0.3 });
      tone({ t: t, f0: 520, f1: 260, type: 'sine', gain: 0.18, dur: 0.24, attack: 0.03 });
    },
    undo: function (t) {                // rebobinar
      tone({ t: t, f0: 700, f1: 520, type: 'square', gain: 0.22, dur: 0.07 });
      tone({ t: t + 0.09, f0: 520, f1: 380, type: 'square', gain: 0.22, dur: 0.09 });
      noise({ t: t, filter: 'bandpass', cutoff: 2400, sweep: 500, q: 2, gain: 0.14, dur: 0.18 });
    },
    horn: function (t) {                // cuerno de guerra: nueva partida
      tone({ t: t, f0: 196, type: 'sawtooth', gain: 0.30, dur: 0.62, attack: 0.05, filter: 'lowpass', cutoff: 700, cutoff2: 2400, verb: 0.5 });
      tone({ t: t, f0: 294, type: 'sawtooth', gain: 0.18, dur: 0.60, attack: 0.05, filter: 'lowpass', cutoff: 900, cutoff2: 2600, detune: 8, verb: 0.5 });
      tone({ t: t + 0.30, f0: 392, type: 'square', gain: 0.16, dur: 0.34, attack: 0.02, verb: 0.5 });
    },

    /* ---------------------------- movimiento ------------------------------ */
    move: function (t) {                // dos pasos, no un golpe
      noise({ t: t, filter: 'lowpass', cutoff: 900, sweep: 260, q: 1, gain: 0.26, dur: 0.09 });
      tone({ t: t, f0: 150, f1: 90, type: 'triangle', gain: 0.22, dur: 0.08 });
      noise({ t: t + 0.11, filter: 'lowpass', cutoff: 760, sweep: 220, q: 1, gain: 0.22, dur: 0.09 });
      tone({ t: t + 0.11, f0: 130, f1: 80, type: 'triangle', gain: 0.18, dur: 0.08 });
    },
    land: function (t) {
      noise({ t: t, filter: 'lowpass', cutoff: 1600, sweep: 200, q: 1, gain: 0.45, dur: 0.16, verb: 0.15 });
      tone({ t: t, f0: 190, f1: 60, type: 'square', gain: 0.4, dur: 0.15 });
      noise({ t: t + 0.03, filter: 'highpass', cutoff: 3500, q: 1, gain: 0.08, dur: 0.16 });   // polvo
    },
    castle: function (t) {
      VOICES.stone(t);
      VOICES.stone(t + 0.2);
    },

    /* ------------------------------ combate ------------------------------- */
    clash: function (t) {               // acero contra acero
      noise({ t: t, filter: 'bandpass', cutoff: 4200, sweep: 2200, q: 4, gain: 0.42, dur: 0.30, verb: 0.35 });
      metal(t, 700, 0.20, 0.34, 0.4);
      tone({ t: t, f0: 90, f1: 40, type: 'sine', gain: 0.35, dur: 0.12 });   // pegada
    },
    slash: function (t) {
      noise({ t: t, filter: 'bandpass', cutoff: 900, sweep: 6000, q: 2.5, gain: 0.35, dur: 0.24, attack: 0.05 });
      noise({ t: t + 0.16, filter: 'highpass', cutoff: 3000, sweep: 1200, q: 1, gain: 0.2, dur: 0.14 });
    },
    whoosh: function (t) {              // el arma corta el aire
      noise({ t: t, filter: 'bandpass', cutoff: 380, sweep: 3200, q: 1.6, gain: 0.34, dur: 0.20, attack: 0.03 });
      tone({ t: t, f0: 240, f1: 620, type: 'sine', gain: 0.10, dur: 0.16, attack: 0.02 });
    },
    magic: function (t) {
      seq([523, 659, 784, 1047, 1319, 1568], t, { type: 'triangle', step: 0.05, dur: 0.16, gain: 0.26, verb: 0.4 });
      tone({ t: t + 0.3, f0: 2093, f1: 3136, type: 'sine', gain: 0.18, dur: 0.35, verb: 0.5 });
    },
    stone: function (t) {
      tone({ t: t, f0: 110, f1: 40, type: 'square', gain: 0.5, dur: 0.28, verb: 0.2 });
      tone({ t: t, f0: 55, f1: 30, type: 'sine', gain: 0.45, dur: 0.30 });            // subgrave
      noise({ t: t, filter: 'lowpass', cutoff: 700, sweep: 150, q: 1, gain: 0.4, dur: 0.3, verb: 0.3 });
      noise({ t: t + 0.06, filter: 'bandpass', cutoff: 2600, sweep: 800, q: 6, gain: 0.16, dur: 0.22 });
    },
    death: function (t) {
      tone({ t: t, f0: 660, f1: 90, type: 'square', gain: 0.35, dur: 0.55, verb: 0.3 });
      tone({ t: t + 0.05, f0: 500, f1: 70, type: 'triangle', gain: 0.22, dur: 0.5 });
      noise({ t: t + 0.5, filter: 'lowpass', cutoff: 800, sweep: 180, q: 1, gain: 0.3, dur: 0.18, verb: 0.3 });
    },
    capture: function (t) {
      noise({ t: t, filter: 'lowpass', cutoff: 2400, sweep: 180, q: 1, gain: 0.55, dur: 0.26, verb: 0.25 });
      tone({ t: t, f0: 260, f1: 55, type: 'square', gain: 0.5, dur: 0.24 });
      tone({ t: t + 0.02, f0: 130, f1: 45, type: 'sawtooth', gain: 0.3, dur: 0.22 });
      tone({ t: t, f0: 80, f1: 32, type: 'sine', gain: 0.5, dur: 0.28 });             // punetazo grave
    },

    /* ------------------------- poderes de cada pieza ---------------------- */
    charge: function (t) {              // el atacante se carga de energia (pitch por pieza)
      tone({ t: t, f0: 180, f1: 900, type: 'triangle', gain: 0.22, dur: 0.46, attack: 0.08, verb: 0.35 });
      tone({ t: t, f0: 182, f1: 912, type: 'triangle', gain: 0.16, dur: 0.46, attack: 0.08, detune: 12, verb: 0.35 });
      noise({ t: t + 0.1, filter: 'bandpass', cutoff: 2600, sweep: 7000, q: 3, gain: 0.10, dur: 0.36, attack: 0.10 });
    },
    gallop: function (t) {              // caballeria: cuatro cascos
      var hits = [0, 0.085, 0.20, 0.285];
      for (var i = 0; i < hits.length; i++) {
        var h = t + hits[i];
        tone({ t: h, f0: i % 2 ? 128 : 112, f1: 48, type: 'triangle', gain: 0.34, dur: 0.09 });
        noise({ t: h, filter: 'lowpass', cutoff: 620, sweep: 180, q: 1, gain: 0.22, dur: 0.07 });
      }
    },
    rumble: function (t) {              // terremoto: subgrave y grava
      tone({ t: t, f0: 48, f1: 27, type: 'sawtooth', gain: 0.55, dur: 0.85, attack: 0.05, filter: 'lowpass', cutoff: 160, verb: 0.3 });
      noise({ t: t, filter: 'lowpass', cutoff: 140, sweep: 60, q: 1, gain: 0.5, dur: 0.85, attack: 0.05, verb: 0.3 });
      for (var i = 0; i < 6; i++) {
        noise({ t: t + 0.08 + i * 0.11, filter: 'bandpass', cutoff: 900 + i * 300, q: 5, gain: 0.12, dur: 0.05 });
      }
    },
    thunder: function (t) {             // tormenta: chasquido y trueno largo
      noise({ t: t, filter: 'highpass', cutoff: 3200, q: 1, gain: 0.5, dur: 0.06, attack: 0.001 });
      noise({ t: t + 0.02, filter: 'bandpass', cutoff: 1500, sweep: 160, q: 0.8, gain: 0.55, dur: 0.95, attack: 0.01, verb: 0.5 });
      tone({ t: t + 0.02, f0: 62, f1: 28, type: 'sine', gain: 0.5, dur: 0.7, verb: 0.3 });
    },
    zap: function (t) {                 // rayo arcano
      tone({ t: t, f0: 1900, f1: 180, type: 'sawtooth', gain: 0.22, dur: 0.14, filter: 'bandpass', cutoff: 2400, q: 1.5, verb: 0.3 });
      tone({ t: t, f0: 2800, f1: 6200, type: 'sine', gain: 0.10, dur: 0.09 });
      noise({ t: t, filter: 'highpass', cutoff: 5000, q: 1, gain: 0.16, dur: 0.05, attack: 0.001 });
    },
    sparkle: function (t) {             // motas de magia sueltas
      tone({ t: t, f0: 1568 + Math.random() * 1200, type: 'sine', gain: 0.10, dur: 0.12, verb: 0.5 });
    },
    disintegrate: function (t) {        // la figura se deshace en motas
      var n = 10;
      for (var i = 0; i < n; i++) {
        var u = i / n;
        tone({ t: t + u * 0.78, f0: 1800 - u * 1400 + Math.random() * 160, type: 'sine', gain: 0.14, dur: 0.16, verb: 0.5 });
      }
      noise({ t: t, filter: 'bandpass', cutoff: 4200, sweep: 260, q: 2, gain: 0.22, dur: 0.92, attack: 0.05, verb: 0.4 });
      noise({ t: t + 0.82, filter: 'lowpass', cutoff: 900, sweep: 200, q: 1, gain: 0.22, dur: 0.16 });
    },
    fanfare: function (t) {             // duelo real: trompetas
      var notes = [392, 523, 659];
      for (var i = 0; i < notes.length; i++) {
        tone({ t: t + i * 0.15, f0: notes[i], type: 'square', gain: 0.22, dur: 0.20, attack: 0.01, verb: 0.4 });
        tone({ t: t + i * 0.15, f0: notes[i], type: 'sawtooth', gain: 0.10, dur: 0.20, attack: 0.01, detune: 7, verb: 0.4 });
      }
      tone({ t: t + 0.46, f0: 784, type: 'square', gain: 0.24, dur: 0.46, attack: 0.01, verb: 0.5 });
      tone({ t: t + 0.46, f0: 523, type: 'triangle', gain: 0.18, dur: 0.46, attack: 0.01, verb: 0.5 });
    },

    /* ------------------------------- partida ------------------------------ */
    check: function (t) {
      var ch = [440, 622, 740];
      for (var i = 0; i < ch.length; i++) {
        tone({ t: t, f0: ch[i], type: 'square', gain: 0.22, dur: 0.45, verb: 0.3 });
        tone({ t: t + 0.24, f0: ch[i] * 1.05, type: 'square', gain: 0.2, dur: 0.4, verb: 0.3 });
      }
      tone({ t: t, f0: 110, type: 'sawtooth', gain: 0.16, dur: 0.6, attack: 0.02, filter: 'lowpass', cutoff: 500 });
    },
    promote: function (t) {
      seq([523, 659, 784, 1047], t, { type: 'square', step: 0.08, dur: 0.14, gain: 0.3, verb: 0.4 });
      tone({ t: t + 0.32, f0: 1047, type: 'triangle', gain: 0.3, dur: 0.4, verb: 0.5 });
      tone({ t: t + 0.32, f0: 1319, type: 'sine', gain: 0.16, dur: 0.4, verb: 0.5 });
    },
    win: function (t) {
      seq([523, 659, 784, 1047, 1319], t, { type: 'square', step: 0.11, dur: 0.16, gain: 0.32, verb: 0.4 });
      tone({ t: t + 0.55, f0: 1568, type: 'square', gain: 0.32, dur: 0.5, verb: 0.55 });
      tone({ t: t + 0.55, f0: 1047, type: 'triangle', gain: 0.25, dur: 0.5, verb: 0.55 });
      tone({ t: t + 0.55, f0: 784, type: 'triangle', gain: 0.18, dur: 0.5, verb: 0.55 });
    },
    lose: function (t) {
      seq([392, 349, 311, 262], t, { type: 'triangle', step: 0.13, dur: 0.2, gain: 0.3, verb: 0.4 });
      tone({ t: t + 0.52, f0: 233, f1: 98, type: 'sawtooth', gain: 0.3, dur: 0.55, filter: 'lowpass', cutoff: 1200, cutoff2: 300, verb: 0.5 });
    }
  };

  function buildBus() {
    master = ctx.createGain();
    master.gain.setValueAtTime(muted ? EPS : volume, ctx.currentTime);
    var sink = ctx.destination;
    comp = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        comp = ctx.createDynamicsCompressor();
        if (comp.threshold) comp.threshold.setValueAtTime(-14, ctx.currentTime);
        if (comp.knee) comp.knee.setValueAtTime(18, ctx.currentTime);
        if (comp.ratio) comp.ratio.setValueAtTime(6, ctx.currentTime);
        if (comp.attack) comp.attack.setValueAtTime(0.004, ctx.currentTime);
        if (comp.release) comp.release.setValueAtTime(0.18, ctx.currentTime);
        comp.connect(ctx.destination);
        sink = comp;
      } catch (e) { comp = null; sink = ctx.destination; }
    }
    master.connect(sink);
    verbIn = null;
    if (typeof ctx.createConvolver === 'function') {
      try {
        var conv = ctx.createConvolver();
        conv.buffer = reverbImpulse(1.5);
        var ret = ctx.createGain();
        ret.gain.setValueAtTime(0.42, ctx.currentTime);
        verbIn = ctx.createGain();
        verbIn.gain.setValueAtTime(1, ctx.currentTime);
        verbIn.connect(conv);
        conv.connect(ret);
        ret.connect(master);
      } catch (e) { verbIn = null; }
    }
  }

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
      buildBus();
      if (typeof ctx.addEventListener === 'function') {
        ctx.addEventListener('statechange', function () {
          if (!muted && ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
        });
      }
    } catch (e) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  /* El navegador puede suspender el contexto por su cuenta (pestana en segundo
     plano, politica de autoplay, interrupcion del sistema). Se reanuda en cada
     intento de sonar y al reactivar el sonido; si no, "el audio se apaga". */
  function despierta() {
    if (!ctx) return false;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      try { if (ctx.resume) ctx.resume(); } catch (e) {}
    }
    return ctx.state !== 'closed';
  }

  function play(name, opts) {
    if (!ctx || !master || muted) return;
    if (!despierta()) return;
    var voice = Object.prototype.hasOwnProperty.call(VOICES, name) ? VOICES[name] : null;
    if (!voice) return;
    opts = opts || {};
    var t = now() + (opts.delay > 0 ? opts.delay : 0);
    var gap = MIN_GAP[name] !== undefined ? MIN_GAP[name] : DEFAULT_GAP;
    if (lastAt[name] !== undefined && t - lastAt[name] < gap) return;
    lastAt[name] = t;
    curPan = typeof opts.pan === 'number' && isFinite(opts.pan) ? opts.pan : 0;
    curPitch = typeof opts.pitch === 'number' && isFinite(opts.pitch) && opts.pitch > 0 ? opts.pitch : 1;
    try {
      voice(t);
    } catch (e) {
      // nunca propagar errores de audio al juego
    }
    curPan = 0;
    curPitch = 1;
  }

  function setMuted(m) {
    muted = !!m;
    if (!muted) { init(); despierta(); }        // reactivar debe devolver el sonido de verdad
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

  function getVolume() { return volume; }

  function estado() { return ctx ? ctx.state : 'sin-contexto'; }

  function names() { return Object.keys(VOICES); }

  return {
    estado: estado,
    init: init,
    play: play,
    names: names,
    setMuted: setMuted,
    isMuted: isMuted,
    setVolume: setVolume,
    getVolume: getVolume
  };
})();
