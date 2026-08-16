import fs from 'fs';
import path from 'path';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const mode = arg('--mode', 'dirty');
if (!['dirty', 'admin-state', 'full'].includes(mode)) {
  throw new Error(`Modo QA no soportado: ${mode}`);
}

const repo = path.resolve(arg('--repo', process.cwd()));
const qaDir = path.join(repo, '.coi-qa');
const cfgPath = path.join(qaDir, 'coi-qa.config.json');
if (!fs.existsSync(cfgPath)) throw new Error('No encuentro coi-qa.config.json.');
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const targetHtml = arg('--html', config.stagingHtml);
if (path.basename(targetHtml) !== targetHtml || !targetHtml.toLowerCase().endsWith('.html')) {
  throw new Error('El HTML bajo prueba debe estar en la raiz del repo.');
}
const targetPath = path.join(repo, targetHtml);
if (!fs.existsSync(targetPath)) throw new Error(`No existe el HTML bajo prueba: ${targetHtml}`);

const source = fs.readFileSync(targetPath, 'utf8');
const refs = [...source.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/gi)].map(match => match[1]);
if (refs.includes(config.productionProjectRef)) {
  throw new Error('WRITE/QA BLOQUEADO: el HTML contiene el project-ref de PRODUCCION.');
}
if (!refs.includes(config.stagingProjectRef)) {
  throw new Error(`QA BLOQUEADO: el HTML no apunta al STAGING esperado (${config.stagingProjectRef}).`);
}

const explicitWriteConsent =
  process.argv.includes('--allow-staging-write') ||
  process.env.COI_ALLOW_STAGING_WRITE === '1';
if (mode === 'full' && !explicitWriteConsent) {
  throw new Error('UiFullE2E requiere consentimiento explicito: --allow-staging-write o COI_ALLOW_STAGING_WRITE=1.');
}

// El core conserva la suite E2E certificada. Este entrypoint existe para que
// ninguna invocacion directa pueda saltear los guardrails de STAGING.
await import('./ui-smoke-core.mjs');
