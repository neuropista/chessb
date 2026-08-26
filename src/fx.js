/* ============================================================
   FX  -  Sistema de efectos visuales de combate (retro/pixel)
   Canvas 2D puro. Pool de objetos, cero asignaciones por frame.
   ============================================================ */
const FX = (function () {

  var MAX_PARTS = 1200;      // capacidad del pool
  var TAU = Math.PI * 2;
  var EMPTY = {};            // opts por defecto (nunca se muta)

  // codigos de tipo (enteros = switch rapido)
  var K_DUST = 1, K_SPARK = 2, K_SLASH = 3, K_IMPACT = 4, K_STAR = 5,
      K_MAGIC = 6, K_BOLT = 7, K_STONE = 8, K_PIXEL = 9, K_SMOKE = 10,
      K_POOF = 11;

  // paletas (constantes, no se crean por frame)
  var C_DUST  = ['#d8cfb4', '#bdb193', '#9c9179', '#efe7cf'];
  var C_SPARK = ['#fffbe6', '#ffe680', '#ffbb33', '#ffffff'];
  var C_STONE = ['#9a9a9a', '#6e6e6e', '#b4b4b4', '#565656'];
  var C_SMOKE = ['#cfcfcf', '#e8e8e8', '#a6a6a6'];
  var C_POOF  = ['#ffffff', '#f2f2f2', '#dcdcdc'];
  var C_STAR  = ['#fff27a', '#ffffff', '#ffd23f'];

  // offsets de las bolitas de una nubecilla "poof"
  var PUFF = [0, 0, -6, -2, 6, -3, -3, 5, 4, 4, 0, -7];

  // ---------- utilidades ----------
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function snap(v, g) { return Math.round(v / g) * g; }

  // rectangulo alineado a la rejilla de pixel
  function rect(ctx, x, y, w, h, g) {
    if (w < g) w = g;
    if (h < g) h = g;
    ctx.fillRect(snap(x, g), snap(y, g), snap(w, g), snap(h, g));
  }

  // linea rasterizada a bloques (sin lineTo, look pixelado)
  function pixLine(ctx, x0, y0, x1, y1, w, g) {
    var dx = x1 - x0, dy = y1 - y0;
    var d = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.ceil(d / g);
    if (steps < 1) steps = 1;
    if (steps > 160) steps = 160;
    var h = w * 0.5;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      rect(ctx, x0 + dx * t - h, y0 + dy * t - h, w, w, g);
    }
  }

  // estrellita de 4 puntas hecha con bloques
  function pixStar(ctx, x, y, r, g) {
    if (r < g) r = g;
    rect(ctx, x - g, y - r, g * 2, r * 2, g);
    rect(ctx, x - r, y - g, r * 2, g * 2, g);
    var d = r * 0.5;
    rect(ctx, x - d, y - d, g, g, g);
    rect(ctx, x + d - g, y - d, g, g, g);
    rect(ctx, x - d, y + d - g, g, g, g);
    rect(ctx, x + d - g, y + d - g, g, g, g);
  }

  // hash determinista para formas "aleatorias" pero estables
  function hash(i, seed) {
    var h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------- pool ----------
  function makeParticle() {
    return {
      k: 0, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
      ox: 0, oy: 0, gx: 0, gy: 0,
      g: 0, drag: 0, life: 1, max: 1,
      s: 2, grid: 2, col: '#ffffff', col2: '#ffffff',
      rot: 0, spin: 0, r: 0, r1: 0,
      amp: 0, freq: 0, ph: 0, bnc: 0, a: 1,
      seg: null, ns: 0
    };
  }

  var parts = new Array(MAX_PARTS);
  for (var _i = 0; _i < MAX_PARTS; _i++) parts[_i] = makeParticle();
  var n = 0;

  function spawn() {
    if (n >= MAX_PARTS) return null;
    var p = parts[n++];
    // valores neutros; cada emisor sobreescribe lo suyo
    p.px = p.py = 0; p.vx = p.vy = 0; p.ox = p.oy = 0; p.gy = 0;
    p.g = 0; p.drag = 0; p.s = 2; p.grid = 2; p.rot = 0; p.spin = 0;
    p.r = 0; p.r1 = 0; p.amp = 0; p.freq = 0; p.ph = 0; p.bnc = 0;
    p.a = 1; p.ns = 0; p.col = '#ffffff'; p.col2 = '#ffffff';
    return p;
  }

  function kill(i) {
    var last = parts[n - 1];
    parts[n - 1] = parts[i];
    parts[i] = last;
    n--;
  }

  // ---------- sacudida de pantalla ----------
  var shake = { x: 0, y: 0 };
  var shakeMag = 0;

  function shakeImpulse(power) {
    var p = num(power, 4);
    if (p < 0) p = 0;
    shakeMag += p;
    if (shakeMag > 26) shakeMag = 26;
  }

  // ---------- emisores ----------
  function emit(kind, x, y, o) {
    o = o || EMPTY;
    x = num(x, 0); y = num(y, 0);
    var power = num(o.power, 1);
    var scale = num(o.scale, 1);
    var life = num(o.life, 0);
    var cnt = num(o.n, 0) | 0;
    var col = o.color, col2 = o.color2;
    var grav = o.gravity;
    var i, p, a, sp;

    switch (kind) {

      case 'dust': {
        var dn = cnt > 0 ? cnt : 8;
        for (i = 0; i < dn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_DUST;
          p.x = p.px = x + rnd(-4, 4);
          p.y = p.py = y + rnd(-2, 2);
          p.vx = rnd(-42, 42) * power;
          p.vy = rnd(-58, -14) * power;
          p.g = num(grav, 150);
          p.drag = 1.6;
          p.max = p.life = life > 0 ? life : rnd(0.30, 0.60);
          p.s = rnd(2, 4) | 0;
          p.grid = 2;
          p.col = col || pick(C_DUST);
        }
        break;
      }

      case 'sparks': {
        var sn = cnt > 0 ? cnt : 14;
        for (i = 0; i < sn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_SPARK;
          a = num(o.dir, rnd(0, TAU)) + (o.dir === undefined ? 0 : rnd(-0.9, 0.9));
          sp = rnd(110, 320) * power;
          p.x = p.px = x; p.y = p.py = y;
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp - rnd(0, 60);
          p.g = num(grav, 420);
          p.drag = 1.1;
          p.max = p.life = life > 0 ? life : rnd(0.20, 0.45);
          p.s = 2;
          p.grid = 2;
          p.col = col || pick(C_SPARK);
          p.col2 = col2 || '#ffffff';
        }
        break;
      }

      case 'slash': {
        p = spawn(); if (!p) break;
        p.k = K_SLASH;
        p.x = x; p.y = y;
        p.rot = num(o.dir, -0.6);
        p.s = scale;
        p.r = 26 * scale;
        p.max = p.life = life > 0 ? life : 0.24;
        p.grid = 3;
        p.col = col || '#ffffff';
        p.col2 = col2 || '#9fe8ff';
        break;
      }

      case 'impact': {
        p = spawn(); if (!p) break;
        p.k = K_IMPACT;
        p.x = x; p.y = y;
        p.r = 4 * scale;
        p.r1 = 46 * scale * (power > 0 ? power : 1);
        p.max = p.life = life > 0 ? life : 0.34;
        p.grid = 3;
        p.col = col || '#ffffff';
        p.col2 = col2 || '#ffd45e';
        break;
      }

      case 'stars': {
        var stn = cnt > 0 ? cnt : 5;
        for (i = 0; i < stn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_STAR;
          p.ox = x; p.oy = y;
          p.r = rnd(12, 22) * scale;
          p.ph = (i / stn) * TAU;
          p.spin = rnd(3.2, 5.4) * (Math.random() < 0.5 ? -1 : 1);
          p.vx = rnd(-8, 8);
          p.vy = rnd(-26, -10);
          p.rot = rnd(0, TAU);
          p.x = p.px = x + Math.cos(p.ph) * p.r;
          p.y = p.py = y + Math.sin(p.ph) * p.r * 0.5;
          p.max = p.life = life > 0 ? life : rnd(0.7, 1.1);
          p.s = rnd(4, 7);
          p.grid = 2;
          p.col = col || pick(C_STAR);
        }
        break;
      }

      case 'magic': {
        var mn = cnt > 0 ? cnt : 12;
        for (i = 0; i < mn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_MAGIC;
          p.ox = x + rnd(-6, 6);
          p.oy = y + rnd(-4, 4);
          p.amp = rnd(6, 18) * scale;
          p.freq = rnd(3.0, 6.0);
          p.ph = rnd(0, TAU);
          p.vy = rnd(-70, -28) * power;
          p.x = p.px = p.ox; p.y = p.py = p.oy;
          p.max = p.life = life > 0 ? life : rnd(0.6, 1.2);
          p.s = rnd(2, 4) | 0;
          p.grid = 2;
          p.col = col || '#b98cff';
          p.col2 = col2 || '#ffffff';
        }
        break;
      }

      case 'bolt': {
        p = spawn(); if (!p) break;
        p.k = K_BOLT;
        p.x = x; p.y = y;
        var bx = num(o.x2, x + 40), by = num(o.y2, y);
        if (!p.seg) p.seg = new Float32Array(26);
        var segs = 10;                      // 10 tramos -> 11 puntos
        var dx = bx - x, dy = by - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var nx = 0, ny = 0;
        if (d > 0.0001) { nx = -dy / d; ny = dx / d; }
        var jag = Math.min(18, 4 + d * 0.10);
        for (i = 0; i <= segs; i++) {
          var t = i / segs;
          var off = (i === 0 || i === segs) ? 0 : rnd(-jag, jag);
          p.seg[i * 2] = x + dx * t + nx * off;
          p.seg[i * 2 + 1] = y + dy * t + ny * off;
        }
        p.ns = segs;
        p.max = p.life = life > 0 ? life : 0.20;
        p.grid = 3;
        p.col = col || '#9be7ff';
        p.col2 = col2 || '#ffffff';
        emit('sparks', bx, by, { n: 6, power: 0.7, color: p.col });
        break;
      }

      case 'stone': {
        var kn = cnt > 0 ? cnt : 10;
        for (i = 0; i < kn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_STONE;
          p.x = p.px = x + rnd(-6, 6);
          p.y = p.py = y + rnd(-6, 2);
          p.vx = rnd(-130, 130) * power;
          p.vy = rnd(-260, -80) * power;
          p.g = num(grav, 760);
          p.gy = y + rnd(2, 10);      // suelo del rebote
          p.bnc = rnd(0.28, 0.5);
          p.drag = 0.4;
          p.rot = rnd(0, TAU);
          p.spin = rnd(-9, 9);
          p.max = p.life = life > 0 ? life : rnd(0.7, 1.3);
          p.s = rnd(3, 6) | 0;
          p.grid = 2;
          p.col = col || pick(C_STONE);
        }
        break;
      }

      case 'pixelBurst': {
        var sprite = o.sprite;
        if (!sprite || !sprite.length) {
          // sin sprite: estallido generico de bloques
          emit('stone', x, y, { n: 14, color: col || '#c0c0c0', power: power });
          break;
        }
        var step = 1;
        if (sprite.length > 260) step = Math.ceil(sprite.length / 260);
        for (i = 0; i < sprite.length; i += step) {
          var sp2 = sprite[i];
          if (!sp2) continue;
          p = spawn(); if (!p) break;
          var sx = num(sp2.x, x), sy = num(sp2.y, y);
          var ddx = sx - x, ddy = sy - y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < 0.0001) { ddx = rnd(-1, 1); ddy = rnd(-1, 1); dd = 1; }
          var spd = rnd(50, 170) * power;
          p.k = K_PIXEL;
          p.x = p.px = sx; p.y = p.py = sy;
          p.vx = (ddx / dd) * spd + rnd(-30, 30);
          p.vy = (ddy / dd) * spd - rnd(40, 140);
          p.g = num(grav, 460);
          p.drag = 0.5;
          p.max = p.life = life > 0 ? life : rnd(0.55, 1.0);
          p.s = num(o.pixel, 3);
          p.grid = 2;
          p.col = sp2.color || col || '#ffffff';
        }
        break;
      }

      case 'smoke': {
        var smn = cnt > 0 ? cnt : 8;
        for (i = 0; i < smn; i++) {
          p = spawn(); if (!p) break;
          p.k = K_SMOKE;
          p.x = p.px = x + rnd(-10, 10);
          p.y = p.py = y + rnd(-8, 4);
          p.vx = rnd(-22, 22);
          p.vy = rnd(-34, -10) * power;
          p.g = num(grav, -14);
          p.drag = 0.9;
          p.max = p.life = life > 0 ? life : rnd(0.8, 1.6);
          p.s = rnd(5, 10);
          p.grid = 3;
          p.col = col || pick(C_SMOKE);
        }
        break;
      }

      case 'poof': {   // nube comica inofensiva (sustituye a cualquier "blood")
        var pn = cnt > 0 ? cnt : 9;
        for (i = 0; i < pn; i++) {
          p = spawn(); if (!p) break;
          a = (i / pn) * TAU + rnd(-0.3, 0.3);
          sp = rnd(26, 78) * power;
          p.k = K_POOF;
          p.x = p.px = x; p.y = p.py = y;
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp * 0.7 - 24;
          p.g = num(grav, -26);
          p.drag = 2.2;
          p.rot = rnd(0, TAU);
          p.spin = rnd(-2, 2);
          p.max = p.life = life > 0 ? life : rnd(0.45, 0.8);
          p.s = rnd(3, 5);
          p.grid = 2;
          p.col = col || pick(C_POOF);
        }
        break;
      }

      default:
        break;   // tipo desconocido: se ignora en silencio
    }
  }

  // ---------- simulacion ----------
  function update(dt) {
    dt = num(dt, 0);
    if (dt <= 0) dt = 0;
    if (dt > 0.05) dt = 0.05;   // evita saltos gigantes tras un stall

    // sacudida: decae exponencialmente y se apaga del todo
    if (shakeMag > 0) {
      shakeMag -= shakeMag * Math.min(1, dt * 8.5) + dt * 3.2;
      if (shakeMag <= 0.06) {
        shakeMag = 0; shake.x = 0; shake.y = 0;
      } else {
        shake.x = snap((Math.random() * 2 - 1) * shakeMag, 2);
        shake.y = snap((Math.random() * 2 - 1) * shakeMag, 2);
      }
    }

    for (var i = 0; i < n; i++) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { kill(i); i--; continue; }
      step(p, dt);
    }
  }

  function step(p, dt) {
    p.px = p.x; p.py = p.y;

    switch (p.k) {

      case K_STAR: {
        p.ph += p.spin * dt;
        p.rot += p.spin * 0.6 * dt;
        p.ox += p.vx * dt;
        p.oy += p.vy * dt;
        p.x = p.ox + Math.cos(p.ph) * p.r;
        p.y = p.oy + Math.sin(p.ph) * p.r * 0.5;
        break;
      }

      case K_MAGIC: {
        p.ph += p.freq * dt;
        p.oy += p.vy * dt;
        p.amp *= (1 - 0.35 * dt);
        p.x = p.ox + Math.cos(p.ph) * p.amp;
        p.y = p.oy + Math.sin(p.ph * 0.5) * 2;
        break;
      }

      case K_SLASH:
      case K_IMPACT:
      case K_BOLT:
        break;   // estaticos, solo envejecen

      case K_STONE: {
        p.vy += p.g * dt;
        p.vx -= p.vx * p.drag * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        if (p.y > p.gy && p.vy > 0) {
          p.y = p.gy;
          p.vy = -p.vy * p.bnc;
          p.vx *= 0.62;
          p.spin *= 0.6;
          if (p.vy > -22) { p.vy = 0; p.vx *= 0.4; }
        }
        break;
      }

      default: {
        p.vy += p.g * dt;
        var k = 1 - p.drag * dt;
        if (k < 0) k = 0;
        p.vx *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.rot += p.spin * dt;
        break;
      }
    }
  }

  // ---------- dibujo de particulas ----------
  function draw(ctx) {
    if (n === 0) return;
    ctx.save();
    ctx.globalAlpha = 1;
    for (var i = 0; i < n; i++) {
      var p = parts[i];
      var t = p.max > 0 ? clamp01(p.life / p.max) : 0;   // 1 = recien nacida
      switch (p.k) {
        case K_DUST:   drawDust(ctx, p, t); break;
        case K_SPARK:  drawSpark(ctx, p, t); break;
        case K_SLASH:  drawSlash(ctx, p, t); break;
        case K_IMPACT: drawImpact(ctx, p, t); break;
        case K_STAR:   drawStar(ctx, p, t); break;
        case K_MAGIC:  drawMagic(ctx, p, t); break;
        case K_BOLT:   drawBolt(ctx, p, t); break;
        case K_STONE:  drawStone(ctx, p, t); break;
        case K_PIXEL:  drawPixel(ctx, p, t); break;
        case K_SMOKE:  drawSmoke(ctx, p, t); break;
        case K_POOF:   drawPoof(ctx, p, t); break;
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawDust(ctx, p, t) {
    ctx.globalAlpha = clamp01(t * 0.9);
    ctx.fillStyle = p.col;
    var s = p.s + (1 - t) * 2;
    rect(ctx, p.x - s * 0.5, p.y - s * 0.5, s, s, p.grid);
  }

  function drawSpark(ctx, p, t) {
    ctx.globalAlpha = clamp01(t);
    ctx.fillStyle = p.col;
    pixLine(ctx, p.px, p.py, p.x, p.y, 2, p.grid);   // estela
    if (t > 0.35) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.col2;
      rect(ctx, p.x - 1, p.y - 1, 2, 2, p.grid);     // cabeza blanca
    }
  }

  function drawSlash(ctx, p, t) {
    var prog = 1 - t;                 // 0 -> 1
    var head = prog * 1.25;
    var steps = 16;
    var spread = 2.0;                 // arco de ~115 grados
    var R = p.r;
    var g = p.grid;
    for (var i = 0; i <= steps; i++) {
      var f = i / steps;
      if (f > head) break;
      var fade = clamp01(1 - (head - f) * 0.9) * clamp01(t * 2.2);
      if (fade <= 0.02) continue;
      var a = p.rot - spread * 0.5 + spread * f;
      var bow = Math.sin(Math.PI * f);
      var rr = R * (0.72 + 0.35 * bow);
      var x = p.x + Math.cos(a) * rr;
      var y = p.y + Math.sin(a) * rr;
      var w = (2 + bow * 5) * p.s;
      ctx.globalAlpha = clamp01(fade * 0.75);
      ctx.fillStyle = p.col2;
      rect(ctx, x - w * 0.5, y - w * 0.5, w, w, g);
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.col;
      rect(ctx, x - w * 0.25, y - w * 0.25, w * 0.5, w * 0.5, g);
    }
  }

  function drawImpact(ctx, p, t) {
    var prog = 1 - t;
    var r = p.r + (p.r1 - p.r) * (prog * (2 - prog));   // ease-out
    var g = p.grid;
    var steps = Math.min(96, Math.max(10, Math.round(r * 0.55)));
    var w = 2 + t * 4;
    ctx.globalAlpha = clamp01(t * 0.95);
    for (var i = 0; i < steps; i++) {
      var a = (i / steps) * TAU;
      var x = p.x + Math.cos(a) * r;
      var y = p.y + Math.sin(a) * r * 0.62;            // anillo achatado
      ctx.fillStyle = (i & 1) ? p.col : p.col2;
      rect(ctx, x - w * 0.5, y - w * 0.5, w, w, g);
    }
  }

  function drawStar(ctx, p, t) {
    ctx.globalAlpha = clamp01(t * 1.2);
    ctx.fillStyle = p.col;
    var r = p.s * (0.7 + 0.4 * Math.sin(p.ph * 3));
    ctx.save();
    ctx.translate(snap(p.x, p.grid), snap(p.y, p.grid));
    ctx.rotate(p.rot);
    pixStar(ctx, 0, 0, r, p.grid);
    ctx.restore();
  }

  function drawMagic(ctx, p, t) {
    ctx.globalAlpha = clamp01(t);
    ctx.fillStyle = p.col;
    var s = p.s * (0.5 + t * 0.9);
    rect(ctx, p.x - s * 0.5, p.y - s * 0.5, s, s, p.grid);
    if (t > 0.6) {
      ctx.fillStyle = p.col2;
      rect(ctx, p.x - 1, p.y - 1, 2, 2, p.grid);
    }
  }

  function drawBolt(ctx, p, t) {
    if (!p.seg || p.ns < 1) return;
    var g = p.grid;
    var a = clamp01(t * 1.6);
    // pasada gruesa de color
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = p.col;
    var i;
    for (i = 0; i < p.ns; i++) {
      pixLine(ctx, p.seg[i * 2], p.seg[i * 2 + 1], p.seg[i * 2 + 2], p.seg[i * 2 + 3], 6, g);
    }
    // nucleo blanco fino
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col2;
    for (i = 0; i < p.ns; i++) {
      pixLine(ctx, p.seg[i * 2], p.seg[i * 2 + 1], p.seg[i * 2 + 2], p.seg[i * 2 + 3], 2, g);
    }
  }

  function drawStone(ctx, p, t) {
    ctx.globalAlpha = clamp01(t * 1.5);
    ctx.fillStyle = p.col;
    var s = p.s;
    var c = Math.cos(p.rot), sn2 = Math.sin(p.rot);
    rect(ctx, p.x - s * 0.5, p.y - s * 0.5, s, s, p.grid);
    rect(ctx, p.x - s * 0.5 + c * s * 0.5, p.y - s * 0.5 + sn2 * s * 0.5, s * 0.6, s * 0.6, p.grid);
  }

  function drawPixel(ctx, p, t) {
    // desvanecido escalonado (retro): 1 -> 0.6 -> 0.3
    var a = t > 0.55 ? 1 : (t > 0.28 ? 0.6 : 0.3);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col;
    rect(ctx, p.x - p.s * 0.5, p.y - p.s * 0.5, p.s, p.s, p.grid);
  }

  function drawSmoke(ctx, p, t) {
    ctx.globalAlpha = clamp01(t * 0.55);
    ctx.fillStyle = p.col;
    var s = p.s * (1 + (1 - t) * 1.8);
    rect(ctx, p.x - s * 0.5, p.y - s * 0.5, s, s, p.grid);
    ctx.globalAlpha = clamp01(t * 0.3);
    rect(ctx, p.x - s * 0.8, p.y - s * 0.35, s * 0.6, s * 0.6, p.grid);
  }

  function drawPoof(ctx, p, t) {
    ctx.globalAlpha = clamp01(t * 0.9);
    ctx.fillStyle = p.col;
    var s = p.s * (1 + (1 - t) * 1.2);
    for (var i = 0; i < PUFF.length; i += 2) {
      var f = 1 - i / PUFF.length * 0.5;
      rect(ctx, p.x + PUFF[i] * 0.6 - s * 0.5 * f, p.y + PUFF[i + 1] * 0.6 - s * 0.5 * f, s * f, s * f, p.grid);
    }
  }

  // ---------- dibujo directo: nube de pelea ----------
  function drawFightCloud(ctx, x, y, r, t, seed) {
    x = num(x, 0); y = num(y, 0); r = num(r, 40);
    t = clamp01(num(t, 0));
    seed = num(seed, 1) | 0;

    // entrada/salida + palpitar
    var grow = t < 0.14 ? (t / 0.14) : 1;
    var gone = t > 0.88 ? (1 - (t - 0.88) / 0.12) : 1;
    var ease = clamp01(grow) * clamp01(gone);
    if (ease <= 0.01) return;
    var pulse = 1 + 0.09 * Math.sin(t * TAU * 7 + seed);
    var R = r * ease * pulse;
    if (R < 2) R = 2;

    var frame = Math.floor(t * 22);   // el borde vibra a ~22 pasos (retro)
    var N = 18, i, a, rr, px, py;

    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    // cuerpo dentado
    ctx.beginPath();
    for (i = 0; i < N; i++) {
      a = (i / N) * TAU;
      rr = R * ((i & 1) ? 0.66 : 1.02) * (0.86 + 0.28 * hash(i + frame * 31, seed));
      px = snap(x + Math.cos(a) * rr, 2);
      py = snap(y + Math.sin(a) * rr * 0.86, 2);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#f7f4ea';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#15151f';
    ctx.stroke();

    // sombra interior en bloques
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#b9b4a6';
    for (i = 0; i < 7; i++) {
      a = hash(i + 60, seed) * TAU;
      rr = R * (0.25 + 0.4 * hash(i + 90, seed));
      var bs = 4 + hash(i + 120, seed) * 7;
      rect(ctx, x + Math.cos(a) * rr - bs * 0.5, y + Math.sin(a) * rr * 0.8 - bs * 0.5, bs, bs, 2);
    }

    // destellos en forma de estrella
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff29a';
    for (i = 0; i < 4; i++) {
      a = hash(i + 11, seed) * TAU + t * 3.1;
      rr = R * (0.35 + 0.45 * hash(i + 33, seed));
      var sr = R * 0.20 * (0.55 + 0.55 * Math.abs(Math.sin(t * TAU * 5 + i * 1.7)));
      pixStar(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, sr, 2);
    }

    // punos y armas asomando
    for (i = 0; i < 3; i++) {
      a = hash(i + 7, seed) * TAU;
      var wob = Math.sin(t * TAU * 3 + i * 2.1);
      var out = R * (0.78 + 0.30 * wob);
      var fx = x + Math.cos(a) * out;
      var fy = y + Math.sin(a) * out * 0.8;
      ctx.save();
      ctx.translate(snap(fx, 2), snap(fy, 2));
      ctx.rotate(a);
      ctx.globalAlpha = 1;
      if (i === 2) {
        // espada: hoja + guarda
        ctx.fillStyle = '#dfe6ee';
        ctx.fillRect(0, -2, snap(R * 0.55, 2), 4);
        ctx.fillStyle = '#15151f';
        ctx.fillRect(0, -3, 2, 6);
        ctx.fillStyle = '#c8a33a';
        ctx.fillRect(-4, -6, 4, 12);
      } else {
        // puno: bloque + nudillos + manga
        ctx.fillStyle = '#f2c9a0';
        ctx.fillRect(0, -6, 12, 12);
        ctx.fillStyle = '#15151f';
        ctx.fillRect(8, -6, 2, 12);
        ctx.fillRect(0, -6, 12, 2);
        ctx.fillStyle = (i === 0) ? '#3a6ea5' : '#a53a3a';
        ctx.fillRect(-8, -5, 8, 10);
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- dibujo directo: palabra comica ----------
  function drawComicWord(ctx, x, y, text, t, color) {
    x = num(x, 0); y = num(y, 0);
    t = clamp01(num(t, 0));
    text = (text === undefined || text === null) ? 'POW!' : String(text);
    if (!text.length) return;

    // escala con rebote y desvanecido final
    var s, a;
    if (t < 0.22) { s = (t / 0.22) * 1.25; a = t / 0.22; }
    else if (t < 0.38) { s = 1.25 - ((t - 0.22) / 0.16) * 0.30; a = 1; }
    else { s = 0.95 + (t - 0.38) * 0.30; a = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28; }
    a = clamp01(a);
    if (a <= 0.01 || s <= 0.01) return;

    var size = Math.max(10, Math.round(30 * s));
    /* La inclinacion se cuantiza: un giro continuo curvaria los bordes y
       delataria que el texto no es pixel art. */
    var tilt = Math.round((-0.12 + 0.06 * Math.sin(t * TAU * 2)) / QSTEP) * QSTEP;

    /* El rotulo se compone en un lienzo pequeno y se amplia con vecino mas
       cercano, para que los bordes queden en la rejilla como los sprites. */
    var layer = wordLayer(text, size, color || '#ffd23f');
    if (!layer) return;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(snap(x, 2), snap(y, 2));
    if (tilt) ctx.rotate(tilt);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer.cv, -(layer.w * WORD_PIX) / 2, -(layer.h * WORD_PIX) / 2,
      layer.w * WORD_PIX, layer.h * WORD_PIX);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* --- rotulos comicos rasterizados a baja resolucion (cache pequena) --- */
  var WORD_PIX = 2;                 // cada pixel del rotulo mide 2 px en pantalla
  var QSTEP = Math.PI / 32;         // paso de cuantizacion de la inclinacion
  var wordCache = Object.create(null);
  var wordOrder = [];

  function wordLayer(text, size, color) {
    var lo = Math.max(4, Math.round(size / WORD_PIX));   // altura en "pixeles gordos"
    var key = text + '|' + lo + '|' + color;
    var hit = wordCache[key];
    if (hit) return hit;
    if (typeof document === 'undefined' || !document.createElement) return null;

    var cv = document.createElement('canvas');
    var g = cv.getContext('2d');
    if (!g) return null;
    g.font = 'bold ' + lo + 'px Arial, Helvetica, sans-serif';
    var pad = Math.max(3, Math.round(lo * 0.42));
    var w = Math.ceil(g.measureText(text).width) + pad * 2;
    var h = lo + pad * 2;
    cv.width = w; cv.height = h;
    g = cv.getContext('2d');
    g.font = 'bold ' + lo + 'px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    var cx = w / 2, cy = h / 2;
    g.fillStyle = '#15151f';
    g.fillText(text, cx + 1, cy + 1);
    g.lineWidth = Math.max(2, lo * 0.26);
    g.strokeStyle = '#15151f';
    g.strokeText(text, cx, cy);
    if (lo >= 14) {                       // el filete blanco solo cabe si hay sitio
      g.lineWidth = Math.max(1, lo * 0.08);
      g.strokeStyle = '#ffffff';
      g.strokeText(text, cx, cy);
    }
    g.fillStyle = color;
    g.fillText(text, cx, cy);

    var entry = { cv: cv, w: w, h: h };
    wordCache[key] = entry;
    wordOrder.push(key);
    while (wordOrder.length > 48) delete wordCache[wordOrder.shift()];
    return entry;
  }

  // ---------- dibujo directo: fogonazo ----------
  function drawFlash(ctx, w, h, a, color) {
    a = clamp01(num(a, 0));
    if (a <= 0.005) return;
    w = num(w, 0); h = num(h, 0);
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);   // ignora la sacudida
    /* Al anular la transformada las medidas pasan a ser de DISPOSITIVO, no CSS:
       con devicePixelRatio 2 rellenar w x h solo cubriria un cuarto del lienzo. */
    const cv = ctx.canvas;
    const fw = cv && cv.width > 0 ? cv.width : w;
    const fh = cv && cv.height > 0 ? cv.height : h;
    ctx.globalAlpha = a;
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, fw, fh);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------- ciclo de vida ----------
  function reset() {
    n = 0;
    shakeMag = 0;
    shake.x = 0;
    shake.y = 0;
  }

  function alive() { return n; }

  return {
    reset: reset,
    emit: emit,
    update: update,
    draw: draw,
    alive: alive,
    shakeImpulse: shakeImpulse,
    drawFightCloud: drawFightCloud,
    drawComicWord: drawComicWord,
    drawFlash: drawFlash,
    shake: shake
  };
})();
