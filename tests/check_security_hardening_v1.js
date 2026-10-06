'use strict';

const fs = require('fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const html = fs.readFileSync('index.html', 'utf8');

// Browser boundary.
assert.match(html, /Content-Security-Policy/i, 'Debe existir CSP en el HTML');
assert.match(html, /object-src 'none'/, 'CSP debe bloquear objetos');
assert.match(html, /base-uri 'none'/, 'CSP debe bloquear cambios de base URI');
assert.match(html, /connect-src[^"]*ooepgbzqlpjrtpaoqawc\.supabase\.co/i, 'CSP debe limitar conexiones a Supabase');
assert.match(html, /img-src 'self' data: blob: https:/i, 'CSP debe conservar imágenes HTTPS y recursos propios');
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
assert.match(html, /\(\?:assets\|img\)\\\//i, 'Imágenes relativas del repositorio deben seguir permitidas');

// XSS sinks puntuales corregidos.
assert.match(html, /<b>\$\{esc\(s\.nombre\)\}<\/b><br>Obras activas\/asociadas:/,
  'Tooltip de estación debe escapar nombre');
assert.match(html, /<option value="\$\{esc\(r\)\}">\$\{esc\(r\)\}<\/option>/,
  'Opciones de ramal deben escapar atributo y texto');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');
const PLATFORM = [
  'create role anon nologin;',
  'create role authenticated nologin;',
  'create schema auth;',
  'create table auth.users(id uuid primary key, email text);',
  'create function auth.uid() returns uuid language sql stable as $fn$',
  "  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid",
  '$fn$;',
  'create function auth.jwt() returns jsonb language sql stable as $fn$',
  "  select jsonb_build_object('email', current_setting('request.jwt.claim.email', true))",
  '$fn$;'
].join('\n');

async function main(){
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATFORM);
  const files = fs.readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files){
    try{ await db.exec(fs.readFileSync(path.join(MIGRATIONS,file),'utf8')); }
    catch(error){
      try{ await db.exec('rollback'); }catch{}
      throw new Error(`migración no reproducible ${file}: ${error.message}`);
    }
  }

  const { rows } = await db.query(`
    select p.proname,
           has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
           has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname like 'coi_%'
       and p.prorettype='trigger'::regtype
     order by p.proname`);

  assert.ok(rows.length > 0, 'el selector debe encontrar funciones trigger COI');
  assert.deepEqual(
    rows.filter(r=>r.anon_exec || r.auth_exec),
    [],
    'ninguna función trigger COI debe conservar EXECUTE directo para anon/authenticated'
  );

  console.log(`✅ Security hardening V1: browser + ${rows.length} funciones trigger verificadas en catálogo PGlite`);
  await db.close();
}

main().catch(error=>{
  console.error('❌ Security hardening V1:', error);
  process.exitCode=1;
});
