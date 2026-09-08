from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


index = Path("index.html")
s = index.read_text(encoding="utf-8")

s = replace_once(
    s,
    "  let aplicando = false;      // el router esta imponiendo una ruta\n  let silencio = 0;           // hashchange que causamos nosotros\n  let pendiente = null;",
    "  let aplicando = false;      // el router esta imponiendo una ruta\n  let restaurando = false;    // preserva el hash inicial mientras espera datos\n  let silencio = 0;           // hashchange que causamos nosotros\n  let pendiente = null;",
    "router state",
)

s = replace_once(
    s,
    "  function refrescarHash(opciones) {\n    if (aplicando) return false;          // la ruta la impuso el router\n    return publicar(rutaVigente(), opciones);\n  }",
    "  function refrescarHash(opciones) {\n    // Durante la restauracion inicial la pantalla puede repintarse varias veces\n    // mientras llegan sesion y snapshots. Publicar la vista transitoria en ese\n    // momento pisaria el hash solicitado (por ejemplo #ficha-um/... -> #inicio)\n    // antes de que el router alcance a resolverlo.\n    if (aplicando || restaurando) return false;\n    return publicar(rutaVigente(), opciones);\n  }",
    "refresh guard",
)

start_marker = "  async function restaurar() {"
end_marker = "\n\n  if (!window.__COI_H10_ROUTER_BOUND__) {"
start = s.find(start_marker)
if start < 0:
    raise SystemExit("restaurar: start marker not found")
end = s.find(end_marker, start)
if end < 0:
    raise SystemExit("restaurar: end marker not found")

new_restaurar = r'''  async function restaurar() {
    if (arrancado) return;
    arrancado = true;
    restaurando = true;
    try {
      const inicial = hashActual();
      if (!inicial) {
        // Sin hash se conserva la landing canonica vigente —Inicio operativo—.
        // Mientras restaurando=true los repintados intermedios no publican una
        // URL accidental; la normalizacion unica ocurre en finally.
        await dormir(900);
        return;
      }
      // El resultado de esperarArranque SI se mira: sin datos autoritativos no
      // se aplica una ruta que terminaria afirmando que la entidad no existe.
      const listo = await esperarArranque();
      // esperarArranque() es asincrono. Si durante esa espera el operador ya
      // navego, la ruta capturada al inicio quedo obsoleta y NO puede volver a
      // imponerse sobre su accion mas reciente.
      if (hashActual() !== inicial) return;
      if (!listo) {
        const partes = texto(inicial).split('/').filter((x) => x !== '');
        const cabeza = safeDecode(partes[0] || '');
        // El gate de arranque comprueba el snapshot de ORDENES, y por lo tanto
        // solo puede bloquear rutas que dependan de ese catalogo.
        //
        // #ficha-um NO depende de coi_ordenes: su autoridad es el snapshot H05
        // de Unidades de Mantenimiento. Bloquearla aca era hacer que un fallo de
        // Ordenes tapara una ficha UM que el remoto podia servir perfectamente.
        // Esa ruta entra al camino normal, donde esperarUM() ya espera
        // __COI_UM_H05__.sincronizado y distingue encontrada / ausente / error.
        //
        // Las rutas que no resuelven una entidad puntual —#ordenes, #red, #um—
        // tampoco se bloquean: no afirman nada sobre una entidad concreta.
        if (cabeza.ok && cabeza.value === 'ficha-oc' && partes[1]) {
          mostrarErrorCatalogo(inicial);
          return;
        }
      }
      await aplicar(inicial);
      for (const ms of [700, 1800]) {
        await dormir(ms);
        await reafirmar(inicial);
      }
    } finally {
      // A partir de aca la restauracion ya no compite con MutationObserver ni
      // con wrappers legados. Se publica UNA sola normalizacion que describe la
      // pantalla resultante (o la navegacion mas nueva del operador).
      restaurando = false;
      refrescarHash({ reemplazar: true });
    }
  }'''

s = s[:start] + new_restaurar + s[end:]
index.write_text(s, encoding="utf-8")

spec = Path("tests/h10_routing_cierre_archivo.spec.js")
t = spec.read_text(encoding="utf-8")
old = """  expect(ok).toBe(false);\n  expect(await cambiosRPC(page)).toEqual([]);\n  const r = await page.evaluate((n) => {\n    const f = window.__H10__.fila(n) || {};\n    return {\n      estado: f.estado_coi,\n      fecha: f.fecha_cierre_operativo,\n      observacion: f.observacion_cierre\n    };\n  }, OC_ACTIVA.nro_oc);\n  expect(r.estado).toBe('Cerrada');\n  expect(r.fecha).toBe('2026-08-29');\n  expect(r.observacion).toBe('Cierre confirmado por otro operador');\n"""
new = """  expect(ok).toBe(false);\n  // Con H10 la atomicidad vive en PostgreSQL, no en un SELECT preventivo del\n  // navegador. Una pestaña con snapshot obsoleto puede intentar el cierre por\n  // la RPC canónica; el FOR UPDATE + guard server-side rechazan ese segundo\n  // cierre y preservan la auditoría ya confirmada.\n  const intentos = await cambiosRPC(page);\n  expect(intentos).toHaveLength(1);\n  expect(intentos[0]).toHaveProperty('estado_coi', 'Cerrada');\n  expect(intentos[0]).toHaveProperty('fecha_cierre_operativo');\n  expect(intentos[0]).toHaveProperty('observacion_cierre', 'Cierre operativo de prueba');\n  expect(intentos[0]).not.toHaveProperty('estado_registro');\n  const r = await page.evaluate((n) => {\n    const f = window.__H10__.fila(n) || {};\n    return {\n      estado: f.estado_coi,\n      fecha: f.fecha_cierre_operativo,\n      observacion: f.observacion_cierre\n    };\n  }, OC_ACTIVA.nro_oc);\n  expect(r.estado).toBe('Cerrada');\n  expect(r.fecha).toBe('2026-08-29');\n  expect(r.observacion).toBe('Cierre confirmado por otro operador');\n"""
t = replace_once(t, old, new, "H10-57 assertion")
spec.write_text(t, encoding="utf-8")

print("H10 router startup race and H10-57 atomic expectation patched")
