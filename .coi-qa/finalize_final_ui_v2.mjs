import fs from 'node:fs';

const indexPath='index.html';
const testPath='tests/obra_resumen_supabase.spec.js';
let html=fs.readFileSync(indexPath,'utf8');
let test=fs.readFileSync(testPath,'utf8');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();

function replaceOnce(oldText,newText,label,required=true){
  if(!html.includes(oldText)){
    if(required) throw new Error(`No se encontró: ${label}`);
    console.log(`SKIP ${label}`);return false;
  }
  html=html.replace(oldText,newText);console.log(`OK ${label}`);return true;
}

// CONTRACTUAL: eliminar la fila de repositorio documental, sin sustituirla por otra fuente visual.
const repoRows=[
  '          <div><b>Repositorio documental</b><span data-coi-repo-supabase>Supabase Storage</span></div>\n',
  '          <div><b>Repositorio documental</b>${coiURLHTTPValida(item.linkOneDrive)?\'<a href="\'+esc(item.linkOneDrive)+\'" target="_blank" rel="noopener noreferrer">Abrir OneDrive</a>\':\'—\'}</div>\n'
];
let repoRemoved=0;
for(const row of repoRows){if(html.includes(row)){html=html.replace(row,'');repoRemoved++;}}
console.log(`Filas contractuales de repositorio eliminadas: ${repoRemoved}`);

// BOTONES LEGACY: eliminar nodos button reales por texto, no ocultarlos con CSS.
let removedAdd=0,removedPyC=0;
html=html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,btn=>{
  const text=norm(btn.replace(/<[^>]+>/g,' '));
  if(text.includes('AGREGAR LINK DOCUMENTAL')){removedAdd++;return '';}
  if(text.includes('MARCAR ENVIADO A PYC')){removedPyC++;return '';}
  return btn;
});
console.log(`Botones eliminados: Agregar link documental=${removedAdd}; Marcar enviado a PyC=${removedPyC}`);

// Neutralizar renderers tardíos: si vuelven a insertar esos controles/fila, se remueven físicamente del DOM.
const repoStart='  function patchRepositorioBase(){';
const repoEnd='  async function waitSupabaseReady(){';
const a=html.indexOf(repoStart),b=html.indexOf(repoEnd,a);
if(a<0||b<0) throw new Error('No se encontró patchRepositorioBase');
html=html.slice(0,a)+`  function cleanupLegacyFichaControls(){
    const body=document.getElementById('fichaOCBody');if(!body)return;
    [...body.querySelectorAll('button')].forEach(btn=>{
      const text=norm(btn.textContent);
      if(text.includes('MARCAR ENVIADO A PYC')||text.includes('AGREGAR LINK DOCUMENTAL'))btn.remove();
    });
    [...body.querySelectorAll('.grid > div')].forEach(div=>{
      if(norm(div.querySelector('b')?.textContent)==='REPOSITORIO DOCUMENTAL')div.remove();
    });
  }
  function patchRepositorioBase(){cleanupLegacyFichaControls();return null;}

`+html.slice(b);

// RESUMEN DE OBRA: ID OBRA + Vencimiento reemplazando Sector + última certificación + avance real.
const marker=`    card.dataset.coiObraResumenSource='supabase';\n    let sector=fieldByLabel(grid,'Sector');`;
replaceOnce(marker,`    card.dataset.coiObraResumenSource='supabase';
    const idObra=fieldByLabel(grid,'ID_OBRA')||fieldByLabel(grid,'ID OBRA');
    if(idObra?.querySelector('b'))idObra.querySelector('b').textContent='ID OBRA';
    let sector=fieldByLabel(grid,'Sector');`,'normalizar ID OBRA');

// Avance: sólo mostrar porcentaje si la última certificación ofrece un valor coherente; no promediar posiciones sin ponderación.
replaceOnce("    let avanceText='—',avanceTitle='';","    let avanceText='Sin dato',avanceTitle='';",'fallback avance');
const oldMixed="      if(unique.length===1)avanceText=fmtPct(values[0]);\n      else{avanceText=`Prom. ${fmtPct(avg)}`;avanceTitle=`Promedio simple de AUX % de ${values.length} posiciones de la última acta registrada en Supabase.`;}\n";
replaceOnce(oldMixed,"      if(unique.length===1)avanceText=fmtPct(values[0]);\n      else{avanceText='Sin dato';avanceTitle='La última certificación contiene porcentajes distintos por posición; no se calcula promedio sin ponderación contractual.';}\n",'evitar promedio no ponderado');
html=html.replace("else{ui.ultima.textContent='Sin certificaciones en Supabase';ui.avance.textContent='—';ui.avance.title='';}","else{ui.ultima.textContent='Sin certificación';ui.avance.textContent='Sin dato';ui.avance.title='';}");
html=html.replace("if(ui){ui.ultima.textContent='Supabase no disponible';ui.avance.textContent='—';}","if(ui){ui.ultima.textContent='Supabase no disponible';ui.avance.textContent='Sin dato';}");
html=html.replace("ui.avance.textContent='—';}}","ui.avance.textContent='Sin dato';}}");

// Ejecutar limpieza en cada ficha y observar reinserciones tardías.
const enhanceOld=`  function enhance(reference){\n    const seq=++renderSeq;`;
replaceOnce(enhanceOld,`  function enhance(reference){
    cleanupLegacyFichaControls();
    const seq=++renderSeq;`,'limpieza al renderizar');
const installOld=`  installAlertStyles();\n  const previous=window.renderFichaOC;`;
replaceOnce(installOld,`  installAlertStyles();
  cleanupLegacyFichaControls();
  const fichaBody=document.getElementById('fichaOCBody');
  if(fichaBody){
    let cleanupQueued=false;
    new MutationObserver(()=>{
      if(cleanupQueued)return;cleanupQueued=true;
      requestAnimationFrame(()=>{cleanupQueued=false;cleanupLegacyFichaControls();});
    }).observe(fichaBody,{childList:true,subtree:true});
  }
  const previous=window.renderFichaOC;`,'observador anti-legacy');

// CENTRO DE ALERTAS: diez columnas reales; identificadores, fecha y días no se quiebran; mobile usa scroll horizontal.
html=html.replace("      #vistaCentroAlertas th:nth-child(11),#vistaCentroAlertas td:nth-child(11){min-width:155px;white-space:nowrap}\n",'');
html=html.replace("#vistaCentroAlertas th:nth-child(3),#vistaCentroAlertas td:nth-child(3){min-width:145px}","#vistaCentroAlertas th:nth-child(3),#vistaCentroAlertas td:nth-child(3){min-width:155px;white-space:normal;word-break:normal;overflow-wrap:normal}");
html=html.replace("#vistaCentroAlertas th:nth-child(6),#vistaCentroAlertas td:nth-child(6){min-width:105px;white-space:nowrap}","#vistaCentroAlertas th:nth-child(6),#vistaCentroAlertas td:nth-child(6){min-width:115px;white-space:nowrap;word-break:keep-all}");
html=html.replace("#vistaCentroAlertas th:nth-child(7),#vistaCentroAlertas td:nth-child(7){min-width:70px;white-space:nowrap;text-align:center}","#vistaCentroAlertas th:nth-child(7),#vistaCentroAlertas td:nth-child(7){min-width:72px;white-space:nowrap;word-break:keep-all;text-align:center}");

// QA: usar el hook productivo ya expuesto, sin reinyectar una copia del script.
const qaFirst="    if (window.__COI_OBRA_QA__?.decorateForQA) return { ok:true, reused:true };";
if(test.includes(qaFirst)) test=test.replace(qaFirst,`    if (window.COI_OBRA_RESUMEN_SUPABASE_V1?.decorateForQA) {
      window.__COI_OBRA_QA__ = window.COI_OBRA_RESUMEN_SUPABASE_V1;
      return { ok:true, reused:true };
    }
    if (window.__COI_OBRA_QA__?.decorateForQA) return { ok:true, reused:true };`);
test=test.replace("  await expect(card).toBeVisible();","  await expect(card).toHaveCount(1);");
test=test.replace("    'id_obra','n° oc','tipo','tipo de trabajo','estación','vencimiento',","    'id obra','n° oc','tipo','tipo de trabajo','estación','vencimiento',");

const startTest="test('Repositorio contractual usa Supabase Storage y no ofrece OneDrive'";
const nextTest="test('Servicios conservan Sector y no reciben campos exclusivos de Obra'";
const ts=test.indexOf(startTest),te=test.indexOf(nextTest,ts);
if(ts<0||te<0) throw new Error('No se encontró bloque QA contractual');
const contractualTest=`test('Contractual elimina repositorio OneDrive y controles documentales/PyC legacy', async ({ page }) => {
  await openIsolated(page);
  const result = await decorateFixture(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  await page.evaluate(() => {
    const contractual=document.getElementById('qaContractual');
    contractual.insertAdjacentHTML('beforeend','<button>Marcar enviado a PyC</button><button>Agregar link documental</button>');
  });
  await page.waitForTimeout(100);
  await expect(page.locator('#qaContractual')).not.toContainText(/OneDrive/i);
  await expect(page.locator('#qaContractual')).not.toContainText(/Repositorio documental/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Marcar enviado a PyC/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Agregar link documental/i);
});

`;
test=test.slice(0,ts)+contractualTest+test.slice(te);
const alertTail="  expect(rules).toContain('white-space:nowrap');\n  expect(rules).toContain('min-width:1500px');\n});";
if(test.includes(alertTail)) test=test.replace(alertTail,"  expect(rules).toContain('white-space:nowrap');\n  expect(rules).toContain('min-width:1500px');\n  expect(rules).toContain('overflow-x:auto');\n  expect(rules).not.toContain('break-all');\n  expect(rules).toContain('word-break:keep-all');\n});");

// Guardas de aceptación.
const buttonTexts=[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(m=>norm(m[1].replace(/<[^>]+>/g,' ')));
if(buttonTexts.some(t=>t.includes('AGREGAR LINK DOCUMENTAL')))throw new Error('Sigue renderizándose Agregar link documental');
if(buttonTexts.some(t=>t.includes('MARCAR ENVIADO A PYC')))throw new Error('Sigue renderizándose Marcar enviado a PyC');
if(html.includes('<b>Repositorio documental</b><span data-coi-repo-supabase>'))throw new Error('Sigue la fila Repositorio documental');
for(const required of ["b.textContent='Vencimiento'","ensureField(grid,'Última certificación'","ensureField(grid,'% de avance'","overflow-x:auto","word-break:keep-all"]){if(!html.includes(required))throw new Error(`Falta requisito: ${required}`);}

fs.writeFileSync(indexPath,html);
fs.writeFileSync(testPath,test);
console.log('FINAL UI V2 OK');
