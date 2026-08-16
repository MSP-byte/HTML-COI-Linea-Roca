# Runbook de preproducción Supabase — COI RC1

Este procedimiento se ejecuta primero contra **staging**. No autoriza ni
realiza cambios en producción. Cada etapa debe dejar evidencia fechada y un
responsable; si un gate falla, no se continúa.

## Entradas obligatorias

- commit o tag exacto a validar;
- URL de base de **staging** guardada en un gestor seguro;
- usuario real de staging por cada rol de la matriz;
- ventana sin escrituras de prueba concurrentes;
- backup verificable y permiso para restaurarlo;
- copia de los seis archivos de `supabase/migrations/` del mismo commit.

## 1. PRECHECK

1. Confirmar identidad y evitar cualquier confusión con producción:

   ```bash
   git rev-parse HEAD
   git status --short
   printf 'Destino esperado: STAGING\n'
   ```

2. Validar el repositorio desde una instalación limpia:

   ```bash
   npm ci
   npm test
   npm audit --audit-level=high
   npx playwright install --with-deps chromium
   npm run test:e2e
   ```

3. Cargar la conexión de staging sin escribirla en el repositorio ni en el
   historial. El nombre específico evita usar una URL genérica:

   ```bash
   read -r -s -p 'Database URL de STAGING: ' COI_STAGING_DATABASE_URL
   export COI_STAGING_DATABASE_URL
   printf '\n'
   psql "$COI_STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -c "select current_database(), current_user, version();"
   ```

4. Registrar los conteos previos:

   ```sql
   select count(*) as ordenes from public.coi_ordenes;
   select count(*) as estaciones from public.coi_ordenes_estaciones;
   select count(*) as posiciones from public.coi_posiciones_oc;
   select count(*) as perfiles_activos
     from public.profiles where activo is true;
   ```

5. Aplicar sólo el preflight, que no borra ni fusiona datos:

   ```bash
   psql "$COI_STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
     -f supabase/migrations/202608100001_preflight_reports.sql
   ```

6. Ejecutar `coi_preflight_integridad()` con una sesión real de staging de rol
   `administrador` o `jefatura`. Desde la consola del navegador autenticado:

   ```js
   await window.__COI_SUPABASE_CLIENT__.rpc('coi_preflight_integridad')
   ```

   Deben ser cero `ordenes_nro_oc_duplicado`, `posiciones_duplicadas`,
   `ordenes_con_multiples_estaciones_principales`,
   `ordenes_sin_estacion_principal`, `estaciones_asociadas_duplicadas` y
   `links_principales_duplicados` cuando la tabla exista. `perfiles_inactivos`
   es informativo. Guardar el JSON sin tokens ni datos de sesión.

Si cualquier contador obligatorio es distinto de cero, detenerse y resolver
cada registro con decisión humana; nunca desactivar constraints ni borrar
duplicados automáticamente.

## 2. BACKUP

La opción preferida es un snapshot/PITR verificado del proveedor. Como copia
adicional lógica:

```bash
COI_BACKUP_FILE="coi-staging-pre-rc1-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$COI_STAGING_DATABASE_URL" --format=custom \
  --no-owner --no-acl --file="$COI_BACKUP_FILE"
pg_restore --list "$COI_BACKUP_FILE" >/dev/null
sha256sum "$COI_BACKUP_FILE" >"$COI_BACKUP_FILE.sha256"
```

El gate se aprueba sólo si el archivo no está vacío, `pg_restore --list`
termina en cero, el checksum quedó guardado fuera del repositorio y existe un
destino probado para restaurarlo.

## 3. MIGRACIÓN

Aplicar en orden y con corte inmediato ante error. Reaplicar 001 es seguro y
mantiene el runbook autocontenido:

```bash
for migration in \
  supabase/migrations/202608100001_preflight_reports.sql \
  supabase/migrations/202608100002_financial_ledger.sql \
  supabase/migrations/202608100003_atomic_order_update.sql \
  supabase/migrations/202608100004_rls_policies.sql \
  supabase/migrations/202608100005_operational_integrity.sql \
  supabase/migrations/202608110006_release_candidate_hardening.sql
do
  printf 'Aplicando %s\n' "$migration"
  psql "$COI_STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration" || exit 1
done
```

Cada archivo usa su propia transacción. Un error revierte ese archivo, pero los
anteriores ya confirmados permanecen; no se debe continuar a ciegas. Después:

```bash
psql "$COI_STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "notify pgrst, 'reload schema';"
```

## 4. VALIDACIÓN

Ejecutar las consultas y guardar la salida:

```sql
-- Exactamente una estación principal por OC.
select o.id, o.nro_oc, count(oe.id) as principales
  from public.coi_ordenes o
  left join public.coi_ordenes_estaciones oe
    on oe.orden_id = o.id and oe.es_principal is true
 group by o.id, o.nro_oc
having count(oe.id) <> 1;

-- Unicidad canónica de OC y de posición.
select public.coi_normalize_order_number(nro_oc), count(*)
  from public.coi_ordenes
 group by 1 having count(*) > 1;
select orden_id, upper(trim(replace(posicion, ',', '.'))), count(*)
  from public.coi_posiciones_oc
 group by 1, 2 having count(*) > 1;

-- Saldos coherentes con consumos activos.
select p.id, p.nro_oc, p.posicion,
       p.cantidad_consumida, coalesce(x.cantidad, 0) as cantidad_ledger,
       p.monto_consumido, coalesce(x.monto, 0) as monto_ledger
  from public.coi_posiciones_oc p
  left join lateral (
    select sum(c.cantidad) as cantidad, sum(c.monto) as monto
      from public.coi_consumos_posicion c
     where c.posicion_id = p.id and c.anulado_en is null
  ) x on true
 where p.cantidad_consumida is distinct from coalesce(x.cantidad, 0)
    or p.monto_consumido is distinct from coalesce(x.monto, 0);

-- RLS y cierre del DML directo de las tablas core.
select c.relname, c.relrowsecurity
  from pg_class c
 where c.oid in (
   'public.coi_ordenes'::regclass,
   'public.coi_ordenes_estaciones'::regclass,
   'public.coi_posiciones_oc'::regclass,
   'public.coi_consumos_posicion'::regclass
 );
select
  (has_table_privilege('authenticated', 'public.coi_ordenes', 'INSERT')
   or has_table_privilege('authenticated', 'public.coi_ordenes', 'UPDATE')
   or has_table_privilege('authenticated', 'public.coi_ordenes', 'DELETE'))
    as dml_directo_ordenes,
  (has_table_privilege('authenticated', 'public.coi_ordenes_estaciones', 'INSERT')
   or has_table_privilege('authenticated', 'public.coi_ordenes_estaciones', 'UPDATE')
   or has_table_privilege('authenticated', 'public.coi_ordenes_estaciones', 'DELETE'))
    as dml_directo_estaciones;
```

Las tres consultas de anomalías deben devolver cero filas, todas las tablas
listadas deben tener RLS y ambos flags de DML directo deben ser `false`.

## 5. SMOKE TEST

Ejecutar `docs/auditoria/FASE_9_MATRIZ_ROLES.md` con cuentas reales de staging.
Para cada cuenta:

1. cerrar la sesión anterior y limpiar sólo cachés COI sensibles;
2. iniciar sesión y confirmar el rol activo en `profiles`;
3. probar lectura, una acción permitida y una acción denegada;
4. recargar la página y comprobar persistencia remota;
5. revisar consola y red: cero excepciones no controladas, `401/403` sólo en
   acciones deliberadamente denegadas;
6. verificar auditoría e historial con administrador/jefatura;
7. eliminar todos los fixtures de staging mediante las RPC permitidas.

No usar OCs ni documentos productivos. Auth, PostgREST y Storage reales no se
consideran aprobados hasta completar este smoke.

## 6. ROLLBACK SI FALLA

1. Detener escrituras y conservar mensaje, archivo y sentencia que falló.
2. Si falló dentro de un archivo, confirmar que PostgreSQL revirtió esa
   transacción; no ejecutar el archivo siguiente.
3. No improvisar migraciones inversas ni borrar ledger, auditoría o historial.
   No hay migraciones `down`: revertir constraints sin restaurar el estado
   contable sería inseguro.
4. Restaurar el snapshot/PITR de staging. Para una base de staging descartable
   previamente aprobada y la copia lógica:

   ```bash
   pg_restore --dbname="$COI_STAGING_DATABASE_URL" --clean --if-exists \
     --no-owner --no-acl "$COI_BACKUP_FILE"
   ```

5. Repetir conteos y smoke sobre el estado restaurado.
6. Documentar la causa raíz y corregir primero en otra copia de staging.

Al terminar:

```bash
unset COI_STAGING_DATABASE_URL
```

La promoción posterior a producción requiere un backup propio de producción,
la misma secuencia, aprobaciones humanas y un plan de corte. Nunca se restaura
ni migra producción desde este runbook sin esa autorización explícita.
