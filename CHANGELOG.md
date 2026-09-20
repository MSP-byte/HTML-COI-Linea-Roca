# CHANGELOG

## Fase 9 — RC1 del repositorio — 11/08/2026

### Estabilización

- Se eliminó el bypass de DML directo sobre órdenes y estaciones; las
  escrituras core quedan exclusivamente detrás de RPC autorizadas y auditadas.
- Alta/edición de OC, asociaciones de estación y cambio de principal son
  atómicos; el contrato exige exactamente una estación principal por OC.
- La idempotencia financiera queda ligada a usuario, operación y solicitud; se
  rechaza reducir el monto de una OC por debajo de su consumo confirmado.
- Se normaliza el número de OC para la unicidad y se protegen las identidades de
  posiciones; los reingresos al circuito generan una nueva traza.

### Evidencia local

- Seis migraciones aplicadas y reaplicadas en PostgreSQL embebido.
- Batería Node/integración aprobada, `npm audit` sin vulnerabilidades y ocho
  pruebas Playwright aprobadas en desktop/mobile.
- Validación HTML/CSS incorporada y workflow de Pull Request endurecido, sin
  deployment automático.

### Pendiente antes de producción

- Ejecutar backup, preflight, migración y smoke autenticado en staging.
- Publicar la rama, abrir el Pull Request y exigir GitHub Actions en verde.
- Resolver manualmente cualquier anomalía de datos reales informada por el
  preflight y aprobar la promoción a producción.

---

## V60.0.1 — 11/08/2026

### Integridad y seguridad

- Supabase pasa a ser la fuente de verdad de los datos operativos.
- Libro financiero atómico con locks, idempotencia, anulación y auditoría.
- RLS por perfil activo y rol para tablas de núcleo y tablas legacy detectadas.
- Edición de OC, circuito, links y borrado integral mediante RPC transaccionales.
- Aislamiento de caché por sesión y restore local con rollback.
- URLs históricas limitadas a HTTP(S) y exportación CSV protegida contra fórmulas.

### Calidad

- Dependencias fijadas por lockfile y `supabase-js` fijado en 2.112.2.
- Quality gate con controles estáticos, PostgreSQL embebido y smoke Playwright.
- Guías de despliegue, preflight, recuperación e informe final de auditoría.

### Pendiente antes de producción

- Aplicar las migraciones en staging con backup verificado.
- Completar smoke autenticado por rol y confirmar GitHub Actions en verde.

---

## V45 CONSOLIDADA - 24/06/2026

### Agregado
- Carga rápida diferenciada entre Obras y Servicios.
- Optimización para copy/paste desde Excel.
- Detección automática de moneda.
- Certificaciones automáticas.
- Borrado múltiple de OCs.

### Mejoras
- Optimización del módulo Órdenes.
- Mejor manejo de fechas.
- Mejoras visuales.

---

## V46 (En desarrollo)

### Pendiente
- Unidades de Mantenimiento.
- Fotos por UM.
- Dashboard financiero.
