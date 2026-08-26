const fs = require("fs");
const Engine = eval(fs.readFileSync("src/engine.js", "utf8") + ";Engine");

let fails = 0;
function ok(cond, label, extra) {
  if (cond) console.log("  PASS  " + label);
  else { fails++; console.log("  FAIL  " + label + (extra ? "   -> " + extra : "")); }
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const POS = [
  { name: "1 inicial", fen: START, want: [20, 400, 8902, 197281] },
  { name: "2 kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", want: [48, 2039, 97862, 4085603] },
  { name: "3 endgame", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", want: [14, 191, 2812, 43238, 674624] },
  { name: "4 promos", fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", want: [6, 264, 9467, 422333] },
  { name: "5 talkchess", fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", want: [44, 1486, 62379, 2103487] }
];

console.log("== PERFT ==");
const t0 = Date.now();
const resumen = [];
for (let i = 0; i < POS.length; i++) {
  const p = POS[i];
  const s = Engine.fromFen(p.fen);
  const got = [];
  for (let d = 1; d <= p.want.length; d++) got.push(Engine.perft(Engine.fromFen(p.fen), d));
  const good = got.join(",") === p.want.join(",");
  ok(good, p.name + " d1..d" + p.want.length + " = " + got.join(" "), "esperado " + p.want.join(" "));
  if (good) resumen.push(p.name.replace(/^\d+ /, "") + " d" + p.want.length + "=" + got[got.length - 1]);
}
console.log("  (perft en " + ((Date.now() - t0) / 1000).toFixed(1) + "s)");

console.log("== FEN ida y vuelta ==");
for (let i = 0; i < POS.length; i++) {
  const s = Engine.fromFen(POS[i].fen);
  const round = Engine.fromFen(Engine.fen(s));
  ok(Engine.fen(round) === POS[i].fen && JSON.stringify(round) === JSON.stringify(s), "fromFen(fen(s)) identidad: " + POS[i].name, Engine.fen(round));
}

console.log("== makeMove no muta ==");
for (let i = 0; i < POS.length; i++) {
  const s = Engine.fromFen(POS[i].fen);
  const before = JSON.stringify(s);
  const ms = Engine.legalMoves(s);
  let clean = true;
  for (let k = 0; k < ms.length; k++) {
    const ns = Engine.makeMove(s, ms[k]);
    Engine.legalMoves(ns);
    if (JSON.stringify(s) !== before) { clean = false; break; }
  }
  ok(clean && JSON.stringify(s) === before, "estado intacto tras " + ms.length + " makeMove: " + POS[i].name);
}
// legalMoves tampoco debe dejar rastro
{
  const s = Engine.fromFen(POS[1].fen);
  const before = JSON.stringify(s);
  Engine.legalMoves(s); Engine.movesFrom(s, 60); Engine.status(s, []);
  ok(JSON.stringify(s) === before, "legalMoves/status no mutan el estado");
}

console.log("== clone profundo ==");
{
  const s = Engine.newGame();
  const c = Engine.clone(s);
  ok(JSON.stringify(c) === JSON.stringify(s), "clone igual");
  let shared = false;
  for (let i = 0; i < 64; i++) if (s.b[i] !== null && s.b[i] === c.b[i]) shared = true;
  ok(!shared && c.b !== s.b && c.cast !== s.cast, "clone no comparte referencias");
}

console.log("== Mate del pastor ==");
{
  let s = Engine.newGame();
  const line = [["e2", "e4"], ["e7", "e5"], ["f1", "c4"], ["b8", "c6"], ["d1", "h5"], ["g8", "f6"], ["h5", "f7"]];
  const sans = [];
  for (let i = 0; i < line.length; i++) {
    const from = Engine.sqIndex(line[i][0]), to = Engine.sqIndex(line[i][1]);
    const ms = Engine.movesFrom(s, from);
    let mv = null;
    for (let k = 0; k < ms.length; k++) if (ms[k].to === to && ms[k].promo === null) mv = ms[k];
    if (!mv) { ok(false, "jugada legal " + line[i].join("")); break; }
    sans.push(Engine.san(s, mv));
    s = Engine.makeMove(s, mv);
  }
  const st = Engine.status(s, []);
  ok(sans.join(" ") === "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#", "SAN de la linea: " + sans.join(" "));
  ok(st.over === true && st.result === "checkmate" && st.winner === "w" && st.check === true, "status = jaque mate blancas", JSON.stringify(st));
}

console.log("== Ahogado ==");
{
  const s = Engine.fromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const st = Engine.status(s, []);
  ok(Engine.legalMoves(s).length === 0, "sin jugadas legales");
  ok(st.over === true && st.result === "stalemate" && st.winner === null && st.check === false, "status = ahogado", JSON.stringify(st));
}

console.log("== Tablas y reglas varias ==");
{
  // 50 movimientos
  const s50 = Engine.fromFen("8/8/4k3/8/8/4K3/8/6R1 w - - 100 80");
  ok(Engine.status(s50, []).result === "fifty", "regla de 50 movimientos");
  // material insuficiente
  ok(Engine.status(Engine.fromFen("8/8/4k3/8/8/4K3/8/8 w - - 0 1"), []).result === "insufficient", "K vs K");
  ok(Engine.status(Engine.fromFen("8/8/4k3/8/8/4K3/8/5B2 w - - 0 1"), []).result === "insufficient", "K+B vs K");
  ok(Engine.status(Engine.fromFen("8/8/4k3/8/8/4K3/8/5N2 w - - 0 1"), []).result === "insufficient", "K+N vs K");
  ok(Engine.status(Engine.fromFen("5b2/8/4k3/8/8/4K3/8/6B1 w - - 0 1"), []).result === "insufficient", "K+B vs K+B mismo color");
  ok(Engine.status(Engine.fromFen("5b2/8/4k3/8/8/4K3/8/5B2 w - - 0 1"), []).result === null, "K+B vs K+B distinto color: no tablas");
  ok(Engine.status(Engine.fromFen("8/8/4k3/8/8/4K3/8/4R3 w - - 0 1"), []).result === null, "K+R vs K: no tablas");
  // triple repeticion
  const sr = Engine.newGame();
  const k = Engine.key(sr);
  ok(Engine.status(sr, [k, k, k]).result === "repetition", "triple repeticion");
  ok(Engine.status(sr, [k, k]).result === null, "doble repeticion no es tablas");
  ok(Engine.status(sr, null).result === null, "hist opcional (null)");
  // clave: el ep solo cuenta si es capturable
  const a = Engine.fromFen("4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1");
  const b = Engine.fromFen("4k3/8/8/8/3pP3/8/8/4K3 b - - 0 1");
  ok(Engine.key(a) !== Engine.key(b), "key distingue ep capturable");
  const c1 = Engine.fromFen("4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1");
  const c2 = Engine.fromFen("4k3/8/8/8/4P3/8/8/4K3 b - - 0 1");
  ok(Engine.key(c1) === Engine.key(c2), "key ignora ep irrelevante");
}

console.log("== Detalles del contrato ==");
{
  // captura al paso: cap.sq distinto de to
  const s = Engine.fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
  const ms = Engine.movesFrom(s, Engine.sqIndex("e5"));
  let epm = null;
  for (let i = 0; i < ms.length; i++) if (ms[i].ep) epm = ms[i];
  ok(epm !== null && epm.to === Engine.sqIndex("d6") && epm.cap.sq === Engine.sqIndex("d5") && epm.cap.t === "p" && epm.cap.c === "b", "al paso: cap.sq = casilla real", JSON.stringify(epm));
  ok(Engine.san(s, epm) === "exd6", "SAN al paso = exd6");
  const ns = Engine.makeMove(s, epm);
  ok(ns.b[Engine.sqIndex("d5")] === null && ns.b[Engine.sqIndex("d6")].t === "p", "makeMove al paso quita el peon capturado");
  // promocion: 4 opciones y flags
  const sp = Engine.fromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  const pm = Engine.movesFrom(sp, Engine.sqIndex("a7"));
  ok(pm.length === 4, "4 promociones por empuje (" + pm.length + ")");
  ok(pm.map(function (m) { return m.promo; }).sort().join("") === "bnqr", "promo q/r/b/n");
  // enroques
  const sc = Engine.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const km = Engine.movesFrom(sc, 60);
  let cK = null, cQ = null;
  for (let i = 0; i < km.length; i++) { if (km[i].castle === "K") cK = km[i]; if (km[i].castle === "Q") cQ = km[i]; }
  ok(cK !== null && cQ !== null, "enroque corto y largo disponibles");
  ok(Engine.san(sc, cK) === "O-O" && Engine.san(sc, cQ) === "O-O-O", "SAN O-O / O-O-O");
  const after = Engine.makeMove(sc, cK);
  ok(after.b[Engine.sqIndex("g1")].t === "k" && after.b[Engine.sqIndex("f1")].t === "r" && after.b[Engine.sqIndex("h1")] === null && after.cast.K === false && after.cast.Q === false, "enroque corto mueve rey y torre y quita derechos");
  const afterQ = Engine.makeMove(sc, cQ);
  ok(afterQ.b[Engine.sqIndex("c1")].t === "k" && afterQ.b[Engine.sqIndex("d1")].t === "r" && afterQ.b[Engine.sqIndex("a1")] === null, "enroque largo mueve rey y torre");
  // no se puede enrocar en jaque ni pasando por casilla atacada
  const chk = Engine.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  ok(Engine.movesFrom(Engine.fromFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1"), 60).filter(function (m) { return m.castle; }).length === 2, "enroques sin obstaculos");
  ok(Engine.movesFrom(Engine.fromFen("4k3/8/8/8/8/8/8/R3K1rR w KQ - 0 1"), 60).filter(function (m) { return m.castle === "K"; }).length === 0, "no enroca cruzando casilla atacada (g1)");
  ok(Engine.movesFrom(Engine.fromFen("4k3/8/8/8/8/8/8/R3Kr1R w KQ - 0 1"), 60).filter(function (m) { return m.castle; }).length === 0, "no enroca en jaque");
  ok(Engine.movesFrom(Engine.fromFen("4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1"), 60).filter(function (m) { return m.castle; }).length === 0, "no enroca con rey en jaque por columna");
  ok(Engine.movesFrom(Engine.fromFen("4k3/8/8/8/8/8/8/Rn2K2R w KQ - 0 1"), 60).filter(function (m) { return m.castle === "Q"; }).length === 0, "no enroca largo con b1 ocupada");
  // captura de torre quita el derecho
  const sx = Engine.fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const rmoves = Engine.movesFrom(sx, Engine.sqIndex("h1"));
  let capH8 = null;
  for (let i = 0; i < rmoves.length; i++) if (rmoves[i].to === Engine.sqIndex("h8")) capH8 = rmoves[i];
  ok(capH8 !== null && Engine.makeMove(sx, capH8).cast.k === false, "capturar torre en h8 quita el enroque corto negro");
  // rey clavado
  const pin = Engine.fromFen("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1");
  ok(Engine.movesFrom(pin, Engine.sqIndex("e8")).length === 4, "rey no se mueve a casillas atacadas");
  // desambiguacion SAN
  const dis = Engine.fromFen("8/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  const rr = Engine.legalMoves(dis).filter(function (m) { return m.t === "r" && m.to === Engine.sqIndex("d1"); });
  ok(rr.length === 1 && Engine.san(dis, rr[0]) === "Rd1", "torre unica: Rd1");
  const dis2 = Engine.fromFen("4k3/8/8/8/8/8/8/R2NK2R w KQ - 0 1");
  const nd = Engine.fromFen("4k3/8/8/8/8/8/3N4/3NK3 w - - 0 1");
  const two = Engine.fromFen("4k3/8/8/8/8/1N3N2/8/4K3 w - - 0 1");
  const nm = Engine.legalMoves(two).filter(function (m) { return m.t === "n" && m.to === Engine.sqIndex("d4"); });
  ok(nm.length === 2 && [Engine.san(two, nm[0]), Engine.san(two, nm[1])].sort().join(",") === "Nbd4,Nfd4", "desambiguacion por columna: Nbd4/Nfd4");
  const col = Engine.fromFen("4k3/8/8/8/1N6/8/1N6/4K3 w - - 0 1");
  const cm = Engine.legalMoves(col).filter(function (m) { return m.t === "n" && m.to === Engine.sqIndex("d3"); });
  ok(cm.length === 2 && [Engine.san(col, cm[0]), Engine.san(col, cm[1])].sort().join(",") === "N2d3,N4d3", "desambiguacion por fila: N2d3/N4d3");
  const three = Engine.fromFen("4k3/8/8/Q6Q/8/8/8/Q3K3 w - - 0 1");
  const qm = Engine.legalMoves(three).filter(function (m) { return m.t === "q" && m.to === Engine.sqIndex("e5"); });
  ok(qm.length === 3 && qm.map(function (m) { return Engine.san(three, m); }).sort().join(",") === "Q1e5+,Qa5e5+,Qhe5+", "desambiguacion minima: Q1e5+/Qa5e5+/Qhe5+ (" + qm.map(function (m) { return Engine.san(three, m); }).join(",") + ")");
  // sufijos + y # y promocion con mate
  const sm = Engine.fromFen("4k3/4P3/4K3/8/8/8/8/8 w - - 0 1");
  const pm2 = Engine.movesFrom(sm, Engine.sqIndex("e7")).filter(function (m) { return m.promo === "q" || m.promo === "n"; });
  ok(pm2.length === 0, "peon bloqueado no promociona");
  const smate = Engine.fromFen("k7/7P/1K6/8/8/8/8/8 w - - 0 1");
  const pq = Engine.movesFrom(smate, Engine.sqIndex("h7")).filter(function (m) { return m.promo === "q"; })[0];
  ok(Engine.san(smate, pq) === "h8=Q#", "SAN promocion con mate h8=Q# (" + Engine.san(smate, pq) + ")");
  const splain = Engine.fromFen("k7/7P/8/8/8/8/8/7K w - - 0 1");
  const pmv = Engine.movesFrom(splain, Engine.sqIndex("h7"));
  ok(Engine.san(splain, pmv.filter(function (m) { return m.promo === "q"; })[0]) === "h8=Q+", "SAN promocion con jaque h8=Q+");
  ok(Engine.san(splain, pmv.filter(function (m) { return m.promo === "n"; })[0]) === "h8=N", "SAN promocion simple h8=N");
  const scheck = Engine.fromFen("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1");
  const rmv = Engine.movesFrom(scheck, Engine.sqIndex("a1")).filter(function (m) { return m.to === Engine.sqIndex("a8"); })[0];
  ok(Engine.san(scheck, rmv) === "Ra8+", "SAN jaque Ra8+ (" + Engine.san(scheck, rmv) + ")");
  // sqName / sqIndex
  ok(Engine.sqName(0) === "a8" && Engine.sqName(7) === "h8" && Engine.sqName(56) === "a1" && Engine.sqName(63) === "h1" && Engine.sqName(36) === "e4", "sqName");
  ok(Engine.sqIndex("a8") === 0 && Engine.sqIndex("h1") === 63 && Engine.sqIndex("e4") === 36, "sqIndex");
  // attacked / inCheck
  const at = Engine.fromFen("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1");
  ok(Engine.inCheck(at, "w") === true && Engine.inCheck(at, "b") === false, "inCheck");
  ok(Engine.attacked(at, Engine.sqIndex("e1"), "b") === true && Engine.attacked(at, Engine.sqIndex("a1"), "b") === false, "attacked");
  // VALUE
  ok(Engine.VALUE.p === 100 && Engine.VALUE.n === 320 && Engine.VALUE.b === 330 && Engine.VALUE.r === 500 && Engine.VALUE.q === 900 && Engine.VALUE.k === 20000, "Engine.VALUE");
  // half / full / ep en makeMove
  const g = Engine.newGame();
  const e4 = Engine.movesFrom(g, Engine.sqIndex("e2")).filter(function (m) { return m.to === Engine.sqIndex("e4"); })[0];
  const g2 = Engine.makeMove(g, e4);
  ok(e4.dbl === true && g2.ep === Engine.sqIndex("e3") && g2.half === 0 && g2.full === 1 && g2.turn === "b", "avance doble: dbl/ep/turno");
  const nf6 = Engine.movesFrom(g2, Engine.sqIndex("g8")).filter(function (m) { return m.to === Engine.sqIndex("f6"); })[0];
  const g3 = Engine.makeMove(g2, nf6);
  ok(g3.ep === null && g3.half === 1 && g3.full === 2 && g3.turn === "w", "contador de jugadas y ep reseteado");
}

console.log("== API superficie ==");
{
  const names = ["VALUE", "newGame", "clone", "legalMoves", "movesFrom", "makeMove", "inCheck", "attacked", "key", "status", "san", "sqName", "sqIndex", "fen", "fromFen", "perft"];
  let missing = [];
  for (let i = 0; i < names.length; i++) if (Engine[names[i]] === undefined) missing.push(names[i]);
  ok(missing.length === 0, "todos los metodos exportados", missing.join(","));
  const src = fs.readFileSync("src/engine.js", "utf8");
  ok(!/\b(require|module\.exports|import\s|export\s)/.test(src), "sin require/import/export");
  ok(!/console\./.test(src), "sin console");
  ok(/^\/\*[\s\S]*?\*\/\s*const Engine = \(function \(\) \{/.test(src.trim()) || /^const Engine = \(function/.test(src.trim()), "una sola declaracion const Engine");
  // debe funcionar bajo "use strict"
  let strictOK = true;
  try { eval('"use strict";' + src + ";Engine.perft(Engine.newGame(),2);"); } catch (e) { strictOK = false; console.log("    " + e.message); }
  ok(strictOK, "evaluable bajo use strict");
}

console.log("");
if (fails === 0) {
  console.log("TODO PASSED (0 fallos)");
  console.log("PERFT: " + resumen.join(" | "));
  process.exit(0);
} else {
  console.log("FALLOS: " + fails);
  process.exit(1);
}
