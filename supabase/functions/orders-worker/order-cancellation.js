/** @param {Array<string | null | undefined>} statuses @returns {boolean | null} */
export function cancellationFromStatuses(statuses) {
  const received = statuses.filter((status) => typeof status === 'string' && status !== '')
  if (received.length === 0) return null
  return received.some((status) => status.toLocaleLowerCase('pt-BR').includes('cancelado'))
}
