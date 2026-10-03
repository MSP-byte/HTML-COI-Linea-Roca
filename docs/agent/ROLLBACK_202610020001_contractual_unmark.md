# Rollback — 202610020001_contractual_unmark

## Alcance

Esta guía revierte la **capacidad de crear nuevas anulaciones contractuales**.
No elimina ni reescribe filas existentes de `coi_historial_oc` ni de
`coi_operaciones_auditoria`.

Migración afectada:

`supabase/migrations/202610020001_contractual_unmark.sql`

## Precondiciones

1. Detener nuevas anulaciones desde la UI. El frontend del PR #115 oculta
   **DESMARCAR HITO** cuando la RPC no existe.
2. Confirmar si ya existen filas con
   `tipo_evento = 'Anulación circuito administrativo'`.
3. Si existen, **no volver a una versión de frontend anterior al PR #115**:
   esos frontends no conocen la proyección de historial activo y podrían volver
   a mostrar como vigentes confirmaciones que ya fueron anuladas.
4. Guardar evidencia de conteos y OCs afectadas. No borrar filas de auditoría.

## SQL de rollback del schema

Ejecutar primero en STAGING y validar; luego en PRODUCCIÓN sólo con autorización.

```sql
begin;

revoke all on function public.coi_anular_etapa_circuito_v1(uuid,text,text)
  from public, anon, authenticated;

drop function if exists public.coi_anular_etapa_circuito_v1(uuid,text,text);

-- La policy restrictiva se conserva deliberadamente aunque se quite la RPC:
-- así ningún cliente puede fabricar anulaciones directas sin snapshot/auditoría.
-- NO ejecutar DROP POLICY coi_historial_anulacion_rpc_only_v1.
commit;
```

El rollback **no** borra las filas de anulación ya registradas. El frontend
actual continúa interpretándolas correctamente y, al no encontrar la RPC,
oculta la acción de desmarcado.

## Validación posterior

- `to_regprocedure('public.coi_anular_etapa_circuito_v1(uuid,text,text)')`
  debe devolver NULL;
- debe seguir existiendo la policy restrictiva `coi_historial_anulacion_rpc_only_v1`;
- los hitos ya anulados deben seguir proyectándose como no vigentes;
- **DESMARCAR HITO** no debe mostrarse;
- confirmar hitos por `coi_confirmar_etapa_circuito_v3` y agregar
  observaciones deben seguir funcionando.

## Reaplicación

La migración es idempotente: para restaurar la función y el grant (la policy de seguridad permanece instalada) se
puede volver a ejecutar el SQL versionado
`202610020001_contractual_unmark.sql`, primero en STAGING y luego en
PRODUCCIÓN con autorización explícita.
