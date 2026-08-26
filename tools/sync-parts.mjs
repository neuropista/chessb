/* Copia los modulos y pruebas generados al repositorio, con rutas relativas. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SP = process.env.PARTS_DIR || process.argv[2];
if (!SP) { console.error('uso: node tools/sync-parts.mjs <dir-con-parts-y-tests>'); process.exit(1); }
let n = 0;
for (const f of readdirSync(join(SP, 'parts'))) {
  if (!f.endsWith('.js') && !f.endsWith('.css')) continue;
  writeFileSync(join('src', f), readFileSync(join(SP, 'parts', f), 'utf8'));
  n++;
}
if (existsSync(join(SP, 'tests'))) {
  for (const f of readdirSync(join(SP, 'tests'))) {
    if (!f.endsWith('.js')) continue;
    let s = readFileSync(join(SP, 'tests', f), 'utf8');
    // rutas absolutas del scratchpad -> rutas del repositorio
    s = s.replaceAll(SP + '/parts/', new URL('../src/', import.meta.url).pathname.replace(process.cwd() + '/', ''));
    s = s.replaceAll(SP + '/tests/', './tests/');
    s = s.replaceAll(SP + '/parts', 'src');
    writeFileSync(join('tests', f.replace(/\.js$/, '.cjs')), s);
    n++;
  }
}
console.log(n + ' archivos sincronizados');
