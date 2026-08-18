import fs from 'node:fs';
const p='index.html';let html=fs.readFileSync(p,'utf8');
const before=(html.match(/\bOneDrive\b/g)||[]).length;
// Reemplaza únicamente la palabra independiente; no toca identificadores legacy como linkOneDrive/rutaOneDrive.
html=html.replace(/\bOneDrive\b/g,'Supabase Storage');
html=html.replaceAll('Link Supabase Storage','Referencia documental');
html=html.replaceAll('Carpeta documental Supabase Storage','Documentación en Supabase Storage');
html=html.replace("const DOC_REPOSITORIOS_OC_V64=['SharePoint','Supabase Storage','Google Drive','Carpeta local','Otro'];","const DOC_REPOSITORIOS_OC_V64=['Supabase Storage'];");
html=html.replaceAll('El archivo no se guarda dentro del sistema. Pegue el link de SharePoint, Supabase Storage o Google Drive.','La documentación operativa se gestiona mediante Supabase Storage.');
html=html.replaceAll('El archivo no se guarda dentro del sistema. Pegue ruta y link de Supabase Storage/SharePoint/Drive.','La documentación operativa se gestiona mediante Supabase Storage.');
html=html.replaceAll('Los datos del sistema se guardan localmente en el navegador. Para trasladar la base a GitHub Pages, otra PC o Supabase Storage, exporte un backup JSON completo e importelo en el equipo destino.','Supabase es la fuente oficial de datos. Los backups JSON son únicamente una herramienta de contingencia y recuperación controlada.');
const after=(html.match(/\bOneDrive\b/g)||[]).length;
if(after!==0)throw new Error(`Quedaron ${after} referencias independientes a OneDrive`);
if(!html.includes("const DOC_REPOSITORIOS_OC_V64=['Supabase Storage'];"))throw new Error('Catálogo documental no quedó limitado a Supabase Storage');
fs.writeFileSync(p,html);console.log(`FINAL UI V6 OK OneDrive independiente ${before}->${after}`);
