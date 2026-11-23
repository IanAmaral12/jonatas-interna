export const FIXED_USD_BRL_BASE_RATE = 5.60;
export const FIXED_USD_BRL_SURCHARGE = 0.035;
export const FIXED_USD_BRL_RATE = Number(
  (FIXED_USD_BRL_BASE_RATE * (1 + FIXED_USD_BRL_SURCHARGE)).toFixed(8),
);
export const DAILY_EXCHANGE_RATE_START = "2026-11-01";
export const USD_BRL_SURCHARGE = 0.07;

export function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function validDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && shiftDate(date, 0) === date;
}

export async function fetchExchangeRates(startDate, endDate, fetcher = fetch) {
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error("Período inválido para consultar o câmbio.");
  }
  const url = new URL("https://api.frankfurter.dev/v2/rates");
  url.searchParams.set("base", "USD");
  url.searchParams.set("quotes", "BRL");
  url.searchParams.set("providers", "BCB");
  url.searchParams.set("from", shiftDate(startDate, -14));
  url.searchParams.set("to", endDate);
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Falha ao consultar o câmbio: HTTP ${response.status}.`);
  const observations = await response.json();
  if (!Array.isArray(observations) || observations.length === 0 || observations.some((row) =>
    !row || !validDate(row.date) || row.date > endDate || row.base !== "USD" ||
    row.quote !== "BRL" || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0
  )) throw new Error("A API retornou uma cotação de câmbio inválida.");
  return observations;
}

export function exchangeRateForDate(targetDate, observations) {
  const observation = observations
    .filter((row) => row.date <= targetDate && row.date >= shiftDate(targetDate, -14))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!observation) throw new Error(`Sem cotação BCB disponível para ${targetDate}.`);
  return {
    date: observation.date,
    base: "USD",
    quote: "BRL",
    baseRate: observation.rate,
    rate: Number((observation.rate * (1 + USD_BRL_SURCHARGE)).toFixed(8)),
    source: "Frankfurter v2",
    provider: "BCB",
    rawPayload: observation,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function fixedExchangeRate(date) {
  return {
    date,
    base: "USD",
    quote: "BRL",
    rate: FIXED_USD_BRL_RATE,
    source: "fixed",
    rawPayload: {
      base_rate: FIXED_USD_BRL_BASE_RATE,
      surcharge_percentage: FIXED_USD_BRL_SURCHARGE * 100,
      effective_rate: FIXED_USD_BRL_RATE,
    },
  };
}

export function convertSpend(currency, spendValue, exchangeRate) {
  const spend = Number(spendValue);
  return {
    spend_usd: currency === "USD" ? spend : spend / exchangeRate.rate,
    spend_brl: currency === "BRL" ? spend : spend * exchangeRate.rate,
    exchange_rate_usd_brl: exchangeRate.rate,
    exchange_rate_date: exchangeRate.date,
  };
}

export function preserveExistingConversion(currency, incoming, existing, exchangeRate, metricDate = exchangeRate.date) {
  // November onward uses one daily rate for the entire snapshot, never a blended delta.
  if (currency === "USD" && metricDate >= DAILY_EXCHANGE_RATE_START) return incoming;
  if (!existing) return incoming;

  const previousSpend = numberOrNull(existing.spend);
  const previousUsd = numberOrNull(existing.spend_usd);
  const previousBrl = numberOrNull(existing.spend_brl);
  const previousRate = numberOrNull(existing.exchange_rate_usd_brl);
  const incomingSpend = numberOrNull(incoming.spend);

  if (
    previousSpend === null || previousUsd === null || previousBrl === null ||
    previousRate === null || incomingSpend === null
  ) return incoming;

  const spendDelta = incomingSpend - previousSpend;
  if (Math.abs(spendDelta) < 1e-9) {
    return {
      ...incoming,
      spend_usd: previousUsd,
      spend_brl: previousBrl,
      exchange_rate_usd_brl: previousRate,
      exchange_rate_date: existing.exchange_rate_date,
    };
  }

  const spendUsd = currency === "USD"
    ? incomingSpend
    : Math.max(0, previousUsd + spendDelta / exchangeRate.rate);
  const spendBrl = currency === "BRL"
    ? incomingSpend
    : Math.max(0, previousBrl + spendDelta * exchangeRate.rate);

  return {
    ...incoming,
    spend_usd: spendUsd,
    spend_brl: spendBrl,
    exchange_rate_usd_brl: spendUsd > 0 ? spendBrl / spendUsd : exchangeRate.rate,
    exchange_rate_date: exchangeRate.date,
  };
}
