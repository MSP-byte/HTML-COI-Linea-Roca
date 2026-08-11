# CHANGELOG

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
