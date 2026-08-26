/* =========================================================================
   BATTLE CHESS - capa de integracion: escena 2.5D, sprites, animaciones,
   coreografia de combate, entrada e interfaz.
   Depende de: THEME, Engine, AI, SPR_*, FX, SFX (todos en el mismo scope).
   ========================================================================= */

/* ---------------------------------------------------------------- sprites */
const SPR = { p: SPR_PAWN, n: SPR_KNIGHT, b: SPR_BISHOP, r: SPR_ROOK, q: SPR_QUEEN, k: SPR_KING };
const PIECE_NAME = { p: 'Soldado', n: 'Caballero', b: 'Hechicero', r: 'Golem', q: 'Reina', k: 'Monarca' };
const FRAMES = ['idle', 'walk', 'attack'];
const SHEET = Object.create(null);   // t+c+frame  -> canvas
const WHITEN = Object.create(null);  // t+c+frame  -> canvas (silueta blanca para destellos)
const PXCACHE = Object.create(null); // t+c+frame  -> [{x,y,color}]

function mkCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

function buildSheets() {
  for (const t of Object.keys(SPR)) {
    const spr = SPR[t];
    for (const c of ['w', 'b']) {
      const pal = THEME.sprite[c];
      for (const f of FRAMES) {
        const rows = spr[f] || spr.idle;
        const cv = mkCanvas(spr.w, spr.h);
        const g = cv.getContext('2d');
        const wv = mkCanvas(spr.w, spr.h);
        const gw = wv.getContext('2d');
        const px = [];
        for (let y = 0; y < spr.h; y++) {
          const row = rows[y] || '';
          for (let x = 0; x < spr.w; x++) {
            const ch = row.charAt(x);
            if (!ch || ch === '.') continue;
            const col = pal[ch] || pal['B'] || '#ff00ff';
            g.fillStyle = col; g.fillRect(x, y, 1, 1);
            gw.fillStyle = '#ffffff'; gw.fillRect(x, y, 1, 1);
            px.push({ x: x, y: y, color: col });
          }
        }
        SHEET[t + c + f] = cv;
        WHITEN[t + c + f] = wv;
        PXCACHE[t + c + f] = px;
      }
    }
  }
}

/* ------------------------------------------------------- proyeccion 2.5D  */
/* Perspectiva de un punto: v=0 fila mas lejana, v=1 borde frontal.          */
const CAM = { focal: 1.0, depth: 0.78 };
const L = { w: 0, h: 0, cx: 0, halfW: 0, frontY: 0, horizon: 0, sqW: 0, pix: 0 };

function sAt(v) { return CAM.focal / (CAM.focal + (1 - v) * CAM.depth); }

function layout(w, h) {
  L.w = w; L.h = h; L.cx = w / 2;
  L.frontY = h * 0.925;
  const backY = h * 0.175;
  const sFar = sAt(0);
  L.horizon = (backY - sFar * L.frontY) / (1 - sFar);
  L.halfW = Math.min(w * 0.472, h * 0.98);
  L.sqW = (2 * L.halfW) / 8;
  L.pix = (L.sqW / 24) * 0.98;   // tamano de un pixel de sprite en el borde frontal
}

function proj(u, v) {
  const s = sAt(v);
  return { x: L.cx + u * L.halfW * s, y: L.horizon + (L.frontY - L.horizon) * s, s: s };
}
function uEdge(sc) { return -1 + sc / 4; }
function vEdge(sr) { return sr / 8; }
function quadOf(sr, sc) {
  const v0 = vEdge(sr), v1 = vEdge(sr + 1), u0 = uEdge(sc), u1 = uEdge(sc + 1);
  return [proj(u0, v0), proj(u1, v0), proj(u1, v1), proj(u0, v1)];
}
/* ancla de la pieza: centro de la casilla, algo hacia el borde cercano */
function anchorOf(sr, sc) {
  return proj(-1 + (sc + 0.5) / 4, (sr + 0.62) / 8);
}

/* --------------------------------------------------- indices <-> pantalla */
let flip = false;
function idxToRC(i) {
  const r = i >> 3, c = i & 7;
  return flip ? { sr: 7 - r, sc: 7 - c } : { sr: r, sc: c };
}
function rcToIdx(sr, sc) {
  const r = flip ? 7 - sr : sr, c = flip ? 7 - sc : sc;
  return r * 8 + c;
}
function anchorOfIdx(i) { const p = idxToRC(i); return anchorOf(p.sr, p.sc); }

function pointInQuad(px, py, q) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pickSquare(px, py) {
  for (let sr = 7; sr >= 0; sr--) {        // de cerca a lejos: gana la casilla mas cercana
    for (let sc = 0; sc < 8; sc++) {
      if (pointInQuad(px, py, quadOf(sr, sc))) return rcToIdx(sr, sc);
    }
  }
  return -1;
}

/* ------------------------------------------------------------- utilidades */
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }
function easeIn(t) { return t * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* Dibuja un sprite. sr/sc pueden ser decimales.
   o = {frame, flipX, lift, alpha, white, squash, lean, scale} */
function drawSprite(ctx, t, c, sr, sc, o) {
  o = o || {};
  const a = anchorOf(sr, sc);
  const k = L.pix * a.s * (o.scale || 1);
  const spr = SPR[t];
  const key = t + c + (o.frame || 'idle');
  const img = o.white ? WHITEN[key] : SHEET[key];
  if (!img) return;
  const lift = (o.lift || 0) * k;
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : clamp(o.alpha, 0, 1);
  ctx.translate(a.x, a.y - lift);
  if (o.lean) ctx.rotate(o.lean);
  const sx = (o.flipX ? -1 : 1) * k;
  const sy = k * (o.squash == null ? 1 : o.squash);
  ctx.scale(sx, sy);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -spr.w / 2, -spr.h);
  ctx.restore();
}

function drawShadow(ctx, sr, sc, lift, alpha, wMul) {
  const a = anchorOf(sr, sc);
  const k = L.pix * a.s;
  const rx = 9 * k * (wMul || 1) * (1 - clamp(lift / 40, 0, 0.45));
  const ry = rx * 0.34;
  ctx.save();
  ctx.globalAlpha = (alpha == null ? 0.42 : alpha) * (1 - clamp(lift / 55, 0, 0.6));
  ctx.fillStyle = THEME.scene.shadow;
  ctx.beginPath();
  ctx.ellipse(a.x, a.y - ry * 0.25, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* punto del cuerpo: fy 0 = pies, 1 = coronilla */
function bodyPoint(sr, sc, fy, dx) {
  const a = anchorOf(sr, sc);
  const k = L.pix * a.s;
  return { x: a.x + (dx || 0) * k, y: a.y - 32 * k * fy, k: k, s: a.s };
}

/* ============================ ESTADO DEL JUEGO ========================== */
const MODES = { hh: 'Humano vs Humano', ha: 'Humano vs IA', ah: 'IA vs Humano', aa: 'IA vs IA' };
const SPEEDS = { epico: 0.62, normal: 1, rapido: 1.9, sin: 0 };

const G = {
  state: null,
  hist: [],          // claves de posicion para repeticion
  stack: [],         // pila de {state, san, move} para deshacer
  log: [],           // SAN
  captured: { w: [], b: [] },
  sel: -1,
  targets: [],
  last: null,
  busy: false,
  over: null,
  mode: 'ha',
  aiLevel: 2,
  speedKey: 'normal',
  timeScale: 1,
  reduced: false,
  promo: null,       // {moves:[], to:int}
  banner: null,      // {text, sub, t, life, tone}
  hover: -1,
  aiTimer: 0,
  aiDelay: 0.28,
  thinking: false
};

function isAI(color) {
  if (G.mode === 'aa') return true;
  if (G.mode === 'ha') return color === 'b';
  if (G.mode === 'ah') return color === 'w';
  return false;
}

/* ============================== SECUENCIADOR ============================ */
function Seq(acts, onDone) {
  return { acts: acts, i: -1, t: 0, done: false, onDone: onDone };
}
function seqUpdate(s, dt) {
  if (s.done) return;
  let guard = 0;
  if (s.i < 0) { s.i = 0; s.t = 0; const a0 = s.acts[0]; if (a0 && a0.enter) a0.enter(); }
  s.t += dt;
  while (!s.done && guard++ < 64) {
    const a = s.acts[s.i];
    if (!a) { s.done = true; break; }
    const d = a.d || 0;
    if (s.t < d || d === 0) {
      const u = d > 0 ? clamp(s.t / d, 0, 1) : 1;
      if (a.tick) a.tick(u, s.t);
      if (d > 0) break;
    }
    if (s.t >= d) {
      if (a.tick) a.tick(1, d);
      if (a.exit) a.exit();
      s.t -= d;
      s.i++;
      if (s.i >= s.acts.length) { s.done = true; break; }
      const nx = s.acts[s.i];
      if (nx && nx.enter) nx.enter();
    }
  }
  if (s.done && s.onDone) { const f = s.onDone; s.onDone = null; f(); }
}
function seqSkip(s) {
  let guard = 0;
  while (!s.done && guard++ < 6000) seqUpdate(s, 1 / 20);
  if (!s.done && s.onDone) { const f = s.onDone; s.onDone = null; s.done = true; f(); }
}

/* ============================== ANIMACIONES ============================= */
let anim = null;

function mkActor(idx, t, c) {
  const p = idxToRC(idx);
  return {
    t: t, c: c, sr: p.sr, sc: p.sc, frame: 'idle',
    flipX: (c === 'b'), lift: 0, alpha: 1, scale: 1, squash: 1,
    lean: 0, white: false, hidden: false
  };
}
function walkFrame(t) { return (Math.floor(t / 0.13) % 2) ? 'walk' : 'idle'; }

function spritePixelsScreen(a) {
  const an = anchorOf(a.sr, a.sc);
  const k = L.pix * an.s;
  const spr = SPR[a.t];
  const px = PXCACHE[a.t + a.c + (a.frame || 'idle')] || [];
  const out = [];
  const step = px.length > 260 ? 2 : 1;
  for (let i = 0; i < px.length; i += step) {
    const p = px[i];
    const lx = (a.flipX ? (spr.w - 1 - p.x) : p.x) - spr.w / 2;
    out.push({ x: an.x + lx * k, y: an.y - (spr.h - p.y) * k, color: p.color, size: Math.max(2, k) });
  }
  return out;
}

function say(text, x, y, color, dur) {
  if (G.reduced) return;
  anim.words.push({ text: text, x: x, y: y, t: 0, dur: dur || 0.75, color: color || THEME.fx.flash });
}
function shake(p) { if (!G.reduced) FX.shakeImpulse(p); }
function sfx(n) { SFX.play(n); }

/* --------- coreografia del combate: un guion distinto por atacante ------ */
function battleActs(A, D, ctxb) {
  const ux = ctxb.ux, uy = ctxb.uy, stand = ctxb.stand;
  const toward = function (d) { A.sr = stand.sr - uy * d; A.sc = stand.sc - ux * d; };
  const chest = function () { return bodyPoint(D.sr, D.sc, 0.55, 0); };
  const acts = [];
  const once = function (a, k, fn) { if (!a._o) a._o = {}; if (!a._o[k]) { a._o[k] = 1; fn(); } };

  function thrust(power, word) {
    const a = {
      d: 0.30,
      enter: function () { A.frame = 'attack'; },
      tick: function (u) {
        toward(0.42 * Math.sin(Math.PI * u) * power);
        if (u > 0.42 && u < 0.75) {
          once(a, 'hit', function () {
            const c = chest();
            FX.emit('slash', c.x, c.y, { dir: Math.atan2(-uy, -ux), scale: c.k * 6, color: THEME.fx.spark });
            FX.emit('sparks', c.x, c.y, { n: 14, color: THEME.fx.spark, color2: THEME.fx.spark2 });
            FX.emit('impact', c.x, c.y, { scale: c.k * 5 });
            shake(5 * power); sfx('clash');
            D.lean = 0.10 * (ux > 0 ? 1 : -1);
            if (word) say(word, c.x, c.y - c.k * 8, THEME.fx.spark);
          });
        }
        D.sc = ctxb.d0.sc + ux * 0.10 * Math.sin(Math.PI * clamp((u - 0.4) / 0.6, 0, 1));
      },
      exit: function () { A.frame = 'idle'; toward(0); D.sc = ctxb.d0.sc; D.lean = 0; }
    };
    return a;
  }

  if (A.t === 'p') {                                   /* lanza: dos estocadas */
    acts.push(thrust(0.9, null), { d: 0.10, tick: function () { } }, thrust(1.25, '¡ZAS!'));
  } else if (A.t === 'r') {                             /* golem: mazazo */
    let a1;
    a1 = {
      d: 0.40, enter: function () { A.frame = 'attack'; sfx('slash'); },
      tick: function (u) { A.lift = 7 * easeOut(u); A.squash = 1 + 0.05 * u; }
    };
    const a2 = {
      d: 0.45,
      tick: function (u) {
        A.lift = 7 * (1 - easeIn(u)); A.squash = 1 - 0.10 * easeIn(u);
        toward(0.30 * easeIn(u));
        if (u > 0.62) once(a2, 'boom', function () {
          const c = bodyPoint(D.sr, D.sc, 0.12, 0);
          FX.emit('impact', c.x, c.y, { scale: c.k * 11 });
          FX.emit('stone', c.x, c.y, { n: 22, color: THEME.fx.stone });
          FX.emit('dust', c.x, c.y, { n: 16 });
          shake(14); sfx('stone');
          say('¡CRASH!', c.x, c.y - c.k * 16, THEME.fx.stone);
          D.squash = 0.70; D.lift = 0;
        });
      },
      exit: function () { A.squash = 1; A.lift = 0; toward(0); }
    };
    acts.push(a1, a2, { d: 0.28, tick: function (u) { D.squash = lerp(0.70, 0.92, u); } });
  } else if (A.t === 'n') {                             /* caballero: embestida */
    const a = {
      d: 0.55,
      enter: function () { A.frame = 'attack'; sfx('slash'); },
      tick: function (u) {
        const p = easeInOut(u);
        A.sr = lerp(stand.sr, D.sr - uy * 0.85, p);
        A.sc = lerp(stand.sc, D.sc - ux * 0.85, p);
        A.lift = Math.abs(Math.sin(u * Math.PI * 3)) * 4;
        if (u > 0.45) once(a, 'hit', function () {
          const c = chest();
          FX.emit('slash', c.x, c.y, { dir: Math.atan2(-uy, -ux), scale: c.k * 7, color: THEME.fx.spark });
          FX.emit('sparks', c.x, c.y, { n: 18, color: THEME.fx.spark, color2: THEME.fx.spark2 });
          FX.emit('dust', c.x, c.y - c.k * 2, { n: 14 });
          shake(11); sfx('clash');
          say('¡PUM!', c.x, c.y - c.k * 10, THEME.fx.spark);
          D.lean = 0.30 * (ux > 0 ? 1 : -1); D.squash = 0.9;
        });
      },
      exit: function () { A.lift = 0; }
    };
    acts.push(a, { d: 0.22, tick: function () { } });
    ctxb.chargedPast = true;
  } else if (A.t === 'b') {                             /* hechicero: rayo magico */
    const glow = THEME.sprite[A.c].X || THEME.fx.magicW;
    const a1 = {
      d: 0.48,
      enter: function () { A.frame = 'attack'; sfx('magic'); },
      tick: function (u) {
        const tip = bodyPoint(A.sr, A.sc, 1.02, (A.flipX ? -9 : 9));
        if (Math.random() < 0.55) FX.emit('magic', tip.x, tip.y, { n: 2, color: glow, scale: tip.k });
      }
    };
    const a2 = {
      d: 0.50,
      tick: function (u) {
        if (u > 0.06) once(a2, 'bolt', function () {
          const tip = bodyPoint(A.sr, A.sc, 1.02, (A.flipX ? -9 : 9));
          const c = chest();
          FX.emit('bolt', tip.x, tip.y, { x2: c.x, y2: c.y, color: glow });
          sfx('magic');
        });
        if (u > 0.34) once(a2, 'hit', function () {
          const c = chest();
          FX.emit('magic', c.x, c.y, { n: 26, color: glow, scale: c.k });
          FX.emit('impact', c.x, c.y, { scale: c.k * 7, color: glow });
          shake(7);
          say('¡FZZZT!', c.x, c.y - c.k * 10, glow);
          D.white = true;
        });
      },
      exit: function () { D.white = false; }
    };
    acts.push(a1, a2);
  } else if (A.t === 'q') {                             /* reina: descarga arcana */
    const glow = THEME.sprite[A.c].X || THEME.fx.magicW;
    const a1 = {
      d: 0.45,
      enter: function () { A.frame = 'attack'; sfx('magic'); },
      tick: function (u) {
        A.lift = 8 * easeOut(u);
        const p = bodyPoint(A.sr, A.sc, 0.9, (A.flipX ? -7 : 7));
        if (Math.random() < 0.7) FX.emit('magic', p.x, p.y, { n: 2, color: glow, scale: p.k });
      }
    };
    const a2 = {
      d: 0.55,
      tick: function (u) {
        A.lift = 8;
        if (u > 0.12) once(a2, 'blast', function () {
          const p = bodyPoint(A.sr, A.sc, 0.9, (A.flipX ? -7 : 7));
          const c = chest();
          FX.emit('bolt', p.x, p.y, { x2: c.x, y2: c.y, color: glow });
          FX.emit('impact', c.x, c.y, { scale: c.k * 12, color: glow });
          FX.emit('magic', c.x, c.y, { n: 34, color: glow, scale: c.k });
          FX.emit('sparks', c.x, c.y, { n: 16, color: glow, color2: THEME.fx.flash });
          shake(12); sfx('capture');
          say('¡FLASH!', c.x, c.y - c.k * 12, glow);
          anim.flash = 0.55;
          D.white = true;
        });
      },
      exit: function () { D.white = false; }
    };
    acts.push(a1, a2, { d: 0.25, tick: function (u) { A.lift = 8 * (1 - u); } });
  } else {                                              /* rey: duelo a espada */
    for (let i = 0; i < 3; i++) {
      const a = {
        d: 0.26,
        enter: function () { A.frame = 'attack'; D.frame = 'attack'; },
        tick: function (u) {
          const p = Math.sin(Math.PI * u);
          toward(0.30 * p);
          D.sr = ctxb.d0.sr + uy * 0.16 * p; D.sc = ctxb.d0.sc + ux * 0.16 * p;
          if (u > 0.45) once(a, 'clash', function () {
            const mx = bodyPoint((A.sr + D.sr) / 2, (A.sc + D.sc) / 2, 0.62, 0);
            FX.emit('sparks', mx.x, mx.y, { n: 16, color: THEME.fx.spark, color2: THEME.fx.spark2 });
            FX.emit('slash', mx.x, mx.y, { dir: Math.atan2(-uy, -ux), scale: mx.k * 6, color: THEME.fx.spark2 });
            shake(6); sfx('clash');
          });
        },
        exit: function () { toward(0); D.sr = ctxb.d0.sr; D.sc = ctxb.d0.sc; A.frame = 'idle'; D.frame = 'idle'; }
      };
      acts.push(a);
    }
    const cloud = {
      d: 0.62,
      enter: function () {
        A.hidden = true; D.hidden = true;
        const mx = bodyPoint((A.sr + D.sr) / 2, (A.sc + D.sc) / 2, 0.55, 0);
        anim.cloud = { x: mx.x, y: mx.y, r: mx.k * 22, t: 0, seed: 7 };
        sfx('clash');
      },
      tick: function (u) {
        if (anim.cloud) anim.cloud.t = u;
        if (u > 0.2) once(cloud, 'w1', function () { say('¡CLANG!', anim.cloud.x - anim.cloud.r * 0.5, anim.cloud.y - anim.cloud.r * 0.7, THEME.fx.spark); });
        if (u > 0.5) once(cloud, 'w2', function () { sfx('clash'); shake(6); say('¡ZAS!', anim.cloud.x + anim.cloud.r * 0.5, anim.cloud.y - anim.cloud.r * 0.5, THEME.fx.spark2); });
        if (u > 0.78) once(cloud, 'w3', function () { sfx('slash'); });
      },
      exit: function () {
        A.hidden = false; D.hidden = false; anim.cloud = null;
        const c = chest();
        FX.emit('dust', c.x, c.y, { n: 14 });
        FX.emit('impact', c.x, c.y, { scale: c.k * 6 });
        shake(8);
        D.lean = 0.28 * (ux > 0 ? 1 : -1);
      }
    };
    acts.push(cloud);
  }
  return acts;
}

/* ------------------------ construccion de la animacion ------------------ */
function ONCE(a, k, fn) { if (!a._o) a._o = {}; if (!a._o[k]) { a._o[k] = 1; fn(); } }

function walkAct(actor, a0, a1, dur, arc, silent) {
  return {
    d: dur,
    enter: function () { if (!silent) sfx('move'); if (a1.sc !== a0.sc) actor.flipX = a1.sc < a0.sc; },
    tick: function (u, t) {
      const p = arc ? u : easeInOut(u);
      actor.sr = lerp(a0.sr, a1.sr, p);
      actor.sc = lerp(a0.sc, a1.sc, p);
      actor.frame = arc ? 'walk' : walkFrame(t);
      if (arc) actor.lift = Math.sin(Math.PI * u) * arc;
      if (u < 0.95 && Math.random() < 0.14) {
        const b = bodyPoint(actor.sr, actor.sc, 0.02, 0);
        FX.emit('dust', b.x, b.y, { n: 2 });
      }
    },
    exit: function () {
      actor.sr = a1.sr; actor.sc = a1.sc; actor.lift = 0; actor.frame = 'idle';
      const b = bodyPoint(a1.sr, a1.sc, 0.02, 0);
      FX.emit('dust', b.x, b.y, { n: 5 });
      if (!silent) sfx('land');
    }
  };
}

function deathAct(D) {
  const a = {
    d: 0.58,
    tick: function (u) {
      if (u < 0.30) { D.white = (Math.floor(u / 0.045) % 2) === 0; D.lift = 1.5 * Math.sin(u * 18); }
      else {
        ONCE(a, 'burst', function () {
          D.white = false;
          const px = spritePixelsScreen(D);
          const c = bodyPoint(D.sr, D.sc, 0.5, 0);
          FX.emit('pixelBurst', c.x, c.y, { sprite: px });
          FX.emit('smoke', c.x, c.y, { n: 10 });
          FX.emit('stars', c.x, c.y - c.k * 6, { n: 6 });
          D.hidden = true; sfx('death'); shake(6);
        });
      }
    },
    exit: function () { D.hidden = true; D.white = false; }
  };
  return a;
}

function promoAct(A, promo) {
  const a = {
    d: 0.72,
    enter: function () { sfx('promote'); },
    tick: function (u) {
      if (u < 0.35) { A.white = (Math.floor(u / 0.05) % 2) === 0; A.lift = 6 * easeOut(u / 0.35); }
      else {
        ONCE(a, 'pop', function () {
          A.white = false; A.t = promo;
          const c = bodyPoint(A.sr, A.sc, 0.6, 0);
          FX.emit('magic', c.x, c.y, { n: 30, color: THEME.sprite[A.c].G, scale: c.k });
          FX.emit('impact', c.x, c.y, { scale: c.k * 8, color: THEME.sprite[A.c].G });
          FX.emit('stars', c.x, c.y, { n: 8 });
          say('¡CORONADO!', c.x, c.y - c.k * 12, THEME.sprite[A.c].G, 1.0);
        });
        A.lift = 6 * (1 - easeIn((u - 0.35) / 0.65));
        A.scale = 1 + 0.25 * Math.sin(Math.PI * clamp((u - 0.35) / 0.65, 0, 1));
      }
    },
    exit: function () { A.lift = 0; A.scale = 1; A.white = false; }
  };
  return a;
}

function buildAnim(move, next, san) {
  anim = {
    move: move, next: next, san: san, actors: [], hide: new Set([move.from]),
    words: [], cloud: null, flash: 0, rt: 0, seq: null,
    spot: 0, spotTarget: 0, spotAt: null
  };
  const A = mkActor(move.from, move.t, move.c);
  anim.actors.push(A);
  const from = idxToRC(move.from), to = idxToRC(move.to);
  const acts = [];

  if (move.castle) {
    const rf = move.castle === 'K' ? move.to + 1 : move.to - 2;
    const rt = move.castle === 'K' ? move.to - 1 : move.to + 1;
    const R = mkActor(rf, 'r', move.c);
    anim.actors.push(R);
    anim.hide.add(rf);
    const rFrom = idxToRC(rf), rTo = idxToRC(rt);
    const kw = walkAct(A, from, to, 0.55, 0);
    const rw = walkAct(R, rFrom, rTo, 0.55, 0, true);
    acts.push({
      d: 0.60,
      enter: function () { kw.enter(); rw.enter(); sfx('castle'); },
      tick: function (u, t) { kw.tick(u, t); rw.tick(u, t); },
      exit: function () { kw.exit(); rw.exit(); }
    });
  } else if (!move.cap) {
    acts.push(walkAct(A, from, to, move.t === 'n' ? 0.52 : 0.46, move.t === 'n' ? 10 : 0));
  } else {
    /* ---------- CAPTURA: la partida logica se pausa y hay combate ---------- */
    const dsq = move.cap.sq;
    const D = mkActor(dsq, move.cap.t, move.cap.c);
    anim.actors.push(D);
    anim.hide.add(dsq);
    const dp = idxToRC(dsq);
    const len = Math.hypot(dp.sr - from.sr, dp.sc - from.sc) || 1;
    const ux = (from.sc - dp.sc) / len, uy = (from.sr - dp.sr) / len;
    const stand = { sr: dp.sr + uy * 0.66, sc: dp.sc + ux * 0.66 };
    const ctxb = { ux: ux, uy: uy, stand: stand, d0: { sr: dp.sr, sc: dp.sc }, chargedPast: false };

    acts.push({
      d: 0.48,
      enter: function () {
        sfx('move');
        A.flipX = (dp.sc - from.sc) < 0 ? true : (dp.sc - from.sc) > 0 ? false : A.flipX;
        D.flipX = !A.flipX;
      },
      tick: function (u, t) {
        const p = easeInOut(u);
        A.sr = lerp(from.sr, stand.sr, p);
        A.sc = lerp(from.sc, stand.sc, p);
        A.frame = walkFrame(t);
        if (move.t === 'n') A.lift = Math.abs(Math.sin(u * Math.PI * 2.5)) * 3;
        if (Math.random() < 0.15) { const b = bodyPoint(A.sr, A.sc, 0.02, 0); FX.emit('dust', b.x, b.y, { n: 2 }); }
      },
      exit: function () { A.sr = stand.sr; A.sc = stand.sc; A.frame = 'idle'; A.lift = 0; }
    });
    /* pausa dramatica: se miran */
    anim.spotAt = { sr: dp.sr, sc: dp.sc };
    acts.push({
      d: 0.22,
      enter: function () { if (!G.reduced) anim.spotTarget = 1; },
      tick: function (u) { D.lean = 0.05 * Math.sin(u * 22) * (ux > 0 ? 1 : -1); },
      exit: function () { D.lean = 0; }
    });
    Array.prototype.push.apply(acts, battleActs(A, D, ctxb));
    acts.push(deathAct(D));
    /* ocupacion de la casilla */
    acts.push({
      d: 0.42,
      enter: function () {
        anim.spotTarget = 0;
        A.flipX = (to.sc - A.sc) < 0 ? true : (to.sc - A.sc) > 0 ? false : A.flipX;
      },
      tick: function (u, t) {
        const p = easeInOut(u);
        A.sr = lerp(ctxb.chargedPast ? dp.sr - uy * 0.85 : stand.sr, to.sr, p);
        A.sc = lerp(ctxb.chargedPast ? dp.sc - ux * 0.85 : stand.sc, to.sc, p);
        A.frame = walkFrame(t);
      },
      exit: function () {
        A.sr = to.sr; A.sc = to.sc; A.frame = 'idle';
        const b = bodyPoint(to.sr, to.sc, 0.02, 0);
        FX.emit('dust', b.x, b.y, { n: 6 });
        sfx('capture');
      }
    });
  }

  if (move.promo) acts.push(promoAct(A, move.promo));
  anim.seq = Seq(acts, commitMove);
}

/* ------------------------------ flujo del juego ------------------------- */
function startMove(move) {
  if (G.busy || G.over) return;
  G.sel = -1; G.targets = [];
  const san = Engine.san(G.state, move);
  const next = Engine.makeMove(G.state, move);
  G.busy = true;
  if (SPEEDS[G.speedKey] === 0) {           /* modo sin animacion */
    buildAnim(move, next, san);
    seqSkip(anim.seq);
    FX.reset();
    syncUI();
    return;
  }
  buildAnim(move, next, san);
  syncUI();
}

function commitMove() {
  const mv = anim.move, next = anim.next, san = anim.san;
  G.stack.push({
    state: G.state, log: G.log.slice(), hist: G.hist.slice(),
    capW: G.captured.w.slice(), capB: G.captured.b.slice(), last: G.last
  });
  if (G.stack.length > 400) G.stack.shift();
  if (mv.cap) G.captured[mv.c].push({ t: mv.cap.t, c: mv.cap.c });
  G.log.push(san);
  G.state = next;
  G.hist.push(Engine.key(next));
  G.last = { from: mv.from, to: mv.to };
  anim = null;
  G.busy = false;
  afterMove();
}

function afterMove() {
  const st = Engine.status(G.state, G.hist);
  syncUI();
  if (st.over) {
    G.over = st;
    let text, sub;
    if (st.result === 'checkmate') {
      text = '¡JAQUE MATE!';
      sub = (st.winner === 'w' ? 'Las huestes blancas' : 'Las huestes negras') + ' se alzan con la victoria';
      sfx('win');
    } else {
      text = 'TABLAS';
      sub = st.result === 'stalemate' ? 'Rey ahogado: sin jugadas legales'
        : st.result === 'fifty' ? 'Regla de los 50 movimientos'
          : st.result === 'repetition' ? 'Triple repeticion de la posicion'
            : 'Material insuficiente para dar mate';
      sfx('lose');
    }
    showBanner(text, sub, 'over');
    return;
  }
  if (st.check) { sfx('check'); showBanner('¡JAQUE!', 'El ' + (G.state.turn === 'w' ? 'Monarca blanco' : 'Monarca negro') + ' esta amenazado', 'check'); }
  if (isAI(G.state.turn)) { G.thinking = true; G.aiTimer = G.aiDelay; }
}

function doAIMove() {
  G.thinking = false;
  if (G.over || G.busy) return;
  let mv = null;
  try { mv = AI.pick(G.state, G.aiLevel, G.hist); } catch (e) { mv = null; }
  if (!mv) {
    const ms = Engine.legalMoves(G.state);
    mv = ms.length ? ms[(Math.random() * ms.length) | 0] : null;
  }
  if (mv) startMove(mv);
}

function newGame() {
  anim = null;
  G.state = Engine.newGame();
  G.hist = [Engine.key(G.state)];
  G.stack = []; G.log = [];
  G.captured = { w: [], b: [] };
  G.sel = -1; G.targets = []; G.last = null; G.busy = false; G.over = null;
  G.promo = null; G.thinking = false; G.aiTimer = 0;
  hideBanner();
  closePromo();
  FX.reset();
  syncUI();
  if (isAI(G.state.turn)) { G.thinking = true; G.aiTimer = Math.max(G.aiDelay, 0.4); }
}

function undo() {
  if (G.busy || !G.stack.length) return;
  const back = (G.mode === 'ha' || G.mode === 'ah') && G.stack.length >= 2 ? 2 : 1;
  for (let i = 0; i < back; i++) {
    const s = G.stack.pop();
    if (!s) break;
    G.state = s.state; G.log = s.log; G.hist = s.hist;
    G.captured.w = s.capW; G.captured.b = s.capB; G.last = s.last;
  }
  G.over = null; G.sel = -1; G.targets = []; G.thinking = false; G.aiTimer = 0;
  hideBanner();
  closePromo();
  FX.reset();
  syncUI();
}

/* ================================ ESCENA =============================== */
let cv, ctx, boardCv, boardCtx, DPR = 1, boardDirty = true;

function hashRnd(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function fillQuad(g, q, color, alpha) {
  g.save();
  if (alpha != null) g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
  g.closePath(); g.fill();
  g.restore();
}
function strokeQuad(g, q, color, w, alpha) {
  g.save();
  if (alpha != null) g.globalAlpha = alpha;
  g.strokeStyle = color; g.lineWidth = w || 2; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
  g.closePath(); g.stroke();
  g.restore();
}

function drawBackdrop(g) {
  const sky = g.createLinearGradient(0, 0, 0, L.h);
  sky.addColorStop(0, THEME.scene.skyTop);
  sky.addColorStop(0.55, THEME.scene.skyBot);
  sky.addColorStop(1, THEME.scene.floor);
  g.fillStyle = sky;
  g.fillRect(0, 0, L.w, L.h);
  /* banda de niebla a la altura del horizonte */
  const fog = g.createLinearGradient(0, L.horizon - L.h * 0.10, 0, L.horizon + L.h * 0.22);
  fog.addColorStop(0, 'rgba(0,0,0,0)');
  fog.addColorStop(0.5, THEME.scene.fogFar);
  fog.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fog;
  g.fillRect(0, L.horizon - L.h * 0.10, L.w, L.h * 0.32);
  /* columnas/antorchas insinuadas a los lados */
  for (let s = -1; s <= 1; s += 2) {
    const x = L.cx + s * L.halfW * 1.18;
    const grd = g.createLinearGradient(x - 26, 0, x + 26, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, THEME.scene.vignette);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - 26, L.horizon * 0.4, 52, L.h);
  }
}

function buildBoard() {
  if (!boardCv) { boardCv = mkCanvas(1, 1); boardCtx = boardCv.getContext('2d'); }
  boardCv.width = Math.max(1, Math.round(L.w * DPR));
  boardCv.height = Math.max(1, Math.round(L.h * DPR));
  const g = boardCtx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, L.w, L.h);
  drawBackdrop(g);

  /* marco de piedra */
  const outer = [proj(-1.075, -0.045), proj(1.075, -0.045), proj(1.075, 1.05), proj(-1.075, 1.05)];
  fillQuad(g, outer, THEME.board.border);
  strokeQuad(g, outer, THEME.board.borderHi, 3, 0.85);
  const inner = [proj(-1.02, -0.012), proj(1.02, -0.012), proj(1.02, 1.014), proj(-1.02, 1.014)];
  fillQuad(g, inner, THEME.board.grout);

  /* casillas con textura pixelada */
  for (let sr = 0; sr < 8; sr++) {
    for (let sc = 0; sc < 8; sc++) {
      const q = quadOf(sr, sc);
      const light = ((sr + sc) % 2) === 0;
      fillQuad(g, q, light ? THEME.board.light : THEME.board.dark);
      const cxq = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
      const cyq = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
      const wq = Math.abs(q[2].x - q[3].x), hq = Math.abs(q[2].y - q[0].y);
      g.save();
      g.globalAlpha = 0.16;
      g.fillStyle = light ? THEME.board.lightEdge : THEME.board.darkEdge;
      const n = 7;
      for (let i = 0; i < n; i++) {
        const rx = (hashRnd(sr * 97 + sc * 13 + i) - 0.5) * wq * 0.74;
        const ry = (hashRnd(sr * 31 + sc * 71 + i * 7) - 0.5) * hq * 0.66;
        const sz = 2 + Math.floor(hashRnd(i + sr * 5 + sc) * 3);
        g.fillRect(Math.round(cxq + rx), Math.round(cyq + ry), sz * 2, sz);
      }
      g.restore();
      strokeQuad(g, q, THEME.board.grout, 1, 0.30);
    }
  }

  /* coordenadas */
  g.save();
  g.fillStyle = THEME.ui.inkDim;
  g.font = 'bold ' + Math.max(9, Math.round(L.sqW * 0.20)) + 'px ui-monospace, monospace';
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let sc = 0; sc < 8; sc++) {
    const p = proj(-1 + (sc + 0.5) / 4, 1);
    const file = String.fromCharCode(97 + (flip ? 7 - sc : sc));
    g.fillText(file, p.x, L.frontY + Math.max(6, L.h * 0.012));
  }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let sr = 0; sr < 8; sr++) {
    const p = proj(-1, (sr + 0.5) / 8);
    const rank = flip ? sr + 1 : 8 - sr;
    g.font = 'bold ' + Math.max(8, Math.round(L.sqW * 0.20 * p.s)) + 'px ui-monospace, monospace';
    g.fillText(String(rank), p.x - 5, p.y);
  }
  g.restore();
  boardDirty = false;
}

function kingSquare(color) {
  const b = G.state.b;
  for (let i = 0; i < 64; i++) if (b[i] && b[i].t === 'k' && b[i].c === color) return i;
  return -1;
}

function drawHighlights(g, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
  if (G.last) {
    for (const key of ['from', 'to']) {
      const p = idxToRC(G.last[key]);
      fillQuad(g, quadOf(p.sr, p.sc), key === 'from' ? THEME.board.lastFrom : THEME.board.lastTo, 0.55);
    }
  }
  if (G.hover >= 0 && !G.busy && !G.over) {
    const p = idxToRC(G.hover);
    strokeQuad(g, quadOf(p.sr, p.sc), THEME.board.hover, 2, 0.75);
  }
  if (G.sel >= 0) {
    const p = idxToRC(G.sel);
    fillQuad(g, quadOf(p.sr, p.sc), THEME.board.sel, 0.45 + 0.20 * pulse);
    strokeQuad(g, quadOf(p.sr, p.sc), THEME.board.selGlow, 3, 0.9);
  }
  for (const m of G.targets) {
    const p = idxToRC(m.to);
    const q = quadOf(p.sr, p.sc);
    const a = anchorOf(p.sr, p.sc);
    const rad = L.sqW * 0.15 * a.s;
    if (m.cap) {
      g.save();
      g.globalAlpha = 0.55 + 0.35 * pulse;
      g.strokeStyle = THEME.board.capRing;
      g.lineWidth = Math.max(2, rad * 0.42);
      g.beginPath();
      g.ellipse(a.x, a.y - rad * 0.5, rad * 1.9, rad * 1.05, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    } else {
      g.save();
      g.globalAlpha = 0.60 + 0.25 * pulse;
      g.fillStyle = THEME.board.moveDot;
      g.beginPath();
      g.ellipse(a.x, a.y - rad * 0.4, rad, rad * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    void q;
  }
  const st = G.state;
  if (Engine.inCheck(st, st.turn)) {
    const ks = kingSquare(st.turn);
    if (ks >= 0 && (!anim || !anim.hide.has(ks))) {
      const p = idxToRC(ks);
      fillQuad(g, quadOf(p.sr, p.sc), THEME.board.checkGlow, 0.30 + 0.30 * pulse);
    }
  }
}

function collectRenderables(time) {
  const list = [];
  const b = G.state.b;
  const breathe = G.reduced ? 0 : 0.34;
  for (let i = 0; i < 64; i++) {
    const pc = b[i];
    if (!pc) continue;
    if (anim && anim.hide.has(i)) continue;
    const p = idxToRC(i);
    /* respiracion: las huestes nunca estan del todo quietas */
    let lift = breathe * (0.5 + 0.5 * Math.sin(time * 1.6 + i * 0.83));
    /* la pieza apuntada o elegida se despega del suelo: deja claro que casilla es */
    const mine = pc.c === G.state.turn && !G.busy && !G.over;
    if (i === G.sel) lift += 3.4 + 0.6 * Math.sin(time * 7);
    else if (i === G.hover && mine) lift += 1.8;
    list.push({
      sr: p.sr, sc: p.sc, t: pc.t, c: pc.c, lift: lift, sh: pc.t === 'r' ? 1.15 : 1,
      o: { frame: 'idle', flipX: pc.c === 'b', lift: lift }
    });
  }
  if (anim) {
    for (const a of anim.actors) {
      if (a.hidden) continue;
      list.push({
        sr: a.sr, sc: a.sc, t: a.t, c: a.c, lift: a.lift, sh: a.t === 'r' ? 1.15 : 1,
        o: { frame: a.frame, flipX: a.flipX, lift: a.lift, alpha: a.alpha, white: a.white, squash: a.squash, lean: a.lean, scale: a.scale }
      });
    }
  }
  list.sort(function (x, y) { return x.sr - y.sr; });
  return list;
}

function render(time) {
  const g = ctx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (boardDirty) buildBoard();
  g.clearRect(0, 0, L.w, L.h);

  const sh = FX.shake || { x: 0, y: 0 };
  g.save();
  g.translate(sh.x || 0, sh.y || 0);

  g.drawImage(boardCv, 0, 0, L.w, L.h);
  drawHighlights(g, time);

  const list = collectRenderables(time);
  for (const it of list) drawShadow(g, it.sr, it.sc, it.lift, 0.40, it.sh);
  for (const it of list) drawSprite(g, it.t, it.c, it.sr, it.sc, it.o);

  /* foco dramatico: se oscurece el tablero y los duelistas se vuelven a pintar */
  if (anim && anim.spot > 0.01 && anim.spotAt) {
    const c = anchorOf(anim.spotAt.sr, anim.spotAt.sc);
    const rad = L.sqW * c.s;
    const grd = g.createRadialGradient(c.x, c.y - rad * 0.55, rad * 0.55, c.x, c.y - rad * 0.55, rad * 3.1);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.45, 'rgba(0,0,0,' + (0.24 * anim.spot).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,' + (0.52 * anim.spot).toFixed(3) + ')');
    g.fillStyle = grd;
    g.fillRect(0, 0, L.w, L.h);
    for (const a of anim.actors) {
      if (a.hidden) continue;
      drawShadow(g, a.sr, a.sc, a.lift, 0.40, a.t === 'r' ? 1.15 : 1);
      drawSprite(g, a.t, a.c, a.sr, a.sc, {
        frame: a.frame, flipX: a.flipX, lift: a.lift, alpha: a.alpha,
        white: a.white, squash: a.squash, lean: a.lean, scale: a.scale
      });
    }
  }

  try { FX.draw(g); } catch (e) { }

  if (anim && anim.cloud) {
    try { FX.drawFightCloud(g, anim.cloud.x, anim.cloud.y, anim.cloud.r, anim.cloud.t, anim.cloud.seed); } catch (e) { }
  }
  if (anim) {
    for (const w of anim.words) {
      try { FX.drawComicWord(g, w.x, w.y - 26 * (w.t / w.dur), w.text, w.t / w.dur, w.color); } catch (e) { }
    }
  }
  g.restore();

  if (anim && anim.flash > 0.01) {
    try { FX.drawFlash(g, L.w, L.h, anim.flash * 0.55, THEME.fx.flash); } catch (e) { }
  }

  /* vinieta */
  const vg = g.createRadialGradient(L.cx, L.h * 0.56, L.h * 0.46, L.cx, L.h * 0.56, L.h * 1.02);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.scene.vignette);
  g.save();
  g.globalAlpha = 0.72;
  g.fillStyle = vg;
  g.fillRect(0, 0, L.w, L.h);
  g.restore();
}

/* =============================== INTERFAZ ============================== */
const $ = function (id) { return document.getElementById(id); };
let UI = {};

function miniPiece(t, c, h) {
  const spr = SPR[t];
  const k = Math.max(1, Math.round(h / spr.h));
  const el = mkCanvas(spr.w * k, spr.h * k);
  const g = el.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(SHEET[t + c + 'idle'], 0, 0, spr.w * k, spr.h * k);
  el.className = 'mini';
  el.title = PIECE_NAME[t];
  return el;
}

function materialBalance() {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = G.state.b[i];
    if (!p || p.t === 'k') continue;
    s += (p.c === 'w' ? 1 : -1) * (Engine.VALUE[p.t] || 0);
  }
  return Math.round(s / 100);
}

function syncUI() {
  if (!UI.turn) return;
  const t = G.state.turn;
  UI.turn.textContent = t === 'w' ? 'TURNO BLANCO' : 'TURNO NEGRO';
  UI.turn.className = 'badge ' + (t === 'w' ? 'w' : 'b');

  let st = '';
  if (G.over) st = G.over.result === 'checkmate' ? 'Partida terminada — mate' : 'Partida terminada — tablas';
  else if (G.thinking || (G.busy && isAI(t))) st = 'La IA medita su jugada…';
  else if (isAI(t)) st = 'Turno de la IA';
  else st = 'Elige una pieza y su destino';
  UI.status.textContent = st;

  /* capturas */
  for (const side of ['w', 'b']) {
    const host = side === 'w' ? UI.capW : UI.capB;
    host.textContent = '';
    const arr = G.captured[side].slice().sort(function (a, b) { return (Engine.VALUE[b.t] || 0) - (Engine.VALUE[a.t] || 0); });
    for (const p of arr) host.appendChild(miniPiece(p.t, p.c, 22));
    if (!arr.length) { const s = document.createElement('span'); s.className = 'dim'; s.textContent = '—'; host.appendChild(s); }
  }
  const bal = materialBalance();
  UI.material.textContent = bal === 0 ? 'Material igualado' : (bal > 0 ? 'Blancas +' + bal : 'Negras +' + (-bal));

  /* historial */
  UI.moves.textContent = '';
  for (let i = 0; i < G.log.length; i += 2) {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'num'; n.textContent = (i / 2 + 1) + '.';
    const a = document.createElement('span'); a.className = 'san w'; a.textContent = G.log[i] || '';
    const b = document.createElement('span'); b.className = 'san b'; b.textContent = G.log[i + 1] || '';
    li.appendChild(n); li.appendChild(a); li.appendChild(b);
    UI.moves.appendChild(li);
  }
  UI.moves.scrollTop = UI.moves.scrollHeight;
  UI.undo.disabled = !G.stack.length || G.busy;
  UI.hint.style.display = (G.busy && anim && anim.move && anim.move.cap) ? 'block' : 'none';
}

function showBanner(text, sub, tone) {
  UI.banner.className = 'banner show ' + (tone || '');
  UI.bannerT.textContent = text;
  UI.bannerS.textContent = sub || '';
  G.banner = { t: 0, life: tone === 'over' ? 6 : 1.8 };
}
function hideBanner() { if (UI.banner) UI.banner.className = 'banner'; G.banner = null; }

function openPromo(cands) {
  G.promo = { moves: cands };
  UI.promo.className = 'promo show';
  UI.promoRow.textContent = '';
  const order = ['q', 'r', 'b', 'n'];
  for (const k of order) {
    const mv = cands.find(function (m) { return m.promo === k; });
    if (!mv) continue;
    const btn = document.createElement('button');
    btn.className = 'promoBtn';
    btn.appendChild(miniPiece(k, G.state.turn, 44));
    const lbl = document.createElement('span');
    lbl.textContent = PIECE_NAME[k];
    btn.appendChild(lbl);
    btn.onclick = function () { closePromo(); startMove(mv); };
    UI.promoRow.appendChild(btn);
  }
}
function closePromo() { G.promo = null; if (UI.promo) UI.promo.className = 'promo'; }

/* ================================ ENTRADA ============================== */
let soundArmed = false;
function armSound() { if (!soundArmed) { soundArmed = true; try { SFX.init(); } catch (e) { } } }

function canvasPoint(ev) {
  const r = cv.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function onPick(i) {
  if (G.over || G.promo) return;
  if (isAI(G.state.turn)) return;
  if (i < 0) { G.sel = -1; G.targets = []; return; }
  const pc = G.state.b[i];
  if (G.sel >= 0) {
    const cand = G.targets.filter(function (m) { return m.to === i; });
    if (cand.length) {
      if (cand.length > 1 && cand[0].promo) { G.sel = -1; G.targets = []; openPromo(cand); return; }
      startMove(cand[0]);
      return;
    }
  }
  if (pc && pc.c === G.state.turn) {
    G.sel = i;
    G.targets = Engine.movesFrom(G.state, i);
    sfx('select');
  } else {
    if (G.sel >= 0) sfx('deny');
    G.sel = -1; G.targets = [];
  }
}

function skipAnim() {
  if (!anim) return;
  try { seqSkip(anim.seq); } catch (e) { }
  if (anim) { try { commitMove(); } catch (e) { anim = null; G.busy = false; } }
  FX.reset();
  syncUI();
}

function forceFinish() { skipAnim(); }

function bindInput() {
  cv.addEventListener('pointerdown', function (ev) {
    armSound();
    if (G.promo) return;
    if (G.busy) { skipAnim(); return; }
    const p = canvasPoint(ev);
    onPick(pickSquare(p.x, p.y));
    syncUI();
  });
  cv.addEventListener('pointermove', function (ev) {
    if (G.busy || G.over) { G.hover = -1; return; }
    const p = canvasPoint(ev);
    G.hover = pickSquare(p.x, p.y);
  });
  cv.addEventListener('pointerleave', function () { G.hover = -1; });
  window.addEventListener('keydown', function (ev) {
    armSound();
    const k = ev.key.toLowerCase();
    if (k === ' ' || k === 'enter') { ev.preventDefault(); if (G.busy) skipAnim(); }
    else if (k === 'u') undo();
    else if (k === 'n') newGame();
    else if (k === 'f') { flip = !flip; boardDirty = true; }
    else if (k === 'm') { UI.sound.click(); }
    else if (k === 'escape') { closePromo(); G.sel = -1; G.targets = []; }
    syncUI();
  });
}

/* ================================ BUCLE ================================ */
let lastT = 0;
function update(dt) {
  const sdt = dt * G.timeScale;
  if (anim) {
    anim.rt += dt;
    try { seqUpdate(anim.seq, sdt); } catch (e) { forceFinish(); }
    if (anim) {
      if (anim.rt > 16) forceFinish();
      else {
        anim.flash = Math.max(0, anim.flash - dt * 2.4);
        anim.spot += (anim.spotTarget - anim.spot) * Math.min(1, dt * 5.5);
        for (let i = anim.words.length - 1; i >= 0; i--) {
          anim.words[i].t += sdt;
          if (anim.words[i].t >= anim.words[i].dur) anim.words.splice(i, 1);
        }
      }
    }
  } else if (G.thinking) {
    G.aiTimer -= dt;
    if (G.aiTimer <= 0) { doAIMove(); syncUI(); }
  }
  try { FX.update(dt); } catch (e) { }
  if (G.banner) {
    G.banner.t += dt;
    if (G.banner.t > G.banner.life) { G.banner = null; hideBanner(); }
  }
}

function frame(ts) {
  const dt = clamp((ts - lastT) / 1000, 0, 0.05);
  lastT = ts;
  try { update(dt); } catch (e) { G.busy = false; anim = null; }
  try { render(ts / 1000); } catch (e) { }
  requestAnimationFrame(frame);
}

/* =============================== ARRANQUE ============================== */
function resize() {
  const host = cv.parentElement;
  const w = Math.max(320, host.clientWidth);
  const h = Math.max(280, host.clientHeight);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(h * DPR);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  layout(w, h);
  boardDirty = true;
}

function init() {
  cv = $('board');
  ctx = cv.getContext('2d');
  UI = {
    turn: $('turn'), status: $('status'), capW: $('capW'), capB: $('capB'),
    material: $('material'), moves: $('moves'), undo: $('undo'),
    banner: $('banner'), bannerT: $('bannerT'), bannerS: $('bannerS'),
    promo: $('promo'), promoRow: $('promoRow'), sound: $('sound'), hint: $('hint')
  };
  G.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (G.reduced) { G.speedKey = 'rapido'; }

  applyThemeVars();
  harden();
  buildSheets();
  resize();
  window.addEventListener('resize', resize);

  $('new').onclick = function () { armSound(); hideBanner(); newGame(); };
  UI.undo.onclick = function () { armSound(); hideBanner(); undo(); };
  $('flip').onclick = function () { flip = !flip; boardDirty = true; };
  $('mode').onchange = function (e) { G.mode = e.target.value; hideBanner(); newGame(); };
  $('mode').value = G.mode;
  $('level').onchange = function (e) { G.aiLevel = parseInt(e.target.value, 10) || 2; };
  $('level').value = String(G.aiLevel);
  $('speed').onchange = function (e) {
    G.speedKey = e.target.value;
    G.timeScale = SPEEDS[G.speedKey] || 1;
  };
  $('speed').value = G.speedKey;
  G.timeScale = SPEEDS[G.speedKey] || 1;
  UI.sound.onclick = function () {
    armSound();
    const m = !SFX.isMuted();
    SFX.setMuted(m);
    UI.sound.textContent = m ? '🔇 Silencio' : '🔊 Sonido';
    UI.sound.setAttribute('aria-pressed', String(m));
  };
  $('skip').onclick = function () { skipAnim(); };

  bindInput();
  newGame();
  requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(frame); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* variables CSS derivadas de THEME para que la interfaz y el lienzo casen */
function applyThemeVars() {
  const r = document.documentElement.style;
  const u = THEME.ui;
  for (const k of Object.keys(u)) r.setProperty('--' + k, u[k]);
  r.setProperty('--boardLight', THEME.board.light);
  r.setProperty('--boardDark', THEME.board.dark);
  r.setProperty('--wSteel', THEME.sprite.w.A);
  r.setProperty('--bSteel', THEME.sprite.b.A);
}

/* Gancho de depuracion/pruebas automatizadas (no altera el juego). */
window.__BC = {
  G: G, Engine: Engine, AI: AI, FX: FX, SFX: SFX, THEME: THEME, SPR: SPR,
  startMove: startMove, skipAnim: skipAnim, newGame: newGame, undo: undo,
  pickSquare: pickSquare, anchorOfIdx: anchorOfIdx, syncUI: syncUI,
  setFlip: function (v) { flip = !!v; boardDirty = true; },
  setState: function (st) { G.state = st; G.hist = [Engine.key(st)]; G.stack = []; G.log = []; G.over = null; G.sel = -1; G.targets = []; G.last = null; G.busy = false; anim = null; FX.reset(); syncUI(); },
  get anim() { return anim; },
  get busy() { return G.busy; }
};

/* Blindaje: ningun fallo de un efecto o de un sonido puede tumbar la partida. */
function harden() {
  const wrap = function (obj, name, fallback) {
    const fn = typeof obj[name] === 'function' ? obj[name].bind(obj) : null;
    obj[name] = function () {
      try { return fn ? fn.apply(null, arguments) : fallback; } catch (e) { return fallback; }
    };
  };
  wrap(FX, 'emit'); wrap(FX, 'update'); wrap(FX, 'draw'); wrap(FX, 'reset');
  wrap(FX, 'shakeImpulse'); wrap(FX, 'alive', 0);
  wrap(FX, 'drawFightCloud'); wrap(FX, 'drawComicWord'); wrap(FX, 'drawFlash');
  try { if (!FX.shake || typeof FX.shake.x !== 'number') FX.shake = { x: 0, y: 0 }; } catch (e) { }
  wrap(SFX, 'play'); wrap(SFX, 'init'); wrap(SFX, 'setMuted'); wrap(SFX, 'setVolume');
  const im = typeof SFX.isMuted === 'function' ? SFX.isMuted.bind(SFX) : null;
  SFX.isMuted = function () { try { return im ? !!im() : false; } catch (e) { return false; } };
}
