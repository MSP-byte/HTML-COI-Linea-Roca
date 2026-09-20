# 01 — PROJECT OVERVIEW

## Nombre
**COI Línea Roca — Sistema Integrado de Gestión de Obras y Servicios**

## Propósito
Herramienta interna de seguimiento de:
- órdenes de compra;
- obras y servicios;
- contratos;
- certificaciones;
- Actas de Medición;
- Control de Terceros;
- documentación;
- vencimientos;
- alertas;
- Timeline/Mailing;
- estaciones;
- proveedores;
- trazabilidad administrativa.

## Tecnología
- `index.html` único;
- HTML/CSS/JS vanilla;
- Supabase JS;
- PostgreSQL;
- Supabase Storage;
- GitHub/GitHub Pages;
- Playwright.

## Módulos
- Inicio Operativo;
- Órdenes de Compra;
- Ficha Individual de OC;
- Calendario COI;
- Centro de Alertas;
- Red Línea Roca;
- Carga Operativa;
- Timeline COI;
- Administración.

## Flujo conceptual
OC → inicio → ejecución → documentación → certificaciones → CT → vencimiento → cierre/archivo.

## Conceptos
### OC
Orden de Compra con `nro_oc` funcionalmente único.

### Obra
Puede requerir avance, hitos y certificaciones.

### Servicio
Normalmente certificación periódica/mensual según contrato.

### Certificación
Registro estructurado de ejecución certificada.

### Acta de Medición
Documento de respaldo. Puede existir en Storage aunque aún no exista fila estructurada en certificaciones.

### Timeline
Trazabilidad auditable. No reemplaza entidades estructuradas.

## Prioridad
Si existe conflicto entre caché local, dato derivado y dato persistido, prevalece Supabase salvo regla funcional documentada.
