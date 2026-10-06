# COI Línea Roca — Security Hardening V1

## Principio rector

El navegador no es una frontera de seguridad. El sistema debe permanecer protegido aun si el HTML/JavaScript es inspeccionado o modificado por el usuario.

La autorización efectiva reside en Supabase Auth, PostgreSQL, RLS, grants y RPC con validación server-side.

## Controles vigentes

- Supabase Auth como identidad canónica.
- `public.profiles` como fuente server-side de rol y estado activo.
- RLS habilitado en tablas COI expuestas.
- `anon` sin privilegios directos sobre datos COI.
- Mutaciones financieras críticas por RPC.
- Idempotencia en operaciones financieras.
- Auditoría de operaciones relevantes.
- Quality Gate con npm audit, tests y Playwright.
- Dependencias fijadas mediante package-lock.
- Desde Hardening V1: `PUBLIC` y `anon` no pueden ejecutar funciones `public.coi_*`.
- Default privileges: nuevas funciones de `postgres` en `public` no nacen ejecutables por `PUBLIC`.

## Controles que dependen de configuración de plataforma

Estos controles no se resuelven sólo con código del repositorio:

1. Activar **Leaked Password Protection** en Supabase Auth.
2. Exigir MFA para administradores/jefatura cuando el flujo operativo haya sido validado.
3. Proteger `main` con PR + Quality Gate obligatorio.
4. Activar Secret Scanning / push protection cuando el plan de GitHub lo permita.
5. Mantener 2FA/passkey en cuentas con permisos de administración.

## Respuesta ante incidente

Ante sospecha de compromiso:

1. Preservar evidencia; no borrar logs.
2. Identificar usuario, sesión, hora y operación.
3. Revocar sesiones del usuario afectado.
4. Rotar cualquier secreto privilegiado potencialmente expuesto.
5. No rotar la publishable key como sustituto de corregir RLS/permisos.
6. Revisar `coi_operaciones_auditoria`, Auth logs y Postgres/API logs.
7. Contener la función/RPC afectada antes de restaurar servicio.
8. Validar integridad de OCs, certificaciones, posiciones y timeline.
9. Documentar causa raíz y agregar prueba de regresión.

## Prueba maestra

Un cliente sin login, un usuario sin perfil activo o un rol sin autorización no debe poder modificar datos aunque fabrique manualmente llamadas REST/RPC fuera de la interfaz.
