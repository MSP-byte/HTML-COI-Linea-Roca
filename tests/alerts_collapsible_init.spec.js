const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('Alertas ejecutivas espera la tabla canonica y queda plegada por defecto', async () => {
  const start = SOURCE.indexOf('function renderAlertsExecutive(){');
  const end = SOURCE.indexOf('function renderExecutiveFicha(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = SOURCE.slice(start, end);

  expect(block).toContain("host.querySelector('table.coi-alertas-table')");
  expect(block).toContain('host.__coiExecAlertsWaiter');
  expect(block).toContain("card=document.createElement('details')");
  expect(block).toContain("card.className='exec-alert-card exec-alert-collapsible'");
  expect(block).toContain('card.open=wasOpen');
  expect(block).toContain('Alertas de calidad y documentación');
  expect(block).toContain('desplegar');
  expect(block).toContain('contraer');
  expect(block).not.toContain("document.createElement('section')");
});

test('el hotfix no altera la tabla general ni los scrollbars superiores', async () => {
  expect(SOURCE).toContain('table.coi-alertas-table');
  expect(SOURCE).toContain("installTopHorizontalScrollbar(alerts, 'alertas')");
  expect(SOURCE).toContain('id="coi-final-navigation-top-scrollbars"');
});
