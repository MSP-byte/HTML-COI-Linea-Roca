import fs from 'node:fs';

const INDEX='index.html';
let html=fs.readFileSync(INDEX,'utf8');

if(!html.includes('id="coi-ficha-obra-final-v1"')){
  const beforeLines=html.split(/\r?\n/);
  const afterLines=beforeLines.filter(line=>!(line.includes('<div><b>Repositorio documental</b>')&&line.includes('item.linkOneDrive')));
  const removedRepo=beforeLines.length-afterLines.length;
  html=afterLines.join('\n');

  html=html.replaceAll('<button type="button" class="primary" data-exec-link-add>Agregar link documental</button>','');
  html=html.replace(/<button\b[^>]*>\s*Marcar enviado a PyC\s*<\/button>/gi,'');
  html=html.replace(/<button\b[^>]*>\s*Marcar enviado a PYC\s*<\/button>/gi,'');
  html=html.replaceAll('Carpetas OneDrive y documentos vinculados a la OC','Vínculos documentales registrados en Supabase para la OC');
  html=html.replaceAll('Abrir OneDrive','Abrir vínculo');

  const finalScript=(function(){/*
<script id="coi-ficha-obra-final-v1">
(function(){
  'use strict';
  if(window.__COI_FICHA_OBRA_FINAL_V1__)return;
  window.__COI_FICHA_OBRA_FINAL_V1__=true;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const finitePct=v=>{
    if(v===null||v===undefined||v==='')return null;
    const n=Number(String(v).trim().replace('%','').replace(',','.'));
    return Number.isFinite(n)&&n>=0&&n<=100?n:null;
  };
  const fmtPct=n=>new Intl.NumberFormat('es-AR',{minimumFractionDigits:0,maximumFractionDigits:1}).format(n)+'%';
  const fmtDate=v=>{
    if(!v)return 'Sin dato';
    try{if(typeof window.fmtFecha==='function'){const x=window.fmtFecha(v);if(x)return x;}}catch(_e){}
    const s=clean(v).slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?m[3]+'/'+m[2]+'/'+m[1]:(s||'Sin dato');
  };

  function resolveItem(reference){
    try{const x=typeof window.obtenerOC==='function'?window.obtenerOC(reference):null;if(x?.item)return x.item;if(x&&typeof x==='object')return x;}catch(_e){}
    try{
      const target=norm(reference),rows=typeof window.todasLasOC==='function'?window.todasLasOC():[];
      const row=rows.find(r=>{const x=r?.item||r||{};return [x.numeroOC,x.nro_oc,x.oc,x.idObra,x.idOC,x.id_obra,x.id_servicio].some(v=>norm(v)===target);});
      return row?.item||row||null;
    }catch(_e){}
    return null;
  }

  function summaryCard(body){
    return [...body.querySelectorAll('section,.expediente-card,.ficha-oc-panel')].find(el=>norm(el.querySelector('h3')?.textContent).includes('1. RESUMEN GENERAL'))||null;
  }
  function fieldNodes(card){
    const grid=card?.querySelector('.grid,.resumen-grid,.ficha-resumen-grid');
    return grid?{grid,nodes:[...grid.children].filter(el=>el.querySelector('b'))}:{grid:null,nodes:[]};
  }
  function fieldByLabel(card,label){return fieldNodes(card).nodes.find(el=>norm(el.querySelector('b')?.textContent)===norm(label))||null;}
  function setField(div,label,value,attr){
    if(!div)return null;
    div.replaceChildren();
    const b=document.createElement('b');b.textContent=label;div.appendChild(b);
    const span=document.createElement('span');span.textContent=value;if(attr)span.setAttribute(attr,'');div.appendChild(span);
    return span;
  }
  function ensureField(card,label,attr){
    let div=fieldByLabel(card,label);const {grid}=fieldNodes(card);if(!grid)return null;
    if(!div){div=document.createElement('div');grid.appendChild(div);}
    return setField(div,label,'Sin dato',attr);
  }
  function getVencimiento(item){return item?._supabaseRaw?.fecha_vencimiento||item?.fechaVencimiento||item?.fecha_vencimiento||item?.vencimiento||item?.fechaFin||item?.fecha_fin||'';}
  function isObra(item,card){return norm(item?.tipo||item?.TIPO)==='OBRA'||norm(fieldByLabel(card,'Tipo')?.textContent).includes('OBRA');}

  function cleanupLegacyFicha(body){
    if(!body)return;
    for(const div of [...body.querySelectorAll('.grid > div,.resumen-grid > div,.ficha-resumen-grid > div')]){
      if(norm(div.querySelector('b')?.textContent)==='REPOSITORIO DOCUMENTAL')div.remove();
    }
    for(const btn of [...body.querySelectorAll('button')]){
      const t=norm(btn.textContent);if(t==='MARCAR ENVIADO A PYC'||t==='AGREGAR LINK DOCUMENTAL')btn.remove();
    }
    for(const a of [...body.querySelectorAll('a')])if(norm(a.textContent)==='ABRIR ONEDRIVE')a.textContent='Abrir vínculo';
  }

  function explicitProgress(item){
    const candidates=[item?._supabaseRaw?.porcentaje_avance,item?._supabaseRaw?.avance_porcentaje,item?._supabaseRaw?.porcentaje_ejecucion,item?.porcentajeAvance,item?.porcentaje_avance,item?.avancePorcentaje,item?.porcentajeEjecucion,item?.porcentaje_ejecucion,item?.avanceParcial,item?.avance_parcial];
    for(const v of candidates){const n=finitePct(v);if(n!==null)return n;}return null;
  }
  function latestCertification(rows){
    const live=(Array.isArray(rows)?rows:[]).filter(r=>r&&!r._legacy);
    if(!live.length)return {label:'Sin certificación',progress:null};
    const dateOf=r=>clean(r.fecha_fin||r.periodo_fin||r.fecha_certificacion||r.fecha_inicio||r.periodo_inicio||r.fecha);
    live.sort((a,b)=>dateOf(b).localeCompare(dateOf(a))||(Number(b.acta_medicion_nro)||0)-(Number(a.acta_medicion_nro)||0));
    const last=live[0],acta=clean(last.acta_medicion_nro||last.acta_nro||last.numero_acta),fecha=dateOf(last);
    const group=live.filter(r=>acta?clean(r.acta_medicion_nro||r.acta_nro||r.numero_acta)===acta:dateOf(r)===fecha);
    const vals=group.map(r=>finitePct(r.aux_porcentaje??r.porcentaje_avance??r.avance_porcentaje)).filter(v=>v!==null);
    const progress=vals.length&&vals.every(v=>Math.abs(v-vals[0])<0.000001)?vals[0]:null;
    return {label:(acta?'Acta N° '+acta:'Certificación')+(fecha?' · '+fmtDate(fecha):''),progress};
  }

  function decorateObra(item,card){
    if(!card||!isObra(item,card))return null;
    card.dataset.coiObraResumenFinal='true';
    let venc=fieldByLabel(card,'Vencimiento');const sector=fieldByLabel(card,'Sector');
    if(!venc&&sector)venc=sector;if(sector&&venc!==sector)sector.remove();
    const vencSpan=venc?setField(venc,'Vencimiento',fmtDate(getVencimiento(item)),'data-coi-obra-vencimiento'):ensureField(card,'Vencimiento','data-coi-obra-vencimiento');
    if(vencSpan)vencSpan.textContent=fmtDate(getVencimiento(item));
    const cert=ensureField(card,'Última certificación','data-coi-obra-ultima-certificacion');if(cert)cert.textContent='Sin certificación';
    const avance=ensureField(card,'% de avance','data-coi-obra-avance');
    if(avance){const p=explicitProgress(item);avance.textContent=p===null?'Sin dato':fmtPct(p);avance.dataset.explicitProgress=p===null?'false':'true';}
    return {cert,avance};
  }
  async function enrichObra(reference,item,ui){
    if(!ui||typeof window.cargarCertificacionesPorOC!=='function')return;
    try{
      const latest=latestCertification(await window.cargarCertificacionesPorOC(item||reference));
      if(ui.cert)ui.cert.textContent=latest.label;
      if(ui.avance&&ui.avance.dataset.explicitProgress!=='true')ui.avance.textContent=latest.progress===null?'Sin dato':fmtPct(latest.progress);
    }catch(_e){if(ui.cert)ui.cert.textContent='Sin certificación';if(ui.avance&&ui.avance.dataset.explicitProgress!=='true')ui.avance.textContent='Sin dato';}
  }
  async function enhanceFicha(reference,itemOverride){
    const body=document.getElementById('fichaOCBody');if(!body)return {obra:false};
    cleanupLegacyFicha(body);const card=summaryCard(body),item=itemOverride||resolveItem(reference),ui=decorateObra(item,card);
    if(ui)await enrichObra(reference,item,ui);cleanupLegacyFicha(body);return {obra:Boolean(ui)};
  }

  function fixAlertas(root=document){
    for(const table of [...root.querySelectorAll('table')]){
      const h=norm(table.querySelector('thead')?.textContent);
      if(!(h.includes('TIPO ALERTA')&&h.includes('ACCION SUGERIDA')&&h.includes('DIAS')))continue;
      table.classList.add('coi-alertas-table-fixed');if(table.parentElement)table.parentElement.classList.add('coi-alertas-scroll-fixed');
    }
  }
  const style=document.createElement('style');
  style.id='coi-centro-alertas-legibilidad-v1';
  style.textContent='.coi-alertas-scroll-fixed{overflow-x:auto!important;max-width:100%!important;-webkit-overflow-scrolling:touch}' +
    'table.coi-alertas-table-fixed{min-width:1450px!important;table-layout:auto!important;width:100%}' +
    'table.coi-alertas-table-fixed th,table.coi-alertas-table-fixed td{vertical-align:top!important;word-break:normal!important;overflow-wrap:normal!important;hyphens:none!important}' +
    'table.coi-alertas-table-fixed th:nth-child(1),table.coi-alertas-table-fixed td:nth-child(1){min-width:105px!important;white-space:nowrap!important}' +
    'table.coi-alertas-table-fixed th:nth-child(2),table.coi-alertas-table-fixed td:nth-child(2){min-width:120px!important}' +
    'table.coi-alertas-table-fixed th:nth-child(3),table.coi-alertas-table-fixed td:nth-child(3){min-width:140px!important;word-break:keep-all!important}' +
    'table.coi-alertas-table-fixed th:nth-child(4),table.coi-alertas-table-fixed td:nth-child(4){min-width:135px!important}' +
    'table.coi-alertas-table-fixed th:nth-child(5),table.coi-alertas-table-fixed td:nth-child(5){min-width:320px!important}' +
    'table.coi-alertas-table-fixed th:nth-child(6),table.coi-alertas-table-fixed td:nth-child(6){min-width:105px!important;white-space:nowrap!important}' +
    'table.coi-alertas-table-fixed th:nth-child(7),table.coi-alertas-table-fixed td:nth-child(7){min-width:65px!important;white-space:nowrap!important;text-align:center}' +
    'table.coi-alertas-table-fixed th:nth-child(8),table.coi-alertas-table-fixed td:nth-child(8){min-width:170px!important}' +
    'table.coi-alertas-table-fixed th:nth-child(9),table.coi-alertas-table-fixed td:nth-child(9){min-width:220px!important}' +
    'table.coi-alertas-table-fixed th:nth-child(10),table.coi-alertas-table-fixed td:nth-child(10){min-width:190px!important}' +
    'table.coi-alertas-table-fixed td:nth-child(10) button{white-space:nowrap}';
  document.head.appendChild(style);

  let timer=0;const scheduleAlertFix=()=>{clearTimeout(timer);timer=setTimeout(()=>fixAlertas(document),30);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleAlertFix,{once:true});else scheduleAlertFix();
  new MutationObserver(scheduleAlertFix).observe(document.documentElement,{childList:true,subtree:true});

  const previous=window.renderFichaOC;
  if(typeof previous==='function')window.renderFichaOC=function(reference){const result=previous.apply(this,arguments);setTimeout(()=>enhanceFicha(reference),0);return result;};
  window.COI_FICHA_OBRA_FINAL_V1=Object.freeze({enhanceFicha,latestCertification,fixAlertas,cleanupLegacyFicha});
})();
</script>
*/}).toString().match(/\/\*([\s\S]*?)\*\//)[1];

  const close='</body></html>';
  if(!html.includes(close))throw new Error('No se encontró cierre </body></html> en index.html');
  html=html.replace(close,finalScript+'\n'+close);
  fs.writeFileSync(INDEX,html,'utf8');
  console.log(JSON.stringify({removedRepo,marker:true,bytes:html.length}));
}else console.log('El parche final UI ya estaba instalado.');

for(const path of ['.coi-qa/inspect-final-ui.sh','.github/workflows/coi-final-ui-diagnose.yml','.coi-qa/apply-final-ui-v1.mjs','.github/workflows/coi-final-ui-apply.yml']){
  try{fs.unlinkSync(path);console.log('eliminado temporal',path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
