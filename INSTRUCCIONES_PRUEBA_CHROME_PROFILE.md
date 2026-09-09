# Instrucciones de prueba del perfil de Chrome

## GitHub Pages

1. Abrir `https://msp-byte.github.io/HTML-COI-Linea-Roca/?coiDebug=1` desde el perfil afectado.
2. Esperar hasta que `Arranque` indique `Listo` o transcurran ocho segundos.
3. Probar Dashboard, Red Linea Roca, Calendario COI, Ordenes, Carga, Administracion y Buscar OC.
4. Si la pagina no responde, no limpiar datos todavia. Pulsar **Copiar diagnostico**.
5. Guardar el JSON copiado. Revisar `blockingOverlays`, `topElementsAtCenter`, `bodyClasses`, `recentErrors` y `authState`.
6. Pulsar **Recuperar interfaz**. Esta accion no borra localStorage, no cierra sesion y no elimina nodos de extensiones.
7. Si `blockingOverlays` contiene `extensionHint: true`, deshabilitar temporalmente esa extension para este sitio y repetir la prueba.

Tambien se puede ejecutar desde DevTools:

```js
COIDiagnosticoInteraccion()
```

```js
await COIRecuperarInterfaz()
```

## Prueba automatizada local

Servir la raiz de la rama por HTTP:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

En otra terminal, con Node y Playwright disponibles:

```powershell
$env:COI_LONG_TEST_MS='600000'
node tests/chrome-profile-interaction.cjs > TEST_CHROME_PROFILE_RESULTS.json
```

El test intercepta el CDN de Supabase y usa un cliente simulado. No usa credenciales ni escribe en el proyecto Supabase real.

## Criterio de aceptacion

- `passed: true` en el nivel superior del JSON.
- Los siete escenarios con `passed: true`.
- `blockingOverlays` vacio al terminar cada escenario.
- Todos los botones visibles con `legitimate: true` y la vista esperada.
- `longRun.passed: true` despues de diez minutos.
- `financialFixture.passed: true`, cinco registros y parser ARS correcto.
- Cero errores de consola y cero `unhandledrejection`.
