# 07 — TESTING & QA

## Principio
Un test verde no garantiza que el producto real esté correcto.

## Capas
### Tests estáticos
Útiles para estructura/contratos. No prueban interacción.

### Playwright
Obligatorio para navegación, botones, render, Timeline, filtros, Fichas, documentos, PDF y errores runtime.

### Mocks Supabase
Útiles para lógica determinística, permisos y errores.

### Validación manual
Necesaria para RLS real, sesión, Storage real, datos históricos y GitHub Pages.

## Regla post-regresión
Todo bug funcional que llegó a main debe dejar un test que lo reproduzca de verdad.

## Checklist
- `npm test`
- Playwright puntual
- Playwright completo
- Quality Gate
- prueba manual si aplica

## Timezone
Tests de fecha deben fijar reloj y timezone. No depender del runner.

## Documentos
Cubrir path válido/faltante, signed URL, duplicados, casing/slashes y archivos distintos con misma Acta.

## Timeline
Cubrir normal, Mailing, multi-OC, histórico, filtros, vista por OC, navegación y pageerror.

## Ficha
Cubrir Obra, Servicio, certificaciones, fallback documental, sin datos, CT y documentos.

## Responsive
Desktop + mobile definidos por Playwright.

## Aceptación
PR apto solo con tests verdes, CI verde, diff revisado y caso real validado cuando corresponde.
