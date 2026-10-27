# Security V3 — validación real de roles en STAGING (Fase A, sin escrituras)

Fecha: 26/10/2026. Incidencia: #152.

## Estado constatado mediante SELECT
STAGING `brmrroikctfbtzwfewan` registra actualmente 2 perfiles activos, ambos con rol `administrador`. **No existen perfiles activos comprobados para los otros 6 roles**, por lo que ninguna prueba que simule roles en SQL, PGlite, navegador o repositorio puede contarse como prueba de JWT real de esos perfiles.

## Herramienta preparada
`scripts/coi_v3_role_matrix_readonly.cjs` utiliza `fetch` nativo de Node 22 y SOLO permite el host de STAGING. Rechaza la ejecución si no recibe las siete sesiones autenticadas. No crea cuentas, no cambia contraseñas, no almacena JWT ni hace escrituras.

Casos que ejecuta:
1. Petición anónima a listado de OC: no debe devolver filas; RPC de lectura de rol debe devolver denegación inequívoca HTTP 401/403 con código PostgreSQL `42501` (503/429/404 o errores ajenos a autorización no prueban seguridad).
2. Para cada uno de los 7 JWT: verificar autenticación mediante `/auth/v1/user`.
3. Comprobar 7 UUID de usuario diferentes (sin imprimirlos).
4. Ejecutar RPC **STABLE** `coi_current_role` mediante GET, cotejar valor exacto de rol activo.
5. Confirmar lectura **de una OC de prueba preexistente** por su UUID (`COI_STAGING_OC_FIXTURE_ID`), con exactamente un resultado para cada rol. `HTTP 200 []` NO acredita lectura; se considera prueba bloqueada.
6. Reportar éxito solo con 7/7 identidades reales; nunca certificar operaciones de modificación.

Roles esperados: `administrador`, `jefatura`, `editor`, `planificacion`, `control`, `supervisor`, `consulta`. Verificar estos nombres contra el contrato de roles en el momento de crear las cuentas; no redefinir roles productivos para encajar el test.

## Ejecución local por personal autorizado
- Crear/invitar **seis identidades de prueba genuinas en STAGING** mediante el panel Auth bajo administración autorizada, y crear perfiles activos para cada rol; no utilizar emails de operadores reales sin acuerdo previo.
- Obtener las siete sesiones JWT mediante login real del sistema en entorno de prueba, por canal seguro y sin pegarlas en issues, PR, capturas, el chat o archivos de GitHub.
- Identificar el UUID de una **OC fixture de STAGING existente y legible por todos los perfiles** (actualmente STAGING tiene 1 OC; corroborar que es apta para este test). No usar OCs productivas ni incluir datos operativos en logs.
- Configurar `COI_STAGING_OC_FIXTURE_ID` con ese UUID, además de las variables de entorno `COI_STAGING_API_KEY`, `COI_STAGING_JWT_ADMINISTRADOR`, `COI_STAGING_JWT_JEFATURA`, `COI_STAGING_JWT_EDITOR`, `COI_STAGING_JWT_PLANIFICACION`, `COI_STAGING_JWT_CONTROL`, `COI_STAGING_JWT_SUPERVISOR`, `COI_STAGING_JWT_CONSULTA` en una terminal local privada; opcionalmente `COI_STAGING_URL` debe coincidir exactamente con el host de STAGING.
- Ejecutar `node scripts/coi_v3_role_matrix_readonly.cjs`. Solo se informa estado por rol, nunca se imprime JWT o información personal.
- Si la autenticación falla o un rol no coincide, la corrida aborta con código no cero y **se considera bloqueada**.

## Fase B — aún no instrumentada ni ejecutada
Se requiere matriz autorizativa positiva/negativa **por JWT real** para edición OC, cierre H10, reapertura, renumeración, certificar, archivos y documentos; usando exclusivamente una OC de prueba y respaldo verificable, con reversión. No ejecutar en producción ni inferirla desde la fase A. No revocar `UPDATE` de producción mientras estas pruebas estén pendientes.

## Alcance y salvaguardas
Este PR NO introduce usuarios, sesiones, cambios Auth, permisos SQL ni alteraciones de datos. El Quality Gate verifica la **sintaxis y controles negativos simulados** del runner sin credenciales; su ejecución funcional queda bloqueada hasta que existan los perfiles y JWT. Los controles automáticos que funcionan con mocks tampoco equivalen a JWT reales.
