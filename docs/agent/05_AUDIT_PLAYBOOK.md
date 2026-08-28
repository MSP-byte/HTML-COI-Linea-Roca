# 05 — AUDIT PLAYBOOK

## Objetivo
Auditar el sistema sin introducir cambios prematuros. Una auditoría comienza en modo lectura.

## Prioridades
- P0 — crítico: pérdida de datos, escritura incorrecta, bypass de permisos, sistema no inicia.
- P1 — alto: módulo principal roto, persistencia incorrecta, localStorage como autoridad, botón crítico inoperable.
- P2 — medio: duplicados, navegación inconsistente, información incompleta, UX que induce error.
- P3 — mejora: deuda técnica, limpieza, documentación, micro UX.

## Auditoría JavaScript
Buscar:
- `ReferenceError`;
- variables usadas antes de inicializar;
- funciones/globals duplicadas;
- listeners múltiples;
- `stopImmediatePropagation`;
- capture listeners;
- race conditions;
- Promises no esperadas;
- errores tragados;
- `catch {}` vacíos;
- código muerto;
- ramas legacy.

## Auditoría Supabase
Buscar:
- localStorage como autoridad;
- escrituras locales previas a Supabase;
- queries sin filtro;
- filtro por OC incorrecto;
- datos duplicados;
- RLS/RPC incompatibles;
- columnas frontend incompatibles;
- signed URLs;
- indexación Storage no idempotente.

## Auditoría documental
Revisar identidad, duplicados, bucket/path, metadata, PDF, sincronización Storage→DB e idempotencia.

## Auditoría Timeline
Revisar carga, render, multi-OC, filtros, navegación, persistencia, Mailing, CT y errores runtime.

## Auditoría Ficha
Revisar indicadores, Obra/Servicio, certificaciones, vencimiento, CT, documentos, historial y botones.

## Auditoría UI
Verificar botones muertos, acciones ambiguas, scroll, responsive, campos sin label, datos cortados y estados vacíos.

## Auditoría Testing
Mapear:
funcionalidad productiva → test → tipo de test → cobertura real.

Detectar tests que solo buscan strings.

## Formato de hallazgo
```text
ID:
Prioridad:
Módulo:
Evidencia:
Causa probable:
Impacto:
Reproducción:
Archivos/funciones:
Propuesta:
Riesgo:
Tests necesarios:
```

## Regla
Primero entregar informe. No modificar hasta autorización.
