const fs=require('fs');
const assert=require('assert');
// PR81: contrato final de fecha efectiva, reingresos y compatibilidad histórica.
const html=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('supabase/migrations/202609170001_etapa1_fecha_rpc_v3_hardening.sql','utf8');
assert(html.includes("timeZone:'America/Argentina/Buenos_Aires'"),'fallback legacy debe usar Buenos Aires');
assert(html.includes('ordinalDiaBuenosAires'),'días deben calcularse por día calendario');
/* MODIFICADO (modelo de 10 hitos). ANTES: exigía `diasDeHito(estado, ult)`
   en el resumen (días contra el hito 1-8 más avanzado). AHORA: el resumen es
   global y la tarjeta vigente y el resumen comparten la MISMA fuente:
   estado.diasVigente (HOY - fecha efectiva del último ingreso real). */
assert(html.includes('const diasResumen = diasEstadoVigente(estado);') && html.includes('return estado.diasVigente;'),'resumen debe compartir lógica de tarjeta');
assert(html.includes('confirmacionVigente'),'reingreso debe distinguir edición vigente');
assert(!sql.includes('coi_confirmar_etapa_circuito_v2(p_orden_id'),'v3 no debe delegar en v2');
assert(sql.includes('EDITAR_FECHA_EFECTIVA_CIRCUITO'),'edición idempotente debe auditarse');
assert(sql.includes('set fecha_efectiva=v_fecha'),'edición idempotente debe persistir');
assert(sql.includes("revoke all on function public.coi_confirmar_etapa_circuito_v2(uuid,text,text) from authenticated"),'v2 no debe ser writer cliente');
assert(sql.includes("message='COI_STAGE_NOT_APPLICABLE_TO_TYPE'"),'Obra no admite saldo remanente');
assert(sql.includes('v_fecha date := p_fecha_efectiva'),'fecha omitida no debe convertirse a hoy al entrar a v3');
assert(sql.includes('v_idempotente and p_fecha_efectiva is null'),'reapertura idempotente sin fecha no debe reconciliar Acta');
assert(sql.includes("v_conflicto.motivo,'')))='conflicto'"),'resolución de conflicto debe depender del último marcador persistido');
assert(html.includes('!etapaCanonica && estado.hitoActual'),'hitoActual sólo es fallback sin estado canónico');
/* MODIFICADO (T18). ANTES: `const desdeDia=ordinalDiaBuenosAires` en la
   comparación hito N / N+1. AHORA: la secuencia de transiciones y sus
   duraciones se ordenan y miden por día administrativo BA. */
assert(html.includes('const da = ordinalDiaBuenosAires(a.dia), db = ordinalDiaBuenosAires(b.dia);'),'orden entre hitos debe comparar días administrativos');
assert(html.includes('function fusionarHistorialCircuitoConfirmado') && html.includes('const ids=new Set(confirmadas.map') && html.includes('fusionarHistorialCircuitoConfirmado(nro,result.data?.historial)') && html.includes('window.__COI_CIRCUITO_CACHE_MERGE__=fusionarHistorialCircuitoConfirmado') && html.includes('window.__COI_CIRCUITO_CACHE_MERGE__(nro,rows)'), 'ambos writers contractuales deben converger en el merge canónico por id');
assert(sql.includes("translate(upper(trim(coalesce(v_current,'')))"),'estado vigente legacy debe normalizarse antes de decidir edición/reingreso');
assert(html.includes('const eventoVigente=confirmacionVigente'),'edición vigente debe resolver la última confirmación del código');
assert(html.includes('fechaInputEvento(eventoVigente)'),'modal vigente debe precargar la fila que v3 realmente edita');
console.log('Etapa1 fecha/RPC v3 hardening: OK');
