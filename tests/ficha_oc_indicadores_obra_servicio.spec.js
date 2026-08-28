const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b,from=0){const x=SOURCE.indexOf(a,from),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}
const MAIN_MARKER=SOURCE.indexOf('data-coi-ficha-main-progress');
if(MAIN_MARKER<0)throw new Error('Bloque KPI superior nuevo no encontrado');
const KPI_START=SOURCE.lastIndexOf('<div class="oc-kpis">',MAIN_MARKER);
const KPI_END=SOURCE.indexOf('<div class="expediente-grid">',MAIN_MARKER);
if(KPI_START<0||KPI_END<0)throw new Error('No se pudo aislar el bloque KPI superior vigente');
const KPI_BLOCK=SOURCE.slice(KPI_START,KPI_END);
const HOTFIX_START=SOURCE.indexOf('<script id="coi-ficha-obra-supabase-summary">');
const HOTFIX=between('<script id="coi-ficha-obra-supabase-summary">','</script>',HOTFIX_START);

test('Obra muestra indicador superior de avance alimentado por aux_porcentaje real', async()=>{
  expect(KPI_BLOCK).toContain('data-coi-ficha-main-progress');
  expect(HOTFIX).toContain('row.aux_porcentaje');
  expect(HOTFIX).toContain("mainProgress.textContent=latest.progress===null?'—':fmtPct(latest.progress)");
});
test('Obra sin certificación no inventa cero por ciento', async()=>{
  expect(HOTFIX).toContain("if(!live.length)return {row:null");
  expect(HOTFIX).toContain("mainProgress.textContent='—'");
  expect(HOTFIX).not.toContain("mainProgress.textContent='0%'");
});
test('Obra conserva acta y fecha fin sin mostrar el rango completo', async()=>{
  expect(HOTFIX).toContain("latest.date?' · '+latest.date");
  expect(HOTFIX).not.toContain("latest.label+(latest.period!=='Sin período registrado'");
});
test('Servicio muestra última certificación con el acta real y sin línea de período', async()=>{
  expect(KPI_BLOCK).toContain('data-coi-ficha-main-last-cert');
  expect(HOTFIX).toContain('last.acta_medicion_nro');
  expect(KPI_BLOCK).not.toContain('data-coi-ficha-main-last-cert-period');
  expect(HOTFIX).not.toContain('mainLastCertPeriod');
  expect(HOTFIX).toContain("mainLastCert.textContent=latest.row?latest.label:(fallback?fallback.label:'—')");
});
test('Servicio sin certificación muestra guiones sin reintroducir el período', async()=>{
  expect(HOTFIX).toContain("mainLastCert.textContent='—'");
  expect(HOTFIX).not.toContain("mainLastCertPeriod.textContent='Sin período registrado'");
});
test('Servicio sin certificación estructurada cae a la última Acta de Medición documental (nunca inventa período)', async()=>{
  expect(HOTFIX).toContain('async function actaDocumentalFallback(item)');
  expect(HOTFIX).toContain('window.obtenerActasMedicionDocumentalesOC');
  expect(HOTFIX).toContain("' (documental)'");
  expect(HOTFIX).toContain("period:periodo||'Sin período registrado'");
  expect(HOTFIX).not.toMatch(/period:\s*fecha/);
  expect(HOTFIX).toContain('const fallback=latest.row?null:await actaDocumentalFallback(item)');
  expect(HOTFIX).toContain("mainLastCert.textContent=latest.row?latest.label:(fallback?fallback.label:'—')");
});
test('Vencimiento y días restantes quedan en una única tarjeta superior', async()=>{
  expect(KPI_BLOCK).toContain('<span>Vencimiento</span>');
  expect(KPI_BLOCK).toContain('días restantes');
  expect(KPI_BLOCK).not.toContain('<span>Días restantes</span>');
});
test('Control de Terceros sigue siendo inyectado por injectCT', async()=>{
  expect(SOURCE).toContain('function injectCT');
  expect(SOURCE).toContain('renderCTCard');
});

test('La tarjeta de última certificación ofrece el atajo Abrir PDF reutilizando el handler documental', async()=>{
  expect(KPI_BLOCK).toContain('data-coi-ficha-main-last-cert-actions');
  expect(KPI_BLOCK).toContain('data-coi-ficha-main-last-cert-pdf');
  expect(KPI_BLOCK).toContain('Abrir PDF');
  expect(KPI_BLOCK).not.toContain('onclick');
  // El atajo no implementa una segunda resolución de archivo: publica el id
  // documental que ya consume el handler delegado [data-storage-documento-id].
  expect(SOURCE).toContain('function actualizarAtajoPDFUltimaActa(ultima)');
  expect(SOURCE).toContain('boton.dataset.storageDocumentoId=id');
  expect(SOURCE).toContain('actualizarAtajoPDFUltimaActa(ultima);');
  // Sin archivo en Storage se replica el patrón UX existente en la tabla de actas.
  expect(SOURCE).toContain("boton.title='Archivo no disponible en Storage'");
});
