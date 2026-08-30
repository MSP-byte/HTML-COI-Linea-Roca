-- =====================================================================
-- H02 · COI-AUD-008 — Linea base estructural del esquema COI Linea Roca
-- =====================================================================
--
-- PROPOSITO
--   Crear las tablas raiz que historicamente nunca se versionaron, de modo que
--   las 27 migraciones posteriores puedan aplicarse en orden sobre una base
--   vacia. Antes de este archivo, la cadena se cortaba en la segunda migracion
--   (202608100002_financial_ledger.sql) con «relation "public.coi_ordenes" does
--   not exist», y solo 1 de 27 migraciones llegaba a aplicarse.
--
-- ALCANCE DELIBERADAMENTE MINIMO
--   Este archivo crea unicamente la FORMA MINIMA que cada tabla necesita para
--   que las migraciones siguientes puedan hacer su trabajo. No adelanta nada de
--   lo que ya hacen ellas: no define policies, ni RLS, ni grants, ni indices,
--   ni triggers, ni funciones, ni RPC, ni logica de negocio. Todo eso ya esta
--   versionado aguas abajo y debe seguir siendo su responsabilidad.
--
--   En particular NO se declaran aca las columnas que las migraciones agregan
--   con «add column if not exists», para no provocar divergencias silenciosas:
--     coi_ordenes            -> saldo_remanente            (202608100002)
--     coi_posiciones_oc      -> cantidad_consumida, monto_consumido,
--                               cantidad_disponible, monto_disponible, estado,
--                               cantidad_consumida_inicial,
--                               monto_consumido_inicial   (202608100002)
--     coi_ordenes_estaciones -> nro_oc, tipo_alcance, descripcion_alcance,
--                               estado                     (202608110005)
--                               observaciones, fecha_inicio, fecha_fin,
--                               creado_por, actualizado_por, fecha_creacion,
--                               fecha_actualizacion        (202608110006)
--
-- INOCUIDAD SOBRE ENTORNOS EXISTENTES
--   Produccion y staging ya tienen estas 10 tablas. Todo aca es
--   «create table if not exists»: al registrarse en un entorno existente el
--   archivo es un NO-OP estructural. No hay ALTER, ni DROP, ni TRUNCATE, ni
--   escritura de datos, ni cambios de constraints sobre objetos ya presentes.
--
-- FIDELIDAD DE COLUMNAS — LEER ANTES DE USAR EN UN ENTORNO NUEVO
--   La definicion de coi_ordenes y coi_ordenes_estaciones se deriva de evidencia
--   completa dentro del repositorio (allowlist del trigger
--   coi_direct_order_update_guard y los «add column» de las migraciones), y
--   reproduce el recuento real de columnas de produccion.
--
--   Para las tablas restantes el repositorio NO contiene su DDL: las columnas
--   declaradas aca son las efectivamente demostrables desde las migraciones, el
--   contrato del frontend y los tests. Son suficientes para que la cadena de
--   migraciones aplique y para levantar un entorno de trabajo, pero NO cubren
--   todavia el total de columnas de produccion. El deficit exacto esta medido en
--   tests/check_schema_reproducibility.js y se cierra con un pg_dump
--   --schema-only del esquema real. Hasta entonces este archivo describe la
--   estructura raiz, no el esquema completo de esas tablas.
--
-- FUERA DEL BASELINE
--   coi_documentos_oc_backup_20260723 y
--   coi_documentos_oc_backup_4550000286_20260723 son respaldos historicos
--   puntuales y no forman parte de una instalacion nueva.

-- ---------------------------------------------------------------------
-- Raiz del modelo operativo
-- ---------------------------------------------------------------------
create table if not exists public.coi_ordenes (
  id uuid primary key default gen_random_uuid(),
  nro_oc text not null,
  id_obra text,
  tipo text,
  tipo_trabajo text,
  especialidad text,
  descripcion text,
  proveedor text,
  estacion text,
  ramal text,
  sector text,
  expediente text,
  monto_total numeric(20,2),
  moneda text,
  fecha_acta_inicio date,
  plazo_dias integer,
  fecha_vencimiento date,
  proxima_certificacion date,
  fecha_recepcion_documentacion date,
  fecha_envio_planificacion date,
  estado_coi text,
  estado_documental text,
  estado_registro text,
  observaciones text,
  certificable_con_saldo boolean,
  justificacion_administrativa text,
  link_documental_principal text,
  estado_link_documental text,
  calidad_datos_estado text,
  calidad_datos_score numeric,
  prioridad_operativa text,
  responsable_coi text,
  fecha_ultimo_control date,
  requiere_accion boolean,
  motivo_requiere_accion text,
  estado_envio_pyc text,
  fecha_cierre_operativo date,
  observacion_cierre text,
  control_terceros_hasta date,
  control_terceros_estado text,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz not null default clock_timestamp(),
  actualizado_por uuid references auth.users(id),
  fecha_actualizacion timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Dependientes directas de coi_ordenes
-- ---------------------------------------------------------------------
create table if not exists public.coi_ordenes_estaciones (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.coi_ordenes(id) on delete cascade,
  estacion text,
  ramal text,
  sector text,
  es_principal boolean not null default false
);

create table if not exists public.coi_posiciones_oc (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.coi_ordenes(id) on delete cascade,
  nro_oc text not null,
  posicion text not null,
  descripcion text,
  cantidad_total numeric(20,6) not null default 0,
  unidad_medida text,
  precio_unitario numeric(20,6) not null default 0,
  monto_total numeric(20,2) not null default 0,
  moneda text,
  remito text,
  observaciones text,
  usuario_email text,
  origen_carga text
);

create table if not exists public.coi_alertas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.coi_ordenes(id) on delete cascade,
  nro_oc text
);

create table if not exists public.coi_certificaciones (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.coi_ordenes(id) on delete cascade,
  nro_oc text,
  acta_medicion_nro text,
  item_nro text,
  posicion text,
  fecha_inicio date,
  fecha_fin date,
  unidad_medida text,
  tipo_servicio text,
  aux_porcentaje numeric,
  servicio_ejecutado_anterior numeric,
  servicio_ejecutado_periodo numeric,
  servicio_ejecutado_acumulado numeric,
  proxima_acta_medicion_fecha date,
  actores_firmantes text,
  anexo_fotografia_actas text,
  usuario_email text,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz not null default clock_timestamp(),
  actualizado_por uuid references auth.users(id),
  fecha_actualizacion timestamptz not null default clock_timestamp()
);

create table if not exists public.coi_documentos_oc (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.coi_ordenes(id) on delete cascade,
  nro_oc text,
  id_documento text,
  tipo_documento text,
  nombre_documento text,
  estado text,
  storage_bucket text,
  storage_path text,
  observaciones text,
  fecha_documento date,
  usuario_email text,
  fecha_creacion timestamptz not null default clock_timestamp()
);

create table if not exists public.coi_observaciones_oc (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.coi_ordenes(id) on delete cascade,
  nro_oc text,
  texto text,
  estado text,
  usuario_email text,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Unidades de mantenimiento y su dependiente
-- ---------------------------------------------------------------------
create table if not exists public.coi_unidades_mantenimiento (
  id uuid primary key default gen_random_uuid(),
  id_um text,
  nombre text,
  estacion text,
  ramal text,
  tipo text,
  estado text,
  observaciones text,
  usuario_email text,
  fecha_creacion timestamptz not null default clock_timestamp()
);

create table if not exists public.coi_servicios_tecnicos_um (
  id uuid primary key default gen_random_uuid(),
  um_id uuid references public.coi_unidades_mantenimiento(id) on delete cascade,
  nro_oc text,
  fecha date,
  tipo_um text,
  descripcion text,
  tecnico text,
  estado text,
  usuario_email text,
  fecha_creacion timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- Auditoria de calidad de datos
-- ---------------------------------------------------------------------
create table if not exists public.coi_auditorias_calidad (
  id uuid primary key default gen_random_uuid(),
  nro_oc text,
  orden_id uuid references public.coi_ordenes(id) on delete set null,
  resultado jsonb,
  score numeric,
  usuario_email text,
  fecha_creacion timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------
-- RLS de las tablas que ninguna migracion posterior habilita
-- ---------------------------------------------------------------------
-- Produccion y staging tienen RLS activo en las 20 tablas. Las migraciones
-- posteriores lo habilitan para 14; estas 4 quedaban fuera, de modo que un
-- entorno recreado desde el repositorio nacia sin RLS sobre ellas.
--
-- «enable row level security» es idempotente: en un entorno donde ya esta
-- activo es un NO-OP, no toca datos y no altera las policies existentes.
-- Sin policies el efecto es denegar por defecto, que es la postura correcta
-- para un entorno nuevo: falla cerrado, no abierto. Las policies reales de
-- estas tablas se versionan junto con su DDL completo.
alter table public.coi_alertas enable row level security;
alter table public.coi_observaciones_oc enable row level security;
alter table public.coi_unidades_mantenimiento enable row level security;
alter table public.coi_servicios_tecnicos_um enable row level security;
