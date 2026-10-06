'use strict';

const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const findings = [];
let failed = false;

function finding(level, code, detail) {
  findings.push({ level, code, detail });
  if (level === 'CRITICAL' || level === 'HIGH') failed = true;
}

const criticalPatterns = [
  ['SUPABASE_SECRET_KEY', /sb_secret_[A-Za-z0-9._-]{12,}/g],
  ['SERVICE_ROLE_LITERAL', /service[_-]?role/gi],
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];

for (const [code, re] of criticalPatterns) {
  const hits = html.match(re) || [];
  if (hits.length) finding('CRITICAL', code, `${hits.length} coincidencia(s) en index.html`);
}

const highPatterns = [
  ['EVAL', /\beval\s*\(/g],
  ['NEW_FUNCTION', /\bnew\s+Function\s*\(/g],
  ['DOCUMENT_WRITE', /\bdocument\.write\s*\(/g]
];

for (const [code, re] of highPatterns) {
  const hits = html.match(re) || [];
  if (hits.length) finding('HIGH', code, `${hits.length} coincidencia(s) en index.html`);
}

const publishable = html.match(/sb_publishable_[A-Za-z0-9._-]{12,}/g) || [];
const legacyJwt = html.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) || [];
const csp = /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(html);
const innerHtmlAssignments = (html.match(/\.innerHTML\s*=/g) || []).length;
const insertAdjacentHtml = (html.match(/insertAdjacentHTML\s*\(/g) || []).length;
const localStorageWrites = (html.match(/localStorage\.setItem\s*\(/g) || []).length;
const csvGuard = /[=+@-].*CSV|CSV.*[=+@-]|formula injection|csv injection/i.test(html);

const lines = html.split(/\r?\n/);
const sinkContexts = [];
const dynamicTerms = /observ|proveedor|descripcion|descripci[oó]n|titulo|t[ií]tulo|expediente|estacion|estaci[oó]n|sector|email|nombre|document|remitente|destinatario|accion|acci[oó]n|responsable|motivo|riesgo|estado|nro_oc|tipo_trabajo/i;
const sanitizerTerms = /escape|sanitize|safeHtml|htmlEscape|escapar|textContent|createTextNode/i;
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if ((/\.innerHTML\s*=/.test(line) || /insertAdjacentHTML\s*\(/.test(line)) && dynamicTerms.test(line) && !sanitizerTerms.test(line)) {
    sinkContexts.push({ line: i + 1, text: line.trim().slice(0, 420) });
  }
}
const externalOrigins = [...new Set((html.match(/https:\/\/[^\s"'<>\\)]+/g) || []).map(value => {
  try { return new URL(value).origin; } catch { return null; }
}).filter(Boolean))].sort();

if (!publishable.length && legacyJwt.length) {
  findings.push({
    level: 'MEDIUM',
    code: 'LEGACY_SUPABASE_KEY',
    detail: 'El frontend parece usar una clave JWT legacy. Migrar a sb_publishable_ cuando sea compatible.'
  });
}

if (!csp) {
  findings.push({
    level: 'MEDIUM',
    code: 'CSP_NOT_DETECTED',
    detail: 'No se detectó CSP por meta en index.html. GitHub Pages no permite definir headers personalizados; evaluar meta CSP compatible con los recursos actuales.'
  });
}

if (!csvGuard) {
  findings.push({
    level: 'MEDIUM',
    code: 'CSV_FORMULA_GUARD_NOT_OBVIOUS',
    detail: 'No se detectó una defensa evidente contra CSV/Formula Injection; revisar el exportador CSV.'
  });
}

const report = {
  generated_at: new Date().toISOString(),
  critical_or_high_failure: failed,
  metrics: {
    publishable_key_literals: publishable.length,
    legacy_jwt_literals: legacyJwt.length,
    csp_meta_detected: csp,
    innerHTML_assignments: innerHtmlAssignments,
    insertAdjacentHTML_calls: insertAdjacentHtml,
    localStorage_setItem_calls: localStorageWrites,
    csv_formula_guard_detected: csvGuard,
    suspicious_dynamic_html_sinks: sinkContexts.length,
    external_origins: externalOrigins
  },
  findings,
  suspicious_sink_samples: sinkContexts.slice(0, 40)
};

console.log(JSON.stringify(report, null, 2));

if (failed) {
  console.error('Security surface scan: se detectaron hallazgos CRITICAL/HIGH.');
  process.exit(1);
}

console.log('Security surface scan: sin secretos privilegiados ni ejecución dinámica crítica detectada.');
