-- RC2 hotfix - bootstrap de perfiles Auth canónicos para RLS.
--
-- Contexto:
-- RC2 endurece lectura/escritura mediante public.coi_current_role(), que resuelve
-- el rol desde public.profiles. En instalaciones históricas puede existir Auth
-- sin filas materializadas en profiles, dejando al usuario autenticado sin rol
-- efectivo y ocultando las OCs bajo las políticas restrictivas.
--
-- Reglas de seguridad:
-- - si auth.users está vacío (fixture CI), la migración es no-op;
-- - si existe cualquier usuario real, exige exactamente un admin@coiroca.com;
-- - sincroniza ese admin como administrador activo;
-- - si existe consulta@coiroca.com, la sincroniza como consulta activa;
-- - depende sólo de auth.users(id,email), contrato mínimo necesario;
-- - no toca OCs, estaciones, posiciones, certificaciones ni ledger;
-- - es idempotente y portable entre STAGING y PROD.

begin;

do $$
declare
  v_auth_count integer;
  v_admin_count integer;
  v_consulta_count integer;
begin
  select count(*) into v_auth_count from auth.users;
  if v_auth_count = 0 then
    return;
  end if;

  select count(*) into v_admin_count
  from auth.users
  where lower(email) = 'admin@coiroca.com';

  if v_admin_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'COI_BOOTSTRAP_ADMIN_ACCOUNT_REQUIRED',
      detail = format('Se esperaba exactamente 1 admin@coiroca.com y se encontraron %s.', v_admin_count);
  end if;

  select count(*) into v_consulta_count
  from auth.users
  where lower(email) = 'consulta@coiroca.com';

  if v_consulta_count > 1 then
    raise exception using
      errcode = '23514',
      message = 'COI_BOOTSTRAP_CONSULTA_ACCOUNT_AMBIGUOUS',
      detail = format('Se esperaba como máximo 1 consulta@coiroca.com y se encontraron %s.', v_consulta_count);
  end if;
end;
$$;

insert into public.profiles (
  id,
  email,
  rol,
  activo,
  fecha_alta
)
select
  u.id,
  lower(u.email),
  'administrador',
  true,
  now()
from auth.users u
where lower(u.email) = 'admin@coiroca.com'
on conflict (id) do update
set email = excluded.email,
    rol = 'administrador',
    activo = true;

insert into public.profiles (
  id,
  email,
  rol,
  activo,
  fecha_alta
)
select
  u.id,
  lower(u.email),
  'consulta',
  true,
  now()
from auth.users u
where lower(u.email) = 'consulta@coiroca.com'
on conflict (id) do update
set email = excluded.email,
    rol = 'consulta',
    activo = true;

do $$
declare
  v_admin_ok boolean;
  v_consulta_exists boolean;
  v_consulta_ok boolean;
begin
  if not exists (select 1 from auth.users) then
    return;
  end if;

  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) = 'admin@coiroca.com'
      and lower(coalesce(p.email, '')) = 'admin@coiroca.com'
      and p.rol = 'administrador'
      and p.activo is true
  ) into v_admin_ok;

  if not v_admin_ok then
    raise exception using
      errcode = '23514',
      message = 'COI_BOOTSTRAP_ADMIN_PROFILE_FAILED';
  end if;

  select exists (
    select 1 from auth.users where lower(email) = 'consulta@coiroca.com'
  ) into v_consulta_exists;

  if v_consulta_exists then
    select exists (
      select 1
      from public.profiles p
      join auth.users u on u.id = p.id
      where lower(u.email) = 'consulta@coiroca.com'
        and lower(coalesce(p.email, '')) = 'consulta@coiroca.com'
        and p.rol = 'consulta'
        and p.activo is true
    ) into v_consulta_ok;

    if not v_consulta_ok then
      raise exception using
        errcode = '23514',
        message = 'COI_BOOTSTRAP_CONSULTA_PROFILE_FAILED';
    end if;
  end if;
end;
$$;

commit;
