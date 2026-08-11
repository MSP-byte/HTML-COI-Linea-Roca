# Fase 9 — Matriz de roles y smoke autenticado

## Fuente de verdad

El rol se obtiene de `public.profiles.rol` para `auth.uid()` y el perfil debe
estar activo. La UI no es una frontera de seguridad: RLS, privilegios SQL y las
RPC `security definer` vuelven a validar el rol en PostgreSQL.

Roles core versionados:

- `administrador`
- `jefatura`
- `editor`
- `planificacion`
- `control`
- `supervisor`
- `consulta`

`inspector`, `invitado` y `contratista` sólo aparecen en políticas opcionales
para instalaciones históricas. No integran la matriz core y requieren decisión
humana: conservarlos con alcance explícito o migrarlos a uno de los siete roles.

## Matriz ejecutable

“Aprobado local” refiere al runtime PGlite de
`tests/check_supabase_runtime.js`; no sustituye Auth/PostgREST real. Toda fila
manual debe ejecutarse en staging con una cuenta real distinta por rol.

| ROL | ACCIÓN | RESULTADO ESPERADO | TEST AUTOMATIZABLE | TEST MANUAL |
| --- | --- | --- | --- | --- |
| administrador | Leer órdenes, estaciones, posiciones y consumos | Permitido con perfil activo | Sí — lectura core aprobada local | Sí — staging |
| administrador | Crear o editar una OC | Permitido sólo por `coi_guardar_orden_integral` | Sí — alta/edición aprobadas local | Sí — crear fixture y recargar |
| administrador | Ejecutar DML directo sobre órdenes/estaciones | Denegado incluso para este rol | Sí — rechazo aprobado local | Sí — confirmar `403/permission denied` |
| administrador | Crear/editar/marcar estación principal | Permitido por RPC; queda exactamente una principal | Sí — CRUD y cardinalidad aprobados local | Sí — verificar espejo en OC |
| administrador | Eliminar estación secundaria u OC libre | Permitido por RPC; principal/dependencias se rechazan | Sí — ambos casos aprobados local | Sí — fixture libre y bloqueado |
| administrador | Crear/editar/eliminar posiciones sin movimientos | Permitido; identidad OC/posición es inmutable | Sí — identidad y borrado aprobados local | Sí — fixture sin consumo |
| administrador | Certificar, anular y corregir metadatos de consumo | Permitido; ledger, saldo e idempotencia atómicos | Sí — aprobado local | Sí — incluir doble clic/reintento |
| administrador | Gestionar links documentales | Permitido; sólo un principal | Sí — aprobado local | Sí — probar dos principales |
| administrador | Leer auditoría y gestionar perfiles | Permitido | Parcial — contrato/políticas | Sí — obligatorio |
| jefatura | Leer órdenes, estaciones, posiciones y consumos | Permitido con perfil activo | Sí — lectura core aprobada local | Sí — staging |
| jefatura | Crear o editar OC y estaciones | Permitido por RPC; no DML directo | Sí — alta y edición de OC aprobadas; SQL de estaciones validado | Sí — obligatorio |
| jefatura | Certificar, anular y corregir metadatos | Permitido | Sí — allowlist y alcance de idempotencia aprobados | Sí — obligatorio |
| jefatura | Eliminar OC, estación o posición | Denegado; eliminación reservada al administrador | Sí — autorización versionada | Sí — probar rechazo |
| jefatura | Gestionar links y leer auditoría | Permitido | Parcial — contrato y runtime de links | Sí — obligatorio |
| jefatura | Gestionar perfiles | Denegado salvo lectura propia/permitida | Sí — políticas versionadas | Sí — probar rechazo |
| editor | Leer datos core | Permitido con perfil activo | Sí — lectura core aprobada local | Sí — staging |
| editor | Crear o editar OC/estación | Permitido por RPC; no DML directo | Sí — alta/edición OC aprobadas | Sí — estación y persistencia |
| editor | Crear/editar maestro de posiciones y metadatos de consumo | Permitido; importes del ledger inmutables | Parcial — contrato e identidad aprobados | Sí — obligatorio |
| editor | Certificar, anular o eliminar | Denegado | Sí — certificación rechazada local | Sí — probar las tres negativas |
| editor | Gestionar links documentales | Permitido | Parcial — contrato/RPC | Sí — obligatorio |
| editor | Leer auditoría o gestionar perfiles | Denegado | Sí — políticas versionadas | Sí — probar rechazo |
| planificacion | Leer datos core y editar OC/estación/circuito | Permitido por RPC | Sí — lectura y edición OC aprobadas | Sí — estación/circuito |
| planificacion | Crear OC/estación, certificar, anular, eliminar o gestionar links | Denegado | Sí — alta y certificación rechazadas local; resto versionado | Sí — negativas obligatorias |
| control | Leer datos core y editar OC/estación/circuito | Permitido por RPC | Sí — lectura y edición OC aprobadas | Sí — estación/circuito |
| control | Crear OC/estación, certificar, anular, eliminar o gestionar links | Denegado | Sí — alta y certificación rechazadas local; resto versionado | Sí — negativas obligatorias |
| supervisor | Leer datos core y editar OC/estación/circuito | Permitido por RPC | Sí — lectura y edición OC aprobadas | Sí — estación/circuito |
| supervisor | Crear OC/estación, certificar, anular, eliminar o gestionar links | Denegado | Sí — alta y certificación rechazadas local; resto versionado | Sí — negativas obligatorias |
| consulta | Leer órdenes, estaciones, posiciones, consumos, historial y links | Permitido con perfil activo | Sí — lectura de órdenes aprobada; RLS restante versionada | Sí — todas las vistas |
| consulta | Crear, editar, certificar, anular, mover circuito o eliminar | Denegado | Sí — edición, alta, certificación, circuito y borrado rechazados local | Sí — negativas obligatorias |
| cualquier rol inactivo/sin perfil | Leer o mutar datos protegidos | Denegado | Sí — condición RLS/RPC versionada | Sí — una cuenta inactiva |
| `anon`/sin sesión | Leer caché sensible o ejecutar RPC | Denegado; logout purga caché | Sí — Playwright desktop/mobile aprobado | Sí — logout/reapertura |

## Secuencia manual por rol

1. Crear en staging una OC prefijada `SMOKE-RC1-<rol>-<fecha>` cuando el rol lo
   permita; de lo contrario confirmar el rechazo.
2. Editar una observación, cambiar una estación secundaria y marcarla principal
   cuando corresponda; recargar y comparar UI con base.
3. Con administrador/jefatura, certificar una posición dos veces con la misma
   clave, verificar un solo asiento, anularlo y comprobar saldo restaurado.
4. Mover el circuito, reintentar la misma etapa y luego volver a ella después de
   pasar por otra; esperar 0, 0 y 2 nuevos eventos respectivamente.
5. Probar al menos una operación prohibida y exigir error visible, sin éxito
   falso ni cambio local.
6. Revisar Network, consola, `coi_operaciones_auditoria`, `coi_historial_oc` y
   persistencia tras recarga/login nuevo.
7. Eliminar fixtures con administrador y confirmar que una OC con dependencia
   trazable sigue bloqueada.

No se incluyen contraseñas, tokens ni UUID reales en esta documentación.
