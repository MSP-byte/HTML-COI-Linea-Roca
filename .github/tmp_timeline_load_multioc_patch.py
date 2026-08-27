from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

def one(old,new,label):
    global s
    count=s.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    s=s.replace(old,new,1)

helper="""  function extractTimelineOCRefs(value){
    const matches=String(value??'').match(/\\b45\\d{8}\\b/g)||[];
    return [...new Set(matches)].sort();
  }
  function normalizeTimelineOCSource(source){
    const input={...(source||{})};
    const refs=extractTimelineOCRefs([input.oc,input.titulo,input.descripcion,input.documentos_mencionados,input.observaciones].filter(Boolean).join(' '));
    if(refs.length===1){input.oc=refs[0];return input;}
    if(refs.length>1){
      input.oc='VARIAS';
      const marker=`OCs mencionadas: ${refs.join(', ')}`;
      const clean=text(input.observaciones).replace(/(?:^|\\n)OCs mencionadas:\\s*[^\\n]*/gi,'').trim();
      input.observaciones=[clean,marker].filter(Boolean).join('\\n');
    }
    return input;
  }
"""
marker='  function completeEventFromOrder(event,validation){\n'
if helper.strip() not in s:
    one(marker,helper+marker,'multi-OC helper insertion')

one("  function completeEventFromOrder(event,validation){\n    const order=event.oc?findOrder(event.oc):null;",
    "  function completeEventFromOrder(event,validation){\n    if(fold(event.oc)==='varias'){event.oc_registrada='NO';validation.push('Varias OC; sin vínculo individual');return;}\n    const order=event.oc?findOrder(event.oc):null;",
    'completeEventFromOrder VARIAS guard')

one("    const orderButton=event.oc?`<button type=\"button\" data-timeline-open-oc=\"${attr(event.oc)}\">Abrir ficha OC</button>`:'';",
    "    const orderButton=event.oc&&fold(event.oc)!=='varias'?`<button type=\"button\" data-timeline-open-oc=\"${attr(event.oc)}\">Abrir ficha OC</button>`:'';",
    'event card OC button')

one("</div>${oc!=='Sin OC individual'?`<button type=\"button\" data-timeline-open-oc=\"${attr(oc)}\">Abrir ficha OC</button>`:''}</div><div class=\"timeline-vertical\">",
    "</div>${oc!=='Sin OC individual'&&fold(oc)!=='varias'?`<button type=\"button\" data-timeline-open-oc=\"${attr(oc)}\">Abrir ficha OC</button>`:''}</div><div class=\"timeline-vertical\">",
    'OC group button')

one("      const event=normalizeEvent({\n        ...rawObject,",
    "      const normalizedSource=normalizeTimelineOCSource(rawObject);\n      const event=normalizeEvent({\n        ...normalizedSource,",
    'bulk normalized source')
one("        titulo:text(rawObject.titulo)||`${tipo_evento}${rawObject.oc?' OC '+rawObject.oc:''}`,",
    "        titulo:text(normalizedSource.titulo)||`${tipo_evento}${normalizedSource.oc?' OC '+normalizedSource.oc:''}`,",
    'bulk normalized title')

one("      ...(existing||{}),...data,id:existing?.id||makeId(),semana:isoWeek(data.fecha),",
    "      ...(existing||{}),...normalizeTimelineOCSource(data),id:existing?.id||makeId(),semana:isoWeek(data.fecha),",
    'manual save multi-OC normalization')

old_render="""      ${persistenceMarkup()}
      ${kpisMarkup(metrics())}
      <nav class=\"timeline-tabs\" aria-label=\"Vistas del Timeline COI\"><button type=\"button\" data-timeline-view=\"diaria\" class=\"${state.view==='diaria'?'active':''}\">Vista diaria</button><button type=\"button\" data-timeline-view=\"oc\" class=\"${state.view==='oc'?'active':''}\">Vista por OC</button></nav>
      ${filtersMarkup()}
      <section id=\"timelineResultsAnchor\" class=\"timeline-results-section\" aria-live=\"polite\">
        <div class=\"timeline-section-head\"><div><h3>${state.view==='diaria'?'Movimientos diarios':'Historial por OC'}</h3><p>${events.length} de ${window.coiTimelineEvents.length} evento(s) visibles</p></div></div>
        <div class=\"timeline-result\">${result}</div>
      </section>
      ${editorMarkup()}
      ${bulkImportMarkup()}
"""
new_render="""      ${persistenceMarkup()}
      ${editorMarkup()}
      ${bulkImportMarkup()}
      ${kpisMarkup(metrics())}
      <nav class=\"timeline-tabs\" aria-label=\"Vistas del Timeline COI\"><button type=\"button\" data-timeline-view=\"diaria\" class=\"${state.view==='diaria'?'active':''}\">Vista diaria</button><button type=\"button\" data-timeline-view=\"oc\" class=\"${state.view==='oc'?'active':''}\">Vista por OC</button></nav>
      ${filtersMarkup()}
      <section id=\"timelineResultsAnchor\" class=\"timeline-results-section\" aria-live=\"polite\">
        <div class=\"timeline-section-head\"><div><h3>${state.view==='diaria'?'Movimientos diarios':'Historial por OC'}</h3><p>${events.length} de ${window.coiTimelineEvents.length} evento(s) visibles</p></div></div>
        <div class=\"timeline-result\">${result}</div>
      </section>
"""
one(old_render,new_render,'move load system above Timeline')

one('Permite cargar mailings diarios/semanales en bloque sin reemplazar el formulario manual.',
    'Permite cargar mailings diarios/semanales en bloque sin reemplazar el formulario manual. Si un mail menciona más de una OC, se guarda como VARIAS y se conserva la lista ordenada en Observaciones.',
    'bulk help text')

p.write_text(s,encoding='utf-8')

Path('tests/timeline_load_top_multioc.spec.js').write_text(r'''const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b){const x=SOURCE.indexOf(a),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}
const RENDER=between('  function renderTimelineCOI(){','  window.renderTimelineCOI=renderTimelineCOI;');
const MULTI=between('  function extractTimelineOCRefs','  function completeEventFromOrder');
const COMPLETE=between('  function completeEventFromOrder','  function parseTimelineBulkText');
const BULK=between('  function parseTimelineBulkText','  function timelineBulkCounts');

test('sistema de carga aparece antes del Timeline visible', async () => {
  const editor=RENDER.indexOf('${editorMarkup()}');
  const bulk=RENDER.indexOf('${bulkImportMarkup()}');
  const kpis=RENDER.indexOf('${kpisMarkup(metrics())}');
  const results=RENDER.indexOf('timelineResultsAnchor');
  expect(editor).toBeGreaterThan(-1);
  expect(bulk).toBeGreaterThan(editor);
  expect(kpis).toBeGreaterThan(bulk);
  expect(results).toBeGreaterThan(kpis);
});

test('múltiples OC se normalizan a VARIAS y se listan ordenadas', async () => {
  expect(MULTI).toContain("input.oc='VARIAS'");
  expect(MULTI).toContain("refs.join(', ')");
  expect(MULTI).toContain('.sort()');
  expect(COMPLETE).toContain("fold(event.oc)==='varias'");
  expect(BULK).toContain('normalizeTimelineOCSource(rawObject)');
});

test('VARIAS no ofrece navegación a una ficha individual', async () => {
  const CARD=between('  function eventCard(event,compact){','  function dailyMarkup(events){');
  const OC=between('  function ocMarkup(events){','  function formField(');
  expect(CARD).toContain("fold(event.oc)!=='varias'");
  expect(OC).toContain("fold(oc)!=='varias'");
});
''',encoding='utf-8')

print('Timeline patch applied')
