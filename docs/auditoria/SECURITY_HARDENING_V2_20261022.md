# COI Línea Roca · Security Hardening V2 · OC y auditoría

**Corte:** 22/10/2026. **Rama:** `security/hardening-v2-oc-audit-20261022`.

## Hallazgos verificados (lectura de catálogo, no pentest)

- Producción (`ooepgbzqlpjrtpaoqawc`): `authenticated` tiene UPDATE directo a `public.coi_ordenes` y EXECUTE del helper público `coi_record_direct_order_update(jsonb,jsonb)`.
- STAGING (`brmrroikctfbtzwfewan`): no concede UPDATE a `coi_ordenes`; la firma pública del helper ya no existe.
- Ambas bases: 27 tablas RLS habilitadas y ningún grant directo de `anon` sobre las tablas COI examinadas.
- Los writers SQL de `coi_ordenes` accesibles desde el frontend se ejecutan como `SECURITY DEFINER`; revocar UPDATE a authenticated no revoca sus privilegios de owner. Sin embargo, **es obligatorio validar la experiencia real por rol en STAGING**.
- No se cambian datos, índices, documentos, políticas RLS ni funciones de negocio. Se conservan triggers de compatibilidad aunque el writer directo de `authenticated` queda cerrado.

## Cambio versionado

`202610220001_security_v2_rpc_only_order_update.sql`:

1. `REVOKE UPDATE ON public.coi_ordenes FROM authenticated`.
2. Cierra `EXECUTE` público/anónimo/autenticado del helper de auditoría legacy **si existe**.
3. Asserts SQL fail-closed sobre los dos permisos efectivos.

Para cualquier alta o modificación, usar las RPC vigentes con validación de identidad y rol.

## Despliegue seguro

1. Confirmar HEAD/base y tomar respaldo probado. No iniciar intervención productiva mientras haya PR en conflicto o QA incompleto.
2. Ejecutar primero en STAGING y controlar:
   - `has_table_privilege('authenticated','public.coi_ordenes','UPDATE') = false`.
   - `has_function_privilege('authenticated', helper, 'EXECUTE') = false` cuando la función existe.
   - sin nuevos errores en Supabase Advisor.
3. Reproducir con sesiones reales: administrador crea/edita/cierra OC mediante el HTML; planificación y control modifican únicamente los campos permitidos; consulta no escribe; auditoría de cada acción genuina y acceso a documentos funcionan.
4. Verificar Quality Gate completo y test `check_supabase_runtime.js`: UPDATE directo es rechazado y las RPC siguen escribiendo.
5. Solo si todo es verde, promocionar **la misma migración versionada** a producción en ventana de cambio y corroborar sus resultados; nunca ejecutar una corrección ad hoc no versionada.

## Reversión excepcional

En caso de regresión confirmada tras respaldo y registro del incidente, evaluar por separado:

```sql
GRANT UPDATE ON TABLE public.coi_ordenes TO authenticated;
-- SOLO si existe la firma y es imprescindible recuperar un flujo legacy:
GRANT EXECUTE ON FUNCTION public.coi_record_direct_order_update(jsonb,jsonb) TO authenticated;
```

**Advertencia:** ambas acciones reabren riesgos observados. Preferir corregir la RPC o el flujo del frontend antes de reabrir grants.

## Trabajo posterior para aspirar a alta seguridad

- Matriz de autorizaciones: pruebas negativas con identidades reales por rol para cada tabla y RPC.
- Auditoría de los 27 `SECURITY DEFINER` del Security Advisor: permisos explícitos, search_path, acceso por rol, JSON de entrada, operaciones mutables.
- Revisión XSS/DOM de `index.html` (303 asignaciones `innerHTML` en la revisión estática) y refuerzo gradual de CSP (hoy admite `unsafe-inline`).
- Activar Leaked Password Protection y MFA para roles sensibles desde Supabase Auth; revisar recuperación de cuentas y políticas de contraseñas.
- Evaluar retirar de la publicación los HTML históricos y comprobar que no contengan secretos.
- Simulacro de restauración de respaldos, monitoreo de anomalías y pentest autorizado.

**No se sostiene un porcentaje de seguridad auditado (como 99,9%) sin pruebas dinámicas y revisión independiente.**
