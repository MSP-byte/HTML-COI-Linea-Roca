# COI Línea Roca · Security V4: exposición y regresiones
Fecha: 27/10/2026 · Issue #152

## Objetivo y límite de la auditoría

El SQL `supabase/qa/security_v4_exposure_readonly.sql` contiene únicamente SELECT y se ejecuta de forma administrativa sin cambios en datos ni esquema. Busca que un cambio posterior no abra superficies anónimas o de Storage sin que el equipo lo detecte.

| Control | STAGING | PROD | Alcance |
| --- | --- | --- | --- |
| E01 Ninguna función del esquema public ejecutable por anon, sea cual sea el prefijo | PASS 0/56 | PASS 0/62 | Privilegio efectivo; incluye grants vía PUBLIC |
| E02 Vistas/materialized views expuestas sin security_invoker | PASS 0 vistas | PASS 0 vistas | Detecta grants SELECT de tabla y de columna, tanto para anon como authenticated; no existen vistas public hoy |
| E03 Políticas RLS public/storage basadas en user_metadata editable | PASS 0/133 policies | PASS 0/143 policies | Búsqueda de expresiones en pg_policies; **no prueba funciones auxiliares** |
| E04 Buckets públicos de Storage | PASS 0/0 | PASS 0/1 | El único bucket de PROD está marcado privado; no comprueba por sí solo los ACL para autenticados |
| E05 RLS habilitada en storage.objects y storage.buckets | PASS 2/2 | PASS 2/2 | Cobertura de tablas Storage principales, no de todos los esquemas |

Ambos entornos: **5/5 PASS** sobre el SQL exacto, verificado el 27/10/2026. El resultado 0 vistas o 0 buckets públicos no debe tomarse como evidencia de que existe esa clase de recurso protegido; se monitorea ausencia de exposición.

## Tests negativos en CI

`tests/check_security_v4_exposure.js` levanta PGlite aislado, ejecuta el **mismo SQL** y comprueba que cada simulación de configuración insegura pasa a FAIL:
- GRANT EXECUTE para anon sobre una RPC con nombre arbitrario.
- Vista tradicional expuesta para authenticated sin `security_invoker`, incluso mediante `GRANT SELECT(id)` limitado a una columna.
- Policy que consulta `user_metadata` desde JWT.
- Bucket de Storage cambiado a público.
- Desactivación RLS sobre `storage.objects`.

Las modificaciones de datos de la prueba son únicamente en PGlite aislado. El SQL en STAGING/PROD sigue siendo solo lectura. No se crean usuarios, claves ni datos productivos.

## Indicador 50% y prioridades

El avance comunicado de **50% significa 5/10 hitos de gestión de seguridad cerrados** con evidencia; **NO equivale a una medición de vulnerabilidad residual** ni debe extrapolarse a «99% seguro». Esta fase profundiza evidencia sobre los hitos existentes y **no acredita** las 49 autorizaciones con JWT reales.

Bloqueantes de mayor prioridad:
1. JWT genuinos para siete roles y lectura/escritura sobre OC fixture y RPC en STAGING.
2. Protección contra contraseñas filtradas y MFA desde el panel de autenticación.
3. Retirar UPDATE directo de authenticated en PROD solo tras probar compatibilidad con RPC.
4. Revisar a fondo SECURITY DEFINER 26 avisos STAGING y 27 PROD, incluidos mecanismos de validación y cuerpo de cada RPC.
5. Copias de seguridad/restauración operativa, registro de incidentes y validación de recuperación.

Ningún código de la aplicación `index.html` ni datos operativos se modifican en este PR. El estudio es una auditoría estática/estructural automatizada, no un pentest.
