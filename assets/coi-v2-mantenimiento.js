/* COI V2 · Dashboard de mantenimiento (aditivo, solo lectura).
 * No duplica el CRUD ni modifica certificaciones, HES, saldos o Supabase.
 * Fuente: todasLasOC() del flujo autenticado existente.
 */
(function () {
  'use strict';
  if (window.COI_MANTENIMIENTO_V2) return;

  const VIEW = 'vistaMantenimientoV2';
  const NAV = 'coiMantenimientoV2Nav';
  const $ = (id) => document.getElementById(id);
  const plain = (v) => String(v == null ? '' : v).trim();
  const norm = (v) => plain(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escapeHtml = (v) => plain(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { query:'', family:'Todas', modality:'Todas', status:'Todos', order:'Vencimiento', selected:'Resumen' };
  let current = [];

  function sessionReady() {
    if (document.body.classList.contains('auth-locked')) return false;
    const label = plain($('supabaseUserLabel')?.textContent);
    const logout = $('btnSupabaseLogout');
    return Boolean(label && !/^sin sesi[oó]n|^no autenticad/i.test(label) && (!logout || !logout.hidden));
  }

  function family(row) {
    const item = row.item || {};
    const s = norm([row.especialidad, item.especialidad, item.tipoTrabajo, item.descripcion].join(' '));
    if (s.includes('ascensor')) return 'Ascensores';
    if (s.includes('escalera mecanica')) return 'Escaleras mecánicas';
    if (s.includes('electrogen') || s.includes('generador')) return 'Grupos electrógenos';
    return 'Otros servicios';
  }

  function modality(row) {
    const item = row.item || {};
    const raw = item._supabaseRaw || {};
    const s = norm(raw.modalidad_certificacion || item.modalidad_certificacion || item.modalidadCertificacion).replace(/[\s-]+/g,'_');
    if (s === 'mensual') return 'Mensual';
    if (s === 'a_demanda' || s === 'demanda') return 'A demanda';
    return s ? 'Otra modalidad' : 'Sin definir';
  }

  function isClosed(row) {
    const item = row.item || {};
    const st = norm(item.estadoCOI || item.estado_coi || row.estado);
    return Boolean(row.cerrada || /cerrad|archivad|finalizad|cancelad/.test(st));
  }

  function contractStatus(row) {
    if (isClosed(row)) return 'Cerrada';
    const days = row.diasRestantes;
    if (typeof days === 'number' && Number.isFinite(days)) {
      if (days < 0) return 'Vencida';
      if (days <= 30) return 'Por vencer';
    }
    return 'En seguimiento';
  }

  function canonicalOC(row) {
    const item = row.item || {};
    return plain(item.nro_oc || item.numeroOC || row.oc).replace(/^OC-/i,'').replace(/\s+/g,'');
  }

  function orderKey(row) {
    return row?.item?.idObra || row?.item?.idOC || row?.item?.idServicio || row?.item?.id || row?.oc || '';
  }

  function read() {
    if (!sessionReady() || typeof window.todasLasOC !== 'function') return [];
    let raw = [];
    try { raw = window.todasLasOC() || []; } catch (error) {
      console.warn('[COI Mantenimiento V2] No se pudo leer el catálogo autorizado.', error);
      return [];
    }
    const grouped = new Map();
    raw.forEach(row => {
      if (norm(row?.tipo || row?.item?.tipo) !== 'servicio') return;
      const oc = canonicalOC(row);
      const item = row.item || {};
      const identity = oc || plain(item.idOC || item.idObra || item.idServicio);
      // Una misma OC puede cubrir varias estaciones: no duplicar contratos.
      if (!identity) return;
      const key = identity;
      if (!grouped.has(key)) grouped.set(key, {...row, _mantStations:new Set()});
      const target = grouped.get(key);
      if (plain(row.estacion)) target._mantStations.add(plain(row.estacion));
      // La fila se utiliza solamente para navegar a la ficha existente.
    });
    return [...grouped.values()].map(row => ({
      row,
      oc:canonicalOC(row),
      provider:plain(row.proveedor || row.item?.proveedor) || 'Sin proveedor',
      description:plain(row.item?.tipoTrabajo || row.item?.descripcion || row.especialidad) || 'Servicio sin descripción',
      family:family(row), modality:modality(row), status:contractStatus(row),
      stations:[...row._mantStations], days:typeof row.diasRestantes === 'number' ? row.diasRestantes : null
    }));
  }

  function filtered() {
    const q = norm(state.query);
    return current.filter(r =>
      (state.family==='Todas' || r.family===state.family) &&
      (state.modality==='Todas' || r.modality===state.modality) &&
      (state.status==='Todos' || r.status===state.status) &&
      (!q || norm([r.oc,r.provider,r.description,r.family,r.stations.join(' ')].join(' ')).includes(q))
    ).sort((a,b) => {
      if (state.order === 'Contratista') return a.provider.localeCompare(b.provider,'es');
      if (state.order === 'Tipo') return a.family.localeCompare(b.family,'es');
      return (a.days ?? 99999) - (b.days ?? 99999);
    });
  }

  function bars(rows, accessor) {
    const counts = new Map();
    rows.forEach(x => {const k = accessor(x); counts.set(k,(counts.get(k)||0)+1);});
    const max = Math.max(1,...counts.values());
    return [...counts].sort((a,b)=>b[1]-a[1]).map(([k,n]) =>
      '<div class="mant-v2-bar"><span>'+escapeHtml(k)+'</span><div class="mant-v2-track"><i style="width:'+Math.round(n/max*100)+'%"></i></div><b>'+n+'</b></div>'
    ).join('') || '<p class="mant-v2-muted">Sin servicios clasificados.</p>';
  }

  function makeCards(rows) {
    return rows.map((r,idx) => {
      const deadline = r.days === null ? 'Sin plazo informado' : r.days < 0 ? 'Vencida hace '+Math.abs(r.days)+' días' : r.days===0?'Vence hoy':'Vence en '+r.days+' días';
      const status = r.status === 'Vencida'?'danger':r.status === 'Por vencer'?'warning':'neutral';
      return '<article class="mant-v2-order">'+
        '<div class="mant-v2-order-head"><span class="mant-v2-num">OC '+escapeHtml(r.oc||'Sin número')+'</span><span class="mant-v2-pill '+status+'">'+escapeHtml(r.status)+'</span></div>'+
        '<h3>'+escapeHtml(r.description)+'</h3>'+
        '<p class="mant-v2-muted">'+escapeHtml(r.provider)+'</p>'+
        '<div class="mant-v2-order-meta"><span>'+escapeHtml(r.family)+'</span><span>'+escapeHtml(r.modality)+'</span><span>'+escapeHtml(deadline)+'</span></div>'+
        '<p class="mant-v2-stations">'+escapeHtml(r.stations.length?r.stations.join(' · '):'Estaciones sin informar')+'</p>'+
        '<button type="button" class="mant-v2-open" data-mant-idx="'+idx+'">Abrir Ficha OC ↗</button></article>';
    }).join('') || '<div class="mant-v2-empty">No hay contratos que coincidan con los filtros seleccionados.</div>';
  }

  function render() {
    const view = $(VIEW);
    if (!view) return;
    const main = $('mantV2Content');
    if (!sessionReady()) {
      main.innerHTML = '<div class="mant-v2-empty" role="status">Iniciá sesión en COI para consultar los servicios de mantenimiento. No se muestran datos de caché sin autenticar.</div>';
      return;
    }
    current = read();
    const monthly = current.filter(r=>r.modality==='Mensual').length;
    const demand = current.filter(r=>r.modality==='A demanda').length;
    const unknown = current.filter(r=>r.modality==='Sin definir').length;
    const due = current.filter(r=>r.status==='Vencida'||r.status==='Por vencer').length;
    const total = current.length;
    const catalog = ['Ascensores','Escaleras mecánicas','Grupos electrógenos','Otros servicios'];
    main.innerHTML = '<section class="mant-v2-kpis">'+[
      ['Contratos de servicio',total],
      ['Modalidad mensual',monthly],
      ['Modalidad a demanda',demand],
      ['Vencidos o por vencer',due]
    ].map(([label,n])=>'<div class="mant-v2-kpi"><strong>'+n+'</strong><span>'+label+'</span></div>').join('')+'</section>'+
    '<div class="mant-v2-columns"><section class="mant-v2-panel"><h3>Contratos por especialidad</h3>'+bars(current,r=>r.family)+'</section>'+
    '<section class="mant-v2-panel"><h3>Modalidades registradas</h3>'+bars(current,r=>r.modality)+
    '<p class="mant-v2-note">'+unknown+' contratos sin modalidad definida. La modalidad se lee de la OC: no se presume que una prestación sea mensual.</p></section></div>'+
    '<section class="mant-v2-panel"><div class="mant-v2-panel-head"><div><h3>Seguimiento de mantenimiento</h3><p class="mant-v2-muted">Consulta por contrato · no equivale a cumplimiento de cada período</p></div><span id="mantV2Count"></span></div>'+
    '<div class="mant-v2-filters">'+
    '<label>Buscar<input id="mantV2Query" type="search" placeholder="OC, proveedor, especialidad, estación..." value="'+escapeHtml(state.query)+'"></label>'+
    '<label>Especialidad<select id="mantV2Family"><option>Todas</option>'+catalog.map(x=>'<option'+(state.family===x?' selected':'')+'>'+escapeHtml(x)+'</option>').join('')+'</select></label>'+
    '<label>Modalidad<select id="mantV2Modality">'+['Todas','Mensual','A demanda','Sin definir','Otra modalidad'].map(x=>'<option'+(state.modality===x?' selected':'')+'>'+escapeHtml(x)+'</option>').join('')+'</select></label>'+
    '<label>Vigencia<select id="mantV2Status">'+['Todos','En seguimiento','Por vencer','Vencida','Cerrada'].map(x=>'<option'+(state.status===x?' selected':'')+'>'+escapeHtml(x)+'</option>').join('')+'</select></label>'+
    '<label>Ordenar<select id="mantV2Sort">'+['Vencimiento','Contratista','Tipo'].map(x=>'<option'+(state.order===x?' selected':'')+'>'+x+'</option>').join('')+'</select></label></div>'+
    '<div id="mantV2Orders" class="mant-v2-list"></div></section>'+
    '<div class="mant-v2-callout"><strong>Separación contractual:</strong> los ciclos preventivos mensuales y las intervenciones a demanda tendrán registros de ejecución/certificación independientes. Esta vista solo muestra contratos existentes y no crea ni confirma MED, HES ni estados documentales.</div>';
    main.querySelector('#mantV2Query').addEventListener('input',e=>{state.query=e.target.value;paintList();});
    [['mantV2Family','family'],['mantV2Modality','modality'],['mantV2Status','status'],['mantV2Sort','order']].forEach(([id,key])=>{
      $(id).addEventListener('change',e=>{state[key]=e.target.value;paintList();});
    });
    $('mantV2Orders').addEventListener('click',e=>{
      const b=e.target.closest('[data-mant-idx]');if(!b)return;
      const entry=filtered()[Number(b.dataset.mantIdx)];
      const key=entry&&orderKey(entry.row);
      if(key && typeof window.COI_V2?.openOC==='function') window.COI_V2.openOC(key);
      else if(key && typeof window.abrirFichaOC==='function') window.abrirFichaOC(key);
    });
    paintList();
  }

  function paintList() {
    const items = filtered();
    if($('mantV2Count'))$('mantV2Count').textContent=items.length+' de '+current.length+' contratos';
    if($('mantV2Orders'))$('mantV2Orders').innerHTML=makeCards(items);
  }

  function open() {
    if (!$(VIEW)) return;
    if (typeof window.mostrarVista === 'function') window.mostrarVista(VIEW);
    else {
      document.querySelectorAll('.view.active').forEach(x=>x.classList.remove('active'));
      $(VIEW).classList.add('active');
    }
    render();
    window.COI_V2?.syncNav?.();
    $(NAV)?.classList.add('active');
  }

  function mount() {
    const sidebar = document.querySelector('#coiV2Sidebar .coi-v2-nav');
    const orders = $('vistaOrdenes');
    if (!sidebar || !orders) return false;
    if (!$(VIEW)) {
      const section = document.createElement('section');
      section.id = VIEW;section.className='view';
      section.innerHTML = '<div class="view-card mant-v2-shell"><header class="mant-v2-header"><div><p>COI · GESTIÓN INTEGRADA</p><h2>Mantenimiento de Línea Roca</h2><span>Contratos preventivos mensuales y trabajos a demanda, diferenciados por modalidad.</span></div><div class="mant-v2-header-actions"><button type="button" id="mantV2Refresh">Actualizar vista</button><button type="button" id="mantV2OpenObras">Cartera de Obras ↗</button></div></header><div id="mantV2Content" class="mant-v2-content"></div></div>';
      orders.parentNode.insertBefore(section,orders);
      $('mantV2Refresh').addEventListener('click',render);
      $('mantV2OpenObras').addEventListener('click',()=>{
        if(typeof window.COI_CARTERA_V8_P2?.open==='function')window.COI_CARTERA_V8_P2.open();
        else $('coiV8V2Nav')?.click();
        $(NAV)?.classList.remove('active');
      });
    }
    if (!$(NAV)) {
      const button = document.createElement('button');
      button.id=NAV;button.type='button';button.className='coi-v2-nav-btn';
      button.setAttribute('aria-label','Mantenimiento');
      button.title='Gestión de mantenimiento';
      const icon = document.querySelector('[data-v2-nav="btnUnidadesMantenimiento"] svg') || document.querySelector('[data-v2-nav="btnOrdenes"] svg');
      if(icon)button.appendChild(icon.cloneNode(true));
      const label = document.createElement('span');label.className='v2-label';label.textContent='Mantenimiento';button.appendChild(label);
      button.addEventListener('click',open);
      const cartera=$('coiV8V2Nav');
      (cartera||document.querySelector('[data-v2-nav="btnOrdenes"]'))?.insertAdjacentElement('afterend',button);
    }
    // Solo eventos de navegación; evitar MutationObserver global que afecte el rendimiento.
    document.addEventListener('click',e=>{
      const target = e.target instanceof Element ? e.target.closest('[data-v2-nav],#coiV8V2Nav') : null;
      if(target) $(NAV)?.classList.remove('active');
    });
    window.addEventListener('coi:cartera-v8-updated',()=>{if($(VIEW)?.classList.contains('active'))render();});
    return true;
  }

  function init() {
    if(mount())return;
    let tries=0;const retry=setInterval(()=>{if(mount()||++tries>=25)clearInterval(retry);},200);
  }
  window.COI_MANTENIMIENTO_V2=Object.freeze({version:'2.0-draft',readOnly:true,open,refresh:render});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
