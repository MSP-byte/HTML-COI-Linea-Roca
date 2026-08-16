# RC2 — Runbook final de salida a producción

**Estado:** rollout productivo iniciado de forma controlada el 16/08/2026. Backup y preflight aprobados. Migraciones `202608100001` a `202608100005` aplicadas correctamente; la migración `202608110006` se detuvo y revirtió al detectar que la instalación histórica tenía OCs sin filas materializadas en `coi_ordenes_estaciones`. Se incorporó el backfill forward-only `202608110005_backfill_principal_stations.sql`; no continuar con `006` hasta que ese backfill tenga Quality Gate verde y haya sido validado en producción.

Este documento es la secuencia operativa final para llevar RC2 a Supabase producción y luego promover el frontend.

## 1. Guardrails obligatorios

- Project-ref productivo esperado: `ooepgbzqlpjrtpaoqawc`.
- Project-ref STAGING conocido: `brmrroikctfbtzwfewan`.
- Antes de cualquier escritura, confirmar el project-ref.
- No ejecutar `supabase db reset --linked`.
- No usar `service_role` en frontend ni registrar secretos.
- No hacer `git push --force`, `git reset --hard` ni limpieza destructiva.
- Si una consulta preflight devuelve una inconsistencia inesperada: **STOP**.
- La base de datos debe promoverse **antes** que el frontend productivo, porque RC2 consume contratos/RPC nuevos.

## 2. Estado técnico certificado en rama RC2

Rama: `release/rc2-estabilizacion`.

El Quality Gate del PR valida sintaxis HTML/CSS/JS, tests estáticos y de regresión, migraciones PostgreSQL en PGlite, idempotencia financiera, compatibilidad controlada de writers legacy, guards de renumeración y Chromium E2E.

La revisión del PR incorporó hardening forward-only para canonicalización de `nro_oc`, colisiones modernas/legacy, sincronización concurrente de hijos, UM legacy, historial de renumeración, deadlocks financieros, reconciliación idempotente tras logout/red, writers ejecutivos legacy bajo RLS y aislamiento STAGING/PROD.

Durante el preflight productivo se observó una particularidad histórica adicional: las 34 OCs tenían `estacion` informada en `coi_ordenes`, pero `coi_ordenes_estaciones` estaba vacía. El backfill `202608110005_backfill_principal_stations.sql` materializa exclusivamente la estación principal faltante desde esos datos canónicos y aborta ante cualquier caso ambiguo.

## 3. Orden completo de migraciones RC2

La instalación productiva debe respetar **estrictamente este orden**:

1. `202608100001_preflight_reports.sql`
2. `202608100002_financial_ledger.sql`
3. `202608100003_atomic_order_update.sql`
4. `202608100004_rls_policies.sql`
5. `202608100005_operational_integrity.sql`
6. `202608110005_backfill_principal_stations.sql`
7. `202608110006_release_candidate_hardening.sql`
8. `20260813024545_renumerar_oc.sql`
9. `20260813033959_fix_renumerar_oc_servicios_um.sql`
10. `202608160010_rc2_review_hardening.sql`
11. `202608160020_rc2_concurrency_and_legacy.sql`
12. `202608160030_rc2_legacy_writers_and_recovery.sql`

**No aplicar sólo una migración intermedia.** La definición final del contrato RC2 resulta de la secuencia completa.

## 4. Preflight productivo — sólo lectura

Antes del rollout se verificó:

- 34 OCs productivas;
- 0 duplicados por `nro_oc` normalizado;
- 0 OCs con número inválido/no canónico;
- 0 dependencias huérfanas en estaciones/posiciones;
- `coi_servicios_tecnicos_um` legacy posee `nro_oc` y no `orden_id`;
- 34/34 OCs poseen `estacion` no vacía;
- `ramal` y `sector` pueden ser nulos sin bloquear el backfill.

Consultas base de referencia:

```sql
select count(*) as ordenes from public.coi_ordenes;
select count(*) as estaciones from public.coi_ordenes_estaciones;
select count(*) as posiciones from public.coi_posiciones_oc;

select regexp_replace(upper(trim(nro_oc)), '[^0-9A-Z]', '', 'g') as nro_normalizado,
       count(*)
from public.coi_ordenes
group by 1
having count(*) > 1;

select id, nro_oc
from public.coi_ordenes
where nro_oc is null
   or trim(nro_oc) = ''
   or nro_oc ~ '[^0-9]'
order by nro_oc;
```

Si el esquema productivo difiere de lo esperado, no improvisar reparación en caliente: registrar el resultado y detener el despliegue.

## 5. Backup previo

Backup lógico productivo generado y verificado fuera del repositorio en:

`C:\Users\Casa\Documents\COI-PROD-BACKUP-2026-08-16`

Contiene `roles.sql`, `schema.sql`, `data.sql` y ZIP, todos con tamaño mayor a cero y checksums SHA256 calculados localmente. No subir estos archivos a GitHub.

## 6. Aplicación de migraciones

Estado del rollout:

- `202608100001` — PASS
- `202608100002` — PASS
- `202608100003` — PASS
- `202608100004` — PASS
- `202608100005` — PASS
- `202608110005_backfill_principal_stations` — pendiente de Quality Gate/aplicación
- `202608110006` — intento previo NO aplicado: abortó por precondición y la transacción se revirtió
- restantes — pendientes

Después del backfill comprobar exactamente una asociación principal por OC antes de reintentar `006`.

## 7. Smoke de base inmediatamente posterior

Validar antes de tocar `main`:

```sql
select to_regprocedure('public.coi_renumerar_oc(uuid,text,text)');
select to_regprocedure('public.coi_actualizar_orden_integral(uuid,jsonb)');
select to_regprocedure('public.coi_certificar_posiciones_v2(jsonb,uuid,jsonb)');
select to_regprocedure('public.coi_eliminar_orden_integral(uuid)');
select to_regprocedure('public.coi_child_order_number_guard()');
select to_regprocedure('public.coi_order_number_dependency_guard()');
select to_regprocedure('public.coi_direct_order_update_guard()');

select 'posiciones' tabla, count(*) inconsistencias
from public.coi_posiciones_oc x
join public.coi_ordenes o on o.id=x.orden_id
where x.nro_oc is distinct from o.nro_oc
union all
select 'certificaciones', count(*)
from public.coi_certificaciones x
join public.coi_ordenes o on o.id=x.orden_id
where x.nro_oc is distinct from o.nro_oc;
```

No usar una OC real para una prueba destructiva si puede evitarse.

## 8. Promoción del frontend

Sólo si preflight y backup están aprobados, las 12 migraciones terminan sin error, smoke DB aprobado, no existen findings críticos abiertos y el Quality Gate está verde en el HEAD exacto a mergear.

Entonces:

1. confirmar HEAD de `release/rc2-estabilizacion`;
2. mergear PR #27 a `main` sin force;
3. esperar workflow/deploy;
4. validar URL productiva;
5. comprobar login, consulta, edición, certificación, calendario y recarga desde Supabase;
6. no realizar una renumeración real sólo para probar producción.

## 9. Smoke funcional productivo mínimo

- [ ] Login Supabase correcto.
- [ ] Dashboard carga datos remotos.
- [ ] Abrir ficha OC.
- [ ] Editar un campo no crítico autorizado y recargar: persiste en Supabase.
- [ ] Próxima certificación persiste y recarga correctamente.
- [ ] Roles sin permiso no pueden editar.
- [ ] Links documentales respetan roles.
- [ ] Writer ejecutivo legacy no devuelve `permission denied`.
- [ ] Renumeración directa por PostgREST queda bloqueada; sólo RPC administradora.
- [ ] Certificación financiera no duplica movimientos ante reintento.
- [ ] Calendario/alertas reflejan datos persistidos.
- [ ] Eliminación integral respeta dependencias y UM legacy.

## 10. Criterio de GO / NO-GO

**GO** únicamente si todos los puntos anteriores son verdes.

**NO-GO** ante project-ref no confirmado, backup no verificable, migración inesperada, inconsistencia UUID/`nro_oc`, Quality Gate rojo, review crítico abierto, `permission denied` en flujo esperado, discrepancia entre UI y Supabase o indicio de doble consumo financiero.

## 11. Rollback / contingencia

No intentar deshacer RC2 mediante ediciones manuales improvisadas. Ante falla antes del merge frontend, detener promoción, conservar evidencia y evaluar restauración con backup o migración forward correctiva. Ante falla después del merge, priorizar contención del frontend y preservación de datos; no borrar ledger ni historial.

---

### Regla final

La salida productiva es una maniobra de dos etapas: **DB primero, frontend después**. RC2 no se considera 100% productivo hasta completar migraciones, merge/deploy y smoke real sobre producción.
