-- Match the other financial tables: only authenticated users may access recurring costs.
revoke all on public.financial_recurring_costs from public, anon;
