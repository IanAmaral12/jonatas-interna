import { test } from 'node:test'
import assert from 'node:assert/strict'
import { includePreAppointments } from '../src/lib/preAppointments.js'

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
