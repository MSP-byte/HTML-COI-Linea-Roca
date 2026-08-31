#!/usr/bin/env node
'use strict';

/*
  H05 / H04 — Unidades de Mantenimiento y Servicios Tecnicos Supabase-first.

  Control reproducible sin navegador. Verifica lo que un test funcional no puede
  garantizar barato y lo que se rompio de verdad durante la implementacion:

    1) las columnas que la capa lee y escribe EXISTEN en el esquema canonico
       (el baseline es la fuente; el contrato productivo lo confirma);
    2) el congelamiento del inventario legado se instala ANTES de la llamada
       sincrona a init(), que es la que sembraba las 28 UM de demostracion;
    3) la capa no siembra demos, no usa el legado como fallback y no persiste
       datos operativos de UM/ST en localStorage;
    4) no existe DELETE de UM ni de ST: baja logica y cancelacion;
    5) los guardas de generacion, sesion y doble envio siguen presentes;
    6) el orden de los <script> es el correcto.

  No toca STAGING ni PRODUCCION.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const baseline = fs.readFileSync('supabase/migrations/202608090000_core_schema_baseline.sql', 'utf8');
const contrato = require('./fixtures/production_schema_contract.json');

let aprobados = 0;
const check = (ok, detalle) => {
  if (!ok) throw new assert.AssertionError({ message: detalle });
  aprobados++;
};

// ---------------------------------------------------------------- utilidades
// Columnas declaradas en el «create table» del baseline.
function columnasBaseline(tabla) {
  const re = new RegExp('create table if not exists public\\.' + tabla + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i');
  const m = re.exec(baseline);
  check(Boolean(m), `no se encontro el create table de ${tabla} en el baseline`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^constraint\b/i.test(l))
    .map((l) => (/^([a-z_][a-z0-9_]*)\s/i.exec(l) || [])[1])
    .filter(Boolean);
}

const bloque = (id) => {
  const abre = `<script id="${id}">`;
  const i = html.indexOf(abre);
  check(i >= 0, `falta el bloque ${id}`);
  const j = html.indexOf('</script>', i);
  check(j > i, `el bloque ${id} no cierra`);
  return { texto: html.slice(i, j), inicio: i };
};

// ---------------------------------------------- 1) columnas contra el esquema
const COLS_UM = columnasBaseline('coi_unidades_mantenimiento');
const COLS_ST = columnasBaseline('coi_servicios_tecnicos_um');

// El baseline y el snapshot productivo tienen que decir lo mismo: si divergen,
// cualquier conclusion de este control seria sobre un esquema inventado.
for (const [tabla, cols] of [['coi_unidades_mantenimiento', COLS_UM], ['coi_servicios_tecnicos_um', COLS_ST]]) {
  const delContrato = Object.keys(contrato[tabla].columnas).sort();
  check(
    JSON.stringify(cols.slice().sort()) === JSON.stringify(delContrato),
    `${tabla}: el baseline declara [${cols.sort().join(', ')}] y el contrato productivo [${delContrato.join(', ')}]`
  );
}

// Nombres que NO existen y que resultaban tentadores: el control existe porque
// la primera version del guard de integridad uso «tipo» y fallaba en el INSERT.
for (const inexistente of ['tipo', 'numero_serie', 'fecha_alta', 'fecha_baja']) {
  check(!COLS_UM.includes(inexistente),
    `coi_unidades_mantenimiento no deberia tener ${inexistente}: revisar el control`);
}

const capa = bloque('coi-h05-um-st-supabase-first');
const guard = html.indexOf('__COI_UM_H05_ESCRITURAS_BLOQUEADAS__');

// Las listas de campos que la capa pide a PostgREST.
function camposDeclarados(nombre) {
  const re = new RegExp('const ' + nombre + " = '([^']+)';");
  const m = re.exec(capa.texto);
  check(Boolean(m), `no se encontro la constante ${nombre}`);
  return m[1].split(',').map((s) => s.trim());
}
for (const [constante, cols, tabla] of [
  ['CAMPOS_UM', COLS_UM, 'coi_unidades_mantenimiento'],
  ['CAMPOS_ST', COLS_ST, 'coi_servicios_tecnicos_um']
]) {
  const pedidos = camposDeclarados(constante);
  const sobran = pedidos.filter((c) => !cols.includes(c));
  check(sobran.length === 0, `${constante} pide columnas que ${tabla} no tiene: ${sobran.join(', ')}`);
  const faltan = cols.filter((c) => !pedidos.includes(c));
  check(faltan.length === 0, `${constante} no lee columnas existentes de ${tabla}: ${faltan.join(', ')}`);
}

// Las claves que la capa escribe en cada insert tienen que ser columnas reales.
function clavesDeObjeto(marca) {
  const i = capa.texto.indexOf(marca);
  check(i >= 0, `no se encontro ${marca}`);
  // Se arranca despues de la marca para no capturar su propia clave.
  const trozo = capa.texto.slice(i + marca.length, i + marca.length + 900);
  return (trozo.match(/^\s{6,}([a-z_][a-z0-9_]*):/gm) || [])
    .map((s) => s.trim().replace(':', ''));
}
const escritasST = clavesDeObjeto('      fila: {');
check(escritasST.length >= 8, `se esperaban las columnas del insert de ST y se leyeron ${escritasST.length}`);
for (const c of escritasST) {
  check(COLS_ST.includes(c), `el insert de ST escribe ${c}, que no es columna de coi_servicios_tecnicos_um`);
}
check(escritasST.includes('unidad_id'), 'el insert de ST no fija unidad_id');
check(escritasST.includes('nro_st'), 'el insert de ST no fija nro_st');

// ------------------------------------------- 2) orden de carga del congelamiento
const llamadaInit = html.indexOf('\ntry{\r\n  init();');
check(llamadaInit > 0, 'no se encontro la llamada sincrona a init()');
check(guard > 0 && guard < llamadaInit,
  'el congelamiento del legado tiene que instalarse ANTES de init(): si no, cargarUM() siembra las 28 UM de demostracion');
check(capa.inicio > llamadaInit,
  'la capa H05 debe cargarse despues de init(), como ultima autoridad de la vista');

// El escudo cubre lectura y escritura de todas las claves legadas de UM y ST.
const textoGuard = html.slice(guard - 3000, llamadaInit);
for (const clave of [
  'coi_roca_unidades_mantenimiento', 'coi_unidades_mantenimiento', 'coi_ums',
  'coi_um_catalogo', 'coiUM', 'coi_um', 'coiUMs', 'unidadesMantenimiento',
  'coi_servicios_tecnicos_um', 'coi_servicios_tecnicos'
]) check(textoGuard.includes(`'${clave}'`), `el congelamiento no cubre la clave legada ${clave}`);
check(/Storage\.prototype\.getItem = function/.test(textoGuard), 'el congelamiento no intercepta getItem');
check(/Storage\.prototype\.setItem = function/.test(textoGuard), 'el congelamiento no intercepta setItem');
// Nunca se borra el legado: se congela.
for (const destructivo of [/localStorage\.removeItem/, /localStorage\.clear/, /\.clear\(\)/]) {
  check(!destructivo.test(textoGuard), `el congelamiento no puede borrar el legado: ${destructivo}`);
}
check(/__COI_UM_H05_LEGACY_RAW__/.test(textoGuard) && /__COI_UM_H05_LEGACY_WRITE__/.test(textoGuard),
  'el congelamiento debe dejar una via deliberada de acceso al legado para H06');

// Holder unico del modelo: las globales legadas son vistas de solo lectura. Sin
// esto, recoverUMs() de V58.1R8 volvia a publicar su umMaster —el inventario del
// operador anterior— sobre window.unidadesMantenimiento despues de un cambio de
// sesion, y la correccion quedaba a merced de un timer.
check(/window\.__COI_UM_H05_MODELO__/.test(textoGuard), 'falta el holder unico del modelo de UM/ST');
check(/window\.__COI_UM_H05_APLICAR__/.test(textoGuard), 'falta el aplicador unico del modelo');
for (const global of ['unidadesMantenimiento', 'serviciosTecnicos', 'serviciosTecnicosUM']) {
  check(
    new RegExp("Object\\.defineProperty\\(window, '" + global + "'").test(textoGuard),
    `${global} debe ser una vista de solo lectura sobre el holder`
  );
}
check(/set: function \(\) \{ reponerLexicos\(\); \}/.test(textoGuard),
  'el setter de las globales legadas debe ignorar el valor y reparar el binding lexico');
check(/if \(typeof window\.__COI_UM_H05_APLICAR__ === 'function'\) return window\.__COI_UM_H05_APLICAR__/.test(capa.texto),
  'la capa H05 debe publicar su modelo a traves del holder');

// ------------------------------------------- 3) sin siembra ni fallback legado
for (const prohibido of [
  /unidadesMantenimientoDemo/,
  /serviciosTecnicosDemo/,
  /legacy-readonly/,
  /legadoSoloLectura/
]) check(!prohibido.test(capa.texto), `la capa H05 no puede referirse al legado operativo: ${prohibido}`);

// La capa no persiste UM/ST en localStorage por ninguna via.
for (const prohibido of [
  /localStorage\.setItem/,
  /saveJSON\s*\(/,
  /saveJSONKey\s*\(/,
  /\.removeItem\s*\(/,
  /localStorage\.clear/
]) check(!prohibido.test(capa.texto), `la capa H05 no puede escribir ni borrar localStorage: ${prohibido}`);

// Remoto vacio es un estado valido y explicito.
check(/Remoto vacio es un estado valido/.test(capa.texto),
  'falta la declaracion de que el remoto vacio es un estado valido');
check(/No hay Unidades de Mantenimiento cargadas en Supabase/.test(capa.texto),
  'falta el mensaje de inventario remoto vacio');
// Ante un error se conserva el ultimo confirmado; nunca se cae al legado.
check(/conservarUltimoConfirmado/.test(capa.texto), 'falta la conservacion del ultimo remoto confirmado');
check(/error-sin-sincronizar/.test(capa.texto), 'falta el estado explicito de falta de sincronizacion');
check(/No se muestran datos locales/.test(capa.texto),
  'sin lectura confirmada la UI debe decir que no muestra datos locales');

// ------------------------------------------- 4) sin borrado fisico
check(!/\.delete\s*\(\s*\)/.test(capa.texto), 'la capa H05 no puede emitir DELETE contra Supabase');
check(/estado: 'BAJA'/.test(capa.texto), 'falta la baja logica de la UM (estado = BAJA)');
check(/\[BAJA '/.test(capa.texto), 'la baja debe dejar una marca fechada, porque el esquema no tiene fecha_baja');
check(/estado: 'Cancelado'/.test(capa.texto), 'falta la cancelacion del ST en lugar del borrado');
check(/data-h05-cancelar-st/.test(capa.texto), 'falta la accion de cancelar ST en la ficha');
check(/no se eliminan: use Cancelar/i.test(capa.texto),
  'el boton Eliminar legado debe explicar que los ST se cancelan');

// ------------------------------------------- 5) guardas de robustez
for (const [patron, detalle] of [
  [/const generacion = \+\+runtime\.generacion/, 'falta el token de generacion por request'],
  [/const vigente = \(\) => generacion === runtime\.generacion/, 'falta el descarte de respuestas viejas'],
  [/runtime\.authUserId/, 'falta la identidad de sesion asociada al modelo'],
  [/const enCurso = new Set\(\)/, 'falta el lock de mutacion'],
  [/if \(llave && enCurso\.has\(llave\)\) return false/, 'el lock de mutacion no bloquea el doble envio'],
  [/coi:supabase-auth/, 'falta la reaccion al cambio de sesion'],
  [/esAutorizacionAdministrativaSupabaseV60/, 'la autorizacion debe reutilizar el gate canonico'],
  [/esUuid/, 'falta la validacion de UUID canonico'],
  [/function resolverOC/, 'falta la validacion de OC contra el catalogo remoto'],
  [/no existe en Órdenes/, 'una OC inexistente debe rechazarse'],
  [/ya tiene un Servicio Técnico/, 'falta el control de (unidad_id, nro_st) duplicado'],
  [/Ya existe una Unidad de Mantenimiento con el codigo/, 'falta el manejo del UNIQUE de codigo_um'],
  [/errorUnico/, 'falta la traduccion del error 23505'],
  [/dataset\.h05Firma/, 'falta la firma que evita repintar un formulario en uso']
]) check(patron.test(capa.texto), detalle);

// La identidad canonica es el uuid, no el codigo de negocio.
check(/unidad_id: um\._supabaseId/.test(capa.texto), 'el ST debe guardar el UUID de la UM');
check(/value="' \+ esc\(u\._supabaseId\)/.test(capa.texto),
  'el selector de UM debe exponer el UUID como value, no el codigo legado');

// No se inventa un sistema de roles nuevo ni se amplian permisos.
check(!/coi_admin_pin|adminPin/.test(capa.texto), 'la capa H05 no puede usar el PIN local como autorizacion');

// ------------------------------------------- 5b) edicion de Servicios Tecnicos
// La ficha tiene que ofrecer una edicion real, no solo alta y cancelacion.
for (const [patron, detalle] of [
  [/function editarST\(uuid\)/, 'falta la accion de editar un Servicio Tecnico'],
  [/function salirDeEdicionST\(\)/, 'falta la salida del modo edicion'],
  [/data-h05-editar-st/, 'la tabla de ST no ofrece Editar'],
  [/data-h05-salir-edicion-st/, 'no se puede abandonar la edicion sin guardar'],
  [/let stEditandoUuid = null;/, 'falta el estado del ST en edicion'],
  [/function prepararFilaST\(datos, excluirUuid, ocOriginal\)/, 'la validacion no admite excluir el propio ST ni conservar su OC'],
  [/String\(s\._supabaseId\) !== String\(excluirUuid\)/, 'al editar, el ST no debe chocar consigo mismo'],
  [/delete patch\.unidad_id;/, 'editar un ST no puede reasignarlo a otra UM'],
  [/ya usa el número/, 'falta la traduccion operativa del UNIQUE remoto del ST']
]) check(patron.test(capa.texto), detalle);

// La edicion actualiza la misma fila: nunca inserta una nueva.
check(/conManejoDeError\('stEditar:' \+ uuid/.test(capa.texto),
  'la edicion de ST debe pasar por el lock de mutacion con su propio uuid');
check(/await actualizarST\(uuid, patch\);/.test(capa.texto),
  'la edicion de ST debe ir por UPDATE contra el uuid');

// Codigo muerto retirado: el escudo lo instala el bloque de congelamiento y el
// estado del ST se edita por formulario.
check(!/const getItemNativo = Storage\.prototype\.getItem;[\s\S]{0,80}const runtime = \{/.test(capa.texto),
  'la capa H05 conserva la referencia muerta a getItem');
check(!/function cambiarEstadoST/.test(capa.texto),
  'cambiarEstadoST quedo sin uso al existir la edicion completa del ST');

// ------------------------------------------- 6) el guard de integridad acompaña
const migracion = fs.readFileSync('supabase/migrations/202608300003_h05_um_delete_guard.sql', 'utf8');
check(/on delete restrict/i.test(migracion), 'la migracion H05 debe dejar la FK en RESTRICT');
const pendientes = (contrato._divergencias_pendientes || {}).fk || [];
const h05 = pendientes.find((d) => d.tabla === 'coi_servicios_tecnicos_um' && d.columna === 'unidad_id');
check(Boolean(h05), 'la divergencia pendiente H05 debe estar declarada en el contrato productivo');
check(h05.produccion === 'CASCADE' && h05.repo === 'RESTRICT',
  'la divergencia H05 debe declarar produccion CASCADE y repo RESTRICT');
const resueltas = (contrato._divergencias_pendientes || {})._resueltas || [];
check(
  !pendientes.some((d) => d.tabla === 'coi_observaciones_oc'),
  'H03 ya esta aplicado en remoto: no puede seguir declarado como divergencia pendiente'
);
check(
  resueltas.some((d) => d.tabla === 'coi_observaciones_oc'),
  'la reconciliacion de H03 debe quedar registrada'
);
check(
  contrato.coi_observaciones_oc.fk.some((f) => f[0] === 'orden_id' && f[2] === 'RESTRICT'),
  'el snapshot productivo debe reflejar que H03 ya esta aplicado (RESTRICT)'
);

// El UNIQUE de H04 es la autoridad ante concurrencia: la comprobacion previa del
// frontend no alcanza con dos clientes simultaneos.
const migracionH04 = fs.readFileSync('supabase/migrations/202608310001_h04_st_unique_guard.sql', 'utf8');
check(/add constraint coi_servicios_tecnicos_um_unidad_nro_st_key/i.test(migracionH04),
  'la migracion H04 debe crear el UNIQUE con nombre estable');
check(/unique \(unidad_id, nro_st\)/i.test(migracionH04), 'el UNIQUE debe cubrir (unidad_id, nro_st)');
check(/COI_ST_DUPLICADOS_PREEXISTENTES/.test(migracionH04),
  'la migracion H04 debe abortar explicitamente si encuentra duplicados');
for (const destructivo of [/\btruncate\b/i, /\bdelete\s+from\b/i, /\bupdate\s+public\./i, /\bdrop\s+table\b/i]) {
  check(!destructivo.test(migracionH04), `la migracion H04 no puede contener: ${destructivo}`);
}
const uniquePendientes = (contrato._divergencias_pendientes || {}).unique || [];
const h04 = uniquePendientes.find((d) => d.tabla === 'coi_servicios_tecnicos_um');
check(Boolean(h04), 'la divergencia pendiente H04 debe estar declarada en el contrato productivo');
check(h04.produccion === 'ausente' && h04.repo === 'presente',
  'la divergencia H04 debe declarar produccion ausente y repo presente');
check(
  !(contrato.coi_servicios_tecnicos_um.unique || []).length,
  'el snapshot productivo de coi_servicios_tecnicos_um no tiene UNIQUE: no debe declararse como si lo tuviera'
);

console.log('H05/H04 UM y ST Supabase-first: capa verificada contra el esquema real.');
console.log(`  coi_unidades_mantenimiento : ${COLS_UM.length} columnas, todas leidas por la capa`);
console.log(`  coi_servicios_tecnicos_um  : ${COLS_ST.length} columnas, todas leidas por la capa`);
console.log('  Congelamiento del legado   : instalado antes de init(), sin borrar claves');
console.log('  Siembra de demo            : ausente');
console.log('  Persistencia local de UM/ST: ausente');
console.log('  Borrado fisico             : ausente (BAJA / Cancelado)');
console.log(`${aprobados} controles H05/H04 aprobados; 0 fallidos.`);
