const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function between(a,b){const x=SOURCE.indexOf(a),y=SOURCE.indexOf(b,x);if(x<0||y<0)throw new Error(`Bloque no encontrado: ${a}`);return SOURCE.slice(x,y);}

test('Timeline conserva solo vista diaria y por OC', async () => {
  expect(SOURCE).toContain('data-timeline-view="diaria"');
  expect(SOURCE).toContain('data-timeline-view="oc"');
  expect(SOURCE).not.toContain('data-timeline-view="semanal"');
  expect(SOURCE).not.toContain('function weeklyMarkup(events)');
});

test('los mails no muestran ponderación visual de riesgo', async () => {
  const card=between('  function eventCard(event,compact){','  function dailyMarkup(events){');
  const oc=between('  function ocMarkup(events){','  function formField(');
  expect(card).toContain("const mailEvent=isMailEvent(event)");
  expect(card).toContain("const riskBadge=mailEvent?'':");
  expect(card).toContain("const cardRiskClass=mailEvent?'':riskClass(event.riesgo)");
  expect(oc).not.toContain('Riesgo m\\u00e1ximo');
  expect(oc).not.toContain('Riesgo máximo');
});

test('mail de Control de Terceros ofrece actualización de fecha', async () => {
  const card=between('  function eventCard(event,compact){','  function dailyMarkup(events){');
  expect(SOURCE).toContain('function controlTercerosDateCandidate(event)');
  expect(SOURCE).toContain("source.includes('control de terceros')");
  expect(SOURCE).toContain('event?.fecha_limite');
  expect(card).toContain('data-timeline-ct-update');
  expect(SOURCE).toContain('Actualizar Control de Terceros de la OC');
});

test('actualización CT es Supabase-first y luego refresca cache/UI', async () => {
  const block=between('  async function actualizarControlTercerosDesdeTimeline','  window.coiR28InjectControlTerceros=injectCT;');
  const remote=block.indexOf('await syncCTSupabase(oc,fecha,estado)');
  const cache=block.indexOf('setCT(oc,persistedDate)');
  const local=block.indexOf('guardarLocal()');
  expect(remote).toBeGreaterThan(-1);
  expect(cache).toBeGreaterThan(remote);
  expect(local).toBeGreaterThan(cache);
  expect(SOURCE).toContain('window.coiActualizarControlTercerosDesdeTimeline=actualizarControlTercerosDesdeTimeline');
});
