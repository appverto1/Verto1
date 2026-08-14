do $test$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_offers'
      and column_name = 'contract_email'
  ) then
    raise exception 'TEST_FAILED: sales_offers.contract_email missing';
  end if;

  if to_regprocedure(
    'public.create_sales_modular_offer_v3(uuid,uuid,uuid,text,text,text,timestamptz,text)'
  ) is null then
    raise exception 'TEST_FAILED: create_sales_modular_offer_v3 missing';
  end if;

  if to_regprocedure(
    'public.confirm_sales_assisted_checkout_payment(uuid,uuid,text,text,text,text,text,text)'
  ) is null then
    raise exception 'TEST_FAILED: checkout payment reconciliation missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_offers'::regclass
      and conname = 'sales_offers_contract_email_check'
  ) then
    raise exception 'TEST_FAILED: contract email constraint missing';
  end if;
end
$test$;
