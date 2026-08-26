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
  date_start?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
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

const GRAPH_VERSION = "v26.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
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

async function discoverAccounts(tokenSlot: TokenSlot): Promise<DiscoveredAccount[]> {
  const url = new URL(`${GRAPH_URL}/me/adaccounts`);
  url.searchParams.set(
    "fields",
    "id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status",
  );
  url.searchParams.set("limit", "100");

  const accounts = await fetchAllPages<MetaAdAccount>(url, tokenSlot.token);
  return accounts
    .filter((account) => account.id && account.account_id && account.name)
    .map((account) => ({ account, tokenSlot }));
}

async function fetchAccountInsights(
  discovered: DiscoveredAccount,
): Promise<{ metricDate: string; rows: JsonObject[] }> {
  const { account, tokenSlot } = discovered;
  const metricDate = dateInTimezone(new Date(), account.timezone_name);
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

    return [{
      campaign_id: insight.campaign_id,
      campaign_name: insight.campaign_name,
      hour_start: Number(hourMatch[1]),
      hour_bucket: hourBucket,
      spend: numeric(insight.spend),
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

  let mode = "sync";
  try {
    const body = await request.json();
    if (body?.mode === "configure") mode = "configure";
  } catch {
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

  try {
    const discoveryResults = await Promise.allSettled(tokenSlots.map(discoverAccounts));
    const accountMap = new Map<string, DiscoveredAccount>();

    discoveryResults.forEach((result, index) => {
      if (result.status === "rejected") {
        errors.push({
          scope: `token_${tokenSlots[index].slot}`,
          message: result.reason instanceof Error ? result.reason.message : "Falha na descoberta de contas.",
        });
        return;
      }
      for (const discovered of result.value) {
        if (!accountMap.has(discovered.account.id)) accountMap.set(discovered.account.id, discovered);
      }
    });

    const accounts = [...accountMap.values()];
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

      try {
        const { metricDate, rows } = await fetchAccountInsights(discovered);
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
        accountsSynced += 1;
        rowsReceived += Number(inserted ?? rows.length);
      } catch (accountSyncError) {
        errors.push({
          scope: account.id,
          message: accountSyncError instanceof Error
            ? accountSyncError.message
            : "Falha desconhecida na conta de anúncios.",
        });
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
      status,
      accounts_discovered: accountsDiscovered,
      accounts_synced: accountsSynced,
      rows_received: rowsReceived,
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
