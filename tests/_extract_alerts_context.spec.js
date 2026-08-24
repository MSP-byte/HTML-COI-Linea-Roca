const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lines = source.split(/\r?\n/);
const terms = [
  'Alertas de calidad y documentación',
  'alerta(s) calculadas desde Supabase',
  'cliente Supabase no disponible',
  'Modo solo lectura',
  'renderCentroAlertas',
  'renderAlertas',
  'vistaAlertas',
  'coi-alertas-scroll',
  'consolidateAlertsHeading',
  'toastR15',
  'coiToastV581',
  'supabaseClient',
  'getSupabaseClient'
];

function printContexts(term) {
  const q = term.toLowerCase();
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(q)) hits.push(i);
  }
  console.log(`\n@@ALERTS_TERM ${term} HITS=${hits.length}`);
  for (const i of hits.slice(0, 20)) {
    const a = Math.max(0, i - 22);
    const b = Math.min(lines.length, i + 34);
    console.log(`@@ALERTS_CONTEXT line=${i + 1}`);
    for (let j = a; j < b; j++) console.log(`${j + 1}: ${lines[j]}`);
    console.log('@@ALERTS_END_CONTEXT');
  }
}

test('extract alerts source context', async () => {
  for (const term of terms) printContexts(term);
});
