# 18 — PROMPT LIBRARY

## Auditoría
```text
Actuá como Auditor Técnico.
Leé CLAUDE.md y docs/agent/05_AUDIT_PLAYBOOK.md.
No modifiques código.
Auditá [MÓDULO] y entregá P0-P3 con evidencia, causa probable, impacto, propuesta y tests.
```

## Bug
```text
Actuá como Bug Fixer.
Leé CLAUDE.md y docs/agent/06_BUG_TRIAGE.md.
Reproducí [BUG], encontrá causa raíz, agregá test funcional, aplicá cambio mínimo, ejecutá npm test + Playwright y abrí PR.
No hagas merge.
```

## Supabase
```text
Actuá como Supabase Reviewer.
Leé CLAUDE.md, 03_SUPABASE_DATA_MODEL.md y 10_SECURITY_DATA_RULES.md.
Analizá [FLUJO].
Supabase sigue siendo fuente única.
No SQL/migraciones/DELETE sin autorización.
```

## QA
```text
Actuá solo como QA.
No modifiques código.
Probá [FLUJO] desktop/mobile, capturá pageerror/console error y entregá reproducción exacta.
```

## Release
```text
Actuá como Release Manager.
Leé 11_RELEASE_CHECKLIST.md.
Validá PR #[N] y decime APTO / NO APTO con evidencia.
No hagas merge.
```
