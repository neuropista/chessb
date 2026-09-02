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
let layoutSerial = 0;   // sube en cada layout(): invalida las capas cacheadas
const L = { w: 0, h: 0, cx: 0, halfW: 0, frontY: 0, horizon: 0, sqW: 0, pix: 0 };

function sAt(v) { return CAM.focal / (CAM.focal + (1 - v) * CAM.depth); }

function layout(w, h) {
  layoutSerial++;
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
  if (view3d && R3.ready()) {
    const p3 = R3.project(sr, sc);
    /* El resto del codigo calcula el tamano como L.pix * s, asi que aqui se
       devuelve la escala relativa: L.pix * s = pixeles de pantalla por voxel. */
    return { x: p3.x, y: p3.y, s: p3.s / Math.max(0.0001, L.pix) };
  }
  return proj(-1 + (sc + 0.5) / 4, (sr + 0.62) / 8);
}

/* --------------------------------------------------- indices <-> pantalla */
let flip = false;
/* En 3D no se reflejan los indices: gira la camara, que es lo natural. */
let view3d = false;
function idxToRC(i) {
  const r = i >> 3, c = i & 7;
  return (flip && !view3d) ? { sr: 7 - r, sc: 7 - c } : { sr: r, sc: c };
}
function rcToIdx(sr, sc) {
  const r = (flip && !view3d) ? 7 - sr : sr, c = (flip && !view3d) ? 7 - sc : sc;
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
  if (view3d && R3.ready()) {
    const q = R3.pick(px, py);
    return q ? rcToIdx(q.sr, q.sc) : -1;
  }
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
  if (o.erode > 0) {
    /* Desintegracion: solo queda la parte que aun no ha consumido la magia. */
    const alto = spr.h * k * (1 - clamp(o.erode, 0, 1));
    ctx.beginPath();
    ctx.rect(a.x - spr.w * k, a.y - lift - spr.h * k, spr.w * k * 2, alto);
    ctx.clip();
  }
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
/* Ojo: "sin" vale 0, que es falsy; nunca usar SPEEDS[k] || 1. */
function speedScale(k) { const v = SPEEDS[k]; return typeof v === 'number' ? v : 1; }

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
    lean: 0, white: false, hidden: false, erode: 0
  };
}
function walkFrame(t) { return (Math.floor(t / 0.13) % 2) ? 'walk' : 'idle'; }

function spritePixelsScreen(a, y0, y1) {
  const an = anchorOf(a.sr, a.sc);
  const k = L.pix * an.s;
  const spr = SPR[a.t];
  const px = PXCACHE[a.t + a.c + (a.frame || 'idle')] || [];
  const out = [];
  const banda = y0 != null;
  const step = (!banda && px.length > 260) ? 2 : 1;
  for (let i = 0; i < px.length; i += step) {
    const p = px[i];
    if (banda && (p.y < y0 || p.y >= y1)) continue;
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

/* Cada sonido sale de la columna donde ocurre: el combate se oye a la
   izquierda o a la derecha segun donde este la casilla. */
function panOfCol(sc) {
  const c = flip ? 7 - sc : sc;
  return clamp(((c - 3.5) / 3.5) * 0.6, -0.6, 0.6);
}
function sfx(n, o) {
  const opts = o ? Object.assign({}, o) : {};
  if (opts.pan == null && anim && typeof anim.panSc === 'number') opts.pan = panOfCol(anim.panSc);
  SFX.play(n, opts);
}
/* Tono de la carga de poder: grave para el golem, agudo para el hechicero. */
const PITCH = { p: 1.0, n: 0.8, b: 1.35, r: 0.5, q: 1.15, k: 0.9 };

/* Golpe con peso: la animacion se congela unos milisegundos en el impacto y
   la camara da un pequeno tiron de zoom hacia el punto del golpe. */
function hitStop(sec) { if (anim && !G.reduced) anim.stop = Math.max(anim.stop || 0, sec); }
function punch(x, y, k) {
  if (!anim || G.reduced) return;
  anim.punch = { x: x, y: y, k: Math.min(1, Math.max(anim.punch ? anim.punch.k : 0, k)) };
  if (view3d && R3.ready()) { try { R3.punch(k); } catch (e) { } }
}
/* Estela: el actor deja copias translucidas de si mismo mientras carga. */
function ghostOn(a, on) { a.ghost = !!on; if (!on) return; if (!a.ghosts) a.ghosts = []; }

/* ============ PODERES: cada pieza tiene el suyo, con su nombre ============ */
const POWER = {
  p: { name: '¡CARGA DE LANZA!', color: '#e6eef8' },
  n: { name: '¡CARGA DE CABALLERIA!', color: '#ffd257' },
  b: { name: '¡RAYO ARCANO!', color: '#7ef0ff' },
  r: { name: '¡TERREMOTO!', color: '#c9b89a' },
  q: { name: '¡TORMENTA ARCANA!', color: '#ff9ae8' },
  k: { name: '¡DUELO REAL!', color: '#ffd257' }
};
/* Los efectos de la pelea duran el doble que el resto de la animacion. */
const BATTLE_STRETCH = 2;

/* --------- coreografia del combate: un guion distinto por atacante ------ */
function battleActs(A, D, ctxb) {
  const ux = ctxb.ux, uy = ctxb.uy, stand = ctxb.stand;
  const toward = function (d) { A.sr = stand.sr - uy * d; A.sc = stand.sc - ux * d; };
  const chest = function () { return bodyPoint(D.sr, D.sc, 0.55, 0); };
  const feet = function () { return bodyPoint(D.sr, D.sc, 0.06, 0); };
  const acts = [];
  const once = function (a, k, fn) { if (!a._o) a._o = {}; if (!a._o[k]) { a._o[k] = 1; fn(); } };
  const glow = THEME.sprite[A.c].X || THEME.fx.magicW;
  const gold = THEME.sprite[A.c].G;
  const dirAng = Math.atan2(-uy, -ux);
  /* Punto del arma del atacante, para que la energia salga de donde debe. */
  const weapon = function (fy) {
    return bodyPoint(A.sr, A.sc, fy == null ? 1.02 : fy, (A.flipX ? -9 : 9));
  };
  /* Cada acto se estira: la pelea dura el doble. */
  const push = function (a) { a.d = (a.d || 0) * BATTLE_STRETCH; acts.push(a); return a; };
  const pause = function (d) { return push({ d: d, tick: function () { } }); };

  /* ---- telegrafia comun: el atacante se carga de su propio poder ---- */
  const windup = {
    d: 0.42,
    enter: function () {
      A.frame = 'attack';
      sfx('charge', { pitch: PITCH[A.t] || 1 });
      const c = bodyPoint(A.sr, A.sc, 0.5, 0);
      FX.emit('impact', c.x, c.y, { scale: c.k * 5, color: POWER[A.t].color });
      FX.emit('ring', c.x, c.y + c.k * 14, { scale: c.k * 0.5, color: POWER[A.t].color, flat: 0.35, life: 0.6 });
    },
    tick: function (u) {
      A.lift = 1.2 * Math.sin(Math.PI * u);
      if (Math.random() < 0.5) {
        const w = weapon(0.55 + Math.random() * 0.5);
        FX.emit('magic', w.x, w.y, { n: 1, color: POWER[A.t].color, scale: w.k });
      }
    },
    exit: function () { A.lift = 0; }
  };
  push(windup);

  function thrust(power, word, dur) {
    const a = {
      d: dur || 0.30,
      enter: function () { A.frame = 'attack'; sfx('whoosh', { pitch: 0.9 + 0.2 * power }); ghostOn(A, power >= 1.4); },
      tick: function (u) {
        toward(0.42 * Math.sin(Math.PI * u) * power);
        if (u > 0.42 && u < 0.75) {
          once(a, 'hit', function () {
            const c = chest();
            FX.emit('slash', c.x, c.y, { dir: dirAng, scale: c.k * 6 * power, color: THEME.fx.spark });
            FX.emit('sparks', c.x, c.y, { n: 16, color: THEME.fx.spark, color2: THEME.fx.spark2 });
            FX.emit('impact', c.x, c.y, { scale: c.k * 5 * power });
            if (power >= 1.4) { FX.emit('ring', c.x, c.y, { scale: c.k * 0.7, color: THEME.fx.spark2, flat: 0.8 }); punch(c.x, c.y, 0.5); }
            hitStop(power >= 1.4 ? 0.09 : 0.04);
            shake(5 * power); sfx('clash');
            D.lean = 0.10 * power * (ux > 0 ? 1 : -1);
            if (word) say(word, c.x, c.y - c.k * 8, THEME.fx.spark, 0.9);
          });
        }
        D.sc = ctxb.d0.sc + ux * 0.10 * power * Math.sin(Math.PI * clamp((u - 0.4) / 0.6, 0, 1));
      },
      exit: function () { A.frame = 'idle'; toward(0); D.sc = ctxb.d0.sc; D.lean = 0; ghostOn(A, false); }
    };
    return a;
  }

  if (A.t === 'p') {
    /* PEON — Carga de lanza: tres estocadas encadenadas, cada una mas dura. */
    push(thrust(0.8, null, 0.26));
    pause(0.08);
    push(thrust(1.0, '¡ZAS!', 0.26));
    pause(0.10);
    const fin = push(thrust(1.5, '¡RAS!', 0.34));
    const orig = fin.tick;
    fin.tick = function (u, t) {
      orig(u, t);
      if (u > 0.5) once(fin, 'combo', function () {
        const c = chest();
        FX.emit('slash', c.x, c.y, { dir: dirAng + 0.6, scale: c.k * 7, color: THEME.fx.spark2 });
        FX.emit('slash', c.x, c.y, { dir: dirAng - 0.6, scale: c.k * 7, color: THEME.fx.spark2 });
        FX.emit('stars', c.x, c.y, { n: 6 });
      });
    };
    push({ d: 0.20, tick: function () { } });

  } else if (A.t === 'r') {
    /* TORRE — Terremoto: alza los punos, la tierra tiembla y dos mazazos. */
    const alza = {
      d: 0.45,
      enter: function () {
        A.frame = 'attack'; sfx('rumble');
        const f = feet();
        FX.emit('crack', f.x, f.y, { n: 4, scale: f.k * 0.5, power: 0.8 });
      },
      tick: function (u) {
        A.lift = 8 * easeOut(u);
        A.squash = 1 + 0.06 * u;
        if (Math.random() < 0.6) {          // la tierra se agrieta alrededor
          const f = feet();
          const ang = Math.random() * Math.PI * 2, r = f.k * (6 + Math.random() * 14);
          FX.emit('dust', f.x + Math.cos(ang) * r, f.y + Math.sin(ang) * r * 0.4, { n: 2 });
          if (Math.random() < 0.3) FX.emit('stone', f.x + Math.cos(ang) * r, f.y + Math.sin(ang) * r * 0.4, { n: 1, power: 0.35 });
        }
        if (u > 0.4) shake(2);
      }
    };
    push(alza);
    for (let g = 0; g < 2; g++) {
      const golpe = {
        d: 0.42,
        tick: function (u) {
          A.lift = 8 * (1 - easeIn(u));
          A.squash = 1 - 0.10 * easeIn(u);
          toward(0.30 * easeIn(u));
          if (u > 0.55) once(golpe, 'boom', function () {
            const c = feet();
            FX.emit('impact', c.x, c.y, { scale: c.k * (12 + g * 5) });
            FX.emit('impact', c.x, c.y, { scale: c.k * (7 + g * 4), color: THEME.fx.stone });
            FX.emit('ring', c.x, c.y, { scale: c.k * (1.4 + g * 0.6), color: THEME.fx.stone, color2: '#fff3c4', flat: 0.42, width: 4, life: 0.55 });
            FX.emit('crack', c.x, c.y, { n: 6 + g * 2, scale: c.k * 0.8, power: 1 + g * 0.5 });
            FX.emit('stone', c.x, c.y, { n: 26, color: THEME.fx.stone });
            FX.emit('dust', c.x, c.y, { n: 20 });
            FX.emit('ember', c.x, c.y, { n: 8, color: THEME.fx.spark2 });
            hitStop(0.08 + g * 0.05); punch(c.x, c.y, 0.7 + g * 0.3);
            shake(13 + g * 4); sfx('stone', { pitch: g ? 0.85 : 1 });
            say(g ? '¡CRASH!' : '¡PUM!', c.x, c.y - c.k * 18, THEME.fx.stone, 0.9);
            D.squash = 0.72 - g * 0.06;
            D.lift = 0;
          });
        },
        exit: function () { A.squash = 1; A.lift = 0; toward(0); }
      };
      push(golpe);
      if (!g) push({ d: 0.26, tick: function (u) { A.lift = 8 * easeOut(u); D.squash = lerp(0.72, 0.95, u); } });
    }
    push({ d: 0.30, tick: function (u) { D.squash = lerp(0.66, 0.90, u); } });

  } else if (A.t === 'n') {
    /* CABALLO — Carga de caballeria: retrocede, embiste y vuelve a pasar. */
    push({
      d: 0.34,
      enter: function () { A.frame = 'attack'; sfx('gallop', { pitch: 1.1 }); },
      tick: function (u) {
        A.sr = stand.sr + uy * 0.45 * easeOut(u);
        A.sc = stand.sc + ux * 0.45 * easeOut(u);
        A.lift = Math.abs(Math.sin(u * Math.PI * 2)) * 2;
      }
    });
    for (let p = 0; p < 2; p++) {
      const carga = {
        d: 0.52,
        enter: function () { A.frame = 'attack'; sfx('gallop'); sfx('whoosh', { delay: 0.12, pitch: 0.8 }); ghostOn(A, true); },
        tick: function (u) {
          const q = easeInOut(u);
          const desde = p === 0 ? 0.45 : -0.85;
          const hasta = p === 0 ? -0.85 : 0.45;
          A.sr = stand.sr + uy * lerp(desde, hasta, q);
          A.sc = stand.sc + ux * lerp(desde, hasta, q);
          A.lift = Math.abs(Math.sin(u * Math.PI * 3)) * 5;
          if (Math.random() < 0.5) {
            const b = bodyPoint(A.sr, A.sc, 0.02, 0);
            FX.emit('dust', b.x, b.y, { n: 2 });
          }
          if (u > 0.42) once(carga, 'hit', function () {
            const c = chest();
            FX.emit('slash', c.x, c.y, { dir: dirAng + (p ? 0.5 : -0.5), scale: c.k * 8, color: THEME.fx.spark });
            FX.emit('sparks', c.x, c.y, { n: 20, color: gold, color2: THEME.fx.spark2 });
            FX.emit('dust', c.x, c.y, { n: 16 });
            FX.emit('ring', c.x, c.y + c.k * 10, { scale: c.k * (0.9 + p * 0.4), color: '#d8cfb4', color2: gold, flat: 0.4 });
            hitStop(0.06 + p * 0.04); punch(c.x, c.y, 0.5 + p * 0.3);
            shake(11 + p * 3); sfx('clash');
            say(p ? '¡PLAF!' : '¡PUM!', c.x, c.y - c.k * 10, gold, 0.9);
            D.lean = (0.22 + p * 0.16) * (ux > 0 ? 1 : -1);
            D.squash = 0.92 - p * 0.06;
          });
        },
        exit: function () { A.lift = 0; ghostOn(A, false); }
      };
      push(carga);
      if (!p) push({ d: 0.16, tick: function () { } });
    }
    ctxb.chargedPast = false;
    push({ d: 0.20, tick: function () { } });

  } else if (A.t === 'b') {
    /* ALFIL — Rayo arcano: circulo de runas, canalizacion y rayo encadenado. */
    const circulo = {
      d: 0.55,
      enter: function () { A.frame = 'attack'; sfx('charge', { pitch: 1.35 }); sfx('sparkle', { delay: 0.2 }); },
      tick: function (u) {
        const w = weapon(1.02);
        /* runas girando alrededor de la gema */
        const n = 3;
        for (let i = 0; i < n; i++) {
          const ang = u * Math.PI * 4 + (i * Math.PI * 2) / n;
          const r = w.k * 9 * (1 - u * 0.45);
          FX.emit('magic', w.x + Math.cos(ang) * r, w.y + Math.sin(ang) * r * 0.6,
            { n: 1, color: glow, scale: w.k });
        }
        if (Math.random() < 0.25) sfx('sparkle');
        if (u > 0.75) once(circulo, 'carga', function () {
          FX.emit('impact', w.x, w.y, { scale: w.k * 6, color: glow });
          FX.emit('ring', w.x, w.y, { scale: w.k * 0.6, color: glow, flat: 1, life: 0.35 });
        });
      }
    };
    push(circulo);
    for (let z = 0; z < 2; z++) {
      const rayo = {
        d: 0.30,
        tick: function (u) {
          if (u > 0.05) once(rayo, 'bolt', function () {
            const w = weapon(1.02), c = chest();
            FX.emit('bolt', w.x, w.y, { x2: c.x, y2: c.y, color: glow });
            sfx('zap', { pitch: 1 + z * 0.15 });
          });
          if (u > 0.35) once(rayo, 'hit', function () {
            const c = chest();
            FX.emit('magic', c.x, c.y, { n: 18 + z * 8, color: glow, scale: c.k });
            FX.emit('impact', c.x, c.y, { scale: c.k * (6 + z * 3), color: glow });
            FX.emit('ring', c.x, c.y, { scale: c.k * (0.6 + z * 0.3), color: glow, color2: THEME.fx.flash, flat: 1, life: 0.3 });
            FX.emit('sparks', c.x, c.y, { n: 8, color: glow, color2: THEME.fx.flash });
            hitStop(0.05); punch(c.x, c.y, 0.35);
            shake(5 + z * 3);
            if (z === 1) say('¡FZZZT!', c.x, c.y - c.k * 12, glow, 1.0);
            D.white = true;
          });
        },
        exit: function () { D.white = false; }
      };
      push(rayo);
      push({ d: 0.10, tick: function () { } });
    }

  } else if (A.t === 'q') {
    /* REINA — Tormenta arcana: se eleva, invoca proyectiles y estalla. */
    const sube = {
      d: 0.50,
      enter: function () { A.frame = 'attack'; sfx('charge', { pitch: 1.15 }); sfx('magic', { delay: 0.25 }); },
      tick: function (u) {
        A.lift = 10 * easeOut(u);
        const w = weapon(0.95);
        const ang = u * Math.PI * 6;
        FX.emit('magic', w.x + Math.cos(ang) * w.k * 7, w.y + Math.sin(ang) * w.k * 4,
          { n: 2, color: glow, scale: w.k });
      }
    };
    push(sube);
    const lluvia = {
      d: 0.70,
      tick: function (u) {
        A.lift = 10;
        const c = chest();
        /* proyectiles que caen del cielo sobre el defensor */
        if (Math.random() < 0.55) {
          const dx = (Math.random() - 0.5) * c.k * 26;
          FX.emit('bolt', c.x + dx, c.y - c.k * 40, { x2: c.x + dx * 0.3, y2: c.y, color: glow, branches: 1 });
          FX.emit('magic', c.x + dx * 0.3, c.y, { n: 5, color: glow, scale: c.k });
          FX.emit('impact', c.x + dx * 0.3, c.y, { scale: c.k * 3, color: glow });
          FX.emit('ring', c.x + dx * 0.3, c.y + c.k * 2, { scale: c.k * 0.35, color: glow, flat: 0.5, life: 0.28 });
          shake(3);
          sfx('zap', { pitch: 0.9 + Math.random() * 0.4 });
        }
        if (u > 0.2) D.white = (Math.floor(u * 14) % 2) === 0 && !G.reduced;
      },
      exit: function () { D.white = false; }
    };
    push(lluvia);
    const estallido = {
      d: 0.46,
      tick: function (u) {
        A.lift = 10;
        if (u > 0.15) once(estallido, 'blast', function () {
          const w = weapon(0.95), c = chest();
          FX.emit('bolt', w.x, w.y, { x2: c.x, y2: c.y, color: glow });
          FX.emit('impact', c.x, c.y, { scale: c.k * 14, color: glow });
          FX.emit('impact', c.x, c.y, { scale: c.k * 9, color: THEME.fx.flash });
          FX.emit('ring', c.x, c.y, { scale: c.k * 2.2, color: glow, color2: THEME.fx.flash, flat: 0.55, width: 4, life: 0.6 });
          FX.emit('ring', c.x, c.y, { scale: c.k * 1.3, color: THEME.fx.flash, color2: glow, flat: 1, life: 0.4 });
          FX.emit('magic', c.x, c.y, { n: 40, color: glow, scale: c.k });
          FX.emit('sparks', c.x, c.y, { n: 20, color: glow, color2: THEME.fx.flash });
          FX.emit('ember', c.x, c.y, { n: 14, color: glow, color2: THEME.fx.flash });
          hitStop(0.12); punch(c.x, c.y, 1);
          shake(13); sfx('thunder'); sfx('capture', { delay: 0.03 });
          say('¡FLASH!', c.x, c.y - c.k * 14, glow, 1.1);
          if (!G.reduced) { anim.flash = 0.55; anim.flashColor = glow; }
          D.white = true;
        });
      },
      exit: function () { D.white = false; }
    };
    push(estallido);
    push({ d: 0.28, tick: function (u) { A.lift = 10 * (1 - u); } });

  } else {
    /* REY — Duelo real: cinco mandobles, nube de pelea y tajo final. */
    for (let i = 0; i < 5; i++) {
      const choque = {
        d: 0.24,
        enter: function () { A.frame = 'attack'; D.frame = 'attack'; if (i === 0) sfx('fanfare'); sfx('whoosh', { pitch: 1 + i * 0.05 }); },
        tick: function (u) {
          const q = Math.sin(Math.PI * u);
          toward(0.30 * q);
          D.sr = ctxb.d0.sr + uy * 0.16 * q;
          D.sc = ctxb.d0.sc + ux * 0.16 * q;
          if (u > 0.45) once(choque, 'clash', function () {
            const mx = bodyPoint((A.sr + D.sr) / 2, (A.sc + D.sc) / 2, 0.62, 0);
            FX.emit('sparks', mx.x, mx.y, { n: 14 + i * 3, color: THEME.fx.spark, color2: THEME.fx.spark2 });
            FX.emit('slash', mx.x, mx.y, { dir: dirAng + (i % 2 ? 0.7 : -0.7), scale: mx.k * 6, color: THEME.fx.spark2 });
            if (i >= 3) FX.emit('ring', mx.x, mx.y, { scale: mx.k * 0.5, color: THEME.fx.spark, flat: 1, life: 0.25 });
            hitStop(0.03 + i * 0.01);
            shake(5 + i); sfx('clash', { pitch: 0.9 + i * 0.06 });
            if (i === 2) say('¡CLANG!', mx.x, mx.y - mx.k * 9, THEME.fx.spark, 0.9);
          });
        },
        exit: function () { toward(0); D.sr = ctxb.d0.sr; D.sc = ctxb.d0.sc; A.frame = 'idle'; D.frame = 'idle'; }
      };
      push(choque);
    }
    const nube = {
      d: 0.70,
      enter: function () {
        A.hidden = true; D.hidden = true;
        const mx = bodyPoint((A.sr + D.sr) / 2, (A.sc + D.sc) / 2, 0.55, 0);
        anim.cloud = { x: mx.x, y: mx.y, r: mx.k * 22, t: 0, seed: 7 };
        sfx('clash');
      },
      tick: function (u) {
        if (anim.cloud) anim.cloud.t = u;
        if (u > 0.15) once(nube, 'w1', function () {
          say('¡ZAS!', anim.cloud.x - anim.cloud.r * 0.6, anim.cloud.y - anim.cloud.r * 0.7, THEME.fx.spark, 0.8);
          sfx('slash');
        });
        if (u > 0.42) once(nube, 'w2', function () {
          sfx('clash'); shake(6);
          say('¡TOMA!', anim.cloud.x + anim.cloud.r * 0.6, anim.cloud.y - anim.cloud.r * 0.4, THEME.fx.spark2, 0.8);
        });
        if (u > 0.70) once(nube, 'w3', function () {
          sfx('slash'); shake(5);
          say('¡PLAF!', anim.cloud.x, anim.cloud.y - anim.cloud.r * 0.9, gold, 0.8);
        });
      },
      exit: function () {
        A.hidden = false; D.hidden = false; anim.cloud = null;
        const c = chest();
        FX.emit('dust', c.x, c.y, { n: 16 });
        FX.emit('impact', c.x, c.y, { scale: c.k * 7 });
        shake(8);
        D.lean = 0.28 * (ux > 0 ? 1 : -1);
      }
    };
    push(nube);
    const tajo = {
      d: 0.40,
      enter: function () { A.frame = 'attack'; sfx('whoosh', { pitch: 0.7 }); ghostOn(A, true); },
      tick: function (u) {
        toward(0.34 * Math.sin(Math.PI * u));
        if (u > 0.4) once(tajo, 'final', function () {
          const c = chest();
          FX.emit('slash', c.x, c.y, { dir: dirAng, scale: c.k * 10, color: gold });
          FX.emit('impact', c.x, c.y, { scale: c.k * 10, color: gold });
          FX.emit('ring', c.x, c.y, { scale: c.k * 1.6, color: gold, color2: THEME.fx.flash, flat: 0.7, width: 4, life: 0.5 });
          FX.emit('sparks', c.x, c.y, { n: 22, color: gold, color2: THEME.fx.flash });
          hitStop(0.11); punch(c.x, c.y, 0.9);
          shake(12); sfx('clash', { pitch: 0.8 }); sfx('capture', { delay: 0.02 });
          say('¡RAS!', c.x, c.y - c.k * 12, gold, 1.0);
        });
      },
      exit: function () { toward(0); A.frame = 'idle'; ghostOn(A, false); }
    };
    push(tajo);
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
      if (arc) FX.emit('ring', b.x, b.y, { scale: b.k * 0.45, color: '#d8cfb4', flat: 0.4, life: 0.3, width: 2 });
      if (!silent) sfx('land');
    }
  };
}

/* El alfil no derriba: su varita deshace al enemigo pixel a pixel. */
function disintegrateAct(D, A) {
  const glow = THEME.sprite[A.c].X || THEME.fx.magicW;
  const spr = SPR[D.t];
  let consumido = 0;                       // filas ya deshechas, contadas desde los pies
  const a = {
    d: 1.15 * BATTLE_STRETCH,
    enter: function () {
      sfx('disintegrate');
      A.frame = 'attack';
      const c = bodyPoint(D.sr, D.sc, 0.5, 0);
      FX.emit('impact', c.x, c.y, { scale: c.k * 8, color: glow });
      FX.emit('ring', c.x, c.y, { scale: c.k * 0.9, color: glow, flat: 1, life: 0.45 });
      say('¡DESINTEGRADO!', c.x, c.y - c.k * 14, glow, 1.3);
    },
    tick: function (u) {
      /* el rayo se mantiene enganchado mientras dura la desintegracion */
      if (u < 0.9 && Math.random() < 0.7) {
        const w = bodyPoint(A.sr, A.sc, 1.02, (A.flipX ? -9 : 9));
        const c = bodyPoint(D.sr, D.sc, 0.55 - u * 0.3, 0);
        FX.emit('bolt', w.x, w.y, { x2: c.x, y2: c.y, color: glow });
      }
      D.white = !G.reduced && u < 0.8;
      D.lift = 1.6 * u;
      /* la magia consume la figura de abajo arriba; cada fila que desaparece
         sale despedida en forma de motas con su propio color */
      const objetivo = clamp(u / 0.85, 0, 1);
      D.erode = objetivo;
      const filaObj = Math.floor(objetivo * spr.h);
      while (consumido < filaObj) {
        const y1 = spr.h - consumido, y0 = Math.max(0, y1 - 2);
        const motas = spritePixelsScreen(D, y0, y1);
        const w = bodyPoint(A.sr, A.sc, 1.02, (A.flipX ? -9 : 9));   // la gema de la vara
        for (let i = 0; i < motas.length; i += 2) {
          const m = motas[i];
          /* la mitad sale volando como magia; la otra mitad la absorbe la vara */
          if (i % 4 === 0) FX.emit('vortex', m.x, m.y, { n: 1, x2: w.x, y2: w.y, color: m.color, color2: glow, pixel: m.size });
          else FX.emit('magic', m.x, m.y, { n: 1, color: Math.random() < 0.45 ? glow : m.color, scale: m.size });
        }
        if (Math.random() < 0.35) sfx('sparkle');
        consumido += 2;
      }
      if (u > 0.6 && Math.random() < 0.25) {
        const c = bodyPoint(D.sr, D.sc, 0.5, 0);
        FX.emit('sparks', c.x, c.y, { n: 3, color: glow, color2: THEME.fx.flash });
      }
    },
    exit: function () {
      D.hidden = true; D.white = false; D.erode = 1;
      const c = bodyPoint(D.sr, D.sc, 0.45, 0);
      FX.emit('magic', c.x, c.y, { n: 28, color: glow, scale: c.k });
      FX.emit('impact', c.x, c.y, { scale: c.k * 10, color: glow });
      FX.emit('ring', c.x, c.y, { scale: c.k * 1.4, color: glow, color2: THEME.fx.flash, flat: 1, life: 0.5 });
      FX.emit('stars', c.x, c.y, { n: 6 });
      const w = bodyPoint(A.sr, A.sc, 1.02, (A.flipX ? -9 : 9));
      FX.emit('impact', w.x, w.y, { scale: w.k * 5, color: glow });
      shake(6); sfx('death'); sfx('zap', { delay: 0.05, pitch: 1.4 });
    }
  };
  return a;
}

function deathAct(D) {
  const a = {
    d: 0.58 * BATTLE_STRETCH,
    tick: function (u) {
      if (u < 0.34) {
        /* El parpadeo va a ~11 Hz: se anula con prefers-reduced-motion. */
        D.white = G.reduced ? false : (Math.floor(u / 0.030) % 2) === 0;
        D.lift = G.reduced ? 0 : 1.5 * Math.sin(u * 26);
        if (!G.reduced && Math.random() < 0.35) {
          const c = bodyPoint(D.sr, D.sc, 0.4 + Math.random() * 0.4, 0);
          FX.emit('sparks', c.x, c.y, { n: 2, color: THEME.fx.spark, color2: THEME.fx.flash });
        }
      }
      else {
        ONCE(a, 'burst', function () {
          D.white = false;
          const px = spritePixelsScreen(D);
          const c = bodyPoint(D.sr, D.sc, 0.5, 0);
          FX.emit('pixelBurst', c.x, c.y, { sprite: px });
          FX.emit('smoke', c.x, c.y, { n: 10 });
          FX.emit('ring', c.x, c.y + c.k * 12, { scale: c.k * 1.1, color: '#d8cfb4', color2: THEME.fx.spark, flat: 0.4, life: 0.5 });
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
      if (u < 0.35) { A.white = G.reduced ? false : (Math.floor(u / 0.05) % 2) === 0; A.lift = 6 * easeOut(u / 0.35); }
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
    words: [], cloud: null, flash: 0, flashColor: null, rt: 0, seq: null,
    spot: 0, spotTarget: 0, spotAt: null, powerLabel: null, powerBy: '',
    stop: 0, punch: null, panSc: idxToRC(move.cap ? move.cap.sq : move.to).sc
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
    const vx = (from.sc - dp.sc) / len, vy = (from.sr - dp.sr) / len;
    /* En una captura por la misma columna (vx = 0) los dos duelistas caerian en
       la misma vertical de pantalla y uno taparia al otro: la perspectiva
       comprime la separacion en profundidad casi a cero en las filas lejanas.
       Se anade un desplazamiento lateral hacia el centro del tablero. */
    const side = dp.sc <= 3.5 ? 1 : -1;
    const lateral = side * 0.62 * (1 - Math.min(1, Math.abs(vx) / 0.55));
    const stand = { sr: dp.sr + vy * 0.66, sc: dp.sc + vx * 0.66 + lateral };
    /* El vector de ataque se recalcula desde el puesto real, para que las
       estocadas y embestidas sigan apuntando al defensor. */
    const adx = stand.sc - dp.sc, ady = stand.sr - dp.sr;
    const alen = Math.hypot(adx, ady) || 1;
    const ux = adx / alen, uy = ady / alen;
    const ctxb = { ux: ux, uy: uy, stand: stand, d0: { sr: dp.sr, sc: dp.sc }, chargedPast: false };

    acts.push({
      d: 0.48,
      enter: function () {
        sfx('move');
        A.flipX = stand.sc > dp.sc;   // se giran el uno hacia el otro
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
      d: 0.40,
      enter: function () {
        if (!G.reduced) anim.spotTarget = 1;
        /* Cada pieza anuncia su propio poder antes de emplearlo. */
        const pw = POWER[move.t];
        if (pw) {
          anim.powerLabel = { text: pw.name, color: pw.color, t: 0, dur: 1.5, t2: move.t, c: move.c };
          anim.powerBy = PIECE_NAME[move.t].toUpperCase();
        }
        sfx('horn', { pitch: 1.3 });
      },
      tick: function (u) { D.lean = 0.05 * Math.sin(u * 22) * (ux > 0 ? 1 : -1); },
      exit: function () { D.lean = 0; }
    });
    Array.prototype.push.apply(acts, battleActs(A, D, ctxb));
    acts.push(move.t === 'b' ? disintegrateAct(D, A) : deathAct(D));
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
        FX.emit('ring', b.x, b.y, { scale: b.k * 0.5, color: '#d8cfb4', flat: 0.4, life: 0.3, width: 2 });
        sfx('land');
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
  /* Se retrocede al menos una jugada y, si hay un humano en la partida, hasta
     que le vuelva a tocar a el. */
  for (let i = 0; i < 8 && G.stack.length; i++) {
    const s = G.stack.pop();
    G.state = s.state; G.log = s.log; G.hist = s.hist;
    G.captured.w = s.capW; G.captured.b = s.capB; G.last = s.last;
    if (G.mode === 'aa' || !isAI(G.state.turn)) break;
  }
  G.over = null; G.sel = -1; G.targets = []; G.thinking = false; G.aiTimer = 0;
  hideBanner();
  closePromo();
  FX.reset();
  /* Si el turno restaurado es de la IA (modos 'ah' y 'aa', o el principio de
     la partida), hay que volver a darle cuerda: nadie mas lo hara. */
  if (isAI(G.state.turn)) { G.thinking = true; G.aiTimer = Math.max(G.aiDelay, 0.4); }
  syncUI();
}

/* ================================ ESCENA =============================== */
let cv, ctx, cv3d, boardCv, boardCtx, DPR = 1, boardDirty = true;
let vigCv = null;              // vineta prerenderizada
let spotCv = null, spotKey = '';  // foco del combate prerenderizado

/* '#rrggbb' o 'rgba(r,g,b,a)' -> [r,g,b,a] normalizado, para WebGL. */
const RGBA_CACHE = Object.create(null);
function cssRGBA(str, mulA) {
  let v = RGBA_CACHE[str];
  if (!v) {
    v = [1, 0, 1, 1];
    if (typeof str === 'string') {
      if (str.charAt(0) === '#') {
        let h = str.slice(1);
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        const n = parseInt(h, 16);
        v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
      } else {
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(',').map(function (x) { return parseFloat(x); });
          v = [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255, p.length > 3 ? p[3] : 1];
        }
      }
    }
    RGBA_CACHE[str] = v;
  }
  return mulA == null ? v : [v[0], v[1], v[2], v[3] * mulA];
}

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
  buildVignette();
  boardDirty = false;
}

/* Rellenar un degradado radial a pantalla completa cuesta ~15 ms con
   devicePixelRatio 2; pintado una vez y blitado, ~3 ms. */
function buildVignette() {
  if (!vigCv) vigCv = mkCanvas(1, 1);
  vigCv.width = Math.max(1, Math.round(L.w * DPR));
  vigCv.height = Math.max(1, Math.round(L.h * DPR));
  const g = vigCv.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, L.w, L.h);
  const vg = g.createRadialGradient(L.cx, L.h * 0.56, L.h * 0.46, L.cx, L.h * 0.56, L.h * 1.02);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.scene.vignette);
  g.globalAlpha = 0.72;
  g.fillStyle = vg;
  g.fillRect(0, 0, L.w, L.h);
}

/* El foco del duelo no cambia de sitio durante el combate: solo su opacidad. */
function spotLayer(sr, sc) {
  const key = sr + ',' + sc + ',' + layoutSerial + ',' + DPR;
  if (spotCv && spotKey === key) return spotCv;
  if (!spotCv) spotCv = mkCanvas(1, 1);
  spotCv.width = Math.max(1, Math.round(L.w * DPR));
  spotCv.height = Math.max(1, Math.round(L.h * DPR));
  const g = spotCv.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, L.w, L.h);
  const c = anchorOf(sr, sc);
  const rad = L.sqW * c.s;
  const grd = g.createRadialGradient(c.x, c.y - rad * 0.55, rad * 0.55, c.x, c.y - rad * 0.55, rad * 3.1);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.24)');
  grd.addColorStop(1, 'rgba(0,0,0,0.52)');
  g.fillStyle = grd;
  g.fillRect(0, 0, L.w, L.h);
  spotKey = key;
  return spotCv;
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
      if (a.ghosts) for (const gh of a.ghosts) {
        list.push({
          sr: gh.sr - 0.001, sc: gh.sc, t: a.t, c: a.c, lift: gh.lift, sh: 0, ghost: true,
          o: { frame: gh.frame, flipX: gh.flipX, lift: gh.lift, alpha: gh.a * 0.6 }
        });
      }
      list.push({
        sr: a.sr, sc: a.sc, t: a.t, c: a.c, lift: a.lift, sh: a.t === 'r' ? 1.15 : 1,
        o: { frame: a.frame, flipX: a.flipX, lift: a.lift, alpha: a.alpha, white: a.white, squash: a.squash, lean: a.lean, scale: a.scale, erode: a.erode }
      });
    }
  }
  list.sort(function (x, y) { return x.sr - y.sr; });
  return list;
}

/* ------------------------------ escena 3D ------------------------------ */
function facingIdle(c) { return c === 'w' ? 0 : Math.PI; }
function facingTo(a, other) {
  if (!other) return a.flipX ? Math.PI : 0;
  const dx = (other.sc - a.sc), dz = (other.sr - a.sr);
  if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return a.flipX ? Math.PI : 0;
  return Math.atan2(-dz, dx);
}

function buildScene3d(time) {
  const pieces = [];
  const marks = [];
  const b = G.state.b;
  const breathe = G.reduced ? 0 : 0.34;
  const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);

  for (let i = 0; i < 64; i++) {
    const pc = b[i];
    if (!pc) continue;
    if (anim && anim.hide.has(i)) continue;
    const p = idxToRC(i);
    let lift = breathe * (0.5 + 0.5 * Math.sin(time * 1.6 + i * 0.83));
    const mine = pc.c === G.state.turn && !G.busy && !G.over;
    if (i === G.sel) lift += 3.4 + 0.6 * Math.sin(time * 7);
    else if (i === G.hover && mine) lift += 1.8;
    pieces.push({
      t: pc.t, c: pc.c, sr: p.sr, sc: p.sc,
      lift: lift, facing: facingIdle(pc.c)
    });
  }
  if (anim) {
    const A = anim.actors[0], D = anim.actors[1];
    for (const a of anim.actors) {
      if (a.hidden) continue;
      const otro = (a === A && D && !D.hidden) ? D : (a === D ? A : null);
      if (a.ghosts) for (const gh of a.ghosts) {
        pieces.push({ t: a.t, c: a.c, sr: gh.sr, sc: gh.sc, lift: gh.lift, alpha: gh.a * 0.5, facing: facingTo(a, otro) });
      }
      pieces.push({
        t: a.t, c: a.c, sr: a.sr, sc: a.sc,
        lift: a.lift, squash: a.squash, scale: a.scale, lean: a.lean,
        white: a.white, alpha: a.alpha, erode: a.erode,
        facing: facingTo(a, otro)
      });
    }
  }

  const mark = function (idx, color, r, soft) {
    const p = idxToRC(idx);
    marks.push({ sr: p.sr, sc: p.sc, color: color, r: r, soft: soft });
  };
  if (G.last) {
    mark(G.last.from, cssRGBA(THEME.board.lastFrom, 1.6), 0.47, false);
    mark(G.last.to, cssRGBA(THEME.board.lastTo, 1.6), 0.47, false);
  }
  if (G.hover >= 0 && !G.busy && !G.over) mark(G.hover, cssRGBA(THEME.board.hover, 0.35), 0.47, false);
  if (G.sel >= 0) mark(G.sel, cssRGBA(THEME.board.sel, 0.30 + 0.22 * pulse), 0.47, false);
  for (const m of G.targets) {
    if (m.cap) mark(m.to, cssRGBA(THEME.board.capRing, 0.40 + 0.30 * pulse), 0.46, true);
    else mark(m.to, cssRGBA(THEME.board.moveDot, 0.55 + 0.25 * pulse), 0.17, true);
  }
  const st = G.state;
  if (Engine.inCheck(st, st.turn)) {
    const ks = kingSquare(st.turn);
    if (ks >= 0 && (!anim || !anim.hide.has(ks))) {
      mark(ks, cssRGBA(THEME.board.checkGlow, 0.55 + 0.45 * pulse), 0.47, true);
    }
  }
  return {
    pieces: pieces, marks: marks,
    shake: FX.shake || { x: 0, y: 0 },
    bg: THEME.scene.skyBot
  };
}

/* Coordenadas proyectadas al borde del tablero, tambien en 3D. */
function drawCoords3d(g) {
  g.save();
  g.fillStyle = THEME.ui.inkDim;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = Math.max(9, Math.round(L.h * 0.019));
  g.font = 'bold ' + fs + 'px ui-monospace, monospace';
  g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.75)';
  const etiqueta = function (txt, x, y) { g.strokeText(txt, x, y); g.fillText(txt, x, y); };
  const cerca = flip ? -0.92 : 7.92;      // borde que da al jugador
  const lado = flip ? 7.92 : -0.92;
  for (let sc = 0; sc < 8; sc++) {
    const w = R3.squareWorld(cerca, sc);
    const p = R3.worldToScreen(w.x, 0.02, w.z);
    if (p.ok) etiqueta(String.fromCharCode(97 + sc), p.x, p.y);
  }
  for (let sr = 0; sr < 8; sr++) {
    const w = R3.squareWorld(sr, lado);
    const p = R3.worldToScreen(w.x, 0.02, w.z);
    if (p.ok) etiqueta(String(8 - sr), p.x, p.y);
  }
  g.restore();
}

function render3d(time) {
  const g = ctx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, L.w, L.h);
  try { R3.draw(buildScene3d(time)); } catch (e) { }
  try { drawCoords3d(g); } catch (e) { }
  try { FX.draw(g); } catch (e) { }
  if (anim && anim.cloud) {
    try { FX.drawFightCloud(g, anim.cloud.x, anim.cloud.y, anim.cloud.r, anim.cloud.t, anim.cloud.seed); } catch (e) { }
  }
  if (anim) {
    for (const w of anim.words) {
      try { FX.drawComicWord(g, w.x, w.y - 26 * (w.t / w.dur), w.text, w.t / w.dur, w.color); } catch (e) { }
    }
  }
  drawOverlays(g);
  drawPowerLabel(g);
}

function render(time) {
  if (view3d && R3.ready()) { render3d(time); return; }
  const g = ctx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (boardDirty) buildBoard();
  g.clearRect(0, 0, L.w, L.h);

  const sh = FX.shake || { x: 0, y: 0 };
  g.save();
  g.translate(sh.x || 0, sh.y || 0);
  if (anim && anim.punch && anim.punch.k > 0.01) {
    /* zoom breve hacia el punto del golpe */
    const z = 1 + 0.045 * anim.punch.k;
    g.translate(anim.punch.x, anim.punch.y);
    g.scale(z, z);
    g.translate(-anim.punch.x, -anim.punch.y);
  }

  g.drawImage(boardCv, 0, 0, L.w, L.h);
  drawHighlights(g, time);

  const list = collectRenderables(time);
  for (const it of list) if (!it.ghost) drawShadow(g, it.sr, it.sc, it.lift, 0.40, it.sh);
  for (const it of list) drawSprite(g, it.t, it.c, it.sr, it.sc, it.o);

  /* foco dramatico: se oscurece el tablero y los duelistas se vuelven a pintar */
  if (anim && anim.spot > 0.01 && anim.spotAt) {
    g.save();
    g.globalAlpha = clamp(anim.spot, 0, 1);
    g.drawImage(spotLayer(anim.spotAt.sr, anim.spotAt.sc), 0, 0, L.w, L.h);
    g.restore();
    /* Mismo criterio que collectRenderables(): primero todas las sombras y
       luego los sprites, de lejos a cerca. Sin ordenar, el defensor (que se
       anade despues) tapaba al atacante aunque estuviese mas cerca. */
    const duel = anim.actors.filter(function (a) { return !a.hidden; })
      .sort(function (x, y) { return x.sr - y.sr; });
    anim.drawOrder = duel.map(function (a) { return a.sr; });   // invariante comprobable
    for (const a of duel) drawShadow(g, a.sr, a.sc, a.lift, 0.40, a.t === 'r' ? 1.15 : 1);
    for (const a of duel) {
      if (a.ghosts) for (const gh of a.ghosts) {
        drawSprite(g, a.t, a.c, gh.sr, gh.sc, { frame: gh.frame, flipX: gh.flipX, lift: gh.lift, alpha: gh.a * 0.6 });
      }
      drawSprite(g, a.t, a.c, a.sr, a.sc, {
        frame: a.frame, flipX: a.flipX, lift: a.lift, alpha: a.alpha,
        white: a.white, squash: a.squash, lean: a.lean, scale: a.scale, erode: a.erode
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

  drawOverlays(g);
  drawPowerLabel(g);
}

/* Rotulo del poder: quien ataca y con que. */
function drawPowerLabel(g) {
  if (anim && anim.powerLabel) {
    const pl = anim.powerLabel;
    const u = clamp(pl.t / pl.dur, 0, 1);
    const y = L.h * 0.13;
    try {
      /* banda oscura que entra por la izquierda, con el filo del color del poder */
      const enter = easeOut(clamp(u / 0.18, 0, 1));
      const leave = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
      const bh = Math.max(34, L.h * 0.11);
      g.save();
      g.globalAlpha = 0.62 * leave;
      g.fillStyle = 'rgba(8,6,12,1)';
      g.fillRect(0, y - bh * 0.5, L.w * enter, bh);
      g.globalAlpha = 0.9 * leave;
      g.fillStyle = pl.color;
      g.fillRect(0, y - bh * 0.5, L.w * enter, 2);
      g.fillRect(0, y + bh * 0.5 - 2, L.w * enter, 2);
      /* retrato pixelado del atacante, en pose de ataque */
      const img = pl.t2 && SHEET[pl.t2 + pl.c + 'attack'];
      if (img && enter > 0.5) {
        const spr = SPR[pl.t2];
        const k = Math.max(1, Math.floor((bh - 6) / spr.h));
        const px = Math.round(L.w * 0.5 - Math.max(120, L.w * 0.22)) - spr.w * k;
        g.globalAlpha = clamp((enter - 0.5) * 2, 0, 1) * leave;
        g.imageSmoothingEnabled = false;
        g.drawImage(img, px, Math.round(y - spr.h * k * 0.5), spr.w * k, spr.h * k);
        g.imageSmoothingEnabled = true;
      }
      g.restore();
      FX.drawComicWord(g, L.cx, y, pl.text, u, pl.color);
      if (anim.powerBy) {
        g.save();
        g.globalAlpha = (u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1) * 0.95;
        g.font = 'bold ' + Math.max(10, Math.round(L.h * 0.020)) + 'px ui-monospace, monospace';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.lineWidth = 4; g.strokeStyle = '#15151f'; g.lineJoin = 'round';
        g.strokeText(anim.powerBy, L.cx, y - L.h * 0.035);
        g.fillStyle = THEME.ui.ink;
        g.fillText(anim.powerBy, L.cx, y - L.h * 0.035);
        g.restore();
      }
    } catch (e) { }
  }

}

/* Fogonazo a pantalla completa y vineta: van encima de todo, fuera de la
   sacudida, y son comunes a las dos vistas. */
function drawOverlays(g) {
  if (anim && anim.flash > 0.01) {
    try { FX.drawFlash(g, L.w, L.h, anim.flash * 0.55, anim.flashColor || THEME.fx.flash); } catch (e) { }
  }
  if (vigCv) g.drawImage(vigCv, 0, 0, L.w, L.h);
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
  /* se tocan solo las clases del bando: asi el latido no se corta si syncUI
     vuelve a llamarse a mitad de la animacion */
  UI.turn.classList.add('badge');
  UI.turn.classList.remove(t === 'w' ? 'b' : 'w');
  UI.turn.classList.add(t === 'w' ? 'w' : 'b');

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
    const a = document.createElement('span'); a.className = 'san w' + sanClass(G.log[i]); a.textContent = G.log[i] || '';
    const b = document.createElement('span'); b.className = 'san b' + sanClass(G.log[i + 1]); b.textContent = G.log[i + 1] || '';
    if (i + 2 >= G.log.length) li.className = 'last';
    li.appendChild(n); li.appendChild(a); li.appendChild(b);
    UI.moves.appendChild(li);
  }
  /* el distintivo del turno late cuando cambia de bando */
  if (UI.turn && lastTurnShown !== t) {
    lastTurnShown = t;
    UI.turn.classList.remove('pulse');
    void UI.turn.offsetWidth;
    UI.turn.classList.add('pulse');
  }
  if (UI.vs) {
    if (G.busy && anim && anim.move && anim.move.cap) {
      const mv = anim.move;
      UI.vs.textContent = nombreBando(mv.t, mv.c) + ' \u2694 ' + nombreBando(mv.cap.t, mv.cap.c);
    } else UI.vs.textContent = '';
  }
  UI.moves.scrollTop = UI.moves.scrollHeight;
  UI.undo.disabled = !G.stack.length || G.busy;
  if (UI.flip) UI.flip.disabled = G.busy;
  if (UI.view) UI.view.disabled = G.busy || !R3.ready();
  UI.hint.style.display = (G.busy && anim && anim.move && anim.move.cap) ? 'block' : 'none';
}

let lastTurnShown = '';
/* "Reina blanca" pero "Golem blanco": el adjetivo concuerda con la pieza. */
function nombreBando(t, c) {
  const fem = t === 'q';
  return PIECE_NAME[t] + ' ' + (c === 'w' ? (fem ? 'blanca' : 'blanco') : (fem ? 'negra' : 'negro'));
}
function sanClass(san) {
  if (!san) return '';
  let k = '';
  if (san.indexOf('x') >= 0) k += ' cap';
  if (san.indexOf('#') >= 0) k += ' mate'; else if (san.indexOf('+') >= 0) k += ' chk';
  return k;
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
/* init() es idempotente y ademas reanuda un contexto suspendido, asi que se
   llama en CADA gesto: si el navegador silencio el audio por su cuenta, el
   siguiente clic o tecla lo devuelve. */
function armSound() { soundArmed = true; try { SFX.init(); } catch (e) { } }

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

/* Girar durante una animacion dejaria a los actores en coordenadas de pantalla
   obsoletas (las casillas se reflejan pero los actores ya estan proyectados). */
function toggleFlip() {
  if (G.busy) return;
  flip = !flip;
  boardDirty = true;
  if (R3.ready()) R3.setFlip(flip);
  syncUI();
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
  /* El AudioContext necesita un gesto del usuario: vale cualquiera, incluido
     desplegar un selector (en modo IA vs IA no se toca el tablero jamas). */
  window.addEventListener('pointerdown', armSound, { capture: true });
  window.addEventListener('keydown', armSound, { capture: true });
  cv.addEventListener('pointerdown', function (ev) {
    armSound();
    if (G.promo) return;
    if (G.busy) { skipAnim(); return; }
    const p = canvasPoint(ev);
    onPick(pickSquare(p.x, p.y));
    syncUI();
  });
  cv.addEventListener('pointermove', function (ev) {
    if (G.busy || G.over) { G.hover = -1; cv.style.cursor = G.busy ? 'pointer' : ''; return; }
    const p = canvasPoint(ev);
    G.hover = pickSquare(p.x, p.y);
    /* la mano solo aparece donde el clic hace algo: pieza propia o destino */
    let mano = false;
    if (G.hover >= 0 && !isAI(G.state.turn)) {
      const pc = G.state.b[G.hover];
      if (pc && pc.c === G.state.turn) mano = true;
      else if (G.sel >= 0 && G.targets.some(function (m) { return m.to === G.hover; })) mano = true;
    }
    cv.style.cursor = mano ? 'pointer' : '';
  });
  cv.addEventListener('pointerleave', function () { G.hover = -1; cv.style.cursor = ''; });
  window.addEventListener('keydown', function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
    /* Un desplegable o un campo de texto usan las letras (busqueda por tecleo);
       un boton no, asi que los atajos siguen vivos aunque conserve el foco. */
    const typing = tag === 'select' || tag === 'input' || tag === 'textarea';
    const k = ev.key.toLowerCase();
    if (k === 'escape') { closePromo(); G.sel = -1; G.targets = []; syncUI(); return; }
    if (k === ' ' || k === 'enter') {
      /* Durante el combate la barra siempre acelera, aunque haya un boton
         enfocado: si no, activaria ese boton en mitad de la animacion.
         Fuera del combate no se toca: el control enfocado hace lo suyo y la
         barra sigue sirviendo para desplazar la pagina en movil. */
      if (G.busy) { ev.preventDefault(); armSound(); skipAnim(); syncUI(); }
      return;
    }
    if (typing) return;
    armSound();
    if (k === 'u') undo();
    else if (k === 'n') { hideBanner(); newGame(); sfx('horn'); }
    else if (k === 'f') toggleFlip();
    else if (k === 'm') { UI.sound.click(); }
    else if (k === 'v') { if (setView(view3d ? '2d' : '3d')) sfx('swoosh'); }
    else if (k === 'c') { cycleCam(); if (view3d) sfx('swoosh', { pitch: 1.2 }); }
    else return;
    syncUI();
  });
}

/* ================================ BUCLE ================================ */
let lastT = 0;
function update(dt) {
  let sdt = dt * G.timeScale;
  if (anim) {
    anim.rt += dt;
    /* hit-stop: el guion se congela unos milisegundos tras un golpe fuerte;
       el reloj real (rt) sigue, asi que el vigilante no se ve afectado */
    if (anim.stop > 0) { anim.stop -= dt; sdt = 0; }
    if (sdt > 0) { try { seqUpdate(anim.seq, sdt); } catch (e) { forceFinish(); } }
    if (anim) {
      if (anim.rt > 16) forceFinish();
      else {
        anim.flash = Math.max(0, anim.flash - dt * 2.4);
        anim.spot += (anim.spotTarget - anim.spot) * Math.min(1, dt * 5.5);
        if (anim.punch) {
          anim.punch.k -= dt * 6;
          if (anim.punch.k <= 0) anim.punch = null;
        }
        /* estelas: instantanea por fotograma mientras el actor carga */
        for (const a of anim.actors) {
          if (a.ghosts) {
            for (let i = a.ghosts.length - 1; i >= 0; i--) {
              a.ghosts[i].a -= dt * 5.5;
              if (a.ghosts[i].a <= 0) a.ghosts.splice(i, 1);
            }
            if (a.ghost && !a.hidden && sdt > 0 && !G.reduced) {
              a.ghosts.push({ sr: a.sr, sc: a.sc, lift: a.lift, frame: a.frame, flipX: a.flipX, a: 0.55 });
              if (a.ghosts.length > 7) a.ghosts.shift();
            }
          }
        }
        if (anim.powerLabel) {
          anim.powerLabel.t += sdt;
          if (anim.powerLabel.t >= anim.powerLabel.dur) anim.powerLabel = null;
        }
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
  if (view3d && R3.ready()) { try { R3.update(dt); } catch (e) { } }
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
  /* Nunca inventar un tamano mayor que el contenedor: #stage recorta el
     desbordamiento y la primera fila del tablero quedaria fuera de vista. */
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (w === L.w && h === L.h && dpr === DPR) return;   // nada que rehacer
  DPR = dpr;
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(h * DPR);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  layout(w, h);
  boardDirty = true;
  if (cv3d && R3.ready()) { try { R3.resize(w, h, DPR); } catch (e) { } }
}

/* ------------------------------ vistas ------------------------------ */
function setView(v) {
  if (G.busy) return false;                 // cambiar de vista a media animacion no
  const quiere3d = v === '3d';
  if (quiere3d && !R3.ready()) return false;
  view3d = quiere3d;
  document.body.classList.toggle('v3d', view3d);
  if (cv3d) cv3d.style.display = view3d ? 'block' : 'none';
  if (UI.camWrap) UI.camWrap.hidden = !view3d;
  if (UI.view) UI.view.value = view3d ? '3d' : '2d';
  boardDirty = true;
  if (view3d) { try { R3.setFlip(flip); R3.resize(L.w, L.h, DPR); } catch (e) { } }
  syncUI();
  return true;
}
function setCam(name) {
  if (!R3.ready()) return;
  R3.setCamera(name);
  if (UI.cam) UI.cam.value = R3.getCamera();
}
function cycleCam() {
  if (!view3d || !R3.ready()) return;
  const list = R3.cameraList();
  const i = list.findIndex(function (c) { return c.id === R3.getCamera(); });
  setCam(list[(i + 1) % list.length].id);
}

function init() {
  cv = $('board');
  ctx = cv.getContext('2d');
  UI = {
    turn: $('turn'), status: $('status'), capW: $('capW'), capB: $('capB'),
    material: $('material'), moves: $('moves'), undo: $('undo'),
    banner: $('banner'), bannerT: $('bannerT'), bannerS: $('bannerS'),
    promo: $('promo'), promoRow: $('promoRow'), sound: $('sound'), hint: $('hint'),
    flip: $('flip'), view: $('view'), cam: $('cam'), camWrap: $('camWrap'),
    vol: $('vol'), vs: $('vs')
  };
  G.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  /* Con movimiento reducido no se acelera el combate: se suprime. El usuario
     puede volver a activarlo desde el selector de Ritmo si asi lo quiere. */
  if (G.reduced) { G.speedKey = 'sin'; }

  applyThemeVars();
  harden();
  buildSheets();
  cv3d = $('board3d');
  let hay3d = false;
  try { hay3d = !!(cv3d && R3.init(cv3d, SPR)); } catch (e) { hay3d = false; }
  if (!hay3d && cv3d) {
    if (UI.view) { UI.view.value = '2d'; UI.view.disabled = true; UI.view.title = 'Este navegador no tiene WebGL'; }
  }
  /* Se arranca en 2.5D: el lienzo 3D no debe quedarse componiendo de balde. */
  if (cv3d) cv3d.style.display = 'none';
  resize();
  window.addEventListener('resize', resize);
  /* El alto de #stage cambia sin que haya evento 'resize': en el diseno de una
     columna lo dicta el panel, que crece con las capturas y la cronica. */
  if (typeof ResizeObserver !== 'undefined') {
    try { new ResizeObserver(resize).observe(cv.parentElement); } catch (e) { }
  }

  $('new').onclick = function () { armSound(); hideBanner(); newGame(); sfx('horn'); };
  UI.undo.onclick = function () { armSound(); hideBanner(); if (!G.busy && G.stack.length) sfx('undo'); undo(); };
  $('flip').onclick = function () { armSound(); if (!G.busy) sfx('swoosh', { pitch: 0.8 }); toggleFlip(); };
  if (UI.view) {
    UI.view.onchange = function (e) {
      armSound();
      if (!setView(e.target.value)) e.target.value = view3d ? '3d' : '2d';
      else sfx('swoosh');
    };
    UI.view.value = '2d';
  }
  if (UI.cam) {
    UI.cam.onchange = function (e) { armSound(); setCam(e.target.value); sfx('swoosh', { pitch: 1.2 }); };
    UI.cam.value = R3.ready() ? R3.getCamera() : 'clasica';
  }
  /* volumen: control deslizante que se recuerda entre partidas */
  if (UI.vol) {
    const guardado = leerAjuste('vol');
    if (guardado !== null) {
      const v = clamp(parseInt(guardado, 10) / 100, 0, 1);
      if (isFinite(v)) { SFX.setVolume(v); UI.vol.value = String(Math.round(v * 100)); }
    } else UI.vol.value = String(Math.round(SFX.getVolume() * 100));
    UI.vol.oninput = function (e) {
      armSound();
      const v = clamp(parseInt(e.target.value, 10) / 100, 0, 1);
      SFX.setVolume(isFinite(v) ? v : 0.7);
      guardarAjuste('vol', String(Math.round((isFinite(v) ? v : 0.7) * 100)));
      UI.vol.title = 'Volumen ' + Math.round((isFinite(v) ? v : 0.7) * 100) + '%';
    };
    UI.vol.onchange = function () { try { SFX.play('tick'); } catch (e) { } };
    UI.vol.title = 'Volumen ' + UI.vol.value + '%';
  }
  if (leerAjuste('mute') === '1') {
    /* solo se silencia: reactivar crearia un AudioContext sin gesto del usuario */
    SFX.setMuted(true);
    UI.sound.textContent = '🔇 Silencio';
    UI.sound.title = 'Activar el sonido (M)';
    UI.sound.setAttribute('aria-pressed', 'true');
  }
  $('mode').onchange = function (e) { armSound(); G.mode = e.target.value; hideBanner(); newGame(); sfx('horn'); };
  $('mode').value = G.mode;
  $('level').onchange = function (e) { armSound(); G.aiLevel = parseInt(e.target.value, 10) || 2; };
  $('level').value = String(G.aiLevel);
  $('speed').onchange = function (e) {
    armSound();
    G.speedKey = e.target.value;
    G.timeScale = speedScale(G.speedKey);
    /* Con escala 0 el secuenciador se congelaria: la animacion en curso se corta. */
    if (G.timeScale === 0 && G.busy) skipAnim();
  };
  $('speed').value = G.speedKey;
  G.timeScale = speedScale(G.speedKey);
  UI.sound.onclick = function () {
    armSound();
    const m = !SFX.isMuted();
    SFX.setMuted(m);
    if (!m) { try { SFX.init(); SFX.play('tick'); } catch (e) { } }
    UI.sound.textContent = m ? '🔇 Silencio' : '🔊 Sonido';
    UI.sound.title = m ? 'Activar el sonido (M)' : 'Silenciar (M)';
    UI.sound.setAttribute('aria-pressed', String(m));
    guardarAjuste('mute', m ? '1' : '0');
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

/* Ajustes que se recuerdan (volumen y silencio); si el almacen falla, nada pasa. */
function leerAjuste(k) { try { return window.localStorage.getItem('bc.' + k); } catch (e) { return null; } }
function guardarAjuste(k, v) { try { window.localStorage.setItem('bc.' + k, v); } catch (e) { } }

/* Gancho de depuracion/pruebas automatizadas (no altera el juego). */
window.__BC = {
  G: G, Engine: Engine, AI: AI, FX: FX, SFX: SFX, THEME: THEME, SPR: SPR,
  startMove: startMove, skipAnim: skipAnim, newGame: newGame, undo: undo,
  pickSquare: pickSquare, anchorOfIdx: anchorOfIdx, anchorOf: anchorOf, syncUI: syncUI,
  pix: function () { return L.pix; },
  setFlip: function (v) { flip = !!v; boardDirty = true; if (R3.ready()) R3.setFlip(flip); },
  setView: setView, setCam: setCam, R3: R3,
  get view() { return view3d ? '3d' : '2d'; },
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
  wrap(SFX, 'getVolume', 0.7);
  const im = typeof SFX.isMuted === 'function' ? SFX.isMuted.bind(SFX) : null;
  SFX.isMuted = function () { try { return im ? !!im() : false; } catch (e) { return false; } };
}
