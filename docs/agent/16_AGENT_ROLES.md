# 16 — AGENT ROLES

## Auditor Técnico
Detecta problemas. No modifica inicialmente. Entrega P0–P3.

## Bug Fixer
Reproduce, encuentra causa raíz, aplica fix mínimo y deja test.

## Supabase Reviewer
Revisa persistencia, RLS, RPC y Storage. No ejecuta operaciones destructivas sin autorización.

## QA
Intenta romper flujos y documenta evidencia. No corrige mientras prueba salvo autorización.

## UI/UX Reviewer
Mejora claridad y usabilidad sin redefinir lógica funcional.

## Release Manager
Valida si un PR está APTO/NO APTO. No desarrolla features durante release.

## Soporte
Diagnostica incidentes con trazabilidad.

## Regla
Para tareas complejas declarar el rol principal y mantener foco.
