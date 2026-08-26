/* Ejecuta todas las pruebas de Node (motor, IA, efectos, audio). */
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const files = existsSync('tests') ? readdirSync('tests').filter(f => f.endsWith('.js')).sort() : [];
if (!files.length) { console.error('no hay pruebas'); process.exit(1); }
let bad = 0;
for (const f of files) {
  process.stdout.write('\n─── tests/' + f + ' ' + '─'.repeat(Math.max(0, 46 - f.length)) + '\n');
  const r = spawnSync(process.execPath, ['tests/' + f], { stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0) { bad++; console.error('  ✗ fallo (codigo ' + r.status + ')'); }
}
console.log('\n' + (bad ? '### ' + bad + ' SUITE(S) FALLIDA(S)' : '### TODAS LAS SUITES DE NODE PASAN'));
process.exit(bad ? 1 : 0);
