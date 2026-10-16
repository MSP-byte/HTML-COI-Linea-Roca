# Fase 1 — Conciliación BASE_OBRAS V8 con COI

## Alcance aprobado (15/10/2026)
- Rama de trabajo aislada; sin merge a main.
- Sin escritura en Supabase producción y sin alteración de certificaciones ni cierres.
- El circuito H1–H8 y la RPC `coi_confirmar_etapa_circuito_v2` permanecen intactos.
- La fase 1 implementa importación **de consulta y prevalidación** de BASE_OBRAS, no sincronización persistente.

## Inventario comprobado del Excel
- Libro `OBRAS_LGR_PANEL_V8.xlsx`, hoja `BASE_OBRAS`, encabezado fila 3, registros desde fila 4; columnas A:AH.
- Campos de uso: A N° OBRA; B PRIORIDAD; C LUGAR; D DENOMINACIÓN / PLIEGO; E ESTADO; F TRELLO; G N° SEGUIMIENTO; H FECHA PRESUPUESTADO; I SM; J NECESIDAD; K FECHA COTIZACIÓN; L COTIZACIÓN; M SOLPED; N FECHA SOLPED; O EXPEDIENTE; P VISITA; Q FECHA DICTAMEN TÉCNICO; R OC; S FECHA OC; T CONTROL DE 3°; U CONTRATISTA; V CUIT; W TELÉFONO; X ACTA DE INICIO; Y INSPECTOR; Z PLAZO DÍAS (PLIEGO); AA FINAL PROYECTADO; AB FINAL REAL; AC AVANCE ACUMULADO; AD ÚLTIMO AVANCE; AE FECHA ÚLTIMO AVANCE; AF EJECUTADO; AG OBSERVACIONES; AH ORDEN COINCIDENCIA BUSCADOR.
- Otras hojas: DASHBOARD, BUSCADOR, AVANCES OBRA, LISTAS: no se importan en fase 1.
- AF (EJECUTADO) calculado desde L × AC: **no representa certificación SAP verificada**.

## Reglas de conciliación
1. No deducir identidad estable de la fila del Excel, ni de N° OBRA (repetido), ni de OC (posible 1:N / N:M). La fila es referencia **temporal para el lote**, nunca UUID ni PK.
2. Solo buscar coincidencias de OC contra `coi_ordenes` para diagnóstico: **no crear ni sobrescribir OC**.
3. Comprobar acceso de solo lectura mediante sesión y RLS existentes. Cuando falla, mostrar que conciliación remota no está disponible.
4. No confirmar H1–H8 por presencia de una columna Excel. La evidencia sugerida se revisa manualmente.
5. No modificar `coi_historial_oc`, `coi_certificaciones`, `coi_ordenes_estaciones`, fecha de acta, cierres, estados o saldos.
6. Cuantificar filas sin OC, OC ausentes en COI, conflictos de estado, formatos inválidos y N° OBRA duplicados; permitir exportar informe de auditoría CSV.
7. No persistir datos del Excel en localStorage, sessionStorage o Supabase durante prevalidación. Todo se conserva solo en memoria hasta cerrar la vista.
8. La carga se realiza con un selector de archivo local, compatible con Chrome/Edge, sin subida a servidor.

## Fase posterior (no implementada ni autorizada aún)
- Crear entidad `coi_cartera_proyectos` con UUID, identidad persistente y tabla de relación N:M con OC.
- Definir RLS por rol, migración reversible y trazabilidad por proyecto antes de las primeras escrituras.
- Definir precedencia campo por campo antes de sincronizar contra Supabase.
- Backfill controlado para contratos existentes y conexión a H1-H8 sin doble circuito.

## Verificación funcional exigida antes de merge
- Abrir el HTML sin conexión y confirmar que los módulos anteriores funcionan.
- Importar libro real, corroborar 117 intervenciones y revisar encabezados y formatos.
- Confirmar que ninguna acción nueva escribe a Supabase (Network: solo SELECT).
- Diferenciar OC en Supabase, OC faltante y "Sin OC"; no afirmar ausencia si SELECT falla.
- Revisar duplicados reales, anulación/cierre, formularios, navegación y CSS responsive.
- Exportar auditoría en CSV con codificación UTF-8 BOM para Excel español.
