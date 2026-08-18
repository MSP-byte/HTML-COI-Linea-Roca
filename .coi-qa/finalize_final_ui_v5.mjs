import fs from 'node:fs';
const p='index.html';let html=fs.readFileSync(p,'utf8');
let count=0;
for(const [from,to] of [
  ['Carpeta documental OneDrive','Documentación en Supabase Storage'],
  ['Copiar estructura sugerida OneDrive','Preparar estructura documental'],
  ['Abrir OneDrive','Abrir vínculo'],
  ['Cargar carpeta OneDrive desde Ficha OC','Revisar documentación en Ficha OC'],
  ['Marcar carpeta OneDrive como principal','Revisar documentación en Supabase'],
  ['Carpetas OneDrive y documentos vinculados','Documentos vinculados']
]){const n=html.split(from).length-1;if(n){html=html.split(from).join(to);count+=n;}}
const visibleBad=[...html.matchAll(/>([^<>]*OneDrive[^<>]*)</gi)].map(m=>m[1].trim()).filter(Boolean);
if(visibleBad.length)throw new Error('Texto OneDrive todavía visible: '+visibleBad.slice(0,10).join(' | '));
if(!html.includes('Documentación en Supabase Storage'))throw new Error('No quedó rótulo documental Supabase Storage');
fs.writeFileSync(p,html);console.log(`FINAL UI V5 OK reemplazos=${count}`);
