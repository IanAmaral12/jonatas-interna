create or replace function public.get_financial_workspace(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_month is null or p_month <> date_trunc('month',p_month::timestamp)::date then
    raise exception 'Month must be the first day of a month';
  end if;
  with bounds as (
    select p_month::timestamp at time zone 'America/Sao_Paulo' starts_at,
      (p_month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo' ends_at
  ), states as (
    select orders.*,
      private.financial_payment_status(coalesce(snapshot.payment_status,orders.status_pagamento)) payment,
      snapshot.payment_status is not null has_versioned_payment,
      lower(btrim(coalesce(snapshot.shipping_status,orders.status_rastreio))) shipping,
      snapshot.received_amount, snapshot.received_payment_status,
      snapshot.payment_fee, snapshot.external_commission,
      coalesce(snapshot.has_payment_evidence,false) has_payment_evidence
    from public.orders orders cross join bounds
    left join public.order_financial_snapshots snapshot on snapshot.order_id=orders.id
    where orders.data >= bounds.starts_at and orders.data < bounds.ends_at
  ), classified as (
    select states.*,
      coalesce(case when has_versioned_payment then payment='cancelado' else cancelado end,false)
        or coalesce(shipping='cancelado',false) cancelled,
      coalesce(payment in ('paid','partial'),false) recognized,
      case when payment=received_payment_status then received_amount end actual_received
    from states
  ), orders_by_seller as (
    select seller_id, count(*) order_count,
      coalesce(sum(product_units),0) product_units,
      coalesce(sum(valor),0) scheduled_revenue,
      coalesce(sum(valor) filter (where not cancelled),0) commission_base_revenue,
      count(*) filter (where not cancelled) eligible_orders,
      count(*) filter (where recognized) paid_count,
      coalesce(sum(actual_received) filter (where recognized),0) known_received_revenue,
      coalesce(sum(product_units) filter (where not cancelled and shipping is distinct from 'devolvido'),0)*6.90 production_cost,
      count(*) filter (where not cancelled and shipping is distinct from 'devolvido' and product_units is null) missing_units,
      coalesce(sum(payment_fee),0) payment_fee_cost,
      coalesce(sum(external_commission) filter (where recognized),0) external_commission_cost,
      count(*) filter (where recognized and actual_received is null) missing_received,
      count(*) filter (where (recognized or has_payment_evidence or payment in ('chargeback','estornado','reembolsado','refunded')) and payment_fee is null) missing_fee,
      count(*) filter (where recognized and external_commission is null) missing_external
    from classified group by seller_id
  ), spend_by_seller as (
    select campaigns.seller_id, round(coalesce(sum(insights.spend_brl),0),2) traffic_cost
    from public.meta_campaign_hourly_insights insights
    join public.meta_campaigns campaigns on campaigns.id=insights.campaign_id
    join public.meta_ad_accounts accounts on accounts.id=insights.ad_account_id
    cross join bounds
    where insights.bucket_start>=bounds.starts_at and insights.bucket_start<bounds.ends_at
      and insights.spend_brl is not null and accounts.account_id<>'1392600858079467'
      and campaigns.id<>'52598941009722'
    group by campaigns.seller_id
  ), keys as (
    select seller_id from orders_by_seller union select seller_id from spend_by_seller
    union select seller_id from public.seller_financial_settings where effective_month=p_month and monthly_salary is not null
  ), settings as (
    select sellers.id seller_id,sellers.name seller_name, exact.monthly_salary,
      rate.commission_pct,rate.effective_month commission_effective_month,
      exact.commission_pct month_commission_pct
    from public.sellers sellers
    left join public.seller_financial_settings exact on exact.seller_id=sellers.id and exact.effective_month=p_month
    left join lateral (
      select financial.commission_pct,financial.effective_month from public.seller_financial_settings financial
      where financial.seller_id=sellers.id and financial.effective_month<=p_month and financial.commission_pct is not null
      order by financial.effective_month desc limit 1
    ) rate on true
    where sellers.active or sellers.id in (select seller_id from keys)
  ), base as (
    select case when keys.seller_id is null then 'unassigned' else 'seller' end row_type,
      keys.seller_id,coalesce(settings.seller_name,'Não atribuído') seller_name,
      coalesce(orders.order_count,0) order_count,coalesce(orders.product_units,0) product_units,
      coalesce(orders.scheduled_revenue,0) scheduled_revenue,
      coalesce(orders.commission_base_revenue,0) commission_base_revenue,
      coalesce(orders.known_received_revenue,0) known_received_revenue,
      case when keys.seller_id is null then 0 else settings.monthly_salary end salary_cost,
      settings.commission_pct,
      case when keys.seller_id is not null and orders.commission_base_revenue>0 and settings.commission_pct is null then null
        else round(coalesce(orders.commission_base_revenue,0)*coalesce(settings.commission_pct,0)/100,2) end commission_cost,
      coalesce(orders.production_cost,0) production_cost,coalesce(orders.eligible_orders,0)*30.00 shipping_cost,
      coalesce(spend.traffic_cost,0) traffic_cost,coalesce(orders.order_count,0)*0.50 skale_cost,
      coalesce(orders.payment_fee_cost,0) payment_fee_cost,
      coalesce(orders.external_commission_cost,0) external_commission_cost,
      coalesce(orders.paid_count,0) paid_count,
      case when keys.seller_id is not null and settings.monthly_salary is null then 1 else 0 end missing_salary,
      case when keys.seller_id is not null and orders.commission_base_revenue>0 and settings.commission_pct is null then 1 else 0 end missing_commission,
      coalesce(orders.missing_units,0) missing_units,coalesce(orders.missing_fee,0) missing_fee,
      coalesce(orders.missing_received,0) missing_received,coalesce(orders.missing_external,0) missing_external
    from keys left join settings on settings.seller_id=keys.seller_id
    left join orders_by_seller orders on orders.seller_id is not distinct from keys.seller_id
    left join spend_by_seller spend on spend.seller_id is not distinct from keys.seller_id
  ), tax_value as (
    select coalesce((select tax_paid from public.financial_monthly_taxes where month_start=p_month),0) tax_paid,
      exists(select 1 from public.financial_monthly_taxes where month_start=p_month) tax_recorded
  ), tax_weights as (
    select base.*, coalesce(tax_value.tax_paid*100*paid_count/nullif(sum(paid_count) over (),0),0) tax_cents
    from base cross join tax_value
  ), tax_allocations as (
    select tax_weights.*,
      (floor(tax_cents)+case when paid_count>0 and row_number() over (
        order by tax_cents-floor(tax_cents) desc,coalesce(seller_id::text,'')
      ) <= (select tax_paid*100 from tax_value)-sum(floor(tax_cents)) over () then 1 else 0 end)/100 allocated_tax
    from tax_weights
  ), costs as (
    select tax_allocations.*,
      coalesce(salary_cost,0)+coalesce(commission_cost,0)+production_cost+shipping_cost+traffic_cost+
        skale_cost+payment_fee_cost+external_commission_cost+allocated_tax known_cost,
      missing_salary+missing_commission+missing_units+missing_fee+missing_external cost_gaps,
      jsonb_build_object('salary',missing_salary,'commission',missing_commission,'units',missing_units,
        'payment_fee',missing_fee,'received_amount',missing_received,'external_commission',missing_external) pending
    from tax_allocations
  ), row_values as (
    select costs.*,case when cost_gaps=0 then known_cost end total_cost,
      case when missing_received=0 then known_received_revenue end confirmed_revenue
    from costs
  ), summary_base as (
    select 'summary'::text row_type,null::uuid seller_id,'Consolidado'::text seller_name,
      coalesce(sum(order_count),0) order_count,coalesce(sum(product_units),0) product_units,
      coalesce(sum(scheduled_revenue),0) scheduled_revenue,coalesce(sum(commission_base_revenue),0) commission_base_revenue,
      coalesce(sum(known_received_revenue),0) known_received_revenue,
      coalesce(sum(salary_cost),0) salary_cost,null::numeric commission_pct,
      coalesce(sum(commission_cost),0) commission_cost,coalesce(sum(production_cost),0) production_cost,
      coalesce(sum(shipping_cost),0) shipping_cost,coalesce(sum(traffic_cost),0) traffic_cost,
      coalesce(sum(skale_cost),0) skale_cost,coalesce(sum(payment_fee_cost),0) payment_fee_cost,
      coalesce(sum(external_commission_cost),0) external_commission_cost,coalesce(sum(allocated_tax),0) allocated_tax,
      coalesce(sum(known_cost),0) known_cost,coalesce(sum(cost_gaps),0) cost_gaps,
      coalesce(sum(missing_received),0) missing_received,coalesce(sum(paid_count),0) paid_count,
      jsonb_build_object('salary',coalesce(sum(missing_salary),0),'commission',coalesce(sum(missing_commission),0),
        'units',coalesce(sum(missing_units),0),'payment_fee',coalesce(sum(missing_fee),0),
        'received_amount',coalesce(sum(missing_received),0),'external_commission',coalesce(sum(missing_external),0)) pending
    from costs
  ), general as (
    select coalesce((select sum(amount) from public.financial_cost_entries
      where cost_date>=p_month and cost_date<p_month+interval '1 month'),0) general_expenses,
      case when summary_base.paid_count=0 then tax_value.tax_paid else 0 end unallocated_tax,
      tax_value.tax_recorded from summary_base cross join tax_value
  ), all_values as (
    select row_type,seller_id,seller_name,order_count,product_units,scheduled_revenue,commission_base_revenue,
      known_received_revenue,confirmed_revenue,salary_cost,commission_pct,commission_cost,production_cost,
      shipping_cost,traffic_cost,skale_cost,payment_fee_cost,external_commission_cost,allocated_tax,known_cost,total_cost,pending
    from row_values
    union all
    select row_type,seller_id,seller_name,order_count,product_units,scheduled_revenue,commission_base_revenue,
      known_received_revenue,case when missing_received=0 then known_received_revenue end,salary_cost,commission_pct,
      commission_cost,production_cost,shipping_cost,traffic_cost,skale_cost,payment_fee_cost,external_commission_cost,
      allocated_tax,known_cost+general_expenses+unallocated_tax,
      case when cost_gaps=0 then known_cost+general_expenses+unallocated_tax end,pending
    from summary_base cross join general
  ), calculated as (
    select all_values.*,(confirmed_revenue-total_cost) confirmed_profit,
      round((confirmed_revenue-total_cost)/nullif(confirmed_revenue,0)*100,2) margin_pct,
      case when confirmed_revenue is not null and total_cost is not null then greatest(total_cost-confirmed_revenue,0) end remaining_to_break_even,
      case when confirmed_revenue is not null and total_cost is not null then greatest(confirmed_revenue-total_cost,0) end surplus
    from all_values
  )
  select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM-DD'),
    'summary',(select to_jsonb(calculated)||to_jsonb(general) from calculated cross join general where row_type='summary'),
    'rows',coalesce((select jsonb_agg(to_jsonb(calculated) order by row_type,seller_name,seller_id) from calculated where row_type<>'summary'),'[]'::jsonb),
    'seller_settings',coalesce((select jsonb_agg(to_jsonb(settings) order by seller_name,seller_id) from settings),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(entries) order by cost_date,id) from public.financial_cost_entries entries
      where cost_date>=p_month and cost_date<p_month+interval '1 month'),'[]'::jsonb),
    'tax',(select to_jsonb(taxes) from public.financial_monthly_taxes taxes where month_start=p_month),
    'rates',jsonb_build_object('production',6.90,'shipping',30.00,'skale',0.50)
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_financial_workspace(date) from public, anon;
grant execute on function public.get_financial_workspace(date) to authenticated;
notify pgrst, 'reload schema';
