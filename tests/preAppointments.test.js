import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  includePreAppointments,
  includePreTimeline,
  includePreSellerTimeline,
} from '../src/lib/preAppointments.js'

const entries = [
  { seller_id: 'pedro', seller_name: 'Pedro', appointment_date: '2026-09-02', quantity: 6 },
  { seller_id: 'pedro', seller_name: 'Pedro', appointment_date: '2026-09-03', quantity: 4 },
  { seller_id: 'wesley', seller_name: 'Wesley', appointment_date: '2026-09-03', quantity: 5 },
]
const sellerRow = {
  seller_id: 'pedro',
  seller_name: 'Pedro',
  currency: 'BRL',
  row_type: 'seller',
  spend: 200,
  leads: 100,
  appointments: 10,
  revenue: 1000,
  cpa: 20,
  cpl: 2,
  roas: 5,
  average_ticket: 100,
  conversion_rate: 10,
}

test('adds quantities to seller and general counts, preserves money and leads, recalculates denominators', () => {
  const rows = [
    sellerRow,
    { ...sellerRow, seller_id: null, row_type: 'general', appointments: 20 },
    { ...sellerRow, seller_id: null, row_type: 'unmatched', spend: 50 },
  ]
  const original = structuredClone(rows)
  const result = includePreAppointments(rows, entries)
  const pedro = result.find((row) => row.seller_id === 'pedro')
  assert.equal(pedro.appointments, 20)
  assert.equal(pedro.cpa, 10)
  assert.equal(pedro.conversion_rate, 20)
  assert.equal(pedro.lead_to_appointment_ratio, 5)
  assert.equal(pedro.average_ticket, 50)
  for (const key of ['revenue', 'spend', 'leads', 'cpl', 'roas'])
    assert.equal(pedro[key], sellerRow[key])
  assert.equal(result.find((row) => row.row_type === 'general').appointments, 35)
  assert.deepEqual(
    result.find((row) => row.row_type === 'unmatched'),
    rows[2],
  )
  assert.deepEqual(rows, original)
})

test('pre-only sellers appear with no fabricated investment or revenue and safe zero denominators', () => {
  const result = includePreAppointments([], entries)
  const wesley = result.find((row) => row.seller_id === 'wesley')
  assert.equal(wesley.appointments, 5)
  assert.equal(wesley.revenue, 0)
  assert.equal(wesley.spend, 0)
  assert.equal(wesley.cpa, null)
  assert.equal(wesley.conversion_rate, null)
  assert.equal(result.find((row) => row.row_type === 'general').appointments, 15)
})

test('empty pre totals preserve all existing metrics and API rounding', () => {
  assert.deepEqual(includePreAppointments([sellerRow], []), [{ ...sellerRow, pre_appointments: 0 }])
})

test('hourly charts remain real orders only; no fake time or milestones', () => {
  const hours = [
    { bucket_start: '2026-09-02T17:00:00+00:00', sales: 10, milestones: [{ threshold: 10 }] },
  ]
  assert.strictEqual(includePreTimeline(hours, entries, 'day_hours'), hours)
  assert.strictEqual(includePreSellerTimeline(hours, entries, 'seller_hours'), hours)
})

test('daily comparisons merge using São Paulo date and create new dates correctly', () => {
  const rows = [
    {
      bucket_start: '2026-09-02T03:00:00+00:00',
      series_start: '2026-08-30',
      bucket_index: 3,
      sales: 10,
    },
  ]
  const result = includePreTimeline(rows, entries, 'week_days')
  assert.equal(result.length, 2)
  assert.equal(result[0].sales, 16)
  assert.equal(result[1].sales, 9)
  assert.equal(result[1].series_start, '2026-08-30')
  assert.equal(result[1].bucket_index, 4)
  assert.equal(rows[0].sales, 10)
  const month = includePreTimeline([], entries, 'month_days')
  assert.equal(month[0].series_start, '2026-09-01')
  assert.equal(month[0].bucket_index, 1)
})

test('seller comparisons include pre-only sellers, zero-fill and retain filtered totals', () => {
  const rows = [
    {
      bucket_start: '2026-09-02T03:00:00+00:00',
      seller_id: 'pedro',
      seller_name: 'Pedro',
      sales: 10,
    },
  ]
  const result = includePreSellerTimeline(rows, entries, 'seller_days')
  assert.equal(result.length, 4)
  assert.equal(
    result.find((row) => row.seller_id === 'wesley' && row.bucket_start.startsWith('2026-09-02'))
      .sales,
    0,
  )
  assert.equal(
    result.reduce((sum, row) => sum + row.sales, 0),
    25,
  )
  const filtered = includePreSellerTimeline(
    rows,
    entries.filter((entry) => entry.seller_id === 'pedro'),
    'seller_days',
  )
  assert.ok(filtered.every((row) => row.seller_id === 'pedro'))
  assert.equal(
    filtered.reduce((sum, row) => sum + row.sales, 0),
    20,
  )
})

test('seller charts aggregate Sunday weeks and calendar months without duplicate timestamp buckets', () => {
  const rows = [
    {
      bucket_start: '2026-08-30T03:00:00+00:00',
      seller_id: 'pedro',
      seller_name: 'Pedro',
      sales: 10,
    },
  ]
  const week = includePreSellerTimeline(rows, entries, 'seller_weeks')
  assert.equal(week.length, 2)
  assert.equal(week.find((row) => row.seller_id === 'pedro').sales, 20)
  assert.equal(week.find((row) => row.seller_id === 'wesley').sales, 5)
  const month = includePreSellerTimeline([], entries, 'seller_months')
  assert.equal(month.length, 2)
  assert.ok(month.every((row) => row.bucket_start.startsWith('2026-09-01')))
})
