import fs from 'node:fs';

const indexPath='index.html';
let html=fs.readFileSync(indexPath,'utf8');

html=html.replace(/Cargar\s+carpeta\s+OneDrive\s+desde\s+Ficha\s+OC/gi,'Revisar documentación registrada en Supabase');
html=html.replace(/Marcar\s+carpeta\s+OneDrive\s+como\s+principal/gi,'Revisar vínculo documental principal');
html=html.replace(/Carpetas\s+OneDrive\s+y\s+documentos\s+vinculados\s+a\s+la\s+OC/gi,'Vínculos documentales registrados en Supabase para la OC');
html=html.replace(/Abrir\s+OneDrive/gi,'Abrir vínculo');

html=html.replace(/<button\b[^>]*data-exec-link-add[^>]*>\s*Agregar\s+link\s+documental\s*<\/button>/gi,'');
html=html.replace(/<button\b[^>]*id="execBtnPyc"[^>]*>\s*Marcar\s+enviad[ao]\s+a\s+PyC\s*<\/button>/gi,'');
html=html.replace(/<button\b[^>]*>\s*Marcar\s+enviado\s+a\s+PyC\s*<\/button>/gi,'');
html=html.replace(/<button\b[^>]*>\s*Agregar\s+link\s+documental\s*<\/button>/gi,'');

if(!html.includes('id="coi-ficha-obra-final-v1"')) throw new Error('Falta hotfix final de Ficha Obras');
if(/Abrir\s+OneDrive/i.test(html)) throw new Error('Quedó texto Abrir OneDrive en index.html');
if(/>\s*Agregar\s+link\s+documental\s*</i.test(html)) throw new Error('Quedó botón Agregar link documental');
if(/>\s*Marcar\s+enviad[oa]\s+a\s+PyC\s*</i.test(html)) throw new Error('Quedó botón Marcar enviado a PyC');

fs.writeFileSync(indexPath,html,'utf8');

const test=`const { test, expect } = require('@playwright/test');

async function openIsolated(page){
  await page.route(/^https?:\\/(?!\\/127\\.0\\.0\\.1)/, route=>route.abort());
  await page.addInitScript(()=>{localStorage.clear();sessionStorage.clear();});
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.COI_FICHA_OBRA_FINAL_V1));
}

test('Obra: resumen ejecutivo muestra vencimiento, avance y última certificación sin tocar Finanzas', async ({page})=>{
  await openIsolated(page);
  const r=await page.evaluate(async()=>{
    const body=document.getElementById('fichaOCBody');body.style.display='block';body.hidden=false;
    body.innerHTML='<section class="expediente-card"><h3>1. Resumen General</h3><div class="grid"><div><b>ID_OBRA</b><span>OC-QA</span></div><div><b>N° OC</b><span>4530099001</span></div><div><b>Tipo</b><span>Obra</span></div><div><b>Tipo de trabajo</b><span>Obras Civiles</span></div><div><b>Estación</b><span>Plaza Constitución</span></div><div><b>Sector</b><span>Andén</span></div><div><b>Proveedor</b><span>QA</span></div><div><b>Estado COI</b><span>En ejecución</span></div><div><b>Estado documental</b><span>Pendiente</span></div><div><b>Semáforo</b><span>En plazo</span></div></div></section><section id="finQA"><h3>4. ESTADO FINANCIERO</h3><span>FINANZAS-SIN-CAMBIOS</span></section><section><div class="grid"><div><b>Repositorio documental</b><a>Abrir OneDrive</a></div></div></section><button>Agregar link documental</button><button>Marcar enviado a PyC</button>';
    window.cargarCertificacionesPorOC=async()=>[{acta_medicion_nro:'7',fecha_fin:'2026-07-31',aux_porcentaje:62.5}];
    const before=document.getElementById('finQA').innerHTML;
    const out=await window.COI_FICHA_OBRA_FINAL_V1.enhanceFicha('OC-QA',{tipo:'Obra',vencimiento:'2026-12-31'});
    const labels=[...body.querySelectorAll('.grid > div > b')].map(x=>x.textContent.trim());
    return {obra:out.obra,labels,vto:body.querySelector('[data-coi-obra-vencimiento]')?.textContent,cert:body.querySelector('[data-coi-obra-ultima-certificacion]')?.textContent,avance:body.querySelector('[data-coi-obra-avance]')?.textContent,financial:before===document.getElementById('finQA').innerHTML,text:body.textContent};
  });
  expect(r.obra).toBe(true);expect(r.labels).not.toContain('Sector');expect(r.labels).toContain('Vencimiento');expect(r.labels).toContain('Última certificación');expect(r.labels).toContain('% de avance');expect(r.vto).not.toBe('Sin dato');expect(r.cert).toContain('Acta N° 7');expect(r.avance).toBe('62,5%');expect(r.financial).toBe(true);expect(r.text).not.toMatch(/OneDrive|Agregar link documental|Marcar enviado a PyC/i);
});

test('Centro de Alertas conserva palabras y usa scroll horizontal', async ({page})=>{
  await openIsolated(page);
  const r=await page.evaluate(()=>{const host=document.createElement('div');host.innerHTML='<div id="w"><table><thead><tr><th>OC</th><th>TIPO ALERTA</th><th>ESTACIÓN</th><th>PROVEEDOR</th><th>DESCRIPCIÓN</th><th>FECHA</th><th>DÍAS</th><th>MENSAJE</th><th>ACCIÓN SUGERIDA</th><th>ACCIONES</th></tr></thead><tbody><tr><td>4520003305</td><td>OC vencida</td><td>PLAZA CONSTITUCIÓN</td><td>FEMYP</td><td>Detalle</td><td>2025-02-21</td><td>-543</td><td>Mensaje</td><td>Acción</td><td>Ver</td></tr></tbody></table></div>';document.body.appendChild(host);window.COI_FICHA_OBRA_FINAL_V1.fixAlertas(host);return {table:host.querySelector('table').className,wrap:host.querySelector('#w').className,css:document.getElementById('coi-centro-alertas-legibilidad-v1').textContent};});
  expect(r.table).toContain('coi-alertas-table-fixed');expect(r.wrap).toContain('coi-alertas-scroll-fixed');expect(r.css).toContain('min-width:1450px');expect(r.css).toContain('white-space:nowrap');expect(r.css).not.toContain('break-all');
});

test('Fuente final no expone botones legacy ni Abrir OneDrive', async ({page})=>{
  await openIsolated(page);
  const source=await page.locator('html').evaluate(()=>document.documentElement.outerHTML);
  expect(source).not.toMatch(/>\\s*Agregar\\s+link\\s+documental\\s*</i);expect(source).not.toMatch(/>\\s*Marcar\\s+enviad[oa]\\s+a\\s+PyC\\s*</i);expect(source).not.toMatch(/Abrir\\s+OneDrive/i);expect(source).toContain('4. ESTADO FINANCIERO');
});
`;
fs.writeFileSync('tests/final_ui_obras_alertas.spec.js',test,'utf8');

for(const path of ['.coi-qa/diagnose_final_ui.mjs','.github/workflows/diagnose-final-ui.yml','.coi-qa/finalize-pr33.mjs','.github/workflows/finalize-pr33.yml']){
  try{fs.unlinkSync(path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
console.log('PR33 finalizado: cambios productivos + QA; temporales eliminados');
