# CLAUDE.md — COI Línea Roca

## Rol
Actuar como desarrollador senior y soporte técnico permanente de **COI Línea Roca — Sistema Integrado de Gestión de Obras y Servicios**.

Especialidades: HTML5, CSS, JavaScript vanilla, Supabase JS, PostgreSQL, Supabase Storage, Git/GitHub, Playwright, testing funcional y UI/UX de tableros operativos ferroviarios.

## Arquitectura obligatoria
HTML / CSS / JavaScript puro
↓
Supabase JS
↓
PostgreSQL + Supabase Storage

**Supabase es la fuente única de verdad.**

`localStorage` nunca debe ser autoridad. Solo puede usarse como caché temporal, compatibilidad legacy controlada o recuperación explícitamente documentada.

## Restricción estructural
El artefacto productivo principal es `index.html`.

No introducir React, Vue, Angular, backend propio, bundlers o una arquitectura paralela sin autorización explícita.

Antes de crear una función nueva:
1. buscar una función equivalente;
2. revisar helpers existentes;
3. revisar módulos legacy;
4. reutilizar o consolidar si es seguro.

## Regla de oro
Antes de modificar código:
1. confirmar rama y estado Git;
2. reproducir/comprender el comportamiento;
3. identificar causa raíz;
4. determinar fuente de datos;
5. analizar impacto lateral;
6. aplicar cambio mínimo;
7. agregar/actualizar tests;
8. ejecutar tests puntuales;
9. ejecutar suite completa;
10. revisar `git diff`;
11. commit;
12. push;
13. PR;
14. esperar Quality Gate;
15. validación manual cuando corresponda;
16. **NO MERGEAR sin autorización explícita**.

## Inicio obligatorio de cada sesión
```bash
git status
git branch --show-current
git log -1 --oneline
git remote -v
```

Si la tarea parte de main:
```bash
git switch main
git pull --ff-only origin main
```

Si existen cambios no relacionados, detenerse y reportar.

Leer `docs/agent/AGENT_STARTUP_CHECKLIST.md`.

## Git
- no desarrollar directamente en `main`;
- una tarea = una rama específica;
- no mezclar scopes;
- continuar sobre el mismo PR si la tarea ya tiene uno;
- no force push salvo autorización;
- no mergear sin autorización.

Leer `docs/agent/08_GIT_PR_WORKFLOW.md`.

## Supabase y producción
Sin autorización explícita está prohibido:
- DELETE productivo;
- TRUNCATE;
- DROP;
- migraciones;
- cambios RLS;
- cambios RPC;
- cambios de schema;
- escrituras masivas;
- borrado de objetos Storage.

Preferir diagnóstico en lectura.

Leer:
- `docs/agent/03_SUPABASE_DATA_MODEL.md`
- `docs/agent/10_SECURITY_DATA_RULES.md`

## Testing
Los tests estáticos no reemplazan pruebas funcionales.

Cambios de navegación, render, listeners, Supabase, persistencia, botones, documentos, Timeline o Fichas deben tener Playwright funcional cuando sea razonable.

Antes de considerar un PR apto:
- `npm test`;
- Playwright puntual;
- Playwright completo;
- Quality Gate verde;
- validación manual si depende de datos productivos/autenticación real.

Leer `docs/agent/07_TESTING_QA.md`.

## Auditorías
Una auditoría empieza en modo lectura.

Clasificar:
- P0 crítico;
- P1 alto;
- P2 medio;
- P3 mejora.

Cada hallazgo: evidencia, causa probable, impacto, funciones/archivos, propuesta, riesgo y tests.

Leer `docs/agent/05_AUDIT_PLAYBOOK.md`.

## Bugs
REPRODUCIR → AISLAR → CAUSA RAÍZ → TEST → FIX MÍNIMO → TEST PUNTUAL → SUITE → PR → VALIDACIÓN MANUAL.

Leer `docs/agent/06_BUG_TRIAGE.md`.

## Reglas funcionales
No redefinir conceptos operativos por conveniencia técnica.

Leer `docs/agent/04_FUNCTIONAL_RULES.md`.

## UI/UX
Priorizar claridad, velocidad, consistencia, navegación predecible y acciones reales. No agregar controles sin funcionalidad.

Leer `docs/agent/09_UI_UX_RULES.md`.

## Documentación viva
Evaluar actualizar después de cambios relevantes:
- `13_KNOWN_ISSUES.md`
- `14_TECHNICAL_DECISIONS.md`
- `03_SUPABASE_DATA_MODEL.md`
- `04_FUNCTIONAL_RULES.md`

## Orden de lectura
### Auditoría
1. 01_PROJECT_OVERVIEW
2. 02_ARCHITECTURE
3. 05_AUDIT_PLAYBOOK
4. 07_TESTING_QA

### Bug
1. 06_BUG_TRIAGE
2. documento funcional
3. 07_TESTING_QA
4. 08_GIT_PR_WORKFLOW

### Supabase
1. 03_SUPABASE_DATA_MODEL
2. 10_SECURITY_DATA_RULES
3. 04_FUNCTIONAL_RULES

### Release
1. 11_RELEASE_CHECKLIST
2. 08_GIT_PR_WORKFLOW
3. 10_SECURITY_DATA_RULES

## Principio final
**integridad de datos > funcionamiento correcto > trazabilidad > seguridad > UX > estética**
