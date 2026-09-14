// Counts are additive only. Revenue always comes from real orders.
export function preAppointmentInputValue(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function preAppointmentTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const timestamp = `${value}:00-03:00`
  return preAppointmentInputValue(timestamp) === value ? timestamp : null
}

export function includePreAppointments(rows, entries) {
  const bySeller = new Map()
  for (const entry of entries) {
    const seller = bySeller.get(entry.seller_id) || { name: entry.seller_name, quantity: 0 }
    seller.quantity += Number(entry.quantity)
    bySeller.set(entry.seller_id, seller)
  }
  const total = [...bySeller.values()].reduce((sum, seller) => sum + seller.quantity, 0)
  const result = rows.map((row) => {
    if (row.currency !== 'BRL' || row.row_type === 'unmatched') return { ...row }
    const preCount = row.row_type === 'general' ? total : bySeller.get(row.seller_id)?.quantity || 0
    return recalculate(row, preCount)
  })
  for (const [id, seller] of bySeller) {
    if (!result.some((row) => row.currency === 'BRL' && row.seller_id === id)) {
      result.push(
        recalculate(
          {
            currency: 'BRL',
            seller_id: id,
            seller_name: seller.name,
            row_type: 'seller',
            spend: 0,
            leads: 0,
            appointments: 0,
            revenue: 0,
            cpl: null,
            roas: null,
            currency_conflict: false,
            mapping_status: 'matched',
          },
          seller.quantity,
        ),
      )
    }
  }
  if (!result.some((row) => row.currency === 'BRL' && row.row_type === 'general') && total > 0) {
    result.push(
      recalculate(
        {
          currency: 'BRL',
          row_type: 'general',
          spend: 0,
          leads: 0,
          appointments: 0,
          revenue: 0,
          roas: null,
          cpl: null,
        },
        total,
      ),
    )
  }
  return result
}

function recalculate(row, preCount) {
  if (!preCount) return { ...row, pre_appointments: 0 }
  const appointments = Number(row.appointments) + preCount
  return {
    ...row,
    appointments,
    pre_appointments: preCount,
    cpa: appointments > 0 && row.spend > 0 ? row.spend / appointments : null,
    conversion_rate: row.leads > 0 ? (appointments / row.leads) * 100 : null,
    lead_to_appointment_ratio: appointments > 0 && row.leads > 0 ? row.leads / appointments : null,
    average_ticket: appointments > 0 ? row.revenue / appointments : null,
  }
}
