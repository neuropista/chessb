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

console.log('\n== Errores acumulados en la pagina ==');
ok(errors.length === 0, errors.length ? errors.slice(0, 5).join(' | ') : 'ninguno');

await browser.close();
console.log('\n' + (fails ? '### ' + fails + ' PRUEBAS FALLIDAS' : '### TODAS LAS PRUEBAS PASAN'));
process.exit(fails ? 1 : 0);
