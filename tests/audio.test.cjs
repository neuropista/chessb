/* Test del modulo SFX con un doble de AudioContext en Node. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'src', 'audio.js');

var log = {
  nodes: [],
  stops: [],
  starts: [],
  connections: [],
  disconnects: [],
  expRamps: [],
  pans: [],
  freqs: []
};

function resetLog() {
  log.nodes = [];
  log.stops = [];
  log.starts = [];
  log.connections = [];
  log.disconnects = [];
  log.expRamps = [];
  log.pans = [];
  log.freqs = [];
}

function FakeParam(name, node) {
  this.value = 0;
  this._name = name;
  this._node = node;
}
FakeParam.prototype.setValueAtTime = function (v, t) {
  this.value = v;
  if (this._name === 'pan') log.pans.push(v);
  if (this._name === 'frequency' && this._node === 'oscillator') log.freqs.push(v);
  return this;
};
FakeParam.prototype.linearRampToValueAtTime = function (v, t) { this.value = v; return this; };
FakeParam.prototype.exponentialRampToValueAtTime = function (v, t) {
  log.expRamps.push({ node: this._node, param: this._name, value: v, time: t });
  this.value = v;
  return this;
};
FakeParam.prototype.cancelScheduledValues = function () { return this; };

function FakeNode(kind) {
  this.kind = kind;
  this.connectedTo = [];
  log.nodes.push(this);
}
FakeNode.prototype.connect = function (dest) {
  this.connectedTo.push(dest);
  log.connections.push({ from: this.kind, to: dest && dest.kind ? dest.kind : 'destination' });
  return dest;
};
FakeNode.prototype.disconnect = function () {
  log.disconnects.push(this.kind);
};

function FakeOscillator() {
  FakeNode.call(this, 'oscillator');
  this.type = 'sine';
  this.frequency = new FakeParam('frequency', 'oscillator');
  this.detune = new FakeParam('detune', 'oscillator');
  this.onended = null;
}
FakeOscillator.prototype = Object.create(FakeNode.prototype);
FakeOscillator.prototype.start = function (t) { log.starts.push({ kind: 'oscillator', t: t }); };
FakeOscillator.prototype.stop = function (t) { log.stops.push({ kind: 'oscillator', t: t }); };

function FakeBufferSource() {
  FakeNode.call(this, 'bufferSource');
  this.buffer = null;
  this.playbackRate = new FakeParam('playbackRate', 'bufferSource');
  this.onended = null;
}
FakeBufferSource.prototype = Object.create(FakeNode.prototype);
FakeBufferSource.prototype.start = function (t) { log.starts.push({ kind: 'bufferSource', t: t }); };
FakeBufferSource.prototype.stop = function (t) { log.stops.push({ kind: 'bufferSource', t: t }); };

function FakeGain() {
  FakeNode.call(this, 'gain');
  this.gain = new FakeParam('gain', 'gain');
}
FakeGain.prototype = Object.create(FakeNode.prototype);

function FakeBiquad() {
  FakeNode.call(this, 'biquad');
  this.type = 'lowpass';
  this.frequency = new FakeParam('frequency', 'biquad');
  this.Q = new FakeParam('Q', 'biquad');
  this.gain = new FakeParam('gain', 'biquad');
}
FakeBiquad.prototype = Object.create(FakeNode.prototype);

function FakePanner() {
  FakeNode.call(this, 'panner');
  this.pan = new FakeParam('pan', 'panner');
}
FakePanner.prototype = Object.create(FakeNode.prototype);

function FakeCompressor() {
  FakeNode.call(this, 'compressor');
  this.threshold = new FakeParam('threshold', 'compressor');
  this.knee = new FakeParam('knee', 'compressor');
  this.ratio = new FakeParam('ratio', 'compressor');
  this.attack = new FakeParam('attack', 'compressor');
  this.release = new FakeParam('release', 'compressor');
}
FakeCompressor.prototype = Object.create(FakeNode.prototype);

function FakeConvolver() {
  FakeNode.call(this, 'convolver');
  this.buffer = null;
}
FakeConvolver.prototype = Object.create(FakeNode.prototype);

function FakeBuffer(ch, len) {
  this.numberOfChannels = ch;
  this.length = len;
  this._data = [];
  for (var i = 0; i < ch; i++) this._data.push(new Float32Array(len));
}
FakeBuffer.prototype.getChannelData = function (i) { return this._data[i || 0]; };

/* Doble completo: con compresor, reverb y paneo. */
function FakeAudioContext() {
  this.sampleRate = 44100;
  this.currentTime = 1.5;
  this.state = 'running';
  this.destination = { kind: 'destination' };
}
FakeAudioContext.prototype.createOscillator = function () { return new FakeOscillator(); };
FakeAudioContext.prototype.createGain = function () { return new FakeGain(); };
FakeAudioContext.prototype.createBiquadFilter = function () { return new FakeBiquad(); };
FakeAudioContext.prototype.createBufferSource = function () { return new FakeBufferSource(); };
FakeAudioContext.prototype.createBuffer = function (ch, len) { return new FakeBuffer(ch, len); };
FakeAudioContext.prototype.createStereoPanner = function () { return new FakePanner(); };
FakeAudioContext.prototype.createDynamicsCompressor = function () { return new FakeCompressor(); };
FakeAudioContext.prototype.createConvolver = function () { return new FakeConvolver(); };
FakeAudioContext.prototype.resume = function () { this.state = 'running'; return null; };

/* Doble minimo: un navegador viejo sin panner, compresor ni convolver. */
function FakeOldContext() { FakeAudioContext.call(this); }
FakeOldContext.prototype = Object.create(FakeAudioContext.prototype);
FakeOldContext.prototype.createStereoPanner = undefined;
FakeOldContext.prototype.createDynamicsCompressor = undefined;
FakeOldContext.prototype.createConvolver = undefined;

var failures = [];
function check(cond, msg) {
  if (!cond) failures.push('FALLO: ' + msg);
}

function cargar(AC) {
  var sandbox = { AudioContext: AC, Math: Math, isFinite: isFinite, Float32Array: Float32Array, Object: Object };
  vm.createContext(sandbox);
  var code = fs.readFileSync(SRC, 'utf8') + '\n;globalThis.__SFX__ = SFX;';
  vm.runInContext('"use strict";\n' + code, sandbox, { filename: 'audio.js' });
  return sandbox.__SFX__;
}

var SFX = cargar(FakeAudioContext);

check(typeof SFX === 'object' && SFX !== null, 'SFX debe existir');
['init', 'play', 'setMuted', 'isMuted', 'setVolume', 'getVolume', 'names', 'estado'].forEach(function (k) {
  check(typeof SFX[k] === 'function', 'SFX.' + k + ' debe ser funcion');
});

var NAMES = SFX.names();
var ESPERADOS = ['select', 'deny', 'move', 'land', 'clash', 'slash', 'magic', 'stone',
  'death', 'capture', 'check', 'castle', 'promote', 'win', 'lose', 'tick',
  'whoosh', 'gallop', 'rumble', 'thunder', 'zap', 'charge', 'disintegrate', 'fanfare',
  'sparkle', 'swoosh', 'undo', 'horn'];
ESPERADOS.forEach(function (n) { check(NAMES.indexOf(n) >= 0, 'falta la voz "' + n + '"'); });

// 1) play() antes de init() no lanza ni crea nodos.
resetLog();
try {
  NAMES.forEach(function (n) { SFX.play(n); });
  SFX.play('select', { delay: 0.1 });
} catch (e) {
  failures.push('FALLO: play() antes de init() lanzo: ' + e.message);
}
check(log.nodes.length === 0, 'sin init() no se deben crear nodos');

// 2) init() es idempotente y monta el bus (compresor + reverb).
resetLog();
var c1 = SFX.init();
var c2 = SFX.init();
check(!!c1 && c1 === c2, 'init() debe ser perezoso e idempotente');
check(log.nodes.some(function (n) { return n.kind === 'compressor'; }), 'init() debe crear el compresor');
check(log.nodes.some(function (n) { return n.kind === 'convolver'; }), 'init() debe crear la reverb');
var conv = log.nodes.filter(function (n) { return n.kind === 'convolver'; })[0];
check(conv && conv.buffer && conv.buffer.numberOfChannels === 2, 'la respuesta al impulso debe ser estereo');
check(log.connections.some(function (c) { return c.from === 'compressor' && c.to === 'destination'; }),
  'el compresor debe ir al destino');

/* El limitador de repeticiones mira el reloj del contexto: se avanza entre voces. */
function avanza(s) { c1.currentTime += (s === undefined ? 1 : s); }

// 3) cada nombre crea nodos y programa un stop; ninguna rampa exponencial recibe 0.
NAMES.forEach(function (name) {
  resetLog();
  avanza();
  try {
    SFX.play(name);
  } catch (e) {
    failures.push('FALLO: play("' + name + '") lanzo: ' + e.message);
    return;
  }
  check(log.nodes.length > 0, 'play("' + name + '") debe crear nodos');
  check(log.starts.length > 0, 'play("' + name + '") debe arrancar alguna fuente');
  check(log.stops.length > 0, 'play("' + name + '") debe programar stop()');
  check(log.starts.length === log.stops.length,
    'play("' + name + '"): cada fuente arrancada debe tener stop (' + log.starts.length + ' vs ' + log.stops.length + ')');
  check(log.connections.length > 0, 'play("' + name + '") debe conectar nodos');
  var toDest = log.connections.some(function (c) { return c.to === 'gain' || c.to === 'destination' || c.to === 'biquad'; });
  check(toDest, 'play("' + name + '") debe encaminar audio hacia la salida');
  log.expRamps.forEach(function (r) {
    check(r.value !== 0 && r.value > 0 && isFinite(r.value),
      'play("' + name + '"): exponentialRampToValueAtTime recibio ' + r.value + ' en ' + r.param);
  });
  log.freqs.forEach(function (f) {
    check(f > 0 && isFinite(f), 'play("' + name + '"): frecuencia invalida ' + f);
  });
  var dur = log.stops.reduce(function (m, s) { return Math.max(m, s.t); }, 0) - c1.currentTime;
  check(dur < 1.2, 'play("' + name + '") debe durar menos de 1.2 s (dur=' + dur.toFixed(3) + ')');
});

// 4) cleanup: onended desconecta la cadena.
resetLog();
avanza();
SFX.play('clash');
var sources = log.nodes.filter(function (n) { return typeof n.onended !== 'undefined'; });
check(sources.length > 0, 'debe haber fuentes con onended');
sources.forEach(function (s) { if (typeof s.onended === 'function') s.onended(); });
check(log.disconnects.length > 0, 'onended debe desconectar los nodos');

// 5) silenciado: no se crea ningun nodo.
SFX.setMuted(true);
check(SFX.isMuted() === true, 'isMuted() debe devolver true');
resetLog();
NAMES.forEach(function (n) { avanza(); SFX.play(n); });
check(log.nodes.length === 0, 'silenciado no debe crear nodos (creo ' + log.nodes.length + ')');
SFX.setMuted(false);
check(SFX.isMuted() === false, 'isMuted() debe devolver false');
resetLog();
avanza();
SFX.play('select');
check(log.nodes.length > 0, 'tras desilenciar debe volver a sonar');

// 6) nombre inexistente no lanza ni crea nodos.
resetLog();
avanza();
try {
  SFX.play('nombre-inexistente');
  SFX.play('');
  SFX.play(null);
  SFX.play(undefined);
  SFX.play('toString');
  SFX.play('constructor');
  SFX.play('hasOwnProperty');
} catch (e) {
  failures.push('FALLO: play() con nombre invalido lanzo: ' + e.message);
}
check(log.nodes.length === 0, 'un nombre inexistente no debe crear nodos');

// 7) setVolume acotado y sin rampas a 0; getVolume devuelve lo acotado.
resetLog();
try {
  SFX.setVolume(0);
  SFX.setVolume(1);
  SFX.setVolume(-5);
  check(SFX.getVolume() === 0, 'setVolume(-5) debe quedar en 0');
  SFX.setVolume(99);
  check(SFX.getVolume() === 1, 'setVolume(99) debe quedar en 1');
  SFX.setVolume(NaN);
  SFX.setVolume('x');
  SFX.setVolume(0.5);
  check(SFX.getVolume() === 0.5, 'getVolume() debe devolver 0.5');
} catch (e) {
  failures.push('FALLO: setVolume lanzo: ' + e.message);
}
log.expRamps.forEach(function (r) {
  check(r.value > 0, 'setVolume no debe programar rampa exponencial a 0');
});

// 8) antimetralleta: la misma voz dos veces seguidas suena una sola vez.
resetLog();
avanza();
SFX.play('magic');
var unaVez = log.nodes.length;
SFX.play('magic');
check(unaVez > 0 && log.nodes.length === unaVez, 'la misma voz sin hueco no debe repetirse (' + unaVez + ' vs ' + log.nodes.length + ')');
avanza(0.5);
SFX.play('magic');
check(log.nodes.length > unaVez, 'pasado el hueco la voz vuelve a sonar');
resetLog();
avanza();
SFX.play('clash');
var soloClash = log.nodes.length;
SFX.play('capture');
check(log.nodes.length > soloClash, 'dos voces distintas seguidas suenan las dos');

// 9) paneo: el valor llega acotado al panner y sin pan no hay panner.
resetLog();
avanza();
SFX.play('clash', { pan: 0.5 });
check(log.pans.length > 0 && log.pans.every(function (v) { return v === 0.5; }), 'pan 0.5 debe llegar al panner');
resetLog();
avanza();
SFX.play('clash', { pan: 7 });
check(log.pans.length > 0 && log.pans.every(function (v) { return v === 1; }), 'pan 7 debe acotarse a 1');
resetLog();
avanza();
SFX.play('clash', { pan: -9 });
check(log.pans.every(function (v) { return v === -1; }), 'pan -9 debe acotarse a -1');
resetLog();
avanza();
SFX.play('clash', { pan: NaN });
check(log.pans.length === 0 && log.nodes.length > 0, 'pan NaN se ignora y la voz suena igual');
resetLog();
avanza();
SFX.play('clash');
check(!log.nodes.some(function (n) { return n.kind === 'panner'; }), 'sin pan no se crea panner');

// 10) tono: pitch multiplica las frecuencias de los osciladores.
resetLog();
avanza();
SFX.play('select');
var f1 = log.freqs.slice();
resetLog();
avanza();
SFX.play('select', { pitch: 2 });
var f2 = log.freqs.slice();
check(f1.length === f2.length && f1.every(function (f, i) { return Math.abs(f2[i] - f * 2) < 1e-6; }),
  'pitch 2 debe doblar las frecuencias (' + f1.join(',') + ' -> ' + f2.join(',') + ')');
resetLog();
avanza();
SFX.play('select', { pitch: -1 });
check(log.freqs.every(function (f) { return f > 0; }), 'un pitch invalido no debe producir frecuencias negativas');

// 11) reverb: las voces con cola envian al convolver; el tick seco, no.
resetLog();
avanza();
SFX.play('clash');
var haciaReverb = log.connections.some(function (c) { return c.from === 'gain' && c.to === 'gain'; });
check(haciaReverb, 'clash debe enviar parte de su senal a la reverb');

// 12) navegador viejo: sin panner, compresor ni convolver todo sigue sonando.
var OLD = cargar(FakeOldContext);
resetLog();
var oc = OLD.init();
check(!!oc, 'init() debe funcionar sin compresor ni convolver');
check(!log.nodes.some(function (n) { return n.kind === 'compressor' || n.kind === 'convolver'; }),
  'sin soporte no se intenta crear compresor ni convolver');
var rotas = [];
NAMES.forEach(function (name) {
  resetLog();
  oc.currentTime += 1;
  try { OLD.play(name, { pan: 0.4, pitch: 1.2 }); } catch (e) { rotas.push(name + ': ' + e.message); return; }
  if (!log.nodes.length || !log.starts.length) rotas.push(name);
});
check(rotas.length === 0, 'todas las voces suenan en el contexto minimo (' + rotas.join(', ') + ')');

if (failures.length) {
  failures.forEach(function (f) { console.error(f); });
  console.error('\n' + failures.length + ' comprobacion(es) fallidas');
  process.exit(1);
}
console.log('TODOS LOS TESTS DE AUDIO PASARON (' + NAMES.length + ' sonidos, con y sin compresor/reverb/paneo)');
