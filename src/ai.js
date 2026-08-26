/* IA rival: 3 niveles. Alfa-beta con profundizacion iterativa, quiescencia,
   PST, movilidad, seguridad del rey y estructura de peones. Depende de Engine. */
const AI = (function () {
  "use strict";

  var LEVELS = [
    { id: 1, name: "Escudero" },
    { id: 2, name: "Caballero" },
    { id: 3, name: "Gran Maestre" }
  ];

  var V = Engine.VALUE;
  var MATE = 100000;
  var INF = 1000000;
  var MATE_ZONE = MATE - 1000;

  // ---------- tablas de posicion ----------
  // Fila 0 del literal = fila 8 del tablero = indices 0..7 (a8..h8).
  // Blancas usan pst[i]; negras usan pst[i ^ 56] (espejo vertical).
  var PST_P = [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0
  ];
  var PST_N = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ];
  var PST_B = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ];
  var PST_R = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
  ];
  var PST_Q = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ];
  var PST_KM = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ];
  var PST_KE = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
  ];

  var PST = { p: PST_P, n: PST_N, b: PST_B, r: PST_R, q: PST_Q, k: PST_KM };

  // Bonus de peon pasado por grado de avance (0 = casilla inicial)
  var PASSED = [0, 8, 14, 24, 40, 66, 100, 0];

  // ---------- geometria propia (no dependemos de internos de Engine) ----------
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  var NDIR = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KN = new Array(64);
  var RY = new Array(64);
  (function () {
    for (var sq = 0; sq < 64; sq++) {
      var r = sq >> 3, c = sq & 7, i, nr, nc;
      var a = [];
      for (i = 0; i < 8; i++) {
        nr = r + NDIR[i][0]; nc = c + NDIR[i][1];
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) a.push(nr * 8 + nc);
      }
      KN[sq] = a;
      var rr = new Array(8);
      for (var d = 0; d < 8; d++) {
        var ray = [];
        nr = r + DIRS[d][0]; nc = c + DIRS[d][1];
        while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          ray.push(nr * 8 + nc);
          nr += DIRS[d][0]; nc += DIRS[d][1];
        }
        rr[d] = ray;
      }
      RY[sq] = rr;
    }
  })();

  // ---------- buffers reutilizables de la evaluacion ----------
  var _wf = [0, 0, 0, 0, 0, 0, 0, 0];   // peones blancos por columna
  var _bf = [0, 0, 0, 0, 0, 0, 0, 0];
  var _wmin = [9, 9, 9, 9, 9, 9, 9, 9]; // fila menor (peon blanco mas avanzado)
  var _wmax = [-1, -1, -1, -1, -1, -1, -1, -1];
  var _bmin = [9, 9, 9, 9, 9, 9, 9, 9];
  var _bmax = [-1, -1, -1, -1, -1, -1, -1, -1];
  var _rk = new Array(20);

  function mobOf(b, i, t, col) {
    var n = 0, k, q, tg, d, ray, lo, hi, rr;
    if (t === "n") {
      tg = KN[i];
      for (k = 0; k < tg.length; k++) { q = b[tg[k]]; if (q === null || q.c !== col) n++; }
      return n * 4;
    }
    lo = t === "b" ? 4 : 0;
    hi = t === "r" ? 4 : 8;
    rr = RY[i];
    for (d = lo; d < hi; d++) {
      ray = rr[d];
      for (k = 0; k < ray.length; k++) {
        q = b[ray[k]];
        if (q === null) n++;
        else { if (q.c !== col) n++; break; }
      }
    }
    return t === "q" ? n : (t === "r" ? n * 2 : n * 4);
  }

  // Evaluacion completa (nivel 3), en centipeones desde el punto de vista del que mueve.
  function evalFull(s) {
    var b = s.b, i, p, t, r, c, f, idx, v, w;
    for (i = 0; i < 8; i++) {
      _wf[i] = 0; _bf[i] = 0; _wmin[i] = 9; _bmin[i] = 9; _wmax[i] = -1; _bmax[i] = -1;
    }
    var sc = 0, npm = 0, wbp = 0, bbp = 0, wk = -1, bk = -1, nrk = 0;

    for (i = 0; i < 64; i++) {
      p = b[i];
      if (p === null) continue;
      t = p.t;
      w = p.c === "w";
      if (t === "k") { if (w) wk = i; else bk = i; continue; }
      r = i >> 3; c = i & 7;
      if (t === "p") {
        if (w) {
          _wf[c]++;
          if (r < _wmin[c]) _wmin[c] = r;
          if (r > _wmax[c]) _wmax[c] = r;
        } else {
          _bf[c]++;
          if (r < _bmin[c]) _bmin[c] = r;
          if (r > _bmax[c]) _bmax[c] = r;
        }
      } else {
        npm += V[t];
        if (t === "b") { if (w) wbp++; else bbp++; }
        else if (t === "r" && nrk < 20) { _rk[nrk++] = i; }
        v = mobOf(b, i, t, p.c);
        sc += w ? v : -v;
      }
      idx = w ? i : (i ^ 56);
      v = V[t] + PST[t][idx];
      sc += w ? v : -v;
    }

    if (wbp >= 2) sc += 30;
    if (bbp >= 2) sc -= 30;

    // Fase: 1 = medio juego con material completo, 0 = final
    var ph = npm >= 6200 ? 1 : npm / 6200;
    if (wk >= 0) sc += Math.round(PST_KM[wk] * ph + PST_KE[wk] * (1 - ph));
    if (bk >= 0) { idx = bk ^ 56; sc -= Math.round(PST_KM[idx] * ph + PST_KE[idx] * (1 - ph)); }

    // Estructura de peones: doblados, aislados, pasados
    for (c = 0; c < 8; c++) {
      if (_wf[c] > 1) sc -= 14 * (_wf[c] - 1);
      if (_bf[c] > 1) sc += 14 * (_bf[c] - 1);
      if (_wf[c] > 0 && (c === 0 || _wf[c - 1] === 0) && (c === 7 || _wf[c + 1] === 0)) sc -= 16;
      if (_bf[c] > 0 && (c === 0 || _bf[c - 1] === 0) && (c === 7 || _bf[c + 1] === 0)) sc += 16;

      if (_wf[c] > 0) {
        r = _wmin[c];
        var okw = true;
        for (f = c - 1; f <= c + 1; f++) {
          if (f < 0 || f > 7) continue;
          if (_bf[f] > 0 && _bmin[f] < r) { okw = false; break; }
        }
        if (okw) sc += PASSED[7 - r];
      }
      if (_bf[c] > 0) {
        r = _bmax[c];
        var okb = true;
        for (f = c - 1; f <= c + 1; f++) {
          if (f < 0 || f > 7) continue;
          if (_wf[f] > 0 && _wmax[f] > r) { okb = false; break; }
        }
        if (okb) sc -= PASSED[r];
      }
    }

    // Torres en columna abierta / semiabierta
    for (i = 0; i < nrk; i++) {
      idx = _rk[i];
      c = idx & 7;
      p = b[idx];
      if (p.c === "w") {
        if (_wf[c] === 0) sc += _bf[c] === 0 ? 22 : 11;
      } else {
        if (_bf[c] === 0) sc -= _wf[c] === 0 ? 22 : 11;
      }
    }

    // Seguridad del rey: escudo de peones, solo relevante fuera del final
    if (ph > 0.25) {
      var sh;
      if (wk >= 0) {
        sh = 0; r = wk >> 3; c = wk & 7;
        for (f = c - 1; f <= c + 1; f++) {
          if (f < 0 || f > 7) { sh -= 6; continue; }
          if (_wf[f] === 0) { sh -= 18; continue; }
          v = r - _wmax[f];
          sh += v === 1 ? 10 : (v === 2 ? 4 : -8);
        }
        sc += Math.round(sh * ph);
      }
      if (bk >= 0) {
        sh = 0; r = bk >> 3; c = bk & 7;
        for (f = c - 1; f <= c + 1; f++) {
          if (f < 0 || f > 7) { sh -= 6; continue; }
          if (_bf[f] === 0) { sh -= 18; continue; }
          v = _bmin[f] - r;
          sh += v === 1 ? 10 : (v === 2 ? 4 : -8);
        }
        sc -= Math.round(sh * ph);
      }
    }

    return s.turn === "w" ? sc : -sc;
  }

  // Evaluacion simple (nivel 2): material + PST.
  function evalMat(s) {
    var b = s.b, i, p, sc = 0, idx, v, w;
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (p === null) continue;
      w = p.c === "w";
      idx = w ? i : (i ^ 56);
      v = (p.t === "k" ? 0 : V[p.t]) + PST[p.t][idx];
      sc += w ? v : -v;
    }
    return s.turn === "w" ? sc : -sc;
  }

  // ---------- ordenacion ----------
  function same(a, m) {
    return a !== null && a.from === m.from && a.to === m.to && a.promo === m.promo;
  }

  function mscore(m, ply, ctl, pv) {
    if (pv !== null && same(pv, m)) return 2000000000;
    var sc;
    if (m.cap !== null) {
      sc = 1000000 + V[m.cap.t] * 16 - V[m.t];       // MVV-LVA
    } else {
      var k = ctl.kill[ply];
      if (k !== undefined && same(k[0], m)) sc = 900000;
      else if (k !== undefined && same(k[1], m)) sc = 890000;
      else sc = ctl.hist[(m.from << 6) | m.to];
    }
    if (m.promo !== null) sc += V[m.promo] * 8;
    if (m.castle !== null) sc += 6000;
    return sc;
  }

  // Insercion descendente: listas cortas, evita asignar objetos por jugada.
  function sortBy(ms, sc) {
    for (var i = 1; i < ms.length; i++) {
      var m = ms[i], v = sc[i], j = i - 1;
      while (j >= 0 && sc[j] < v) { ms[j + 1] = ms[j]; sc[j + 1] = sc[j]; j--; }
      ms[j + 1] = m; sc[j + 1] = v;
    }
  }

  function orderMoves(ms, ply, ctl, pv) {
    var sc = new Array(ms.length);
    for (var i = 0; i < ms.length; i++) sc[i] = mscore(ms[i], ply, ctl, pv);
    sortBy(ms, sc);
  }

  function tick(ctl) {
    ctl.n++;
    if ((ctl.n & 255) === 0 && Date.now() >= ctl.dl) ctl.stop = true;
    return ctl.stop;
  }

  // ---------- quiescencia (solo capturas y coronaciones) ----------
  function qsearch(s, alpha, beta, ply, ctl, qd) {
    if (tick(ctl)) return 0;
    var inChk = Engine.inCheck(s, s.turn);
    var stand = -INF;
    if (!inChk) {
      stand = ctl.ev(s);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd >= 5) return stand;
    } else if (qd >= 5) {
      return ctl.ev(s);
    }

    var all = Engine.legalMoves(s), ms, i, m;
    if (all.length === 0) return inChk ? -(MATE - ply) : 0;
    if (inChk) {
      ms = all;
    } else {
      ms = [];
      for (i = 0; i < all.length; i++) {
        m = all[i];
        if (m.cap !== null) {
          if (stand + V[m.cap.t] + 200 < alpha) continue;   // poda delta
          ms.push(m);
        } else if (m.promo === "q") ms.push(m);
      }
      if (ms.length === 0) return stand;
    }

    var sc = new Array(ms.length);
    for (i = 0; i < ms.length; i++) {
      m = ms[i];
      sc[i] = m.cap !== null ? (V[m.cap.t] * 16 - V[m.t]) : 0;
      if (m.promo !== null) sc[i] += V[m.promo] * 8;
    }
    sortBy(ms, sc);

    var best = stand, v;
    for (i = 0; i < ms.length; i++) {
      v = -qsearch(Engine.makeMove(s, ms[i]), -beta, -alpha, ply + 1, ctl, qd + 1);
      if (ctl.stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // ---------- negamax alfa-beta ----------
  function search(s, depth, alpha, beta, ply, ctl) {
    if (tick(ctl)) return 0;
    if (s.half >= 100) return 0;

    var inChk = Engine.inCheck(s, s.turn);
    if (inChk && ply < 16) depth++;             // extension de jaque, con tope de ply
    if (depth <= 0) return ctl.q ? qsearch(s, alpha, beta, ply, ctl, 0) : ctl.ev(s);

    var ms = Engine.legalMoves(s);
    if (ms.length === 0) return inChk ? -(MATE - ply) : 0;

    orderMoves(ms, ply, ctl, null);

    var best = -INF, i, m, v;
    for (i = 0; i < ms.length; i++) {
      m = ms[i];
      v = -search(Engine.makeMove(s, m), depth - 1, -beta, -alpha, ply + 1, ctl);
      if (ctl.stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (m.cap === null) {
          var k = ctl.kill[ply];
          if (k !== undefined && !same(k[0], m)) { k[1] = k[0]; k[0] = m; }
          ctl.hist[(m.from << 6) | m.to] += depth * depth;
        }
        break;
      }
    }
    return best;
  }

  // ---------- nivel 1: casi aleatorio ----------
  function pickEasy(s, ms) {
    var opp = s.turn === "w" ? "b" : "w";
    var w = new Array(ms.length), tot = 0, i, k, m, ns, x, p;
    for (i = 0; i < ms.length; i++) {
      m = ms[i];
      ns = Engine.makeMove(s, m);
      // nunca dejar pasar un mate en 1
      if (Engine.inCheck(ns, ns.turn) && Engine.legalMoves(ns).length === 0) return m;
      x = 1;
      if (m.cap !== null) x += V[m.cap.t] / 60;        // sesgo leve a capturar
      if (m.promo === "q") x += 4;
      for (k = 0; k < 64; k++) {                        // no colgar la dama
        p = ns.b[k];
        if (p !== null && p.t === "q" && p.c === m.c && Engine.attacked(ns, k, opp)) {
          x *= 0.06;
          break;
        }
      }
      w[i] = x;
      tot += x;
    }
    var r = Math.random() * tot;
    for (i = 0; i < ms.length; i++) { r -= w[i]; if (r <= 0) return ms[i]; }
    return ms[ms.length - 1];
  }

  // ---------- raiz ----------
  function pick(state, level, hist, opts) {
    var lv = (level === 1 || level === 2) ? level : 3;
    var ms = Engine.legalMoves(state);
    if (ms.length === 0) return null;
    if (ms.length === 1) return ms[0];
    if (lv === 1) return pickEasy(state, ms);

    var budget = (opts && typeof opts.budgetMs === "number" && opts.budgetMs > 0)
      ? opts.budgetMs : (lv === 2 ? 140 : 520);

    var ctl = {
      n: 0, stop: false, dl: Infinity,
      ev: lv === 3 ? evalFull : evalMat,
      q: lv === 3,
      kill: new Array(64),
      hist: new Array(4096)
    };
    var i;
    for (i = 0; i < 64; i++) ctl.kill[i] = [null, null];
    for (i = 0; i < 4096; i++) ctl.hist[i] = 0;

    // Posiciones ya vistas: repetirlas por tercera vez son tablas.
    var rep = Object.create(null);
    if (hist) for (i = 0; i < hist.length; i++) rep[hist[i]] = (rep[hist[i]] || 0) + 1;

    var SLACK = lv === 2 ? 25 : 8;
    var maxD = lv === 2 ? 2 : 5;
    var t0 = Date.now(), hard = t0 + budget;
    var best = ms[0], pv = null, i2, m, ns, v, cur, bi, bs, aborted, alpha, pool, slack;

    for (var d = 1; d <= maxD; d++) {
      // La profundidad 1 siempre se completa: garantiza una jugada valida.
      ctl.dl = d === 1 ? Infinity : hard;
      if (d > 1 && Date.now() >= hard) break;

      orderMoves(ms, 0, ctl, pv);
      cur = new Array(ms.length);
      bs = -INF; bi = -1; aborted = false;

      for (i2 = 0; i2 < ms.length; i2++) {
        m = ms[i2];
        ns = Engine.makeMove(state, m);
        if ((rep[Engine.key(ns)] || 0) >= 2) {
          v = 0;                                   // conduce a tablas por repeticion
        } else {
          alpha = bs === -INF ? -INF : bs - SLACK; // ventana holgada: puntua los casi iguales
          v = -search(ns, d - 1, -INF, -alpha, 1, ctl);
          if (ctl.stop) { aborted = true; break; }
        }
        cur[i2] = v;
        if (v > bs) { bs = v; bi = i2; }
      }

      if (aborted || bi < 0) break;                // iteracion incompleta: se descarta

      pv = ms[bi];
      slack = Math.abs(bs) > MATE_ZONE ? 0 : SLACK;
      pool = [];
      for (i2 = 0; i2 < ms.length; i2++) if (cur[i2] >= bs - slack) pool.push(ms[i2]);
      best = pool[(Math.random() * pool.length) | 0];

      if (bs > MATE_ZONE) break;                   // mate encontrado: el mas corto ya es este
    }

    return best;
  }

  return { pick: pick, LEVELS: LEVELS };
})();
