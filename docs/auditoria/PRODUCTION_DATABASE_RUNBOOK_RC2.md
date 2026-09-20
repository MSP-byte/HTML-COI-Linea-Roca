# RC2 — Runbook final de salida a producción

**Estado al 16/08/2026:** etapa de base de datos productiva completada y validada. Backup, preflight, 12/12 migraciones y smoke DB: **PASS**. Frontend aún pendiente de merge/deploy al momento de este commit.

## 1. Entornos y guardrails

- Producción Supabase: `ooepgbzqlpjrtpaoqawc`.
- STAGING Supabase: `brmrroikctfbtzwfewan`.
- Supabase continúa siendo la fuente única de verdad.
- No usar `service_role` en frontend.
- No ejecutar `db reset`, force push ni limpiezas destructivas.
- La secuencia de salida es **DB primero → frontend después**.

## 2. Backup productivo

Backup lógico generado y verificado fuera del repositorio en:

`C:\Users\Casa\Documents\COI-PROD-BACKUP-2026-08-16`

Artefactos verificados con tamaño mayor a cero y SHA256 calculado localmente:

- `roles.sql`
- `schema.sql`
- `data.sql`
- `COI-PROD-BACKUP-2026-08-16.zip`

No subir estos archivos a GitHub.

## 3. Preflight productivo

Resultado previo al rollout:

- 34 OCs productivas;
- 0 duplicados por `nro_oc` normalizado;
- 0 OCs con número inválido/no canónico;
- 0 dependencias huérfanas en estaciones/posiciones;
- `coi_servicios_tecnicos_um` legacy posee `nro_oc` y no `orden_id`;
- 34/34 OCs con `estacion` informada.

Se detectó una particularidad histórica: `coi_ordenes_estaciones` estaba vacía aunque las 34 OCs tenían estación en el maestro. El primer intento de `202608110006_release_candidate_hardening.sql` abortó por su precondición de una estación principal por OC y PostgreSQL revirtió íntegramente esa transacción.

Se incorporó y certificó por CI la migración forward-only `202608110005_backfill_principal_stations.sql`, que sólo materializa asociaciones faltantes desde `coi_ordenes`, no inventa ramal/sector y aborta casos ambiguos.

Resultado del backfill productivo:

- 34 OCs;
- 34 asociaciones de estación;
- 34 estaciones principales;
- 0 OCs con cantidad inválida de principales;
- 0 inconsistencias `nro_oc` entre maestro y asociación.

## 4. Orden final de migraciones RC2

Secuencia productiva aplicada:

1. `202608100001_preflight_reports.sql` — PASS
2. `202608100002_financial_ledger.sql` — PASS
3. `202608100003_atomic_order_update.sql` — PASS
4. `202608100004_rls_policies.sql` — PASS
5. `202608100005_operational_integrity.sql` — PASS
6. `202608110005_backfill_principal_stations.sql` — PASS
7. `202608110006_release_candidate_hardening.sql` — PASS en reintento posterior al backfill
8. `20260813024545_renumerar_oc.sql` — PASS
9. `20260813033959_fix_renumerar_oc_servicios_um.sql` — PASS
10. `202608160010_rc2_review_hardening.sql` — PASS
11. `202608160020_rc2_concurrency_and_legacy.sql` — PASS
12. `202608160030_rc2_legacy_writers_and_recovery.sql` — PASS

El ledger remoto de Supabase registra las 12 migraciones.

## 5. Smoke DB productivo

Contratos confirmados:

- `public.coi_renumerar_oc(uuid,text,text)`
- `public.coi_actualizar_orden_integral(uuid,jsonb)`
- `public.coi_certificar_posiciones_v2(jsonb,uuid,jsonb)`
- `public.coi_eliminar_orden_integral(uuid)`
- `public.coi_child_order_number_guard()`
- `public.coi_order_number_dependency_guard()`
- `public.coi_direct_order_update_guard()`

Consistencia posterior:

- estaciones con `nro_oc` distinto al maestro: 0;
- posiciones con `nro_oc` distinto al maestro: 0;
- certificaciones con `nro_oc` distinto al maestro: 0;
- OCs: 34;
- asociaciones de estación: 34;
- estaciones principales: 34;
- certificaciones: 5;
- posiciones financieras cargadas actualmente: 0;
- OCs con principal inválida: 0.

**SMOKE DB = PASS.**

## 6. Advisors Supabase

Los advisors posteriores no detectaron una pérdida de integridad del rollout.

Quedan como backlog posterior al release:

- optimización de índices/FKs y policies RLS;
- consolidación de políticas permisivas duplicadas;
- optimización `auth()`/initplan;
- evaluación de protección de contraseñas filtradas en Supabase Auth;
- revisión de tablas históricas de backup con RLS sin políticas.

Las advertencias genéricas sobre RPC `SECURITY DEFINER` invocables por `authenticated` no se tratan como blocker de RC2: son parte de la superficie RPC intencional y las funciones funcionales aplican validación de rol server-side.

No introducir estas optimizaciones durante la promoción RC2 salvo evidencia de un fallo funcional o de seguridad específico.

## 7. Gate GitHub previo a frontend

Antes del merge se exige:

- PR #27 sin findings P1/P2 abiertos;
- HEAD exacto de `release/rc2-estabilizacion` con Quality Gate verde;
- `main` no modificado fuera del merge normal;
- ninguna migración pendiente en la secuencia RC2.

## 8. Promoción frontend

Con DB y CI verdes:

1. confirmar HEAD exacto del PR #27;
2. mergear a `main` sin force;
3. esperar el workflow/deploy correspondiente;
4. validar la URL productiva;
5. ejecutar smoke funcional autenticado;
6. no realizar una renumeración real sólo para probar producción.

## 9. Smoke funcional productivo mínimo

- [ ] Login Supabase correcto.
- [ ] Dashboard carga datos remotos.
- [ ] Abrir ficha OC.
- [ ] Rol/controles administrativos correctos.
- [ ] Edición no crítica autorizada persiste tras recarga, usando un caso controlado cuando sea posible.
- [ ] Próxima certificación persiste/recarga correctamente cuando corresponda.
- [ ] Writer ejecutivo esperado no devuelve `permission denied`.
- [ ] Renumeración directa queda bloqueada; la operación administrativa usa RPC.
- [ ] Calendario/alertas reflejan datos persistidos.
- [ ] Borrado integral respeta dependencias y UM legacy.

## 10. Criterio final

**GO frontend:** DB productiva PASS + smoke DB PASS + PR limpio + Quality Gate verde en HEAD exacto.

**100% RC2:** merge/deploy terminado + smoke funcional productivo autenticado PASS.

Ante una anomalía post-merge, preservar datos y trazabilidad, evitar cambios manuales improvisados y usar el backup o una migración forward correctiva según el caso.
