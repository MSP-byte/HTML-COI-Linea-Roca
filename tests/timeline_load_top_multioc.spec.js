const { test, expect } = require('@playwright/test');
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
