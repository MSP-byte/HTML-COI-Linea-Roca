-- COI Línea Roca · Runtime helper permission reconciliation
-- coi_assert_role es una dependencia server-side de RPC operativas; authenticated
-- necesita EXECUTE para que las RPC puedan completar sus guardas de rol.
-- anon/public continúan revocados. No modifica datos.

begin;

do $$
begin
  if to_regprocedure('public.coi_assert_role(text[])') is not null then
    revoke all on function public.coi_assert_role(text[]) from public, anon;
    grant execute on function public.coi_assert_role(text[]) to authenticated;
  end if;
end $$;

commit;
