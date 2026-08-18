import fs from 'node:fs';
const indexPath='index.html';
const testPath='tests/obra_resumen_supabase.spec.js';
let html=fs.readFileSync(indexPath,'utf8');
let test=fs.readFileSync(testPath,'utf8');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();

let removed=0;
html=html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,btn=>{
  const t=norm(btn.replace(/<[^>]+>/g,' '));
  if(t.includes('AGREGAR LINK DOCUMENTAL')||(t.includes('MARCAR ENVIAD')&&t.includes('PYC'))||t.includes('ONEDRIVE')){removed++;return '';}
  return btn;
});
console.log(`Botones legacy retirados=${removed}`);

html=html.replace("if(text.includes('MARCAR ENVIADO A PYC')||text.includes('AGREGAR LINK DOCUMENTAL'))btn.remove();","if((text.includes('MARCAR ENVIAD')&&text.includes('PYC'))||text.includes('AGREGAR LINK DOCUMENTAL')||text.includes('ONEDRIVE'))btn.remove();");
html=html.replace("if((text.includes('MARCAR ENVIAD')&&text.includes('PYC'))||text.includes('AGREGAR LINK DOCUMENTAL'))btn.remove();","if((text.includes('MARCAR ENVIAD')&&text.includes('PYC'))||text.includes('AGREGAR LINK DOCUMENTAL')||text.includes('ONEDRIVE'))btn.remove();");

html=html.replaceAll('Abrir OneDrive','Abrir vínculo');
html=html.replaceAll('Cargar carpeta OneDrive desde Ficha OC','Revisar documentación en Ficha OC');
html=html.replaceAll('Marcar carpeta OneDrive como principal','Revisar documentación en Supabase');
html=html.replaceAll('Carpetas OneDrive y documentos vinculados','Documentos vinculados');

// Retirar tarjeta ejecutiva de link principal externo si todavía existe.
html=html.replace(/,\['Link principal',link\?`<a href="\$\{esc\(link\)\}" target="_blank" rel="noopener noreferrer">Abrir vínculo<\/a>`:'Sin link válido'\]/g,'');

// QA: variante real del botón y chequeo de OneDrive.
test=test.replace("'<button>Marcar enviado a PyC</button><button>Agregar link documental</button>'","'<button>Marcar enviada a PyC</button><button>Agregar link documental</button><button>Abrir OneDrive</button>'");
test=test.replace("not.toContainText(/Marcar enviado a PyC/i)","not.toContainText(/Marcar enviad[oa] a PyC/i)");

const buttonTexts=[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(m=>norm(m[1].replace(/<[^>]+>/g,' ')));
if(buttonTexts.some(t=>t.includes('AGREGAR LINK DOCUMENTAL')))throw new Error('Sigue Agregar link documental');
if(buttonTexts.some(t=>t.includes('MARCAR ENVIAD')&&t.includes('PYC')))throw new Error('Sigue Marcar enviada/enviado a PyC');
if(buttonTexts.some(t=>t.includes('ONEDRIVE')))throw new Error('Sigue botón OneDrive: '+buttonTexts.filter(t=>t.includes('ONEDRIVE')).join(' | '));
if(!html.includes('Envío a Planificación y Control'))throw new Error('Se perdió el dato Envío a Planificación y Control');

fs.writeFileSync(indexPath,html);
fs.writeFileSync(testPath,test);
console.log('FINAL UI V4 OK');
