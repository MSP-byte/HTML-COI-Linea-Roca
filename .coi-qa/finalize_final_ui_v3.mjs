import fs from 'node:fs';
const indexPath='index.html';
const testPath='tests/obra_resumen_supabase.spec.js';
let html=fs.readFileSync(indexPath,'utf8');
let test=fs.readFileSync(testPath,'utf8');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();

// Eliminar físicamente todos los botones legacy solicitados, contemplando enviado/enviada.
let removed=0;
html=html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi,btn=>{
  const t=norm(btn.replace(/<[^>]+>/g,' '));
  if(t.includes('AGREGAR LINK DOCUMENTAL') || (t.includes('MARCAR ENVIAD')&&t.includes('PYC'))){removed++;return '';}
  return btn;
});
console.log(`Botones legacy adicionales eliminados=${removed}`);

// La ficha no debe volver a insertar ninguna variante del control PyC/link.
html=html.replace("if(text.includes('MARCAR ENVIADO A PYC')||text.includes('AGREGAR LINK DOCUMENTAL'))btn.remove();","if((text.includes('MARCAR ENVIAD')&&text.includes('PYC'))||text.includes('AGREGAR LINK DOCUMENTAL'))btn.remove();");

// Eliminar referencias visuales OneDrive residuales. No se alteran nombres de campos legacy ni datos persistidos.
html=html.replaceAll('Abrir OneDrive','Abrir vínculo');
html=html.replaceAll('Cargar carpeta OneDrive desde Ficha OC','Revisar documentación en Ficha OC');
html=html.replaceAll('Marcar carpeta OneDrive como principal','Revisar documentación en Supabase');
html=html.replaceAll('Carpetas OneDrive y documentos vinculados','Documentos vinculados');

// En cabecera ejecutiva, el link externo legacy no es un dato duro: retirar la tarjeta Link principal.
html=html.replace(/,\['Link principal',link\?`<a href="\$\{esc\(link\)\}" target="_blank" rel="noopener noreferrer">Abrir vínculo<\/a>`:'Sin link válido'\]/g,'');

// QA: validar la variante real "Marcar enviada a PyC" y ausencia de OneDrive visible.
test=test.replace("'<button>Marcar enviado a PyC</button><button>Agregar link documental</button>'","'<button>Marcar enviada a PyC</button><button>Agregar link documental</button><button>Abrir OneDrive</button>'");
test=test.replace("not.toContainText(/Marcar enviado a PyC/i)","not.toContainText(/Marcar enviad[oa] a PyC/i)");
if(!test.includes("not.toContainText(/OneDrive/i)")) throw new Error('Falta aserción OneDrive en test');

// Guardas sobre botones renderizables.
const buttonTexts=[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(m=>norm(m[1].replace(/<[^>]+>/g,' ')));
if(buttonTexts.some(t=>t.includes('AGREGAR LINK DOCUMENTAL')))throw new Error('Sigue botón Agregar link documental');
if(buttonTexts.some(t=>t.includes('MARCAR ENVIAD')&&t.includes('PYC')))throw new Error('Sigue botón Marcar enviada/enviado a PyC');
if(buttonTexts.some(t=>t.includes('ONEDRIVE')))throw new Error('Sigue botón visible OneDrive');
if(!html.includes('Envío a Planificación y Control'))throw new Error('Se perdió el dato Envío a Planificación y Control');

fs.writeFileSync(indexPath,html);
fs.writeFileSync(testPath,test);
console.log('FINAL UI V3 OK');
