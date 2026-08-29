import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  timezone_offset_hours_utc?: number;
  account_status?: number;
}

interface MetaInsight extends JsonObject {
  campaign_id?: string;
  campaign_name?: string;
  account_currency?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: MetaAction[];
  date_start?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

interface MetaAction {
  action_type?: string;
  value?: string;
}

interface MetaPage<T> {
  data?: T[];
  paging?: { next?: string };
  error?: {
    message?: string;
    code?: number;
    is_transient?: boolean;
  };
}

interface TokenSlot {
  slot: 1 | 2;
  token: string;
}

interface DiscoveredAccount {
  account: MetaAdAccount;
  tokenSlot: TokenSlot;
}

interface AccountBinding {
  accountId: string;
  tokenSlot: 1 | 2;
}

interface ExchangeRate {
  date: string;
  base: "USD";
  quote: "BRL";
  rate: number;
  source: "api" | "database";
  rawPayload: JsonObject;
}

const GRAPH_VERSION = "v26.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const EXCHANGE_RATE_URL = "https://api.frankfurter.dev/v2/rate/USD/BRL";
const MESSAGING_CONVERSATION_ACTION =
  "onsite_conversion.messaging_conversation_started_7d";
const MAX_BACKFILL_DAYS = 31;
const ACCOUNT_BINDINGS: AccountBinding[] = [
  { accountId: "1010965721683924", tokenSlot: 1 },
  { accountId: "917116774558155", tokenSlot: 1 },
  { accountId: "3653228731512122", tokenSlot: 2 },
  { accountId: "1504340270635097", tokenSlot: 2 },
  { accountId: "1161460945974128", tokenSlot: 2 },
  { accountId: "1266025311173661", tokenSlot: 2 },
  { accountId: "1392600858079467", tokenSlot: 2 },
];
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safeEqual(received: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);
  if (receivedBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < receivedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messagingConversations(actions: MetaAction[] | undefined): number {
  return Math.trunc((actions ?? []).reduce((total, action) => {
    if (action.action_type !== MESSAGING_CONVERSATION_ACTION) return total;
    return total + numeric(action.value);
  }, 0));
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (start > end) throw new Error("A data inicial do backfill deve ser anterior à data final.");

  const dates: string[] = [];
  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
    if (dates.length > MAX_BACKFILL_DAYS) {
      throw new Error(`O backfill aceita no máximo ${MAX_BACKFILL_DAYS} dias por execução.`);
    }
  }
  return dates;
}

function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function fetchMeta<T>(url: URL | string, token: string): Promise<MetaPage<T>> {
  let lastError = "A Meta não respondeu à solicitação.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json() as MetaPage<T>;
    if (response.ok && !payload.error) return payload;

    lastError = payload.error?.message || `Erro HTTP ${response.status} na API da Meta.`;
    const retryable = response.status === 429 || response.status >= 500 || payload.error?.is_transient;
    if (!retryable || attempt === 2) {
      throw new Error(`${lastError} (código ${payload.error?.code ?? response.status})`);
    }
    await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
  }

  throw new Error(lastError);
}

async function fetchAllPages<T>(initialUrl: URL, token: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: URL | string | undefined = initialUrl;
  let pageCount = 0;

  while (nextUrl) {
    pageCount += 1;
    if (pageCount > 100) throw new Error("A paginação da Meta ultrapassou 100 páginas.");
    const page: MetaPage<T> = await fetchMeta<T>(nextUrl, token);
    results.push(...(page.data ?? []));
    nextUrl = page.paging?.next;
  }

  return results;
}

async function fetchMetaObject<T extends JsonObject>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json() as T & MetaPage<never>;
  if (!response.ok || payload.error) {
    throw new Error(
      `${payload.error?.message || `Erro HTTP ${response.status} na API da Meta.`} ` +
        `(código ${payload.error?.code ?? response.status})`,
    );
  }
  return payload;
}

async function loadConfiguredAccount(
  binding: AccountBinding,
  tokenSlots: TokenSlot[],
): Promise<DiscoveredAccount> {
  const tokenSlot = tokenSlots.find((item) => item.slot === binding.tokenSlot);
  if (!tokenSlot) throw new Error(`Token ${binding.tokenSlot} não configurado.`);

  const url = new URL(`${GRAPH_URL}/act_${binding.accountId}`);
  url.searchParams.set(
    "fields",
    "id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status",
  );
  const account = await fetchMetaObject<MetaAdAccount & JsonObject>(url, tokenSlot.token);
  return { account, tokenSlot };
}

async function loadExchangeRate(
  supabase: SupabaseClient,
  targetDate?: string,
): Promise<ExchangeRate> {
  try {
    const url = new URL(EXCHANGE_RATE_URL);
    url.searchParams.set("providers", "BCB");
    if (targetDate) url.searchParams.set("date", targetDate);

    const response = await fetch(url);
    const payload = await response.json() as JsonObject;
    const rate = numeric(payload.rate);
    const date = typeof payload.date === "string" ? payload.date : "";
    if (!response.ok || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("A resposta da cotação USD/BRL é inválida.");
    }

    const exchangeRate: ExchangeRate = {
      date,
      base: "USD",
      quote: "BRL",
      rate,
      source: "api",
      rawPayload: payload,
    };
    const { error } = await supabase.from("meta_exchange_rates").upsert({
      rate_date: date,
      base_currency: "USD",
      quote_currency: "BRL",
      rate,
      provider: "BCB",
      source: "Frankfurter v2",
      fetched_at: new Date().toISOString(),
      raw_payload: payload,
    }, { onConflict: "rate_date" });
    if (error) throw new Error(error.message);
    return exchangeRate;
  } catch (rateError) {
    console.error(
      "Falha ao consultar cotação; tentando último valor persistido:",
      rateError instanceof Error ? rateError.message : rateError,
    );
    let fallbackQuery = supabase
      .from("meta_exchange_rates")
      .select("rate_date,rate,raw_payload")
      .order("rate_date", { ascending: false });
    if (targetDate) fallbackQuery = fallbackQuery.lte("rate_date", targetDate);

    const { data, error } = await fallbackQuery.limit(1).maybeSingle();
    if (error || !data) throw new Error("Nenhuma cotação USD/BRL está disponível.");
    return {
      date: data.rate_date,
      base: "USD",
      quote: "BRL",
      rate: Number(data.rate),
      source: "database",
      rawPayload: data.raw_payload as JsonObject,
    };
  }
}

async function fetchAccountInsights(
  discovered: DiscoveredAccount,
  exchangeRate: ExchangeRate,
  metricDate = dateInTimezone(new Date(), discovered.account.timezone_name),
): Promise<{ metricDate: string; rows: JsonObject[] }> {
  const { account, tokenSlot } = discovered;
  const url = new URL(`${GRAPH_URL}/${account.id}/insights`);
  url.searchParams.set("level", "campaign");
  url.searchParams.set(
    "fields",
    [
      "account_id",
      "account_name",
      "campaign_id",
      "campaign_name",
      "account_currency",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "inline_link_clicks",
      "cpc",
      "cpm",
      "ctr",
    ].join(","),
  );
  url.searchParams.set("time_range", JSON.stringify({ since: metricDate, until: metricDate }));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("breakdowns", "hourly_stats_aggregated_by_advertiser_time_zone");
  url.searchParams.set("limit", "500");

  const insights = await fetchAllPages<MetaInsight>(url, tokenSlot.token);
  const rows = insights.flatMap((insight) => {
    const hourBucket = insight.hourly_stats_aggregated_by_advertiser_time_zone;
    const hourMatch = hourBucket?.match(/^(\d{2}):/);
    if (!insight.campaign_id || !insight.campaign_name || !hourBucket || !hourMatch) return [];

    const spend = numeric(insight.spend);
    return [{
      campaign_id: insight.campaign_id,
      campaign_name: insight.campaign_name,
      hour_start: Number(hourMatch[1]),
      hour_bucket: hourBucket,
      spend,
      spend_usd: account.currency === "USD" ? spend : spend / exchangeRate.rate,
      spend_brl: account.currency === "BRL" ? spend : spend * exchangeRate.rate,
      exchange_rate_usd_brl: exchangeRate.rate,
      exchange_rate_date: exchangeRate.date,
      impressions: Math.trunc(numeric(insight.impressions)),
      reach: Math.trunc(numeric(insight.reach)),
      clicks: Math.trunc(numeric(insight.clicks)),
      inline_link_clicks: Math.trunc(numeric(insight.inline_link_clicks)),
      cpc: nullableNumeric(insight.cpc),
      cpm: nullableNumeric(insight.cpm),
      ctr: nullableNumeric(insight.ctr),
      raw_payload: insight,
    }];
  });

  return { metricDate, rows };
}

async function fetchAccountMessagingActions(
  discovered: DiscoveredAccount,
  metricDate: string,
): Promise<JsonObject[]> {
  const { account, tokenSlot } = discovered;
  const url = new URL(`${GRAPH_URL}/${account.id}/insights`);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("fields", "campaign_id,campaign_name,spend,actions");
  url.searchParams.set("time_range", JSON.stringify({ since: metricDate, until: metricDate }));
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("limit", "500");

  const insights = await fetchAllPages<MetaInsight>(url, tokenSlot.token);
  return insights.flatMap((insight) => {
    if (!insight.campaign_id || !insight.campaign_name) return [];
    return [{
      campaign_id: insight.campaign_id,
      campaign_name: insight.campaign_name,
      messaging_conversations_started: messagingConversations(insight.actions),
      raw_payload: insight,
    }];
  });
}

async function releaseLease(supabase: SupabaseClient, runId: string): Promise<void> {
  const { error } = await supabase.rpc("release_meta_ads_worker", { requested_owner: runId });
  if (error) console.error("Falha ao liberar lease da Meta:", error.message);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("META_ADS_WORKER_SECRET");
  const token1 = Deno.env.get("META_ACCESS_TOKEN_1");
  const token2 = Deno.env.get("META_ACCESS_TOKEN_2");

  if (!supabaseUrl || !serviceRoleKey || !workerSecret) {
    return jsonResponse({ error: "Configuração interna da sincronização incompleta." }, 500);
  }
  if (!safeEqual(request.headers.get("x-worker-secret") ?? "", workerSecret)) {
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  let mode: "sync" | "configure" | "backfill" | "historical_backfill" = "sync";
  let requestedDates: string[] = [];
  let requestedAccountIds: string[] = [];
  try {
    const body = await request.json();
    if (body?.mode === "configure") mode = "configure";
    if (body?.mode === "backfill" || body?.mode === "historical_backfill") {
      if (!isIsoDate(body.start_date) || !isIsoDate(body.end_date)) {
        return jsonResponse({
          error: "Informe start_date e end_date no formato YYYY-MM-DD para executar o backfill.",
        }, 400);
      }
      mode = body.mode;
      requestedDates = dateRange(body.start_date, body.end_date);

      if (mode === "historical_backfill") {
        if (!Array.isArray(body.account_ids) || body.account_ids.length === 0) {
          return jsonResponse({
            error: "Informe ao menos uma conta em account_ids para o backfill histórico.",
          }, 400);
        }
        requestedAccountIds = [...new Set(body.account_ids.map(String))];
        const unknownAccounts = requestedAccountIds.filter(
          (accountId) => !ACCOUNT_BINDINGS.some((binding) => binding.accountId === accountId),
        );
        if (unknownAccounts.length > 0) {
          return jsonResponse({
            error: "O backfill histórico recebeu contas que não estão configuradas.",
            unknown_accounts: unknownAccounts,
          }, 400);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && request.headers.get("content-type")?.includes("application/json")) {
      return jsonResponse({ error: error.message }, 400);
    }
    // O corpo é opcional para uma sincronização normal.
  }

  const tokenSlots: TokenSlot[] = [];
  if (token1) tokenSlots.push({ slot: 1, token: token1 });
  if (token2) tokenSlots.push({ slot: 2, token: token2 });
  if (tokenSlots.length < 2) {
    return jsonResponse({
      error: "Cadastre META_ACCESS_TOKEN_1 e META_ACCESS_TOKEN_2 antes de sincronizar.",
      configured_tokens: tokenSlots.length,
    }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (mode === "configure") {
    const { data, error } = await supabase.rpc("configure_meta_ads_schedule", {
      secret_value: workerSecret,
    });
    if (error || data !== true) {
      console.error("Falha ao configurar Cron da Meta:", error?.message);
      return jsonResponse({ error: "Não foi possível configurar o agendamento." }, 500);
    }
    return jsonResponse({ configured: true, schedule: "*/10 * * * *" });
  }

  const runId = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_meta_ads_worker", {
    requested_owner: runId,
    lease_seconds: 600,
  });
  if (claimError) return jsonResponse({ error: "Não foi possível iniciar a sincronização." }, 500);
  if (claimed !== true) return jsonResponse({ skipped: true, reason: "worker_already_running" });

  const { error: runInsertError } = await supabase.from("meta_sync_runs").insert({
    id: runId,
    status: "running",
  });
  if (runInsertError) {
    await releaseLease(supabase, runId);
    return jsonResponse({ error: "Não foi possível registrar a sincronização." }, 500);
  }

  const errors: Array<{ scope: string; message: string }> = [];
  let accountsDiscovered = 0;
  let accountsSynced = 0;
  let rowsReceived = 0;
  let actionRowsReceived = 0;
  const actionSummaries: Array<{
    account_id: string;
    metric_date: string;
    rows: number;
    conversations: number;
  }> = [];
  const insightSummaries: Array<{
    account_id: string;
    metric_date: string;
    rows: number;
    currency: string;
    spend: number;
    spend_brl: number;
    exchange_rate_date: string;
  }> = [];
  let campaignMappings: JsonObject[] = [];

  try {
    const exchangeRate = mode === "sync" ? await loadExchangeRate(supabase) : null;
    const selectedBindings = mode === "historical_backfill"
      ? ACCOUNT_BINDINGS.filter((binding) => requestedAccountIds.includes(binding.accountId))
      : ACCOUNT_BINDINGS;
    const discoveryResults = await Promise.allSettled(
      selectedBindings.map((binding) => loadConfiguredAccount(binding, tokenSlots)),
    );
    const accounts: DiscoveredAccount[] = [];

    discoveryResults.forEach((result, index) => {
      if (result.status === "rejected") {
        errors.push({
          scope: `act_${selectedBindings[index].accountId}`,
          message: result.reason instanceof Error ? result.reason.message : "Falha ao carregar a conta.",
        });
        return;
      }
      accounts.push(result.value);
    });
    accountsDiscovered = accounts.length;

    for (const discovered of accounts) {
      const { account, tokenSlot } = discovered;
      if (account.currency !== "BRL" && account.currency !== "USD") {
        errors.push({ scope: account.id, message: `Moeda ${account.currency} ainda não é suportada.` });
        continue;
      }

      const { error: accountError } = await supabase.from("meta_ad_accounts").upsert({
        id: account.id,
        account_id: account.account_id,
        token_slot: tokenSlot.slot,
        name: account.name,
        currency: account.currency,
        timezone_name: account.timezone_name,
        timezone_offset_hours_utc: account.timezone_offset_hours_utc ?? null,
        account_status: account.account_status ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id", defaultToNull: false });
      if (accountError) {
        errors.push({ scope: account.id, message: accountError.message });
        continue;
      }

      let accountSucceeded = true;

      if (mode === "sync" && exchangeRate) {
        try {
          const { metricDate, rows } = await fetchAccountInsights(discovered, exchangeRate);
          insightSummaries.push({
            account_id: account.account_id,
            metric_date: metricDate,
            rows: rows.length,
            currency: account.currency,
            spend: rows.reduce((total, row) => total + numeric(row.spend), 0),
            spend_brl: rows.reduce((total, row) => total + numeric(row.spend_brl), 0),
            exchange_rate_date: exchangeRate.date,
          });
          if (rows.length > 0) {
            const { data: inserted, error: replaceError } = await supabase.rpc(
              "replace_meta_hourly_insights",
              {
                p_account_id: account.id,
                p_metric_date: metricDate,
                p_rows: rows,
                p_fetched_at: new Date().toISOString(),
              },
            );
            if (replaceError) throw new Error(replaceError.message);
            rowsReceived += Number(inserted ?? rows.length);
          }
        } catch (accountSyncError) {
          accountSucceeded = false;
          errors.push({
            scope: `${account.id}:hourly_insights`,
            message: accountSyncError instanceof Error
              ? accountSyncError.message
              : "Falha desconhecida nos insights horários.",
          });
        }
      }

      if (mode === "historical_backfill") {
        for (const metricDate of requestedDates) {
          try {
            const historicalRate = await loadExchangeRate(supabase, metricDate);
            const { rows } = await fetchAccountInsights(
              discovered,
              historicalRate,
              metricDate,
            );
            insightSummaries.push({
              account_id: account.account_id,
              metric_date: metricDate,
              rows: rows.length,
              currency: account.currency,
              spend: rows.reduce((total, row) => total + numeric(row.spend), 0),
              spend_brl: rows.reduce((total, row) => total + numeric(row.spend_brl), 0),
              exchange_rate_date: historicalRate.date,
            });
            // data: [] não apaga um retrato histórico já armazenado.
            if (rows.length === 0) continue;

            const { data: inserted, error: replaceError } = await supabase.rpc(
              "replace_meta_hourly_insights",
              {
                p_account_id: account.id,
                p_metric_date: metricDate,
                p_rows: rows,
                p_fetched_at: new Date().toISOString(),
              },
            );
            if (replaceError) throw new Error(replaceError.message);
            rowsReceived += Number(inserted ?? rows.length);
          } catch (historicalSyncError) {
            accountSucceeded = false;
            errors.push({
              scope: `${account.id}:historical_insights:${metricDate}`,
              message: historicalSyncError instanceof Error
                ? historicalSyncError.message
                : "Falha desconhecida nos insights históricos.",
            });
          }
        }
      }

      const actionDates = mode === "backfill" || mode === "historical_backfill"
        ? requestedDates
        : [dateInTimezone(new Date(), account.timezone_name)];

      for (const metricDate of actionDates) {
        try {
          const rows = await fetchAccountMessagingActions(discovered, metricDate);
          actionSummaries.push({
            account_id: account.account_id,
            metric_date: metricDate,
            rows: rows.length,
            conversations: rows.reduce(
              (total, row) => total + numeric(row.messaging_conversations_started),
              0,
            ),
          });
          // data: [] é um no-op deliberado para preservar o último dado conhecido.
          if (rows.length === 0) continue;

          const { data: inserted, error: replaceError } = await supabase.rpc(
            "replace_meta_daily_actions",
            {
              p_account_id: account.id,
              p_metric_date: metricDate,
              p_rows: rows,
              p_fetched_at: new Date().toISOString(),
            },
          );
          if (replaceError) throw new Error(replaceError.message);
          actionRowsReceived += Number(inserted ?? rows.length);
        } catch (actionSyncError) {
          accountSucceeded = false;
          errors.push({
            scope: `${account.id}:messaging_actions:${metricDate}`,
            message: actionSyncError instanceof Error
              ? actionSyncError.message
              : "Falha desconhecida nas ações de mensagem.",
          });
        }
      }

      if (accountSucceeded) accountsSynced += 1;
    }

    if (mode === "historical_backfill" && accounts.length > 0) {
      const accountIds = accounts.map(({ account }) => account.id);
      const [{ data: campaigns, error: campaignsError }, { data: sellers, error: sellersError }] =
        await Promise.all([
          supabase
            .from("meta_campaigns")
            .select("id,name,seller_id,mapping_source")
            .in("ad_account_id", accountIds)
            .order("name"),
          supabase.from("sellers").select("id,name"),
        ]);

      if (campaignsError || sellersError) {
        errors.push({
          scope: "campaign_mappings",
          message: campaignsError?.message || sellersError?.message || "Falha ao validar campanhas.",
        });
      } else {
        const sellerNames = new Map((sellers ?? []).map((seller) => [seller.id, seller.name]));
        campaignMappings = (campaigns ?? []).map((campaign) => ({
          ...campaign,
          seller_name: campaign.seller_id ? sellerNames.get(campaign.seller_id) ?? null : null,
        }));
      }
    }

    const status = errors.length === 0 ? "completed" : accountsSynced > 0 ? "partial" : "failed";
    await supabase.from("meta_sync_runs").update({
      finished_at: new Date().toISOString(),
      status,
      accounts_discovered: accountsDiscovered,
      accounts_synced: accountsSynced,
      rows_received: rowsReceived,
      error_details: errors,
    }).eq("id", runId);

    return jsonResponse({
      run_id: runId,
      graph_version: GRAPH_VERSION,
      mode,
      dates: mode === "backfill" || mode === "historical_backfill"
        ? requestedDates
        : undefined,
      account_ids: mode === "historical_backfill" ? requestedAccountIds : undefined,
      exchange_rate: exchangeRate
        ? {
          date: exchangeRate.date,
          usd_brl: exchangeRate.rate,
          source: exchangeRate.source,
          provider: "BCB",
        }
        : undefined,
      status,
      accounts_discovered: accountsDiscovered,
      accounts_synced: accountsSynced,
      rows_received: rowsReceived,
      insight_summaries: insightSummaries,
      action_rows_received: actionRowsReceived,
      action_summaries: actionSummaries,
      campaign_mappings: mode === "historical_backfill" ? campaignMappings : undefined,
      errors,
    }, status === "failed" ? 502 : status === "partial" ? 207 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronização.";
    await supabase.from("meta_sync_runs").update({
      finished_at: new Date().toISOString(),
      status: "failed",
      accounts_discovered: accountsDiscovered,
      accounts_synced: accountsSynced,
      rows_received: rowsReceived,
      error_details: [...errors, { scope: "worker", message }],
    }).eq("id", runId);
    return jsonResponse({ error: message, run_id: runId }, 500);
  } finally {
    await releaseLease(supabase, runId);
  }
});
