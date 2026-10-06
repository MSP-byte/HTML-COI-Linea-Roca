'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/202610050002_security_hardening_trigger_execute.sql',
  'utf8'
);

// Browser boundary.
assert.match(html, /Content-Security-Policy/i, 'Debe existir CSP en el HTML');
assert.match(html, /object-src 'none'/, 'CSP debe bloquear objetos');
assert.match(html, /base-uri 'none'/, 'CSP debe bloquear cambios de base URI');
assert.match(html, /connect-src[^"]*ooepgbzqlpjrtpaoqawc\.supabase\.co/i, 'CSP debe limitar conexiones a Supabase');
assert.match(html, /<meta name="referrer" content="no-referrer">/i, 'Debe existir política de referrer');

// Secrets: publishable sí; secretos elevados nunca.
assert.doesNotMatch(html, /sb_secret_/i, 'Nunca debe existir sb_secret en frontend');
assert.doesNotMatch(html, /service_role\s*[:=]\s*['"]/i, 'Nunca debe existir service_role hardcodeado');
assert.doesNotMatch(html, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  'No debe existir JWT largo hardcodeado');

// CSV/Excel formula injection.
assert.match(html, /function coiCSVCell\(value\)/, 'Debe existir serializador CSV central');
assert.match(html, /\[=\+@-\]/, 'CSV debe neutralizar prefijos de fórmula');

// External URLs and image uploads.
assert.match(html, /function coiURLHTTPValida\(value\)/, 'Debe validar URLs http\/https');
assert.doesNotMatch(html, /window\.open\(doc\.url_externa/, 'No abrir URL documental cruda');
assert.match(html, /coiURLHTTPValida\(externalUrl\)/, 'URL documental externa debe validarse');
assert.doesNotMatch(html, /accept=["']image\/\*["']/i, 'No aceptar cualquier MIME de imagen');
assert.match(html, /COI_IMAGE_MIME_ALLOWED/, 'Debe existir allowlist MIME de imágenes');
assert.match(html, /COI_IMAGE_MAX_BYTES=8\*1024\*1024/, 'Debe existir límite de 8 MB');

// XSS sinks puntuales corregidos.
assert.match(html, /<b>\$\{esc\(s\.nombre\)\}<\/b><br>Obras activas\/asociadas:/,
  'Tooltip de estación debe escapar nombre');
assert.match(html, /<option value="\$\{esc\(r\)\}">\$\{esc\(r\)\}<\/option>/,
  'Opciones de ramal deben escapar atributo y texto');

// DB boundary: trigger helpers no son RPC cliente.
assert.match(migration, /p\.prorettype\s*=\s*'trigger'::regtype/i,
  'La migración debe seleccionar sólo funciones trigger');
assert.match(migration, /revoke all privileges on function[\s\S]*from public, anon, authenticated/i,
  'Debe revocar EXECUTE directo de funciones trigger a roles cliente');

console.log('✅ Security hardening V1: browser, secretos, CSV, URLs, imágenes y triggers protegidos');
