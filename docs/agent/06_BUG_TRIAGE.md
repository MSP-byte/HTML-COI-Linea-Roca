# 06 — BUG TRIAGE

## Flujo
REPRODUCIR → AISLAR → CAUSA RAÍZ → TEST → FIX MÍNIMO → TEST PUNTUAL → SUITE → DIFF → PR → CI → MANUAL.

## Reproducir
Registrar:
- módulo;
- OC;
- rol;
- navegador;
- pasos;
- esperado;
- obtenido;
- captura;
- consola.

## Aislar
Determinar si es:
- UI;
- datos;
- Supabase;
- Storage;
- Auth;
- race condition;
- listener;
- navegación;
- fecha;
- cache;
- test;
- entorno.

## Causa raíz
No aceptar “el botón no anda”.
Buscar handler, selector, cache, RLS, path, función duplicada, estado stale o excepción previa.

## Impacto
Determinar si afecta una/todas las OCs, desktop/mobile, admin/consulta, datos existentes/nuevos.

## Test
Preferir test funcional para bugs funcionales.
Debe reproducir el fallo real, no solo verificar texto fuente.

## Fix
Cambio mínimo. No refactorizar zonas ajenas.

## Validación
```bash
npm test
npx playwright test <spec>
npx playwright test
```

## Datos reales
Mocks no alcanzan si el bug depende de RLS, Storage o datos históricos productivos. Hacer validación manual autenticada.

## Reporte final
Causa, cambio, archivos, tests, commit, PR, CI, validación y riesgos.
