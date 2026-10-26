# Security V3 — protección de exportaciones iCalendar (.ics)

Fecha: 2026-10-26. Referencia: Issue #152.

## Hallazgo
Los cuatro generadores .ics de `index.html` concatenaban `SUMMARY`, `DESCRIPTION` y algunos `UID` con campos de OC/proveedor/observaciones sin escape RFC 5545. Un valor con CR/LF y fragmentos `END:VEVENT`, `BEGIN:VEVENT` o `SUMMARY:` podía crear propiedades o eventos espurios en el calendario importado. El calendario de la vista corregida también interpolaba una fecha sin validar el formato.

## Corrección puntual
- Helper global `coiICSText`: escape de barra invertida, saltos como secuencia `\\n`, punto y coma y coma; reemplazo de controles no válidos. Los campos originales y el contenido persistido NO se modifican.
- Helper `coiICSUID`: codificación de los identificadores antes de interpolarlos en `UID`.
- Cuatro rutas protegidas: calendario general, ficha individual OC, calendario operativo y calendario de vista corregida. En la última se exige que `DTSTART;VALUE=DATE` tenga exactamente ocho dígitos, tras quitar guiones.
- Prueba de regresión `tests/check_security_ics_injection.js`: ejecuta los cuatro exportadores con valores que intentan inyectar VEVENT y comprueba que solo se emite un evento legítimo; incluye casos normales y fecha adversarial.
- El test se integra al `npm run test:unit`/Quality Gate existente.

## Invariantes
- Sin nuevas dependencias, sin backend, sin nuevas tablas ni cambios SQL, RLS/Auth/roles/grants/Storage/OC reales.
- Se conserva un único `index.html` funcional, descargas CSV y compatibilidad con Outlook/Google Calendar.
- No se modifica la función de importación del sistema ni el modelo operativo de eventos.
- `coiCSVCell` ya tiene una mitigación para fórmulas CSV; esa auditoría y la revisión de los sinks DOM `innerHTML` quedan independientes. Este PR no declara solucionado XSS ni toda la superficie CSV.

## QA y rollback
- Quality Gate: HTML/CSS, seguridad estática, unidad, SQL/PGlite, cuatro Chromium e interacción.
- Revisar muestra de .ics con texto acentuado, comas, punto y coma y saltos de línea; verificar en Google Calendar/Outlook sin datos reales sensibles.
- Revertir este PR si los parsers de calendario presentan regresiones, manteniendo diagnóstico; nunca eliminar la validación sin sustituto probado.
