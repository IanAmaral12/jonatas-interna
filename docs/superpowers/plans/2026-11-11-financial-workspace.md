# Financial Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver separate Costs, Seller Ranking and Financial Dashboard screens with confirmed full/partial receipts, real payment fees, clear pending amounts and reconciled seller/consolidated results.

**Architecture:** Keep the monthly calculation in Postgres and add one current financial snapshot per order. A service-only snapshot RPC parses and merges both archived and live financial payloads; one authenticated JSON RPC supplies all three React screens. Reuse existing monthly seller remuneration, traffic associations, money parsing and break-even calculations.

**Tech Stack:** React, existing CSS and Supabase client, Postgres/pgmq, existing Deno orders-worker, Node tests with PGlite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-financial-workspace-design.md`; evidence in `2026-11-11-financial-workspace-research.md`.

## Global Constraints

- Month of order creation in America/Sao_Paulo; preserve the month across financial screens.
- Recognize actual full and partial payments; no full-price fallback for a partial payment with missing received amount.
- Manufacturing R$6.90/unit, freight R$30/noncancelled order, Skale R$0.50/every order. Apply cancellation/return rules from the spec.
- Salary is entered per seller/month; commission persists by effective month and applies to noncancelled scheduled revenue.
- Missing source fees remain pending. Never infer zero, estimate a rate or use zero producer earnings to calculate a payment fee.
- All authenticated users can manage financial settings and manual costs. Anonymous access and authenticated writes to per-order snapshots remain denied.
- Preserve the two existing untracked Wyllian files. Do not change the Wellington project. Frontend publication is outside the existing deployment target; backend deployment targets Interna only.

## Review Focus

- Out-of-order logistic notifications must not replace newer payment status or overwrite an explicit received amount with a price fallback.
- A partially paid order with no actual amount must not produce full revenue, profit or a ranking position.
- Missing fees on old paid orders must leave known cost visible and total profit/break-even pending.
- Taxes allocated to seller rows must not be charged twice in the consolidated result; taxes without paid orders must not vanish.
- Polling, saving another seller and moving between financial pages must preserve the selected month and an editor that is actively being used.

## File map and interfaces

- Task 1: generated migration ending `_order_financial_snapshots.sql`, `tests/orderFinancialSnapshotsDatabase.test.js`.
- Task 2: generated migration ending `_financial_workspace.sql`, `tests/financialWorkspaceDatabase.test.js`.
- Task 3: `supabase/functions/orders-worker/index.ts`.
- Task 4: `src/components/FinancialWorkspace.jsx`, `FinancialCostsPage.jsx`, `SellerFinancialRankingPage.jsx`, `FinancialDashboardPage.jsx`, shared `FinancialComponents.jsx`, `src/lib/financialWorkspace.js`, `tests/financialWorkspace.test.js`, `src/App.jsx`, `src/App.css`; remove the superseded `FinancialDrePage.jsx` after the new navigation uses the workspace.

Task 1 produces `public.order_financial_snapshots` with `order_id text` primary key/FK, nullable `payment_status text`, `shipping_status text`, `received_amount numeric(14,2)`, `received_amount_source text`, `payment_fee numeric(14,2)`, `external_commission numeric(14,2)`, `payment_platform text`, and required `source_updated_at timestamptz`, `source_message_id bigint`. Add field provenance columns when needed to satisfy ordering tests.

Task 1 also produces `public.record_order_financial_snapshot(p_order_id text, p_payload jsonb, p_message_id bigint, p_received_at timestamptz) returns void`, service-only. It consumes the original webhook payload, not its envelope. Parsing lives in SQL helpers reused by the backfill and live RPC, avoiding divergent JavaScript/SQL money rules. Prefer meaningful Skale payment status to transaction status and normalize partial variants. Use source updated_at (root, tracking, transaction) and supplied receipt timestamp as fallback, then message id as tie-break.

Task 1 exposes service-only `public.reconcile_order_financial_snapshots(p_after_message_id bigint default 0) returns bigint` for archive recovery. It never consumes messages. Deployment uses the full default-zero reconciliation after the old worker lease is idle, because late-archived retries may have IDs below an earlier watermark. Task 2 treats versioned snapshot payment/shipping states as authoritative and uses commercial fields only for missing snapshot states.

Task 2 produces `public.financial_monthly_taxes(month_start date primary key, tax_paid numeric(14,2))`, `public.financial_cost_entries(id uuid primary key, description text, amount numeric(14,2), cost_date date)`, timestamps as needed, and `public.get_financial_workspace(p_month date) returns jsonb`. The complete JSON field names and pending counts are defined in the spec. These names are the contract for Task 4; numeric values may arrive as JSON numbers or numeric strings.

Task 4 exposes `<FinancialWorkspace view="dashboard|ranking|costs" onViewChange={function} />`. Keep its selected month/editor context alive when financial navigation changes `view`. The data layer loads the shared RPC and refreshes after mutations and every minute without unmounting active editors. CRUD uses the authenticated existing seller settings table and the two new manual cost tables.

### Task 1: Preserve financial snapshots and recover history

- [ ] **Step 1: Write failing database tests** that apply the new migration to a minimal orders/pgmq fixture. Assert: cents 44700 and fee 2231 become R$447 and R$22.31; explicit `paid_amount=30000` beats `total_price=44700`; paid falls back to paid-event total only when actual amount is absent; partial missing actual amount stays null; explicit zero is distinct from null; invalid/negative/fractional cents stay unknown; producer/affiliate zero never implies a 100% fee.
- [ ] **Step 2: Run** `node --test tests/orderFinancialSnapshotsDatabase.test.js`; expect failure because the new table/RPC is missing.
- [ ] **Step 3: Generate** the migration with discovered Supabase CLI `migration new order_financial_snapshots`. Create the snapshot table, parsing/merge function and service-only privileges. Preserve known fields on missing data; reject older state/value regressions, use message-id tie-break and allow a known older fee to fill a missing fee without changing current status. Test that duplicate events never sum amounts.
- [ ] **Step 4: Add and verify** archive backfill using those same parsing/merge rules, restricted to existing order IDs and production messages. Tests cover paid then refunded, partial then paid, older events arriving last, returned then old moving, logistic null fields, malformed timestamps falling back safely and received-amount quality. Authenticated/anonymous roles cannot read snapshots or call writer/reconciler; service_role can.
- [ ] **Step 5: Run** the focused tests and `git diff --check`; expect pass. Commit only Task 1 files.

### Task 2: Calculate a reconciled monthly financial workspace

- [ ] **Step 1: Write failing database tests** for one month with 10 one-unit orders and R$10,000 eligible scheduled revenue: salary R$1,000, commission 8%=R$800, manufacturing R$69, freight R$300, traffic R$500, Skale R$5, acquired fees R$30, external commission R$20, allocated tax R$10. With R$3,000 received (including a partial), total cost is R$2,734 and profit R$266. A general expense R$40 gives consolidated profit R$226 without subtracting tax twice.
- [ ] **Step 2: Run** `node --test tests/financialWorkspaceDatabase.test.js`; expect missing workspace RPC/table failure.
- [ ] **Step 3: Generate** `financial_workspace` migration. Add validated tax/expense tables with authenticated CRUD policies/grants. Implement the JSON RPC using Task 1 snapshots, original orders, traffic and existing remuneration settings. Return the exact spec contract with known subtotals, nullable complete results, detailed pending counts, settings, expenses and tax.
- [ ] **Step 4: Add cases** for returned versus returning, exact cancellation versus cancellation-fee statuses, all-order Skale, original month updated by late payments, monthly salary and commission history, inactive salary-only sellers, unassigned orders/traffic, and the existing ad exclusions. Assert snapshot states override regressed commercial fields; paid/partial amount gaps and missing acquired fees block profit/break-even while keeping known per-order component subtotals visible.
- [ ] **Step 5: Add tax/access checks**: R$100.01 with paid-count weights 2:1 allocates R$66.67/R$33.34; no paid orders leaves tax in unallocated general cost; anonymous access is denied and authenticated CRUD is validated. Seller settings include active sellers without activity, but such sellers do not enter ranking until they have activity or entered salary.
- [ ] **Precision gate:** converted traffic 500.005 must become R$500.01 in the seller component before adding costs and consolidating; profit/cost comparisons must close in cents. If found after initial deployment, use a generated follow-up migration rather than silently rewriting applied history.
- [ ] **Step 6: Run** focused database tests and `git diff --check`; expect pass. Commit Task 2 files.

### Task 3: Feed live events into the snapshot writer

- [ ] **Step 1: Inspect** the orders-worker common success path and queue envelope; use `queueMessage.msg_id` and the envelope `received_at`/queue `enqueued_at` as fallback receipt time.
- [ ] **Step 2: Add** the service-only snapshot call after successful order creation/update, including duplicate creates, and before archiving. Pass the matching order ID and original payload. An RPC error leaves the message available for retry using the existing error path.
- [ ] **Step 3: Verify** source/types/imports and all snapshot idempotency tests; use deployment compilation as the Deno gate if no local Deno runtime exists. Commit the worker change separately.

### Task 4: Build the three financial screens

- [ ] **Step 1: Add a focused test** for `sortSellerRanking(rows)` in `src/lib/financialWorkspace.js`: descending real profit, deterministic name tie-break, negative profit retained, pending sellers outside numbered ranking and no mutation of API rows. Run and confirm failure.
- [ ] **Step 2: Build** the shared workspace/query state and UI pieces using the Task 2 JSON contract and existing money parser/bars. Preserve the month across view navigation and refresh monetary data without discarding in-progress edits.
- [ ] **Step 3: Build Costs** with a clear per-seller salary/commission editor and one save, monthly tax and general-expense statement/CRUD, automatic cost labels and exact pending reasons. Retain commission values/history on salary-only saves and allow explicit zero. Confirm destructive entry deletion in the UI.
- [ ] **Step 4: Build Ranking** with confirmed-profit order, pending group, financial values and shared-scale cost/receipt bars. Show covered percentage, remaining BRL and Se pagou/excess; provide a direct seller/month link to editable missing configuration. Source fee gaps explain why source data is pending.
- [ ] **Step 5: Build Dashboard** with known/complete labels, profit/margin, cost composition and seller/unassigned/general reconciliation. Replace the one DRE navigation item with the three financial destinations and remove superseded UI code.
- [ ] **Step 6: Run** focused UI logic tests, lint and build. Inspect desktop/mobile and keyboard paths using a temporary mocked RPC preview. Check salary-only save, unchanged rate, partial data, mutation failure and monthly refresh without using live client financial writes. Commit only frontend files.

### Task 5: Review, deploy backend and verify

- [ ] **Step 1: Run** `node --test --test-concurrency=1 tests/*.test.js`, `npm run lint`, `npm run build`, `git diff --check`. Use one test process at a time to avoid the known concurrent PGlite memory pressure.
- [ ] **Step 2: Request** a whole-branch review against the spec, financial scenarios and API contract. Resolve material findings and rerun only affected checks.
- [ ] **Step 3: Compare** migration history and existing deployed orders-worker against local source. Run security/performance advisors and capture the current maximum archived message ID for the audit. Apply only the new reviewed Interna migrations and deploy the worker with its existing JWT mode and required files; preserve migration version alignment. Confirm the previous worker lease is idle, then run full `reconcile_order_financial_snapshots()` after deployment to recover old retries too. Do not use only the captured watermark for this final recovery.
- [ ] **Step 4: Query** production read-only to reconcile all-order Skale, eligible freight/manufacturing, actual full/partial receipts, pending-fee counts, known cost totals, tax allocation and consolidated result. Do not insert client salary, tax or expense amounts without actual client data. Check role privileges and active worker version.
- [ ] **Step 5: Integrate** the verified branch into the local repository, preserving existing untracked files. Report tests, backend deployment, financial data limitations and the local frontend publication status.
