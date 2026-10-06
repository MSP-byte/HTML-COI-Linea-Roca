'use strict';

const fs = require('fs');
const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');

function replaceOnce(label, re, replacement) {
  const matches = html.match(re);
  if (!matches || matches.length !== 1) {
    throw new Error(label + ': expected exactly 1 match, got ' + (matches ? matches.length : 0));
  }
  html = html.replace(re, replacement);
}

replaceOnce(
  'canEditOC legacy DOM dependency',
  /function canEditOC\(body\)\{return \[\.\.\.body\.querySelectorAll\('button'\)\]\.some\(btn=>fold\(btn\.textContent\)==='EDITAR OC'\);\}/,
`function canEditOC(body){
    const role=fold(window.APP_STATE?.role||window.APP_STATE?.perfil?.rol||'');
    if(['ADMINISTRADOR','JEFATURA','EDITOR','PLANIFICACION','CONTROL','SUPERVISOR'].includes(role))return true;
    if(role==='CONSULTA')return false;
    try{
      if(typeof window.esAutorizacionAdministrativaSupabaseV60==='function'&&window.esAutorizacionAdministrativaSupabaseV60())return true;
    }catch(_){}
    return [...body.querySelectorAll('button')].some(btn=>fold(btn.textContent)==='EDITAR OC');
  }`
);

replaceOnce(
  'H12 current ficha layout guard',
  /const strip=body\.querySelector\('\.oc-kpis'\); if\(!strip\)return;\s*const original=\[\.\.\.strip\.querySelectorAll\('\.oc-kpi'\)\]\.find\(card=>\[\.\.\.card\.querySelectorAll\('span'\)\]\.some\(span=>fold\(span\.textContent\)==='AVANCE DE OBRA'\)\);\s*if\(!original\)return;\s*const actaCard=buildActaCard\(original\); original\.replaceWith\(actaCard\);\s*const manualCard=buildManualCard\(order,canEditOC\(body\)\); actaCard\.insertAdjacentElement\('afterend',manualCard\);/,
`const strip=body.querySelector('.oc-kpis'); if(!strip)return;
    const original=[...strip.querySelectorAll('.oc-kpi')].find(card=>[...card.querySelectorAll('span')].some(span=>fold(span.textContent)==='AVANCE DE OBRA'));
    const editable=canEditOC(body);
    if(!original){
      const manualCard=buildManualCard(order,editable);
      const anchor=[...strip.querySelectorAll('.oc-kpi')].find(card=>[...card.querySelectorAll('span')].some(span=>fold(span.textContent)==='ULTIMA CERTIFICACION'));
      if(anchor)anchor.insertAdjacentElement('afterend',manualCard); else strip.appendChild(manualCard);
      return;
    }
    const actaCard=buildActaCard(original); original.replaceWith(actaCard);
    const manualCard=buildManualCard(order,editable); actaCard.insertAdjacentElement('afterend',manualCard);`
);

fs.writeFileSync(path, html);
console.log('Applied regression fix: H12 progress card now mounts on current Ficha layout.');
