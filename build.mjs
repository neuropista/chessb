#!/usr/bin/env node
/* Empaqueta src/ en un unico index.html autocontenido. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');

const ORDER = [
  'theme.js',
  'engine.js',
  'ai.js',
  'spr_pawn.js', 'spr_knight.js', 'spr_bishop.js', 'spr_rook.js', 'spr_queen.js', 'spr_king.js',
  'fx.js',
  'audio.js',
  'game.js'
];

const js = ORDER.map((f) => '/* ===== ' + f + ' ===== */\n' + src(f).trim()).join('\n\n');
const css = src('ui.css').trim();
const tpl = src('index.template.html');

const out = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
writeFileSync(join(root, 'index.html'), out);
console.log('index.html generado: ' + (out.length / 1024).toFixed(1) + ' KB');
