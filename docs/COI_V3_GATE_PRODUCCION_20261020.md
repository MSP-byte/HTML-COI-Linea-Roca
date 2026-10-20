# COI V3 — Gate de promoción controlada a producción

**Corte técnico:** 20/10/2026 (Argentina). **Incidente/tarea:** [Issue #139](https://github.com/MSP-byte/HTML-COI-Linea-Roca/issues/139). **Frontend V3:** PR #144 ya fusionado (`68e0fe8`).  
**Estado de esta guía:** diagnóstico y preparación; **NO autoriza ni ejecuta migración/importación productiva**.

## 1. Entornos y evidencia de lectura

| Verificación | Producción | STAGING |
|---|---|---|
| Proyecto Supabase | `ooepgbzqlpjrtpaoqawc` | `brmrroikctfbtzwfewan` |
| PostgreSQL | 17.6 | 17.6 |
| `coi_ordenes` | 34 (18 Obras / 16 Servicios) | 1 Servicio de prueba |
| `coi_certificaciones` | 5 | 0 |
| `profiles` | 1 administrador activo + 1 consulta activo | 2 administradores activos |
| Tablas `coi_v3_*` | **NO instaladas** | 3 instaladas, RLS activada |
| Cartera V3 | — | 117 Obras + 16 Servicios = 133 UUID |
| Importaciones / ítems | — | 6 lotes / 399 eventos (133 nuevos + 15 actualizados + 251 sin cambios) |
| Enlaces contractuales V3 `orden_id` | — | **0** |
| Tipos y OC duplicadas entre `coi_ordenes` | no se detectaron OC repetidas | no se detectaron OC repetidas |

Las tablas V3 de STAGING tienen políticas de lectura `authenticated` condicionadas por `coi_current_role()`. Su RPC `coi_v3_confirmar_importacion(text,text,jsonb)` es `SECURITY DEFINER`, accesible a `authenticated` y valida el rol administrador al inicio. Las **dos** migraciones versionadas en `supabase/migrations/` **no aparecen** en el historial de producción.

**Conciliación documental (Issue #139):** de 117 Obras, 10 tienen OC compatible por número/tipo, 7 presentan OC ausente en producción y 100 no incluyen OC; de 16 Servicios, 15 tienen correspondencia y 1 presenta OC ausente. Son **candidatas**: no son vínculos autorizados. Resolver discrepancia entre fuente y contrato de la OC `4530009806` (andén descendente vs. ascendente). No corregir el literal `4550009871` a `4530009871` sin evidencia SAP.

## 2. Condiciones de seguridad innegociables

- **NO cambiar ni importar** datos en producción antes de cerrar el gate de copia lógica completa, **restauración de prueba en instancia aislada**, control de dependencias/RLS/RPC, prueba autenticada de `consulta` y conciliación documental.
- El plan Supabase Free **no proporciona copias diarias automáticas**. El respaldo de filas CSV/JSON o checksums **no** sustituye a una copia lógica restaurable.
- Los objetos reales de Supabase Storage **no se incluyen** en un volcado PostgreSQL; gestionar inventario y respaldo documental por separado.
- No compartir cadenas de conexión, claves, contraseñas, datos de Auth o archivos de respaldo en GitHub, PR, issues, chats o CI. Guardar en lugar cifrado fuera del repo.
- Cualquier escritura contractual debe seguir en `coi_ordenes` mediante la ruta canónica. `coi_v3_cartera` guarda procedencia y `orden_id` solo se completa cuando la identidad ha sido validada. **Nunca fabricar OC ni fusionar UUID por descripción/estación.**

## 3. Gate de respaldo y restaurabilidad — PENDIENTE

**Bloqueo operativo real:** el conector permite SQL y migraciones, pero no obtiene el archivo lógico completo; el entorno actual no tiene `pg_dump`, `pg_restore`, `psql` ni conexión PostgreSQL autenticada. No se efectuó ningún respaldo ni restauración.

1. En un equipo autorizado, instalar cliente PostgreSQL compatible con PostgreSQL 17; tomar la conexión de **producción** desde `Supabase → Connect`, usando TLS y un canal privado. Nunca pegar credenciales en GitHub.
2. Generar **backup lógico completo** compatible con la herramienta y los permisos disponibles. Para archivo custom, `pg_dump --format=custom --no-owner --no-acl --file=<RUTA_PRIVADA>.dump` usando variables de conexión seguras del equipo (no URL con contraseña en historial). Verificar código de salida, tamaño y checksum SHA-256 con `Get-FileHash` (Windows). No subir `.dump` al repositorio.
3. Validar estructura del archivo con `pg_restore --list <RUTA_PRIVADA>.dump` (esto **NO** comprueba por sí solo que sea restaurable).
4. Restaurar **solo** en una instancia aislada, vacía, de prueba, con la misma versión mayor y extensiones pertinentes. Probar `pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=<DESTINO_AISLADO> <RUTA_PRIVADA>.dump` **solo** si el destino y los permisos son compatibles. No ejecutar `--clean` sobre producción ni sobre STAGING existente.
5. Si el volcado raw incluye objetos administrados por Supabase que no son portables, seguir la modalidad documentada `supabase db dump` (roles, schema y data) y **probar la restauración integral** en instancia aislada mediante los pasos oficiales. Registrar explícitamente cualquier objeto o esquema excluido; no dar por aprobado un respaldo parcial.
6. Comparar tablas, funciones, políticas, triggers, extensiones, índices, usuarios Auth, **34 OC y 5 certificaciones** con origen. Guardar evidencia de **éxito de restauración** (fecha UTC, versión, conteos, checksum, operador, ruta segura del respaldo; nunca la contraseña).
7. Registrar aparte los objetos Storage y su estrategia de recuperación.

Documentación oficial: [Supabase — Database Backups](https://supabase.com/docs/guides/platform/backups) y [Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

## 4. Compatibilidad, permisos y ensayo de roles

- Ejecutar **solo SELECT** de `scripts/coi_v3_preflight_readonly.sql` en ambos entornos y `scripts/coi_v3_staging_readonly.sql` únicamente en STAGING; conservar resultados y cotejarlos con esta línea base.
- En producción existen políticas RLS heredadas **permisivas** en `coi_ordenes` y `coi_certificaciones`. La escritura directa de `coi_ordenes` tiene un trigger guard que verifica rol y campos cuando el writer es `authenticated`; **no** interpretar el hallazgo de RLS como confirmación de explotación ni eliminar políticas sin pruebas. `coi_certificaciones` dispone de grants INSERT/UPDATE a `authenticated` y políticas históricas amplias: requiere auditoría funcional de privilegios en un alcance de seguridad separado.
- Diferencia entre entornos: `coi_assert_role(text[])` es `SECURITY INVOKER` en producción y `SECURITY DEFINER` en STAGING. Verificar este cambio de ejecución junto a permisos/función `coi_current_role()` antes de migrar. No reemplazar funciones de autenticación para “hacer pasar” un test.
- Ejecutar prueba **Auth real** con usuario `consulta` en entorno de ensayo: debe poder leer la cartera autorizada y no ejecutar la RPC de importación. STAGING **no tiene** perfil consulta hoy; configurar cuenta de QA siguiendo alta regular de Supabase Auth y sin reutilizar/alterar perfiles productivos. SQL con `SET ROLE` no reemplaza esta prueba.
- Correr Supabase Security/Performance Advisors; revisar hallazgos preexistentes en un issue separado y no mezclar correcciones de permisos con V3.

## 5. Secuencia de promoción cuando TODOS los gates estén verdes

1. Congelar escrituras administrativas durante la ventana y capturar snapshot de control reproducible.
2. Aplicar a producción, **en este orden**, archivos sin modificar:
   - `supabase/migrations/202610160001_coi_v3_carteras_importacion.sql`
   - `supabase/migrations/202610190001_coi_v3_tipo_oc_guard.sql`
3. Verificar existencia/columnas/RLS/grants/firmas RPC; confirmar que `coi_ordenes`, certificaciones, documentos, historial y perfiles mantienen sus recuentos y huellas.
4. Revisar cada fila fuente: 25 candidatas por OC/tipo, 8 OC faltantes en producción, 100 Obras sin OC y discrepancias. Ninguna asociación automática con información incompatible.
5. Importar **solo** filas homologadas desde fuentes originales con usuario admin real, conservando `fuente`, `clave_fuente`, `fila_excel`, `datos`, `huella` y auditoría. No clonar las filas de prueba STAGING ciegamente. El importador usa lote transaccional y control de concurrencia por huella.
6. Validar idempotencia, 0 duplicados de identidad, recuperación después de refresh, login admin/consulta, lectura, permisos y UI escritorio/móvil. Comparar instantáneas de tablas productivas antes/después.
7. Confirmación final y cierre de Issue #139 **solo** con evidencia del respaldo/restauración y checks funcionales.

## 6. Rollback

Antes del commit productivo, abortar sin escrituras. Después de la creación de tablas, ante problema de lectura/importación: **detener nuevas importaciones**, mantener los registros de auditoría y conservar tablas/UUID. Revertir **solo el frontend** si hiciera falta; no ejecutar `DROP`, `TRUNCATE` ni `DELETE` para “volver atrás”. Restaurar una base completa únicamente con evaluación de incidente, ventana de servicio y respaldo íntegro previamente probado.

## 7. Estado de autorización y cierre

El propietario autorizó continuar el trabajo de conciliación y migración (Issue #139). **La autorización no convierte en aprobados los gates pendientes.** Hasta demostrar backup/restauración aislada y prueba Auth de consulta, el resultado correcto es **NO-GO de escrituras productivas**. Este documento y los scripts asociados son documentación/diagnóstico, no migraciones.
