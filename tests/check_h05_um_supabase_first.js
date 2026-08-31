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
// La deteccion NO puede depender de una mezcla concreta de CRLF/LF: el working
// copy de Windows tiene CRLF y el runner de Linux del Quality Gate obtiene LF,
// de modo que un indexOf con separadores literales pasaba en un sistema y
// fallaba en el otro. Se busca por expresion regular tolerante al final de
// linea, y mas abajo se comprueba que el propio detector funcione con ambas
// variantes.
const RE_LLAMADA_INIT = /\r?\ntry\s*\{\r?\n\s*init\(\);/;
const posicionLlamadaInit = (texto) => {
  const m = RE_LLAMADA_INIT.exec(texto);
  return m ? m.index : -1;
};

// Autocomprobacion del detector: si alguien lo volviera a atar a un final de
// linea concreto, esto falla antes que el control real y dice por que.
{
  const cuerpo = 'algo previo\ntry{\n  init();\n}catch(err){}';
  const lf = cuerpo;
  const crlf = cuerpo.replace(/\n/g, '\r\n');
  check(posicionLlamadaInit(lf) > 0, 'el detector de init() no encuentra la llamada con finales LF');
  check(posicionLlamadaInit(crlf) > 0, 'el detector de init() no encuentra la llamada con finales CRLF');
  check(posicionLlamadaInit('sin llamada a init aqui') === -1,
    'el detector de init() no deberia encontrar nada donde no hay llamada');
}

const llamadaInit = posicionLlamadaInit(html);
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
// Nunca se borra el legado: se congela. Se analiza CODIGO, no prosa: los
// comentarios del bloque nombran a proposito localStorage.clear() para explicar
// de que camino administrativo se defiende.
const codigoGuard = textoGuard.replace(/\/\/[^\n]*/g, '');
for (const destructivo of [/localStorage\.removeItem/, /localStorage\.clear/]) {
  check(!destructivo.test(codigoGuard), `el congelamiento no puede borrar el legado: ${destructivo}`);
}
// clear() tampoco puede llevarse las claves legadas: no pasa por removeItem, de
// modo que necesita su propia intercepcion.
check(/Storage\.prototype\.clear = function/.test(codigoGuard),
  'el congelamiento no intercepta clear(): limpiarLocal() borraria el legado');
check(/var clearNativo = Storage\.prototype\.clear;/.test(codigoGuard),
  'falta la referencia nativa a clear()');
check(/clearNativo\.call\(this\);/.test(codigoGuard),
  'clear() debe delegar en el nativo, no llamarse a si mismo');
check(/setItemNativo\.call\(this, conservados/.test(codigoGuard),
  'las claves legadas deben reponerse con el setItem NATIVO, que el wrapper bloquea');
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
  [/Ya existe una Unidad de Mantenimiento con el código/, 'falta el manejo del UNIQUE de codigo_um'],
  [/es el mismo código una vez normalizado/, 'el choque canonico de codigo_um debe explicarse como tal'],
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
  [/function prepararFilaST\(datos, excluirUuid, ocOriginal, estadoOriginal\)/, 'la validacion no admite excluir el propio ST, conservar su OC ni su estado remoto'],
  [/String\(s\._supabaseId\) !== String\(excluirUuid\)/, 'al editar, el ST no debe chocar consigo mismo'],
  [/delete patch\.unidad_id;/, 'editar un ST no puede reasignarlo a otra UM'],
  [/ya usa el número/, 'falta la traduccion operativa del UNIQUE remoto del ST']
]) check(patron.test(capa.texto), detalle);

// La edicion actualiza la misma fila: nunca inserta una nueva.
check(/conManejoDeError\('stEditar:' \+ uuid/.test(capa.texto),
  'la edicion de ST debe pasar por el lock de mutacion con su propio uuid');
check(/await actualizarST\(uuid, patch, stEditandoVersion\);/.test(capa.texto),
  'la edicion de ST debe ir por UPDATE contra el uuid y con la version capturada por el formulario');

// Codigo muerto retirado: el escudo lo instala el bloque de congelamiento y el
// estado del ST se edita por formulario.
check(!/const getItemNativo = Storage\.prototype\.getItem;[\s\S]{0,80}const runtime = \{/.test(capa.texto),
  'la capa H05 conserva la referencia muerta a getItem');
check(!/function cambiarEstadoST/.test(capa.texto),
  'cambiarEstadoST quedo sin uso al existir la edicion completa del ST');

// ------------------------------------------- 5c) hallazgos de la revision del PR
// El escudo del legado tiene que cubrir tambien removeItem: varios caminos de
// Administracion borran claves antes de restaurar, y como setItem ya esta
// bloqueado el legado quedaria destruido y sin manera de reponerlo antes de H06.
check(/Storage\.prototype\.removeItem = function/.test(textoGuard),
  'el congelamiento no intercepta removeItem: el legado se podria borrar');
check(/var removeItemNativo = Storage\.prototype\.removeItem;/.test(textoGuard),
  'falta la referencia nativa a removeItem para las claves ajenas');
check(/return removeItemNativo\.call\(this, k\);/.test(textoGuard),
  'removeItem debe seguir funcionando para las claves que no son legadas');

// Sin sesion no se consulta: la RLS devolveria [] a una peticion anonima y eso
// se veria igual que «el inventario remoto esta vacio».
check(/if \(!uidLectura\) return conservarUltimoConfirmado/.test(capa.texto),
  'sin sesion la capa no puede consultar UM/ST ni declararse sincronizada');
check(/Sesión Supabase no autenticada/.test(capa.texto),
  'falta el estado explicito de sesion ausente');

// BAJA no se alcanza por el formulario ordinario.
check(/const ESTADOS_UM_ORDINARIOS = \['ACTIVA', 'FUERA DE SERVICIO'\];/.test(capa.texto),
  'falta el catalogo de estados ordinarios, sin BAJA');
check(/opcionesSelect\(ESTADOS_UM_ORDINARIOS/.test(capa.texto),
  'el select del formulario no puede ofrecer BAJA');
check(/use «Dar de baja»/.test(capa.texto),
  'guardar con estado BAJA debe derivar a la accion de baja');
check(/estadoAnterior === 'BAJA' && datos\.estado !== 'BAJA'/.test(capa.texto),
  'no se puede reactivar una UM dada de baja desde el formulario ordinario');

// Concurrencia optimista: la version viaja DENTRO del UPDATE.
check(/function condicionarVersion\(consulta, version\)/.test(capa.texto),
  'falta el condicionamiento por version del UPDATE');
check(/version \? consulta\.eq\('fecha_actualizacion', version\) : consulta\.is\('fecha_actualizacion', null\)/.test(capa.texto),
  'la version debe compararse con eq, o con is null cuando no hay version');
check(/async function actualizarUM\(id, patch, version\)/.test(capa.texto),
  'actualizarUM debe aceptar la version leida');
check(/async function actualizarST\(id, patch, version\)/.test(capa.texto),
  'actualizarST debe aceptar la version leida: el riesgo es identico');
check(/fue modificada por otro usuario/.test(capa.texto),
  'falta el mensaje operativo de conflicto de UM');
check(/fue modificado por otro usuario/.test(capa.texto),
  'falta el mensaje operativo de conflicto de ST');
check(/}, data\[0\]\.fecha_actualizacion \|\| null\);/.test(capa.texto),
  'la baja debe usar como version la fecha de su propia relectura');

// La firma de la ficha cubre TODO lo que se renderiza del ST.
for (const campo of ['descripcion', 'tecnico', 'proveedor', 'observaciones', 'fechaActualizacion']) {
  check(new RegExp('s\\.' + campo + '[,\\s]').test(capa.texto),
    `la firma de la ficha no incluye s.${campo}: un cambio remoto en ese campo no repintaria`);
}

// El numero de ST se normaliza igual que en SQL.
check(/const claveST = /.test(capa.texto), 'falta claveST(): la normalizacion propia del numero de ST');
check(/claveST\(s\.nroST\) === claveST\(datos\.nroST\)/.test(capa.texto),
  'el duplicado de ST debe compararse con claveST');


// ------------------------------------------- 5d) segunda ronda de review
// F6 · El snapshot remoto confirmado no comparte referencias con el legado.
check(/function snapshotInmutable\(filas\)/.test(capa.texto),
  'falta el snapshot inmutable del modelo remoto');
check(/Object\.freeze/.test(capa.texto),
  'el snapshot confirmado debe quedar congelado');
check(/runtime\.confirmadoUM = snapshotInmutable\(ums\);/.test(capa.texto),
  'confirmadoUM debe guardarse como snapshot inmutable');
check(/runtime\.confirmadoST = snapshotInmutable\(sts\);/.test(capa.texto),
  'confirmadoST debe guardarse como snapshot inmutable');
check(/var copiarLista = function \(lista\)/.test(textoGuard),
  'el holder debe publicar copias, no la referencia del modelo');
check(/get: function \(\) \{ return copiarLista\(MODELO\[campo\]\); \}/.test(textoGuard),
  'las globales legadas deben entregar una copia por lectura');
check(/MODELO\.ums = copiarLista\(ums\);/.test(textoGuard),
  'el holder no puede guardar la referencia que recibe');
check(/unidadesMantenimiento = copiarLista\(MODELO\.ums\);/.test(textoGuard),
  'el binding lexico tambien debe recibir una copia');

// F1 · Perfil activo antes de aceptar una lectura como autoritativa.
check(/async function rolDeSesion\(\)/.test(capa.texto),
  'falta la confirmacion del rol contra la autoridad remota');
check(/rpc\('coi_current_role'\)/.test(capa.texto),
  'el rol debe confirmarse con la misma funcion que usan las policies');
check(/no tiene un perfil activo habilitado/.test(capa.texto),
  'falta el mensaje operativo de perfil inactivo');
check(/if \(!perfil\.rol\)/.test(capa.texto),
  'sin rol no se puede aceptar la lectura como autoritativa');
// Fail-closed: si la comprobacion del rol no se pudo hacer, tampoco se consulta.
// Continuar «por las dudas» reintroduce el falso cero que el guard viene a evitar.
check(/if \(!perfil\.ok\)/.test(capa.texto),
  'un error de la RPC de rol tiene que cortar igual que un rol nulo');
check(/No se pudo verificar el perfil del usuario/.test(capa.texto),
  'falta el mensaje operativo cuando la verificacion del rol falla');

// F3 · La version del CAS se captura al pintar el formulario.
check(/let umEditandoVersion = null;/.test(capa.texto),
  'falta el token de version del formulario de UM');
check(/let stEditandoVersion = null;/.test(capa.texto),
  'falta el token de version del formulario de ST');
check(/umEditandoVersion = u \? \(u\.fechaActualizacion \|\| null\) : null;/.test(capa.texto),
  'la version de UM debe capturarse al pintar los inputs');
check(/stEditandoVersion = editando \? \(st\.fechaActualizacion \|\| null\) : null;/.test(capa.texto),
  'la version de ST debe capturarse al pintar los inputs');
check(/if \(id\) await actualizarUM\(id, datos, umEditandoVersion\);/.test(capa.texto),
  'el CAS de UM debe usar la version capturada, no la del runtime');
check(/await actualizarST\(uuid, patch, stEditandoVersion\);/.test(capa.texto),
  'el CAS de ST debe usar la version capturada, no la del runtime');
check(!/actualizarUM\(id, datos, anterior \? anterior\.fechaActualizacion : null\)/.test(capa.texto),
  'el CAS no puede volver a leer la version desde el runtime al guardar');
// Y la firma del formulario cubre todo lo que pinta.
for (const campo of ['proveedorMantenimiento', 'descripcion', 'observaciones', 'marca', 'modelo', 'nroSerie', 'ramal']) {
  check(new RegExp('u\\.' + campo + '[,\\s]').test(capa.texto),
    `la firma del formulario de UM no incluye u.${campo}`);
}

// F4 · Un estado remoto no canonico de ST se conserva si no se lo toca.
check(/let stEditandoEstadoOriginal = null;/.test(capa.texto),
  'falta el estado original capturado del ST');
check(/function prepararFilaST\(datos, excluirUuid, ocOriginal, estadoOriginal\)/.test(capa.texto),
  'la validacion de ST debe conocer el estado original');
check(/const conservaEstadoRemoto = Boolean\(estadoOriginal\) && datos\.estado === estadoOriginal;/.test(capa.texto),
  'conservar el estado remoto sin tocarlo debe estar permitido');

// F5 · Los ST sin UM resoluble tienen que ser visibles.
check(/const stHuerfanos = \(\)/.test(capa.texto),
  'falta la deteccion de Servicios Tecnicos sin UM resoluble');
check(/function renderPanelHuerfanos\(\)/.test(capa.texto),
  'falta el panel de Servicios Tecnicos pendientes de asociacion');
check(/Servicios Técnicos pendientes de asociación/.test(capa.texto),
  'el panel debe estar rotulado de forma inequivoca');
check(/pendiente\(s\) de regularización/.test(capa.texto),
  'las filas huerfanas deben marcarse como pendientes de regularizacion');
check(/renderPanelHuerfanos\(\);/.test(capa.texto),
  'el panel de huerfanos debe formar parte del render de la vista');

// F2 · El codigo de UM se compara canonicamente, igual que en SQL.
check(/const claveUM = /.test(capa.texto),
  'falta claveUM(): la normalizacion propia del codigo de UM');
check(/claveUM\(u\.codigoUM\) === k/.test(capa.texto),
  'la busqueda por codigo de UM debe usar claveUM');
const EXPRESION_UM = "upper(regexp_replace(codigo_um, '[[:space:]./-]+', '', 'g'))";
const migracionUM = fs.readFileSync('supabase/migrations/202608310003_h05_um_codigo_unique_guard.sql', 'utf8');
check(migracionUM.indexOf(EXPRESION_UM) >= 0,
  'el indice de UM debe usar la normalizacion canonica declarada');
check(capa.texto.indexOf(EXPRESION_UM) >= 0,
  'la capa debe documentar la normalizacion SQL con la que claveUM() tiene que coincidir');
check(/create unique index coi_unidades_mantenimiento_codigo_um_canonico_uidx/i.test(migracionUM),
  'la migracion debe crear el indice canonico con nombre estable');
check(/COI_UM_CODIGO_DUPLICADO_CANONICO/.test(migracionUM),
  'la migracion debe abortar explicitamente ante duplicados canonicos');
check(!/drop\s+constraint/i.test(migracionUM.replace(/--[^\n]*/g, '')),
  'el UNIQUE literal del baseline no se puede eliminar');
const umCanonico = ((contrato._divergencias_pendientes || {}).unique || [])
  .find((d) => d.tabla === 'coi_unidades_mantenimiento');
check(Boolean(umCanonico), 'la divergencia del indice canonico de UM debe estar declarada');
check(umCanonico.indice === 'coi_unidades_mantenimiento_codigo_um_canonico_uidx',
  'la divergencia debe nombrar el indice tal como lo crea la migracion');
check(umCanonico.produccion === 'ausente' && umCanonico.repo === 'presente',
  'la divergencia de UM debe declarar produccion ausente y repo presente');


// ------------------------------------------- 5e) tercera ronda de review
// F1 · El modo edicion de ST pertenece a la ficha donde se inicio.
check(/function limpiarEdicionST\(\)/.test(capa.texto),
  'falta el reset explicito del modo edicion de ST');
check(/const contextoDeFicha = prefijo === 'stfh5';/.test(capa.texto),
  'guardarST debe distinguir el contexto de ficha del panel de alta');
check(/if \(!contextoDeFicha\) limpiarEdicionST\(\);/.test(capa.texto),
  'el panel de alta tiene que entrar inequivocamente en modo INSERT');
// Y el reset ocurre al cambiar de contexto, no solo al guardar.
check(/limpiarEdicionST\(\);[\s\S]{0,200}const firma = firmaPanelST\(\);/.test(capa.texto),
  'renderizar el panel de alta debe cerrar cualquier edicion abierta');
check(/#btnVolverUM[\s\S]{0,320}limpiarEdicionST\(\);/.test(capa.texto),
  'salir de la ficha debe cerrar la edicion de ST');
check(/#btnNuevoSTH05'\)\) \{ tomar\(\); limpiarEdicionST\(\);/.test(capa.texto),
  'Limpiar del panel de alta debe cerrar la edicion');

// F3 · La OC se valida contra Supabase, no contra la cache de Ordenes.
check(/const TABLA_OC = 'coi_ordenes';/.test(capa.texto),
  'falta la tabla remota de Ordenes para validar la OC');
check(/async function ocExisteEnSupabase\(c, valor\)/.test(capa.texto),
  'falta la confirmacion remota de la OC');
check(/from\(TABLA_OC\)\.select\('nro_oc'\)/.test(capa.texto),
  'la validacion de OC debe consultar coi_ordenes en Supabase');
check(/async function confirmarOC\(\)/.test(capa.texto),
  'la confirmacion de OC debe correr antes de persistir');
check(/No se pudo verificar la OC/.test(capa.texto),
  'si la validacion remota falla no se puede guardar en silencio');
check(/preparado\.ocPorConfirmar/.test(capa.texto),
  'solo una OC nueva o cambiada exige confirmacion remota');
// La decision previa se mantiene: una OC sin modificar no bloquea la edicion.
check(/Sin cambios: se conserva la OC ya persistida y no se revalida/.test(capa.texto),
  'una OC no modificada debe conservarse sin revalidar');
// Y nunca se crea una OC.
check(!/from\(TABLA_OC\)\.insert/.test(capa.texto),
  'un Servicio Tecnico no puede crear una Orden de Compra');

// F4 · La estacion se compara normalizada, no por texto exacto.
check(/window\.umsPorEstacion = function \(nombre\)/.test(capa.texto),
  'la capa debe gobernar la busqueda de UM por estacion');
check(/const claveEstacion = /.test(capa.texto),
  'falta la clave de comparacion de estaciones');
check(/window\.normalizarNombreEstacion/.test(capa.texto),
  'se debe reutilizar el canonicalizador de estaciones del proyecto');
check(/window\.resolverEstacionMaestra/.test(capa.texto),
  'se debe reutilizar el resolvedor de estaciones del proyecto');
check(/claveEstacion\(u\.estacion\) === claveBuscada/.test(capa.texto),
  'la comparacion de respaldo debe ser normalizada, nunca exacta');
check(!/u\.estacion === nombre/.test(capa.texto),
  'no puede quedar ninguna comparacion exacta de estacion en la capa');


// ------------------------------------------- 5f) cuarta ronda de review
// F1 · Tras una mutacion propia el formulario se repinta aunque el boton
//      siga enfocado: si no, queda con la version vieja y el siguiente
//      guardado falla con un conflicto que no existe.
check(/let repintarFormTrasMutacion = false;/.test(capa.texto),
  'falta la marca de repintado tras una mutacion confirmada');
check(/repintarFormTrasMutacion = true;/.test(capa.texto),
  'una mutacion confirmada de UM debe pedir el repintado');
check(/const forzarForm = repintarFormTrasMutacion;/.test(capa.texto),
  'el render de la vista debe consumir la marca de repintado');
check(/activo\.tagName !== 'BUTTON';/.test(capa.texto),
  'un boton enfocado no puede bloquear el repintado del formulario');

// F5 · El select marca el valor EXACTO del remoto, no una variante equivalente.
check(/v === texto\(seleccionado\) \? ' selected' : ''/.test(capa.texto),
  'el option seleccionado debe compararse por igualdad exacta con el dato remoto');
check(!/clave\(v\) === clave\(seleccionado\)/.test(capa.texto),
  'no puede elegirse el option por comparacion normalizada: reescribiria el texto remoto');

// F4 · Si la OC no se toco, no viaja en el patch del UPDATE.
check(/if \(preparado\.ocSinCambios\) delete patch\.nro_oc;/.test(capa.texto),
  'una edicion que no toca la OC no puede reenviar el nro_oc');
// Pero vaciarla SI es un cambio y tiene que persistirse como null: omitirla ahi
// dejaria la asociacion vieja para siempre.
check(/let ocSinCambios = false;/.test(capa.texto),
  'hay que distinguir «la OC no se toco» de «la OC se vacio»');

// F3+F4+F6 · La integridad de la asociacion ST -> OC es de PostgreSQL.
const migracionOC = fs.readFileSync('supabase/migrations/202608310004_h04_st_oc_referencial.sql', 'utf8');
const sinComentariosOC = migracionOC.replace(/--[^\n]*/g, '');
check(/coi_normalize_order_number/.test(sinComentariosOC),
  'la resolucion del nro_oc debe usar la normalizacion canonica del proyecto');
check(/create trigger coi_st_resolver_nro_oc/i.test(sinComentariosOC),
  'falta el trigger que resuelve el nro_oc entrante');
check(/before insert or update of nro_oc/i.test(sinComentariosOC),
  'el trigger tiene que correr BEFORE, en la misma sentencia que la escritura');
check(/references public\.coi_ordenes\(nro_oc\)/i.test(sinComentariosOC),
  'la FK debe apuntar a coi_ordenes(nro_oc)');
check(/on update cascade/i.test(sinComentariosOC),
  'ON UPDATE CASCADE es lo que hace que la renumeracion arrastre el ST');
check(/on delete restrict/i.test(sinComentariosOC),
  'ON DELETE RESTRICT impide borrar una OC con historial tecnico');
check(/COI_ST_OC_INEXISTENTE/.test(sinComentariosOC),
  'una OC inexistente debe rechazarse con un error explicito');
check(/COI_ST_OC_HUERFANAS_PREEXISTENTES/.test(sinComentariosOC),
  'con datos sucios preexistentes la migracion debe abortar');
for (const destructivo of [/\btruncate\b/i, /\bdrop\s+table\b/i, /\bdelete\s+from\b/i, /\bgrant\b/i]) {
  check(!destructivo.test(sinComentariosOC), `la migracion ST/OC no puede contener: ${destructivo}`);
}
// Y la divergencia queda declarada como FK nueva, no como cambio de accion.
const fkPendientes = (contrato._divergencias_pendientes || {}).fk || [];
const fkOC = fkPendientes.find((d) => d.tabla === 'coi_servicios_tecnicos_um' && d.columna === 'nro_oc');
check(Boolean(fkOC), 'la FK de nro_oc debe declararse como divergencia pendiente');
check(fkOC.produccion === 'sin FK', 'produccion todavia no tiene esa FK: hay que decirlo asi');
check(fkOC.on_update === 'CASCADE' && fkOC.on_delete === 'RESTRICT',
  'la divergencia debe declarar las acciones reales de la FK');
check(!(contrato.coi_servicios_tecnicos_um.fk || []).some((f) => f[0] === 'nro_oc'),
  'el snapshot productivo no puede incluir una FK que todavia no se aplico');

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
check(/create unique index coi_servicios_tecnicos_um_unidad_nro_st_uidx/i.test(migracionH04),
  'la migracion H04 debe crear el indice unico con nombre estable');
check(/unidad_id/.test(migracionH04), 'el indice debe cubrir unidad_id');
// La normalizacion del SQL y la de claveST() tienen que ser la misma: si una
// aceptara lo que la otra rechaza, la UI y la base discreparian sobre que es el
// mismo ST.
const EXPRESION_SQL = "upper(regexp_replace(nro_st, '[[:space:]./-]+', '', 'g'))";
check(migracionH04.indexOf(EXPRESION_SQL) >= 0,
  'el indice debe usar exactamente la normalizacion canonica declarada');
check(capa.texto.indexOf(EXPRESION_SQL) >= 0,
  'la capa debe documentar la normalizacion SQL con la que claveST() tiene que coincidir');
check(/where unidad_id is not null and nro_st is not null/i.test(migracionH04),
  'el indice debe ser parcial: los ST sin numero no colisionan');
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
check(h04.indice === 'coi_servicios_tecnicos_um_unidad_nro_st_uidx',
  'la divergencia H04 debe nombrar el indice tal como lo crea la migracion');

// El rol administrador tambien tiene que existir en PostgreSQL: una restriccion
// que solo vive en JavaScript no es una restriccion.
const migracionRol = fs.readFileSync('supabase/migrations/202608310002_h04_h05_role_guard.sql', 'utf8');
const sinComentarios = migracionRol.replace(/--[^\n]*/g, '');
for (const tabla of ['coi_unidades_mantenimiento', 'coi_servicios_tecnicos_um']) {
  for (const cmd of ['select', 'insert', 'update']) {
    check(new RegExp('as restrictive[\\s\\S]{0,80}for ' + cmd, 'i').test(sinComentarios) ||
      new RegExp('for ' + cmd + ' to authenticated', 'i').test(sinComentarios),
      `la migracion de rol debe declarar la restrictiva de ${cmd}`);
  }
  check(new RegExp('revoke all on public\\.' + tabla + ' from anon', 'i').test(sinComentarios),
    `anon debe perder todos los privilegios sobre ${tabla}`);
  check(new RegExp('grant select, insert, update on public\\.' + tabla + ' to authenticated', 'i').test(sinComentarios),
    `authenticated debe quedar con exactamente SELECT/INSERT/UPDATE sobre ${tabla}`);
}
check(!/for delete/i.test(sinComentarios), 'la migracion de rol no puede crear ninguna policy DELETE');
check(!/grant all/i.test(sinComentarios), 'la migracion de rol no puede otorgar ALL');
check(/coi_current_role\(\) = 'administrador'/.test(sinComentarios),
  'las mutaciones deben exigir el rol administrador');

const policiesPendientes = (contrato._divergencias_pendientes || {}).policies || [];
check(policiesPendientes.length === 6,
  `se esperaban 6 policies pendientes declaradas y hay ${policiesPendientes.length}`);
check(policiesPendientes.every((d) => d.permissive === false),
  'las policies pendientes son RESTRICTIVE: estrechan, no amplian');
const grantsPendientes = (contrato._divergencias_pendientes || {}).grants || [];
check(grantsPendientes.length === 2, 'faltan las divergencias de grants de UM y ST');
check(grantsPendientes.every((d) => d.repo.anon.length === 0),
  'el repo no debe dejarle ningun privilegio a anon');
check(grantsPendientes.every((d) =>
  JSON.stringify(d.repo.authenticated.slice().sort()) === JSON.stringify(['INSERT', 'SELECT', 'UPDATE'])),
  'authenticated debe quedar declarado con exactamente SELECT/INSERT/UPDATE');
// Y el snapshot productivo NO puede haber sido tocado: sigue siendo la foto real.
for (const tabla of ['coi_unidades_mantenimiento', 'coi_servicios_tecnicos_um']) {
  const nombres = (contrato[tabla].policies || []).map((x) => x.nombre);
  check(nombres.every((n) => n.indexOf('_guard') < 0),
    `${tabla}: el snapshot productivo no puede incluir las policies que todavia no se aplicaron`);
}

console.log('H05/H04 UM y ST Supabase-first: capa verificada contra el esquema real.');
console.log(`  coi_unidades_mantenimiento : ${COLS_UM.length} columnas, todas leidas por la capa`);
console.log(`  coi_servicios_tecnicos_um  : ${COLS_ST.length} columnas, todas leidas por la capa`);
console.log('  Congelamiento del legado   : instalado antes de init(), sin borrar claves');
console.log('  Siembra de demo            : ausente');
console.log('  Persistencia local de UM/ST: ausente');
console.log('  Borrado fisico             : ausente (BAJA / Cancelado)');
console.log(`${aprobados} controles H05/H04 aprobados; 0 fallidos.`);
