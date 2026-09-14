// Counts are additive only. Never infer revenue or an hourly timestamp from a date.
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

function weekStart(value) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return date.toISOString().slice(0, 10)
}

function bucketDate(value, mode) {
  if (mode === 'seller_weeks') return weekStart(value)
  if (mode === 'seller_months') return `${value.slice(0, 7)}-01`
  return value
}

function saoPauloDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function includePreTimeline(rows, entries, mode) {
  if (mode === 'day_hours') return rows
  const result = rows.map((row) => ({ ...row }))
  for (const entry of entries) {
    let row = result.find((item) => saoPauloDate(item.bucket_start) === entry.appointment_date)
    if (!row) {
      const date = new Date(`${entry.appointment_date}T12:00:00Z`)
      row = {
        bucket_start: `${entry.appointment_date}T00:00:00-03:00`,
        sales: 0,
        granularity: 'day',
        comparison_mode: mode,
        milestones: [],
        series_start:
          mode === 'week_days'
            ? weekStart(entry.appointment_date)
            : `${entry.appointment_date.slice(0, 7)}-01`,
        bucket_index: mode === 'week_days' ? date.getUTCDay() : date.getUTCDate() - 1,
      }
      result.push(row)
    }
    row.sales += Number(entry.quantity)
  }
  return result.sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start))
}

export function includePreSellerTimeline(rows, entries, mode) {
  if (mode === 'seller_hours') return rows
  const result = rows.map((row) => ({ ...row }))
  // Match by local bucket date, not timestamp string formatting returned by PostgREST.
  const buckets = new Map(result.map((row) => [saoPauloDate(row.bucket_start), row.bucket_start]))
  const sellers = new Map(result.map((row) => [row.seller_id, row.seller_name]))
  for (const entry of entries) {
    const date = bucketDate(entry.appointment_date, mode)
    if (!buckets.has(date)) buckets.set(date, `${date}T00:00:00-03:00`)
    sellers.set(entry.seller_id, entry.seller_name)
  }
  const keyed = new Map(
    result.map((row) => [`${row.seller_id}:${saoPauloDate(row.bucket_start)}`, row]),
  )
  for (const [date, timestamp] of buckets) {
    for (const [id, name] of sellers) {
      const key = `${id}:${date}`
      if (!keyed.has(key)) {
        const row = {
          bucket_start: timestamp,
          seller_id: id,
          seller_name: name,
          sales: 0,
          comparison_mode: mode,
        }
        keyed.set(key, row)
        result.push(row)
      }
    }
  }
  for (const entry of entries) {
    keyed.get(`${entry.seller_id}:${bucketDate(entry.appointment_date, mode)}`).sales += Number(
      entry.quantity,
    )
  }
  return result.sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start))
}
