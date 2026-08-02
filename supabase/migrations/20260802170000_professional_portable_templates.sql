begin;

-- Personal anamnesis templates belong to the professional identity and can be reused
-- in every clinic where the professional has an active membership.
alter table public.anamnesis_templates
  add column if not exists scope text,
  add column if not exists owner_user_id uuid references public.users(id) on delete cascade,
  add column if not exists visibility text;

update public.anamnesis_templates
set scope = case
  when organization_id is null then 'global'
  else 'clinic'
end
where scope is null;

update public.anamnesis_templates
set visibility = case
  when scope = 'personal' then 'private'
  else 'clinic'
end
where visibility is null;

alter table public.anamnesis_templates
  alter column scope set default 'clinic',
  alter column scope set not null,
  alter column visibility set default 'clinic',
  alter column visibility set not null;

alter table public.anamnesis_templates
  drop constraint if exists anamnesis_templates_scope_check;
alter table public.anamnesis_templates
  add constraint anamnesis_templates_scope_check
  check (scope in ('global', 'clinic', 'personal'));

alter table public.anamnesis_templates
  drop constraint if exists anamnesis_templates_visibility_check;
alter table public.anamnesis_templates
  add constraint anamnesis_templates_visibility_check
  check (visibility in ('clinic', 'private'));

alter table public.anamnesis_templates
  drop constraint if exists anamnesis_templates_scope_owner_consistency;
alter table public.anamnesis_templates
  add constraint anamnesis_templates_scope_owner_consistency
  check (
    (scope = 'global' and organization_id is null and owner_user_id is null)
    or (scope = 'clinic' and organization_id is not null and owner_user_id is null and visibility = 'clinic')
    or (scope = 'personal' and owner_user_id is not null and organization_id = owner_user_id and visibility = 'private')
  );

create index if not exists idx_anamnesis_templates_owner_active
  on public.anamnesis_templates (owner_user_id, is_active, updated_at desc)
  where scope = 'personal';

create index if not exists idx_anamnesis_templates_clinic_active
  on public.anamnesis_templates (organization_id, is_active, updated_at desc)
  where scope = 'clinic';

alter table public.anamnesis_templates enable row level security;

drop policy if exists anamnesis_templates_clinic_read on public.anamnesis_templates;
drop policy if exists anamnesis_templates_clinic_write on public.anamnesis_templates;
drop policy if exists anamnesis_templates_read_v2 on public.anamnesis_templates;
drop policy if exists anamnesis_templates_manage_v2 on public.anamnesis_templates;

create policy anamnesis_templates_read_v2
on public.anamnesis_templates
for select to authenticated
using (
  (scope = 'global' and is_active = true)
  or (scope = 'personal' and owner_user_id = auth.uid())
  or (
    scope = 'clinic'
    and exists (
      select 1
      from public.clinic_memberships membership
      where membership.user_id = auth.uid()
        and membership.clinic_id = anamnesis_templates.organization_id
        and membership.status = 'active'
    )
  )
  or exists (
    select 1
    from public.users actor
    where actor.id = auth.uid()
      and actor.role in ('owner', 'admin')
      and actor.clinic_id = anamnesis_templates.organization_id
  )
);

create policy anamnesis_templates_manage_v2
on public.anamnesis_templates
for all to authenticated
using (
  (scope = 'personal' and owner_user_id = auth.uid())
  or (
    scope = 'clinic'
    and (
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = auth.uid()
          and membership.clinic_id = anamnesis_templates.organization_id
          and membership.status = 'active'
          and membership.role = 'coordinator'
      )
      or exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and actor.role in ('owner', 'admin')
          and actor.clinic_id = anamnesis_templates.organization_id
      )
    )
  )
)
with check (
  (
    scope = 'personal'
    and owner_user_id = auth.uid()
    and organization_id = auth.uid()
    and visibility = 'private'
  )
  or (
    scope = 'clinic'
    and visibility = 'clinic'
    and (
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = auth.uid()
          and membership.clinic_id = anamnesis_templates.organization_id
          and membership.status = 'active'
          and membership.role = 'coordinator'
      )
      or exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and actor.role in ('owner', 'admin')
          and actor.clinic_id = anamnesis_templates.organization_id
      )
    )
  )
);

-- Existing private therapeutic templates are detached from the clinic tenant and
-- attached to the professional identity. Clinic templates remain tenant scoped.
with duplicated_keys as (
  select id,
         row_number() over (
           partition by owner_user_id, idempotency_key
           order by created_at, id
         ) as duplicate_order
  from public.aba_program_templates
  where source_scope = 'PERSONAL'
    and owner_user_id is not null
    and idempotency_key is not null
)
update public.aba_program_templates template
set idempotency_key = template.idempotency_key || ':' || template.id
from duplicated_keys duplicate
where duplicate.id = template.id
  and duplicate.duplicate_order > 1;

update public.aba_program_templates
set organization_id = owner_user_id,
    clinic_id = null,
    visibility = 'private',
    updated_at = now()
where source_scope = 'PERSONAL'
  and owner_user_id is not null
  and (
    organization_id is distinct from owner_user_id
    or clinic_id is not null
    or visibility is distinct from 'private'
  );


alter table public.aba_program_template_versions
  alter column clinic_id drop not null;

update public.aba_program_template_versions version_row
set organization_id = template.owner_user_id,
    clinic_id = null
from public.aba_program_templates template
where template.id = version_row.template_id
  and template.source_scope = 'PERSONAL'
  and template.owner_user_id is not null
  and (
    version_row.organization_id is distinct from template.owner_user_id
    or version_row.clinic_id is not null
  );

create index if not exists idx_aba_program_templates_personal_owner
  on public.aba_program_templates (owner_user_id, status, updated_at desc)
  where source_scope = 'PERSONAL';

alter table public.aba_program_templates enable row level security;

drop policy if exists aba_program_templates_read on public.aba_program_templates;
drop policy if exists aba_program_templates_manage on public.aba_program_templates;

create policy aba_program_templates_read
on public.aba_program_templates
for select to authenticated
using (
  (source_scope = 'VERTO' and status = 'PUBLISHED')
  or (
    source_scope = 'PERSONAL'
    and visibility = 'private'
    and owner_user_id = auth.uid()::text
  )
  or (
    source_scope = 'CLINIC'
    and visibility = 'clinic'
    and (
      exists (
        select 1
        from public.clinic_memberships membership
        where membership.user_id = auth.uid()
          and membership.clinic_id::text = aba_program_templates.organization_id
          and membership.status = 'active'
          and (
            aba_program_templates.status = 'PUBLISHED'
            or membership.role = 'coordinator'
          )
      )
      or exists (
        select 1
        from public.users actor
        where actor.id = auth.uid()
          and actor.role in ('owner', 'admin')
          and actor.clinic_id::text = aba_program_templates.organization_id
      )
    )
  )
);

create policy aba_program_templates_manage
on public.aba_program_templates
for all to authenticated
using (
  source_scope <> 'VERTO'
  and (
    (
      source_scope = 'PERSONAL'
      and visibility = 'private'
      and owner_user_id = auth.uid()::text
    )
    or (
      source_scope = 'CLINIC'
      and visibility = 'clinic'
      and (
        exists (
          select 1
          from public.clinic_memberships membership
          where membership.user_id = auth.uid()
            and membership.clinic_id::text = aba_program_templates.organization_id
            and membership.status = 'active'
            and membership.role = 'coordinator'
        )
        or exists (
          select 1
          from public.users actor
          where actor.id = auth.uid()
            and actor.role in ('owner', 'admin')
            and actor.clinic_id::text = aba_program_templates.organization_id
        )
      )
    )
  )
)
with check (
  source_scope <> 'VERTO'
  and (
    (
      source_scope = 'PERSONAL'
      and visibility = 'private'
      and owner_user_id = auth.uid()::text
      and organization_id = auth.uid()::text
    )
    or (
      source_scope = 'CLINIC'
      and visibility = 'clinic'
      and (
        exists (
          select 1
          from public.clinic_memberships membership
          where membership.user_id = auth.uid()
            and membership.clinic_id::text = aba_program_templates.organization_id
            and membership.status = 'active'
            and membership.role = 'coordinator'
        )
        or exists (
          select 1
          from public.users actor
          where actor.id = auth.uid()
            and actor.role in ('owner', 'admin')
            and actor.clinic_id::text = aba_program_templates.organization_id
        )
      )
    )
  )
);


drop policy if exists aba_program_template_versions_tenant_select
  on public.aba_program_template_versions;
create policy aba_program_template_versions_tenant_select
on public.aba_program_template_versions
for select to authenticated
using (
  exists (
    select 1
    from public.aba_program_templates template
    where template.id = aba_program_template_versions.template_id
      and (
        (
          template.source_scope = 'PERSONAL'
          and template.owner_user_id = auth.uid()::text
        )
        or (
          template.source_scope = 'CLINIC'
          and (
            exists (
              select 1
              from public.clinic_memberships membership
              where membership.user_id = auth.uid()
                and membership.clinic_id::text = template.organization_id
                and membership.status = 'active'
            )
            or exists (
              select 1
              from public.users actor
              where actor.id = auth.uid()
                and actor.role in ('owner', 'admin')
                and actor.clinic_id::text = template.organization_id
            )
          )
        )
      )
  )
);

grant select, insert, update, delete on public.anamnesis_templates to authenticated;
grant select, insert, update, delete on public.aba_program_templates to authenticated;
grant select on public.aba_program_template_versions to authenticated;

commit;
