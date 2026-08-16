# RC2 — Runbook de base de datos productiva

Estado: preparado, no ejecutado.

Este runbook documenta la instalación controlada de la renumeración auditable de OC en Supabase producción. No autoriza por sí mismo ninguna ejecución. Toda lectura remota, migración o smoke productivo requiere autorización explícita y confirmación previa del project-ref.

## Guardrails obligatorios

- Project-ref productivo esperado: `ooepgbzqlpjrtpaoqawc`.
- No ejecutar `supabase db reset`.
- No ejecutar `supabase db push` sin demostrar previamente que sólo contiene las dos migraciones aprobadas.
- No usar `service_role` desde el frontend ni registrar tokens.
- Detenerse ante cualquier objeto, columna, versión o project-ref inesperado.
- Aplicar las migraciones exclusivamente en este orden:
  1. `20260813024545_renumerar_oc.sql`
  2. `20260813033959_fix_renumerar_oc_servicios_um.sql`

## Artefactos aprobados

| Migración | SHA256 |
|---|---|
| `20260813024545_renumerar_oc.sql` | `7DBC4EE4C651D4FEC6B9E335ACB1611A175ED72AAD8E321BB843403320BE3454` |
| `20260813033959_fix_renumerar_oc_servicios_um.sql` | `E226601630ACE99BDC0CD88154A0B183689197F112A09E3B0C7D7295208CDF39` |

Ambas están versionadas por el commit `53117c1`.

## Auditoría técnica

### A. Objetos creados o modificados

La primera migración:

- reemplaza `public.coi_position_identity_guard()`;
- crea o reemplaza `public.coi_renumerar_oc(uuid,text,text)` como `SECURITY DEFINER`;
- fija `search_path = public, pg_temp`;
- revoca ejecución a `public` y `anon` y concede ejecución a `authenticated`;
- conserva el UUID maestro y sincroniza el `nro_oc` denormalizado;
- escribe historial funcional y auditoría inmutable al ejecutar la RPC.

La segunda migración reemplaza la misma RPC con su definición final. Corrige específicamente `public.coi_servicios_tecnicos_um`, que posee `nro_oc` pero no `orden_id`, y recupera filas legacy con `orden_id IS NULL` en las tablas modernas.

No crean tablas, columnas, índices ni políticas RLS nuevas.

### B. Dependencias

Funciones requeridas:

- `public.coi_assert_role(text[])`;
- `public.coi_normalize_order_number(text)`;
- `auth.uid()` y `auth.jwt()`.

Tablas requeridas:

- `coi_ordenes`;
- `coi_ordenes_estaciones`;
- `coi_posiciones_oc`;
- `coi_certificaciones`;
- `coi_consumos_posicion`;
- `coi_documentos_oc`;
- `coi_links_documentales`;
- `coi_observaciones_oc`;
- `coi_alertas`;
- `coi_historial_oc`;
- `coi_servicios_tecnicos_um`;
- `coi_operaciones_auditoria`.

El trigger existente de `coi_posiciones_oc` debe continuar enlazado a `coi_position_identity_guard()`.

### C. Idempotencia

- El DDL usa `create or replace function`, `revoke`, `grant` y `comment`; repetir las migraciones deja la definición final equivalente.
- Cada archivo está envuelto en una transacción.
- La RPC tiene idempotencia funcional cuando el número nuevo coincide con el vigente: retorna `sin_cambios=true` antes de mutar datos.
- No debe considerarse válida la primera migración por sí sola. La segunda es la definición final obligatoria.

### D. Orden obligatorio

El orden por timestamp es obligatorio. La primera migración actualiza además el guard de posiciones; la segunda reemplaza la RPC defectuosa para la tabla UM legacy. Aplicar sólo la segunda omitiría el guard actualizado; aplicar sólo la primera dejaría una definición incompatible con la estructura real de UM.

### E. Estado actual de producción

No confirmado: M7A no ejecutó consultas ni SQL contra Supabase producción. La presencia total o parcial debe determinarse con las consultas read-only siguientes antes de cualquier despliegue.

### F. Preflight productivo read-only

Ejecutar sólo después de confirmar visualmente y por CLI que el proyecto objetivo es `ooepgbzqlpjrtpaoqawc`.

```sql
-- 1. Ledger de migraciones.
select *
from supabase_migrations.schema_migrations
where version in ('20260813024545', '20260813033959')
order by version;

-- 2. Dependencias funcionales y estado actual de las funciones objetivo.
select
  to_regprocedure('public.coi_assert_role(text[])') as assert_role,
  to_regprocedure('public.coi_normalize_order_number(text)') as normalize_order_number,
  to_regprocedure('public.coi_position_identity_guard()') as position_guard,
  to_regprocedure('public.coi_renumerar_oc(uuid,text,text)') as renumber_rpc;

-- 3. Columnas mínimas requeridas. El resultado debe ser cero filas.
with required(table_name, column_name) as (
  values
    ('coi_ordenes','id'), ('coi_ordenes','nro_oc'),
    ('coi_ordenes','actualizado_por'), ('coi_ordenes','fecha_actualizacion'),
    ('coi_ordenes_estaciones','orden_id'), ('coi_ordenes_estaciones','nro_oc'),
    ('coi_posiciones_oc','orden_id'), ('coi_posiciones_oc','nro_oc'),
    ('coi_certificaciones','orden_id'), ('coi_certificaciones','nro_oc'),
    ('coi_consumos_posicion','orden_id'), ('coi_consumos_posicion','nro_oc'),
    ('coi_documentos_oc','orden_id'), ('coi_documentos_oc','nro_oc'),
    ('coi_links_documentales','orden_id'), ('coi_links_documentales','nro_oc'),
    ('coi_observaciones_oc','orden_id'), ('coi_observaciones_oc','nro_oc'),
    ('coi_alertas','orden_id'), ('coi_alertas','nro_oc'),
    ('coi_historial_oc','orden_id'), ('coi_historial_oc','nro_oc'),
    ('coi_historial_oc','tipo_evento'), ('coi_historial_oc','campo_modificado'),
    ('coi_historial_oc','valor_anterior'), ('coi_historial_oc','valor_nuevo'),
    ('coi_historial_oc','motivo'), ('coi_historial_oc','usuario_email'),
    ('coi_historial_oc','creado_por'),
    ('coi_servicios_tecnicos_um','nro_oc'),
    ('coi_operaciones_auditoria','usuario_id'),
    ('coi_operaciones_auditoria','usuario_email'),
    ('coi_operaciones_auditoria','rol'),
    ('coi_operaciones_auditoria','accion'),
    ('coi_operaciones_auditoria','entidad'),
    ('coi_operaciones_auditoria','registro_id'),
    ('coi_operaciones_auditoria','nro_oc'),
    ('coi_operaciones_auditoria','datos_anteriores'),
    ('coi_operaciones_auditoria','datos_nuevos'),
    ('coi_operaciones_auditoria','contexto')
)
select required.*
from required
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = required.table_name
 and c.column_name = required.column_name
where c.column_name is null
order by required.table_name, required.column_name;

-- 4. Estructura legacy UM. Debe existir nro_oc; orden_id puede y normalmente debe faltar.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'coi_servicios_tecnicos_um'
  and column_name in ('nro_oc','orden_id')
order by column_name;

-- 5. Trigger de identidad de posiciones. Debe devolver al menos un trigger enlazado al guard.
select tgname, pg_get_triggerdef(oid, true) as definition
from pg_trigger
where tgrelid = 'public.coi_posiciones_oc'::regclass
  and not tgisinternal
  and pg_get_triggerdef(oid, true) ilike '%coi_position_identity_guard%';

-- 6. Colisiones de números normalizados. Debe devolver cero filas.
select public.coi_normalize_order_number(nro_oc) as nro_normalizado, count(*)
from public.coi_ordenes
group by public.coi_normalize_order_number(nro_oc)
having count(*) > 1;

-- 7. Referencias modernas inconsistentes. Todos los conteos deben ser cero.
select 'coi_ordenes_estaciones' as tabla, count(*) as inconsistencias
from public.coi_ordenes_estaciones x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_posiciones_oc', count(*)
from public.coi_posiciones_oc x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_certificaciones', count(*)
from public.coi_certificaciones x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_consumos_posicion', count(*)
from public.coi_consumos_posicion x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_documentos_oc', count(*)
from public.coi_documentos_oc x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_links_documentales', count(*)
from public.coi_links_documentales x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_observaciones_oc', count(*)
from public.coi_observaciones_oc x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_alertas', count(*)
from public.coi_alertas x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc)
union all
select 'coi_historial_oc', count(*)
from public.coi_historial_oc x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and (o.id is null or x.nro_oc is distinct from o.nro_oc);

-- 8. Definición/ACL actual para determinar si producción ya posee una implementación equivalente.
select
  p.oid::regprocedure as function_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  md5(pg_get_functiondef(p.oid)) as definition_md5,
  position('coi_servicios_tecnicos_um' in pg_get_functiondef(p.oid)) > 0 as handles_legacy_um,
  position('x.orden_id is null' in pg_get_functiondef(p.oid)) > 0 as handles_null_order_id
from pg_proc p
where p.oid in (
  to_regprocedure('public.coi_position_identity_guard()'),
  to_regprocedure('public.coi_renumerar_oc(uuid,text,text)')
);
```

Además, antes de aplicar se deben exportar y conservar fuera del repositorio:

```sql
select p.oid::regprocedure, pg_get_functiondef(p.oid), p.proacl, p.proconfig
from pg_proc p
where p.oid in (
  to_regprocedure('public.coi_position_identity_guard()'),
  to_regprocedure('public.coi_renumerar_oc(uuid,text,text)')
);
```

Ese snapshot es el respaldo de definiciones y permisos. No debe contener tokens ni credenciales.

## Procedimiento de aplicación futura

1. Confirmar autorización de producción y ventana de mantenimiento.
2. Confirmar project-ref `ooepgbzqlpjrtpaoqawc` por dos medios independientes.
3. Verificar nuevamente los SHA256 de ambos SQL.
4. Ejecutar el preflight read-only completo y archivar sus resultados.
5. Detenerse si hay columnas faltantes, duplicados normalizados, referencias inconsistentes o una historia de migraciones inesperada.
6. Crear backup lógico productivo y snapshot de funciones/ACL.
7. Aplicar exactamente `20260813024545_renumerar_oc.sql`.
8. Aplicar inmediatamente `20260813033959_fix_renumerar_oc_servicios_um.sql`.
9. No exponer todavía el frontend RC2.
10. Ejecutar las validaciones post-migración read-only.
11. Autorizar por separado un smoke funcional productivo controlado.
12. Sólo después desplegar el frontend RC2.

## G. Validaciones post-migración

```sql
-- Ambas versiones deben figurar una vez.
select *
from supabase_migrations.schema_migrations
where version in ('20260813024545', '20260813033959')
order by version;

-- Contrato final de seguridad y cuerpo de la RPC.
select
  p.oid::regprocedure as function_name,
  p.prosecdef as security_definer,
  p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  position('coi_assert_role' in pg_get_functiondef(p.oid)) > 0 as checks_admin_role,
  position('coi_servicios_tecnicos_um' in pg_get_functiondef(p.oid)) > 0 as handles_legacy_um,
  position('x.orden_id is null' in pg_get_functiondef(p.oid)) > 0 as handles_null_order_id
from pg_proc p
where p.oid = to_regprocedure('public.coi_renumerar_oc(uuid,text,text)');

-- El guard debe seguir vinculado.
select tgname, pg_get_triggerdef(oid, true)
from pg_trigger
where tgrelid = 'public.coi_posiciones_oc'::regclass
  and not tgisinternal
  and pg_get_triggerdef(oid, true) ilike '%coi_position_identity_guard%';
```

Resultado esperado para la RPC: `security_definer=true`, `anon_execute=false`, `authenticated_execute=true`, `checks_admin_role=true`, `handles_legacy_um=true` y `handles_null_order_id=true`. Si `PUBLIC` conservara ejecución, `anon_execute` también resultaría verdadero por herencia, por lo que ese control cubre ambos casos.

El smoke de renumeración productivo no forma parte de estas consultas y requiere una autorización separada, una OC de prueba explícita y recuperación `try/finally`.

## H. Riesgo y rollback

- Antes de ejecutar la RPC, el rollback de esquema consiste en restaurar dentro de una transacción las definiciones, propietarios, ACL, comentarios y `search_path` capturados en el snapshot previo.
- Después de una renumeración real no se debe borrar historial ni auditoría, ni intentar un rollback SQL ciego. La recuperación del número debe realizarse mediante la propia RPC, con motivo auditable, o mediante un forward-fix aprobado.
- Si falla el frontend pero las migraciones pasaron, revertir el commit/deploy frontend es suficiente; las funciones son aditivas y el acceso permanece restringido.
- Si el preflight o una migración falla dentro de su transacción, no continuar con el segundo paso y conservar toda la evidencia.
- La mayor superficie de riesgo es la sincronización de referencias legacy por `nro_oc`; por eso duplicados e inconsistencias deben ser cero antes de aplicar.

## I. Dependencia del frontend RC2

El HTML puede cargar sin la RPC, pero la funcionalidad RC2 de renumeración no cumple su contrato y mostrará error si `coi_renumerar_oc(uuid,text,text)` no está instalada con la definición final. Por lo tanto, para un release RC2 completo, ambas migraciones son prerrequisito obligatorio del despliegue frontend.

Secuencia recomendada: preflight → backup → migraciones → validación DB → smoke autorizado → deploy frontend → smoke productivo read-only.
