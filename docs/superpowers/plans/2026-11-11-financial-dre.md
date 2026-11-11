# Financial DRE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly financial DRE with seller salary, commission, order costs, paid revenue, and dynamic break-even bars.

**Architecture:** Store each order's unit count when it enters the existing worker and recover historical counts from archived payloads. Store monthly salary and effective-dated commission settings in one table; a Postgres RPC aggregates a month using the existing seller and advertising mappings. A dedicated React page reads the RPC and edits settings.

**Tech Stack:** PostgreSQL 17/Supabase, Deno Edge Function, React 19/Vite, Node test runner, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-10-financial-dre-design.md`

## Global Constraints

- Month boundaries use `America/Sao_Paulo`; monetary amounts are BRL with two decimal places.
- Manufacturing costs R$ 6.90 per product unit; shipping costs R$ 30.00 per non-cancelled order.
- Confirmed revenue uses only non-cancelled orders whose normalized current `status_pagamento` is exactly `pago`, assigned to their creation month.
- Commission is a seller-specific percentage of scheduled revenue and remains effective until changed; salary is entered separately for each seller and month.
- Financial data is accessible to authenticated users only; keep RLS enabled and do not expose webhook archives or service keys.
- Match the existing advertising exclusions: account `1392600858079467` and campaign `52598941009722`.
- Keep existing untracked migration and test files untouched. Do not add dependencies or mix manual cash-flow entries into the DRE.

## Review Focus

- A late `Pago` event increases the order's original month's confirmed revenue; test the creation-month filter and status transition.
- `Pago Parcial`, `Chargeback`, `After Pay`, and a paid date without `Pago` add no confirmed revenue; test each status.
- Two products or multiple units in one order incur one freight charge and one manufacturing charge per unit; test order aggregation.
- Salary entered for a seller without activity still appears; activity with missing salary/commission or unit count makes break-even unavailable, not zero; test both.
- Unassigned orders and ads reconcile to the general total, while excluded ad accounts/campaigns never enter cost; test all three cases.

---

## File map

- `supabase/migrations/<generated>_add_order_product_units.sql`: column and archive backfill.
- `supabase/functions/orders-worker/order-units.js`: pure quantity parser.
- `supabase/functions/orders-worker/index.ts`: write unit count on creation.
- `tests/orderProductUnits.test.js`: parser cases.
- `tests/orderProductUnitsDatabase.test.js`: archive backfill and constraints.
- `supabase/migrations/<generated>_create_financial_dre.sql`: settings table, RLS, aggregation RPC.
- `tests/financialDreDatabase.test.js`: financial formula, effective rates, completeness, access, and reconciliation.
- `src/components/FinancialDrePage.jsx`: month selection, settings editor, DRE rows and bars.
- `src/lib/financialDreBars.js`: equal-scale bar widths and break-even labels.
- `tests/financialDreBars.test.js`: bar calculations and incomplete states.
- `src/App.jsx`: navigation entry and page mount.
- `src/App.css`: page styles and accessible bar presentation.

### Task 1: Preserve order unit counts

**Interfaces:**
- Produces `sumProductUnits(products: unknown): number | null` in `order-units.js` and nullable `public.orders.product_units integer`.
- New orders write `product_units`; updates preserve the original quantity.

- [ ] **Step 1: Write failing tests** in `tests/orderProductUnits.test.js` for `[{quantity:2},{quantity:3}] → 5`, malformed/missing quantities → `null`, empty array → `null`, and a single item → its quantity. In `tests/orderProductUnitsDatabase.test.js`, build minimal `orders` and `pgmq.a_orders_ingest` fixtures for a creation event, an order with only a later event, and a row without valid units; assert backfilled counts and the positive-unit constraint.
- [ ] **Step 2: Run** `node --test tests/orderProductUnits*.test.js`; expect failures for the missing parser, column, or migration.
- [ ] **Step 3: Use** `supabase migration new add_order_product_units` to create the migration. Add the nullable column and backfill from archived `product.products`, preferring `order_created`, then the earliest other event. Accept only nonempty arrays of positive integer quantities; leave unknown counts null. Implement the parser and write `product_units` during `order_created` in `index.ts`.
- [ ] **Step 4: Run** `node --test tests/orderProductUnits*.test.js`; expect all tests to pass. Run `npm run lint`; expect exit 0.
- [ ] **Step 5: Commit** only the Task 1 files with `feat: preserve order product quantities`.

### Task 2: Financial settings and DRE query

**Interfaces:**
- Consumes `orders.product_units` from Task 1.
- Produces `public.seller_financial_settings(seller_id, effective_month, monthly_salary, commission_pct)` with one row per seller/month and `public.get_financial_dre(p_month date)` returning `row_type`, `seller_id`, `seller_name`, `order_count`, `product_units`, `scheduled_revenue`, `confirmed_revenue`, `salary_cost`, `commission_pct`, `commission_cost`, `production_cost`, `shipping_cost`, `traffic_cost`, `total_cost`, `confirmed_balance`, `remaining_to_break_even`, `surplus`, `configuration_pending`, and `units_pending`.

- [ ] **Step 1: Write failing PGlite tests** in `tests/financialDreDatabase.test.js`: October fixture with 10 orders, 10 units, R$ 10,000 scheduled, R$ 500 traffic, R$ 1,000 salary, and 8% commission must yield R$ 69 manufacturing, R$ 300 freight, R$ 2,669 total cost; `Pago` rows alone raise confirmed revenue. Test later payments, monthly salary without activity, commission retained then changed by month, missing settings/units, unassigned rows, ad exclusions, bad values, and anonymous access.
- [ ] **Step 2: Run** `node --test tests/financialDreDatabase.test.js`; expect failure because the migration/RPC does not exist.
- [ ] **Step 3: Use** `supabase migration new create_financial_dre` to create one migration. Create the settings table with month-first-day, salary nonnegative, commission 0–100, at least one setting, primary key `(seller_id,effective_month)`, and RLS grants/policies for authenticated users. Implement `get_financial_dre(date)` as a stable, authenticated-only, server-side aggregate; use exact-month salary and latest commission with effective month at or before the selected month. Include seller rows with activity or salary, one unassigned row, and a general row. Return null totals and explicit flags for incomplete input. Validate month input.
- [ ] **Step 4: Run** `node --test tests/financialDreDatabase.test.js` and `npm test`; expect pass. Run Supabase security/performance advisors and inspect relevant findings before remote migration.
- [ ] **Step 5: Commit** only the Task 2 files with `feat: calculate monthly financial DRE`.

### Task 3: Financial page and break-even bars

**Interfaces:**
- Consumes the Task 2 table and `get_financial_dre({p_month: 'YYYY-MM-01'})` RPC.
- Produces a `FinancialDrePage` mounted from `AuthenticatedView`.

- [ ] **Step 1: Add a failing test** in `tests/financialDreBars.test.js` for `calculateBreakEvenBars(totalCost, confirmedRevenue)` from `src/lib/financialDreBars.js`. Assert equal-scale widths for cost/paid, zero cost, incomplete data, and remaining/surplus amounts.
- [ ] **Step 2: Run** the focused test; expect failure before the helper/page exists.
- [ ] **Step 3: Build** `FinancialDrePage.jsx` with a month picker, per-seller salary and commission inputs, effective month selection, save errors, a consolidated financial table, and the two accessible bars per seller. Show pending inputs without fake totals. Reload the RPC after saves and every 60 seconds while visible. Add the navigation button in `App.jsx` and styles in `App.css`; preserve the existing mobile layout and focus behavior.
- [ ] **Step 4: Run** the focused test, `npm test`, `npm run lint`, and `npm run build`; expect all to pass. Inspect the rendered page at desktop/mobile widths and keyboard focus.
- [ ] **Step 5: Commit** only the Task 3 files with `feat: show financial DRE and seller break-even`.

### Task 4: Apply and verify on Interna

**Interfaces:**
- Uses Supabase project `biyzmqfpxeqkittmnxpu` in organization `Jonatas`.
- No new app interface.

- [ ] **Step 1: Compare** local migrations against remote migration history and confirm there is no drift or unrelated pending migration; expect only the two new DRE migrations to be deployed.
- [ ] **Step 2: Apply** the two reviewed migrations in order through Supabase MCP, then deploy the updated `orders-worker` Edge Function with its existing JWT setting and all required local files. Keep webhook behavior unchanged.
- [ ] **Step 3: Query** the remote project read-only: all current orders have positive `product_units`; `get_financial_dre('2026-10-01')` returns rows without execution errors; paid revenue excludes non-`Pago`; aggregate components reconcile. Do not create salary/commission records without client-provided amounts.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run build`, and `git status --short`; report results, deployment status, and any remaining configuration needed from the client.
