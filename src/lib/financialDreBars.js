export function calculateBreakEvenBars(totalCost, confirmedRevenue) {
  if (!Number.isFinite(totalCost) || !Number.isFinite(confirmedRevenue) ||
    totalCost < 0 || confirmedRevenue < 0) {
    return { costPercent: null, paidPercent: null, remaining: null, surplus: null }
  }

  const scale = Math.max(totalCost, confirmedRevenue)
  return {
    costPercent: scale === 0 ? 0 : totalCost / scale * 100,
    paidPercent: scale === 0 ? 0 : confirmedRevenue / scale * 100,
    remaining: Math.max(totalCost - confirmedRevenue, 0),
    surplus: Math.max(confirmedRevenue - totalCost, 0),
  }
}
