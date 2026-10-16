# COI Línea Roca V2 — Evolución incremental sin regresiones

## Base autorizada
- Base: PR #135 fusionado a \`main\` (16/10/2026).
- **No reescribir el HTML desde cero.** Mantener navegación, Red Roca, OC, Ficha OC, carga, calendario, alertas, UM, timeline, administración, Supabase/RLS, historial y todos los circuitos contractuales/financieros existentes.
- Cada fase se implementa en rama/PR aislado y exige aprobación QA previa al merge.

## Arquitectura de información
1. **Inicio operativo / resumen gerencial:** lectura consolidada, indicadores de origen conocido, accesos a tareas.
2. **Cartera de Obras:** reutilizar el módulo V8/V9 y su importación de consulta; proyecto/necesidad no es OC. La fila Excel, el número de obra y la OC no son claves únicas de proyecto.
3. **Mantenimiento:** vista de contratos de tipo Servicio. Distinguir \`modalidad_certificacion\`: MENSUAL, A_DEMANDA y no definida; no derivar ninguna mensualidad de una OC a demanda.
4. **Ficha OC única:** mantener módulo actual, agregando secciones contextuales *sin duplicar* edición, saldos ni certificaciones.
5. **Certificaciones:** vínculo trazable MED, remitos, informes, posición SAP, HES y saldo, respetando procesos vigentes.
6. **Control de Terceros:** conservar edición existente de \`control_terceros_hasta\` y su estado. DDJJ, seguro de vida y ART son controles internos, no aprobaciones automáticas ni copias de SERCAE.

## Qué entrega este PR (fase inicial)
- Dashboard read-only de Mantenimiento, nueva entrada visible en la navegación junto a Cartera de Obras.
- Clasificación a partir de OC reales de la sesión autenticada: especialidad, modalidad contractual, vencimiento, contratista y estaciones.
- Filtros por especialidad, modalidad y vigencia; búsqueda y ordenamiento.
- Apertura de la Ficha OC original, sin nuevos formularios ni persistencia.
- Fuente única: \`todasLasOC()\` tras autenticación. No escribe Supabase, localStorage ni cachés y no consulta datos de otras cuentas.
- El módulo Cartera de Obras existente permanece sin alteraciones.

## Fases siguientes (pendientes)
### Fase 2 — Ficha OC contextual
- Encabezado común: OC, contratista, alcance contractual, moneda, vigencia, posición SAP.
- Obra: hitos, avance físico, avance certificado, vencimiento y cierre, sin equiparar avance Excel a HES.
- Servicio: contratos/equipos cubiertos y accesos a ciclos mensuales o trabajos a demanda. Conservar todos los controles, documentación y edición actuales.
- Control de Terceros fecha editable ya implementada; tres documentos SERCAE como **referencias de control**, no acreditaciones sustitutas.

### Fase 3 — Entidades de mantenimiento y ciclos
- Inventario de equipos (UM) vinculado a OC, estación y cobertura contractual.
- Tabla separada para \`coi_ciclos_mantenimiento\` por OC + período + equipo/servicio cuando corresponda, con controles de unicidad según pliego.
- Tabla \`coi_intervenciones_demanda\` con trabajo realizado, fecha, equipo, remito, posiciones y seguimiento.
- Las certificaciones de cada ciclo o intervención referencian el circuito existente; nunca crear circuito financiero paralelo.
- Antes de migrar: especificación de datos, RLS, roles, índices, política de auditoría, backup, rollback y pruebas staging.

### Fase 4 — Cartera estructurada
- Proyecto persistente con UUID propio y relación N:M con OC (documento FASE1_CARTERA_V8.md).
- Precedencia Excel vs Supabase por campo, resolución de duplicados y conciliación manual.
- Sostener el Excel V8 en modo lectura hasta aprobar la sincronización.

### Fase 5 — Resumen gerencial / QA integral
- KPIs separados de ejecución de obras, contratos y cumplimiento de mantenimientos.
- Escenarios Chromium desktop/mobile, tests unitarios, seguridad RLS, enlaces Red Roca, datos faltantes y flujos completos.
- No permitir merge con regresiones ni sin revisión de volumen de 3 MB de index.html.

## Regla de negocio esencial
Una **OC de mantenimiento mensual** no tiene un porcentaje de avance que sustituya el estado de todos los meses. Un **trabajo a demanda** no se convierte en ciclo mensual por compartir empresa o equipo. Las prestaciones deben vincularse a las posiciones SAP correspondientes, y sus certificaciones a MED/HES reales.

## Criterios de aceptación del módulo inicial
- No modifica los scripts, formularios, RPC ni migraciones actuales.
- No crea indicadores ficticios: recuentos basados en OC únicas y campos existentes.
- Ausencia de sesión: ningún dato operativo es visible en la vista nueva.
- Filtros, navegación y retorno a Ficha OC funcionan en Chrome/Edge.
- Contratos multiestación no duplican el recuento por OC.
- Contratos sin modalidad quedan como "Sin definir" (no se inventan mensualidades).
- Verificar QA en Chromium desktop y móvil y comprobar que #135 continúa sin regresiones.
