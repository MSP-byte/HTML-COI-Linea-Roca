/* COI V2 · Agrupación presentacional de Ficha de Obra V8/V9.
   Conserva los 33 campos, orden y contenido del Excel. Sin escrituras ni cambios al formulario. */
(function(){
  'use strict';
  if(window.COI_CARTERA_FICHA_V2)return;
  const GRID='cv2DetailGrid';
  const fold=v=>String(v||'').trim();
  function enhance(){
    const grid=document.getElementById(GRID);
    if(!grid || grid.querySelector('.cv2-v2-group'))return;
    const fields=[...grid.children].filter(e=>e.classList?.contains('cv2-field'));
    // Evitar transformar un estado de carga parcial o una vista diferente.
    if(fields.length<30)return;
    const names=[...new Set(fields.map(f=>fold(f.dataset.group)||'Otros datos'))];
    const fragment=document.createDocumentFragment();
    for(const name of names){
      const section=document.createElement('details');
      section.className='cv2-v2-group';section.open=true;section.dataset.title=name;
      const header=document.createElement('summary');
      const strong=document.createElement('strong');strong.textContent=name;
      const count=document.createElement('span');count.textContent=fields.filter(f=>(fold(f.dataset.group)||'Otros datos')===name).length+' campos';
      header.append(strong,count);
      const inner=document.createElement('div');inner.className='cv2-v2-fields';
      fields.filter(f=>(fold(f.dataset.group)||'Otros datos')===name).forEach(f=>inner.append(f));
      section.append(header,inner);fragment.append(section);
    }
    grid.replaceChildren(fragment);
  }
  function mount(){
    const grid=document.getElementById(GRID);
    if(!grid)return false;
    const observer=new MutationObserver(()=>enhance());
    observer.observe(grid,{childList:true});
    enhance();
    return true;
  }
  function init(){
    if(mount())return;
    let count=0;const wait=setInterval(()=>{if(mount()||++count>=25)clearInterval(wait);},200);
  }
  window.COI_CARTERA_FICHA_V2=Object.freeze({version:'2.0',readOnly:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
