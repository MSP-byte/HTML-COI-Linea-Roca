import fs from 'node:fs';

const path = 'index.html';
let source = fs.readFileSync(path, 'utf8');

function replaceExact(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Guardrail ${label}: se esperaba 1 coincidencia y se encontraron ${count}.`);
  source = source.replace(before, after);
}

replaceExact(
`const names=new Set([
...Object.keys(baseline),
...Object.keys(current)
]);`,
`const missingFields=Object.keys(baseline).filter(name=>!has(current,name));
const names=new Set(Object.keys(current));`,
'dirty-present-fields'
);

replaceExact(
`baseline:baseline,
current:current
};`,
`baseline:baseline,
current:current,
missingFields:missingFields
};`,
'dirty-diagnostics'
);

replaceExact(
`  async function openEditor(reference){
    const order=resolveLocal(reference||window.ocActualId||window.__coiFichaOCActiva);if(!order){if(typeof window.coiToast==='function')window.coiToast('No se pudo identificar la OC abierta.','error');return false;}
    const modal=ensureModal(),sections=SECTIONS.map(([title,fields],index)=>`,
`  async function openEditor(reference){
    const localOrder=resolveLocal(reference||window.ocActualId||window.__coiFichaOCActiva);if(!localOrder){if(typeof window.coiToast==='function')window.coiToast('No se pudo identificar la OC abierta.','error');return false;}
    let order=localOrder,sessionError=null;
    if(navigator.onLine!==false){
      try{
        const access=await requireSession();
        const remoteId=text(fieldValue(localOrder,'id'));
        if(UUID_RE.test(remoteId))order=await readRemote(access.client,remoteId);
      }catch(error){sessionError=error;}
    }
    const modal=ensureModal(),sections=SECTIONS.map(([title,fields],index)=>`,
'open-remote-baseline'
);

replaceExact(
`    if(navigator.onLine===false){readonly.hidden=false;readonly.textContent='Modo solo lectura · sin conexión';save.disabled=true;}else{try{await requireSession();save.disabled=true;}catch(error){readonly.hidden=false;readonly.textContent=error?.message||'Debe iniciar sesión.';save.disabled=true;}}`,
`    if(navigator.onLine===false){readonly.hidden=false;readonly.textContent='Modo solo lectura · sin conexión';save.disabled=true;}else if(sessionError){readonly.hidden=false;readonly.textContent=sessionError?.message||'Debe iniciar sesión.';save.disabled=true;}else{save.disabled=true;}`,
'open-session-state'
);

replaceExact(
`      const current=collectForm(modal),baseline=JSON.parse(editState.baseline),changes={};for(const name of ALLOWED)if(comparable(name,current[name])!==comparable(name,baseline[name]))changes[name]=current[name];`,
`      const current=collectForm(modal),baseline=JSON.parse(editState.baseline),changes={};for(const name of ALLOWED)if(has(current,name)&&comparable(name,current[name])!==comparable(name,baseline[name]))changes[name]=current[name];`,
'save-present-fields-only'
);

fs.writeFileSync(path, source, 'utf8');

const verify = fs.readFileSync(path, 'utf8');
const required = [
  'const missingFields=Object.keys(baseline).filter(name=>!has(current,name));',
  'const names=new Set(Object.keys(current));',
  'missingFields:missingFields',
  "const localOrder=resolveLocal(reference||window.ocActualId||window.__coiFichaOCActiva)",
  "if(UUID_RE.test(remoteId))order=await readRemote(access.client,remoteId);",
  "for(const name of ALLOWED)if(has(current,name)&&comparable(name,current[name])!==comparable(name,baseline[name]))"
];
for (const token of required) if (!verify.includes(token)) throw new Error(`Verificación posterior falló: ${token}`);
console.log('RC2 editor baseline hotfix aplicado con guardrails exactos.');
