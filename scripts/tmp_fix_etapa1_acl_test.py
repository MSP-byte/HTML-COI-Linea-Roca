from pathlib import Path
p=Path('tests/check_etapa1_pipeline_contractual.js')
s=p.read_text(encoding='utf-8')
old="""  // Y la RPC publica sigue siendo invocable por el rol autorizado.
  const { rows: aclRpc } = await db.query(`
    select coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) auth_exec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'coi_confirmar_etapa_circuito_v2'`);
  check(aclRpc[0].auth_exec === true,
    'coi_confirmar_etapa_circuito_v2 tiene que seguir siendo ejecutable por authenticated');
  // El camino autorizado sigue funcionando pese al revoke: la RPC es SECURITY
  // DEFINER y el dueño conserva EXECUTE. Ya se ejercito arriba en los casos A-E.
"""
new="""  // Desde 202609170001 el único writer de cliente es v3. v2 queda como
  // implementación interna SECURITY DEFINER y no puede ser invocada por authenticated.
  const { rows: aclRpc } = await db.query(`
    select p.proname,
           coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) auth_exec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('coi_confirmar_etapa_circuito_v2','coi_confirmar_etapa_circuito_v3')`);
  const aclPorNombre = Object.fromEntries(aclRpc.map((r) => [r.proname, r.auth_exec]));
  check(aclPorNombre.coi_confirmar_etapa_circuito_v3 === true,
    'coi_confirmar_etapa_circuito_v3 tiene que ser ejecutable por authenticated');
  check(aclPorNombre.coi_confirmar_etapa_circuito_v2 === false,
    'coi_confirmar_etapa_circuito_v2 NO puede seguir ejecutable por authenticated');
  // El dueño conserva acceso interno a v2; los casos A-E la ejercitan como
  // regresión de la conciliación legacy sin reabrirla al cliente.
"""
if old not in s:
    raise SystemExit('bloque ACL viejo no encontrado')
p.write_text(s.replace(old,new,1),encoding='utf-8')
