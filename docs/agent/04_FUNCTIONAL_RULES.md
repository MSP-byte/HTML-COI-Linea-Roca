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

## Cerrar OC
Finalización **operativa / contractual**. Se cierra cuando la OC está finalizada
o vencida, no queda saldo operativo pendiente y no quedan certificaciones o
actividades pendientes.

Cerrar **no** es archivar: la OC cerrada sigue figurando en los listados e
historiales que le corresponden.

Escribe `estado_coi = 'Cerrada'`, `fecha_cierre_operativo` y
`observacion_cierre`, por la RPC canónica. **Nunca** `estado_registro`.

El primer cierre confirmado es **inmutable**. La migración
`202609070001_h10_order_lifecycle_guard.sql` instala guards `BEFORE UPDATE` en
PostgreSQL: fecha y observación de cierre solo pueden escribirse en la primera
transición válida y no pueden sobrescribirse después, aunque dos operadores
intenten cerrar la misma OC de forma concurrente.

La transición inicial debe ser completa en una sola escritura: estado Cerrada,
fecha y observación. Un intento incompleto se rechaza fail-closed. El editor
genérico de OC no ofrece los campos de auditoría del cierre ni permite entrar o
salir de Cerrada; para eso se usa la acción específica «Cerrar OC».

El sistema no bloquea el cierre por saldo ni por actividad pendiente: no tiene
una fuente canónica para eso. Informa el vencimiento, avisa si figura una
certificación pendiente y decide el operador. Ver KI-030.

## Archivar OC
Gestión del **historial**. Una OC archivada no se borra, se conserva completa,
sigue siendo consultable, sale de la operación diaria, pasa al grupo
«Archivadas» y puede desarchivarse.

Solo se archiva una OC **cerrada**:

    EN EJECUCIÓN → Cerrar OC → CERRADA → Archivar OC → CERRADA + ARCHIVADA

Cerrar no archiva automáticamente. Son dos decisiones distintas.

Escribe `estado_registro = 'Archivado'`. **Nunca** `estado_coi`.

La regla «cerrar antes de archivar» también se aplica en PostgreSQL por el guard
H10. No depende solo del botón: un intento directo por RPC de archivar una OC
abierta se rechaza. `estado_registro` tampoco forma parte de la edición genérica
de OC; Archivar/Desarchivar son transiciones controladas.

El cierre histórico legado `estado_registro = 'Cerrado'` se reconoce para
compatibilidad, pero antes de reemplazar ese marcador por `Archivado` se
canonicaliza el cierre en el eje operativo. Si la preservación falla, no se
archiva.

## Desarchivar OC
Cambia únicamente la condición de registro: `Archivado → Activo`.

**No reabre** la contratación. Una OC cerrada y archivada, al desarchivarse,
queda cerrada y activa en el registro. Nunca vuelve a «En ejecución».

## Navegación y URL
`location.hash` conserva vista, entidad y subpestaña, de modo que F5 y
Atrás/Adelante mantienen el contexto de trabajo. Es estado de navegación, **no**
autoridad de datos: el dato sigue viniendo de Supabase, y la ruta se interpreta
recién después de que la identidad y los datos autoritativos estén disponibles.

Una OC archivada es alcanzable por URL directa y por el buscador global aunque
el filtro del listado esté en Activas. Una ruta a una OC inexistente informa y
ofrece volver a Órdenes; no deja pantalla en blanco ni redirige en silencio.

Timeline también tiene ruta persistente (`#timeline`). Una ruta incompleta
`#ficha-um` sin identificador no reutiliza la UM anterior: limpia la identidad y
vuelve al inventario `#um`.

## Seguimiento contractual y ejecución — máquina de estados de 10 hitos

Supabase es la fuente única de verdad: `coi_ordenes.estado_documental` (estado
vigente) y `coi_historial_oc` (transiciones). Todo lo que muestra la Ficha se
**deriva**; no existen campos `hitos_registrados` ni `dias_en_estado`.

### Hitos lógicos

| Hito | Código(s) | Etapa visual |
|---|---|---|
| H1 | `pliegos_preparacion` | 1° Etapa |
| H2 | `pliegos_terminado_sin_solped` | 1° Etapa |
| H3 | `solped_sin_expediente` | 1° Etapa |
| H4 | `pliego_con_oc` | 1° Etapa |
| H5 | `pliego_con_expediente` | 1° Etapa |
| H6 | `oc_sin_control_terceros` | 1° Etapa |
| H7 | `control_terceros_sin_acta` | 1° Etapa |
| H8 | `control_terceros_con_acta` | 1° Etapa (cierra la 1° Etapa) |
| H9 | `ejecucion` | 2° Etapa |
| H10 | `finalizada` · `finalizada_actas` · `finalizada_saldo_remanente` | 2° Etapa |
| — | `cancelada_suspendida` | Estado **transversal** |

Hay más tarjetas que hitos: H10 tiene tres tarjetas (variantes de cierre) y la
transversal tiene la suya. Cambiar de variante de cierre (FINALIZADA →
FINALIZADA CON ACTAS) registra una transición real pero **no** suma un hito.

### Transiciones

Cada confirmación nueva o reingreso del writer `coi_confirmar_etapa_circuito_v3`
escribe una fila `Circuito administrativo` (y su espejo `Cambio de estado
contractual`, que no cuenta dos veces). Una reconfirmación del estado vigente es
**idempotente**: no escribe filas, no cambia `fecha_ultimo_control` y, con la
misma fecha, no cambia nada observable.

Los hitos pueden saltarse (H2 → H5 → H9 → H10). No se completan los salteados;
la Ficha advierte «Existen hitos intermedios sin registrar.» sin bloquear.

### Contadores derivados

- **Hitos registrados X / 10**: hitos lógicos distintos con al menos una
  transición real en `coi_historial_oc`. No es posición, ni eventos, ni clicks,
  ni tarjetas. `estado_documental` o `fecha_acta_inicio` sin traza no cuentan.
  La transversal no cuenta. Es global: no se reinicia en la 2° Etapa.
- **Estado actual**: `estado_documental` resuelto contra el catálogo; solo si es
  texto legacy no resoluble, el hito lógico más avanzado con transición.
- **Última actualización**: `fecha_evento` de la última transición real.
- **Días en estado**: HOY − `fecha_efectiva` del **último ingreso real** al
  estado vigente (un reingreso reinicia el conteo; el período anterior se
  conserva).
- **Duración de un estado ya dejado**: congelada = fecha efectiva de la
  transición real siguiente − fecha efectiva propia. Los hitos salteados no
  tienen duración.

`fecha_efectiva` es la fecha contractual; `fecha_evento` es auditoría técnica.
Las duraciones se calculan por día administrativo de Buenos Aires.
