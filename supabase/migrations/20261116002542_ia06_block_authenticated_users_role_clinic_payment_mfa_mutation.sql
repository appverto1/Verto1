-- IA-06: block client-controlled profile edits to authentication/tenant/Stripe/MFA fields.
-- Preserve legitimate profile name, photo, age and updated_at autosave behavior.
BEGIN;
DO $ia06_users_preflight$
DECLARE v_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.users'::regclass AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'IA06_USERS_RLS_BASELINE_MISMATCH';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND p.tablename='users'
   AND p.policyname='users_update_self_or_admin'
   AND p.roles=ARRAY['authenticated']::name[]
   AND md5(coalesce(p.qual,'')||'::'||coalesce(p.with_check,''))='095645ba26bdd05411df0454869bc80d')
 THEN RAISE EXCEPTION 'IA06_USERS_SELF_UPDATE_POLICY_DRIFT'; END IF;
 IF NOT has_table_privilege('authenticated','public.users','UPDATE')
   OR NOT has_column_privilege('authenticated','public.users','role','UPDATE')
   OR NOT has_column_privilege('authenticated','public.users','clinic_id','UPDATE')
 THEN RAISE EXCEPTION 'IA06_USERS_UPDATE_GRANTS_CHANGED'; END IF;
 SELECT count(*) INTO v_count FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.users'::regclass AND NOT t.tgisinternal;
 IF v_count<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid='public.users'::regclass AND t.tgname='trg_users_updated_at' AND t.tgenabled='O')
 THEN RAISE EXCEPTION 'IA06_USERS_TRIGGER_BASELINE_DRIFT:%',v_count; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.users_privileged_field_update_guard_v1()'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.users'::regclass AND t.tgname='trg_users_privileged_fields_guard_v1')
 THEN RAISE EXCEPTION 'IA06_USERS_GUARD_ALREADY_EXISTS'; END IF;
 SELECT count(*) INTO v_count FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users' AND column_name=ANY(ARRAY['id','email','role','clinic_id','subscription_status','plan_name','plan_price','created_at','first_login_completed','type','specialty','crp','stripe_customer_id','stripe_customer_email','stripe_subscription_id','stripe_subscription_item_id','stripe_payment_failed_at','stripe_access_block_at','stripe_last_failed_invoice_id','stripe_price_id','billing_model','is_demo_user','demo_role','demo_expires_at','demo_access_mode','current_active_patient_limit','current_active_patient_count','pending_billing_quantity','pending_effective_date','pending_billing_status','pending_billing_requested_at','pending_billing_requested_by','two_factor_enabled','two_factor_secret','billing_source','complimentary_plan_granted_at','complimentary_plan_granted_by','complimentary_plan_note']);
 IF v_count<>38 THEN RAISE EXCEPTION 'IA06_USERS_PROTECTED_COLUMN_DRIFT:%',v_count; END IF;
END $ia06_users_preflight$;

CREATE FUNCTION public.users_privileged_field_update_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $ia06_guard$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) IN ('anon','authenticated') AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR     NEW.email IS DISTINCT FROM OLD.email
    OR     NEW.role IS DISTINCT FROM OLD.role
    OR     NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
    OR     NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR     NEW.plan_name IS DISTINCT FROM OLD.plan_name
    OR     NEW.plan_price IS DISTINCT FROM OLD.plan_price
    OR     NEW.created_at IS DISTINCT FROM OLD.created_at
    OR     NEW.first_login_completed IS DISTINCT FROM OLD.first_login_completed
    OR     NEW.type IS DISTINCT FROM OLD.type
    OR     NEW.specialty IS DISTINCT FROM OLD.specialty
    OR     NEW.crp IS DISTINCT FROM OLD.crp
    OR     NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
    OR     NEW.stripe_customer_email IS DISTINCT FROM OLD.stripe_customer_email
    OR     NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
    OR     NEW.stripe_subscription_item_id IS DISTINCT FROM OLD.stripe_subscription_item_id
    OR     NEW.stripe_payment_failed_at IS DISTINCT FROM OLD.stripe_payment_failed_at
    OR     NEW.stripe_access_block_at IS DISTINCT FROM OLD.stripe_access_block_at
    OR     NEW.stripe_last_failed_invoice_id IS DISTINCT FROM OLD.stripe_last_failed_invoice_id
    OR     NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
    OR     NEW.billing_model IS DISTINCT FROM OLD.billing_model
    OR     NEW.is_demo_user IS DISTINCT FROM OLD.is_demo_user
    OR     NEW.demo_role IS DISTINCT FROM OLD.demo_role
    OR     NEW.demo_expires_at IS DISTINCT FROM OLD.demo_expires_at
    OR     NEW.demo_access_mode IS DISTINCT FROM OLD.demo_access_mode
    OR     NEW.current_active_patient_limit IS DISTINCT FROM OLD.current_active_patient_limit
    OR     NEW.current_active_patient_count IS DISTINCT FROM OLD.current_active_patient_count
    OR     NEW.pending_billing_quantity IS DISTINCT FROM OLD.pending_billing_quantity
    OR     NEW.pending_effective_date IS DISTINCT FROM OLD.pending_effective_date
    OR     NEW.pending_billing_status IS DISTINCT FROM OLD.pending_billing_status
    OR     NEW.pending_billing_requested_at IS DISTINCT FROM OLD.pending_billing_requested_at
    OR     NEW.pending_billing_requested_by IS DISTINCT FROM OLD.pending_billing_requested_by
    OR     NEW.two_factor_enabled IS DISTINCT FROM OLD.two_factor_enabled
    OR     NEW.two_factor_secret IS DISTINCT FROM OLD.two_factor_secret
    OR     NEW.billing_source IS DISTINCT FROM OLD.billing_source
    OR     NEW.complimentary_plan_granted_at IS DISTINCT FROM OLD.complimentary_plan_granted_at
    OR     NEW.complimentary_plan_granted_by IS DISTINCT FROM OLD.complimentary_plan_granted_by
    OR     NEW.complimentary_plan_note IS DISTINCT FROM OLD.complimentary_plan_note
  ) THEN
    RAISE EXCEPTION 'USER_PRIVILEGED_FIELD_UPDATE_DENIED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$ia06_guard$;

REVOKE EXECUTE ON FUNCTION public.users_privileged_field_update_guard_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.users_privileged_field_update_guard_v1() TO service_role;

CREATE TRIGGER trg_users_privileged_fields_guard_v1
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.users_privileged_field_update_guard_v1();

DO $ia06_users_postcheck$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.users'::regclass
   AND NOT t.tgisinternal AND t.tgenabled='O';
 IF v_count<>2 THEN RAISE EXCEPTION 'IA06_USERS_GUARD_BINDINGS_CHANGED:%',v_count; END IF;
 IF has_function_privilege('authenticated','public.users_privileged_field_update_guard_v1()','EXECUTE')
 OR has_function_privilege('anon','public.users_privileged_field_update_guard_v1()','EXECUTE')
 OR NOT has_function_privilege('service_role','public.users_privileged_field_update_guard_v1()','EXECUTE')
 THEN RAISE EXCEPTION 'IA06_USERS_GUARD_ACL_FAILURE'; END IF;
 IF NOT has_column_privilege('authenticated','public.users','name','UPDATE')
 OR NOT has_column_privilege('authenticated','public.users','profile_picture','UPDATE')
 THEN RAISE EXCEPTION 'IA06_USERS_PROFILE_WRITE_REGRESSION'; END IF;
END $ia06_users_postcheck$;
COMMIT;