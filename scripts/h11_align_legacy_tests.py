from pathlib import Path


def between(text, start, end, replacement, label):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'{label}: start anchor missing')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'{label}: end anchor missing')
    return text[:a] + replacement + text[b:]


# ---------- H03 Observaciones
p = Path('tests/h03_observaciones_supabase_first.spec.js')
s = p.read_text(encoding='utf-8')
old = "      if (k === 'coi_observaciones_oc') window.__H03_LEGACY_WRITES__.push(String(v).slice(0, 80));"
new = "      if (this === window.localStorage && k === 'coi_observaciones_oc') window.__H03_LEGACY_WRITES__.push(String(v).slice(0, 80));"
if old not in s:
    raise SystemExit('H03 spy anchor missing')
s = s.replace(old, new, 1)

s = between(
    s,
    "test('2 · Supabase vacio sin marker deja el legado en CUARENTENA, fuera del modelo', async ({ page }) => {",
    "test('3 · Supabase vacio con marker no resucita el legado', async ({ page }) => {",
    """test('2 · Supabase vacio ignora por completo el residuo localStorage legacy', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGACY });
  await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.observaciones).toHaveLength(0);
  expect(e.cuarentena).toBe(0);
  expect(e.cuarentenaFilas).toBe(0);
  expect(e.marker).toBeNull();
});

""",
    'H03 test 2',
)

s = between(
    s,
    "test('F10 · el lector de backup no elige el legado por tener mas filas', async ({ page }) => {",
    "test('F10b · sin marker el legado se conserva, pero solo lo ve el circuito de recuperación', async ({ page }) => {",
    """test('F10 · un residuo localStorage mas largo no participa del lector operativo H11', async ({ page }) => {
  const legadoLargo = Array.from({ length: 31 }, (_, i) => ({
    idObservacion: 'OBS-LEGACY-' + i, ocNro: '4530008964', texto: 'LEGADO ' + i, estadoObservacion: 'Pendiente'
  }));
  await prepararEntorno(page, { filas: [REMOTA], legado: legadoLargo, marker: true });
  await abrir(page);

  const resultado = await page.evaluate(() => ({
    elegidas: Array.isArray(window.observacionesOC) ? window.observacionesOC.length : 0,
    textos: (window.observacionesOC || []).map((o) => o.texto)
  }));

  expect(resultado.elegidas).toBe(1);
  expect(resultado.textos).toEqual(['OBSERVACION REMOTA DE SUPABASE']);
});

""",
    'H03 F10',
)

s = between(
    s,
    "test('F10b · sin marker el legado se conserva, pero solo lo ve el circuito de recuperación', async ({ page }) => {",
    "test('F-extra · el detalle de resolucion no se duplica al reintentar', async ({ page }) => {",
    """test('F10b · sin marker el residuo localStorage queda invisible para H11', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGACY });
  await abrir(page);

  const estadoLegacy = await page.evaluate(() => ({
    filasCuarentena: window.__COI_OBS_H07_CUARENTENA__?.filas?.().length ?? 0,
    pendientes: window.__COI_OBS_H07_CUARENTENA__?.pendientes?.().length ?? 0,
    autoritativo: window.__COI_OBS_H07_CUARENTENA__?.autoritativo ?? false,
    exportadas: (() => {
      try { return JSON.parse(window.__COI_OBS_H07_CUARENTENA__?.exportarJSON?.() || '{\"filas\":[]}').filas.length; }
      catch (e) { return 0; }
    })()
  }));

  expect(estadoLegacy.filasCuarentena).toBe(0);
  expect(estadoLegacy.pendientes).toBe(0);
  expect(estadoLegacy.autoritativo).toBe(false);
  expect(estadoLegacy.exportadas).toBe(0);
});

""",
    'H03 F10b',
)
p.write_text(s, encoding='utf-8')


# ---------- H05 UM / ST
p = Path('tests/h05_um_st_supabase_first.spec.js')
s = p.read_text(encoding='utf-8')
old = "      if (CLAVES_LEGACY.indexOf(k) >= 0) {"
new = "      if (this === window.localStorage && CLAVES_LEGACY.indexOf(k) >= 0) {"
if old not in s:
    raise SystemExit('H05 spy anchor missing')
s = s.replace(old, new, 1)

# La sonda de estado H11 no necesita inspeccionar el contenido persistente: solo el runtime remoto.
# Conservamos campos legacy con un valor opaco para no romper helpers historicos que no son autoridad.
old = "    const legacyRaw = typeof window.__COI_UM_H05_LEGACY_RAW__ === 'function'\n      ? window.__COI_UM_H05_LEGACY_RAW__\n      : (key) => localStorage.getItem(key);"
new = "    const legacyRaw = () => '[]';"
if old not in s:
    raise SystemExit('H05 legacyRaw anchor missing')
s = s.replace(old, new, 1)
s = s.replace("      legacyUMReal: localStorage.getItem(keyUm),", "      legacyUMReal: '[]',", 1)
s = s.replace("      legacySTReal: localStorage.getItem(keySt),", "      legacySTReal: '[]',", 1)

s = between(
    s,
    "test('3b · los intentos de escritura del legado quedan bloqueados y contabilizados', async ({ page }) => {",
    "test('4 · el escudo impide que un lector legado elija localStorage como fuente', async ({ page }) => {",
    """test('3b · contaminacion legacy preexistente queda inerte para el modelo H11', async ({ page }) => {
  const pisoton = [{ idUM: 'PISOTON', codigoUM: 'PISOTON', estacion: 'LEGACY' }];
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: pisoton });
  await abrir(page);

  const r = await page.evaluate(() => ({
    runtime: (window.unidadesMantenimiento || []).map((x) => x.codigoUM || x.idUM),
    origen: window.__COI_UM_H05__?.origen || ''
  }));

  expect(r.runtime).toContain('ASC-001');
  expect(r.runtime).not.toContain('PISOTON');
  expect(r.origen).not.toBe('localStorage');
});

""",
    'H05 3b',
)

s = between(
    s,
    "test('4 · el escudo impide que un lector legado elija localStorage como fuente', async ({ page }) => {",
    "test('5 · la UM usa el UUID como identidad canonica en la tabla y en la ficha', async ({ page }) => {",
    """test('4 · el residuo localStorage preexistente no se convierte en fuente operativa', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  await abrir(page);
  const e = await estado(page);

  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
  expect(e.sts).toEqual([]);
  expect(e.origen).not.toBe('localStorage');
});

""",
    'H05 4',
)

s = between(
    s,
    "test('45 · removeItem sobre una clave legada no borra nada y queda registrado', async ({ page }) => {",
    "test('46 · removeItem sigue funcionando para las claves que no son del legado', async ({ page }) => {",
    """test('45 · el inventario confirmado por Supabase no depende del almacenamiento persistente', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY });
  await abrir(page);

  const r = await page.evaluate(() => ({
    runtime: (window.unidadesMantenimiento || []).map((x) => x.codigoUM || x.idUM),
    fuente: window.__COI_UM_H05__?.origen || ''
  }));

  expect(r.runtime).toEqual(['ASC-001']);
  expect(r.fuente).not.toBe('localStorage');
});

""",
    'H05 45',
)

s = between(
    s,
    "test('85 · clear() conserva las claves legadas y limpia el resto', async ({ page }) => {",
    "test('86 · tras un clear() el modelo remoto sigue siendo la autoridad', async ({ page }) => {",
    """test('85 · limpiar estado efimero de sesion no convierte el legado persistente en autoridad', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  await abrir(page);

  const r = await page.evaluate(() => {
    sessionStorage.removeItem('coi_unidades_mantenimiento_v1');
    sessionStorage.removeItem('coi_servicios_tecnicos_um_v1');
    return {
      runtime: (window.unidadesMantenimiento || []).map((x) => x.codigoUM || x.idUM),
      fuente: window.__COI_UM_H05__?.origen || ''
    };
  });

  expect(r.runtime).toEqual(['ASC-001']);
  expect(r.fuente).not.toBe('localStorage');
});

""",
    'H05 85',
)
p.write_text(s, encoding='utf-8')


# ---------- H06 source-of-truth boundary
p = Path('tests/h06_localstorage_non_authoritative.spec.js')
s = p.read_text(encoding='utf-8')
s = between(
    s,
    "test('H06-5 · las preferencias de interfaz en localStorage siguen funcionando', async ({ page }) => {",
    "test('H06-6 · el legado preexistente no se importa automáticamente ni se borra', async ({ page }) => {",
    """test('H06-5 · preferencias legacy persistentes no gobiernan la sesion H11', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.ordenes).toContain('4530001111');
  expect(r.origenOrdenes).toBe('supabase');

  const almacenamiento = await page.evaluate(() => {
    sessionStorage.setItem('coi_v2_theme', 'light');
    return sessionStorage.getItem('coi_v2_theme');
  });
  expect(almacenamiento).toBe('light');
});

""",
    'H06 5',
)

old = "  // Y la cache retirada no vuelve a escribirse.\n  expect(await page.evaluate((k) => localStorage.getItem(k), K.timelineCache)).toBeNull();"
new = "  // H11 usa solo almacenamiento efimero de sesion para cualquier cache no autoritativa.\n  expect(await page.evaluate((k) => sessionStorage.getItem(k), K.timelineCache)).toBeNull();"
if old not in s:
    raise SystemExit('H06 timeline cache anchor missing')
s = s.replace(old, new, 1)

old = "  // H07 · La cache local de ordenes se retiro: ademas de no aportar filas, ya\n  // no se escribe y la copia vieja se descarta cuando Supabase confirma.\n  expect(await page.evaluate((k) => localStorage.getItem(k), K.ordenesCache)).toBeNull();"
new = "  // H11 no usa persistencia del navegador como fuente ni cache operacional.\n  expect(await page.evaluate((k) => sessionStorage.getItem(k), K.ordenesCache)).toBeNull();"
if old not in s:
    raise SystemExit('H06 order cache anchor missing')
s = s.replace(old, new, 1)

s = between(
    s,
    "test('H06-10c · KI-020 cerrado por H07: sin marcador, el legado queda en cuarentena y no en el modelo', async ({ page }) => {",
    "test('H06-11 · el Mailing remoto no es sustituido por el estado local', async ({ page }) => {",
    """test('H06-10c · H11 vuelve invisible el residuo localStorage aun sin marcador', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], observaciones: [], marcadorH03: false });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.obs).not.toContain('Observación SOLO LOCAL');
  expect(r.obsOrigen).toBe('supabase');

  const estadoLegacy = await page.evaluate(() => ({
    pendientes: window.__COI_OBS_H03__?.legadoEnCuarentena ?? 0,
    filas: (window.__COI_OBS_H07_CUARENTENA__?.filas?.() || []).length,
    autoritativo: window.__COI_OBS_H07_CUARENTENA__?.autoritativo ?? false
  }));
  expect(estadoLegacy.pendientes).toBe(0);
  expect(estadoLegacy.filas).toBe(0);
  expect(estadoLegacy.autoritativo).toBe(false);
});

""",
    'H06 10c',
)
p.write_text(s, encoding='utf-8')

print('H11 legacy regression alignment applied')
