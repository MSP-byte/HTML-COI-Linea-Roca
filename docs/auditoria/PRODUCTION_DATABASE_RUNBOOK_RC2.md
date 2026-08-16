# RC2 — Runbook final de salida a producción

**Estado:** preparado y versionado. **NO ejecutado contra producción.**

Este documento es la secuencia operativa final para llevar RC2 a Supabase producción y luego promover el frontend. No constituye autorización para ejecutar cambios productivos.

## 1. Guardrails obligatorios

- Project-ref productivo esperado: `ooepgbzqlpjrtpaoqawc`.
- Project-ref STAGING conocido: `brmrroikctfbtzwfewan`.
- Antes de cualquier escritura, confirmar visualmente y por CLI el project-ref.
- No ejecutar `supabase db reset --linked`.
- No usar `service_role` en frontend ni registrar secretos.
- No hacer `git push --force`, `git reset --hard` ni limpieza destructiva.
- Si una consulta preflight devuelve una inconsistencia inesperada: **STOP**.
- La base de datos debe promoverse **antes** que el frontend productivo, porque RC2 consume contratos/RPC nuevos.

## 2. Estado técnico certificado en rama RC2

Rama: `release/rc2-estabilizacion`.

El Quality Gate del PR valida:

- sintaxis HTML/CSS/JS;
- tests estáticos y de regresión;
- migraciones PostgreSQL en PGlite;
- idempotencia financiera;
- compatibilidad controlada de writers legacy;
- guards de renumeración;
- Chromium E2E.

La revisión del PR incorporó hardening forward-only para:

- canonicalización de `nro_oc` históricos;
- colisiones en dependencias modernas y legacy;
- sincronización concurrente de hijos durante renumeración;
- UM legacy como dependencia de borrado;
- protección del historial de renumeración;
- deadlocks de certificaciones concurrentes;
- reconciliación de idempotency key perdida tras logout/red;
- writers ejecutivos legacy bajo RLS + guardas + auditoría;
- aislamiento STAGING/PROD del Doctor y del runner E2E.

## 3. Orden completo de migraciones RC2

La instalación productiva debe respetar **estrictamente el orden lexicográfico/timestamp**:

1. `202608100001_preflight_reports.sql`
2. `202608100002_financial_ledger.sql`
3. `202608100003_atomic_order_update.sql`
4. `202608100004_rls_policies.sql`
5. `202608100005_operational_integrity.sql`
6. `202608110006_release_candidate_hardening.sql`
7. `20260813024545_renumerar_oc.sql`
8. `20260813033959_fix_renumerar_oc_servicios_um.sql`
9. `202608160010_rc2_review_hardening.sql`
10. `202608160020_rc2_concurrency_and_legacy.sql`
11. `202608160030_rc2_legacy_writers_and_recovery.sql`

**No aplicar sólo una migración intermedia.** La definición final del contrato RC2 resulta de la secuencia completa.

## 4. Preflight productivo — sólo lectura

Ejecutar primero, sin mutar datos:

```sql
-- Identidad y volumen base
select count(*) as ordenes from public.coi_ordenes;
select count(*) as estaciones from public.coi_ordenes_estaciones;
select count(*) as posiciones from public.coi_posiciones_oc;

-- Duplicados por nro_oc normalizado: debe devolver 0 filas.
select regexp_replace(upper(trim(nro_oc)), '[^0-9A-Z]', '', 'g') as nro_normalizado,
       count(*)
from public.coi_ordenes
group by 1
having count(*) > 1;

-- OCs con formato no canónico: revisar antes de migrar.
select id, nro_oc
from public.coi_ordenes
where nro_oc is null
   or trim(nro_oc) = ''
   or nro_oc ~ '[^0-9]'
order by nro_oc;

-- Dependencias modernas inconsistentes: todos los conteos deben ser 0.
select 'coi_ordenes_estaciones' tabla, count(*) inconsistencias
from public.coi_ordenes_estaciones x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and o.id is null
union all
select 'coi_posiciones_oc', count(*)
from public.coi_posiciones_oc x
left join public.coi_ordenes o on o.id = x.orden_id
where x.orden_id is not null and o.id is null;

-- Confirmar estructura UM legacy.
select column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='coi_servicios_tecnicos_um'
  and column_name in ('nro_oc','orden_id')
order by column_name;

-- Migraciones RC2 ya presentes, si las hubiera.
select version
from supabase_migrations.schema_migrations
where version >= '202608100001'
order by version;
```

Si el esquema productivo difiere de lo esperado, no improvisar SQL de reparación en caliente: registrar el resultado y detener el despliegue.

## 5. Backup previo

Antes de migrar:

1. generar backup de la base productiva con el mecanismo aprobado para el proyecto;
2. conservar checksum y timestamp;
3. verificar que el archivo no quede dentro del repositorio Git;
4. registrar el HEAD exacto de la rama RC2.

`.gitignore` excluye `*.dump` y `*.dump.sha256`.

## 6. Aplicación de migraciones

Sólo después de autorización explícita y preflight aprobado.

Procedimiento recomendado:

1. confirmar vínculo al project-ref productivo;
2. listar migraciones locales/remotas;
3. verificar que las pendientes correspondan exclusivamente a la secuencia RC2 prevista;
4. ejecutar el mecanismo de migración controlado de Supabase;
5. detenerse ante el primer error;
6. volver a listar el ledger de migraciones.

No ejecutar migraciones manuales aisladas fuera del historial salvo contingencia documentada.

## 7. Smoke de base inmediatamente posterior

Validar antes de tocar `main`:

```sql
-- La RPC de renumeración debe existir.
select to_regprocedure('public.coi_renumerar_oc(uuid,text,text)');

-- Contratos principales.
select to_regprocedure('public.coi_actualizar_orden_integral(uuid,jsonb)');
select to_regprocedure('public.coi_certificar_posiciones_v2(jsonb,uuid,jsonb)');
select to_regprocedure('public.coi_eliminar_orden_integral(uuid)');

-- Guardas RC2 finales.
select to_regprocedure('public.coi_child_order_number_guard()');
select to_regprocedure('public.coi_order_number_dependency_guard()');
select to_regprocedure('public.coi_direct_order_update_guard()');

-- No debe haber inconsistencias UUID/nro_oc en hijos modernos.
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

No usar una OC real para una prueba destructiva si puede evitarse. Las pruebas de escritura deben usar el registro de prueba controlado definido para RC2 o una OC creada específicamente para smoke.

## 8. Promoción del frontend

Sólo si:

- preflight productivo aprobado;
- backup confirmado;
- migraciones aplicadas sin error;
- smoke de DB aprobado;
- PR sin findings P1/P2 abiertos;
- Quality Gate verde en el HEAD que se va a mergear.

Entonces:

1. confirmar nuevamente el HEAD de `release/rc2-estabilizacion`;
2. mergear PR #27 a `main` sin force;
3. esperar el workflow/deploy correspondiente;
4. validar la URL productiva;
5. comprobar login, consulta, edición, certificación, calendario y recarga desde Supabase;
6. no realizar una renumeración real sólo para probar producción; usar el caso controlado si sigue disponible.

## 9. Smoke funcional productivo mínimo

Checklist:

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

**NO-GO** ante cualquiera de estos casos:

- project-ref no confirmado;
- backup no verificable;
- migración pendiente inesperada;
- inconsistencia UUID/`nro_oc`;
- Quality Gate rojo;
- review thread crítico abierto;
- `permission denied` en flujo operativo esperado;
- discrepancia entre estado mostrado y estado persistido en Supabase;
- cualquier indicio de doble consumo financiero.

## 11. Rollback / contingencia

No intentar “deshacer” RC2 mediante ediciones manuales improvisadas.

Ante falla antes del merge frontend:

- detener promoción;
- conservar evidencia y logs;
- evaluar rollback DB con backup o una migración forward correctiva.

Ante falla después del merge frontend:

- priorizar contención del frontend y preservación de datos;
- no borrar ledger financiero ni historial;
- documentar commit, hora, usuario y operación afectada;
- restaurar sólo con procedimiento controlado.

---

### Regla final

La salida productiva es una maniobra de dos etapas: **DB primero, frontend después**. RC2 no se considera 100% productivo hasta completar migraciones, merge/deploy y smoke real sobre producción con autorización explícita.
