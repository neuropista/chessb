/* Pruebas de la IA: legalidad, fuerza relativa, mate en 1 y presupuesto de tiempo. */
'use strict';
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8') + '\n' +
          fs.readFileSync(path.join(root, 'src', 'ai.js'), 'utf8');
var mod = (new Function('"use strict";' + src + '\nreturn { Engine: Engine, AI: AI };'))();
var Engine = mod.Engine, AI = mod.AI;

var GAMES = parseInt(process.env.AI_GAMES || '30', 10);
var MAXPLY = parseInt(process.env.AI_PLIES || '140', 10);
/* En el autojuego se recorta el presupuesto de busqueda (AI.pick acepta
   opts.budgetMs); el presupuesto real de partida se mide aparte, mas abajo. */
var BUDGET = parseInt(process.env.AI_BUDGET || '80', 10);

var fails = 0;
function ok(c, m) { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; }

console.log('== API ==');
ok(typeof AI.pick === 'function', 'AI.pick existe');
ok(Array.isArray(AI.LEVELS) && AI.LEVELS.length >= 3, 'AI.LEVELS con al menos 3 niveles');

function legalKey(m) { return m.from + '-' + m.to + '-' + (m.promo || ''); }

console.log('\n== Legalidad y estabilidad: ' + GAMES + ' partidas de autojuego (AI_GAMES/AI_PLIES para ampliar) ==');
var wins = { 3: 0, 1: 0, draw: 0 }, illegal = 0, threw = 0, plies = 0, worst = 0, totalMs = 0, picks = 0;
for (var g = 0; g < GAMES; g++) {
  var s = Engine.newGame();
  var hist = [Engine.key(s)];
  var strong = (g % 2 === 0) ? 'w' : 'b';   // el nivel 3 alterna de color
  var st = null;
  for (var ply = 0; ply < MAXPLY; ply++) {
    st = Engine.status(s, hist);
    if (st.over) break;
    var level = (s.turn === strong) ? 3 : 1;
    var legal = Engine.legalMoves(s);
    var set = {};
    for (var i = 0; i < legal.length; i++) set[legalKey(legal[i])] = 1;
    var t0 = Date.now(), mv = null;
    try { mv = AI.pick(s, level, hist, { budgetMs: BUDGET }); } catch (e) { threw++; break; }
    var dt = Date.now() - t0;
    if (level === 3) { totalMs += dt; picks++; if (dt > worst) worst = dt; }
    if (!mv || !set[legalKey(mv)]) { illegal++; break; }
    s = Engine.makeMove(s, mv);
    hist.push(Engine.key(s));
    plies++;
  }
  st = Engine.status(s, hist);
  if (st.over && st.result === 'checkmate') wins[st.winner === strong ? 3 : 1]++;
  else wins.draw++;
}
ok(illegal === 0, 'ningun movimiento ilegal (' + plies + ' jugadas)');
ok(threw === 0, 'ninguna excepcion');
var score = (wins[3] + wins.draw * 0.5) / GAMES;
ok(score >= 0.8, 'el nivel 3 puntua ' + (score * 100).toFixed(0) + '% contra el nivel 1 (' + wins[3] + ' victorias, ' + wins.draw + ' tablas, ' + wins[1] + ' derrotas)');
ok(worst < BUDGET + 300, 'con presupuesto de ' + BUDGET + ' ms el peor tiempo fue ' + worst + ' ms (media ' + Math.round(totalMs / Math.max(1, picks)) + ' ms)');

console.log('\n== Presupuesto real de partida (nivel 3, sin recortar) ==');
var s3 = Engine.newGame(), h3 = [Engine.key(s3)], w3 = 0, t3 = 0, n3 = 0;
for (var q = 0; q < 12 && !Engine.status(s3, h3).over; q++) {
  var q0 = Date.now();
  var qm = AI.pick(s3, 3, h3);
  var qd = Date.now() - q0;
  if (!qm) break;
  if (qd > w3) w3 = qd;
  t3 += qd; n3++;
  s3 = Engine.makeMove(s3, qm); h3.push(Engine.key(s3));
}
ok(w3 < 900 && n3 >= 10, n3 + ' jugadas seguidas: media ' + Math.round(t3 / Math.max(1, n3)) + ' ms, peor ' + w3 + ' ms (limite 900)');

console.log('\n== Mate en 1 ==');
var MATES = [
  ['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'torre a la octava'],
  ['r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'mate del pasillo con torre'],
  ['3k4/8/3K4/8/8/8/8/7R w - - 0 1', 'torre a la octava con oposicion']
];
for (var mi = 0; mi < MATES.length; mi++) {
  var pos = Engine.fromFen(MATES[mi][0]);
  var mates = Engine.legalMoves(pos).filter(function (m) {
    return Engine.status(Engine.makeMove(pos, m), []).result === 'checkmate';
  });
  if (!mates.length) { ok(false, MATES[mi][1] + ': la posicion de prueba no tiene mate en 1'); continue; }
  var chosen = AI.pick(pos, 3, []);
  var found = mates.some(function (m) { return legalKey(m) === legalKey(chosen); });
  ok(found, MATES[mi][1] + ': el nivel 3 da mate (' + Engine.san(pos, chosen) + ')');
}

console.log('\n== No regala material ==');
/* Dama blanca en d5 atacada por el peon de c6: debe moverse o estar defendida. */
var hang = Engine.fromFen('4k3/8/2p5/3Q4/8/8/8/4K3 w - - 0 1');
var mv2 = AI.pick(hang, 3, []);
var after = Engine.makeMove(hang, mv2);
var queenSafe = after.b.some(function (p, i) { return p && p.t === 'q' && p.c === 'w' && !Engine.attacked(after, i, 'b'); });
ok(queenSafe, 'la dama amenazada se pone a salvo (' + Engine.san(hang, mv2) + ')');

console.log('\n== Los tres niveles devuelven jugadas legales ==');
for (var lv = 1; lv <= 3; lv++) {
  var s2 = Engine.fromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1');
  var legal2 = {};
  Engine.legalMoves(s2).forEach(function (m) { legal2[legalKey(m)] = 1; });
  var good = true;
  for (var r = 0; r < 12; r++) {
    var m2 = AI.pick(s2, lv, []);
    if (!m2 || !legal2[legalKey(m2)]) { good = false; break; }
  }
  ok(good, 'nivel ' + lv + ': 12 decisiones legales seguidas');
}

console.log('\n== Sin jugadas legales devuelve null ==');
var mate = Engine.fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
ok(Engine.status(mate, []).result === 'checkmate', 'posicion de mate del loco reconocida');
ok(AI.pick(mate, 3, []) === null, 'AI.pick devuelve null si no hay jugadas');

console.log('\n' + (fails ? '### ' + fails + ' FALLOS EN LA IA' : 'IA OK (0 fallos)'));
process.exit(fails ? 1 : 0);
