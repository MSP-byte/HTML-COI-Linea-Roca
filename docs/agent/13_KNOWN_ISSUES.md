# 13 — KNOWN ISSUES

Documento vivo.

## KI-001 — Duplicación de lógica en index.html
Estado: deuda técnica permanente.
Riesgo: funciones/listeners/globals solapadas.
Mitigación: auditoría, búsqueda previa y tests funcionales.

## KI-002 — Timeline histórico multi-OC
Estado: en seguimiento.
Algunos eventos históricos pueden contener OCs concatenadas.
Regla: recuperar desde evidencia explícita, validar contra OCs reales y no inventar.

## KI-003 — Duplicados documentales históricos
Estado: en seguimiento.
Posibles importaciones/reindexaciones duplicadas.
No borrar sin autorización. Deduplicar lectura de forma segura.

## KI-004 — Playwright/python3 en Windows
Estado: entorno.
El alias python3 puede apuntar a Microsoft Store. No cambiar producción solo por este entorno.

## KI-005 — Tests estáticos insuficientes
Estado: lección incorporada.
Cambios funcionales importantes requieren Playwright real.

## Actualización
Registrar PR, fecha, resolución y test de regresión.
