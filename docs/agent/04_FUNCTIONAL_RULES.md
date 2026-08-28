# 04 — FUNCTIONAL RULES

## OC
Una OC representa un contrato/orden. No duplicarla para representar estaciones o documentos.

## Tipo
- Obra
- Servicio

### Obra
Puede requerir avance, certificaciones, hitos y controles documentales.

### Servicio
Normalmente certificación mensual/periódica según contrato.

## Inicio y vencimiento
La fecha de Acta de Inicio es referencia clave cuando existe.
El vencimiento se deriva según fecha/plazo y ajustes válidos persistidos.

## Certificaciones
La certificación estructurada en Supabase tiene prioridad.

Para “última certificación”:
1. consultar certificaciones de la OC;
2. elegir la última con criterio funcional;
3. mostrar acta/período reales.

### Fallback documental
Si no hay certificación estructurada pero sí Acta de Medición documental:
- mostrar `Acta N° XX (documental)`;
- no inventar período;
- no inventar monto;
- no inventar avance;
- no crear fila estructurada silenciosamente.

## Acta de Medición
Identificar por metadata estructurada, nombre/archivo u observación inequívoca.
No inferir desde números ambiguos.

## Control de Terceros
Estados temporales basados en fecha local operativa. Evitar UTC accidental para “hoy”.

## Timeline
No sustituye órdenes/certificaciones/documentos/CT.

### Multi-OC
- mostrar cada OC separada;
- navegación individual;
- filtro/vista por OC;
- no concatenar.

Datos históricos: usar evidencia explícita y validar contra OCs reales.

## Documentos
No crear duplicados por reindexación.
Abrir PDF solo si Storage puede resolver el objeto.

## OC vencida con saldo
Puede seguir certificable si la regla operativa y el saldo lo permiten. No cerrar solo por fecha.

## Ficha OC
Consolidar OC, certificaciones, documentos, Timeline, CT, historial y estaciones desde fuentes correctas.

## Semáforos
- verde: en plazo;
- amarillo: próximo/atención;
- rojo: vencido/crítico;
- gris: cerrado/no aplicable según módulo.
