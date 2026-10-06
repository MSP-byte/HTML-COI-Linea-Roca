'use strict';
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');

function must(re, label) {
  if (!re.test(html)) {
    console.error('❌ Frontend security V1:', label);
    process.exit(1);
  }
}
must(/http-equiv="Content-Security-Policy"/i, 'debe existir CSP por meta');
must(/object-src 'none'/i, 'CSP debe bloquear object/embed');
must(/base-uri 'self'/i, 'CSP debe limitar base-uri');
must(/connect-src 'self' https:\/\/ooepgbzqlpjrtpaoqawc\.supabase\.co wss:\/\/ooepgbzqlpjrtpaoqawc\.supabase\.co/i,
  'CSP debe limitar conexiones al backend COI');
must(/\$\('tip'\)\.innerHTML=\`<b>\$\{esc\(s\.nombre\)\}<\/b>/,
  'tooltip de estación debe escapar nombre dinámico');
must(/<td>\$\{esc\(r\.ultimaActa\?\.numero\|\|'—'\)\}<\/td>/,
  'número de acta debe escaparse antes de innerHTML');

if (/\$\('tip'\)\.innerHTML=\`<b>\$\{s\.nombre\}<\/b>/.test(html)) {
  console.error('❌ Frontend security V1: reapareció tooltip sin escape');
  process.exit(1);
}
if (/<td>\$\{r\.ultimaActa\?\.numero\|\|'—'\}<\/td>/.test(html)) {
  console.error('❌ Frontend security V1: reapareció número de acta sin escape');
  process.exit(1);
}
console.log('✅ Frontend security V1: CSP + sinks XSS críticos protegidos.');
