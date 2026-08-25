from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
start = s.index('  function renderAlertsExecutive(){')
end = s.index('  function renderExecutiveFicha(', start)

replacement = r'''  let execAlertsExpanded=false;
  let execAlertsRenderQueued=false;

  function getExecAlertsSurface(host){
    if(!host)return null;
    const legacyBody=host.querySelector('#alertasTbody');
    return host.querySelector('table.coi-alertas-table')||legacyBody?.closest('table')||legacyBody||null;
  }

  function mutationOnlyTouchesExecAlertsCard(mutation){
    const nodes=[...mutation.addedNodes,...mutation.removedNodes];
    return nodes.length>0&&nodes.every(node=>{
      if(node.nodeType!==1)return false;
      return node.id==='execAlertsCard'||Boolean(node.closest?.('#execAlertsCard'));
    });
  }

  function queueRenderAlertsExecutive(){
    if(execAlertsRenderQueued)return;
    execAlertsRenderQueued=true;
    requestAnimationFrame(()=>{
      execAlertsRenderQueued=false;
      renderAlertsExecutive();
    });
  }

  function ensureExecAlertsLifecycle(){
    const view=document.getElementById('vistaCentroAlertas');
    if(view&&!view.__coiExecAlertsObserver){
      const observer=new MutationObserver(mutations=>{
        if(mutations.length&&mutations.every(mutationOnlyTouchesExecAlertsCard))return;
        const host=document.querySelector('#vistaCentroAlertas .view-body');
        if(getExecAlertsSurface(host))queueRenderAlertsExecutive();
      });
      view.__coiExecAlertsObserver=observer;
      observer.observe(view,{childList:true,subtree:true});
    }

    if(document.documentElement.dataset.coiExecAlertsNavHook!=='1'){
      document.documentElement.dataset.coiExecAlertsNavHook='1';
      document.addEventListener('click',event=>{
        const target=event.target instanceof Element
          ? event.target.closest('#btnCentroAlertas,[data-v2-nav="btnCentroAlertas"],#btnIrCentroAlertasDashboard')
          : null;
        if(!target)return;
        requestAnimationFrame(()=>queueRenderAlertsExecutive());
      },true);
    }
  }

  function renderAlertsExecutive(){
    const host=document.querySelector('#vistaCentroAlertas .view-body');
    if(!host)return;

    ensureExecAlertsLifecycle();
    const mainSurface=getExecAlertsSurface(host);
    if(!mainSurface)return;

    let card=$('execAlertsCard');
    if(card)card.remove();

    const rows=generarAlertasCalidadYDocumentales();
    card=document.createElement('details');
    card.id='execAlertsCard';
    card.className='exec-alert-card exec-alert-collapsible';
    card.open=execAlertsExpanded;
    card.innerHTML=`<summary class="exec-card-head exec-alert-summary"><div class="exec-alert-summary-main"><span class="exec-alert-disclosure" aria-hidden="true">▸</span><div><h3>Alertas de calidad y documentación</h3><div class="muted">${rows.length} alerta(s) calculadas desde Supabase.</div></div></div><span class="exec-alert-summary-action">${rows.length} alertas · desplegar</span></summary><div class="exec-alert-collapsible-body"><div class="table-wrap"><table class="coi-table tabla-operativa exec-alert-table"><thead><tr><th>Severidad</th><th>Tipo</th><th>OC</th><th>Estación</th><th>Mensaje</th><th>Acción sugerida</th><th>Ficha</th></tr></thead><tbody>${rows.map(a=>`<tr class="${norm(a.sev)==='CRITICA'?'exec-critical-row':''}"><td>${badge(a.sev,norm(a.sev).includes('CRIT')||norm(a.sev)==='ALTA'?'rojo':norm(a.sev)==='MEDIA'?'amarillo':'gris')}</td><td>${esc(a.tipo)}</td><td>${esc(a.oc)}</td><td>${esc(a.est||'—')}</td><td>${esc(a.msg)}</td><td>${esc(a.accion)}</td><td><button type="button" data-open-oc="${esc(a.oc)}">Ver ficha</button></td></tr>`).join('')||'<tr><td colspan="7">Sin alertas ejecutivas.</td></tr>'}</tbody></table></div></div>`;
    card.addEventListener('toggle',()=>{execAlertsExpanded=card.open;});

    if(!$('execAlertsCollapsibleStyle')){
      const style=document.createElement('style');
      style.id='execAlertsCollapsibleStyle';
      style.textContent=`
        #execAlertsCard.exec-alert-collapsible{overflow:hidden}
        #execAlertsCard .exec-alert-summary{cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;gap:16px}
        #execAlertsCard .exec-alert-summary::-webkit-details-marker{display:none}
        #execAlertsCard .exec-alert-summary-main{display:flex;align-items:center;gap:10px;min-width:0}
        #execAlertsCard .exec-alert-disclosure{display:inline-block;font-size:18px;line-height:1;transition:transform .18s ease;flex:0 0 auto}
        #execAlertsCard[open] .exec-alert-disclosure{transform:rotate(90deg)}
        #execAlertsCard .exec-alert-summary-action{font-size:12px;font-weight:800;white-space:nowrap;color:#5d6b82}
        #execAlertsCard[open] .exec-alert-summary-action{font-size:0}
        #execAlertsCard[open] .exec-alert-summary-action::after{content:'contraer';font-size:12px}
        #execAlertsCard .exec-alert-collapsible-body{padding-top:10px}
        @media(max-width:760px){#execAlertsCard .exec-alert-summary{align-items:flex-start}.exec-alert-summary-action{white-space:normal;text-align:right}}
      `;
      document.head.appendChild(style);
    }

    host.insertBefore(card,host.firstChild);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',ensureExecAlertsLifecycle,{once:true});
  }else{
    ensureExecAlertsLifecycle();
  }

'''

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8', newline='')
