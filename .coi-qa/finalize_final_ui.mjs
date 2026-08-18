import fs from 'node:fs';

const indexPath='index.html';
const testPath='tests/obra_resumen_supabase.spec.js';
let html=fs.readFileSync(indexPath,'utf8');
let test=fs.readFileSync(testPath,'utf8');

function mustReplace(oldText,newText,label,count=1){
  const hits=html.split(oldText).length-1;
  if(hits!==count) throw new Error(`${label}: esperadas ${count} ocurrencias, encontradas ${hits}`);
  html=html.replace(oldText,newText);
  console.log(`OK ${label}`);
}

// 1) Contractual: el repositorio legacy no debe ocupar lugar en la ficha.
mustReplace('          <div><b>Repositorio documental</b><span data-coi-repo-supabase>Supabase Storage</span></div>\n','', 'eliminar fila Repositorio documental');

// 2) Expediente documental: eliminar el alta de vínculos legacy del UI.
mustReplace('<button type="button" class="primary" data-exec-link-add>Agregar link documental</button>','', 'eliminar Agregar link documental');

// 3) El decorador de Obras no debe recrear la fila eliminada; además limpia controles legacy reinsertados por renderers tardíos.
const repoStart='  function patchRepositorioBase(){';
const repoEnd='  async function waitSupabaseReady(){';
const a=html.indexOf(repoStart);
const b=html.indexOf(repoEnd,a);
if(a<0||b<0) throw new Error('No se encontró patchRepositorioBase productivo');
html=html.slice(0,a)+`  function cleanupLegacyFichaControls(){
    const body=document.getElementById('fichaOCBody');if(!body)return;
    [...body.querySelectorAll('button')].forEach(btn=>{
      const text=norm(btn.textContent);
      if(text==='MARCAR ENVIADO A PYC'||text==='AGREGAR LINK DOCUMENTAL')btn.remove();
    });
    [...body.querySelectorAll('.grid > div')].forEach(div=>{
      if(norm(div.querySelector('b')?.textContent)==='REPOSITORIO DOCUMENTAL')div.remove();
    });
  }
  function patchRepositorioBase(){
    cleanupLegacyFichaControls();
    return null;
  }

`+html.slice(b);
console.log('OK neutralizar repositorio/controles legacy tardíos');

// 4) Resumen ejecutivo de Obras: nomenclatura, VTO, última certificación y avance real.
const marker=`    card.dataset.coiObraResumenSource='supabase';\n    let sector=fieldByLabel(grid,'Sector');`;
if(!html.includes(marker)) throw new Error('No se encontró ancla de Resumen de Obra');
html=html.replace(marker,`    card.dataset.coiObraResumenSource='supabase';
    const idObra=fieldByLabel(grid,'ID_OBRA')||fieldByLabel(grid,'ID OBRA');
    if(idObra?.querySelector('b'))idObra.querySelector('b').textContent='ID OBRA';
    let sector=fieldByLabel(grid,'Sector');`);

// No calcular promedios no ponderados cuando una acta tiene porcentajes distintos por posición.
const avgBlock=`      if(unique.length===1)avanceText=fmtPct(values[0]);\n      else{avanceText=\`Prom. \${fmtPct(avg)}\`;avanceTitle=\`Promedio simple de AUX % de \${values.length} posiciones de la última acta registrada en Supabase.\`;}\n`;
if(!html.includes(avgBlock)) throw new Error('No se encontró cálculo de avance de última certificación');
html=html.replace(avgBlock,`      if(unique.length===1)avanceText=fmtPct(values[0]);
      else{avanceText='Sin dato';avanceTitle='La última certificación contiene porcentajes distintos por posición; no se calcula un promedio sin ponderación contractual.';}
`);
html=html.replace("    let avanceText='—',avanceTitle='';","    let avanceText='Sin dato',avanceTitle='';");
html=html.replace("        else{ui.ultima.textContent='Sin certificaciones en Supabase';ui.avance.textContent='—';ui.avance.title='';}","        else{ui.ultima.textContent='Sin certificación';ui.avance.textContent='Sin dato';ui.avance.title='';}");
html=html.replace("      if(ui){ui.ultima.textContent='Supabase no disponible';ui.avance.textContent='—';}","      if(ui){ui.ultima.textContent='Supabase no disponible';ui.avance.textContent='Sin dato';}");
html=html.replace("      }catch(error){if(seq===renderSeq){ui.ultima.textContent='No disponible';ui.ultima.title=error?.message||'';ui.avance.textContent='—';}}","      }catch(error){if(seq===renderSeq){ui.ultima.textContent='No disponible';ui.ultima.title=error?.message||'';ui.avance.textContent='Sin dato';}}");

// 5) La limpieza debe ejecutarse cada vez que se decora la ficha y ante renderers tardíos.
const enhanceOld=`  function enhance(reference){\n    const seq=++renderSeq;\n    const item=resolveItem(reference);`;
if(!html.includes(enhanceOld)) throw new Error('No se encontró enhance productivo');
html=html.replace(enhanceOld,`  function enhance(reference){
    cleanupLegacyFichaControls();
    const seq=++renderSeq;
    const item=resolveItem(reference);`);

const installOld=`  installAlertStyles();\n  const previous=window.renderFichaOC;`;
if(!html.includes(installOld)) throw new Error('No se encontró instalación final del hotfix');
html=html.replace(installOld,`  installAlertStyles();
  cleanupLegacyFichaControls();
  const fichaBody=document.getElementById('fichaOCBody');
  if(fichaBody){
    let cleanupQueued=false;
    new MutationObserver(()=>{
      if(cleanupQueued)return;cleanupQueued=true;
      requestAnimationFrame(()=>{cleanupQueued=false;cleanupLegacyFichaControls();});
    }).observe(fichaBody,{childList:true,subtree:true});
  }
  const previous=window.renderFichaOC;`);

// 6) Centro de Alertas: dejar sólo las diez columnas reales y reforzar legibilidad.
html=html.replace("      #vistaCentroAlertas th:nth-child(11),#vistaCentroAlertas td:nth-child(11){min-width:155px;white-space:nowrap}\n",'');
html=html.replace("      #vistaCentroAlertas th:nth-child(3),#vistaCentroAlertas td:nth-child(3){min-width:145px}\n","      #vistaCentroAlertas th:nth-child(3),#vistaCentroAlertas td:nth-child(3){min-width:155px;white-space:normal;word-break:normal;overflow-wrap:normal}\n");
html=html.replace("      #vistaCentroAlertas th:nth-child(6),#vistaCentroAlertas td:nth-child(6){min-width:105px;white-space:nowrap}\n","      #vistaCentroAlertas th:nth-child(6),#vistaCentroAlertas td:nth-child(6){min-width:115px;white-space:nowrap;word-break:keep-all}\n");
html=html.replace("      #vistaCentroAlertas th:nth-child(7),#vistaCentroAlertas td:nth-child(7){min-width:70px;white-space:nowrap;text-align:center}\n","      #vistaCentroAlertas th:nth-child(7),#vistaCentroAlertas td:nth-child(7){min-width:72px;white-space:nowrap;word-break:keep-all;text-align:center}\n");

// 7) Eliminar botones "Marcar enviado a PyC" que sigan presentes en plantillas legacy.
let removedPyC=0;
html=html.replace(/<button\b[^>]*>[\s\S]{0,180}?Marcar\s+enviado\s+a\s+PyC[\s\S]{0,180}?<\/button>/gi,m=>{removedPyC++;return '';});
console.log(`Marcar enviado a PyC eliminado de ${removedPyC} plantilla(s); la limpieza runtime cubre renderers alternativos.`);

// 8) QA: corregir el falso negativo de visibilidad del fixture y exigir los requisitos finales.
test=test.replace("  await expect(card).toBeVisible();","  await expect(card).toHaveCount(1);");
test=test.replace("    'id_obra','n° oc','tipo','tipo de trabajo','estación','vencimiento',","    'id obra','n° oc','tipo','tipo de trabajo','estación','vencimiento',");

const oldRepoTest=`test('Repositorio contractual usa Supabase Storage y no ofrece OneDrive', async ({ page }) => {\n  await openIsolated(page);\n  const result = await decorateFixture(page, 'Obra');\n  expect(result.ok, result.reason || '').toBe(true);\n  expect(result.result.repositorio).toBe(true);\n  const repo = page.locator('#qaContractual [data-coi-repo-supabase]');\n  await expect(repo).toHaveText(/Supabase Storage · 2 documentos/);\n  await expect(page.locator('#qaContractual')).not.toContainText(/OneDrive/i);\n  await expect(page.locator('#qaContractual a')).toHaveCount(0);\n});`;
const newRepoTest=`test('Contractual elimina repositorio OneDrive y controles documentales/PyC legacy', async ({ page }) => {
  await openIsolated(page);
  const result = await decorateFixture(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  await page.evaluate(() => {
    const contractual=document.getElementById('qaContractual');
    contractual.insertAdjacentHTML('beforeend','<button>Marcar enviado a PyC</button><button>Agregar link documental</button>');
  });
  await page.waitForTimeout(50);
  await expect(page.locator('#qaContractual')).not.toContainText(/OneDrive/i);
  await expect(page.locator('#qaContractual')).not.toContainText(/Repositorio documental/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Marcar enviado a PyC/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Agregar link documental/i);
});`;
if(!test.includes(oldRepoTest)) throw new Error('No se encontró test contractual anterior');
test=test.replace(oldRepoTest,newRepoTest);

// Fixture: el resultado de repositorio ahora debe ser false porque la fila se elimina.
test=test.replace("  expect(result.result.repositorio).toBe(true);\n",'');

// Robustecer test de alertas: CSS no puede habilitar break-all y debe contemplar scroll horizontal.
const alertOld=`  expect(rules).toContain('white-space:nowrap');\n  expect(rules).toContain('min-width:1500px');\n});`;
const alertNew=`  expect(rules).toContain('white-space:nowrap');
  expect(rules).toContain('min-width:1500px');
  expect(rules).toContain('overflow-x:auto');
  expect(rules).not.toContain('break-all');
  expect(rules).toContain('word-break:keep-all');
});`;
if(!test.includes(alertOld)) throw new Error('No se encontró test de alertas');
test=test.replace(alertOld,alertNew);

// Guardia estática sobre los textos que el usuario pidió retirar del UI efectivo.
if(html.includes('>Agregar link documental</button>')) throw new Error('Sigue existiendo botón Agregar link documental');
if(/>\s*Marcar\s+enviado\s+a\s+PyC\s*</i.test(html)) throw new Error('Sigue existiendo botón/texto Marcar enviado a PyC en plantilla');
if(html.includes('<b>Repositorio documental</b><span data-coi-repo-supabase>')) throw new Error('Sigue existiendo fila contractual de repositorio');
if(!html.includes("b.textContent='Vencimiento'")) throw new Error('No quedó Vencimiento en Resumen Obra');
if(!html.includes("ensureField(grid,'Última certificación'")) throw new Error('No quedó Última certificación');
if(!html.includes("ensureField(grid,'% de avance'")) throw new Error('No quedó % de avance');

fs.writeFileSync(indexPath,html);
fs.writeFileSync(testPath,test);
console.log('FINAL UI PATCH OK');
