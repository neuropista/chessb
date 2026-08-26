/* Motor de ajedrez completo: reglas, SAN, FEN, perft. Indice 0 = a8, 63 = h1. */
const Engine = (function () {
  "use strict";

  const FILES = "abcdefgh";
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Direcciones: 0-3 rectas (torre), 4-7 diagonales (alfil)
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ND = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

  // Tablas precalculadas
  const KNIGHT_T = new Array(64);
  const KING_T = new Array(64);
  const RAYS = new Array(64);
  const PATT_W = new Array(64); // casillas desde las que un peon BLANCO ataca sq
  const PATT_B = new Array(64); // idem para peon NEGRO

  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3, c = sq & 7;
    let a = [];
    for (let i = 0; i < 8; i++) {
      const nr = r + ND[i][0], nc = c + ND[i][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) a.push(nr * 8 + nc);
    }
    KNIGHT_T[sq] = a;
    a = [];
    for (let i = 0; i < 8; i++) {
      const nr = r + DIRS[i][0], nc = c + DIRS[i][1];
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) a.push(nr * 8 + nc);
    }
    KING_T[sq] = a;
    const rr = new Array(8);
    for (let d = 0; d < 8; d++) {
      const ray = [];
      let nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        ray.push(nr * 8 + nc);
        nr += DIRS[d][0]; nc += DIRS[d][1];
      }
      rr[d] = ray;
    }
    RAYS[sq] = rr;
    const pw = [], pb = [];
    if (r + 1 < 8) {
      if (c > 0) pw.push((r + 1) * 8 + c - 1);
      if (c < 7) pw.push((r + 1) * 8 + c + 1);
    }
    if (r - 1 >= 0) {
      if (c > 0) pb.push((r - 1) * 8 + c - 1);
      if (c < 7) pb.push((r - 1) * 8 + c + 1);
    }
    PATT_W[sq] = pw; PATT_B[sq] = pb;
  }

  // Piezas compartidas (inmutables por convencion)
  const PC = {
    wp: { t: "p", c: "w" }, wn: { t: "n", c: "w" }, wb: { t: "b", c: "w" },
    wr: { t: "r", c: "w" }, wq: { t: "q", c: "w" }, wk: { t: "k", c: "w" },
    bp: { t: "p", c: "b" }, bn: { t: "n", c: "b" }, bb: { t: "b", c: "b" },
    br: { t: "r", c: "b" }, bq: { t: "q", c: "b" }, bk: { t: "k", c: "b" }
  };

  const PROMOS = ["q", "r", "b", "n"];

  function other(c) { return c === "w" ? "b" : "w"; }

  function sqName(i) { return FILES.charAt(i & 7) + (8 - (i >> 3)); }

  function sqIndex(n) {
    const c = n.charCodeAt(0) - 97;
    const r = 8 - (n.charCodeAt(1) - 48);
    return r * 8 + c;
  }

  function M(from, to, t, c, cap, promo, castle, ep, dbl) {
    return { from: from, to: to, t: t, c: c, cap: cap, promo: promo, castle: castle, ep: ep, dbl: dbl };
  }

  // ---------- Ataques ----------
  function attackedOn(b, sq, by) {
    let i, p;
    const pa = by === "w" ? PATT_W[sq] : PATT_B[sq];
    for (i = 0; i < pa.length; i++) {
      p = b[pa[i]];
      if (p !== null && p.t === "p" && p.c === by) return true;
    }
    const kn = KNIGHT_T[sq];
    for (i = 0; i < kn.length; i++) {
      p = b[kn[i]];
      if (p !== null && p.t === "n" && p.c === by) return true;
    }
    const kg = KING_T[sq];
    for (i = 0; i < kg.length; i++) {
      p = b[kg[i]];
      if (p !== null && p.t === "k" && p.c === by) return true;
    }
    const rr = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      const ray = rr[d];
      for (let j = 0; j < ray.length; j++) {
        p = b[ray[j]];
        if (p !== null) {
          if (p.c === by && (p.t === "q" || (d < 4 ? p.t === "r" : p.t === "b"))) return true;
          break;
        }
      }
    }
    return false;
  }

  function attacked(s, sq, byColor) { return attackedOn(s.b, sq, byColor); }

  function kingSq(b, c) {
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p !== null && p.t === "k" && p.c === c) return i;
    }
    return -1;
  }

  function inCheck(s, color) {
    const k = kingSq(s.b, color);
    return k < 0 ? false : attackedOn(s.b, k, other(color));
  }

  // ---------- Generacion pseudolegal ----------
  function pushPromos(out, from, to, c, q) {
    for (let i = 0; i < 4; i++) {
      out.push(M(from, to, "p", c, q === null ? null : { t: q.t, c: q.c, sq: to }, PROMOS[i], null, false, false));
    }
  }

  function genPawn(b, i, c, epSq, out) {
    const r = i >> 3, col = i & 7;
    const fwd = c === "w" ? -8 : 8;
    const startRow = c === "w" ? 6 : 1;
    const promoRow = c === "w" ? 0 : 7;
    const one = i + fwd;
    if (b[one] === null) {
      if ((one >> 3) === promoRow) pushPromos(out, i, one, c, null);
      else {
        out.push(M(i, one, "p", c, null, null, null, false, false));
        if (r === startRow) {
          const two = one + fwd;
          if (b[two] === null) out.push(M(i, two, "p", c, null, null, null, false, true));
        }
      }
    }
    for (let d = -1; d <= 1; d += 2) {
      const nc = col + d;
      if (nc < 0 || nc > 7) continue;
      const to = one + d;
      const q = b[to];
      if (q !== null) {
        if (q.c !== c) {
          if ((to >> 3) === promoRow) pushPromos(out, i, to, c, q);
          else out.push(M(i, to, "p", c, { t: q.t, c: q.c, sq: to }, null, null, false, false));
        }
      } else if (epSq !== null && to === epSq) {
        const capSq = to - fwd;
        const cp = b[capSq];
        if (cp !== null && cp.t === "p" && cp.c !== c) {
          out.push(M(i, to, "p", c, { t: "p", c: cp.c, sq: capSq }, null, null, true, false));
        }
      }
    }
  }

  function genCastle(s, i, c, out) {
    const b = s.b, cast = s.cast, opp = other(c);
    if (c === "w") {
      if (i !== 60 || (!cast.K && !cast.Q)) return;
      if (attackedOn(b, 60, opp)) return;
      if (cast.K && b[61] === null && b[62] === null && b[63] !== null && b[63].t === "r" && b[63].c === "w" &&
        !attackedOn(b, 61, opp) && !attackedOn(b, 62, opp)) {
        out.push(M(60, 62, "k", "w", null, null, "K", false, false));
      }
      if (cast.Q && b[59] === null && b[58] === null && b[57] === null && b[56] !== null && b[56].t === "r" && b[56].c === "w" &&
        !attackedOn(b, 59, opp) && !attackedOn(b, 58, opp)) {
        out.push(M(60, 58, "k", "w", null, null, "Q", false, false));
      }
    } else {
      if (i !== 4 || (!cast.k && !cast.q)) return;
      if (attackedOn(b, 4, opp)) return;
      if (cast.k && b[5] === null && b[6] === null && b[7] !== null && b[7].t === "r" && b[7].c === "b" &&
        !attackedOn(b, 5, opp) && !attackedOn(b, 6, opp)) {
        out.push(M(4, 6, "k", "b", null, null, "K", false, false));
      }
      if (cast.q && b[3] === null && b[2] === null && b[1] === null && b[0] !== null && b[0].t === "r" && b[0].c === "b" &&
        !attackedOn(b, 3, opp) && !attackedOn(b, 2, opp)) {
        out.push(M(4, 2, "k", "b", null, null, "Q", false, false));
      }
    }
  }

  function genPseudo(s, out) {
    const b = s.b, c = s.turn, ep = s.ep;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p === null || p.c !== c) continue;
      const t = p.t;
      if (t === "p") {
        genPawn(b, i, c, ep, out);
      } else if (t === "n") {
        const tg = KNIGHT_T[i];
        for (let k = 0; k < tg.length; k++) {
          const to = tg[k], q = b[to];
          if (q !== null && q.c === c) continue;
          out.push(M(i, to, "n", c, q === null ? null : { t: q.t, c: q.c, sq: to }, null, null, false, false));
        }
      } else if (t === "k") {
        const tg = KING_T[i];
        for (let k = 0; k < tg.length; k++) {
          const to = tg[k], q = b[to];
          if (q !== null && q.c === c) continue;
          out.push(M(i, to, "k", c, q === null ? null : { t: q.t, c: q.c, sq: to }, null, null, false, false));
        }
        genCastle(s, i, c, out);
      } else {
        const lo = t === "b" ? 4 : 0, hi = t === "r" ? 4 : 8;
        const rr = RAYS[i];
        for (let d = lo; d < hi; d++) {
          const ray = rr[d];
          for (let k = 0; k < ray.length; k++) {
            const to = ray[k], q = b[to];
            if (q === null) {
              out.push(M(i, to, t, c, null, null, null, false, false));
            } else {
              if (q.c !== c) out.push(M(i, to, t, c, { t: q.t, c: q.c, sq: to }, null, null, false, false));
              break;
            }
          }
        }
      }
    }
    return out;
  }

  // ---------- Legalidad (aplica y deshace sobre el mismo array) ----------
  function isLegal(b, m, ksq, opp) {
    const from = m.from, to = m.to;
    const mp = b[from];
    const cap = m.cap;
    let capSq = -1, cp = null;
    if (cap !== null) { capSq = cap.sq; cp = b[capSq]; b[capSq] = null; }
    b[from] = null;
    b[to] = mp;
    let rf = -1, rt = -1, rp = null;
    if (m.castle !== null) {
      if (m.castle === "K") { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
      rp = b[rf]; b[rf] = null; b[rt] = rp;
    }
    const k = m.t === "k" ? to : ksq;
    const bad = attackedOn(b, k, opp);
    if (m.castle !== null) { b[rt] = null; b[rf] = rp; }
    b[to] = null;
    b[from] = mp;
    if (cap !== null) b[capSq] = cp;
    return !bad;
  }

  function legalMoves(s) {
    const ps = genPseudo(s, []);
    const b = s.b, c = s.turn, opp = other(c);
    const ksq = kingSq(b, c);
    const out = [];
    for (let i = 0; i < ps.length; i++) {
      const m = ps[i];
      if (isLegal(b, m, ksq, opp)) out.push(m);
    }
    return out;
  }

  function movesFrom(s, from) {
    const all = legalMoves(s), out = [];
    for (let i = 0; i < all.length; i++) if (all[i].from === from) out.push(all[i]);
    return out;
  }

  // ---------- Estados ----------
  function makeMove(s, m) {
    const nb = s.b.slice();
    const c = m.c, from = m.from, to = m.to;
    const mp = nb[from];
    nb[from] = null;
    if (m.cap !== null && m.cap.sq !== to) nb[m.cap.sq] = null;
    nb[to] = m.promo !== null ? PC[c + m.promo] : mp;
    if (m.castle !== null) {
      let rf, rt;
      if (m.castle === "K") { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
      nb[rt] = nb[rf];
      nb[rf] = null;
    }
    const cast = { K: s.cast.K, Q: s.cast.Q, k: s.cast.k, q: s.cast.q };
    if (m.t === "k") {
      if (c === "w") { cast.K = false; cast.Q = false; } else { cast.k = false; cast.q = false; }
    }
    if (from === 63 || to === 63) cast.K = false;
    if (from === 56 || to === 56) cast.Q = false;
    if (from === 7 || to === 7) cast.k = false;
    if (from === 0 || to === 0) cast.q = false;
    return {
      b: nb,
      turn: other(c),
      cast: cast,
      ep: m.dbl ? ((from + to) >> 1) : null,
      half: (m.t === "p" || m.cap !== null) ? 0 : s.half + 1,
      full: c === "b" ? s.full + 1 : s.full
    };
  }

  function clone(s) {
    const nb = new Array(64);
    for (let i = 0; i < 64; i++) {
      const p = s.b[i];
      nb[i] = p === null ? null : { t: p.t, c: p.c };
    }
    return {
      b: nb, turn: s.turn,
      cast: { K: s.cast.K, Q: s.cast.Q, k: s.cast.k, q: s.cast.q },
      ep: s.ep, half: s.half, full: s.full
    };
  }

  // ---------- FEN ----------
  function placement(b) {
    let out = "";
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = b[r * 8 + c];
        if (p === null) empty++;
        else {
          if (empty > 0) { out += empty; empty = 0; }
          out += p.c === "w" ? p.t.toUpperCase() : p.t;
        }
      }
      if (empty > 0) out += empty;
      if (r < 7) out += "/";
    }
    return out;
  }

  function castStr(cast) {
    let x = "";
    if (cast.K) x += "K";
    if (cast.Q) x += "Q";
    if (cast.k) x += "k";
    if (cast.q) x += "q";
    return x === "" ? "-" : x;
  }

  function fen(s) {
    return placement(s.b) + " " + s.turn + " " + castStr(s.cast) + " " +
      (s.ep === null ? "-" : sqName(s.ep)) + " " + s.half + " " + s.full;
  }

  function fromFen(str) {
    const f = String(str).trim().split(/\s+/);
    const b = new Array(64);
    for (let i = 0; i < 64; i++) b[i] = null;
    const rows = f[0].split("/");
    for (let r = 0; r < 8 && r < rows.length; r++) {
      const row = rows[r];
      let c = 0;
      for (let k = 0; k < row.length; k++) {
        const ch = row.charAt(k);
        if (ch >= "1" && ch <= "8") c += ch.charCodeAt(0) - 48;
        else {
          const low = ch.toLowerCase();
          b[r * 8 + c] = PC[(ch === low ? "b" : "w") + low];
          c++;
        }
      }
    }
    const cs = f[2] === undefined ? "-" : f[2];
    let half = 0, full = 1;
    if (f[4] !== undefined) { const h = parseInt(f[4], 10); if (!isNaN(h)) half = h; }
    if (f[5] !== undefined) { const u = parseInt(f[5], 10); if (!isNaN(u)) full = u; }
    return {
      b: b,
      turn: f[1] === "b" ? "b" : "w",
      cast: { K: cs.indexOf("K") >= 0, Q: cs.indexOf("Q") >= 0, k: cs.indexOf("k") >= 0, q: cs.indexOf("q") >= 0 },
      ep: (f[3] === undefined || f[3] === "-") ? null : sqIndex(f[3]),
      half: half, full: full
    };
  }

  function newGame() {
    return fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  }

  // ---------- Clave de posicion (repeticion) ----------
  function epRelevant(s) {
    if (s.ep === null) return false;
    const att = s.turn === "w" ? PATT_W[s.ep] : PATT_B[s.ep];
    for (let i = 0; i < att.length; i++) {
      const p = s.b[att[i]];
      if (p !== null && p.t === "p" && p.c === s.turn) return true;
    }
    return false;
  }

  function key(s) {
    return placement(s.b) + " " + s.turn + " " + castStr(s.cast) + " " + (epRelevant(s) ? sqName(s.ep) : "-");
  }

  // ---------- Final de partida ----------
  function insufficient(b) {
    let knights = 0, bishops = 0, colorMask = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p === null || p.t === "k") continue;
      if (p.t === "p" || p.t === "r" || p.t === "q") return false;
      if (p.t === "n") knights++;
      else { bishops++; colorMask |= (1 << (((i >> 3) + (i & 7)) & 1)); }
    }
    if (knights === 0) return colorMask !== 3; // 0 alfiles, o todos de la misma casilla
    if (knights === 1 && bishops === 0) return true; // K+N vs K
    return false;
  }

  function status(s, hist) {
    const chk = inCheck(s, s.turn);
    const ms = legalMoves(s);
    if (ms.length === 0) {
      if (chk) return { over: true, check: true, result: "checkmate", winner: other(s.turn) };
      return { over: true, check: false, result: "stalemate", winner: null };
    }
    if (insufficient(s.b)) return { over: true, check: chk, result: "insufficient", winner: null };
    if (s.half >= 100) return { over: true, check: chk, result: "fifty", winner: null };
    if (hist && hist.length > 0) {
      const k = key(s);
      let n = 0;
      for (let i = 0; i < hist.length; i++) if (hist[i] === k) n++;
      if (n >= 3) return { over: true, check: chk, result: "repetition", winner: null };
    }
    return { over: false, check: chk, result: null, winner: null };
  }

  // ---------- SAN ----------
  function san(s, m) {
    let out;
    if (m.castle !== null) {
      out = m.castle === "K" ? "O-O" : "O-O-O";
    } else if (m.t === "p") {
      out = m.cap !== null ? (FILES.charAt(m.from & 7) + "x" + sqName(m.to)) : sqName(m.to);
      if (m.promo !== null) out += "=" + m.promo.toUpperCase();
    } else {
      const ms = legalMoves(s);
      let amb = false, sameFile = false, sameRank = false;
      for (let i = 0; i < ms.length; i++) {
        const o = ms[i];
        if (o.to === m.to && o.t === m.t && o.from !== m.from && o.castle === null) {
          amb = true;
          if ((o.from & 7) === (m.from & 7)) sameFile = true;
          if ((o.from >> 3) === (m.from >> 3)) sameRank = true;
        }
      }
      let dis = "";
      if (amb) {
        if (!sameFile) dis = FILES.charAt(m.from & 7);
        else if (!sameRank) dis = String(8 - (m.from >> 3));
        else dis = sqName(m.from);
      }
      out = m.t.toUpperCase() + dis + (m.cap !== null ? "x" : "") + sqName(m.to);
    }
    const ns = makeMove(s, m);
    if (inCheck(ns, ns.turn)) out += legalMoves(ns).length === 0 ? "#" : "+";
    return out;
  }

  // ---------- Perft ----------
  function perft(s, depth) {
    if (depth <= 0) return 1;
    const ms = legalMoves(s);
    if (depth === 1) return ms.length;
    let n = 0;
    for (let i = 0; i < ms.length; i++) n += perft(makeMove(s, ms[i]), depth - 1);
    return n;
  }

  return {
    VALUE: VALUE,
    newGame: newGame,
    clone: clone,
    legalMoves: legalMoves,
    movesFrom: movesFrom,
    makeMove: makeMove,
    inCheck: inCheck,
    attacked: attacked,
    key: key,
    status: status,
    san: san,
    sqName: sqName,
    sqIndex: sqIndex,
    fen: fen,
    fromFen: fromFen,
    perft: perft
  };
})();
