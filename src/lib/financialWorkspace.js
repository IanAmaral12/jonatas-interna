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
    return Number(b.confirmed_profit) - Number(a.confirmed_profit) ||
      a.seller_name.localeCompare(b.seller_name, 'pt-BR') || String(a.seller_id).localeCompare(String(b.seller_id))
  })
}

export const commissionTypes = [
  ['scheduled_pct', '% do faturamento agendado'], ['paid_pct', '% do valor recebido'],
  ['fixed_per_paid', 'R$ fixo por venda paga'], ['fixed_per_shipped', 'R$ fixo por pedido enviado'],
]

export function formatCommission(type, value) {
  if (value == null) return 'não configurada'
  if (type === 'fixed_per_paid') return `${formatMoney(value)} por venda paga`
  if (type === 'fixed_per_shipped') return `${formatMoney(value)} por pedido enviado`
  return `${formatPercent(value)} ${type === 'paid_pct' ? 'do valor recebido' : 'do faturamento agendado'}`
}

export const costCategories = [
  ['pessoal', 'Pessoal'], ['marketing', 'Marketing'], ['logistica', 'Logística'], ['producao', 'Produção'],
  ['financeiro', 'Financeiro'], ['impostos', 'Impostos'], ['ferramentas', 'Ferramentas e assinaturas'],
  ['estrutura', 'Estrutura e aluguel'], ['servicos', 'Serviços'], ['outros', 'Outros'],
]
export const categoryLabel = (key) => costCategories.find(([value]) => value === key)?.[1] || 'Outros'
const automaticCategories = {
  salary_cost: 'pessoal', commission_cost: 'pessoal', production_cost: 'producao', shipping_cost: 'logistica',
  traffic_cost: 'marketing', external_commission_cost: 'marketing', skale_cost: 'financeiro', payment_fee_cost: 'financeiro',
  allocated_tax: 'impostos', unallocated_tax: 'impostos',
}

export function costsByCategory(summary, expenses, recurring) {
  const totals = {}
  const add = (key, amount) => { totals[key] = Math.round(((totals[key] || 0) + Number(amount || 0)) * 100) / 100 }
  for (const [field, key] of Object.entries(automaticCategories)) add(key, summary[field])
  for (const entry of [...expenses, ...recurring]) add(entry.category || 'outros', entry.amount)
  return costCategories.map(([key, label]) => ({ key, label, amount: totals[key] || 0 }))
    .filter((category) => category.amount > 0).sort((a, b) => b.amount - a.amount)
}

export function sellerSettingChanges(setting, draft) {
  const changes = {}
  const currentType = setting.commission_type || 'scheduled_pct'
  const type = draft.commissionType || currentType
  const fixed = type.startsWith('fixed_')
  for (const [input, field, maximum, label] of [
    ['salary', 'monthly_salary', 999999999999.99, 'salário'],
    ['commission', 'commission_pct', fixed ? 999999999999.99 : 100, 'comissão'],
  ]) {
    const typeChanged = input === 'commission' && type !== currentType
    if (!typeChanged && draft.dirty && !draft.dirty[input]) continue
    if (!draft[input].trim()) {
      if (typeChanged) throw new Error('Informe o valor da comissão para o novo tipo.')
      continue
    }
    const value = parseFinancialDecimal(draft[input], maximum)
    if (value === null) throw new Error(`Confira o ${label}: valor não negativo, até duas casas decimais${input === 'commission' && !fixed ? ' e no máximo 100%' : ''}.`)
    if (typeChanged || setting[field] == null || value !== Number(setting[field])) changes[field] = value
  }
  if (type !== currentType) changes.commission_type = type
  return changes
}
