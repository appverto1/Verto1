-- Resumo agregado das avaliacoes do marketplace (consulta unica por catalogo).
-- Sem acesso direto ao frontend; somente o backend com service_role.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.verto_marketplace_review_summaries_v1(p_partner_ids uuid[])
returns table(partner_id uuid, review_count bigint, rating_average numeric)
language sql stable security invoker
set search_path=pg_catalog,public
as $$
  select r.partner_id, count(*)::bigint, round(avg(r.rating)::numeric,2)
  from public.verto_partner_marketplace_reviews r
  where r.partner_id = any(p_partner_ids)
  group by r.partner_id
$$;

revoke all on function public.verto_marketplace_review_summaries_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.verto_marketplace_review_summaries_v1(uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
