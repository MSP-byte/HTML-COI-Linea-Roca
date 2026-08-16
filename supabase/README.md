# Contrato Supabase COI

Supabase es la fuente de verdad de los datos operativos. `localStorage` se usa
solamente como caché autenticada, preferencias y respaldo legacy controlado.

## Arquitectura

El navegador carga `index.html` desde hosting estático y crea un único cliente
`supabase-js`. Supabase Auth identifica al usuario; PostgREST expone lecturas
protegidas por RLS y las operaciones compuestas entran por RPC. PostgreSQL
valida el rol activo, toma locks, modifica las tablas relacionadas y registra la
auditoría dentro de la misma transacción. La UI actualiza su caché sólo después
del commit.

No existe un servidor de aplicación propio ni un paso de build obligatorio. Las
dependencias de desarrollo son Playwright para el smoke de navegador y PGlite
para ejecutar el contrato SQL de forma aislada.

## Configuración

La configuración cliente está en `SUPABASE_CONFIG`, dentro de `index.html`:

- `enabled`: habilita la integración remota.
- `url`: URL pública del proyecto Supabase.
- `key`: clave pública/publishable para el navegador.

La clave cliente no reemplaza a RLS. Nunca colocar una clave `service_role`, un
secreto privado ni credenciales de administración en el HTML, el repositorio o
GitHub Pages. Este proyecto no requiere variables de entorno para ejecutar el
frontend; Node.js 22 o posterior sólo se usa para controles de desarrollo.

## Orden de despliegue

Aplicar primero en un proyecto de staging y con backup verificado.

1. Ejecutar `202608100001_preflight_reports.sql`.
2. Con una sesión `administrador` o `jefatura`, ejecutar:

   ```sql
   select public.coi_preflight_integridad();
   ```

3. Resolver manualmente cualquier OC, posición o estación principal duplicada.
   No hay borrado automático. Para operación completa, resolver también las OCs
   sin estación principal.
4. Ejecutar, en orden:

   - `202608100002_financial_ledger.sql`
   - `202608100003_atomic_order_update.sql`
   - `202608100004_rls_policies.sql`
   - `202608100005_operational_integrity.sql`
   - `202608110006_release_candidate_hardening.sql`

5. Pedir a PostgREST que recargue el esquema:

   ```sql
   notify pgrst, 'reload schema';
   ```

6. Ejecutar `npm test`, el smoke autenticado por rol y la validación posterior
   en staging.

Los índices únicos abortan la migración si todavía existen duplicados. Ese
fallo es deliberado y no elimina ni fusiona registros.

## Modelo financiero

- `coi_posiciones_oc`: maestro de cantidad e importe por OC y posición.
- `coi_consumos_posicion`: libro mayor de consumos confirmados o anulados.
- `coi_idempotency_requests`: evita duplicados por reintentos o doble clic.
- `coi_operaciones_auditoria`: traza los cambios críticos del servidor.

Las cantidades consumidas, disponibles y el saldo de la OC son campos
derivados. Un trigger los recalcula desde el baseline histórico y el libro
mayor. No deben escribirse desde el navegador.

## RPC públicas para usuarios autenticados

| RPC | Roles | Garantía |
| --- | --- | --- |
| `coi_guardar_orden_integral` | alta: administrador, jefatura, editor; edición: roles operativos | Alta con principal o edición integral bajo un commit |
| `coi_guardar_estacion_asociada` | alta: administrador, jefatura, editor; edición: roles operativos | Asociación y auditoría atómicas |
| `coi_marcar_estacion_principal` | roles operativos | Conserva exactamente una principal y sincroniza la OC |
| `coi_eliminar_estacion_asociada` | administrador | Impide eliminar la principal y conserva auditoría |
| `coi_certificar_posiciones_v2` | administrador, jefatura | Lote atómico, locks e idempotencia ligada a usuario y operación |
| `coi_actualizar_consumo_posicion` | administrador, jefatura, editor | Sólo metadatos; importes inmutables |
| `coi_anular_consumo_posicion` | administrador, jefatura | Conserva trazabilidad y devuelve saldo |
| `coi_eliminar_posiciones_sin_movimientos` | administrador | Lote atómico sólo sin historial |
| `coi_actualizar_orden_integral` | roles con edición de OC | OC y estación principal bajo un commit |
| `coi_confirmar_etapa_circuito_v2` | roles operativos | Reintento inmediato idempotente y reingreso histórico trazado |
| `coi_guardar_link_documental` | administrador, jefatura, editor | Link, principal, resumen de OC e historial bajo un commit |
| `coi_eliminar_link_documental` | administrador, jefatura, editor | Borrado del link y recálculo documental atómicos |
| `coi_eliminar_orden_integral` | administrador | Sólo elimina una OC sin dependencias trazables |

RLS exige un registro activo en `public.profiles`. Las mutaciones directas del
libro mayor y de la auditoría están revocadas. La migración 006 revoca además
todo DML directo de `authenticated` sobre órdenes y estaciones: esas escrituras
sólo pueden entrar por las RPC públicas. Las versiones anteriores de
certificación y circuito también quedan sin permiso de ejecución.

## Validación

`tests/check_supabase_runtime.js` levanta PostgreSQL embebido, aplica las seis
migraciones y prueba:

- consumo y recálculo de saldo;
- reintento idempotente y conflicto de payload;
- actualización de metadatos;
- anulación sin `DELETE`;
- sincronización de estación principal;
- borrado atómico de posiciones libres;
- confirmación idempotente del circuito y su historial;
- unicidad del link principal y recálculo documental;
- bloqueo del borrado de una OC con dependencias y eliminación de una OC libre;
- permisos RLS y rechazo por rol.

La cadena completa también se reaplica sobre la misma base de prueba para
comprobar su comportamiento repetible. Esto valida el contrato PostgreSQL, no
reemplaza una prueba con Auth, PostgREST, Storage y datos reales de staging.

## Recuperación

Las migraciones son aditivas, pero la captura del baseline y los índices forman
parte del contrato contable. Si el despliegue falla, no improvisar un `DROP` en
producción: detener escrituras, conservar el error, restaurar el backup probado
y repetir primero en staging. Nunca borrar filas del libro mayor para “corregir”
un saldo; usar la RPC de anulación.

El procedimiento operativo completo PRECHECK → BACKUP → MIGRACIÓN → VALIDACIÓN
→ SMOKE TEST → ROLLBACK está en `PREPRODUCCION.md`.

## Troubleshooting

| Síntoma | Comprobación | Acción segura |
| --- | --- | --- |
| El preflight informa duplicados | Revisar las colecciones del JSON por OC/posición/estación | Resolver cada caso manualmente y repetir; no desactivar índices |
| Una migración falla al crear un índice | Confirmar el detalle del preflight y conservar el error SQL | Restaurar staging si corresponde; no borrar filas automáticamente |
| La RPC no aparece en el cliente | Verificar que las seis migraciones terminaron en orden | Ejecutar `notify pgrst, 'reload schema';` y volver a autenticar |
| La UI responde “perfil no autorizado” | Revisar `profiles.id`, `activo` y `rol` para el UUID de Auth | Corregir el perfil mediante un procedimiento administrativo auditado |
| Un reintento financiero queda pendiente | Comparar usuario, operación y payload original | Reintentar la misma intención con la misma clave; no iniciar otro lote |
| Los datos no cargan después del logout | Es el aislamiento esperado de caché | Iniciar sesión y usar “Actualizar datos Supabase” |
| El smoke E2E no encuentra Chromium | Ejecutar `npm run test:e2e:install` | Repetir `npm run test:e2e`; en CI la instalación ya está declarada |

Para diagnóstico inicial, ejecutar `npm ci`, `npm test` y revisar la consola del
navegador. No probar reparaciones sobre el proyecto productivo.
