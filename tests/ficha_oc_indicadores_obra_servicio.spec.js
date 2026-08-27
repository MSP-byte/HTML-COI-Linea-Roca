const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b,from=0){const x=SOURCE.indexOf(a,from),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}
const ACTIVE_START=SOURCE.lastIndexOf('function renderFichaOC(title){');
const ACTIVE=between('function renderFichaOC(title){','function actualizarFiltroEstaciones',ACTIVE_START);
const HOTFIX_START=SOURCE.indexOf('<script id="coi-ficha-obra-supabase-summary">');
const HOTFIX=between('<script id="coi-ficha-obra-supabase-summary">','</script>',HOTFIX_START);

test('Obra muestra indicador superior de avance alimentado por aux_porcentaje real', async()=>{
  expect(ACTIVE).toContain('data-coi-ficha-main-progress');
  expect(HOTFIX).toContain('row.aux_porcentaje');
  expect(HOTFIX).toContain("mainProgress.textContent=latest.progress===null?'—':fmtPct(latest.progress)");
});
test('Obra sin certificación no inventa cero por ciento', async()=>{
  expect(HOTFIX).toContain("if(!live.length)return {row:null");
  expect(HOTFIX).toContain("mainProgress.textContent='—'");
  expect(HOTFIX).not.toContain("mainProgress.textContent='0%'");
});
test('Servicio muestra última certificación con acta real y período', async()=>{
  expect(ACTIVE).toContain('data-coi-ficha-main-last-cert');
  expect(HOTFIX).toContain('last.acta_medicion_nro');
  expect(HOTFIX).toContain('mainLastCertPeriod');
  expect(HOTFIX).toContain("mainLastCert.textContent=latest.row?latest.label:'—'");
});
test('Servicio sin certificación muestra guiones y sin período registrado', async()=>{
  expect(HOTFIX).toContain("mainLastCert.textContent='—'");
  expect(HOTFIX).toContain("mainLastCertPeriod.textContent='Sin período registrado'");
});
test('Vencimiento y días restantes quedan en una única tarjeta superior', async()=>{
  const kpis=between('<div class="oc-kpis">','<div class="expediente-grid">',ACTIVE.indexOf('<div class="oc-kpis">'));
  expect(kpis).toContain('<span>Vencimiento</span>');
  expect(kpis).toContain('días restantes');
  expect(kpis).not.toContain('<span>Días restantes</span>');
});
test('Control de Terceros sigue siendo inyectado por injectCT', async()=>{
  expect(SOURCE).toContain('function injectCT');
  expect(SOURCE).toContain('renderCTCard');
});
