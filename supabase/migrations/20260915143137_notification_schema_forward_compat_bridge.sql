begin;

-- Forward-compatible bridge for production schema drift.
-- This phase is deliberately backward-compatible with the current production runtime:
-- it preserves existing endpoint uniqueness/grants where present and does not assign deployment_env.
-- Phase B re-applies the canonical notification environment isolation once rollout is ready.

alter table public.push_subscriptions
  add column if not exists id uuid,
  add column if not exists renewal_token_hash text,
  add column if not exists renewal_token_created_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists invalidated_at timestamptz;

alter table public.push_subscriptions
  alter column id set default gen_random_uuid();

-- A generated technical id is not an environment classification and does not change
-- ownership/tenant semantics. Existing non-null ids are preserved byte-for-byte.
update public.push_subscriptions
   set id = gen_random_uuid()
 where id is null;

alter table public.push_subscriptions
  alter column id set not null;

do $$
declare
  v_pk_name text;
  v_pk_def text;
begin
  if exists (
    select 1
      from public.push_subscriptions
     group by id
    having count(*) > 1
  ) then
    raise exception 'PUSH_SUBSCRIPTIONS_DUPLICATE_ID_BLOCKS_RECONCILIATION';
  end if;

  select con.conname, pg_get_constraintdef(con.oid)
    into v_pk_name, v_pk_def
    from pg_constraint con
   where con.conrelid = 'public.push_subscriptions'::regclass
     and con.contype = 'p'
   limit 1;

  if v_pk_name is null then
    alter table public.push_subscriptions
      add constraint push_subscriptions_pkey primary key (id);
  elsif v_pk_def <> 'PRIMARY KEY (id)' then
    if exists (
      select 1
        from pg_constraint con
       where con.contype = 'f'
         and con.confrelid = 'public.push_subscriptions'::regclass
    ) then
      raise exception 'PUSH_SUBSCRIPTIONS_LEGACY_PK_HAS_FOREIGN_KEY_DEPENDENTS';
    end if;

    execute format('alter table public.push_subscriptions drop constraint %I', v_pk_name);
    alter table public.push_subscriptions
      add constraint push_subscriptions_pkey primary key (id);
  end if;
end $$;

-- Do not create or remove endpoint uniqueness in phase A.
-- Production already has the legacy endpoint unique index; staging intentionally does not,
-- because legacy NULL-environment rows may duplicate endpoints. Phase B replaces any legacy
-- production index with environment-scoped uniqueness.

notify pgrst, 'reload schema';
commit;
