-- =====================================================================
-- H02 · COI-AUD-008 — Linea base estructural del esquema COI Linea Roca
-- =====================================================================
--
-- PROPOSITO
--   Crear las tablas raiz que historicamente nunca se versionaron, de modo que
--   las 27 migraciones posteriores puedan aplicarse en orden sobre una base
--   vacia. Antes de este archivo la cadena se cortaba en la segunda migracion
--   (202608100002_financial_ledger.sql) con «relation "public.coi_ordenes" does
--   not exist», y solo 1 de 27 migraciones llegaba a aplicarse.
--
-- FUENTE
--   El contrato de columnas, tipos, nullability, defaults, generated columns,
--   PK, FK, UNIQUE y CHECK reproduce el snapshot de information_schema tomado
--   en lectura sobre produccion. No es una reconstruccion inferida.
--
-- REPARTO DE RESPONSABILIDADES CON LAS MIGRACIONES POSTERIORES
--   Este archivo NO define policies, grants, indices, triggers, funciones ni
--   RPC: todo eso ya esta versionado aguas abajo y sigue siendo su trabajo.
--   Tampoco duplica los constraints que ellas crean:
--     coi_ordenes_estado_coi_required   (20260817002000)
--     coi_ordenes_estaciones_fechas_ck  (202608110006)
--     coi_ordenes_estaciones_scope_uq   (202608110005, sobre orden_id)
--     coi_ordenes_nro_oc_uq y _normalizado_uq, coi_posiciones_oc_*_uq
--
--   Se dejan enteramente a las migraciones las columnas cuyo «add column if
--   not exists» coincide con el contrato productivo:
--     coi_ordenes            -> saldo_remanente            (202608100002)
--     coi_posiciones_oc      -> cantidad_consumida_inicial,
--                               monto_consumido_inicial   (202608100002)
--     coi_ordenes_estaciones -> descripcion_alcance        (202608110005)
--                               observaciones, fecha_inicio, fecha_fin,
--                               creado_por, actualizado_por (202608110006)
--
--   EXCEPCIONES DELIBERADAS — columnas declaradas aca a proposito:
--     · coi_ordenes_estaciones.nro_oc: lo necesita la UNIQUE productiva
--       (nro_oc, estacion, sector), que este archivo debe crear.
--     · coi_ordenes_estaciones.tipo_alcance, estado, fecha_creacion,
--       fecha_actualizacion y coi_posiciones_oc.cantidad_consumida,
--       cantidad_disponible, monto_consumido, monto_disponible, estado:
--       las migraciones las agregan con «not null», pero produccion las tiene
--       nullable. Al existir ya, ese «add column if not exists» es un no-op y
--       prevalece el contrato real. Sin esto la cadena producia 9 columnas con
--       nullability distinta a la de produccion.
--
--   En ambos casos el mecanismo es el mismo y es seguro: «add column if not
--   exists» sobre una columna existente no la modifica. El recuento final se
--   mantiene en 17 y 23 columnas respectivamente.
--
-- INOCUIDAD SOBRE ENTORNOS EXISTENTES
--   Produccion y staging ya tienen estas 10 tablas. Todo aca es
--   «create table if not exists»: al registrarse en un entorno existente el
--   archivo es un NO-OP estructural. No hay ALTER, DROP, TRUNCATE, ni
--   escritura de datos, ni cambios sobre objetos ya presentes.
--
-- GRANTS
--   Este archivo no versiona grants. Los de coi_ordenes, coi_ordenes_estaciones
--   y coi_posiciones_oc los fijan explicitamente las migraciones posteriores, y
--   los de coi_certificaciones, coi_documentos_oc y coi_auditorias_calidad los
--   aplica coi_apply_optional_role_rls (202608100005) de forma dinamica.
--
--   Las cuatro tablas restantes (coi_alertas, coi_observaciones_oc,
--   coi_unidades_mantenimiento, coi_servicios_tecnicos_um) no reciben grants de
--   ninguna migracion: en produccion los obtienen de los default privileges que
--   Supabase aplica al esquema public. Son privilegios de plataforma, no DDL de
--   la aplicacion, y versionarlos a ciegas arriesgaria divergir del entorno real.
--   Consecuencia conocida: al recrear el esquema fuera de Supabase (PGlite) esas
--   cuatro tablas quedan con RLS y policies pero sin grants, de modo que las
--   policies no llegan a ejercitarse. En un proyecto Supabase real no ocurre.
--
-- FUERA DEL BASELINE
--   coi_documentos_oc_backup_20260723 y
--   coi_documentos_oc_backup_4550000286_20260723 son respaldos historicos
--   puntuales y no forman parte de una instalacion nueva.

-- ---------------------------------------------------------------------
-- 1. Raiz del modelo operativo
-- ---------------------------------------------------------------------
create table if not exists public.coi_ordenes (
  id uuid not null default gen_random_uuid(),
  nro_oc text not null,
  id_obra text,
  tipo text not null,
  tipo_trabajo text,
  especialidad text,
  descripcion text,
  proveedor text,
  estacion text,
  ramal text,
  sector text,
  expediente text,
  monto_total numeric default 0,
  moneda text default 'ARS',
  fecha_acta_inicio date,
  plazo_dias integer,
  fecha_vencimiento date,
  proxima_certificacion date,
  fecha_recepcion_documentacion date,
  fecha_envio_planificacion date,
  estado_coi text default 'En ejecución',
  estado_documental text default 'Pendiente',
  estado_registro text default 'Activo',
  observaciones text,
  certificable_con_saldo boolean default false,
  justificacion_administrativa text,
  link_documental_principal text,
  estado_link_documental text default 'Sin link',
  calidad_datos_estado text default 'Sin auditar',
  calidad_datos_score integer default 0,
  prioridad_operativa text default 'Normal',
  responsable_coi text,
  fecha_ultimo_control date,
  requiere_accion boolean default false,
  motivo_requiere_accion text,
  estado_envio_pyc text default 'No enviado',
  fecha_cierre_operativo date,
  observacion_cierre text,
  control_terceros_hasta date,
  control_terceros_estado text,
  creado_por uuid references auth.users(id),
  fecha_creacion timestamptz default now(),
  actualizado_por uuid references auth.users(id),
  fecha_actualizacion timestamptz default now(),
  constraint coi_ordenes_pkey primary key (id),
  constraint coi_ordenes_id_obra_key unique (id_obra),
  constraint coi_ordenes_tipo_check check (tipo in ('Obra', 'Servicio', 'Financiera', 'Otro'))
);

-- ---------------------------------------------------------------------
-- 2. Alcance por estacion
-- ---------------------------------------------------------------------
create table if not exists public.coi_ordenes_estaciones (
  id uuid not null default gen_random_uuid(),
  orden_id uuid,
  nro_oc text not null,
  estacion text not null,
  ramal text,
  sector text,
  es_principal boolean default false,
  -- Estas cuatro las agrega 202608110005/202608110006 con «not null», pero en
  -- produccion son nullable. Declararlas aca hace que ese «add column if not
  -- exists» sea un no-op y prevalezca el contrato real.
  tipo_alcance text,
  estado text default 'Activa',
  fecha_creacion timestamptz default now(),
  fecha_actualizacion timestamptz default now(),
  constraint coi_ordenes_estaciones_pkey primary key (id),
  constraint coi_ordenes_estaciones_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete cascade,
  constraint coi_ordenes_estaciones_alcance_key unique (nro_oc, estacion, sector)
);

-- ---------------------------------------------------------------------
-- 3. Posiciones financieras de la OC
-- ---------------------------------------------------------------------
create table if not exists public.coi_posiciones_oc (
  id uuid not null default gen_random_uuid(),
  orden_id uuid not null,
  nro_oc text not null,
  posicion text not null,
  descripcion text,
  cantidad_total numeric default 0,
  monto_total numeric default 0,
  moneda text default 'ARS',
  observaciones text,
  fecha_creacion timestamptz default now(),
  fecha_actualizacion timestamptz default now(),
  unidad_medida text,
  precio_unitario numeric not null default 0,
  remito text,
  usuario_email text,
  origen_carga text not null default 'Carga Financiera',
  -- Igual que arriba: 202608100002 las agrega con «not null» y produccion las
  -- tiene nullable. Se declaran aca para conservar el contrato productivo.
  cantidad_consumida numeric default 0,
  cantidad_disponible numeric default 0,
  monto_consumido numeric default 0,
  monto_disponible numeric default 0,
  estado text default 'LIBRE',
  constraint coi_posiciones_oc_pkey primary key (id),
  constraint coi_posiciones_oc_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 4. Documentacion de la OC
-- ---------------------------------------------------------------------
create table if not exists public.coi_documentos_oc (
  id uuid not null default gen_random_uuid(),
  orden_id uuid,
  nro_oc text,
  tipo_documento text not null,
  nombre_documento text,
  expediente text,
  estado text default 'Pendiente',
  fecha_documento date,
  fecha_recepcion date,
  fecha_envio_planificacion date,
  storage_bucket text,
  storage_path text,
  url_externa text,
  observaciones text,
  fecha_creacion timestamptz default now(),
  fecha_actualizacion timestamptz default now(),
  constraint coi_documentos_oc_pkey primary key (id),
  constraint coi_documentos_oc_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 5. Certificaciones / actas de medicion
--    servicio_ejecutado_acumulado y aux_porcentaje son columnas generadas
--    STORED: se calculan en la base, nunca se escriben desde el frontend.
-- ---------------------------------------------------------------------
create table if not exists public.coi_certificaciones (
  id uuid not null default gen_random_uuid(),
  orden_id uuid,
  nro_oc text not null,
  tipo_servicio text,
  acta_medicion_nro text not null,
  proxima_acta_medicion_fecha date,
  fecha_inicio date,
  fecha_fin date,
  item_nro text,
  descripcion text,
  posicion text,
  cantidad numeric not null default 0,
  unidad_medida text,
  servicio_ejecutado_anterior numeric not null default 0,
  servicio_ejecutado_periodo numeric not null default 0,
  servicio_ejecutado_acumulado numeric generated always as (
    coalesce(servicio_ejecutado_anterior, 0) + coalesce(servicio_ejecutado_periodo, 0)
  ) stored,
  aux_porcentaje numeric generated always as (
    case
      when coalesce(cantidad, 0) > 0
      then ((coalesce(servicio_ejecutado_anterior, 0) + coalesce(servicio_ejecutado_periodo, 0)) / cantidad) * 100
      else 0
    end
  ) stored,
  tipo_um text,
  actores_firmantes text,
  ejecutado_100 boolean not null default false,
  anexo_fotografia_actas text,
  estado_envio_pyc text not null default 'Pendiente',
  anio integer,
  documento_id uuid,
  observaciones text,
  usuario_email text,
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  fecha_envio_pyc date,
  posicion_id uuid,
  cantidad_certificada numeric not null default 0,
  monto_certificado numeric not null default 0,
  remito text,
  constraint coi_certificaciones_pkey primary key (id),
  constraint coi_certificaciones_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete set null,
  constraint coi_certificaciones_documento_id_fkey foreign key (documento_id) references public.coi_documentos_oc(id) on delete set null,
  constraint coi_certificaciones_posicion_id_fkey foreign key (posicion_id) references public.coi_posiciones_oc(id) on delete set null,
  constraint coi_certificaciones_estado_envio_pyc_check check (
    estado_envio_pyc in ('Pendiente', 'Enviado', 'Observado', 'Devuelto', 'Cerrado')
  ),
  constraint coi_certificaciones_anio_check check (anio is null or (anio between 2000 and 2100))
);

-- ---------------------------------------------------------------------
-- 6. Alertas operativas
-- ---------------------------------------------------------------------
create table if not exists public.coi_alertas (
  id uuid not null default gen_random_uuid(),
  orden_id uuid,
  nro_oc text,
  tipo_alerta text,
  severidad text,
  mensaje text,
  accion_sugerida text,
  estado text default 'Activa',
  revisada boolean default false,
  revisada_por uuid,
  fecha_revision timestamptz,
  fecha_creacion timestamptz default now(),
  constraint coi_alertas_pkey primary key (id),
  constraint coi_alertas_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete cascade,
  constraint coi_alertas_revisada_por_fkey foreign key (revisada_por) references auth.users(id)
);

-- ---------------------------------------------------------------------
-- 7. Observaciones de la OC
-- ---------------------------------------------------------------------
create table if not exists public.coi_observaciones_oc (
  id uuid not null default gen_random_uuid(),
  orden_id uuid,
  nro_oc text,
  observacion text not null,
  estado text default 'Pendiente',
  prioridad text default 'Normal',
  creado_por uuid,
  resuelto_por uuid,
  fecha_creacion timestamptz default now(),
  fecha_resolucion timestamptz,
  constraint coi_observaciones_oc_pkey primary key (id),
  constraint coi_observaciones_oc_orden_id_fkey foreign key (orden_id) references public.coi_ordenes(id) on delete cascade,
  constraint coi_observaciones_oc_creado_por_fkey foreign key (creado_por) references auth.users(id),
  constraint coi_observaciones_oc_resuelto_por_fkey foreign key (resuelto_por) references auth.users(id)
);

-- ---------------------------------------------------------------------
-- 8. Unidades de mantenimiento
-- ---------------------------------------------------------------------
create table if not exists public.coi_unidades_mantenimiento (
  id uuid not null default gen_random_uuid(),
  codigo_um text not null,
  tipo_um text,
  estacion text,
  ramal text,
  sector text,
  descripcion text,
  marca text,
  modelo text,
  nro_serie text,
  estado text default 'Activo',
  proveedor_mantenimiento text,
  observaciones text,
  fecha_creacion timestamptz default now(),
  fecha_actualizacion timestamptz default now(),
  constraint coi_unidades_mantenimiento_pkey primary key (id),
  constraint coi_unidades_mantenimiento_codigo_um_key unique (codigo_um)
);

-- ---------------------------------------------------------------------
-- 9. Servicios tecnicos asociados a una unidad de mantenimiento
-- ---------------------------------------------------------------------
create table if not exists public.coi_servicios_tecnicos_um (
  id uuid not null default gen_random_uuid(),
  unidad_id uuid,
  nro_st text,
  nro_oc text,
  fecha date,
  descripcion text,
  tecnico text,
  proveedor text,
  estado text default 'Pendiente',
  observaciones text,
  fecha_creacion timestamptz default now(),
  fecha_actualizacion timestamptz default now(),
  constraint coi_servicios_tecnicos_um_pkey primary key (id),
  constraint coi_servicios_tecnicos_um_unidad_id_fkey foreign key (unidad_id) references public.coi_unidades_mantenimiento(id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 10. Auditorias de calidad de datos
-- ---------------------------------------------------------------------
create table if not exists public.coi_auditorias_calidad (
  id uuid not null default gen_random_uuid(),
  fecha_auditoria timestamptz default now(),
  total_ocs integer default 0,
  ocs_verdes integer default 0,
  ocs_amarillas integer default 0,
  ocs_rojas integer default 0,
  ocs_grises integer default 0,
  ocs_sin_acta integer default 0,
  ocs_sin_plazo integer default 0,
  ocs_sin_vencimiento integer default 0,
  ocs_sin_proveedor integer default 0,
  ocs_sin_estacion integer default 0,
  ocs_sin_link_documental integer default 0,
  ocs_monto_cero integer default 0,
  ocs_vencidas_sin_justificacion integer default 0,
  resumen jsonb,
  usuario_email text,
  creado_por uuid,
  constraint coi_auditorias_calidad_pkey primary key (id),
  constraint coi_auditorias_calidad_creado_por_fkey foreign key (creado_por) references auth.users(id)
);

-- ---------------------------------------------------------------------
-- RLS de las tablas que ninguna migracion posterior habilita
-- ---------------------------------------------------------------------
-- Produccion y staging tienen RLS activo en las 20 tablas. Las migraciones
-- posteriores lo habilitan para 14; estas 4 quedaban fuera, de modo que un
-- entorno recreado desde el repositorio nacia sin RLS sobre ellas.
--
-- «enable row level security» es idempotente: donde ya esta activo es un
-- NO-OP, no toca datos y no altera las policies existentes. Sin policies el
-- efecto es denegar por defecto, que es la postura correcta para un entorno
-- nuevo: falla cerrado, no abierto.
alter table public.coi_alertas enable row level security;
alter table public.coi_observaciones_oc enable row level security;
alter table public.coi_unidades_mantenimiento enable row level security;
alter table public.coi_servicios_tecnicos_um enable row level security;

-- ---------------------------------------------------------------------
-- Policies de esas mismas cuatro tablas
-- ---------------------------------------------------------------------
-- coi_apply_optional_role_rls (202608100005) aplica la matriz por rol a un
-- listado curado de tablas en el que estas cuatro nunca entraron. Produccion
-- las gobierna con estas 12 policies simples, que no estaban versionadas en
-- ninguna migracion: sin ellas un entorno recreado tenia RLS activo y cero
-- policies, es decir denegaba todo.
--
-- Se crean solo si faltan, comprobando por nombre exacto en pg_policies, de
-- modo que sobre un entorno que ya las tiene el bloque es un NO-OP: no las
-- reemplaza ni altera su definicion.

-- coi_alertas
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_alertas' and policyname='coi_alertas_select_auth') then
    create policy coi_alertas_select_auth on public.coi_alertas
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_alertas' and policyname='coi_alertas_insert_auth') then
    create policy coi_alertas_insert_auth on public.coi_alertas
      for insert to authenticated with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_alertas' and policyname='coi_alertas_update_auth') then
    create policy coi_alertas_update_auth on public.coi_alertas
      for update to authenticated using (true) with check (auth.uid() is not null);
  end if;
end
$pol$;

-- coi_observaciones_oc
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_observaciones_oc' and policyname='coi_observaciones_select_auth') then
    create policy coi_observaciones_select_auth on public.coi_observaciones_oc
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_observaciones_oc' and policyname='coi_observaciones_insert_auth') then
    create policy coi_observaciones_insert_auth on public.coi_observaciones_oc
      for insert to authenticated with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_observaciones_oc' and policyname='coi_observaciones_update_auth') then
    create policy coi_observaciones_update_auth on public.coi_observaciones_oc
      for update to authenticated using (true) with check (auth.uid() is not null);
  end if;
end
$pol$;

-- coi_unidades_mantenimiento
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_unidades_mantenimiento' and policyname='coi_um_select_auth') then
    create policy coi_um_select_auth on public.coi_unidades_mantenimiento
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_unidades_mantenimiento' and policyname='coi_um_insert_auth') then
    create policy coi_um_insert_auth on public.coi_unidades_mantenimiento
      for insert to authenticated with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_unidades_mantenimiento' and policyname='coi_um_update_auth') then
    create policy coi_um_update_auth on public.coi_unidades_mantenimiento
      for update to authenticated using (true) with check (auth.uid() is not null);
  end if;
end
$pol$;

-- coi_servicios_tecnicos_um
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_servicios_tecnicos_um' and policyname='coi_st_select_auth') then
    create policy coi_st_select_auth on public.coi_servicios_tecnicos_um
      for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_servicios_tecnicos_um' and policyname='coi_st_insert_auth') then
    create policy coi_st_insert_auth on public.coi_servicios_tecnicos_um
      for insert to authenticated with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='coi_servicios_tecnicos_um' and policyname='coi_st_update_auth') then
    create policy coi_st_update_auth on public.coi_servicios_tecnicos_um
      for update to authenticated using (true) with check (auth.uid() is not null);
  end if;
end
$pol$;
