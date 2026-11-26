const cents = (value) => Math.round(Number(value || 0) * 100)
const sellerKey = (row) => row.seller_id ?? 'unassigned'

export function summarizeCashFlow(data, seller) {
  const matches = (row) => seller === 'all' || sellerKey(row) === seller
  const payments = (data?.payments || []).filter(matches)
  const generated = (data?.generated_costs || []).filter(matches)
  const days = new Map()
  for (const payment of payments) {
    const day = days.get(payment.paid_date) || { date: payment.paid_date, total: 0, payments: [] }
    day.total += cents(payment.amount)
    day.payments.push(payment)
    days.set(payment.paid_date, day)
  }
  const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0)
  const shipping = sum(generated, 'shipping_cost')
  const production = sum(generated, 'production_cost')
  const sellers = new Map([...(data?.payments || []), ...(data?.generated_costs || [])].map((row) => [sellerKey(row), row.seller_name]))
  return {
    received: sum(payments, 'amount') / 100,
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).map((day) => ({ ...day, total: day.total / 100 })),
    costs: {
      freight_orders: generated.reduce((total, row) => total + Number(row.freight_orders), 0),
      units: generated.reduce((total, row) => total + Number(row.units), 0),
      missing_units: generated.reduce((total, row) => total + Number(row.missing_units), 0),
      shipping: shipping / 100, production: production / 100, total: (shipping + production) / 100,
    },
    sellers: [...sellers].sort((a, b) => (a[0] === 'unassigned') - (b[0] === 'unassigned') || a[1].localeCompare(b[1], 'pt-BR')),
  }
}
