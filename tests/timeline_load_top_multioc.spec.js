const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b){const x=SOURCE.indexOf(a),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}
const RENDER=between('  function renderTimelineCOI(){','  window.renderTimelineCOI=renderTimelineCOI;');
const MULTI=between('  function extractTimelineOCRefs','  function completeEventFromOrder');
const COMPLETE=between('  function completeEventFromOrder','  function parseTimelineBulkText');
const BULK=between('  function parseTimelineBulkText','  function timelineBulkCounts');
const CARD=between('  function eventCard(event,compact){','  function dailyMarkup(events){');
const OC=between('  function ocMarkup(events){','  function formField(');

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

test('VARIAS se individualiza: chips y acciones por cada OC detectada', async () => {
  expect(MULTI).toContain('function timelineEventOCRefs(event)');
  expect(CARD).toContain('const ocRefs=timelineEventOCRefs(event)');
  expect(CARD).toContain('timeline-oc-chips');
  expect(CARD).toContain('timeline-oc-actions');
  expect(CARD).toContain('Abrir OC');
  expect(OC).toContain('timelineEventOCRefs(event)');
  expect(OC).not.toContain("fold(oc)!=='varias'");
});

test('el filtro por OC reconoce eventos con varias OCs asociadas', async () => {
  const MATCHES=between('  function eventMatches(event){','  function filteredEvents(){');
  expect(MATCHES).toContain('timelineEventOCRefs(event)');
});
