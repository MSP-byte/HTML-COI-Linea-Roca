-- =====================================================================
-- H07 — Referencias documentales de OC con autoridad en PostgreSQL
-- =====================================================================
--
-- MOTIVO
--   El modulo documental V64 guarda sus referencias —tipo, numero, repositorio,
--   ruta, link de OneDrive/SharePoint, estado documental— exclusivamente en la
--   clave `coi_documentacion_oc` de localStorage. Es el ultimo dato operativo
--   del sistema sin autoridad remota (KI-019):
--
--     - no se comparte entre operadores ni entre equipos;
--     - se pierde al limpiar el navegador y nada lo repone;
--     - otro operador del mismo puesto hereda las referencias del anterior.
--
--   `public.coi_documentos_oc` NO sirve para esto: esa tabla indexa los PDF
--   fisicos del bucket `coi-documentos` (storage_bucket / storage_path). Las
--   referencias V64 apuntan a repositorios externos y no tienen lugar ahi.
--
-- ALCANCE
--   Se crea `public.coi_documentacion_oc` con los 20 campos que el modulo V64
--   usa realmente —tomados de v64NormalizarDocumento(), no inventados— y con la
--   identidad tecnica que el proyecto ya usa en todas las tablas hijas: un UUID
--   propio y `orden_id uuid` referenciando `public.coi_ordenes(id)`.
--
--   NO se denormaliza `nro_oc`. En coi_documentos_oc y en
--   coi_servicios_tecnicos_um ese campo existe porque hay flujos que llegan con
--   el numero antes que con la orden, y por eso H04 tuvo que construir todo el
--   aparato de trigger y lock para mantenerlo coherente ante una renumeracion.
--   Aca no hace falta: la referencia documental se crea SIEMPRE desde la ficha
--   de una OC ya resuelta, el cliente tiene el catalogo de ordenes en memoria y
--   puede mostrar el numero vigente. Guardar una copia solo agregaria un dato
--   que puede quedar viejo cuando la OC se renumera.
--
--   ON DELETE RESTRICT, igual que el criterio de H03 y H05: borrar una OC no
--   puede llevarse en silencio su historial documental. La aplicacion no ofrece
--   borrado fisico de ordenes por este camino; la FK es defensa en profundidad.
--
--   RLS con el MISMO modelo de roles que ya existe: policies RESTRICTIVE sobre
--   public.coi_current_role(), como en 202608310002_h04_h05_role_guard.sql. No
--   se inventa un sistema de permisos nuevo.
--
--     SELECT : coi_current_role() is not null   (autenticado con perfil activo)
--     INSERT : coi_current_role() = 'administrador'
--     UPDATE : administrador en USING y en WITH CHECK
--     DELETE : administrador  — ver nota abajo
--
--   A diferencia de UM y ST, aca SI se crea policy DELETE. Una referencia
--   documental no es historial operativo: es un puntero a un archivo externo, y
--   el modulo V64 siempre ofrecio eliminarla («No se borrara ningun archivo
--   externo»). Quitar esa accion seria una regresion funcional. El archivo
--   real vive en OneDrive/SharePoint y no lo toca nadie desde aca.
--
--   La version de fila la pone PostgreSQL reutilizando
--   public.coi_version_servidor() de 202609020001, de modo que el CAS optimista
--   del frontend funciona igual que en UM y ST.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: create table if not exists, cada policy se elimina
--   por nombre antes de recrearse, el trigger se elimina antes de crearse y los
--   grants se declaran de forma absoluta (revoke all + grant exacto).
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a PRODUCCION ni a STAGING. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json la documenta en
--   «_divergencias_pendientes.tablas» y el modulo documental falla de forma
--   entendible en lugar de volver a localStorage.

-- ---------------------------------------------------------------------
-- 1) Tabla
-- ---------------------------------------------------------------------
create table if not exists public.coi_documentacion_oc (
  id uuid not null default gen_random_uuid(),
  orden_id uuid not null,
  -- Identificadores de negocio del registro dentro de la OC. Son texto libre
  -- heredado del modelo V64: describen a que obra o servicio pertenece la
  -- referencia, no son identidad tecnica.
  id_obra text,
  id_servicio text,
  tipo_registro text,
  -- Descripcion documental.
  tipo_documento text not null,
  nro_documento text,
  nombre_archivo text,
  extension_archivo text,
  repositorio text,
  ruta_documental text,
  link_documento text,
  link_carpeta text,
  fecha_documento date,
  periodo text,
  acta_nro text,
  estado_documento text not null default 'Pendiente',
  observaciones text,
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  constraint coi_documentacion_oc_pkey primary key (id),
  constraint coi_documentacion_oc_orden_id_fkey
    foreign key (orden_id) references public.coi_ordenes(id) on delete restrict,
  -- Una referencia sin tipo documental no es utilizable operativamente.
  constraint coi_documentacion_oc_tipo_documento_no_vacio
    check (length(btrim(tipo_documento)) > 0)
);

comment on table public.coi_documentacion_oc is
  'H07: referencias documentales de OC del modulo V64 (tipo, numero, repositorio, ruta, link externo y estado documental). Autoridad operativa: sustituye a la clave localStorage coi_documentacion_oc. No guarda archivos: los PDF del bucket privado se indexan en public.coi_documentos_oc.';

comment on column public.coi_documentacion_oc.orden_id is
  'Identidad tecnica de la OC. No se guarda nro_oc denormalizado a proposito: el numero vigente lo resuelve el cliente desde el catalogo de ordenes, de modo que una renumeracion no deja copias viejas.';

-- ---------------------------------------------------------------------
-- 2) Indices
-- ---------------------------------------------------------------------
-- La lectura operativa es siempre «documentos de esta OC».
create index if not exists coi_documentacion_oc_orden_id_idx
  on public.coi_documentacion_oc (orden_id);

-- El paginado por keyset del frontend recorre por id; el listado por OC ordena
-- por fecha del documento.
create index if not exists coi_documentacion_oc_orden_fecha_idx
  on public.coi_documentacion_oc (orden_id, fecha_documento desc nulls last);

-- ---------------------------------------------------------------------
-- 3) Version server-side (reutiliza el guard de 202609020001)
-- ---------------------------------------------------------------------
drop trigger if exists coi_documentacion_version_servidor on public.coi_documentacion_oc;
create trigger coi_documentacion_version_servidor
  before update on public.coi_documentacion_oc
  for each row execute function public.coi_version_servidor();

-- ---------------------------------------------------------------------
-- 4) RLS · mismo modelo de roles que H04/H05
-- ---------------------------------------------------------------------
alter table public.coi_documentacion_oc enable row level security;

-- Permisiva base: sin ella las restrictivas no habilitan nada.
drop policy if exists coi_documentacion_all_auth on public.coi_documentacion_oc;
create policy coi_documentacion_all_auth on public.coi_documentacion_oc
for all to authenticated
using (true)
with check (true);

drop policy if exists coi_documentacion_select_guard on public.coi_documentacion_oc;
create policy coi_documentacion_select_guard on public.coi_documentacion_oc as restrictive
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_documentacion_insert_guard on public.coi_documentacion_oc;
create policy coi_documentacion_insert_guard on public.coi_documentacion_oc as restrictive
for insert to authenticated
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_documentacion_update_guard on public.coi_documentacion_oc;
create policy coi_documentacion_update_guard on public.coi_documentacion_oc as restrictive
for update to authenticated
using (public.coi_current_role() = 'administrador')
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_documentacion_delete_guard on public.coi_documentacion_oc;
create policy coi_documentacion_delete_guard on public.coi_documentacion_oc as restrictive
for delete to authenticated
using (public.coi_current_role() = 'administrador');

-- ---------------------------------------------------------------------
-- 5) Grants · segunda capa, absolutos
-- ---------------------------------------------------------------------
revoke all on table public.coi_documentacion_oc from anon;
revoke all on table public.coi_documentacion_oc from authenticated;
grant select, insert, update, delete on table public.coi_documentacion_oc to authenticated;
