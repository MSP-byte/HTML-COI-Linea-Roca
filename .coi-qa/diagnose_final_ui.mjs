import fs from 'node:fs';

const file = 'index.html';
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
const targets = [
  'RESUMEN GENERAL',
  'SECTOR',
  'REPOSITORIO DOCUMENTAL',
  'OneDrive',
  'Marcar enviado a PyC',
  'Marcar enviado',
  'Agregar link documental',
  'Centro de Alertas',
  'CENTRO DE ALERTAS',
  '4. ESTADO FINANCIERO',
  'proxima_certificacion',
  'ultima_certificacion',
  'certificacion',
  'avance',
  'word-break',
  'break-all'
];

function printContext(label, idx, before=18, after=35){
  const start=Math.max(0, idx-before);
  const end=Math.min(lines.length, idx+after+1);
  console.log(`\n===== ${label} @ line ${idx+1} =====`);
  for(let i=start;i<end;i++) console.log(`${String(i+1).padStart(6)} | ${lines[i]}`);
}

console.log(`index.html lines=${lines.length} chars=${text.length}`);
for(const target of targets){
  const hits=[];
  lines.forEach((line,i)=>{ if(line.toLowerCase().includes(target.toLowerCase())) hits.push(i); });
  console.log(`\n### TARGET ${JSON.stringify(target)} hits=${hits.length} lines=${hits.map(i=>i+1).join(',')}`);
  for(const idx of hits.slice(0,12)) printContext(target, idx);
}

console.log('\n===== FUNCTIONS NEAR TARGET WORDS =====');
lines.forEach((line,i)=>{
  if(/function\s+\w+|const\s+\w+\s*=\s*\(|window\.\w+\s*=\s*function/.test(line) && /ficha|resumen|alert|contract|cert|obra|detalle|expediente/i.test(line)){
    console.log(`${String(i+1).padStart(6)} | ${line}`);
  }
});
