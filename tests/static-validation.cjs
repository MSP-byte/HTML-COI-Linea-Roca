const fs = require('fs');
const source = fs.readFileSync('index.html', 'utf8');
const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const syntaxErrors = [];
scripts.forEach((match, index) => {
  try { new Function(match[1]); }
  catch (error) { syntaxErrors.push({ script: index + 1, line: source.slice(0, match.index).split(/\r?\n/).length, message: error.message }); }
});
const ids = [...source.matchAll(/\sid=["']([^"']+)["']/gi)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
const checks = {
  doctypeCount: (source.match(/<!doctype html>/gi) || []).length,
  htmlOpenCount: (source.match(/<html(?:\s|>)/gi) || []).length,
  htmlCloseCount: (source.match(/<\/html>/gi) || []).length,
  scriptCount: scripts.length,
  syntaxErrors,
  duplicateIds,
  hotfixMemo: source.includes('id="coi-hotfix-memo-todaslasoc"'),
  hotfixMonto: source.includes('id="coi-hotfix-parse-montos-ar"'),
  parserMonto: source.includes('window.coiParseMontoAR = coiParseMontoAR'),
  diagnosticFunction: source.includes('window.COIDiagnosticoInteraccion=diagnostic'),
  recoveryFunction: source.includes('window.COIRecuperarInterfaz=recover'),
  readyEvent: source.includes("new CustomEvent('coi:ready'"),
  versionMutationObserverRemoved: !source.includes('versionObserver=new MutationObserver(()=>applyVersion())'),
  serviceWorkerReferences: (source.match(/serviceWorker/g) || []).length,
  cacheStorageReferences: (source.match(/\bcaches\s*\./g) || []).length,
  localFileUrls: [...source.matchAll(/(?:file:\/\/\/?|[A-Z]:\\\\)[^\s"'<>]*/gi)].map(match => match[0]).slice(0, 20)
};
checks.passed = checks.doctypeCount === 1 && checks.htmlOpenCount === 1 && checks.htmlCloseCount === 1 && syntaxErrors.length === 0 && checks.hotfixMemo && checks.hotfixMonto && checks.parserMonto && checks.diagnosticFunction && checks.recoveryFunction && checks.readyEvent && checks.versionMutationObserverRemoved && checks.serviceWorkerReferences === 0 && checks.cacheStorageReferences === 0 && checks.localFileUrls.length === 0;
process.stdout.write(JSON.stringify(checks, null, 2));
