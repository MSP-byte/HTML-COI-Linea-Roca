# Hardening V3 · Superficie pública de HTML

**Fecha:** 22/10/2026. **Alcance:** publicación estática de GitHub Pages.  
**Regla:** la única entrada HTML desplegable es `index.html`.

## Hallazgo verificado

El repositorio público incluía simultáneamente tres documentos HTML ejecutables en la raíz:

| Archivo | Tamaño en Git | Estado |
|---|---:|---|
| `index.html` | 3.162.356 bytes | Aplicación canónica, permanece sin cambios |
| `index_PRE_CONTROL_TERCEROS_FIX.html` | 2.289.425 bytes | Snapshot legacy retirado del árbol activo |
| `index_PRE_IMPUTACION_POSICIONES_R383.html` | 2.292.154 bytes | Snapshot legacy retirado del árbol activo |

Los dos archivos legacy contenían código y configuración Supabase antiguos, sin la meta-CSP de la página actual. Aunque las políticas RLS del servidor continúan protegiendo datos, publicar interfaces antiguas multiplica rutas de ejecución que escapan a las verificaciones de QA del `index.html` vigente.

**No se detectó** una clave `service_role` o `sb_secret_` en los tres HTML en la revisión anterior; las claves `sb_publishable_` son credenciales públicas diseñadas para el cliente y su presencia no equivale a una filtración.

## Solución

- Retirar del **árbol activo** de la raíz exclusivamente los dos archivos `index_PRE_*.html`.
- El código histórico se conserva en el historial inmutable Git (commit base `41c6ea51d94152dde6c7f490e85b730773ff0c5a`); puede recuperarse sin copiar datos desde Supabase.
- Agregar en `tests/security_surface_report.js` una comprobación **HIGH/fail-closed** que falla el Quality Gate si aparece cualquier otro `.html` o `.htm` en la raíz, además del `index.html` canónico.
- El archivo `index.html`, las migraciones SQL, Auth, Storage, políticas RLS, órdenes, certificaciones y documentos no se modifican.

**Limitación:** retirar de Pages **no borra el historial público del repositorio**. El código anterior sigue accesible en commits antiguos para propietarios y visitantes con acceso al repo. Si se identificara un secreto real en el historial, habría que revocarlo/rotarlo; limpiar el historial no reemplaza rotar credenciales.

## Gate y validación

1. En la rama, verificar el árbol raíz: exactamente `index.html` como archivo HTML.
2. CI: `npm run security:scan`, `npm test`, cuatro shards Chromium y control de conflictos.
3. Merge a main únicamente si todo es verde y el diff no altera `index.html`.
4. Confirmar despliegue GitHub Pages en el SHA del merge.
5. Comprobar `https://msp-byte.github.io/HTML-COI-Linea-Roca/` y `/#inicio` operativos; comprobar que las dos rutas `/index_PRE_*.html` dejan de responder con HTML antiguo (esperado 404 tras publicar/cache).
6. Si falla, restaurar la versión histórica desde Git y revisar la causa antes de relanzar Pages.

## Restante en V3

Esta medida no cierra los permisos de UPDATE directo, las 27 advertencias de `SECURITY DEFINER`, la protección de contraseñas filtradas, MFA, ni la revisión detallada de los sinks DOM. Permanecen abiertos en #152. La seguridad no se certifica en porcentajes sin evaluación independiente.
