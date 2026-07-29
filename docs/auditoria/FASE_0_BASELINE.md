# Fase 0 — Línea base, inventario y quality gate

## Identificación

- **Fecha de auditoría:** 2026-07-29 (UTC).
- **Archivo auditado:** `index.html` del commit base `75b52f6`.
- **Versión visible detectada:** `V59.6-CACHE-SEGURO`, declarada en `VERSION` y expuesta mediante `window.COI_CONFIG`.
- **Naturaleza de la auditoría:** análisis estático y de sintaxis. No se ejecutó la aplicación en un navegador.
- **Estado de datos:** solo lectura. El control no evalúa JavaScript de la aplicación, no accede a red y no inicializa Supabase.

## Inventario técnico

| Elemento | Resultado de línea base | Método / criterio |
| --- | ---: | --- |
| Scripts inline | 36 | Bloques `<script>` sin atributo `src` |
| Bloques style | 25 | Aperturas `<style>` |
| Vistas principales | 14 | IDs estáticos con prefijo `vista` |
| IDs HTML estáticos | 244 | Atributos `id` fuera de scripts; no incluye plantillas dinámicas |
| IDs estáticos duplicados | 0 | Duplicados sobre los 244 IDs estáticos |
| Declaraciones de función duplicadas | 142 nombres | Coincidencias nominales; incluye ámbitos/IIFE distintos y capas de compatibilidad |
| Listeners documentales globales | 149 | Llamadas a `document.addEventListener(...)` |
| MutationObserver | 7 | Construcciones `new MutationObserver(...)` |
| setInterval | 3 | Llamadas a `setInterval(...)` |
| setTimeout | 182 | Total; 2 tienen duración literal igual o mayor a 10 segundos |
| Claves localStorage | 42 claves clasificadas en el registro central | 12 DATA, 7 SERVER_CACHE, 3 PENDING, 3 DRAFTS, 5 UI_CACHE, 11 SESSION y 1 DIAGNOSTIC; además hay 1 prefijo de sesión, 4 referencias legacy protegidas y aliases históricos fuera del registro |
| Tablas Supabase referenciadas | 13 identificadas | `profiles`, `coi_ordenes`, `coi_ordenes_estaciones`, `coi_certificaciones`, `coi_documentos_oc`, `coi_historial_oc`, `coi_timeline_events`, `coi_links_documentales`, `coi_auditorias_calidad`, `coi_auditoria_global`, `coi_sesiones`, `coi_documentos_versiones` y `coi_security_health_checks` |
| Buckets Storage referenciados | 1 | `coi-documentos` |
| Clientes Supabase inicializados | 1 | Una llamada a `createClient(...)` |
| Tamaño de index.html | 2.321.654 bytes | `wc -c index.html` |
| Líneas de index.html | 24.810 | `wc -l index.html` |

> **Nota sobre funciones duplicadas:** el conteo es conservador y estático. Un mismo nombre en IIFE o ámbitos distintos no implica por sí solo una colisión en tiempo de ejecución. La repetición sí señala una superficie de mantenimiento que debe estudiarse antes de consolidar código.

### Claves de almacenamiento local

El registro central `COI_STORAGE` agrupa las claves en datos operativos, caché de servidor, operaciones pendientes, borradores, preferencias/caché visual, sesión y diagnóstico. También se detectaron aliases y claves históricas fuera del registro (por ejemplo, `coi_admin_*`, `coi_linea_roca_fotos_*`, `coi_certificaciones*`, `coi_documentos_storage_cache_v1`, `coi_supabase_*`, `coi_backup_*` y bloqueos `coi_is*`). Para evitar exponer estado de usuarios, este informe registra nombres o familias técnicas, no valores almacenados.

### Módulos principales detectados

Dashboard, Red Línea Roca, Órdenes, Carga, Calendario, Timeline, Administración, Centro de Alertas, Control de Terceros, Carga Financiera, Posiciones, Consumos, Documentos, Certificaciones, Unidades de Mantenimiento, Buscador y Acerca del Sistema.

## Quality gate incorporado

`tests/check_baseline.js` lee el HTML como texto, extrae cada script inline en un directorio temporal del sistema y ejecuta `node --check` por bloque. También comprueba estructura balanceada, DOCTYPE único, ausencia de conflictos, IDs estáticos únicos, módulos esenciales, indicador de versión, ausencia de `onclick` y patrones de secretos críticos. Los temporales se eliminan al terminar.

El workflow ejecuta el control en pull requests hacia `main`, pushes a ramas distintas de `main` y bajo demanda. No instala dependencias, no requiere secretos, no inicia el HTML, no contacta Supabase, no escribe datos productivos y no despliega.

## Riesgos encontrados

### Críticos

- **Credenciales del cliente en un archivo público:** aunque el gate bloquea `service_role` y claves privadas, la configuración pública debe revisarse junto con Auth/RLS en una fase específica. No se incluyen credenciales ni valores en este informe.
- **Gran superficie operativa en un único archivo:** 2,32 MB y 24.810 líneas concentran UI, datos demo, persistencia y acceso remoto; un cambio localizado puede producir efectos globales difíciles de aislar.

### Altos

- **142 nombres de función repetidos:** existen capas sucesivas y wrappers que pueden reemplazar referencias globales según el orden de carga.
- **149 listeners sobre `document`:** existe riesgo de registro repetido, propagación inesperada y degradación al re-renderizar.
- **Persistencia distribuida:** hay aliases históricos además de las 42 claves clasificadas en el registro central; una limpieza o migración sin inventario dinámico podría borrar datos operativos o sesión.
- **Operaciones remotas en el código productivo:** se detectan lecturas y escrituras Supabase/Storage. El gate es estrictamente estático y nunca ejecuta esas rutas.

### Medios

- **7 MutationObserver, 3 intervalos y 182 timeouts:** el trabajo asíncrono puede acumularse o competir entre capas; dos esperas literales alcanzan al menos 10 segundos.
- **Plantillas HTML dinámicas:** el chequeo de IDs estáticos no puede garantizar por sí solo unicidad en el DOM después de renderizar datos.
- **Validación sintáctica no equivale a ejecución:** `node --check` detecta errores de parseo, pero no incompatibilidades DOM, problemas de navegación ni errores de integración.

## Módulos que requieren prueba de navegador antes de modificarse

No deben modificarse sin prueba en navegador real: Dashboard, Red Línea Roca, Órdenes/Ficha OC, Carga e importadores, Calendario, Timeline, Administración, Centro de Alertas, Control de Terceros, Carga Financiera, Posiciones y Consumos, Documentos, Certificaciones, Auth y flujos Supabase/Storage. La prueba debe incluir navegación, consola, persistencia controlada y roles autorizados en un entorno no productivo.

## Recomendaciones para las fases siguientes

1. Crear una matriz de humo en navegador por módulo, rol y fuente de datos antes de refactorizar.
2. Agregar fixtures aislados y un entorno Supabase de prueba; nunca usar credenciales ni tablas productivas en CI.
3. Instrumentar el registro y desmontaje de listeners, observers, intervalos y timeouts para detectar duplicaciones.
4. Resolver nombres de función repetidos por ámbito y precedencia, con pruebas de caracterización antes de consolidarlos.
5. Ampliar el inventario de localStorage en navegador con valores anonimizados y clasificar cada alias antes de migrar o eliminar claves.
6. Validar IDs generados después de renderizar cada vista con datos sintéticos.
7. Separar gradualmente configuración, acceso a datos y módulos de UI conservando una versión single-file generada como artefacto, si el modelo de despliegue lo exige.

## Declaraciones de alcance

- No se modificó `index.html`, su lógica, sus estilos ni sus datos.
- No se ejecutó una prueba de navegador real y no se afirma que el sistema esté libre de errores.
- No se realizaron `insert`, `update`, `upsert`, `delete`, `upload`, `remove`, escrituras productivas en localStorage ni cambios en Supabase, Auth, RLS o Storage.
