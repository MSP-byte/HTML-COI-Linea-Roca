'use strict';

const fs = require('node:fs');
const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');
const original = html;

const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">\n';
const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \\'self\\'; base-uri \\'self\\'; object-src \\'none\\'; form-action \\'self\\'; script-src \\'self\\' \\'unsafe-inline\\' https://cdn.jsdelivr.net https://unpkg.com; style-src \\'self\\' \\'unsafe-inline\\'; connect-src \\'self\\' https://ooepgbzqlpjrtpaoqawc.supabase.co wss://ooepgbzqlpjrtpaoqawc.supabase.co; img-src \\'self\\' data: blob: https:; font-src \\'self\\' data:; media-src \\'self\\' data: blob:; worker-src \\'self\\' blob:; manifest-src \\'self\\'">\n';

if (!html.includes('http-equiv="Content-Security-Policy"')) {
  if (!html.includes(viewport)) throw new Error('No se encontró el viewport canónico para insertar CSP.');
  html = html.replace(viewport, viewport + csp);
}

const tooltipUnsafe = "$('tip').innerHTML=\`<b>\${s.nombre}</b><br>Obras activas/asociadas: \${obrasActivas}<br>Servicios activos/asociados: \${serviciosActivos}<br>Estado general: <b>\${color==='bad'?'Demorado/vencido':color==='warn'?'Próximo a vencer':color==='done'?'Finalizado/certificado':'En plazo'}</b>\`;";
const tooltipSafe = "$('tip').innerHTML=\`<b>\${esc(s.nombre)}</b><br>Obras activas/asociadas: \${obrasActivas}<br>Servicios activos/asociados: \${serviciosActivos}<br>Estado general: <b>\${color==='bad'?'Demorado/vencido':color==='warn'?'Próximo a vencer':color==='done'?'Finalizado/certificado':'En plazo'}</b>\`;";
if (html.includes(tooltipUnsafe)) html = html.replaceAll(tooltipUnsafe, tooltipSafe);

const certUnsafe = "<td>\${r.ultimaActa?.numero||'—'}</td><td>\${fmtFecha(r.proximaCertificacion)}</td><td>\${r.proximoNroActa||1}</td>";
const certSafe = "<td>\${esc(r.ultimaActa?.numero||'—')}</td><td>\${fmtFecha(r.proximaCertificacion)}</td><td>\${esc(r.proximoNroActa||1)}</td>";
if (html.includes(certUnsafe)) html = html.replaceAll(certUnsafe, certSafe);

if (html.includes(tooltipUnsafe)) throw new Error('Persistió el sink inseguro del tooltip.');
if (html.includes(certUnsafe)) throw new Error('Persistió el sink inseguro de número de acta.');
if (!html.includes(csp.trim())) throw new Error('CSP no quedó aplicada.');

if (html === original) {
  console.log('Security frontend hardening: no-op, ya aplicado.');
  process.exit(0);
}
fs.writeFileSync(path, html, 'utf8');
console.log('Security frontend hardening: CSP y sinks dinámicos endurecidos.');
