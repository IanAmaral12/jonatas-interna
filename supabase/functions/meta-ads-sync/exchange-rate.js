export const FIXED_USD_BRL_BASE_RATE = 5.60;
export const FIXED_USD_BRL_SURCHARGE = 0.035;
export const FIXED_USD_BRL_RATE = Number(
  (FIXED_USD_BRL_BASE_RATE * (1 + FIXED_USD_BRL_SURCHARGE)).toFixed(8),
);

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

export function preserveExistingConversion(currency, incoming, existing, exchangeRate) {
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
