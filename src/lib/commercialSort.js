const numericColumns = new Set([
  'spend',
  'cpl',
  'leads',
  'appointments',
  'conversion_rate',
  'revenue',
  'roas',
  'average_ticket',
])

function isMissing(value) {
  return value === null || value === undefined || value === ''
}

export function sortCommercialRows(rows, key, direction) {
  const multiplier = direction === 'asc' ? 1 : -1

  return [...rows].sort((first, second) => {
    const firstValue = first[key]
    const secondValue = second[key]
    const firstMissing = isMissing(firstValue)
    const secondMissing = isMissing(secondValue)

    if (firstMissing && secondMissing) {
      return first.seller_name.localeCompare(second.seller_name, 'pt-BR')
    }
    if (firstMissing) return 1
    if (secondMissing) return -1

    const comparison = numericColumns.has(key)
      ? Number(firstValue) - Number(secondValue)
      : String(firstValue).localeCompare(String(secondValue), 'pt-BR', { sensitivity: 'base' })

    return comparison * multiplier
      || first.seller_name.localeCompare(second.seller_name, 'pt-BR')
  })
}
