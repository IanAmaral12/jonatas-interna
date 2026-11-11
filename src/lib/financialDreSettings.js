export function parseFinancialDecimal(value, maximum) {
  const trimmed = value.trim()
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(trimmed)
  if (!grouped && !/^\d+(?:[,.]\d{1,2})?$/.test(trimmed)) return null
  const normalized = grouped ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed.replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null
}
