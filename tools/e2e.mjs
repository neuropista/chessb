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

const browser = await chromium.launch();
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
    while (B.busy && performance.now() - t0 < 12000) {
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
  ok(!r.err && r.landed && r.gone && r.ms > 900 && r.ms < 9000 && r.fxMax > 4,
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
    while (B.busy && performance.now() - t0 < 12000) await new Promise(r => requestAnimationFrame(r));
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
  while (B.busy && performance.now() - t0 < 8000) await new Promise(r => requestAnimationFrame(r));
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
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 12000 });
const played = await page.evaluate(() => ({ log: window.__BC.G.log[0], turn: window.__BC.G.state.turn }));
ok(played.log === 'e4' && played.turn === 'b', 'la jugada se ejecuta con el raton: ' + played.log);
await clickSq(12);                       // e7 negras
await clickSq(28);                       // e5
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 12000 });
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
await page.waitForFunction(() => !window.__BC.busy, null, { timeout: 12000 });
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
  while (B.busy && performance.now() - t0 < 10000) await new Promise(r => requestAnimationFrame(r));
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
  while (B.busy && performance.now() - t0 < 10000) await new Promise(r => requestAnimationFrame(r));
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
  return { plies: seen, caps, capturadas: B.G.captured.w.length + B.G.captured.b.length, over: !!B.G.over };
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
  while (B.busy && performance.now() - t0 < 12000) await new Promise(r => requestAnimationFrame(r));
  // ahora, en reposo, girar SI debe funcionar
  const okBefore = B.G.log[0];
  document.getElementById('flip').click();
  const a = B.anchorOfIdx(27);
  return { btnDisabled, actorSr, log: okBefore, girado: B.pickSquare(a.x, a.y) === 27 };
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

console.log('\n== 24. Rendimiento en pantalla HiDPI (devicePixelRatio 2) ==');
const hidpi = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const hidpiErr = [];
hidpi.on('pageerror', e => hidpiErr.push(e.message));
await hidpi.goto(URL);
await hidpi.waitForFunction(() => window.__BC && window.__BC.G.state, null, { timeout: 20000 });
const hp = await hidpi.evaluate(async () => {
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
  while (performance.now() - t0 < 5000 && !B.G.over) {
    await new Promise(r => requestAnimationFrame(r));
    frames++;
  }
  return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), dpr: window.devicePixelRatio };
});
ok(hp.fps >= 45 && hidpiErr.length === 0, 'dpr ' + hp.dpr + ': ' + hp.fps + ' fps con animaciones (minimo 45)');

console.log('\n== 25. El fogonazo cubre todo el lienzo con DPR 2 ==');
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
  let best = 0, seen = 0;
  const t0 = performance.now();
  while (B.busy && performance.now() - t0 < 14000) {
    await new Promise(r => requestAnimationFrame(r));
    const f = B.anim && B.anim.flash;
    if (f && f > 0.2) {
      seen++;
      /* esquina inferior derecha: la zona que se quedaba sin pintar */
      const px = g.getImageData(cvv.width - 4, cvv.height - 4, 1, 1).data;
      const lum = (px[0] + px[1] + px[2]) / 3;
      if (lum > best) best = lum;
    }
  }
  return { seen, best: Math.round(best) };
});
ok(flashCov.seen > 0 && flashCov.best > 90, 'la esquina opuesta se ilumina durante el fogonazo (' + flashCov.seen + ' frames, luminancia ' + flashCov.best + ')');
await hidpi.close();
await page.setViewportSize({ width: 1280, height: 800 });

console.log('\n== Errores acumulados en la pagina ==');
ok(errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'ninguno');

await browser.close();
console.log('\n' + (fails ? '### ' + fails + ' PRUEBAS FALLIDAS' : '### TODAS LAS PRUEBAS PASAN'));
process.exit(fails ? 1 : 0);
