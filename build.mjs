#!/usr/bin/env node
/* Empaqueta src/ en un unico index.html autocontenido. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as rsv } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SRC_DIR || 'src';
const OUT = process.env.OUT_FILE || 'index.html';
const src = (f) => readFileSync(rsv(root, SRC, f), 'utf8');

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
const css = readFileSync(join(root, 'src', 'ui.css'), 'utf8').trim();
const tpl = readFileSync(join(root, 'src', 'index.template.html'), 'utf8');

const out = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
writeFileSync(rsv(root, OUT), out);
console.log(OUT + ' generado: ' + (out.length / 1024).toFixed(1) + ' KB');
