'use strict';

const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

function fail(message) {
  console.error(`❌ Frontend security baseline: ${message}`);
  process.exit(1);
}

const forbidden = [
  { re: /sb_secret_[A-Za-z0-9._-]+/g, label: 'Supabase secret key embebida' },
  { re: /SUPABASE_SERVICE_ROLE_KEY/g, label: 'variable service role en el frontend' },
  { re: /\beval\s*\(/g, label: 'eval()' },
  { re: /\bnew\s+Function\s*\(/g, label: 'new Function()' },
  { re: /document\.write\s*\(/g, label: 'document.write()' }
];

for (const { re, label } of forbidden) {
  const hits = html.match(re) || [];
  if (hits.length) fail(`${label}: ${hits.length} ocurrencia(s)`);
}

const metrics = {
  innerHTML: (html.match(/\.innerHTML\s*=/g) || []).length,
  insertAdjacentHTML: (html.match(/\.insertAdjacentHTML\s*\(/g) || []).length,
  localStorage: (html.match(/\blocalStorage\b/g) || []).length,
  sessionStorage: (html.match(/\bsessionStorage\b/g) || []).length,
  cspMeta: /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(html),
  supabasePublishableKey: /sb_publishable_[A-Za-z0-9._-]+/.test(html)
};

console.log('Frontend security baseline:', JSON.stringify(metrics));
console.log('✅ Frontend security baseline · sin secretos privilegiados ni ejecución dinámica prohibida');
