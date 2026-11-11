import { parseFinancialDecimal } from './financialDreSettings.js'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatMoney = (value) => value == null ? 'Pendente' : currency.format(Number(value))
export const formatPercent = (value) => value == null ? '—' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
export const formatMonth = (month) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`))
export const costFields = [
  ['salary_cost', 'Salários'], ['commission_cost', 'Comissão interna'], ['production_cost', 'Fabricação'],
  ['shipping_cost', 'Frete'], ['traffic_cost', 'Tráfego'], ['skale_cost', 'Skale'],
  ['payment_fee_cost', 'Adquirência'], ['external_commission_cost', 'Comissão externa'], ['allocated_tax', 'Imposto rateado'],
]

export function costLabel(row, key, label) {
  const pendingKey = { salary_cost: 'salary', commission_cost: 'commission', production_cost: 'units', payment_fee_cost: 'payment_fee', external_commission_cost: 'external_commission' }[key]
  return Number(row.pending?.[pendingKey] || 0) > 0 && row[key] != null ? `${label} · subtotal conhecido` : label
}

export function hasFinancialPending(row) {
  return Object.values(row.pending || {}).some((count) => Number(count) > 0)
}

export function sortSellerRanking(rows) {
  return rows.filter((row) => row.row_type === 'seller').slice().sort((a, b) => {
    const aPending = a.confirmed_profit == null || hasFinancialPending(a)
    const bPending = b.confirmed_profit == null || hasFinancialPending(b)
    return Number(aPending) - Number(bPending) ||
      (!aPending ? Number(b.confirmed_profit) - Number(a.confirmed_profit) : 0) ||
      a.seller_name.localeCompare(b.seller_name, 'pt-BR') || String(a.seller_id).localeCompare(String(b.seller_id))
  })
}

export function sellerSettingChanges(setting, draft) {
  const changes = {}
  for (const [input, field, maximum, label] of [
    ['salary', 'monthly_salary', 999999999999.99, 'salário'],
    ['commission', 'commission_pct', 100, 'comissão'],
  ]) {
    if (draft.dirty && !draft.dirty[input]) continue
    if (!draft[input].trim()) continue
    const value = parseFinancialDecimal(draft[input], maximum)
    if (value === null) throw new Error(`Confira o ${label}: valor não negativo, até duas casas decimais${input === 'commission' ? ' e no máximo 100%' : ''}.`)
    if (setting[field] == null || value !== Number(setting[field])) changes[field] = value
  }
  return changes
}
