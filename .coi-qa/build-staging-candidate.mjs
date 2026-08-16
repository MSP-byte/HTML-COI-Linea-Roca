import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD_REF = 'ooepgbzqlpjrtpaoqawc';
const STAGING_REF = 'brmrroikctfbtzwfewan';
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, '..');
const sourcePath = path.join(repoRoot, 'index.RC2.CANDIDATE.html');
const stagingTemplatePath = path.join(repoRoot, 'index.STAGING.html');
const outputPath = path.join(repoRoot, 'index.RC2.CANDIDATE.STAGING.html');

function fail(message) {
  throw new Error(`M6.1 staging candidate: ${message}`);
}

function readUtf8(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail(`${path.basename(filePath)} contiene BOM UTF-8 inesperado`);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    fail(`${path.basename(filePath)} no es UTF-8 valido`);
  }
  return { bytes, text };
}

function countLiteral(text, literal) {
  return text.split(literal).length - 1;
}

function oneMatch(text, regexp, description) {
  const matches = [...text.matchAll(regexp)];
  if (matches.length !== 1) {
    fail(`${description}: se esperaba 1 coincidencia y se encontraron ${matches.length}`);
  }
  return matches[0];
}

function extractConfig(text, label) {
  const blockMatch = oneMatch(
    text,
    /^[ \t]*const[ \t]+SUPABASE_CONFIG[ \t]*=[ \t]*\{[\s\S]*?^[ \t]*\};/gm,
    `${label} SUPABASE_CONFIG`,
  );
  const block = blockMatch[0];
  const urlMatch = oneMatch(
    block,
    /^[ \t]*url[ \t]*:[ \t]*(["'])(https:\/\/[a-z]{20}\.supabase\.co)\1[ \t]*,?[ \t]*$/gm,
    `${label} SUPABASE_CONFIG.url`,
  );
  const keyMatch = oneMatch(
    block,
    /^[ \t]*key[ \t]*:[ \t]*(["'])([^"'\r\n]+)\1[ \t]*,?[ \t]*$/gm,
    `${label} SUPABASE_CONFIG.key`,
  );
  return {
    block,
    blockIndex: blockMatch.index,
    url: urlMatch[2],
    key: keyMatch[2],
  };
}

function assertPublicClientKey(key, label) {
  if (key.startsWith('sb_publishable_')) return;
  const parts = key.split('.');
  if (parts.length !== 3) fail(`${label} no tiene formato publishable/anon reconocido`);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    fail(`${label} JWT no se pudo validar`);
  }
  if (payload?.role !== 'anon') fail(`${label} no corresponde al rol publico anon`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

const source = readUtf8(sourcePath);
const stagingTemplate = readUtf8(stagingTemplatePath);

if (countLiteral(source.text, PROD_REF) !== 1 || countLiteral(source.text, STAGING_REF) !== 0) {
  fail('el candidato fuente no contiene exclusivamente una referencia de produccion esperada');
}
if (countLiteral(stagingTemplate.text, STAGING_REF) !== 1 || countLiteral(stagingTemplate.text, PROD_REF) !== 0) {
  fail('la plantilla STAGING no contiene exclusivamente una referencia STAGING esperada');
}

const sourceConfig = extractConfig(source.text, 'origen');
const stagingConfig = extractConfig(stagingTemplate.text, 'STAGING');
if (sourceConfig.url !== PROD_URL) fail('SUPABASE_CONFIG.url de origen no coincide con produccion');
if (stagingConfig.url !== STAGING_URL) fail('SUPABASE_CONFIG.url de STAGING no coincide con STAGING');
assertPublicClientKey(sourceConfig.key, 'clave origen');
assertPublicClientKey(stagingConfig.key, 'clave STAGING');

const transformedBlock = sourceConfig.block
  .replace(sourceConfig.url, stagingConfig.url)
  .replace(sourceConfig.key, stagingConfig.key);
if (transformedBlock === sourceConfig.block) fail('la configuracion no produjo cambios');

const outputText =
  source.text.slice(0, sourceConfig.blockIndex)
  + transformedBlock
  + source.text.slice(sourceConfig.blockIndex + sourceConfig.block.length);

const outputConfig = extractConfig(outputText, 'salida');
if (outputConfig.url !== STAGING_URL || outputConfig.key !== stagingConfig.key) {
  fail('la configuracion de salida no coincide exactamente con STAGING');
}
if (countLiteral(outputText, PROD_REF) !== 0 || countLiteral(outputText, STAGING_REF) !== 1) {
  fail('la salida conserva referencias de produccion o tiene cardinalidad STAGING inesperada');
}

const reversedBlock = outputConfig.block
  .replace(outputConfig.url, sourceConfig.url)
  .replace(outputConfig.key, sourceConfig.key);
const reversedText =
  outputText.slice(0, outputConfig.blockIndex)
  + reversedBlock
  + outputText.slice(outputConfig.blockIndex + outputConfig.block.length);
if (reversedText !== source.text) fail('la transformacion altero contenido fuera de configuracion');

const outputBytes = Buffer.from(outputText, 'utf8');
fs.writeFileSync(outputPath, outputBytes);

const sourceLines = source.text.split(/\r?\n/);
const outputLines = outputText.split(/\r?\n/);
const changedLines = [];
for (let index = 0; index < Math.max(sourceLines.length, outputLines.length); index += 1) {
  if (sourceLines[index] !== outputLines[index]) changedLines.push(index + 1);
}
const expectedChangedLines = sourceConfig.key === stagingConfig.key ? 1 : 2;
if (changedLines.length !== expectedChangedLines) {
  fail(`se esperaban ${expectedChangedLines} lineas de configuracion diferentes y se encontraron ${changedLines.length}`);
}

console.log(JSON.stringify({
  source: path.basename(sourcePath),
  output: path.basename(outputPath),
  sourceSha256: sha256(source.bytes),
  outputSha256: sha256(outputBytes),
  projectRef: STAGING_REF,
  changedFields: sourceConfig.key === stagingConfig.key ? ['url'] : ['url', 'publicClientKey'],
  changedLines,
  logicalIdentityExcludingEnvironment: true,
}, null, 2));
