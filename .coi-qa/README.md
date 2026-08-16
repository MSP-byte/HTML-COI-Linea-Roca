# COI QA local

Infraestructura reproducible para validar STAGING sin tocar produccion.

## Requisitos

- Node.js segun `package.json`.
- Dependencias instaladas en la raiz con `npm ci`.
- Google Chrome disponible.
- Servidor local en `http://127.0.0.1:8765/index.STAGING.html` (el Doctor puede iniciarlo).
- Perfil persistente en `.coi-qa/chrome-profile/`; nunca se versiona.

## Comandos

```powershell
npm.cmd run qa:doctor
npm.cmd run qa:dirty
npm.cmd run qa:admin
```

- `qa:doctor`: controles estaticos, migraciones versionadas, project-ref y SHA de produccion.
- `qa:dirty`: prueba DOM-only del editor; restaura el valor y no guarda.
- `qa:admin`: valida sesion Supabase, rol efectivo y consistencia visual de Administracion.

Los modos read-only bloquean requests `POST`, `PUT`, `PATCH` y `DELETE` hacia REST/Storage de Supabase y fallan si detectan un intento.

## Artefactos locales

Logs, screenshots, reportes de runtime, perfiles Chrome, backups de scripts y diagnosticos ad-hoc estan excluidos por `.gitignore`. Los scripts formales son:

- `COI-Staging-Doctor.ps1`
- `ui-smoke.mjs`
- `coi-qa.config.json`

`UiFullE2E` sigue requiriendo `-AllowStagingWrite` y no forma parte de la regresion read-only.
