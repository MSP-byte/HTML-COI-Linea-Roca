-- El RPC atomico usa los permisos y RLS del usuario autenticado.

begin;

alter function public.coi_timeline_upsert_events(jsonb) security invoker;

commit;
