# 10 — SECURITY & DATA RULES

## Producción
Tratar Supabase productivo como sensible.

## Permitido
- lectura;
- análisis;
- schema versionado;
- tests locales/mocks;
- consultas seguras con acceso autorizado.

## Requiere autorización
- migraciones;
- ALTER/CREATE/DROP;
- RLS;
- RPC;
- DELETE/TRUNCATE;
- borrado Storage;
- updates masivos;
- permisos.

## Credenciales
Nunca commitear service role, contraseñas o tokens.
No imprimir secretos completos.

## Auth
Antes de acciones sensibles validar sesión y permiso.
UI oculta no reemplaza seguridad real.

## RLS
Frontend no reemplaza RLS.

## Datos
No modificar producción para hacer pasar tests.
No sanear duplicados con DELETE sin plan/autorización.

## Storage
No borrar archivos sin autorización.
Preferir signed URLs.

## localStorage
No secretos. No autoridad.

## SQL propuesto
Explicar propósito, impacto y rollback. No ejecutar hasta aprobación.
