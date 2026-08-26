'use strict';
/* Test de FX con un CanvasRenderingContext2D falso.
   Verifica: API 2D estandar, save/restore balanceados, globalAlpha limpio,
   ausencia de NaN, y que todas las particulas mueren. */

var fs = require('fs');
var path = require('path');

var FX_PATH = path.resolve(__dirname, '..', 'src', 'fx.js');
var src = fs.readFileSync(FX_PATH, 'utf8');
var FX = (new Function('"use strict";' + src + '\nreturn FX;'))();

// ---------------------------------------------------------------- fake ctx
var METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'fill',
  'stroke', 'fillRect', 'strokeRect', 'clearRect', 'translate', 'rotate',
  'scale', 'setTransform', 'resetTransform', 'transform', 'fillText',
  'strokeText', 'measureText', 'arc', 'arcTo', 'ellipse', 'rect', 'clip',
  'quadraticCurveTo', 'bezierCurveTo', 'setLineDash', 'getLineDash',
  'drawImage', 'createLinearGradient', 'createRadialGradient', 'createPattern'
];
var PROPS = [
  'fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineJoin',
  'lineCap', 'miterLimit', 'font', 'textAlign', 'textBaseline',
  'globalCompositeOperation', 'imageSmoothingEnabled', 'lineDashOffset',
  'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter',
  'direction'
];

var errors = [];
function fail(msg) { errors.push(msg); }

function makeCtx(canvasW, canvasH) {
  var fakeCanvas = { width: canvasW || 800, height: canvasH || 600 };
  var log = {
    depth: 0, maxDepth: 0, saves: 0, restores: 0, calls: 0,
    shadowUsed: false, filterUsed: false, badAccess: [], stack: []
  };

  var state = {
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1,
    lineJoin: 'miter', lineCap: 'butt', miterLimit: 10, font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
    lineDashOffset: 0, shadowBlur: 0, shadowColor: 'transparent',
    shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', direction: 'inherit'
  };

  function checkArgs(name, args) {
    for (var i = 0; i < args.length; i++) {
      var v = args[i];
      if (typeof v === 'number' && !isFinite(v)) {
        fail('NaN/Infinity en ' + name + ' argumento ' + i + ' (' + v + ')');
      }
    }
  }

  var target = {};
  METHODS.forEach(function (name) {
    target[name] = function () {
      log.calls++;
      checkArgs(name, arguments);
      if (name === 'save') {
        log.saves++; log.depth++;
        if (log.depth > log.maxDepth) log.maxDepth = log.depth;
        var snap = {};
        for (var k in state) snap[k] = state[k];
        log.stack.push(snap);
      } else if (name === 'restore') {
        log.restores++; log.depth--;
        if (log.depth < 0) fail('restore() sin save() correspondiente');
        var prev = log.stack.pop();
        if (prev) for (var k2 in prev) state[k2] = prev[k2];
      }
      if (name === 'measureText') return { width: String(arguments[0] || '').length * 6 };
      if (name === 'getLineDash') return [];
      if (name === 'createLinearGradient' || name === 'createRadialGradient') {
        return { addColorStop: function () {} };
      }
      return undefined;
    };
  });
  PROPS.forEach(function (p) { target[p] = state[p]; });

  var ctx = new Proxy(target, {
    get: function (t, key) {
      if (typeof key === 'symbol') return undefined;
      if (METHODS.indexOf(key) >= 0) return t[key];
      if (PROPS.indexOf(key) >= 0) return state[key];
      if (key === '__log') return log;
      if (key === '__state') return state;
      /* ctx.canvas SI forma parte de la API 2D estandar: drawFlash lo usa para
         rellenar en pixeles de dispositivo cuando anula la transformada. */
      if (key === 'canvas') return fakeCanvas;
      log.badAccess.push('get ' + String(key));
      throw new Error('Acceso fuera de la API 2D estandar: get ' + String(key));
    },
    set: function (t, key, value) {
      if (PROPS.indexOf(key) < 0) {
        log.badAccess.push('set ' + String(key));
        throw new Error('Acceso fuera de la API 2D estandar: set ' + String(key));
      }
      if (key === 'shadowBlur' && value) log.shadowUsed = true;
      if (key === 'filter' && value && value !== 'none') log.filterUsed = true;
      if (key === 'globalAlpha' && (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1)) {
        fail('globalAlpha invalido: ' + value);
      }
      state[key] = value;
      return true;
    },
    has: function (t, key) { return METHODS.indexOf(key) >= 0 || PROPS.indexOf(key) >= 0; }
  });

  return ctx;
}

// ---------------------------------------------------------------- helpers
function assert(cond, msg) { if (!cond) fail(msg); }

var KINDS = ['dust', 'sparks', 'slash', 'impact', 'stars', 'magic',
             'bolt', 'stone', 'pixelBurst', 'smoke', 'poof'];

function makeSprite(cx, cy) {
  var out = [];
  for (var y = 0; y < 12; y++) {
    for (var x = 0; x < 10; x++) {
      out.push({ x: cx - 15 + x * 3, y: cy - 18 + y * 3, color: (x + y) % 2 ? '#e8d8b0' : '#4a3a2a' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- run
var ctx = makeCtx();
var log = ctx.__log;
var DT = 1 / 60;

FX.reset();
assert(FX.alive() === 0, 'FX.alive() deberia ser 0 tras reset()');
assert(FX.shake && typeof FX.shake.x === 'number' && typeof FX.shake.y === 'number',
       'FX.shake debe ser {x,y} numerico');
var shakeRef = FX.shake;

var maxAlive = 0;
var threw = null;

try {
  for (var f = 0; f < 600; f++) {
    // emision: durante los primeros 300 frames disparamos de todo
    if (f < 300) {
      var k = KINDS[f % KINDS.length];
      var x = 100 + (f % 7) * 40;
      var y = 120 + (f % 5) * 30;
      var o = { power: 1 + (f % 3) * 0.5, scale: 0.8 + (f % 4) * 0.3, dir: (f % 12) * 0.5 };
      if (k === 'bolt') { o.x2 = x + 90; o.y2 = y - 60; o.color = '#8fdcff'; }
      if (k === 'pixelBurst') { o.sprite = makeSprite(x, y); }
      if (k === 'magic') { o.color = '#c58cff'; o.color2 = '#fff'; }
      FX.emit(k, x, y, o);

      // variantes: sin opts, con opts raros, tipo desconocido
      if (f % 17 === 0) FX.emit('dust', x, y);
      if (f % 23 === 0) FX.emit('sparks', x, y, { n: 3, color: '#fff', life: 0.2, gravity: 0 });
      if (f % 29 === 0) FX.emit('pixelBurst', x, y, { sprite: [] });
      if (f % 31 === 0) FX.emit('noExiste', x, y, {});
      if (f % 13 === 0) FX.shakeImpulse(2 + (f % 12));
    }

    FX.update(DT);
    FX.draw(ctx);

    // dibujo directo cada frame
    var t = (f % 60) / 60;
    FX.drawFightCloud(ctx, 260, 200, 46, t, f % 9);
    FX.drawComicWord(ctx, 260, 130, ['POW!', 'CLANG!', 'BAM!'][f % 3], t, '#ffd23f');
    FX.drawFlash(ctx, 640, 480, (1 - t) * 0.4, '#fff');

    if (FX.alive() > maxAlive) maxAlive = FX.alive();
    assert(isFinite(FX.shake.x) && isFinite(FX.shake.y), 'FX.shake con NaN en frame ' + f);
    assert(log.depth === 0, 'save/restore desbalanceado durante el frame ' + f + ' (depth=' + log.depth + ')');
    assert(ctx.globalAlpha === 1, 'globalAlpha sucio (' + ctx.globalAlpha + ') tras el frame ' + f);
  }
} catch (e) {
  threw = e;
}

// dt raros no deben romper nada
try {
  FX.update(0);
  FX.update(-1);
  FX.update(NaN);
  FX.update(5);
  FX.draw(ctx);
} catch (e2) {
  threw = threw || e2;
}

// ---------------------------------------------------------------- checks
assert(!threw, 'lanzo excepcion: ' + (threw && (threw.stack || threw.message)));
assert(maxAlive > 100, 'el test apenas genero particulas (max ' + maxAlive + ')');
assert(FX.alive() === 0, 'quedan ' + FX.alive() + ' particulas vivas tras 600 frames');
assert(log.saves === log.restores, 'save(' + log.saves + ') != restore(' + log.restores + ')');
assert(log.depth === 0, 'profundidad final de save/restore = ' + log.depth);
assert(ctx.globalAlpha === 1, 'globalAlpha final = ' + ctx.globalAlpha);
assert(!log.shadowUsed, 'se uso shadowBlur (prohibido por rendimiento)');
assert(!log.filterUsed, 'se uso ctx.filter (prohibido)');
assert(log.badAccess.length === 0, 'accesos fuera de la API 2D: ' + log.badAccess.join(', '));
assert(log.calls > 1000, 'apenas hubo llamadas de dibujo (' + log.calls + ')');
assert(FX.shake === shakeRef, 'FX.shake debe ser el mismo objeto (referencia estable)');
assert(FX.shake.x === 0 && FX.shake.y === 0, 'la sacudida no volvio a 0');

// reset() debe vaciar todo
FX.emit('sparks', 10, 10, { n: 50 });
FX.shakeImpulse(10);
assert(FX.alive() > 0, 'emit no genero particulas');
FX.reset();
assert(FX.alive() === 0, 'reset() no vacio el pool');
assert(FX.shake.x === 0 && FX.shake.y === 0, 'reset() no limpio la sacudida');

// el pool no debe desbordar ni asignar de mas
FX.reset();
for (var q = 0; q < 400; q++) FX.emit('sparks', 50, 50, { n: 30 });
assert(FX.alive() <= 1200, 'el pool desbordo: ' + FX.alive());
try { FX.draw(ctx); } catch (e3) { fail('draw() con pool lleno lanzo: ' + e3.message); }
assert(ctx.globalAlpha === 1, 'globalAlpha sucio tras pool lleno');
FX.reset();

// API completa
['reset', 'emit', 'update', 'draw', 'alive', 'shakeImpulse',
 'drawFightCloud', 'drawComicWord', 'drawFlash'].forEach(function (fn) {
  assert(typeof FX[fn] === 'function', 'falta FX.' + fn + '()');
});

// ---------------------------------------------------------------- report
if (errors.length) {
  console.error('FX TEST FAIL (' + errors.length + ')');
  errors.forEach(function (e) { console.error('  - ' + e); });
  process.exit(1);
}
console.log('FX TEST PASS  frames=600  maxAlive=' + maxAlive +
            '  saves=' + log.saves + '  calls=' + log.calls);
