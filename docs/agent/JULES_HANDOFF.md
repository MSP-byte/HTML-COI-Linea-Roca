# JULES_HANDOFF — Documento maestro para agentes nuevos

> **Estado documental reconciliado al 2026-09-29.** Handoff integrado en `main` por PR #110 (`93cd1c03`). El estado Supabase indicado abajo fue verificado en vivo el 2026-09-29.
> Todo lo que sigue se extrajo del código, las migraciones, los tests y el
> historial Git reales. Si algo de acá contradice el repositorio, **manda el
> repositorio**: verificá, corregí este documento y dejalo explicado en el PR.
>
> Este documento **no reemplaza** a `docs/agent/01…18`: los resume, los
> referencia y agrega lo que no estaba escrito. Cuando un tema ya tiene
> documento propio, acá hay un resumen y el link.

---

## 1. Objetivo del sistema

**COI Línea Roca — Sistema Integrado de Gestión de Obras y Servicios.**
Tablero operativo interno de la Gerencia de Obras e Ingeniería de la Línea
General Roca (SOFSA) para seguir Órdenes de Compra (OC) de **Obras** y
**Servicios**: circuito contractual, Acta de Inicio, vencimientos,
certificaciones, Control de Terceros (CT), documentación, observaciones,
Timeline/Mailing, estaciones de la red y Unidades de Mantenimiento (UM).

- Producción: GitHub Pages publica `main` → `https://msp-byte.github.io/HTML-COI-Linea-Roca/`
- Datos: Supabase (proyecto `ooepgbzqlpjrtpaoqawc`).
- Usuarios: autenticados con Supabase Auth; rol en `public.profiles`.

Ver también `01_PROJECT_OVERVIEW.md`.

## 2. Arquitectura general

```text
Navegador (Chrome/Edge, desktop y mobile)
   └── index.html  (único artefacto productivo: HTML + 37 <style> + 59 <script>)
         └── supabase-js 2.112.2 (CDN jsDelivr, fallback unpkg)
               ├── PostgreSQL (tablas coi_*, RLS por rol, RPC transaccionales, triggers guard)
               ├── Auth (sesión en sessionStorage)
               └── Storage (bucket privado coi-documentos, sólo lectura desde el front)
```

- **Sin backend propio, sin bundler, sin framework.** No introducirlos sin autorización.
- **Supabase es la fuente única de verdad.** El navegador no guarda autoridad.
- **Modo online-only (H11, PR #66):** `index.html` tiene **cero** referencias a
  `localStorage` (lo verifica `tests/check_h11_online_only.js`). Lo que antes
  vivía en localStorage hoy vive en `sessionStorage` (volátil, por pestaña). Ver §10.
- **Arquitectura por capas superpuestas ("patch layers").** El script base
  (línea ~2428, ~846 KB) define el modelo original V45–V58. Encima se montan
  ~57 bloques `<script id="coi-…">` que **reemplazan o envuelven** funciones
  globales (`renderOrdenes = renderOrdenesFix`, `todasLasOC = wrapper…`).
  **En un script clásico gana la última declaración**: que exista una función
  no prueba que se ejecute (KI-033). Verificá el DOM, no el símbolo.

Ver `02_ARCHITECTURE.md`.

## 3. Stack

| Capa | Tecnología | Versión / nota |
|---|---|---|
| Front | HTML5 + CSS + JS vanilla (ES2020+) | un solo `index.html` |
| Cliente datos | `@supabase/supabase-js` | **2.112.2 fijado** (CDN) |
| DB | PostgreSQL (Supabase) | 53 migraciones versionadas |
| Tests estáticos/SQL | Node ≥ 22 + `@electric-sql/pglite` 0.5.4 | aplica las migraciones en PGlite |
| Validadores | `html-validate` 11.6.2, `css-tree` 3.1.0 | |
| E2E | `@playwright/test` 1.62.1 | Chromium desktop + Pixel 5 |
| CI | GitHub Actions `quality-gate.yml` | ~22 min en main |
| Hosting | GitHub Pages desde `main` | `.nojekyll` |

## 4. Estructura del repositorio

```text
index.html                       ← PRODUCTO (≈3,0 MB, ≈36.500 líneas)
AGENTS.md / CLAUDE.md            ← reglas para agentes (leer primero)
README.md                        ← manual de usuario (parcialmente desactualizado, ver §22)
BASELINE_OPERATIVA.md            ← baseline v1.0.0-operativa (2026-08-22, histórico)
CHANGELOG.md                     ← hasta Fase 9 / RC1 (no se mantuvo después)
package.json / playwright.config.js / .htmlvalidate.json
.github/workflows/quality-gate.yml
supabase/migrations/*.sql        ← 53 migraciones (fuente de verdad del schema)
supabase/README.md, PREPRODUCCION.md ← runbooks de despliegue DB
tests/                           ← 44 checks Node + 43 specs Playwright + fixtures/
tests/fixtures/production_schema_contract.json ← snapshot schema PRODUCCIÓN + divergencias
docs/agent/                      ← manual del agente (este archivo y 01…18)
docs/auditoria/                  ← evidencia histórica de fases 0–9 / RC1 / RC2
.coi-qa/                         ← scripts PowerShell de diagnóstico de staging (qa:*)
assets/                          ← imágenes
index_PRE_*.html, TEST_*.log/json, *_FIX.md ← residuos históricos (ver §22, NO borrar sin autorización)
test_imputacion_posiciones.js    ← raíz, pero SÍ lo usa `npm run test:unit`
```

## 5. Entry points

| Entry | Qué es |
|---|---|
| `index.html` | Única página. Todo el producto. |
| `#<ruta>` (hash) | Routing H10 (script `coi-h10-routing-hash`). |
| `npm test` | Quality gate estático + SQL local (PGlite). |
| `npx playwright test` | E2E. |
| `supabase/migrations/` | Schema; se aplican **a mano y con autorización** (no hay CI de deploy DB). |

### Rutas (hash) — H10

| Ruta | Vista (`id`) |
|---|---|
| `#inicio` | `vistaDashboard` |
| `#ordenes[/activas\|archivadas\|todas]` | `vistaOrdenes` |
| `#calendario` | `vistaCalendarioCOI` |
| `#vencimientos` | `vistaCalendarioVencimientos` |
| `#certificaciones-calendario` | `vistaCalendarioCertificaciones` |
| `#alertas` | `vistaCentroAlertas` |
| `#red`, `#estacion/<nombre>` | `vistaRed` |
| `#um`, `#um/servicios` | `vistaUnidadesMantenimiento` |
| `#ficha-um/<id>` | `vistaFichaUM` |
| `#carga` | `vistaCarga` |
| `#buscador` | `vistaBuscador` |
| `#timeline` | `vistaTimelineCOI` |
| `#administracion` | `vistaAdministracionSistema` |
| `#acerca` | `vistaAcercaSistema` |
| `#ficha-oc/<nro>[/resumen\|contractual\|certificaciones\|financiero\|documentos\|fotos\|observaciones]` | `vistaFichaOC` |

El hash es **estado de navegación, no de datos**: se interpreta recién después
de sesión + identidad + datos autoritativos (TD-072). No hay `popstate`; se usa
`hashchange`.

## 6. Inicialización (secuencia real de carga)

1. `<head>` → `coi-supabase-config`: `window.__COI_SUPABASE_CONFIG__` (URL + **publishable key**, pública por diseño; la seguridad es RLS).
2. `coi-supabase-early-bootstrap`: carga supabase-js (jsDelivr → unpkg), expone `window.__coiSupabaseReady` (Promise) y `window.__COI_STARTUP_METRICS__`.
3. `coi-auth-h14-prelock`: añade `coi-h14-locked` → la app queda bloqueada hasta tener sesión (login H14/H15).
4. `coi-orders-startup-gate-head`: `window.__COI_ORDERS_STARTUP_GATE__`. Oculta Órdenes hasta lectura remota confirmada (`data-coi-orders-state`: pendiente → cargando → listo | error). `setInterval(sync,180)` hasta resolver.
   - ⚠️ **Bypass E2E**: en `127.0.0.1:4173` con `navigator.webdriver` el gate se salta, salvo `?coi_force_startup_gate`. Los tests que prueben el gate deben forzarlo.
5. Script base (`~L2428`): modelo, helpers, render V45–V58.
6. Capas superpuestas en orden de aparición (R12, R17 Timeline, R20 certificaciones, `coi-supabase-principal-v2`, V60, H03…H14, `coi-etapa1-pipeline-contractual`, `coi-certificaciones-historial`).
7. ~60 handlers `DOMContentLoaded` + 9 `load` + múltiples `setTimeout(init,…)` inician módulos. **El orden importa y es frágil.**
8. Auth: `supabase.auth` con `storage: window.sessionStorage` → evento `coi:supabase-auth` → lectura de `profiles` / `coi_current_role()` → carga de `coi_ordenes` → gate "listo" → routing H10 interpreta el hash.

## 7. Modelo de datos (resumen)

Fuente: `supabase/migrations/` + `tests/fixtures/production_schema_contract.json`. Detalle en `03_SUPABASE_DATA_MODEL.md`.

| Tabla | Rol | Notas |
|---|---|---|
| `coi_ordenes` | **OC. Entidad maestra.** `id` UUID = identidad técnica; `nro_oc` único funcional (normalizado) | dos ejes de estado: `estado_coi` (operativo) y `estado_registro` (Activo/Archivado); `estado_documental` = hito contractual vigente; `fecha_acta_inicio`, `plazo…`, `fecha_vencimiento`, `proxima_certificacion`, `modalidad_certificacion` (**desplegada en STAGING y PRODUCCIÓN el 2026-09-29**) |
| `coi_ordenes_estaciones` | OC ↔ estaciones (exactamente una principal) | triggers sync/guard |
| `coi_posiciones_oc`, `coi_consumos_posicion` | posiciones financieras e imputaciones | RPC `coi_certificar_posiciones_v2`, idempotencia |
| `coi_certificaciones` | certificaciones **reales** (Obra/Servicio, H17) | historial central en Calendario → Tabla Certificaciones |
| `coi_documentos_oc` | índice documental → Storage `coi-documentos` | front **sólo lee** |
| `coi_historial_oc` | historial append-only (circuito contractual, cambios) | trigger `coi_historial_enforce_order` |
| `coi_timeline_events` | Timeline/Mailing | RPC `coi_timeline_*` |
| `coi_observaciones_oc` | observaciones por OC (H03) | |
| `coi_unidades_mantenimiento`, `coi_servicios_tecnicos_um` | inventario de red UM/ST (H05/H09) | **vacías en producción** (KI-029) |
| `coi_alertas`, `coi_alertas_revisadas` | alertas / revisión por usuario | **el front no usa `coi_alertas_revisadas`** (KI-037) |
| `coi_auditorias_calidad`, `coi_operaciones_auditoria`, `coi_idempotency_requests`, `coi_contract_meta`, `coi_links_documentales` | auditoría / infraestructura | `coi_links_documentales` = OneDrive retirado |
| `profiles` | usuario ↔ rol | |

Tablas **opcionales** (el front las referencia; RLS aplicada dinámicamente por
`coi_apply_optional_role_rls` sólo si existen): `coi_documentos_versiones`,
`coi_security_health_checks`, `coi_auditoria_global`, `coi_sesiones`.

**Roles** (`profiles` / `coi_current_role()`): dominio `administrador`, `jefatura`,
`editor`, `planificacion`, `control`, `supervisor`, `inspector`, `consulta`,
`invitado`, `contratista`. Las escrituras operativas (p. ej. confirmar hitos)
exigen uno de los seis primeros; UM/ST exigen `administrador`. Rol ausente →
fail-closed (TD-029, TD-036).

## 8. Supabase

### RPC que invoca el front

| RPC | Uso |
|---|---|
| `coi_guardar_orden_integral` | alta de OC (atómica, con estaciones) |
| `coi_actualizar_orden_integral` | **edición canónica de OC** (allowlist de campos); cerrar/archivar/desarchivar |
| `coi_eliminar_orden_integral` | borrado de OC (sólo admin) |
| `coi_confirmar_etapa_circuito_v3` | confirmar hito contractual (idempotente, con fecha efectiva) |
| `coi_guardar_estacion_asociada`, `coi_eliminar_estacion_asociada`, `coi_marcar_estacion_principal` | estaciones |
| `coi_certificar_posiciones_v2`, `coi_actualizar_consumo_posicion`, `coi_anular_consumo_posicion`, `coi_eliminar_posiciones_sin_movimientos` | financiero |
| `coi_actualizar_avance_obra` | avance manual de obra |
| `coi_timeline_list_page`, `coi_timeline_upsert_events`, `coi_timeline_replace_events`, `coi_timeline_delete_event` | Timeline |
| `coi_current_role`, `coi_normalize_order_number` | auth / normalización |

Escrituras directas (no RPC) que existen: `coi_certificaciones` (insert/update/upsert),
`coi_observaciones_oc`, `coi_unidades_mantenimiento`, `coi_servicios_tecnicos_um`,
`coi_historial_oc` (insert), `coi_auditorias_calidad`, `coi_auditoria_global`,
`coi_sesiones`, `profiles` (update), `coi_ordenes` (update directo acotado por
el trigger `coi_direct_order_update_guard` + allowlist).

### Triggers guard relevantes

`coi_ordenes_h10_state_guard` / `_insert_guard` / `_audit_guard` (cierre inmutable,
archivar sólo cerrada), `coi_direct_order_update_guard`, `coi_ordenes_number_guard`,
`coi_order_number_dependency_guard`, `coi_historial_enforce_order`,
`coi_timeline_00_prepare_row` / `_90_audit_row`, `coi_st_resolver_nro_oc`,
`coi_um_version_servidor` / `coi_st_version_servidor` (CAS optimista),
`coi_posiciones_identity_guard`, `coi_ordenes_estaciones_write_guard`.

### Estado repo ↔ PRODUCCIÓN — reconciliación live 2026-09-29

La auditoría live posterior a este handoff demostró que el snapshot
`tests/fixtures/production_schema_contract.json` estaba atrasado en varios puntos.
`tests/fixtures/production_schema_contract.json` fue regenerado en PR #111 con la evidencia live del 2026-09-29 y vuelve a ser el contrato productivo versionado. Sus `_divergencias_pendientes` representan únicamente desvíos que sigan abiertos después de esa reconciliación.

Verificado directamente en STAGING y PRODUCCIÓN:
- `coi_servicios_tecnicos_um.orden_id` ya existe y sus FK relevantes están en `RESTRICT`.
- Los índices únicos canónicos de UM/ST ya existen.
- Las policies restrictivas UM/ST ya están desplegadas.
- No se detectaron duplicados canónicos de UM ni ST en la auditoría.
- Las RPC contractuales v1/v2/v3 están disponibles; el frontend vigente usa
  `coi_confirmar_etapa_circuito_v3`.
- PR #85 no debe tomarse como migración pendiente por defecto: su compatibilidad
  debe evaluarse contra el contrato v3 vigente.

Divergencia real encontrada y **resuelta el 2026-09-29**:
- Se aplicaron en STAGING y luego en PRODUCCIÓN, desde los SQL versionados de
  `main`, las migraciones:
  `202609170003_modalidad_certificacion.sql`,
  `202609170004_modalidad_certificacion_writers.sql` y
  `202609190001_modalidad_certificacion_alta.sql`.
- Producción quedó con `coi_ordenes.modalidad_certificacion`, default
  `SIN_DEFINIR`, CHECK de dominio, índice parcial para `MENSUAL` y los tres
  writers canónicos habilitados.
- Las 34 OC históricas existentes quedaron en `SIN_DEFINIR`; no se infirió ni
  forzó `MENSUAL`/`A_DEMANDA`.

⚠️ Sigue sin existir deploy automático de migraciones. Verificar Supabase live
antes de afirmar una divergencia. El fixture productivo fue regenerado en PR #111 con la evidencia live del 2026-09-29; no modificar datos productivos para mantenerlo.

Ver `03_SUPABASE_DATA_MODEL.md`, `10_SECURITY_DATA_RULES.md`, `supabase/README.md`.

## 9. Storage

- Bucket privado **`coi-documentos`**. Se accede por `bucket + storage_path` y `createSignedUrl`/`download`.
- El front **no sube archivos** (0 llamadas `.upload(`) y **no escribe** `coi_documentos_oc`: la carga documental se hace por fuera de la app.
- Las **políticas de Storage no están versionadas** en `supabase/migrations`.
- OneDrive / "Agregar link documental" / "Carpeta documental OneDrive" están **retirados** (H07, TD-049, TD-065). No reintroducir.
- Sin path resoluble no se ofrece botón PDF. Dedupe por `bucket+storage_path`, **nunca** por número de Acta.

## 10. LocalStorage / sessionStorage residual

**Hoy:** `localStorage` = 0 referencias (test H11). `sessionStorage` = ~170 llamadas.
Un escudo en `Storage.prototype` (H05, `__coiUmH05Shield`) neutraliza lecturas
y escrituras de claves legadas de UM/ST y de observaciones (`coi_observaciones_oc`
devuelve `[]` a consumidores operativos).

| Clave (sessionStorage) | Qué guarda | ¿Autoridad? |
|---|---|---|
| `sb-*` (Supabase Auth) | sesión | infraestructura, correcto |
| `coi_v2_theme`, `coi_v2_sidebar_collapsed`, `coi_alertas_filtros_v46`, `coi_dashboard_filters_v33` | preferencias UI | correcto |
| `coi_docs_storage_index_cache_v1`, `coi_documentos_storage_cache_v1`, `coi_supabase_estaciones_cache_v1` | caché de lectura | secundaria, correcto |
| `coi_timeline_*` (sync ping, migrated, legacy_pending) | coordinación | el cross-tab real es `BroadcastChannel('coi_timeline_sync_v2')` |
| `coi_pending_financial_rpc_v1` | cola de reintento idempotente financiero | recuperación, documentada |
| **`coi_alertas_revisadas_v46`** | "alerta revisada" por usuario | ⚠️ **PRIMARIA y volátil** — existe `coi_alertas_revisadas` + RPC `coi_marcar_alerta_revisada` en producción y el front **no las usa** (KI-037) |
| **`coi_linea_roca_fotos_oc_v20`, `coi_linea_roca_fotos_estacion_v19`** | fotos (dataURL) de OC/estación | ⚠️ **PRIMARIA y volátil** — no hay persistencia remota de fotos; se pierden al cerrar la pestaña (KI-038) |
| `coi_admin_config_v47`, `coi_admin_pin`, `coi_admin_logs_v47`, `coi_admin_*backup*` | config/logs/backups de Administración legacy | ⚠️ local; la autorización real es el rol Supabase (TD-036). Tratar como legacy |
| `coi_servicios_tecnicos`, `coi_roca_unidades_mantenimiento`, `coiPosicionesFinancieras` | escritores legacy | neutralizados por escudo/guard (KI-023); no reactivar |
| `coi_version_actual`, `coi_ultimo_diagnostico_v58r12`, `coi_runtime_errors_v1` | diagnóstico | inocuo |

Regla: **nada nuevo en sessionStorage que sea dato operativo.** Si necesitás
persistir, es Supabase con RPC/RLS y migración autorizada.

## 11. Módulos funcionales

| Módulo | Vista / script principal | Fuente |
|---|---|---|
| Inicio operativo (Dashboard, KPIs → Órdenes filtrado) | `vistaDashboard`, `coi-dashboard-interactivo-v33-runtime`, `coi-v2-stremio-inspired-runtime` (shell V2) | derivado de `coi_ordenes` |
| Órdenes de Compra | `vistaOrdenes`, `coiV581R9OrdersRepair`, `renderOrdersFinal` | `coi_ordenes` (+gate H18) |
| Ficha OC (7 paneles) | `vistaFichaOC`, `coi-v581r12-stabilized`, `coi-v581r28-contractual-ct-script`, `coi-etapa1-pipeline-contractual` | ordenes + historial + certificaciones + documentos + timeline + observaciones |
| Editar OC | `coi-v60-editar-oc` | RPC `coi_actualizar_orden_integral` |
| Circuito contractual (10 hitos) | `coi-etapa1-pipeline-contractual` | `estado_documental` + `coi_historial_oc` |
| Control de Terceros | `coi-v581r28-contractual-ct-script` | `coi_ordenes` (CT) |
| Cerrar / Archivar OC | `coi-h10-cierre-operativo`, `coi-h09-archivar-oc-supabase` | RPC + guards H10 |
| Calendario COI (Vista COI I/II, Tabla Certificaciones) | `vistaCalendarioCOI`, `coi-v592-calendar-fix`, `coi-certificaciones-historial` | ordenes + `coi_certificaciones` |
| Calendario vencimientos / certificaciones | `vistaCalendarioVencimientos`, `vistaCalendarioCertificaciones` | derivado |
| Centro de Alertas | `vistaCentroAlertas`, `generarAlertasCOI` + capas V58/R13/R14/Fix | **derivado en el cliente** |
| Carga Operativa (Carga Certificación Obra/Servicio) | `vistaCarga`, `coi-certificaciones-r20-script` | `coi_certificaciones` |
| Financiero (posiciones) | `coi-v60-finanzas-supabase-first`, `coi-financial-rpc-contract` | posiciones/consumos + RPC |
| Timeline / Mailing | `vistaTimelineCOI`, `coi-timeline-r17-script` | `coi_timeline_events` |
| Observaciones | `coi-h03-observaciones-supabase-first` | `coi_observaciones_oc` |
| Red Línea Roca / estaciones | `vistaRed` (plano con imagen base64 ~282 KB) | `coi_ordenes_estaciones` |
| UM / Servicios Técnicos | `vistaUnidadesMantenimiento`, `vistaFichaUM`, `coi-h05-um-st-supabase-first`, `coi-h09-um-red-inventario` | tablas UM/ST (vacías en prod) |
| Documentación | `coi-v581r27-docs-storage-index`, `coi-h07-documentacion-legacy-retirada` | `coi_documentos_oc` + Storage |
| Login / seguridad | `coi-auth-h14-script`, `coi-fase11-security-script` | Supabase Auth + `profiles` |
| Administración | `vistaAdministracionSistema` | mezcla legacy local + rol remoto |
| Buscador | `vistaBuscador` | derivado |

**Planificación y Control (PyC): RETIRADO** del frontend activo (PR #36). No hay
etapa `enviada_pyc`, botón, KPI, badge ni campos. Columnas legacy en PostgreSQL
pueden existir como histórico inerte. **No reintroducir.**

## 12. Reglas de negocio (tal como funcionan HOY en el código)

> Reglas conceptuales en `04_FUNCTIONAL_RULES.md`. Acá, lo que implementa el código.

**Obra vs Servicio.** `coi_ordenes.tipo` admite también `Financiera`/`Otro`; sólo
`OBRA` y `SERVICIO` participan del calendario de certificaciones.

**Vencimiento contractual** (`calcularFechaVencimientoContractualOC`, capa V575):
- base = `fechaActaInicio` (fallbacks `actaInicio`, `fechaInicioActa`, `fechaInicio`);
- si `plazoDias > 0` → inicio + días; si no, `plazoMeses > 0` → inicio + meses;
- si calcula, **pisa** en memoria `fechaVencimiento`/`fechaFin`/`vencimiento` con el derivado
  (`estadoVencimientoContractual = 'Calculado desde Acta de Inicio'`);
- sin Acta → `'Pendiente de Acta de Inicio'` y se usa el vencimiento persistido si existe.
- ⚠️ Hay **varias implementaciones de días-hasta** (`daysTo` a las 12:00, `diasHastaVencimientoOrden` a 00:00, `diffDias(…, COI_TODAY)`). No unificar sin tests.

**Semáforos** (`semaforoVencimiento`, `estadoSemaforoOC`):
cerrada/archivada → gris · sin fecha → amarillo "Sin fecha" · días < 0 → rojo ·
**0–30 días → amarillo** · > 30 → verde.

**OC vencida con saldo** puede seguir certificable; **no se cierra sola** por fecha.

**Cierre / Archivo** (H10, TD-069…071): ver §13.

**Acta MED (Acta de Medición).** Estructurada = fila en `coi_certificaciones`
(`acta_medicion_nro`). Si sólo hay documento en Storage, se muestra
`Acta N° XX (documental)` sin inventar período, monto ni avance (TD-007).

**Centro de Alertas** (`generarAlertasCOI` + capas): se **calcula en el cliente** por OC:
| Alerta | Condición | Severidad |
|---|---|---|
| OC vencida | fin < hoy y no cerrada | ROJA |
| Sin fecha de inicio / sin plazo / sin estación / sin proveedor / datos incompletos | faltante | ROJA |
| OC vence en 30 días / Servicio próximo a vencer | 0 ≤ días fin ≤ 30 | AMARILLA |
| Certificación próxima (o *tentativa*) | 0 ≤ días próx ≤ 15 | AMARILLA |
| Control de avance de obra | Obra y 0 ≤ días próx ≤ 15 | AMARILLA |
| Falta expediente / última acta / período de acta / estado documental pendiente / sin próxima certificación | faltante | AMARILLA (Documental) |
| OC cerrada/finalizada · OC en ejecución | informativa | GRIS / AZUL |

Id estable = `clase + id + fecha`; los KPI cuentan por **clase**, no por etiqueta
(fix `c18e094`). Alertas que pedían OneDrive/links externos están filtradas (TD-056).
"Revisada" se guarda en sessionStorage (KI-037).

## 13. Estados contractuales

Dos ejes independientes (TD-070):

| Eje | Campo | Valores | Se cambia con |
|---|---|---|---|
| Operativo | `estado_coi` (+ `fecha_cierre_operativo`, `observacion_cierre`) | `ESTADOS_COI` (17 valores: Pendiente de completar … En ejecución, Suspendida, Cancelada, Finalizada…, **Cerrada**, Archivada) | "Cerrar OC" |
| Registro | `estado_registro` | `Activo` / `Archivado` (legacy `Cerrado` se lee como cierre) | "Archivar / Desarchivar OC" |
| Contractual | `estado_documental` | códigos del circuito (abajo) | `coi_confirmar_etapa_circuito_v3` |

Flujo: `EN EJECUCIÓN → Cerrar OC → CERRADA → Archivar → CERRADA + ARCHIVADA`.
Cierre **inmutable** (guard H10 en PostgreSQL); archivar exige cerrada;
desarchivar **no reabre**. El cierre **no** valida saldo ni actividad pendiente (KI-030).

**Circuito contractual — 13 códigos / 12 tarjetas + transversal → 10 hitos lógicos** (TD-076):
H1 `pliegos_preparacion` · H2 `pliegos_terminado_sin_solped` · H3 `solped_sin_expediente` ·
H4 `pliego_con_oc` · H5 `pliego_con_expediente` · H6 `oc_sin_control_terceros` ·
H7 `control_terceros_sin_acta` · H8 `control_terceros_con_acta` (cierra 1° Etapa, gate **Acta de Inicio**) ·
H9 `ejecucion` · H10 `finalizada` | `finalizada_actas` | `finalizada_saldo_remanente` ·
transversal `cancelada_suspendida`.

> Nota: AGENTS.md/BASELINE hablaban de "12 etapas". Son las mismas tarjetas;
> desde PR #109 se cuentan como **10 hitos lógicos**. Ambas descripciones son
> del mismo array `CIRCUITO_ADMINISTRATIVO_ETAPAS`.

X/10, estado actual, última actualización, días en estado y duraciones se
**derivan** de `coi_historial_oc` + `estado_documental`; sin columnas nuevas.
Reconfirmar el estado vigente es idempotente. Duraciones por día administrativo
de Buenos Aires. Resolver único: `resolverOrdenCircuito`; clave: `nroOCCircuito`.

## 14. Certificaciones

- **Real** = `coi_certificaciones` (Carga Operativa → Carga Certificación, H17 diferencia Obra/Servicio). Historial central: Calendario COI → **Tabla Certificaciones** (`coi-certificaciones-historial`, `window.__COI_CERT_HISTORIAL__`).
- **Próxima certificación** — resolver canónico `window.__COI_PROXIMA_CERT_INFO__(item,row) → {fecha, origen:'persistida'|'calculada', tentativa}` (capa Fix ~L9690–10370). Todos los consumidores (Dashboard, Órdenes, Alertas, Calendario) pasan por acá (PR #82/#83):
  1. tipo ∉ {OBRA, SERVICIO} → nada;
  2. `coi_ordenes.proxima_certificacion` persistida → se usa, **salvo** OC cerrada/archivada/finalizada (`bloqueaCertificacionPersistidaFix`);
  3. si no, **proyección tentativa** (`proyeccionMensualFix`), sólo si el historial de certificaciones cargó OK (fail-closed):
     - base = última certificación real, si no Acta de Inicio;
     - +1 **mes calendario** (recorta a fin de mes);
     - SERVICIO: sólo si `modalidad_certificacion = 'MENSUAL'`; la columna y sus writers están desplegados en STAGING y PRODUCCIÓN desde 2026-09-29;
     - OBRA: sólo si plazo entre 30 y 120 días;
     - nunca después del vencimiento.
- Una tentativa se muestra como tal, nunca como fecha acordada (TD-074).

## 15. Calendario

`vistaCalendarioCOI` con Vista COI I / Vista COI II (eventos: vencimientos,
certificaciones persistidas y tentativas, hitos) y subpestaña Tabla
Certificaciones (reales). `renderCalendarioCOIUnificado` fue reemplazado por
`renderCalendarioFix`. Vistas aparte `vistaCalendarioVencimientos` y
`vistaCalendarioCertificaciones`. No hay exportación ICS (roadmap del README).

## 16. Alertas

Ver §12. Implementación en varias capas (`generarAlertasCOI` → `v58…` → `alertasFix`
→ `postProcesarAlertasR13/R14` → `renderAlertsExecutive`). Hay un
`setInterval(procesarAlertas, 1200)` mientras la vista está activa. Filtros en
sessionStorage. `coi_alertas` existe en DB pero las alertas **no** se persisten
desde el front.

## 17. PDFs / documentación

`coi_documentos_oc` + bucket `coi-documentos` (signed URL). Panel 5 de la Ficha
sólo muestra `[data-documentos-storage]`. No hay subida desde la app ni
export canónico de documentación (KI-026). Backup integral V58.1 incluye
Timeline autoritativo y separa `recuperacion` legacy (TD-059, TD-067).

## 18. Testing

| Capa | Comando | Qué | Cantidad |
|---|---|---|---|
| Unit/estático | `npm run test:unit` | html-validate, css-tree, contratos estáticos sobre `index.html` | 23 scripts |
| SQL | `npm run test:sql` | aplica **todas** las migraciones en PGlite y verifica RPC/guards/RLS | 20 scripts |
| Integración | `npm run test:integration` | `test:sql` + `check_supabase_runtime.js` | |
| Todo estático | **`npm test`** | unit + integration | ~44 scripts, **≈2,5 min** local |
| E2E | `npx playwright test` | 43 specs × 2 proyectos | **1470 tests** (735 × desktop/mobile) |

- Proyectos: `chromium-desktop` (Desktop Chrome) y `chromium-mobile` (Pixel 5). Sólo Chromium.
- Supabase se **mockea** en E2E (fixtures en cada spec, `tests/fixtures/contractual_remote_fixture.js`). Ningún test toca producción.
- `playwright.config.js`: timeout 30 s, `retries` 1 sólo en CI, `webServer: python3 -m http.server 4173`.
- Specs más grandes: `h05_um_st_supabase_first` (173), `h10_routing_cierre_archivo` (89), `h07_cierre_localstorage` (49).
- Specs con `test.skip`/`fixme`: `dashboard_focus_v2_shell`, `h07_cierre_localstorage`, `review_pr82_causas_raiz`.
- Local: smoke de 50 tests ≈ 4 min → la suite completa local sin shards es de **horas**; usar shards o dejarla al CI.
- Flaky conocido: no hay registro formal. CI usa `retries: 1`: un verde con retry **no** es prueba de estabilidad; revisá el log.

### Trampas de entorno (Windows)
1. **CRLF**: con `core.autocrlf=true`, `tests/check_modalidad_certificacion.js` **falla localmente** ("el resto de la allowlist…") porque busca `'\n  ];'`. En CI (LF) pasa. Verificado: en checkout LF pasa 45/45 (KI-039). Solución local: `git config core.autocrlf input` + re-checkout, o worktree con `-c core.autocrlf=false`.
2. **python3** puede ser el alias de Microsoft Store (KI-004) → el `webServer` de Playwright no arranca. Levantá cualquier servidor estático en `127.0.0.1:4173` (config tiene `reuseExistingServer` fuera de CI), p. ej. `npx http-server -p 4173 -a 127.0.0.1` o un script Node de 10 líneas.

Ver `07_TESTING_QA.md`.

## 19. Quality Gate

`.github/workflows/quality-gate.yml` (PR a main, push a main, manual):
1. **Calidad estática**: `npm ci` → `npm audit --audit-level=high` (tolera caída del endpoint) → `npm test` → `git diff --check` → sin marcadores de conflicto → exactamente un `<!DOCTYPE html>`.
2. **Chromium shard 1..4/4**: `npx playwright test --shard=N/4`.
3. **Interacción Chromium**: agrega los 4 shards (debe ser success).

Duración observada en main: **≈22–24 min**. Último run en `d3344c7`: ✅ success.
Un Gate verde **no** reemplaza revisión semántica contra el contrato Supabase.

## 20. Performance

Estado (sin optimizar todavía; sólo diagnóstico):

| Factor | Medida | Riesgo de tocar |
|---|---|---|
| Tamaño `index.html` | ≈3,0 MB (JS ≈2,36 MB, CSS ≈265 KB, PNG base64 ≈282 KB) | Alto |
| Script base | ≈846 KB en un bloque | Muy alto |
| Funciones declaradas | ≈2850; **162 nombres duplicados** (`init` ×23, `toast` ×10, `renderFichaOC` ×4) | Muy alto (la última gana) |
| Listeners | 462 `addEventListener`; 60 `DOMContentLoaded` | Alto |
| MutationObserver | 23 (≥7 observan `document.body` con `subtree`) | Medio-alto: fuente de repintados en cascada |
| Timers | 5 `setInterval` (180 ms gate de arranque; 1200 ms alertas; 1500 ms UM; 1200 ms versión/select; auth V2), 237 `setTimeout` | Medio |
| `innerHTML =` | 273 | Medio (render completo) |
| Globals `window.x =` | ≈940 | Alto |
| Arranque | bootstrap Supabase temprano (#97), gate autoritativo (#86), fast-path (#87) | Tocar sólo con `check_startup_authoritative_gate.js` y specs de arranque |
| Compactación | #91, #94, #98 mergeados; #88/#92/#95 **no** (riesgo de romper contratos textuales de tests) | Los tests estáticos buscan texto literal en `index.html`: reformatear rompe tests |

**Seguro**: CSS aislado, textos, cambios dentro de un bloque `coi-*` con test propio.
**Peligroso**: script base, `todasLasOC`, `renderFichaOC`, `renderOrdenes*`, routing H10, gate de arranque, shell V2, observers globales.

## 21. Zonas críticas (no tocar sin tests funcionales)

1. **Circuito contractual / 10 hitos** — `coi-etapa1-pipeline-contractual`, RPC v3, `coi_historial_oc` (PR #100–#109, KI-036).
2. **Cierre/Archivo H10** — guards PostgreSQL + UI (TD-069…071).
3. **Próxima certificación** — resolver canónico único (PR #82/#83).
4. **Gate de arranque + bootstrap** — evita mostrar datos parciales (PR #86/#87/#97/#99).
5. **Routing H10** — guard de reentrada.
6. **Timeline** — RPC con locks y serialización (13 migraciones 2026-08-25/26).
7. **Financiero** — idempotencia, `coi_pending_financial_rpc_v1`.
8. **UM/ST H05** — escudo `Storage.prototype`, CAS de versión.
9. **Auth H14** — bloqueo sin sesión, rol fail-closed.
10. **Contratos textuales**: muchos tests `check_*.js` hacen `html.includes('…')` sobre literales exactos. Renombrar/reformatear código rompe tests aunque el comportamiento sea igual.

## 22. Deuda técnica

- **Monolito por capas** con duplicación masiva (KI-001, KI-031, KI-033).
- **Alertas revisadas** sólo en sessionStorage pese a existir tabla+RPC (KI-037).
- **Fotos** sólo en sessionStorage (KI-038).
- Administración legacy local (PIN/config/logs) coexistiendo con rol Supabase.
- Varias funciones de fecha/días con criterios distintos (00:00 vs 12:00).
- Políticas de Storage y bucket no versionados.
- Antes de cualquier migración nueva, contrastar repo, contrato y Supabase live (§8); no inferir pendientes desde snapshots viejos.
- **Documentación desactualizada**: `README.md` (dice "persistencia LocalStorage", versión 60.0.1, RC1), `CHANGELOG.md` (termina en Fase 9), `BASELINE_OPERATIVA.md` (baseline 2026-08-22). Varias constantes `VERSION` en el código (`V58.1R39…`, `V59.2…`, `V60.0…`) sin versión única.
- Residuos en raíz publicados en Pages: `index_PRE_CONTROL_TERCEROS_FIX.html`, `index_PRE_IMPUTACION_POSICIONES_R383.html` (≈2,3 MB c/u), `TEST_*.log/json`, `VALIDACION_*.log`, `*_FIX.md`. **No** borrar sin autorización (no hay evidencia de uso, tampoco prueba formal de que nadie los consulte).
- ≈110 ramas remotas; la mayoría ya integradas (§30).

## 23. Problemas conocidos

Lista completa y viva: **`13_KNOWN_ISSUES.md`** (KI-001…KI-041). Abiertos más relevantes:
KI-009, KI-010 y KI-014 (deudas funcionales UM/ST), KI-030 (cierre sin validar saldo),
KI-037 (alertas revisadas),
KI-038 (fotos), KI-039 (CRLF), KI-040 (PR #85 / OCs cerradas), KI-041 (PRs y ramas huérfanas).

## 24. Reglas para futuros agentes

Ver `AGENTS.md` (obligatorio) y `CLAUDE.md`. Resumen innegociable:
1. Leer `AGENTS.md` + este documento antes de modificar.
2. Nunca trabajar en `main`. Una tarea = una rama = un PR.
3. Supabase es la fuente única de verdad; nada operativo en local/sessionStorage.
4. Prohibido sin autorización explícita: migraciones, DDL, RLS, RPC, DELETE/TRUNCATE/DROP, escrituras masivas, borrado de Storage, merge, force push.
5. No bajar cobertura, no `skip` para pasar, no esconder fallos.
6. Desktop **y** mobile cuando el cambio es visual/navegación.
7. Prioridad: integridad de datos > funcionamiento > trazabilidad > seguridad > UX > estética.

## 25. Procedimiento seguro para modificar código

1. `git switch main && git pull --ff-only origin main && git switch -c fix/<tema>`.
2. Reproducir (Playwright o navegador local con mocks).
3. **Buscar** la función en *todas* sus declaraciones (`grep -n "function nombre(" index.html`) y determinar **cuál gana** (la última cargada o la reasignada por una capa `coi-*`).
4. Identificar fuente de datos (tabla/RPC) y consumidores (grep del global).
5. Cambio mínimo, preferentemente **dentro de la capa más nueva** que ya gobierna esa función. No crear capas nuevas si una existente cubre el tema.
6. Test: `check_*.js` si es contrato estático; **spec Playwright** si es navegación/render/persistencia. Añadir el script nuevo a `package.json` si es `check_*.js`.
7. `npm test` + spec puntual (desktop+mobile) → `git diff --check` → commit → push → PR.
8. Actualizar `13_KNOWN_ISSUES.md` / `14_TECHNICAL_DECISIONS.md` / este documento si cambió una regla.

## 26. Procedimiento seguro para Supabase

1. **Sólo lectura** por defecto. Diagnóstico con `select`.
2. Todo cambio de schema = **migración nueva** en `supabase/migrations/AAAAMMDDNNNN_descripcion.sql`, idempotente, no destructiva, con backfill antes del `check`.
3. Test SQL en PGlite (`tests/check_*.js`) + entrada en `package.json › test:sql`.
4. Si prod aún no la tiene: declararla en `production_schema_contract.json › _divergencias_pendientes`.
5. PR con propósito, impacto, **rollback** y orden de rollout (**schema antes que front**, KI-018).
6. Aplicar en **STAGING** primero, luego PROD, **sólo con autorización explícita** del responsable. Ver `supabase/README.md`, `supabase/PREPRODUCCION.md`, `examples/SUPABASE_MIGRATION_EXAMPLE.md`.
7. Nunca service-role key ni secretos en el repo. La publishable key del front es pública por diseño.

## 27. Procedimiento de PR / merge

`08_GIT_PR_WORKFLOW.md`. Además:
- PR explica problema, causa raíz, solución, alcance, tests, datos **no** tocados.
- Quality Gate verde (los 3 jobs) + revisión del diff.
- **Merge sólo con autorización explícita del owner (MSP-byte).**
- Post-merge: `git switch main && git pull --ff-only`, smoke en GitHub Pages si afecta UX crítica.
- No reabrir PRs viejos sobre main desfasado: rebase/rehacer sobre main actual en rama nueva.

## 28. Comandos útiles

```bash
# estado
git status && git branch --show-current && git log -1 --oneline && git fetch origin --prune
git rev-list --left-right --count origin/main...HEAD

# tests
npm ci
npm test                              # ≈2,5 min
npm run test:unit                     # sólo estáticos de index.html
npm run test:sql                      # migraciones en PGlite
npx playwright install chromium
npx playwright test tests/<spec>.spec.js                        # desktop+mobile
npx playwright test tests/<spec>.spec.js --project=chromium-desktop
npx playwright test --shard=1/4
npx playwright test --list | tail -1  # cuenta tests

# explorar index.html
grep -n "function renderFichaOC(" index.html          # todas las declaraciones
grep -n '<script id="coi-' index.html                 # mapa de capas
grep -o "\.rpc('[a-z_0-9]*'" index.html | sort | uniq -c

# ¿rama integrada?
git cherry origin/main origin/<rama> | grep -c '^+'
```

## 29. Checklist antes de entregar cambios

- [ ] Rama dedicada desde `main` actualizado; sin cambios ajenos.
- [ ] Causa raíz identificada y explicada.
- [ ] Declaración de función que **gana** identificada.
- [ ] Sin dato operativo nuevo en sessionStorage/localStorage (test H11 verde).
- [ ] `npm test` verde (en Windows, cuidado con CRLF, KI-039).
- [ ] Spec Playwright puntual verde en **desktop y mobile**.
- [ ] `git diff --check` limpio; diff revisado línea a línea.
- [ ] Sin cambios en `supabase/migrations` ni en datos sin autorización.
- [ ] Docs vivas actualizadas (KI/TD/este archivo) si cambió una regla.
- [ ] PR abierto, Quality Gate verde, **sin merge** hasta autorización.

## 30. Estado exacto del proyecto al momento del handoff (2026-09-27)

**main** = `d3344c7` (2026-09-25, PR #109). Quality Gate de ese commit: ✅.
`npm test` sobre main: ✅ en checkout LF (≈156 s); ❌ en Windows con CRLF sólo por KI-039.
Smoke Playwright local (50 tests: H11, H14, editor, 10 hitos, próxima certificación, timeline; desktop+mobile): ✅ 50/50.

**Rama `feat/calendario-certificaciones-expediente`**: totalmente integrada (PR #82). Sin trabajo pendiente.

**PRs abiertos (12) — ninguno debe mergearse tal cual; todos requieren decisión del owner:**

| PR | Rama | Diagnóstico con evidencia |
|---|---|---|
| #106 | `fix/contractual-date-progress-duration` | Solapa con #107 (mergeado). Agrega fallback visual por `fecha_ultimo_control`; #107 (`b16ac8d`) exige evidencia para ese fallback → **probablemente superado/contradictorio**. Cerrar o rehacer. |
| #89 | `perf/early-supabase-bootstrap` | Reemplazado por #97 `-v2` (mergeado). Cerrar. |
| #88 | `perf/index-compact-safe` | Compactación −850 líneas; su línea siguió en #91/#94/#98. Cerrar o rehacer. |
| #85 | `fix/contractual-closed-oc-h10` | ⚠️ Trae migración `202609210001_etapa1_closed_oc_compat.sql` (redefine `coi_confirmar_etapa_circuito` **v1**) que **no está en main**. El front usa **v3**. Hay que verificar en STAGING/PROD si confirmar hitos sobre una OC `Cerrada` falla contra el guard H10, y si esa migración se aplicó a mano. **Decisión pendiente** (KI-040). |
| #41, #32, #25, #21, #15, #8, #4, #3 | ramas jul–ago | main tiene 590–1160 commits encima. Obsoletos. Cerrar tras confirmación del owner. |

**Ramas remotas con commits no integrados sin PR:** `fix/prox-cert-cerrada-persistida` (superada por #83: main ya tiene `bloqueaCertificacionPersistidaFix`), `perf/index-structural-compaction-phase2` (#92 cerrado), `perf/whitespace-safe-v3-20260923` (#95 cerrado), `feat/h17-certificaciones-obra-servicio` y `fix/h14-login-imagen-credenciales` (versiones previas de #77/#73), `origin/x` (21 commits, sin contexto), `docs/claude-agent-manual` (2 commits doc). Ninguna contiene trabajo que main necesite según la evidencia revisada; **no se borró nada** (KI-041).

**Supabase producción**: no se consultó ni modificó en este handoff. Estado declarado por el contrato versionado (§8). Verificarlo requiere credenciales del owner.
