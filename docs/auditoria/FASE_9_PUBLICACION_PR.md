# Fase 9 — Paquete preparado para publicación y Pull Request

No se realizó `push`, no se abrió un Pull Request y no se usaron tokens. El
árbol local queda preparado para que la publicación sea una acción separada y
auditable.

## Identidad propuesta

- **Base:** `main` en `faa4fc9`
- **Rama a publicar:** `agent/supabase-atomic-contract`
- **Upstream actual:** ninguno
- **Commit sugerido para Fase 9:**
  `Harden COI release candidate and add preproduction gates`
- **Título de PR:**
  `RC1 — Estabilización integral y preparación para producción`

Conviene publicar la rama actual, que ya contiene los cuatro commits de la
auditoría, en vez de reconstruirlos en otra rama.

## Descripción completa del PR

La descripción exacta, con todas las secciones requeridas, está versionada en
`docs/auditoria/PR_RC1_BODY.md` y puede pasarse directamente a
`gh pr create --body-file`.

## Archivos afectados por el PR

### Aplicación y calidad

- `.github/workflows/quality-gate.yml`
- `.gitignore`
- `.htmlvalidate.json`
- `index.html`
- `package.json`
- `package-lock.json`
- `playwright.config.js`
- `test_imputacion_posiciones.js`
- `tests/check_control_terceros_static.js`
- `tests/check_crud_ordenes.js`
- `tests/check_css_syntax.js`
- `tests/check_integrity_guards.js`
- `tests/check_p0_containment.js`
- `tests/check_supabase_contract.js`
- `tests/check_supabase_runtime.js`
- `tests/delete_button.spec.js`
- `tests/test_control_terceros_browser.py`

### Supabase

- `supabase/README.md`
- `supabase/PREPRODUCCION.md`
- `supabase/migrations/202608100001_preflight_reports.sql`
- `supabase/migrations/202608100002_financial_ledger.sql`
- `supabase/migrations/202608100003_atomic_order_update.sql`
- `supabase/migrations/202608100004_rls_policies.sql`
- `supabase/migrations/202608100005_operational_integrity.sql`
- `supabase/migrations/202608110006_release_candidate_hardening.sql`

### Documentación

- `README.md`
- `CHANGELOG.md`
- `docs/README.md`
- `docs/auditoria/FASE_1_CRUD_ORDENES.md`
- `docs/auditoria/FASE_3_PLAN_CORRECCION.md`
- `docs/auditoria/FASE_4_CORRECCION_SUPABASE.md`
- `docs/auditoria/FASE_6_7_SEGUNDA_AUDITORIA_ESTABILIZACION.md`
- `docs/auditoria/FASE_8_INFORME_FINAL.md`
- `docs/auditoria/PR_RC1_BODY.md`
- `docs/auditoria/FASE_9_ESTABILIZACION_PREPRODUCCION.md`
- `docs/auditoria/FASE_9_MATRIZ_ROLES.md`
- `docs/auditoria/FASE_9_PUBLICACION_PR.md`

La lista definitiva debe obtenerse justo antes del commit con:

```bash
git diff --name-status main...HEAD
git diff --name-status
git ls-files --others --exclude-standard
```

## Publicación posterior

Con Git configurado y una sesión GitHub segura en la máquina del responsable:

```bash
git add --all
git diff --cached --check
git diff --cached --stat
git commit -m "Harden COI release candidate and add preproduction gates"
git push --set-upstream origin agent/supabase-atomic-contract
gh pr create --draft --base main \
  --head agent/supabase-atomic-contract \
  --title "RC1 — Estabilización integral y preparación para producción" \
  --body-file docs/auditoria/PR_RC1_BODY.md
```

Luego abrir el PR con el título y la descripción anteriores. No pegar tokens en
la terminal compartida, en archivos, en el HTML ni en la conversación. El merge
queda condicionado al workflow verde y a la revisión SQL; el despliegue sigue
siendo una operación posterior y separada.
