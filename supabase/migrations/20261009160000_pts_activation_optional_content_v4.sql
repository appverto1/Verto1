begin;

-- A criação e publicação de um PTS não dependem de preencher metas,
-- técnico, data, necessidades ou critérios. Essas informações são opcionais
-- e podem ser acrescentadas em uma versão futura. A publicação sem alvos
-- não cria alvos de coleta nem muda o escopo de outros planos.
-- Permanecem as regras de estrutura, CAS (draft_revision), autorização,
-- isolamento por patient/organization/plan e transação no RPC v3.
create or replace function public.patient_pts_snapshot_ready_for_activation_v3(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select
    jsonb_typeof(p_snapshot) = 'object'
    and jsonb_typeof(p_snapshot->'pts_payload') = 'object'
    and jsonb_typeof(p_snapshot->'common_objectives') = 'array'
    and jsonb_typeof(p_snapshot->'specialty_objectives') = 'object';
$function$;

revoke all on function public.patient_pts_snapshot_ready_for_activation_v3(jsonb)
  from public, anon, authenticated;
grant execute on function public.patient_pts_snapshot_ready_for_activation_v3(jsonb)
  to service_role;

-- O RPC activate_patient_pts_draft_v3 permanece intacto: valida o
-- ownership e a revisão atual em save_patient_pts_draft_v2, depois
-- registra versão/evento imutáveis, sem duplicar/publicar concorrente.

commit;
