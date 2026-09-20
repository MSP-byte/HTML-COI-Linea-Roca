const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b){const x=SOURCE.indexOf(a),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}
const FILTERS=between('  function filtersMarkup(){','  function kpisMarkup(');
const MATCHES=between('  function eventMatches(event){','  function filteredEvents(');
const RENDER=between('  function renderTimelineCOI(){','  window.renderTimelineCOI=renderTimelineCOI;');
const BIND_END=SOURCE.indexOf('  window.normalizeTimelineDate=');
const BIND_START=SOURCE.lastIndexOf('  function bindEvents(){',BIND_END);
if(BIND_START<0||BIND_END<0||BIND_END<=BIND_START)throw new Error('Bloque bindEvents de Timeline COI no encontrado');
const BIND=SOURCE.slice(BIND_START,BIND_END);

test('Timeline conserva solo los siete filtros operativos solicitados', async () => {
  for(const id of ['timelineFilter_fecha_desde','timelineFilter_oc','timelineFilter_proveedor','timelineFilter_rubro','timelineFilter_tipo_evento','timelineFilter_origen','timelineFilter_responsable_accion']) expect(FILTERS).toContain(id);
  for(const id of ['timelineFilter_fecha_hasta','timelineFilter_semana','timelineFilter_estado','timelineFilter_riesgo']) expect(FILTERS).not.toContain(id);
});
test('eventMatches deja de aplicar filtros retirados', async () => {
  for(const token of ['f.fecha_desde','f.oc','f.proveedor','f.rubro','f.tipo_evento','f.origen','f.responsable_accion']) expect(MATCHES).toContain(token);
  for(const token of ['f.fecha_hasta','f.semana','f.estado','f.riesgo']) expect(MATCHES).not.toContain(token);
});
test('carga manual y masiva se renderizan antes de filtros y resultados', async () => {
  const editor=RENDER.indexOf('${editorMarkup()}');
  const bulk=RENDER.indexOf('${bulkImportMarkup()}');
  const filters=RENDER.indexOf('${filtersMarkup()}');
  const results=RENDER.indexOf('timelineResultsAnchor');
  expect(editor).toBeGreaterThan(-1);
  expect(bulk).toBeGreaterThan(editor);
  expect(filters).toBeGreaterThan(bulk);
  expect(results).toBeGreaterThan(filters);
});
test('botones de vistas y Aplicar filtros rerenderizan y enfocan resultados', async () => {
  expect(BIND).toContain("target.closest('[data-timeline-view]')");
  expect(BIND).toContain("target.closest('#btnTimelineAplicarFiltros')");
  expect(BIND.match(/timelineResultsAnchor/g)?.length||0).toBeGreaterThanOrEqual(2);
});
