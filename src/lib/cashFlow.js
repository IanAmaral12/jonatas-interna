const cents = (value) => Math.round(Number(value || 0) * 100)
const sellerKey = (row) => row.seller_id ?? 'unassigned'

export const cashSources = [
  ['payment', 'Pagamentos recebidos'], ['manual_in', 'Entradas manuais'], ['shipping', 'Frete'],
  ['production', 'Fabricação (potes)'], ['skale', 'Skale'], ['payment_fee', 'Adquirência'],
  ['external_commission', 'Comissão externa'], ['commission', 'Comissão interna'], ['tax', 'Imposto'],
  ['traffic', 'Tráfego'], ['salary', 'Salários'], ['recurring', 'Custos recorrentes'],
  ['expense', 'Despesas gerais'], ['manual_out', 'Saídas manuais'],
]
const sourceOrder = new Map(cashSources.map(([key], index) => [key, index]))
const sourceLabel = new Map(cashSources)
// Company-level costs and manual entries have no seller, so a seller filter leaves them out.
const companySources = new Set(['recurring', 'expense', 'manual_in', 'manual_out'])

function addItem(items, line) {
  const item = items.get(line.source) || { source: line.source, label: sourceLabel.get(line.source), amount: 0, quantity: null }
  item.amount += cents(line.amount)
  if (line.quantity != null) item.quantity = (item.quantity || 0) + Number(line.quantity)
  items.set(line.source, item)
}
const finish = (items) => [...items.values()].map((item) => ({ ...item, amount: item.amount / 100 }))
  .sort((a, b) => sourceOrder.get(a.source) - sourceOrder.get(b.source))

export function summarizeCashFlow(data, seller, manual = []) {
  const matches = (row) => seller === 'all' || (!companySources.has(row.source) && sellerKey(row) === seller)
  const manualLines = manual.map((entry) => ({
    day: entry.day, direction: entry.entry_type === 'entrada' ? 'in' : 'out',
    source: entry.entry_type === 'entrada' ? 'manual_in' : 'manual_out', seller_id: null, amount: entry.amount,
  }))
  const lines = [...(data?.lines || []), ...manualLines].filter(matches)
  const payments = (data?.payments || []).filter((payment) => seller === 'all' || sellerKey(payment) === seller)

  const ledgerDays = new Map()
  const outflows = new Map()
  const totals = { received: 0, manualIn: 0, automaticOut: 0, manualOut: 0 }
  for (const line of lines) {
    const day = ledgerDays.get(line.day) || { date: line.day, inflow: 0, outflow: 0, items: new Map() }
    day[line.direction === 'in' ? 'inflow' : 'outflow'] += cents(line.amount)
    addItem(day.items, line)
    ledgerDays.set(line.day, day)
    if (line.direction === 'out') addItem(outflows, line)
    const total = line.source === 'payment' ? 'received' : line.source === 'manual_in' ? 'manualIn'
      : line.source === 'manual_out' ? 'manualOut' : 'automaticOut'
    totals[total] += cents(line.amount)
  }
  let running = 0
  const ledger = [...ledgerDays.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => {
    running += day.inflow - day.outflow
    return { date: day.date, inflow: day.inflow / 100, outflow: day.outflow / 100, net: (day.inflow - day.outflow) / 100,
      cumulative: running / 100, items: finish(day.items) }
  }).reverse()

  const paymentDays = new Map()
  for (const payment of payments) {
    const day = paymentDays.get(payment.paid_date) || { date: payment.paid_date, total: 0, payments: [] }
    day.total += cents(payment.amount)
    day.payments.push(payment)
    paymentDays.set(payment.paid_date, day)
  }

  const sellers = new Map((data?.sellers || []).map((row) => [row.seller_id, row.name]))
  if ([...(data?.lines || []), ...(data?.payments || [])].some((row) => row.seller_id == null && !companySources.has(row.source))) {
    sellers.set('unassigned', 'Não atribuído')
  }
  return {
    ledger,
    outflows: finish(outflows).sort((a, b) => b.amount - a.amount),
    totals: {
      received: totals.received / 100, manualIn: totals.manualIn / 100, automaticOut: totals.automaticOut / 100,
      manualOut: totals.manualOut / 100,
      balance: (totals.received + totals.manualIn - totals.automaticOut - totals.manualOut) / 100,
    },
    days: [...paymentDays.values()].sort((a, b) => b.date.localeCompare(a.date)).map((day) => ({ ...day, total: day.total / 100 })),
    sellers: [...sellers],
  }
}
