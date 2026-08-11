# Fase 3 — Plan de corrección

## Criterio de ejecución

El orden priorizó detener primero cualquier pérdida o falsa confirmación de
datos, incorporar luego evidencia reproducible y recién después reemplazar los
flujos críticos por transacciones de servidor. Se mantuvo la arquitectura HTML
estática y no se realizaron escrituras contra Supabase productivo.

| Orden | Prioridad | Trabajo | Riesgo controlado | Criterio de cierre | Estado |
| ---: | --- | --- | --- | --- | --- |
| 1 | P0 | Contener certificaciones locales y eliminación automática de duplicados | Éxito falso, duplicación y pérdida irreversible | Ninguna mutación financiera confirma éxito sin servidor; duplicados sólo se diagnostican | Completado |
| 2 | P0 | Hacer reproducible el quality gate | Cambios sin detección de regresiones | Instalación con lockfile, controles estáticos y smoke Playwright en CI | Completado |
| 3 | P1 | Aislar sesión, caché y restauración | Datos de otro usuario y restauraciones parciales | Purga selectiva al salir, caché sólo autenticada y rollback ante restore fallido | Completado |
| 4 | P0 | Crear libro financiero e idempotencia en PostgreSQL | Saldos inconsistentes y doble consumo | RPC atómica, locks, clave idempotente, anulación trazable y tests runtime | Completado |
| 5 | P1 | Llevar mutaciones compuestas al servidor | Estados parciales de OC, circuito, links y borrado | Una transacción por intención de negocio y auditoría asociada | Completado |
| 6 | P0 | Aplicar autorización en servidor | Permisos basados sólo en botones o email | Perfiles activos, roles en RPC y RLS restrictiva | Completado |
| 7 | P1 | Segunda auditoría y estabilización | Regresiones y fronteras legacy omitidas | RLS legacy, URL segura, CSV neutralizado y dependencia CDN fijada | Completado |
| 8 | P1 | Validación previa al despliegue | Confundir prueba local con evidencia productiva | Suite local verde e informe explícito de pruebas humanas pendientes | Completado localmente |

## Reglas de cambio

- No borrar ni fusionar duplicados automáticamente: el preflight los informa y
  los índices detienen la migración hasta su resolución consciente.
- No sustituir trazabilidad por `DELETE`: los consumos financieros se anulan.
- No confiar en estado local para confirmar una escritura remota.
- No desplegar las migraciones directamente en producción: backup, staging,
  preflight, smoke autenticado y recién después promoción.
- Conservar compatibilidad visual donde no compromete la integridad; trasladar
  al servidor únicamente las invariantes críticas.

## Dependencias entre etapas

El quality gate quedó disponible antes de la refactorización transaccional. Las
RPC se implementaron antes de reactivar los botones que mutan datos. La segunda
auditoría se ejecutó sobre el resultado integrado y no sobre parches aislados.
