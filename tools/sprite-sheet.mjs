/* Renderiza todos los sprites a un PNG para inspeccion visual. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2] || '.shots/sprites.png';
mkdirSync('.shots', { recursive: true });
const files = ['theme.js','spr_pawn.js','spr_knight.js','spr_bishop.js','spr_rook.js','spr_queen.js','spr_king.js'];
for (const f of files) if (!existsSync('src/'+f)) { console.error('falta src/'+f); process.exit(1); }
const js = files.map(f=>readFileSync('src/'+f,'utf8')).join('\n');

const html = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#1a1512">
<canvas id=c></canvas><script>
${js}
const SPR={p:SPR_PAWN,n:SPR_KNIGHT,b:SPR_BISHOP,r:SPR_ROOK,q:SPR_QUEEN,k:SPR_KING};
const NAMES={p:'PEON soldado',n:'CABALLO jinete',b:'ALFIL hechicero',r:'TORRE golem',q:'REINA',k:'REY monarca'};
const K=6, PAD=14, FR=['idle','walk','attack'];
const cols=6, cw=24*K+PAD*2, rowH=32*K+52;
const c=document.getElementById('c');
c.width=cols*cw; c.height=rowH*6+30;
const g=c.getContext('2d');
g.fillStyle='#1a1512'; g.fillRect(0,0,c.width,c.height);
g.imageSmoothingEnabled=false;
g.font='11px monospace'; g.textAlign='center';
let row=0;
for (const t of ['p','n','b','r','q','k']){
  const spr=SPR[t]; let col=0;
  for (const side of ['w','b']){
    const pal=THEME.sprite[side];
    for (const f of FR){
      const x=col*cw, y=row*rowH+20;
      g.fillStyle=(col%2)?'#241d18':'#2e2620'; g.fillRect(x,y,cw,32*K+PAD);
      g.fillStyle='#0006'; g.fillRect(x+PAD, y+PAD+32*K-2, 24*K, 3);
      const rows=spr[f]||spr.idle;
      for(let py=0;py<spr.h;py++){const r=rows[py]||'';for(let px=0;px<spr.w;px++){const ch=r.charAt(px); if(!ch||ch==='.')continue; g.fillStyle=pal[ch]||'#f0f'; g.fillRect(x+PAD+px*K, y+PAD+py*K-PAD/2, K,K);}}
      g.fillStyle='#a8927a'; g.fillText(side+'/'+f, x+cw/2, y+32*K+PAD+12);
      col++;
    }
  }
  g.fillStyle='#e8b64c'; g.textAlign='left'; g.fillText(NAMES[t], 6, row*rowH+14); g.textAlign='center';
  row++;
}
document.title='ready';
<\/script>`;
const TMP = join(tmpdir(), 'bc-sheet.html');
writeFileSync(TMP, html);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + TMP);
await p.waitForFunction(()=>document.title==='ready',null,{timeout:15000});
const el = await p.$('#c');
await el.screenshot({path:OUT});
await b.close();
console.log('PNG ->', OUT);
