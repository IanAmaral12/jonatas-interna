-- Daily cash flow: received payments plus every automatic cost on the day it happens.
-- Order costs follow get_financial_workspace; monthly salaries and recurring costs are split per day;
-- the monthly tax is split among the month's paid orders and lands on each payment day.
drop function if exists public.get_cash_flow(date,date);
create function public.get_cash_flow(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_start > p_end or p_end - p_start > 366 then
    raise exception 'Invalid period: start must not exceed end and the range is limited to 366 days';
  end if;
  with states as (
    select orders.id, orders.seller_id, orders.valor, orders.nome_cliente, orders.status_pagamento,
      orders.product_units, orders.codigo_rastreio, orders.data_pagamento, orders.cancelado,
      (orders.data at time zone 'America/Sao_Paulo')::date created_day,
      snapshot.received_amount, snapshot.received_payment_status, snapshot.payment_platform, snapshot.external_commission,
      coalesce(snapshot.payment_fee,
        case when lower(btrim(snapshot.payment_platform))='pagamento interno' then 0::numeric end) payment_fee,
      coalesce(orders.data_pagamento,
        ((snapshot.field_versions->'received_amount'->>'at')::timestamptz at time zone 'America/Sao_Paulo')::date) receipt_day,
      private.financial_payment_status(coalesce(snapshot.payment_status,orders.status_pagamento)) payment,
      snapshot.payment_status is not null has_versioned_payment,
      lower(btrim(coalesce(snapshot.shipping_status,orders.status_rastreio))) shipping
    from public.orders orders
    left join public.order_financial_snapshots snapshot on snapshot.order_id=orders.id
    where orders.data is not null
  ), classified as (
    select states.*, date_trunc('month',created_day)::date created_month,
      coalesce(receipt_day,created_day) paid_day,
      coalesce(case when has_versioned_payment then payment='cancelado' else cancelado end,false)
        or coalesce(shipping='cancelado',false) cancelled,
      coalesce(payment in ('paid','partial'),false) recognized,
      case when payment=received_payment_status then received_amount end actual_received
    from states
  ), rated as (
    select classified.*, rate.commission_type, rate.commission_pct
    from classified left join lateral (
      select settings.commission_type, settings.commission_pct from public.seller_financial_settings settings
      where settings.seller_id=classified.seller_id and settings.effective_month<=classified.created_month
        and settings.commission_pct is not null
      order by settings.effective_month desc limit 1
    ) rate on true
  ), month_taxes as (
    select taxes.month_start, taxes.tax_paid/nullif(count(classified.id),0) per_order
    from public.financial_monthly_taxes taxes
    left join classified on classified.created_month=taxes.month_start and classified.recognized
    group by taxes.month_start, taxes.tax_paid
  ), days as (
    select day::date as day, date_trunc('month',day)::date month_start,
      extract(day from date_trunc('month',day)+interval '1 month'-interval '1 day')::numeric month_days
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') day
  ), lines(day,direction,source,category,seller_id,description,amount,quantity) as (
    select paid_day,'in','payment',null::text,seller_id,null::text,actual_received,1::numeric
      from classified where recognized and actual_received is not null
    union all select created_day,'out','shipping','logistica',seller_id,null,30.00,1 from classified where not cancelled
    union all select created_day,'out','production','producao',seller_id,null,product_units*6.90,product_units
      from classified where not cancelled and shipping is distinct from 'devolvido' and product_units is not null
    union all select created_day,'out','skale','financeiro',seller_id,null,0.50,1 from classified
    union all select paid_day,'out','payment_fee','financeiro',seller_id,null,payment_fee,1 from classified where payment_fee>0
    union all select paid_day,'out','external_commission','marketing',seller_id,null,external_commission,1
      from classified where recognized and external_commission>0
    union all select case when commission_type in ('paid_pct','fixed_per_paid') then paid_day else created_day end,
        'out','commission','pessoal',seller_id,null,
        case commission_type when 'paid_pct' then actual_received*commission_pct/100
          when 'fixed_per_paid' then commission_pct when 'fixed_per_shipped' then commission_pct
          else valor*commission_pct/100 end,1
      from rated where seller_id is not null and commission_pct is not null and case commission_type
        when 'paid_pct' then recognized and actual_received is not null when 'fixed_per_paid' then recognized
        when 'fixed_per_shipped' then not cancelled and codigo_rastreio is not null else not cancelled end
    union all select paid_day,'out','tax','impostos',seller_id,null,month_taxes.per_order,1
      from classified join month_taxes on month_taxes.month_start=classified.created_month where recognized
    -- Same traffic exclusions as get_financial_workspace; keep both lists in sync.
    union all select (insights.bucket_start at time zone 'America/Sao_Paulo')::date,'out','traffic','marketing',
        campaigns.seller_id,null,insights.spend_brl,null
      from public.meta_campaign_hourly_insights insights
      join public.meta_campaigns campaigns on campaigns.id=insights.campaign_id
      join public.meta_ad_accounts accounts on accounts.id=insights.ad_account_id
      where insights.bucket_start >= p_start::timestamp at time zone 'America/Sao_Paulo'
        and insights.bucket_start < (p_end+1)::timestamp at time zone 'America/Sao_Paulo'
        and insights.spend_brl is not null and accounts.account_id not in ('1392600858079467', '1266025311173661')
        and campaigns.id not in ('52598941009722', '52542462971990')
    union all select days.day,'out','salary','pessoal',settings.seller_id,null,settings.monthly_salary/days.month_days,null
      from days join public.seller_financial_settings settings
        on settings.effective_month=days.month_start and settings.monthly_salary>0
    union all select days.day,'out','recurring',recurring.category,null,recurring.description,recurring.amount/days.month_days,null
      from days join public.financial_recurring_costs recurring
        on recurring.start_month<=days.month_start and (recurring.end_month is null or recurring.end_month>=days.month_start)
    union all select cost_date,'out','expense',category,null,description,amount,1
      from public.financial_cost_entries where cost_date between p_start and p_end
  ), grouped as (
    select day,direction,source,category,seller_id,description,round(sum(amount),2) amount,sum(quantity) quantity
    from lines where day between p_start and p_end
    group by day,direction,source,category,seller_id,description
    having round(sum(amount),2) > 0
  ), payments as (
    select classified.id order_id, receipt_day paid_date, data_pagamento is null estimated_date, classified.seller_id,
      coalesce(sellers.name,'Não atribuído') seller_name, nome_cliente customer_name, payment_platform platform,
      status_pagamento payment_status, actual_received amount
    from classified left join public.sellers sellers on sellers.id=classified.seller_id
    where recognized and actual_received is not null and receipt_day between p_start and p_end
  )
  select jsonb_build_object(
    'start',to_char(p_start,'YYYY-MM-DD'),'end',to_char(p_end,'YYYY-MM-DD'),
    'payments',coalesce((select jsonb_agg(to_jsonb(payments) order by paid_date,order_id) from payments),'[]'::jsonb),
    'lines',coalesce((select jsonb_agg(to_jsonb(grouped) order by day,direction,source,seller_id,description) from grouped),'[]'::jsonb),
    'sellers',coalesce((select jsonb_agg(jsonb_build_object('seller_id',sellers.id,'name',sellers.name) order by sellers.name,sellers.id)
      from public.sellers sellers where sellers.id in (select seller_id from grouped)),'[]'::jsonb),
    'tax_pending_months',coalesce((select jsonb_agg(to_char(month_start,'YYYY-MM-DD') order by month_start)
      from (select distinct month_start from days) months
      where not exists (select 1 from public.financial_monthly_taxes taxes where taxes.month_start=months.month_start)),'[]'::jsonb),
    'rates',jsonb_build_object('production',6.90,'shipping',30.00,'skale',0.50)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_cash_flow(date,date) from public, anon;
grant execute on function public.get_cash_flow(date,date) to authenticated;
notify pgrst, 'reload schema';
