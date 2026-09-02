/* Pruebas de extremo a extremo del juego en Chromium (sin servidor). */
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/* Playwright puede estar instalado globalmente: se busca en varios sitios. */
async function loadPlaywright() {
  for (const m of ['playwright', 'playwright-core']) {
    try { return await import(m); } catch (e) { /* siguiente */ }
  }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return await import(pathToFileURL(root + '/playwright/index.js').href);
  } catch (e) {
    console.error('Falta Playwright. Instalalo con:  npm i -D playwright');
    process.exit(2);
  }
}
const pw = await loadPlaywright();
const chromium = pw.chromium || (pw.default && pw.default.chromium);
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS || '.shots';
mkdirSync(SHOTS, { recursive: true });
const URL = 'file://' + resolve(process.env.PAGE||'index.html');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL);
await page.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });

console.log('\n== 1. Arranque ==');
ok(errors.length === 0, 'sin errores de consola al cargar' + (errors.length ? ' -> ' + errors[0] : ''));
ok(await page.evaluate(() => window.__BC.G.state.b.filter(Boolean).length) === 32, '32 piezas en el tablero inicial');
await page.screenshot({ path: SHOTS + '/01-inicio.png' });

console.log('\n== 2. Proyeccion 2.5D: el punto de cada casilla resuelve a su indice ==');
const proj = await page.evaluate(() => {
  const B = window.__BC; const bad = [];
  for (const f of [false, true]) {
    B.setFlip(f);
    for (let i = 0; i < 64; i++) {
      const a = B.anchorOfIdx(i);
      const got = B.pickSquare(a.x, a.y);
      if (got !== i) bad.push({ flip: f, i, got });
    }
  }
  B.setFlip(false);
  return bad;
});
ok(proj.length === 0, 'las 128 comprobaciones de hit-test coinciden' + (proj.length ? ' -> ' + JSON.stringify(proj.slice(0, 3)) : ''));

console.log('\n== 3. Combates: un guion por tipo de atacante ==');
const CASES = [
  ['peon (lanza)', '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 36, 27],
  ['caballo (embestida)', '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 44, 27],
  ['alfil (magia)', '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1', 41, 27],
  ['torre (golem)', '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1', 59, 27],
  ['reina (arcano)', '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 59, 27],
  ['rey (duelo)', '4k3/8/8/8/8/8/3p4/3K4 w - - 0 1', 59, 51]
];
for (const [name, fen, from, to] of CASES) {
  const r = await page.evaluate(async ([fen, from, to]) => {
    const B = window.__BC;
    document.getElementById('speed').value = 'normal';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    document.getElementById('mode').value = 'hh';
    document.getElementById('mode').dispatchEvent(new Event('change'));
    B.setState(B.Engine.fromFen(fen));
    const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to);
    if (!mv) return { err: 'no existe la jugada' };
    if (!mv.cap) return { err: 'la jugada no es captura' };
    const t0 = performance.now();
    B.startMove(mv);
    let frames = 0, cloud = 0, fxMax = 0;
    while (B.busy && performance.now() - t0 < 25000) {
      await new Promise(r => requestAnimationFrame(r));
      frames++;
      if (B.anim && B.anim.cloud) cloud++;
      fxMax = Math.max(fxMax, B.FX.alive());
    }
    return {
      ms: Math.round(performance.now() - t0), frames, fxMax, cloud,
      landed: !!(B.G.state.b[to] && B.G.state.b[to].t === mv.t),
      gone: B.G.state.b[from] === null,
      log: B.G.log[0] || ''
    };
  }, [fen, from, to]);
  ok(!r.err && r.landed && r.gone && r.ms > 1800 && r.ms < 12000 && r.fxMax > 4,
    name + ': ' + (r.err || (r.log + ' · ' + r.ms + 'ms · ' + r.frames + ' frames · pico ' + r.fxMax + ' particulas')));
}

console.log('\n== 4. Captura fotografica del combate ==');
await page.evaluate(async () => {
  const B = window.__BC;
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === 59 && m.to === 27);
  B.startMove(mv);
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 1500) await new Promise(r => requestAnimationFrame(r));
});
await page.screenshot({ path: SHOTS + '/02-combate.png' });
ok(true, 'captura guardada 02-combate.png');

console.log('\n== 5. Reglas especiales animadas ==');
const special = await page.evaluate(async () => {
  const B = window.__BC; const out = {};
  const run = async (fen, pred) => {
    B.setState(B.Engine.fromFen(fen));
    const mv = B.Engine.legalMoves(B.G.state).find(pred);
    if (!mv) return 'sin jugada';
    B.startMove(mv);
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 25000) await new Promise(r => requestAnimationFrame(r));
    return B.G.log[0];
  };
  out.enroqueCorto = await run('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', m => m.castle === 'K');
  out.enroqueLargo = await run('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', m => m.castle === 'Q');
  out.alPaso = await run('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', m => m.ep);
  out.promocion = await run('4k3/3P4/8/8/8/8/8/4K3 w - - 0 1', m => m.promo === 'q');
  out.promoCaptura = await run('2r1k3/3P4/8/8/8/8/8/4K3 w - - 0 1', m => m.promo === 'q' && m.cap);
  return out;
});
ok(/^O-O(\+|#)?$/.test(special.enroqueCorto), 'enroque corto animado: ' + special.enroqueCorto);
ok(/^O-O-O/.test(special.enroqueLargo), 'enroque largo animado: ' + special.enroqueLargo);
ok(/^exd6/.test(special.alPaso), 'captura al paso animada: ' + special.alPaso);
ok(/^d8=Q/.test(special.promocion), 'promocion animada: ' + special.promocion);
ok(/^dxc8=Q/.test(special.promoCaptura), 'captura + promocion: ' + special.promoCaptura);

console.log('\n== 6. Autojuego IA vs IA (instantaneo) ==');
const selfplay = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('level').value = '2';
  document.getElementById('level').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'aa';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.G.aiDelay = 0;
  const res = [];
  for (let g = 0; g < 3; g++) {
    B.newGame();
    const t0 = performance.now();
    while (!B.G.over && B.G.log.length < 260 && performance.now() - t0 < 60000) {
      await new Promise(r => requestAnimationFrame(r));
    }
    res.push({ plies: B.G.log.length, result: B.G.over ? B.G.over.result : 'limite', ms: Math.round(performance.now() - t0) });
  }
  return res;
});
for (const r of selfplay) ok(r.plies > 4, 'partida: ' + r.plies + ' plies, ' + r.result + ', ' + r.ms + 'ms');
await page.screenshot({ path: SHOTS + '/03-final.png' });

console.log('\n== 7. Rendimiento con animaciones completas ==');
const perf = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.G.aiDelay = 0.05;
  B.newGame();
  const t0 = performance.now(); let frames = 0; let worst = 0; let prev = t0;
  while (performance.now() - t0 < 6000 && !B.G.over) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(); const d = now - prev; prev = now;
    if (frames > 5) worst = Math.max(worst, d);
    frames++;
  }
  return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst), plies: B.G.log.length };
});
ok(perf.fps >= 40, 'fps medio ' + perf.fps + ' (peor frame ' + perf.worst + 'ms, ' + perf.plies + ' jugadas)');

console.log('\n== 8. Robustez: clics agresivos durante el combate ==');
const stress = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'));
  const cv = document.getElementById('board');
  const mv = B.Engine.legalMoves(B.G.state).find(m => m.cap);
  B.startMove(mv);
  for (let i = 0; i < 40; i++) {
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + Math.random() * r.width, clientY: r.top + Math.random() * r.height, bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
  }
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 20000) await new Promise(r => requestAnimationFrame(r));
  return { busy: B.busy, turn: B.G.state.turn, pieces: B.G.state.b.filter(Boolean).length };
});
ok(!stress.busy && stress.turn === 'b' && stress.pieces === 3, 'el juego no se bloquea con clics durante el combate');

console.log('\n== 9. Deshacer y nueva partida ==');
const undoT = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.newGame();
  const f0 = B.Engine.fen(B.G.state);
  const m1 = B.Engine.legalMoves(B.G.state)[0];
  B.startMove(m1);
  await new Promise(r => setTimeout(r, 60));
  const after = B.Engine.fen(B.G.state);
  B.undo();
  return { igual: B.Engine.fen(B.G.state) === f0, cambio: after !== f0, log: B.G.log.length };
});
ok(undoT.cambio && undoT.igual && undoT.log === 0, 'deshacer restaura la posicion exacta');

console.log('\n== 10. Adaptativo (movil) ==');
await page.setViewportSize({ width: 420, height: 860 });
await page.waitForTimeout(400);
const mob = await page.evaluate(() => {
  const s = document.getElementById('stage').getBoundingClientRect();
  return { w: Math.round(s.width), h: Math.round(s.height), scrollX: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
ok(!mob.scrollX && mob.w > 300, 'sin desbordamiento horizontal a 420px (' + mob.w + 'x' + mob.h + ')');
await page.screenshot({ path: SHOTS + '/04-movil.png', fullPage: false });

console.log('\n== 11. Interaccion real con el raton ==');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(300);
const clickSq = async (i) => {
  const pt = await page.evaluate((i) => {
    const B = window.__BC; const a = B.anchorOfIdx(i);
    const r = document.getElementById('board').getBoundingClientRect();
    return { x: r.left + a.x, y: r.top + a.y };
  }, i);
  await page.mouse.click(pt.x, pt.y);
};
await page.evaluate(() => {
  const B = window.__BC;
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.newGame();
});
await clickSq(52);                       // e2
const sel = await page.evaluate(() => ({ sel: window.__BC.G.sel, n: window.__BC.G.targets.length }));
ok(sel.sel === 52 && sel.n === 2, 'al pulsar e2 se selecciona y se ofrecen 2 destinos');
await clickSq(36);                       // e4
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 25000 });
const played = await page.evaluate(() => ({ log: window.__BC.G.log[0], turn: window.__BC.G.state.turn }));
ok(played.log === 'e4' && played.turn === 'b', 'la jugada se ejecuta con el raton: ' + played.log);
await clickSq(12);                       // e7 negras
await clickSq(28);                       // e5
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 25000 });
ok(await page.evaluate(() => window.__BC.G.log[1]) === 'e5', 'las negras responden en el mismo tablero');

console.log('\n== 12. Dialogo de coronacion por interfaz ==');
await page.evaluate(() => {
  const B = window.__BC;
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/3P4/8/8/8/8/8/4K3 w - - 0 1'));
});
await clickSq(11);                       // d7
await clickSq(3);                        // d8
const promoOpen = await page.evaluate(() => document.getElementById('promo').className.includes('show'));
ok(promoOpen, 'se abre el dialogo con las cuatro opciones de coronacion');
const nOpts = await page.$$eval('#promoRow .promoBtn', els => els.length);
ok(nOpts === 4, 'ofrece 4 piezas (' + nOpts + ')');
await page.click('#promoRow .promoBtn:nth-child(2)');   // torre
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 25000 });
const promoRes = await page.evaluate(() => ({ log: window.__BC.G.log[0], t: window.__BC.G.state.b[3] && window.__BC.G.state.b[3].t }));
ok(promoRes.t === 'r' && /=R/.test(promoRes.log), 'corona en la pieza elegida: ' + promoRes.log);

console.log('\n== 13. Cambiar ajustes en mitad de un combate ==');
const mid = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  for (let i = 0; i < 30; i++) await new Promise(r => requestAnimationFrame(r));
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('level').value = '3';
  document.getElementById('level').dispatchEvent(new Event('change'));
  document.getElementById('flip').click();
  window.dispatchEvent(new Event('resize'));
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 22000) await new Promise(r => requestAnimationFrame(r));
  document.getElementById('flip').click();
  return { busy: B.busy, log: B.G.log[0], pieces: B.G.state.b.filter(Boolean).length };
});
ok(!mid.busy && mid.log === 'Qxd5' && mid.pieces === 3, 'el combate termina bien pese a los cambios: ' + mid.log);

console.log('\n== 14. Sin peticiones de red ==');
const net = [];
const page2 = await browser.newPage({ viewport: { width: 1024, height: 720 } });
page2.on('request', r => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) net.push(r.url()); });
await page2.goto(URL);
await page2.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
await page2.waitForTimeout(1200);
ok(net.length === 0, 'ninguna peticion externa' + (net.length ? ' -> ' + net.slice(0, 3).join(', ') : ''));

console.log('\n== 15. prefers-reduced-motion ==');
const page3 = await browser.newPage({ viewport: { width: 1024, height: 720 } });
const err3 = [];
page3.on('pageerror', e => err3.push(e.message));
await page3.emulateMedia({ reducedMotion: 'reduce' });
await page3.goto(URL);
await page3.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const rm = await page3.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 22000) await new Promise(r => requestAnimationFrame(r));
  return { reduced: B.G.reduced, speed: B.G.speedKey, log: B.G.log[0], shake: B.FX.shake.x };
});
ok(rm.reduced && rm.log === 'exd5' && err3.length === 0, 'con movimiento reducido el combate se juega sin sacudidas ni destellos');
await page2.close(); await page3.close();

console.log('\n== 16. Atajos de teclado ==');
await page.evaluate(() => { window.__BC.newGame(); });
await page.keyboard.press('n');
await page.keyboard.press('f');
await page.keyboard.press('m');
await page.keyboard.press('u');
const kb = await page.evaluate(() => ({ muted: window.__BC.SFX.isMuted(), err: false }));
ok(kb.muted === true, 'la tecla M silencia el juego');
await page.keyboard.press('m');

console.log('\n== 17. La IA responde dentro de presupuesto ==');
const think = await page.evaluate(() => {
  const B = window.__BC;
  let st = B.Engine.newGame(), worst = 0, total = 0, n = 0;
  const hist = [B.Engine.key(st)];
  for (let i = 0; i < 16 && !B.Engine.status(st, hist).over; i++) {
    const t0 = performance.now();
    const mv = B.AI.pick(st, 3, hist);
    const dt = performance.now() - t0;
    if (!mv) break;
    worst = Math.max(worst, dt); total += dt; n++;
    st = B.Engine.makeMove(st, mv);
    hist.push(B.Engine.key(st));
  }
  return { worst: Math.round(worst), avg: Math.round(total / Math.max(1, n)), n };
});
ok(think.worst < 1200 && think.n >= 10, 'nivel 3: ' + think.n + ' jugadas, media ' + think.avg + 'ms, peor ' + think.worst + 'ms');

console.log('\n== 18. Partida completa contra la IA con animaciones ==');
const vsAi = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('mode').value = 'aa';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('level').value = '2';
  document.getElementById('level').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.G.aiDelay = 0.02;
  B.newGame();
  const t0 = performance.now();
  let caps = 0, seen = 0;
  while (!B.G.over && B.G.log.length < 40 && performance.now() - t0 < 70000) {
    await new Promise(r => requestAnimationFrame(r));
    if (B.anim && B.anim.move && B.anim.move.cap && B.anim.rt < 0.05) caps++;
    seen = B.G.log.length;
  }
  const out = { plies: seen, caps, capturadas: B.G.captured.w.length + B.G.captured.b.length, over: !!B.G.over };
  /* Se detiene la partida: si la IA sigue jugando en segundo plano, roba CPU a
     las mediciones de las secciones siguientes. */
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.G.aiDelay = 0.28;
  return out;
});
ok(vsAi.plies >= 20 && vsAi.capturadas >= 1, 'IA vs IA con animaciones completas: ' + vsAi.plies + ' jugadas, ' + vsAi.capturadas + ' piezas cobradas en combate');
await page.screenshot({ path: SHOTS + '/05-partida.png' });

console.log('\n== 19. Deshacer no congela la partida cuando el turno vuelve a la IA ==');
const undoAI = await page.evaluate(async () => {
  const B = window.__BC;
  const out = {};
  const settle = async (ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) await new Promise(r => requestAnimationFrame(r));
  };
  for (const mode of ['ah', 'aa', 'ha']) {
    document.getElementById('speed').value = 'sin';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    document.getElementById('level').value = '1';
    document.getElementById('level').dispatchEvent(new Event('change'));
    document.getElementById('mode').value = mode;
    document.getElementById('mode').dispatchEvent(new Event('change'));
    B.G.aiDelay = 0.02;
    B.newGame();
    // dejar que se jueguen unas cuantas jugadas
    const t0 = performance.now();
    while (B.G.log.length < (mode === 'ha' ? 1 : 4) && performance.now() - t0 < 12000) {
      if (mode === 'ha' && !B.busy && B.G.state.turn === 'w') {
        const ms = B.Engine.legalMoves(B.G.state);
        B.startMove(ms[0]);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
    const before = B.G.log.length;
    const pilaAntes = B.G.stack.length;
    document.getElementById('undo').click();
    await settle(1800);
    /* La congelacion es exactamente esto: le toca a la IA y no hay nada
       programado ni en curso que vaya a moverla. */
    const turn = B.G.state.turn;
    const esIA = mode === 'aa' || (mode === 'ha' && turn === 'b') || (mode === 'ah' && turn === 'w');
    out[mode] = {
      antes: before, despues: B.G.log.length, pilaAntes, pila: B.G.stack.length,
      congelada: esIA && !B.G.thinking && !B.busy && !B.G.over
    };
  }
  return out;
});
for (const m of ['ah', 'aa', 'ha']) {
  const r = undoAI[m];
  ok(r && r.antes > 0 && !r.congelada,
    'modo ' + m + ': tras deshacer la partida sigue viva (' + r.antes + ' -> ' + r.despues +
    ' jugadas, pila ' + r.pilaAntes + ' -> ' + r.pila + ')');
}

console.log('\n== 20. Girar el tablero durante un combate no corrompe la escena ==');
const flipMid = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  for (let i = 0; i < 25; i++) await new Promise(r => requestAnimationFrame(r));
  const btnDisabled = document.getElementById('flip').disabled;
  document.getElementById('flip').click();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  const actorSr = B.anim && B.anim.actors[0] ? B.anim.actors[0].sr : -1;
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 25000) await new Promise(r => requestAnimationFrame(r));
  // ahora, en reposo, girar SI debe funcionar
  const okBefore = B.G.log[0];
  document.getElementById('flip').click();
  const a = B.anchorOfIdx(27);
  const girado = B.pickSquare(a.x, a.y) === 27;
  B.setFlip(false);                      // se restaura la orientacion para las demas pruebas
  return { btnDisabled, actorSr, log: okBefore, girado };
});
ok(flipMid.btnDisabled, 'el boton Girar se deshabilita mientras hay combate');
ok(flipMid.log === 'exd5' && flipMid.girado, 'el combate termina bien y girar en reposo sigue funcionando');

console.log('\n== 21. El teclado no roba la tecla a los controles enfocados ==');
const kbFocus = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.newGame();
  B.startMove(B.Engine.legalMoves(B.G.state)[0]);
  await new Promise(r => setTimeout(r, 80));
  const antes = B.G.log.length;
  const btn = document.getElementById('undo');
  btn.focus();
  let defaultPrevented = false;
  const probe = (ev) => { defaultPrevented = ev.defaultPrevented; };
  window.addEventListener('keydown', probe, true);
  btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  window.removeEventListener('keydown', probe, true);
  const evt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  const noPrevent = btn.dispatchEvent(evt) && !evt.defaultPrevented;
  return { antes, noPrevent, foco: document.activeElement === btn };
});
ok(kbFocus.noPrevent && kbFocus.foco, 'con el boton Deshacer enfocado, Espacio no queda interceptado');

console.log('\n== 22. El lienzo nunca desborda su contenedor ==');
const sizes = [[1280, 800], [1024, 700], [900, 600], [800, 400], [420, 860], [380, 700], [1400, 320]];
let overflow = [];
for (const [w, h] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(220);
  const r = await page.evaluate(() => {
    const cvv = document.getElementById('board');
    const st = document.getElementById('stage');
    const c = cvv.getBoundingClientRect(), s = st.getBoundingClientRect();
    return {
      dx: Math.round(c.width - s.width), dy: Math.round(c.height - s.height),
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  if (r.dy > 1 || r.dx > 1 || r.hScroll) overflow.push(w + 'x' + h + ' -> sobra ' + r.dx + 'x' + r.dy + (r.hScroll ? ' + scroll horizontal' : ''));
}
ok(overflow.length === 0, 'siete tamanos sin recorte del tablero' + (overflow.length ? ' -> ' + overflow.join(' | ') : ''));

console.log('\n== 23. La ultima fila sigue siendo pulsable en ventana baja ==');
await page.setViewportSize({ width: 800, height: 400 });
await page.waitForTimeout(250);
const lowRow = await page.evaluate(() => {
  const B = window.__BC;
  const cvv = document.getElementById('board');
  const r = cvv.getBoundingClientRect();
  const bad = [];
  for (let i = 56; i < 64; i++) {              // fila 1: a1..h1
    const a = B.anchorOfIdx(i);
    if (a.y > r.height + 1 || a.x < 0 || a.x > r.width + 1) bad.push(B.Engine.sqName(i));
    if (B.pickSquare(a.x, a.y) !== i) bad.push(B.Engine.sqName(i) + '(hit)');
  }
  return bad;
});
ok(lowRow.length === 0, 'a1..h1 dentro del lienzo y pulsables a 800x400' + (lowRow.length ? ' -> ' + lowRow.join(',') : ''));

console.log('\n== 24. HiDPI no debe costar el doble que una pantalla normal ==');
/* El defecto original (dos degradados a pantalla completa por fotograma) hacia
   que DPR 2 rindiera la mitad que DPR 1. Se mide la RELACION entre ambos en el
   mismo momento: asi la carga de la maquina afecta por igual a los dos y la
   prueba mide el codigo, no el ruido del entorno. */
async function mideFps(dsf) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dsf });
  const errores = [];
  pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(URL);
  await pg.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
  const r = await pg.evaluate(async () => {
    const B = window.__BC;
    document.getElementById('mode').value = 'aa';
    document.getElementById('mode').dispatchEvent(new Event('change'));
    document.getElementById('level').value = '1';
    document.getElementById('level').dispatchEvent(new Event('change'));
    document.getElementById('speed').value = 'rapido';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    B.G.aiDelay = 0.02;
    B.newGame();
    const t0 = performance.now(); let frames = 0;
    while (performance.now() - t0 < 5000 && !B.G.over) { await new Promise(r => requestAnimationFrame(r)); frames++; }
    return { fps: frames / ((performance.now() - t0) / 1000), dpr: window.devicePixelRatio };
  });
  await pg.close();
  return { fps: r.fps, dpr: r.dpr, errores: errores };
}
const f1 = await mideFps(1);
const f2 = await mideFps(2);
const razon = f2.fps / Math.max(1, f1.fps);
ok(razon > 0.62 && f2.errores.length === 0,
  'dpr 2 rinde el ' + Math.round(razon * 100) + '% de dpr 1 (' + Math.round(f2.fps) + ' vs ' +
  Math.round(f1.fps) + ' fps; el defecto original lo dejaba en el 50%)');
ok(f1.fps >= 45, 'a dpr 1 el juego va a ' + Math.round(f1.fps) + ' fps');

console.log('\n== 25. El fogonazo cubre todo el lienzo con DPR 2 ==');
const hidpi = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await hidpi.goto(URL);
await hidpi.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const flashCov = await hidpi.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  const cvv = document.getElementById('board');
  const g = cvv.getContext('2d');
  const esquina = () => {
    const px = g.getImageData(cvv.width - 4, cvv.height - 4, 1, 1).data;
    return (px[0] + px[1] + px[2]) / 3;
  };
  let best = 0, seen = 0, reposo = 255;
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 28000) {
    await new Promise(r => requestAnimationFrame(r));
    const f = (B.anim && B.anim.flash) || 0;
    const lum = esquina();
    if (f > 0.2) { seen++; if (lum > best) best = lum; }
    else if (lum < reposo) reposo = lum;      // la misma esquina sin fogonazo
  }
  return { seen, best: Math.round(best), reposo: Math.round(reposo) };
});
/* Prueba diferencial: la vineta oscurece esa esquina, asi que lo que importa es
   que el fogonazo la ilumine, no que alcance un valor absoluto. */
ok(flashCov.seen > 0 && flashCov.best - flashCov.reposo > 35,
  'la esquina opuesta se ilumina durante el fogonazo (' + flashCov.seen + ' frames, ' +
  flashCov.reposo + ' -> ' + flashCov.best + ')');
await hidpi.close();
await page.setViewportSize({ width: 1280, height: 800 });

console.log('\n== 26. Los duelistas nunca quedan uno tapando al otro ==');
const DUELOS = [
  ['misma columna, cerca', '3r4/8/8/8/8/8/8/3RK1k1 w - - 0 1', 59, 3],
  ['misma columna, lejos', '4k3/3r4/8/8/8/8/8/3RK3 w - - 0 1', 59, 11],
  ['misma columna, un paso', '4k3/8/8/3p4/3R4/8/8/4K3 w - - 0 1', 35, 27],
  ['misma fila', '4k3/8/8/1R2p3/8/8/8/4K3 w - - 0 1', 25, 28],
  ['diagonal larga', '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1', 41, 27],
  ['caballo', '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 44, 27]
];
const seps = [];
for (const [name, fen, from, to] of DUELOS) {
  const r = await page.evaluate(async ([fen, from, to]) => {
    const B = window.__BC;
    document.getElementById('speed').value = 'epico';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    document.getElementById('mode').value = 'hh';
    document.getElementById('mode').dispatchEvent(new Event('change'));
    B.setFlip(false);
    B.setState(B.Engine.fromFen(fen));
    const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to);
    if (!mv || !mv.cap) return { err: 'sin captura' };
    B.startMove(mv);
    let peor = 99, medidas = 0;
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 28000) {
      await new Promise(r => requestAnimationFrame(r));
      const an = B.anim;
      if (!an || !an.spotAt || an.spot < 0.5) continue;
      const A = an.actors[0], D = an.actors[1];
      if (!A || !D || A.hidden || D.hidden) continue;
      /* Solo el cara a cara: durante la estocada o la embestida el atacante
         invade la casilla del defensor a proposito. */
      if (A.frame === 'attack' || D.frame === 'attack') continue;
      const pa = B.anchorOf(A.sr, A.sc), pd = B.anchorOf(D.sr, D.sc);
      const ancho = 24 * B.pix() * pd.s;          // anchura del sprite en pantalla
      const sep = Math.abs(pa.x - pd.x) / ancho;
      if (sep < peor) peor = sep;
      medidas++;
    }
    return { peor: Math.round(peor * 100) / 100, medidas };
  }, [fen, from, to]);
  seps.push(name + ': ' + (r.err || r.peor));
  ok(!r.err && r.medidas > 5 && r.peor >= 0.28,
    name + ': separacion minima ' + (r.err || r.peor) + ' anchuras de sprite (minimo 0.28)');
}

console.log('\n== 27. Los duelistas se pintan de lejos a cerca ==');
const orden = await page.evaluate(async () => {
  const B = window.__BC;
  B.setFlip(false);
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  let muestras = 0, desordenados = 0, conAtacanteDelante = 0;
  /* Dos sentidos: capturando hacia el fondo (atacante mas cerca) y hacia
     delante (atacante mas lejos). En ambos manda la profundidad. */
  for (const [fen, from, to] of [
    ['4k3/8/8/3p4/3R4/8/8/4K3 w - - 0 1', 35, 27],
    ['4k3/8/8/3R4/3p4/8/8/4K3 w - - 0 1', 27, 35]
  ]) {
    B.setState(B.Engine.fromFen(fen));
    const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to);
    if (!mv || !mv.cap) return { err: 'sin captura en ' + fen };
    B.startMove(mv);
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 28000) {
      await new Promise(r => requestAnimationFrame(r));
      const an = B.anim;
      const ord = an && an.drawOrder;
      if (!ord || ord.length < 2) continue;
      muestras++;
      for (let i = 1; i < ord.length; i++) if (ord[i] < ord[i - 1]) desordenados++;
      const A = an.actors[0], D = an.actors[1];
      if (A && D && A.sr > D.sr) conAtacanteDelante++;
    }
  }
  return { muestras, desordenados, conAtacanteDelante };
});
ok(!orden.err && orden.muestras > 20 && orden.desordenados === 0 && orden.conAtacanteDelante > 10,
  'el foco repinta a los duelistas ordenados por profundidad (' + orden.muestras +
  ' fotogramas, ' + orden.desordenados + ' desordenados)');

console.log('\n== 28. Espacio durante el combate no activa el boton enfocado ==');
const spaceGuard = await page.evaluate(async () => {
  const B = window.__BC;
  B.setFlip(false);
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
  const nueva = document.getElementById('new');
  nueva.focus();
  const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  nueva.dispatchEvent(ev);
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 20000) await new Promise(r => requestAnimationFrame(r));
  return {
    prevenido: ev.defaultPrevented,
    piezas: B.G.state.b.filter(Boolean).length,   // 3 si el combate acabo; 32 si "Nueva" se activo
    log: B.G.log[0] || ''
  };
});
ok(spaceGuard.prevenido && spaceGuard.piezas === 3 && spaceGuard.log === 'Qxd5',
  'con "Nueva" enfocado, Espacio acelera el combate en vez de reiniciar (' + spaceGuard.piezas + ' piezas, ' + spaceGuard.log + ')');

console.log('\n== 29. Cualquier gesto arranca el audio ==');
const audioArm = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await audioArm.addInitScript(() => {
  window.__ctxCreados = 0;
  const Real = window.AudioContext || window.webkitAudioContext;
  if (Real) {
    const Wrapped = function () { window.__ctxCreados++; return new Real(); };
    Wrapped.prototype = Real.prototype;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  }
});
await audioArm.goto(URL);
await audioArm.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const antesDeGesto = await audioArm.evaluate(() => window.__ctxCreados);
await audioArm.selectOption('#mode', 'aa');       // unico gesto: un desplegable
await audioArm.waitForTimeout(400);
const trasGesto = await audioArm.evaluate(() => window.__ctxCreados);
ok(antesDeGesto === 0 && trasGesto >= 1, 'elegir un modo arranca el AudioContext (' + antesDeGesto + ' -> ' + trasGesto + ')');
await audioArm.close();

console.log('\n== 30. prefers-reduced-motion suprime combate, fogonazo y parpadeo ==');
const rm2 = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await rm2.emulateMedia({ reducedMotion: 'reduce' });
await rm2.goto(URL);
await rm2.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const rmRes = await rm2.evaluate(async () => {
  const B = window.__BC;
  const inicial = { reduced: B.G.reduced, speed: B.G.speedKey, ts: B.G.timeScale };
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  let flashes = 0, blancos = 0, frames = 0;
  for (const fen of ['4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1']) {
    B.setState(B.Engine.fromFen(fen));
    B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 20000) {
      await new Promise(r => requestAnimationFrame(r));
      frames++;
      const an = B.anim;
      if (!an) continue;
      if (an.flash > 0.01) flashes++;
      for (const a of an.actors) if (a.white) blancos++;
    }
  }
  return { inicial, flashes, blancos, frames };
});
ok(rmRes.inicial.reduced && rmRes.inicial.speed === 'sin' && rmRes.inicial.ts === 0,
  'arranca en "Sin combate" con escala 0 (' + rmRes.inicial.speed + ', ts=' + rmRes.inicial.ts + ')');
ok(rmRes.flashes === 0 && rmRes.blancos === 0,
  'ni un fotograma con fogonazo o parpadeo blanco (' + rmRes.flashes + ' / ' + rmRes.blancos + ')');
await rm2.close();

console.log('\n== 31. "Sin combate" tiene escala 0 y corta la animacion en curso ==');
const speedZero = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  document.getElementById('speed').value = 'epico';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
  for (let i = 0; i < 24; i++) await new Promise(r => requestAnimationFrame(r));
  const t0 = performance.now();
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  const ts = B.G.timeScale;
  let esperas = 0;
  while (B.busy && performance.now() - t0 < 5000) { await new Promise(r => requestAnimationFrame(r)); esperas++; }
  return { ts, ms: Math.round(performance.now() - t0), esperas, log: B.G.log[0] || '', busy: B.busy };
});
ok(speedZero.ts === 0 && !speedZero.busy && speedZero.ms < 900 && speedZero.log === 'Qxd5',
  'elegir "Sin combate" corta el duelo al instante (escala ' + speedZero.ts + ', ' + speedZero.ms + 'ms)');
await page.evaluate(() => {
  document.getElementById('speed').value = 'normal';
  document.getElementById('speed').dispatchEvent(new Event('change'));
});

console.log('\n== 32. El lienzo sigue al contenedor cuando el panel crece ==');
await page.setViewportSize({ width: 380, height: 700 });
await page.waitForTimeout(350);
const grow = await page.evaluate(async () => {
  const B = window.__BC;
  const medir = () => {
    const st = document.getElementById('stage');
    const cvv = document.getElementById('board');
    return { stage: Math.round(st.clientHeight), canvas: Math.round(cvv.getBoundingClientRect().height) };
  };
  const antes = medir();
  /* Se juega una partida entera al instante: la cronica y los botines hacen
     crecer el panel y encoger #stage sin que haya evento 'resize'. */
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('level').value = '1';
  document.getElementById('level').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'aa';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.G.aiDelay = 0;
  B.newGame();
  const t0 = performance.now();
  while (B.G.log.length < 60 && !B.G.over && performance.now() - t0 < 30000) {
    await new Promise(r => requestAnimationFrame(r));
  }
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  const despues = medir();
  return { antes, despues, jugadas: B.G.log.length };
});
ok(Math.abs(grow.antes.canvas - grow.antes.stage) <= 1,
  'al arrancar el lienzo mide lo que #stage (' + grow.antes.canvas + ' vs ' + grow.antes.stage + ')');
ok(Math.abs(grow.despues.canvas - grow.despues.stage) <= 1,
  'tras ' + grow.jugadas + ' jugadas sigue midiendo lo que #stage (' + grow.despues.canvas + ' vs ' + grow.despues.stage + ')');

console.log('\n== 33. La fila 1 sigue siendo pulsable con el panel crecido ==');
const row1 = await page.evaluate(() => {
  const B = window.__BC;
  const cvv = document.getElementById('board');
  const r = cvv.getBoundingClientRect();
  const fuera = [];
  for (const i of [56, 57, 60, 63]) {
    const a = B.anchorOfIdx(i);
    const px = r.left + a.x, py = r.top + a.y;
    const el = document.elementFromPoint(px, py);
    if (!el || el.id !== 'board') fuera.push(B.Engine.sqName(i) + '->' + (el ? (el.id || el.tagName) : 'nada'));
  }
  return fuera;
});
ok(row1.length === 0, 'a1/b1/e1/h1 reciben el clic a 380x700' + (row1.length ? ' -> ' + row1.join(', ') : ''));

console.log('\n== 34. Los atajos siguen vivos con un boton enfocado ==');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(300);
const kbLive = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setFlip(false);
  B.newGame();
  const pulsa = (k, target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const flip = document.getElementById('flip');
  flip.focus();
  const antes = B.anchorOfIdx(56).y;
  pulsa('f', flip);
  const giro = Math.abs(B.anchorOfIdx(56).y - antes) > 5;
  B.setFlip(false);
  B.startMove(B.Engine.legalMoves(B.G.state)[0]);
  await new Promise(r => setTimeout(r, 80));
  const conJugada = B.G.log.length;
  const sonido = document.getElementById('sound');
  sonido.focus();
  pulsa('u', sonido);
  const deshizo = B.G.log.length < conJugada;
  /* Un desplegable si conserva el teclado: la busqueda por tecleo lo necesita. */
  const sel = document.getElementById('mode');
  sel.focus();
  const antes2 = B.anchorOfIdx(56).y;
  pulsa('f', sel);
  const selRespetado = Math.abs(B.anchorOfIdx(56).y - antes2) < 1;
  return { giro, deshizo, selRespetado, focoBoton: document.activeElement === sel };
});
ok(kbLive.giro && kbLive.deshizo, 'F y U funcionan con un boton enfocado');
ok(kbLive.selRespetado, 'un desplegable enfocado conserva el teclado');

console.log('\n== 35. Espacio no bloquea el desplazamiento fuera del combate ==');
const spaceScroll = await page.evaluate(() => {
  const B = window.__BC;
  const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  return { busy: B.busy, prevenido: ev.defaultPrevented };
});
ok(!spaceScroll.busy && !spaceScroll.prevenido, 'sin combate en curso, Espacio se deja pasar a la pagina');

console.log('\n== 36. El boton de sonido anuncia su estado ==');
const sndTitle = await page.evaluate(() => {
  const b = document.getElementById('sound');
  const t0 = b.title, p0 = b.getAttribute('aria-pressed');
  b.click();
  const t1 = b.title, p1 = b.getAttribute('aria-pressed');
  b.click();
  return { t0, p0, t1, p1, t2: b.title, p2: b.getAttribute('aria-pressed') };
});
ok(sndTitle.t0 !== sndTitle.t1 && sndTitle.p1 === 'true' && sndTitle.p2 === 'false' && sndTitle.t2 === sndTitle.t0,
  'el title y aria-pressed cambian al silenciar ("' + sndTitle.t0 + '" -> "' + sndTitle.t1 + '")');

console.log('\n== 37. La cronica nunca se queda sin altura ==');
const chron = [];
for (const [w, h] of [[1280, 560], [1024, 520], [1280, 800], [1400, 460]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const ol = document.getElementById('moves');
    const panel = document.querySelector('.panel');
    return {
      alto: Math.round(ol.clientHeight),
      alcanzable: panel.scrollHeight <= panel.clientHeight + 1 || getComputedStyle(panel).overflowY === 'auto'
    };
  });
  if (r.alto < 40 || !r.alcanzable) chron.push(w + 'x' + h + ' -> ' + r.alto + 'px');
}
ok(chron.length === 0, 'la cronica conserva altura util en ventanas bajas' + (chron.length ? ' -> ' + chron.join(', ') : ''));
await page.setViewportSize({ width: 1280, height: 800 });

console.log('\n== 38. Vista 3D: disponibilidad y hit-test en las tres camaras ==');
const tiene3d = await page.evaluate(() => window.__BC.R3.ready());
ok(tiene3d, 'el motor 3D arranca' + (tiene3d ? '' : ' -> ' + await page.evaluate(() => window.__BC.R3.lastError())));
if (tiene3d) {
  const hit3d = await page.evaluate(async () => {
    const B = window.__BC;
    B.setView('3d');
    const bad = [];
    for (const cam of ['clasica', 'isometrica', 'cenital']) {
      for (const f of [false, true]) {
        B.setCam(cam); B.setFlip(f);
        for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
        for (let idx = 0; idx < 64; idx++) {
          const a = B.anchorOfIdx(idx);
          if (B.pickSquare(a.x, a.y) !== idx) bad.push(cam + (f ? '/girado' : '') + ':' + B.Engine.sqName(idx));
        }
      }
    }
    B.setFlip(false); B.setCam('clasica');
    return bad;
  });
  ok(hit3d.length === 0, '384 comprobaciones de hit-test 3D (3 camaras x 2 orientaciones)' +
    (hit3d.length ? ' -> ' + hit3d.slice(0, 4).join(', ') : ''));

  console.log('\n== 39. Combates en 3D: cada pieza con su poder ==');
  const PODERES = [
    ['peon', '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 36, 27, 'exd5', 'LANZA'],
    ['caballo', '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 44, 27, 'Nxd5', 'CABALLERIA'],
    ['alfil', '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1', 41, 27, 'Bxd5', 'ARCANO'],
    ['torre', '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1', 59, 27, 'Rxd5', 'TERREMOTO'],
    ['reina', '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 59, 27, 'Qxd5', 'TORMENTA'],
    ['rey', '4k3/8/8/8/8/8/3p4/3K4 w - - 0 1', 59, 51, 'Kxd2', 'DUELO']
  ];
  for (const [nombre, fen, from, to, san, poder] of PODERES) {
    const r = await page.evaluate(async ([fen, from, to]) => {
      const B = window.__BC;
      document.getElementById('speed').value = 'rapido';
      document.getElementById('speed').dispatchEvent(new Event('change'));
      document.getElementById('mode').value = 'hh';
      document.getElementById('mode').dispatchEvent(new Event('change'));
      B.setState(B.Engine.fromFen(fen));
      const antes = B.G.state.b.filter(Boolean).length;
      const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to);
      const t0 = performance.now();
      B.startMove(mv);
      let fx = 0, label = '';
      while (B.busy && performance.now() - t0 < 25000) {
        await new Promise(r => requestAnimationFrame(r));
        fx = Math.max(fx, B.FX.alive());
        if (B.anim && B.anim.powerLabel) label = B.anim.powerLabel.text;
      }
      return {
        log: B.G.log[0], fx: fx, label: label,
        comida: antes - B.G.state.b.filter(Boolean).length
      };
    }, [fen, from, to]);
    ok(r.log === san && r.comida === 1 && r.fx > 10 && r.label.indexOf(poder) >= 0,
      nombre + ' en 3D: ' + r.log + ', ' + r.label + ', pico ' + r.fx + ' particulas');
  }

  console.log('\n== 40. Coste del fotograma 3D ==');
  const cpu3d = await page.evaluate(async () => {
    const B = window.__BC;
    B.newGame();
    const escena = [];
    for (let i = 0; i < 64; i++) {
      const q = B.G.state.b[i];
      if (q) escena.push({ t: q.t, c: q.c, sr: i >> 3, sc: i & 7, lift: 0, facing: 0 });
    }
    let t = 0, n = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t0 = performance.now();
      B.R3.draw({ pieces: escena, marks: [], shake: { x: 0, y: 0 } });
      if (i > 5) { t += performance.now() - t0; n++; }
    }
    const st = B.R3.stats();
    return { ms: +(t / n).toFixed(2), tris: st.triangulos, mallas: st.mallas };
  });
  ok(cpu3d.ms < 3 && cpu3d.tris > 1000,
    'pintar 32 piezas cuesta ' + cpu3d.ms + ' ms de CPU (' + cpu3d.tris + ' triangulos en ' + cpu3d.mallas + ' mallas)');

  console.log('\n== 41. Conmutar entre las dos vistas ==');
  const swap = await page.evaluate(async () => {
    const B = window.__BC;
    document.getElementById('speed').value = 'epico';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    document.getElementById('mode').value = 'hh';
    document.getElementById('mode').dispatchEvent(new Event('change'));
    B.setView('3d');
    B.setState(B.Engine.fromFen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'));
    B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.cap));
    for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
    const bloqueado = B.setView('2d') === false && B.view === '3d';
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 25000) await new Promise(r => requestAnimationFrame(r));
    const log3d = B.G.log[0];
    /* de 3D a 2.5D y se sigue jugando */
    B.setView('2d');
    B.newGame();
    document.getElementById('speed').value = 'sin';
    document.getElementById('speed').dispatchEvent(new Event('change'));
    B.startMove(B.Engine.legalMoves(B.G.state)[0]);
    await new Promise(r => setTimeout(r, 80));
    const ok2d = B.view === '2d' && B.G.log.length === 1;
    B.setView('3d');
    B.startMove(B.Engine.legalMoves(B.G.state)[0]);
    await new Promise(r => setTimeout(r, 80));
    const ok3d = B.view === '3d' && B.G.log.length === 2;
    B.setView('2d');
    return { bloqueado: bloqueado, log3d: log3d, ok2d: ok2d, ok3d: ok3d, final: B.view };
  });
  ok(swap.bloqueado, 'no se puede cambiar de vista en mitad de un combate');
  ok(swap.log3d === 'exd5', 'el combate empezado en 3D termina bien (' + swap.log3d + ')');
  ok(swap.ok2d && swap.ok3d && swap.final === '2d', 'se juega igual en las dos vistas y se vuelve a 2.5D');

  console.log('\n== 42. El angulo de camara cambia de verdad (y no depende del bucle del juego) ==');
  /* Primero: en 2.5D el selector de Camara no debe verse siquiera. El atributo
     [hidden] lo perdia contra `label { display:inline-flex }`, asi que el
     usuario lo veia en 2.5D, lo cambiaba y no se movia nada. */
  const camVis = await page.evaluate(() => {
    const B = window.__BC, w = document.getElementById('camWrap');
    const mide = () => ({ display: getComputedStyle(w).display, cajas: w.getClientRects().length });
    B.setView('2d'); const en2d = mide();
    B.setView('3d'); const en3d = mide();
    B.setView('2d');
    return { en2d, en3d };
  });
  ok(camVis.en2d.display === 'none' && camVis.en2d.cajas === 0 && camVis.en3d.cajas === 1,
    'el selector de Camara solo existe en 3D (2.5D: ' + camVis.en2d.display + ', 3D: ' + camVis.en3d.display + ')');
  /* Defecto reportado: "no cambia la camara, se queda estatica". La transicion
     vivia en game.js y un fallo silencioso la congelaba; ahora la conduce el
     propio motor, asi que la prueba ANULA R3.update para demostrarlo. */
  await page.evaluate(() => {
    const B = window.__BC;
    B.setView('3d');
    B.setCam('clasica');
    B.R3.update = function () { };          // el juego deja de empujar la camara
  });
  await page.waitForTimeout(600);
  const viaje = [];
  for (const [id, grados] of [['cenital', 87], ['isometrica', 43], ['clasica', 23]]) {
    const antes = await page.evaluate(() => Math.round(window.__BC.anchorOfIdx(0).y));
    await page.selectOption('#cam', id);
    const enMovimiento = await page.evaluate(() => window.__BC.R3.camMoving());
    await page.waitForFunction(() => !window.__BC.R3.camMoving(), null, { timeout: 8000 })
      .catch(() => { });
    const fin = await page.evaluate(() => ({
      y: Math.round(window.__BC.anchorOfIdx(0).y),
      el: window.__BC.R3.camState().el,
      nombre: window.__BC.R3.camState().nombre,
      moviendo: window.__BC.R3.camMoving()
    }));
    viaje.push({ id, grados, antes, y: fin.y, el: fin.el, nombre: fin.nombre, moviendo: fin.moviendo, arranca: enMovimiento });
  }
  const llega = viaje.every(v =>
    v.nombre === v.id && !v.moviendo && Math.abs(v.el - v.grados) < 0.01 && Math.abs(v.y - v.antes) > 20);
  ok(llega, 'las tres camaras llegan a su angulo sin ayuda del bucle: ' +
    viaje.map(v => v.id + ' ' + v.antes + '->' + v.y + 'px (' + Math.round(v.el) + ' grados)').join(', '));
  ok(viaje.every(v => v.arranca), 'el cambio arranca un viaje de camara, no un salto instantaneo');
  await page.evaluate(() => { window.__BC.setView('2d'); });
}

console.log('\n== 43. El audio se recupera solo de un contexto suspendido ==');
/* Defecto reportado: "luego de varios sonidos, el sonido se apaga y no se
   soluciona con el boton sonido". El navegador puede suspender el
   AudioContext por su cuenta; antes nadie lo reanudaba. Esta pagina anula el
   vigilante 'statechange' para comprobar las OTRAS dos vias de rescate. */
const snd = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await snd.addInitScript(() => {
  const Real = window.AudioContext || window.webkitAudioContext;
  if (!Real) return;
  const Wrapped = function () {
    const c = new Real();
    c.addEventListener = function () { };   // sin red de seguridad automatica
    window.__ctx = c;
    return c;
  };
  Wrapped.prototype = Real.prototype;
  window.AudioContext = Wrapped;
  window.webkitAudioContext = Wrapped;
});
await snd.goto(URL);
await snd.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
await snd.selectOption('#mode', 'hh');            // gesto real: arranca el audio
await snd.waitForTimeout(300);
const arranque = await snd.evaluate(() => window.__BC.SFX.estado());
ok(arranque === 'running', 'tras el primer gesto el audio esta vivo (' + arranque + ')');

const rescate = await snd.evaluate(async () => {
  const B = window.__BC;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  /* 1) el navegador suspende el contexto por su cuenta */
  await window.__ctx.suspend();
  const dormido = B.SFX.estado();
  /* 2) el siguiente sonido del juego debe despertarlo */
  B.SFX.play('tick');
  await espera(150);
  const trasSonido = B.SFX.estado();
  /* 3) y el boton Sonido tambien, aunque se haya vuelto a dormir */
  await window.__ctx.suspend();
  const dormidoOtraVez = B.SFX.estado();
  const b = document.getElementById('sound');
  b.click();                                       // silenciar
  b.click();                                       // volver a activar
  await espera(150);
  return { dormido, trasSonido, dormidoOtraVez, trasBoton: B.SFX.estado(), mudo: B.SFX.isMuted() };
});
ok(rescate.dormido === 'suspended' && rescate.trasSonido === 'running',
  'un sonido reanima el contexto suspendido (' + rescate.dormido + ' -> ' + rescate.trasSonido + ')');
ok(rescate.dormidoOtraVez === 'suspended' && rescate.trasBoton === 'running' && !rescate.mudo,
  'el boton Sonido reanima el contexto suspendido (' + rescate.dormidoOtraVez + ' -> ' + rescate.trasBoton + ')');
await snd.close();

console.log('\n== 44. Sonido con caracter: cada poder tiene su voz y suena desde su columna ==');
const voces = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  const orig = B.SFX.play;
  const CASOS = [
    ['peon', '4k3/8/8/7p/6P1/8/8/4K3 w - - 0 1', 38, 31, ['charge', 'whoosh', 'clash']],     // g4xh5: columna h
    ['caballo', '4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 44, 27, ['charge', 'gallop', 'clash']],
    ['alfil', '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1', 41, 27, ['charge', 'zap', 'disintegrate']],
    ['torre', '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1', 59, 27, ['charge', 'rumble', 'stone']],
    ['reina', '4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1', 59, 27, ['charge', 'zap', 'thunder']],
    ['rey', '4k3/8/8/8/8/8/3p4/3K4 w - - 0 1', 59, 51, ['charge', 'fanfare', 'clash']]
  ];
  const out = [];
  for (const [nombre, fen, from, to, esperadas] of CASOS) {
    const oidos = [];
    B.SFX.play = function (n, o) { oidos.push({ n: n, pan: o && o.pan }); return orig(n, o); };
    B.setState(B.Engine.fromFen(fen));
    const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to);
    B.startMove(mv);
    const t0 = performance.now();
    while (B.busy && performance.now() - t0 < 25000) await new Promise(r => requestAnimationFrame(r));
    B.SFX.play = orig;
    const nombres = new Set(oidos.map(o => o.n));
    const pans = oidos.filter(o => typeof o.pan === 'number').map(o => o.pan);
    out.push({
      nombre: nombre, faltan: esperadas.filter(n => !nombres.has(n)), distintas: nombres.size,
      pan: pans.length ? +(pans.reduce((a, b) => a + b, 0) / pans.length).toFixed(2) : null, log: B.G.log[0]
    });
  }
  return out;
});
for (const v of voces) {
  ok(v.faltan.length === 0 && v.distintas >= 5,
    v.nombre + ' (' + v.log + '): ' + v.distintas + ' voces distintas' + (v.faltan.length ? ', faltan ' + v.faltan.join(', ') : ''));
}
ok(voces[0].pan > 0.4, 'la captura en la columna h se oye a la derecha (pan medio ' + voces[0].pan + ')');
ok(voces.slice(1).every(v => Math.abs(v.pan) < 0.2), 'las capturas en la columna d suenan centradas (' + voces.slice(1).map(v => v.pan).join(', ') + ')');

console.log('\n== 45. Golpe con peso: hit-stop, tiron de camara y estela ==');
const peso = await page.evaluate(async () => {
  const B = window.__BC;
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1'));
  const mv = B.Engine.legalMoves(B.G.state).find(m => m.from === 44 && m.to === 27);
  B.startMove(mv);
  let stop = 0, punch = 0, ghosts = 0, vs = '';
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 25000) {
    await new Promise(r => requestAnimationFrame(r));
    if (B.anim) {
      stop = Math.max(stop, B.anim.stop || 0);
      if (B.anim.punch) punch = Math.max(punch, B.anim.punch.k);
      const A = B.anim.actors[0];
      if (A && A.ghosts) ghosts = Math.max(ghosts, A.ghosts.length);
      if (!vs) vs = document.getElementById('vs').textContent;
    }
  }
  return {
    stop: +stop.toFixed(3), punch: +punch.toFixed(2), ghosts: ghosts, vs: vs,
    ms: Math.round(performance.now() - t0), log: B.G.log[0], colgado: !!B.anim || B.busy,
    vsDespues: document.getElementById('vs').textContent
  };
});
ok(peso.stop > 0.03 && peso.punch > 0.3 && peso.ghosts >= 3 && peso.log === 'Nxd5' && !peso.colgado,
  'la embestida congela ' + peso.stop + ' s, tira de la camara (' + peso.punch + ') y deja ' + peso.ghosts + ' estelas; termina en ' + peso.ms + ' ms');
ok(/Caballero blanco .* Soldado negro/.test(peso.vs) && peso.vsDespues === '',
  'el cartel del duelo dice quien pelea ("' + peso.vs + '") y se borra al acabar');

/* con movimiento reducido no hay hit-stop, ni tiron, ni estela */
const rm3 = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await rm3.emulateMedia({ reducedMotion: 'reduce' });
await rm3.goto(URL);
await rm3.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const pesoRM = await rm3.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'rapido';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1'));
  B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.from === 44 && m.to === 27));
  let stop = 0, punch = 0, ghosts = 0;
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 25000) {
    await new Promise(r => requestAnimationFrame(r));
    if (B.anim) {
      stop = Math.max(stop, B.anim.stop || 0);
      if (B.anim.punch) punch = 1;
      const A = B.anim.actors[0];
      if (A && A.ghosts) ghosts = Math.max(ghosts, A.ghosts.length);
    }
  }
  return { stop, punch, ghosts, log: B.G.log[0] };
});
ok(pesoRM.stop === 0 && pesoRM.punch === 0 && pesoRM.ghosts === 0 && pesoRM.log === 'Nxd5',
  'con prefers-reduced-motion la embestida no congela, no tira de la camara ni deja estela');
await rm3.close();

console.log('\n== 46. Volumen: el control manda a SFX y se recuerda ==');
const ctxVol = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const pv = await ctxVol.newPage();
await pv.goto(URL);
await pv.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const vol1 = await pv.evaluate(() => {
  const s = document.getElementById('vol');
  const antes = window.__BC.SFX.getVolume();
  s.value = '30';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return { antes: antes, despues: window.__BC.SFX.getVolume(), title: s.title };
});
ok(Math.abs(vol1.antes - 0.7) < 1e-6 && Math.abs(vol1.despues - 0.3) < 1e-6 && /30/.test(vol1.title),
  'mover el control cambia el volumen (' + vol1.antes + ' -> ' + vol1.despues + ', "' + vol1.title + '")');
await pv.click('#sound');                       // silenciar: tambien se recuerda
const pv2 = await ctxVol.newPage();
await pv2.goto(URL);
await pv2.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const vol2 = await pv2.evaluate(() => ({
  vol: window.__BC.SFX.getVolume(), slider: document.getElementById('vol').value,
  mudo: window.__BC.SFX.isMuted(), pressed: document.getElementById('sound').getAttribute('aria-pressed'),
  ctx: window.__BC.SFX.estado()
}));
ok(Math.abs(vol2.vol - 0.3) < 1e-6 && vol2.slider === '30', 'al volver a abrir el juego el volumen sigue al 30%');
ok(vol2.mudo && vol2.pressed === 'true' && vol2.ctx === 'sin-contexto',
  'el silencio se recuerda sin crear un AudioContext antes del primer gesto (' + vol2.ctx + ')');
await ctxVol.close();

console.log('\n== 47. La cronica marca capturas, jaques y la ultima jugada ==');
const cron2 = await page.evaluate(async () => {
  const B = window.__BC;
  document.getElementById('speed').value = 'sin';
  document.getElementById('speed').dispatchEvent(new Event('change'));
  document.getElementById('mode').value = 'hh';
  document.getElementById('mode').dispatchEvent(new Event('change'));
  B.setState(B.Engine.fromFen('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'));
  const juega = async (from, to) => {
    B.startMove(B.Engine.legalMoves(B.G.state).find(m => m.from === from && m.to === to));
    await new Promise(r => setTimeout(r, 40));
  };
  await juega(59, 27);            // Qxd5   (captura)
  const pulso = document.getElementById('turn').classList.contains('pulse');
  await juega(4, 5);              // Kf8
  await juega(27, 3);             // Qd8+   (jaque)
  const q = s => document.querySelector(s);
  return {
    log: B.G.log.join(' '),
    cap: q('.movelist .san.cap') && q('.movelist .san.cap').textContent,
    chk: q('.movelist .san.chk') && q('.movelist .san.chk').textContent,
    ultimas: document.querySelectorAll('.movelist li.last').length,
    ultima: q('.movelist li.last') && q('.movelist li.last').textContent.replace(/\s+/g, ' ').trim(),
    pulso: pulso
  };
});
ok(cron2.cap === 'Qxd5' && cron2.chk === 'Qd8+' && cron2.ultimas === 1 && /Qd8\+/.test(cron2.ultima) && cron2.pulso,
  'capturas (' + cron2.cap + '), jaques (' + cron2.chk + ') y la ultima jugada (' + cron2.ultima + ') van marcados; el turno late');

console.log('\n== Errores acumulados en la pagina ==');
ok(errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'ninguno');

await browser.close();
console.log('\n' + (fails ? '### ' + fails + ' PRUEBAS FALLIDAS' : '### TODAS LAS PRUEBAS PASAN'));
process.exit(fails ? 1 : 0);
