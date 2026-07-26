-- Read-only post-migration checks for 20260727010000.
-- Run manually in the Supabase SQL Editor with an administrative account.
-- Every statement below is SELECT-only.

-- 1. Clinic defaults.
select organization_id, id, base_amount, valid_from, valid_until, version, active
from public.private_session_price_rules
where scope_type = 'CLINIC_DEFAULT'
order by organization_id, valid_from desc, version desc;

-- 2. Specialty prices.
select organization_id, specialty_key, specialty_name, base_amount,
       default_duration_minutes, valid_from, valid_until, version, active
from public.private_session_price_rules
where scope_type = 'SPECIALTY'
order by organization_id, specialty_name, valid_from desc, version desc;

-- 3. Service prices.
select rule.organization_id, rule.service_catalog_id,
       coalesce(service.name, rule.service_name_snapshot) as service_name,
       rule.specialty_name, rule.base_amount, rule.valid_from,
       rule.valid_until, rule.version, rule.active
from public.private_session_price_rules rule
left join public.tuss_service_catalog service
  on service.organization_id = rule.organization_id
 and service.id = rule.service_catalog_id
where rule.scope_type = 'SERVICE'
order by rule.organization_id, service_name, rule.valid_from desc, rule.version desc;

-- 4. Patient agreements.
select organization_id, patient_id, specialty_name, service_name_snapshot,
       payer_name_snapshot, base_amount, discount_amount, zero_classification,
       reason, valid_from, valid_until, version, active
from public.patient_private_pricing_agreements
order by organization_id, patient_id, valid_from desc, version desc;

-- 5. Active, expired and future rules.
select organization_id,
       count(*) filter (where active and valid_from <= current_date and (valid_until is null or valid_until >= current_date)) as currently_active,
       count(*) filter (where valid_until < current_date) as expired,
       count(*) filter (where valid_from > current_date) as future,
       count(*) filter (where not active) as superseded
from public.private_session_price_rules
group by organization_id
order by organization_id;

-- 6. Private appointments without a financial snapshot.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_APPOINTMENT_WITHOUT_SNAPSHOT'
order by organization_id, scheduled_at;

-- 7. Private appointments at zero without an explicit classification/reason.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_APPOINTMENT_ZERO_OR_UNJUSTIFIED'
order by organization_id, scheduled_at;

-- 8. Private appointments without a linked charge.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_APPOINTMENT_WITHOUT_CHARGE'
order by organization_id, scheduled_at;

-- 9. Duplicate active charges.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_APPOINTMENT_DUPLICATE_ACTIVE_CHARGE'
order by organization_id, appointment_id;

-- 10. Charges without due date.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_CHARGE_WITHOUT_DUE_DATE'
order by organization_id, scheduled_at;

-- 11. Charges without payer.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_CHARGE_WITHOUT_PAYER'
order by organization_id, scheduled_at;

-- 12. Charges grouped by operational and conceptual status.
select organization_id, status, financial_status, private_financial_classification,
       count(*) as charge_count,
       sum(coalesce(amount, 0)) as charged_amount,
       sum(coalesce(paid_amount, 0) - coalesce(refunded_amount, 0)) as net_received,
       sum(coalesce(balance_amount, 0)) as balance_amount
from public.payments
where private_price_source is not null
group by organization_id, status, financial_status, private_financial_classification
order by organization_id, financial_status, private_financial_classification;

-- 13. Overdue private charges.
select organization_id, id, patient_id, appointment_id, payer_name,
       amount, paid_amount, balance_amount, due_date, financial_status
from public.payments
where private_price_source is not null
  and due_date < current_date
  and coalesce(balance_amount, 0) > 0
  and canceled_at is null
order by organization_id, due_date;

-- 14. Partial payments.
select organization_id, id, patient_id, appointment_id, amount,
       paid_amount, refunded_amount, balance_amount, due_date
from public.payments
where private_price_source is not null
  and greatest(coalesce(paid_amount, 0) - coalesce(refunded_amount, 0), 0) > 0
  and coalesce(balance_amount, 0) > 0
order by organization_id, due_date;

-- 15. Overpayments.
select *
from public.private_session_finance_diagnostics_v1
where issue_code = 'PRIVATE_CHARGE_OVERPAID'
order by organization_id, payment_id;

-- 16. Cancellations inside the frozen free window.
select organization_id, id, patient_id, appointment_id, amount,
       original_amount, cancellation_free_until, canceled_at,
       private_financial_classification
from public.payments
where private_price_source is not null
  and private_financial_classification = 'CANCELLED_NO_CHARGE'
order by organization_id, canceled_at desc;

-- 17. Late cancellations.
select organization_id, id, patient_id, appointment_id, amount,
       original_amount, balance_amount, due_date, cancellation_free_until
from public.payments
where private_price_source is not null
  and private_financial_classification = 'LATE_CANCELLATION_CHARGE'
order by organization_id, appointment_scheduled_at desc;

-- 18. No-shows.
select organization_id, id, patient_id, appointment_id, amount,
       original_amount, balance_amount, private_financial_classification
from public.payments
where private_price_source is not null
  and private_financial_classification in ('NO_SHOW_CHARGE', 'NO_SHOW_NO_CHARGE')
order by organization_id, appointment_scheduled_at desc;

-- 19. Recurrence occurrences without one active charge per appointment.
select appointment.organization_id, appointment.recurrence_group_id,
       appointment.id as appointment_id, appointment.recurrence_index,
       count(item.id) filter (where item.active) as active_charge_count
from public.appointments appointment
left join public.payment_appointment_items item
  on item.organization_id = appointment.organization_id
 and item.appointment_id = appointment.id
where appointment.recurrence_group_id is not null
  and upper(coalesce(
    appointment.source_payload->>'financialContextType',
    appointment.source_payload->>'financial_context_type',
    ''
  )) in ('PRIVATE', 'PARTICULAR')
group by appointment.organization_id, appointment.recurrence_group_id,
         appointment.id, appointment.recurrence_index
having count(item.id) filter (where item.active) <> 1
order by appointment.organization_id, appointment.recurrence_group_id, appointment.recurrence_index;

-- 20. Immutable snapshot history.
select organization_id, appointment_id, payment_id, snapshot_version,
       snapshot_event, specialty_name, service_name, payer_name,
       base_amount, location_surcharge, discount_amount, final_amount,
       price_source_label, due_date, cancellation_free_until,
       financial_classification, created_by, override_reason, created_at
from public.appointment_private_financial_snapshots
order by organization_id, appointment_id, snapshot_version;

-- 21. Orphan or cross-tenant references.
select *
from public.private_session_finance_diagnostics_v1
where issue_code in (
  'PRIVATE_SNAPSHOT_ORPHAN_PAYMENT',
  'PRIVATE_CHARGE_WITHOUT_APPOINTMENT'
)
order by organization_id, issue_code, appointment_id;

-- 22. RLS state.
select schemaname, tablename, rowsecurity
from pg_catalog.pg_tables
where schemaname = 'public'
  and tablename in (
    'private_session_price_rules',
    'patient_private_pricing_agreements',
    'appointment_private_financial_snapshots',
    'private_financial_idempotency_requests'
  )
order by tablename;

-- 23. Grants for tables, view and RPCs.
select object_name, grantee, privilege, allowed
from (
  select 'private_session_price_rules'::text as object_name, role_name as grantee,
         'SELECT'::text as privilege,
         has_table_privilege(role_name, 'public.private_session_price_rules', 'SELECT') as allowed
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  union all
  select 'patient_private_pricing_agreements', role_name, 'SELECT',
         has_table_privilege(role_name, 'public.patient_private_pricing_agreements', 'SELECT')
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  union all
  select 'appointment_private_financial_snapshots', role_name, 'SELECT',
         has_table_privilege(role_name, 'public.appointment_private_financial_snapshots', 'SELECT')
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  union all
  select 'private_financial_idempotency_requests', role_name, 'SELECT',
         has_table_privilege(role_name, 'public.private_financial_idempotency_requests', 'SELECT')
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  union all
  select 'private_session_finance_diagnostics_v1', role_name, 'SELECT',
         has_table_privilege(role_name, 'public.private_session_finance_diagnostics_v1', 'SELECT')
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  union all
  select function_row.object_name, role_name, 'EXECUTE',
         has_function_privilege(role_name, function_row.signature, 'EXECUTE')
  from (
    values
      (
        'resolve_private_session_price_v1',
        'public.resolve_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid)'
      ),
      (
        'resolve_private_session_prices_v1',
        'public.resolve_private_session_prices_v1(uuid,jsonb,uuid)'
      ),
      (
        'save_private_session_price_rule_v1',
        'public.save_private_session_price_rule_v1(uuid,jsonb,text,uuid)'
      ),
      (
        'save_patient_private_pricing_agreement_v1',
        'public.save_patient_private_pricing_agreement_v1(uuid,uuid,jsonb,text,uuid)'
      ),
      (
        'apply_private_patient_financial_operation_v2',
        'public.apply_private_patient_financial_operation_v2(uuid,text,text,numeric,date,text,timestamptz,text,text,text,text,text,text)'
      )
  ) function_row(object_name, signature)
  cross join unnest(array['anon', 'authenticated', 'service_role']) role_name
) grants
order by object_name, grantee;

-- 24. Indexes.
select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
  and (
    tablename in (
      'private_session_price_rules',
      'patient_private_pricing_agreements',
      'appointment_private_financial_snapshots',
      'private_financial_idempotency_requests'
    )
    or indexname = 'idx_payments_private_receivables_filters'
  )
order by tablename, indexname;

-- 25. Audit completeness.
select payment.organization_id, payment.id as payment_id,
       payment.appointment_id, payment.private_financial_classification,
       count(event.id) as audit_event_count,
       max(event.created_at) as last_audit_at
from public.payments payment
left join public.payment_audit_events event
  on event.organization_id = payment.organization_id
 and event.payment_id::text = payment.id::text
where payment.private_price_source is not null
group by payment.organization_id, payment.id, payment.appointment_id,
         payment.private_financial_classification
having count(event.id) = 0
order by payment.organization_id, payment.id;

-- Consolidated diagnostic counts (also read-only).
select organization_id, issue_code, count(*) as affected_rows
from public.private_session_finance_diagnostics_v1
group by organization_id, issue_code
order by organization_id, issue_code;
