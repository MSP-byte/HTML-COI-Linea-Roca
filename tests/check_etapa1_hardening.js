const fs = require('fs');
const assert = (cond,msg)=>{if(!cond){console.error('FAIL:',msg);process.exitCode=1}else console.log('OK:',msg)};
const html=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('supabase/migrations/202609150001_etapa1_acta_inicio_conciliacion.sql','utf8');
const e1=(html.match(/<script id="coi-etapa1-pipeline-contractual">([\s\S]*?)<\/script>/)||[])[1]||'';
assert(e1.includes('actualizarEstadoDocumentalDesdePasoContractual('),'E1 usa helper canónico RPC-returning');
assert(!/window\.confirmarEtapaCircuitoOC\s*\(/.test(e1),'E1 no usa wrapper legacy confirm/prompt');
assert(e1.includes('data-etapa1-orden-id'),'render vinculado al UUID maestro');
assert(e1.includes('modalActual.token===contexto.token'),'respuesta async valida token inmutable');
assert(e1.includes("orden.actaInicio")&&e1.includes("orden.fechaInicio"),'aliases Acta legacy cubiertos');
assert(e1.includes("Observación circuito administrativo"),'observaciones posteriores integradas');
assert(e1.includes("Conciliación Acta de Inicio"),'conflicto Acta se reconstruye desde historial');
assert(e1.includes('ultimaConfirmacion(historial, CODIGO_TRANSVERSAL)'),'transversal usa último evento');
assert(html.includes('window.ESTADO_FINALIZADA_SALDO_REMANENTE=ESTADO_FINALIZADA_SALDO_REMANENTE'),'saldo remanente exportado explícitamente');
assert(/replace\(\/\[º°\]\//.test(e1)||e1.includes('normalizarTextoEstado'),'normalización º/° canónica');
assert(sql.includes("v_codigo in ('ejecucion','finalizada','finalizada_actas','finalizada_saldo_remanente')"),'gate server-side cubre etapa 2');
assert(sql.includes("message='COI_ACTA_INICIO_REQUIRED'")||sql.includes("message = 'COI_ACTA_INICIO_REQUIRED'"),'RPC falla cerrada sin Acta');
assert(sql.includes('not v_seen'),'reingreso histórico no se trata como confirmación nueva');
assert(sql.includes("'REGISTRAR_FECHA_ACTA_INICIO_ETAPA1'"),'fecha Acta automática audita before/after');
assert(sql.includes("'Conciliación Acta de Inicio'"),'conflicto queda persistido en historial');
assert(sql.includes("when 'cancelada_suspendida'"),'transversal permanece permitido por RPC');

/* Integración en la Ficha. El renderer puede estar perfecto y la pestaña
   Contractual quedar vacía: la regresión que motivó estos controles retiraba
   el circuito legacy por la sola existencia de window.__COI_ETAPA1_RENDER__,
   sin montar nada en su lugar. */
assert(!/if\(typeof window\.__COI_ETAPA1_RENDER__==='function'\)\{candidates\.forEach\(node=>node\.remove\(\)\);return null;\}/.test(html),
  'la existencia del renderer no puede por si sola retirar la representación legacy');
assert(/function mountEtapa1Pipeline\(/.test(html),'la Ficha monta el pipeline E1 explícitamente');
assert(/const mounted=host\.querySelector\('#etapa1PipelineContractual'\)/.test(html)&&/body\.contains\(mounted\)/.test(html),
  'el montaje se verifica contra el DOM real de la Ficha');
assert(/const etapa1=mountEtapa1Pipeline\(oc,contractual\);[\s\S]{0,120}if\(etapa1\)\{candidates\.forEach\(node=>node\.remove\(\)\);return etapa1;\}/.test(html),
  'el legacy se retira sólo después de montar el pipeline nuevo');
assert(/if\(etapa1\)\{[\s\S]{0,120}\}\s*if\(typeof window\.renderCircuitoAdministrativoOC!=='function'\)return null;/.test(html),
  'si el renderer nuevo falla, Contractual conserva el circuito legacy');
assert(/function ensureContractualMounted\(/.test(html)&&/function wrapSubmodulo\(/.test(html),
  'la navegación a Contractual reinyecta el circuito si falta');

if(process.exitCode) process.exit(process.exitCode);
console.log('Etapa 1 hardening: todos los controles OK');
