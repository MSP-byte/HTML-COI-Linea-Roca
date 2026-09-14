from pathlib import Path
import re

path = Path('index.html')
text = path.read_text(encoding='utf-8')


def sub_once(pattern, new, label, flags=re.S):
    global text
    updated, count = re.subn(pattern, new, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: se esperaba 1 coincidencia y hubo {count}')
    text = updated


schemas = """  const CERTIFICACION_SCHEMAS=Object.freeze({
    Obra:Object.freeze({
      fields:['id_obra','tipo_servicio','acta_medicion_nro','proxima_acta_medicion_fecha','nro_oc','fecha_inicio','fecha_fin','item_nro','descripcion','cantidad','unidad_medida','servicio_ejecutado_anterior','servicio_ejecutado_periodo','servicio_ejecutado_acumulado','aux_porcentaje','actores_firmantes','ejecutado_100','posicion','nro_hes','nro_if','anio'],
      headers:['ID OBRA','TIPO DE SERVICIO','ACTA MEDICION N°','PROX ACTA MED FECHA','OC','FECHA INICIO','FECHA FIN','ITEM_NRO','Descripcion','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE','SERV EJEC. ACUM','AUX %','ACTORES FIRMANTES','EJECUTADO 100%','POS SAP','N° HES','N° IF','AÑO']
    }),
    Servicio:Object.freeze({
      fields:['acta_medicion_nro','proxima_acta_medicion_fecha','nro_oc','fecha_inicio','fecha_fin','item_nro','descripcion','posicion','nro_hes','nro_if','cantidad','unidad_medida','servicio_ejecutado_anterior','servicio_ejecutado_periodo','servicio_ejecutado_acumulado','aux_porcentaje','proveedor','tipo_um','actores_firmantes','ejecutado_100','anexo_fotografia_actas','anio'],
      headers:['ACTA MEDICION N°','PROX ACTA MED. FECHA','OC','FECHA INICIO','FECHA FIN','ITEM_NRO','Descripcion','POS SAP','N° HES','N° IF','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE','SERV EJEC. ACUM','AUX %','PROVEEDOR','TIPO_UM','ACTORES FIRMANTES','EJECUTADO 100%','ANEXO FOTOGRAFIA ACTAS','AÑO']
    })
  });
  let certificacionTipoEsquemaActivo='Servicio';
  let CERTIFICACION_FIELDS=[...CERTIFICACION_SCHEMAS.Servicio.fields];
  let CERTIFICACION_HEADERS=[...CERTIFICACION_SCHEMAS.Servicio.headers];
  const certificacionBorradoresPorTipo={Obra:[],Servicio:[]};"""
sub_once(r"\s*const CERTIFICACION_FIELDS=\[.*?\];\s*const CERTIFICACION_HEADERS=\[.*?\];", '\n' + schemas, 'schemas')

helpers = """  const GENERATED_FIELDS=new Set(['servicio_ejecutado_acumulado','aux_porcentaje']);

  function renderEncabezadoCertificacion(){
    const row=document.querySelector('#panelCargaCertificacionR18 .carga-certificacion-table thead tr');
    if(row)row.innerHTML=`${CERTIFICACION_HEADERS.map(header=>`<th>${escapeHTML(header)}</th>`).join('')}<th>VALIDACIÓN</th>`;
    const badge=byId('cargaCertificacionTipoR18');
    if(badge)badge.textContent=`Estructura activa: ${certificacionTipoEsquemaActivo.toUpperCase()}`;
  }

  function sincronizarEsquemaCertificacion(tipo=tipoCargaActivo(),{preservar=true}={}){
    const next=tipo==='Obra'?'Obra':'Servicio';
    const body=byId('cargaCertificacionBodyR18');
    if(next===certificacionTipoEsquemaActivo){renderEncabezadoCertificacion();return;}
    if(body&&preservar){
      certificacionBorradoresPorTipo[certificacionTipoEsquemaActivo]=[...body.querySelectorAll('tr')].map(row=>leerFilaCertificacion(row));
    }
    certificacionTipoEsquemaActivo=next;
    CERTIFICACION_FIELDS=[...CERTIFICACION_SCHEMAS[next].fields];
    CERTIFICACION_HEADERS=[...CERTIFICACION_SCHEMAS[next].headers];
    renderEncabezadoCertificacion();
    if(body){
      const drafts=certificacionBorradoresPorTipo[next]||[];
      body.innerHTML=(drafts.length?drafts:[{}]).map(filaCertificacionHTML).join('');
      body.querySelectorAll('tr').forEach(row=>recalcularFilaCertificacion(row,{actualizarAnio:true}));
      validarFilasCargaCertificacion();
      actualizarEstadoCargaCertificacion();
    }
  }

  const certificacionesCacheOC=new Map();"""
sub_once(r"\s*const GENERATED_FIELDS=new Set\(\['servicio_ejecutado_acumulado','aux_porcentaje'\]\);\s*const certificacionesCacheOC=new Map\(\);", '\n' + helpers, 'schema sync helpers')

sub_once(
    r"(\s*orden_id:row\.orden_id\?\?null,)\s*(tipo_servicio:clean\(campoHistorico\(row,\['tipo_servicio','tipoServicio','tipo','TIPO_DE_SERVICIO'\]\)\),)",
    r"\1\n      id_obra:clean(campoHistorico(row,['id_obra','idObra','ID_OBRA'])),\n      proveedor:clean(campoHistorico(row,['proveedor','PROVEEDOR'])),\n      \2",
    'normalizer id/proveedor')
sub_once(
    r"(\s*descripcion:clean\(campoHistorico\(row,\['descripcion','DESCRIPCION'\]\)\),)\s*posicion:clean\(campoHistorico\(row,\['posicion','POSICION'\]\)\),\s*(cantidad,)",
    r"\1\n      posicion:clean(campoHistorico(row,['posicion','POSICION','pos_sap','POS_SAP'])),\n      nro_hes:clean(campoHistorico(row,['nro_hes','nroHes','NRO_HES','N° HES'])),\n      nro_if:clean(campoHistorico(row,['nro_if','nroIf','NRO_IF','N° IF'])),\n      \2",
    'normalizer hes/if')
sub_once(
    r"(\s*orden_id:order\?\.orden_id\|\|data\.orden_id\|\|null,)\s*(nro_oc:normalizarNroOCCertificacion\(normalized\.nro_oc\),)",
    r"\1\n      id_obra:normalized.id_obra||order?.id_obra||null,\n      proveedor:normalized.proveedor||order?.proveedor||null,\n      \2",
    'payload id/proveedor')
sub_once(
    r"(\s*descripcion:normalized\.descripcion\|\|null,)\s*(posicion:normalized\.posicion\|\|null,)\s*(cantidad:normalized\.cantidad,)",
    r"\1\n      \2\n      nro_hes:normalized.nro_hes||null,\n      nro_if:normalized.nro_if||null,\n      \3",
    'payload hes/if')
sub_once(
    r'<div class="carga-certificacion-toolbar"><div><h3>Carga Certificación</h3><p>Copie y pegue directamente desde Excel\. La OC se valida contra public\.coi_ordenes y la certificación se vincula mediante nro_oc \+ orden_id\.</p></div><div class="carga-certificacion-actions">',
    '<div class="carga-certificacion-toolbar"><div><h3>Carga Certificación</h3><p>Copie y pegue directamente desde Excel. La estructura cambia automáticamente según Carga activa: Obra o Servicio.</p><span id="cargaCertificacionTipoR18" class="quick-load-badge">Estructura activa: ${certificacionTipoEsquemaActivo.toUpperCase()}</span></div><div class="carga-certificacion-actions">',
    'panel badge', flags=0)
sub_once(
    r"(const type=tipoCargaActivo\(\);\s*const available=type==='Obra'\|\|type==='Servicio';)\s*(tabs\.hidden=!available;)",
    r"\1\n    if(available)sincronizarEsquemaCertificacion(type);\n    \2",
    'visibility schema sync')

path.write_text(text, encoding='utf-8')
print('H17 patch aplicado correctamente')
