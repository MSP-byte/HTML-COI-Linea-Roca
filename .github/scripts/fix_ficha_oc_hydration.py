from pathlib import Path

INDEX = Path('index.html')
TEST = Path('tests/ficha_oc_supabase_hydration.spec.js')
WORKFLOW = Path('.github/workflows/ficha-oc-hydration-once.yml')
SELF = Path('.github/scripts/fix_ficha_oc_hydration.py')
MARKER = 'id="coi-expediente-hydration-r1"'

html = INDEX.read_text(encoding='utf-8')
local_storage_before = html.count('localStorage')

block = r'''
<script id="coi-expediente-hydration-r1">
(function(){
  'use strict';

  const TABLE='coi_ordenes';
  const REMOTE_TTL_MS=15000;
  const remoteState=new Map();
  const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
  const meaningful=value=>value!==undefined&&value!==null&&!(typeof value==='string'&&value.trim()==='');
  const numericSources=new Set(['monto_total','plazo_dias','saldo_remanente','calidad_datos_score']);
  const booleanSources=new Set(['certificable_con_saldo','requiere_accion']);
  const FIELD_MAP=Object.freeze({
    idObra:'id_obra',
    idOC:'id_obra',
    numeroOC:'nro_oc',
    oc:'nro_oc',
    ocNro:'nro_oc',
    tipo:'tipo',
    tipoTrabajo:'tipo_trabajo',
    especialidad:'especialidad',
    descripcion:'descripcion',
    proveedor:'proveedor',
    estacion:'estacion',
    ramal:'ramal',
    sector:'sector',
    expediente:'expediente',
    monto:'monto_total',
    montoTotal:'monto_total',
    montoOC:'monto_total',
    moneda:'moneda',
    actaInicio:'fecha_acta_inicio',
    fechaInicio:'fecha_acta_inicio',
    fechaActaInicio:'fecha_acta_inicio',
    plazoDias:'plazo_dias',
    plazo:'plazo_dias',
    vencimiento:'fecha_vencimiento',
    fechaFin:'fecha_vencimiento',
    fechaVencimiento:'fecha_vencimiento',
    proximaCertificacion:'proxima_certificacion',
    proxCertificacion:'proxima_certificacion',
    fechaRecepcionDocumentacion:'fecha_recepcion_documentacion',
    estado:'estado_coi',
    estadoCOI:'estado_coi',
    estadoDocumental:'estado_documental',
    estadoRegistro:'estado_registro',
    observaciones:'observaciones',
    saldoRemanente:'saldo_remanente',
    certificableConSaldo:'certificable_con_saldo',
    justificacionAdministrativa:'justificacion_administrativa',
    linkDocumentalPrincipal:'link_documental_principal',
    estadoLinkDocumental:'estado_link_documental',
    calidadDatosEstado:'calidad_datos_estado',
    calidadDatosScore:'calidad_datos_score',
    prioridadOperativa:'prioridad_operativa',
    responsableCOI:'responsable_coi',
    fechaUltimoControl:'fecha_ultimo_control',
    requiereAccion:'requiere_accion',
    motivoRequiereAccion:'motivo_requiere_accion',
    fechaCierreOperativo:'fecha_cierre_operativo',
    observacionCierre:'observacion_cierre',
    controlTercerosHasta:'control_terceros_hasta',
    controlTercerosEstado:'control_terceros_estado',
    fechaCreacion:'fecha_creacion',
    fechaUltimaModificacion:'fecha_actualizacion'
  });

  function normalizeSourceValue(source,value){
    if(booleanSources.has(source))return value===true||value===1||String(value).toLowerCase()==='true';
    if(numericSources.has(source)){
      const number=Number(value);
      return Number.isFinite(number)?number:value;
    }
    return value;
  }

  function hydrateItem(item,raw){
    if(!item||typeof item!=='object'||!raw||typeof raw!=='object')return item;
    item._supabaseRaw={...(item._supabaseRaw&&typeof item._supabaseRaw==='object'?item._supabaseRaw:{}),...raw};
    if(has(raw,'id')&&meaningful(raw.id))item.supabaseId=raw.id;
    Object.entries(FIELD_MAP).forEach(([target,source])=>{
      if(!has(raw,source)||!meaningful(raw[source]))return;
      item[target]=normalizeSourceValue(source,raw[source]);
    });
    return item;
  }

  function resolveItem(id){
    try{
      const found=typeof window.obtenerOC==='function'?window.obtenerOC(id):null;
      if(found?.item)return found.item;
      if(found&&typeof found==='object')return found;
    }catch(_error){}
    return null;
  }

  function orderNumber(item,id){
    const candidates=[item?._supabaseRaw?.nro_oc,item?.numeroOC,item?.oc,item?.ocNro,id];
    for(const value of candidates){
      const normalized=String(value??'').trim().replace(/\s+/g,'');
      if(normalized)return normalized;
    }
    return '';
  }

  function renderSignature(item){
    return [
      item?.idObra,item?.numeroOC,item?.tipo,item?.tipoTrabajo,item?.proveedor,item?.sector,
      item?.actaInicio,item?.plazoDias,item?.vencimiento,item?.proximaCertificacion,
      item?.estado,item?.estadoDocumental,item?.saldoRemanente
    ].map(value=>String(value??'')).join('|');
  }

  async function refreshFromSupabase(id,item){
    if(!item||navigator.onLine===false)return;
    const nro=orderNumber(item,id);
    if(!nro)return;
    const previous=remoteState.get(nro)||{};
    if(previous.inFlight)return previous.inFlight;
    if(previous.fetchedAt&&Date.now()-previous.fetchedAt<REMOTE_TTL_MS)return;
    if(typeof window.getSupabaseClient!=='function')return;

    const task=(async()=>{
      try{
        if(typeof window.getUsuarioActual==='function'){
          const user=await Promise.resolve(window.getUsuarioActual());
          if(!user)return;
        }
        const client=window.getSupabaseClient();
        if(!client)return;
        const response=await client.from(TABLE).select('*').eq('nro_oc',nro).limit(1);
        const row=Array.isArray(response?.data)?response.data[0]:null;
        if(response?.error||!row)return;
        const current=resolveItem(id)||item;
        const before=renderSignature(current);
        hydrateItem(current,row);
        remoteState.set(nro,{fetchedAt:Date.now(),inFlight:null});
        try{window.todasLasOC?.invalidarCache?.();}catch(_error){}
        if(before!==renderSignature(current)){
          const hash=String(window.location?.hash||'');
          if(!hash||hash.includes(nro)||hash.includes(String(id??''))){
            queueMicrotask(()=>{try{window.renderFichaOC?.(id);}catch(_error){}});
          }
        }
      }catch(_error){}
      finally{
        const state=remoteState.get(nro)||{};
        if(state.inFlight)remoteState.set(nro,{...state,inFlight:null});
      }
    })();
    remoteState.set(nro,{...previous,inFlight:task});
    return task;
  }

  const baseRender=typeof window.renderFichaOC==='function'?window.renderFichaOC:null;
  if(baseRender&&!baseRender._coiExpedienteHydrationR1){
    const wrapped=function(id){
      const item=resolveItem(id);
      if(item)hydrateItem(item,item._supabaseRaw);
      const result=baseRender.apply(this,arguments);
      if(item)void refreshFromSupabase(id,item);
      return result;
    };
    Object.defineProperty(wrapped,'_coiExpedienteHydrationR1',{value:true});
    window.renderFichaOC=wrapped;
  }

  window.COI_EXPEDIENTE_HYDRATION=Object.freeze({hydrateItem,resolveItem,orderNumber,refreshFromSupabase});
})();
</script>
'''.strip()

if MARKER not in html:
    pos = html.lower().rfind('</body>')
    if pos < 0:
        raise SystemExit('No se encontro </body> en index.html')
    html = html[:pos] + '\n\n' + block + '\n' + html[pos:]
    INDEX.write_text(html, encoding='utf-8')

if html.count(MARKER) != 1:
    raise SystemExit('El bloque de hidratacion debe existir exactamente una vez')
if html.count('localStorage') != local_storage_before:
    raise SystemExit('El fix no debe modificar referencias a localStorage')

TEST.write_text(r'''const { test, expect } = require('@playwright/test');

test.describe('Expediente Digital OC · hidratacion Supabase', () => {
  test('mapea campos snake_case persistidos a los alias que renderiza la Ficha OC', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.COI_EXPEDIENTE_HYDRATION?.hydrateItem === 'function');

    const item = await page.evaluate(() => {
      const target = {};
      window.COI_EXPEDIENTE_HYDRATION.hydrateItem(target, {
        id: 'e71fb7e2-cf11-4718-8cc5-322517d29090',
        nro_oc: '4530008964',
        id_obra: 'OC-4530008964',
        tipo: 'Servicio',
        tipo_trabajo: 'Puertas Automáticas',
        especialidad: 'Puertas Automáticas',
        descripcion: 'PLAN DE MANTENIMIENTO INTEGRAL PREVENTIVO Y MENSUAL DE PUERTAS AUTOMATICAS SOFSE',
        proveedor: 'FEMYP S.R.L',
        sector: 'Plaza Constitución',
        fecha_acta_inicio: '2025-06-30',
        plazo_dias: 400,
        fecha_vencimiento: '2026-08-04',
        proxima_certificacion: '2026-07-05',
        estado_coi: 'En ejecución',
        estado_documental: 'Pendiente',
        saldo_remanente: 16199745.32
      });
      return {
        idObra: target.idObra,
        numeroOC: target.numeroOC,
        oc: target.oc,
        tipo: target.tipo,
        tipoTrabajo: target.tipoTrabajo,
        proveedor: target.proveedor,
        fechaInicio: target.fechaInicio,
        plazoDias: target.plazoDias,
        vencimiento: target.vencimiento,
        proximaCertificacion: target.proximaCertificacion,
        estado: target.estado,
        estadoDocumental: target.estadoDocumental,
        saldoRemanente: target.saldoRemanente,
        supabaseId: target.supabaseId
      };
    });

    expect(item).toEqual({
      idObra: 'OC-4530008964',
      numeroOC: '4530008964',
      oc: '4530008964',
      tipo: 'Servicio',
      tipoTrabajo: 'Puertas Automáticas',
      proveedor: 'FEMYP S.R.L',
      fechaInicio: '2025-06-30',
      plazoDias: 400,
      vencimiento: '2026-08-04',
      proximaCertificacion: '2026-07-05',
      estado: 'En ejecución',
      estadoDocumental: 'Pendiente',
      saldoRemanente: 16199745.32,
      supabaseId: 'e71fb7e2-cf11-4718-8cc5-322517d29090'
    });
  });

  test('no borra un dato derivado existente cuando Supabase no trae valor util', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.COI_EXPEDIENTE_HYDRATION?.hydrateItem === 'function');
    const value = await page.evaluate(() => {
      const target = { estacion: 'Plaza Constitución', proveedor: 'FEMYP S.R.L' };
      window.COI_EXPEDIENTE_HYDRATION.hydrateItem(target, { estacion: null, proveedor: '' });
      return target;
    });
    expect(value.estacion).toBe('Plaza Constitución');
    expect(value.proveedor).toBe('FEMYP S.R.L');
  });
});
''', encoding='utf-8')

for helper in (WORKFLOW, SELF):
    if helper.exists():
        helper.unlink()
