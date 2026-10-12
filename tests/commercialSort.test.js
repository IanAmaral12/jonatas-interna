import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortCommercialRows } from '../src/lib/commercialSort.js'

const rows = [
  {
    seller_name: 'Zélia', spend: 200, cpl: 10, leads: 20, appointments: 2,
    conversion_rate: 10, revenue: 300, roas: 1.5, average_ticket: 150,
  },
  {
    seller_name: 'Ana', spend: 100, cpl: null, leads: 5, appointments: 3,
    conversion_rate: 60, revenue: 900, roas: 9, average_ticket: 300,
  },
  {
    seller_name: 'Bruno', spend: 300, cpl: 5, leads: 60, appointments: 1,
    conversion_rate: null, revenue: 100, roas: null, average_ticket: 100,
  },
]

test('sorts every commercial column in ascending and descending order', () => {
  const expectations = {
    seller_name: [['Ana', 'Bruno', 'Zélia'], ['Zélia', 'Bruno', 'Ana']],
    spend: [['Ana', 'Zélia', 'Bruno'], ['Bruno', 'Zélia', 'Ana']],
    cpl: [['Bruno', 'Zélia', 'Ana'], ['Zélia', 'Bruno', 'Ana']],
    leads: [['Ana', 'Zélia', 'Bruno'], ['Bruno', 'Zélia', 'Ana']],
    appointments: [['Bruno', 'Zélia', 'Ana'], ['Ana', 'Zélia', 'Bruno']],
    conversion_rate: [['Zélia', 'Ana', 'Bruno'], ['Ana', 'Zélia', 'Bruno']],
    revenue: [['Bruno', 'Zélia', 'Ana'], ['Ana', 'Zélia', 'Bruno']],
    roas: [['Zélia', 'Ana', 'Bruno'], ['Ana', 'Zélia', 'Bruno']],
    average_ticket: [['Bruno', 'Zélia', 'Ana'], ['Ana', 'Zélia', 'Bruno']],
  }

  for (const [key, [ascending, descending]] of Object.entries(expectations)) {
    assert.deepEqual(sortCommercialRows(rows, key, 'asc').map((row) => row.seller_name), ascending)
    assert.deepEqual(sortCommercialRows(rows, key, 'desc').map((row) => row.seller_name), descending)
  }
})

test('does not mutate API rows while sorting', () => {
  const original = structuredClone(rows)
  sortCommercialRows(rows, 'revenue', 'desc')
  assert.deepEqual(rows, original)
})
