#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const csstree = require('css-tree');

const html = fs.readFileSync('index.html', 'utf8');
const styles = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)];

assert.ok(styles.length > 0, 'No se encontraron bloques CSS inline para validar');
styles.forEach((match, index) => {
  csstree.parse(match[1], {
    positions: true,
    filename: `index.html#style-${index + 1}`
  });
});

console.log(`CSS: ${styles.length} bloques inline con sintaxis válida.`);
