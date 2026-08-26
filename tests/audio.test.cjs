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
  expRamps: []
};

function resetLog() {
  log.nodes = [];
  log.stops = [];
  log.starts = [];
  log.connections = [];
  log.disconnects = [];
  log.expRamps = [];
}

function FakeParam(name, node) {
  this.value = 0;
  this._name = name;
  this._node = node;
}
FakeParam.prototype.setValueAtTime = function (v, t) { this.value = v; return this; };
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

function FakeBuffer(ch, len) {
  this.numberOfChannels = ch;
  this.length = len;
  this._data = new Float32Array(len);
}
FakeBuffer.prototype.getChannelData = function () { return this._data; };

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
FakeAudioContext.prototype.resume = function () { this.state = 'running'; return null; };

var NAMES = ['select', 'deny', 'move', 'land', 'clash', 'slash', 'magic', 'stone',
  'death', 'capture', 'check', 'castle', 'promote', 'win', 'lose', 'tick'];

var failures = [];
function check(cond, msg) {
  if (!cond) failures.push('FALLO: ' + msg);
}

// Carga del modulo en un sandbox con el doble de AudioContext.
var sandbox = { AudioContext: FakeAudioContext, Math: Math, isFinite: isFinite, Float32Array: Float32Array };
vm.createContext(sandbox);
var code = fs.readFileSync(SRC, 'utf8') + '\n;globalThis.__SFX__ = SFX;';
vm.runInContext('"use strict";\n' + code, sandbox, { filename: 'audio.js' });
var SFX = sandbox.__SFX__;

check(typeof SFX === 'object' && SFX !== null, 'SFX debe existir');
['init', 'play', 'setMuted', 'isMuted', 'setVolume'].forEach(function (k) {
  check(typeof SFX[k] === 'function', 'SFX.' + k + ' debe ser funcion');
});

// 1) play() antes de init() no lanza ni crea nodos.
resetLog();
try {
  NAMES.forEach(function (n) { SFX.play(n); });
  SFX.play('select', { delay: 0.1 });
} catch (e) {
  failures.push('FALLO: play() antes de init() lanzo: ' + e.message);
}
check(log.nodes.length === 0, 'sin init() no se deben crear nodos');

// 2) init() es idempotente.
var c1 = SFX.init();
var c2 = SFX.init();
check(!!c1 && c1 === c2, 'init() debe ser perezoso e idempotente');

// 3) cada nombre crea nodos y programa un stop; ninguna rampa exponencial recibe 0.
NAMES.forEach(function (name) {
  resetLog();
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
  var dur = log.stops.reduce(function (m, s) { return Math.max(m, s.t); }, 0) - c1.currentTime;
  check(dur < 1.2, 'play("' + name + '") debe durar menos de 1.2 s (dur=' + dur.toFixed(3) + ')');
});

// 4) cleanup: onended desconecta la cadena.
resetLog();
SFX.play('clash');
var sources = log.nodes.filter(function (n) { return typeof n.onended !== 'undefined'; });
check(sources.length > 0, 'debe haber fuentes con onended');
sources.forEach(function (s) { if (typeof s.onended === 'function') s.onended(); });
check(log.disconnects.length > 0, 'onended debe desconectar los nodos');

// 5) silenciado: no se crea ningun nodo.
SFX.setMuted(true);
check(SFX.isMuted() === true, 'isMuted() debe devolver true');
resetLog();
NAMES.forEach(function (n) { SFX.play(n); });
check(log.nodes.length === 0, 'silenciado no debe crear nodos (creo ' + log.nodes.length + ')');
SFX.setMuted(false);
check(SFX.isMuted() === false, 'isMuted() debe devolver false');
resetLog();
SFX.play('select');
check(log.nodes.length > 0, 'tras desilenciar debe volver a sonar');

// 6) nombre inexistente no lanza ni crea nodos.
resetLog();
try {
  SFX.play('nombre-inexistente');
  SFX.play('');
  SFX.play(null);
  SFX.play(undefined);
  SFX.play('toString');
  SFX.play('constructor');
} catch (e) {
  failures.push('FALLO: play() con nombre invalido lanzo: ' + e.message);
}
check(log.nodes.length === 0, 'un nombre inexistente no debe crear nodos');

// 7) setVolume acotado y sin rampas a 0.
resetLog();
try {
  SFX.setVolume(0);
  SFX.setVolume(1);
  SFX.setVolume(-5);
  SFX.setVolume(99);
  SFX.setVolume(NaN);
  SFX.setVolume('x');
  SFX.setVolume(0.5);
} catch (e) {
  failures.push('FALLO: setVolume lanzo: ' + e.message);
}
log.expRamps.forEach(function (r) {
  check(r.value > 0, 'setVolume no debe programar rampa exponencial a 0');
});

if (failures.length) {
  failures.forEach(function (f) { console.error(f); });
  console.error('\n' + failures.length + ' comprobacion(es) fallidas');
  process.exit(1);
}
console.log('TODOS LOS TESTS DE AUDIO PASARON (' + NAMES.length + ' sonidos)');
