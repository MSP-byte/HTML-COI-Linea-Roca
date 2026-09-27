# AGENTS.md — COI Línea Roca

Instrucciones obligatorias para **cualquier** agente de desarrollo (Jules, Claude, Codex u otro).

## Antes de tocar nada
1. Leer **`docs/agent/JULES_HANDOFF.md`** (documento maestro: arquitectura, datos, reglas, estado).
2. Leer `CLAUDE.md` y los documentos de `docs/agent/` que correspondan al tipo de tarea.
3. Verificar el estado real: `git status`, `git branch --show-current`, `git log -1 --oneline`, `git fetch origin --prune`.
4. Si hay cambios no relacionados, ramas equivocadas o el estado real contradice la documentación: **detenerse y reportar**.

## Arquitectura (no negociable)
- `index.html` es el único artefacto productivo. HTML/CSS/JS vanilla → Supabase JS v2 → PostgreSQL + Storage.
- **Supabase es la fuente única de verdad.** `coi_ordenes.id` (UUID) es la identidad técnica maestra.
- `localStorage` está prohibido en `index.html` (test H11). `sessionStorage` sólo para sesión Auth, preferencias UI y caché secundaria; **nunca** para datos operativos nuevos.
- No introducir frameworks, bundlers, backend propio ni dependencias nuevas sin necesidad demostrada y autorización.
- Preservar compatibilidad: no eliminar código "legacy" sin demostrar que está muerto (en `index.html` gana la última declaración; verificá el DOM, no el símbolo).

## Git y PR
- **Nunca trabajar directamente sobre `main`.** Una tarea = una rama (`fix/`, `feat/`, `chore/`, `docs/`, `perf/`) = un PR.
- Rama siempre desde `main` actualizado: `git switch main && git pull --ff-only origin main && git switch -c <rama>`.
- Sin force push, reset destructivo ni reescritura de historia sin autorización.
- **No hacer merge sin Quality Gate verde y sin autorización explícita del owner.**
- Mantener trazabilidad: cada PR explica problema, causa raíz, solución, alcance, tests y qué datos **no** se tocaron.

## Supabase / datos
- Sin autorización explícita está prohibido: migraciones sobre remoto, DDL, cambios de RLS/RPC/grants, `DELETE`/`TRUNCATE`/`DROP`, escrituras masivas y borrado de objetos de Storage.
- Todo cambio de schema es una **migración nueva versionada** en `supabase/migrations/`, idempotente y no destructiva, con test SQL (PGlite) y rollback documentado. Nunca modificar el schema productivo a mano sin migración.
- No asumir que una migración del repo está aplicada en producción: ver `tests/fixtures/production_schema_contract.json`.
- Nunca commitear service-role keys, contraseñas ni tokens.

## Tests
- `npm test` + Playwright puntual (desktop **y** mobile cuando el cambio es visual o de navegación) antes de pedir revisión.
- No esconder fallos, no agregar `skip`/`fixme` para pasar, no reducir cobertura ni debilitar aserciones para que una suite quede verde.
- Todo bug que llegó a `main` deja un test que lo reproduce de verdad.
- Un Gate verde no reemplaza la revisión semántica contra el contrato real de Supabase.

## Reglas funcionales vigentes (resumen; detalle en `docs/agent/04_FUNCTIONAL_RULES.md`)
- Circuito contractual: 12 tarjetas + transversal, contadas como **10 hitos lógicos** (TD-076).
- Cerrar OC (`estado_coi`) y Archivar OC (`estado_registro`) son ejes distintos; cierre inmutable; archivar exige cerrada; desarchivar no reabre.
- PyC está retirado: no reintroducir `enviada_pyc`, "Marcar enviada a PyC" ni KPIs/alertas/campos PyC.
- No reintroducir OneDrive ni "Agregar link documental": la documentación vigente es Storage `coi-documentos` + `coi_documentos_oc`.
- Próxima certificación: un único resolver canónico (`window.__COI_PROXIMA_CERT_INFO__`); una proyección tentativa nunca se presenta como fecha acordada.

## Prioridad
**integridad de datos > funcionamiento correcto > trazabilidad > seguridad > UX > estética**

Si el estado real contradice este documento, el repositorio real manda y la diferencia debe explicarse y corregirse en la documentación.
