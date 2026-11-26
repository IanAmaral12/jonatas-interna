import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancellationFromStatuses } from '../supabase/functions/orders-worker/order-cancellation.js'

test('cancels when payment or tracking status says cancelado', () => {
  assert.equal(cancellationFromStatuses(['After Pay', 'Cancelado']), true)
  assert.equal(cancellationFromStatuses(['Pedido cancelado', 'Pedido Criado']), true)
})

test('keeps cancellation fees and other statuses as active orders', () => {
  assert.equal(cancellationFromStatuses(['Pago', 'Taxa de Cancelamento']), false)
  assert.equal(cancellationFromStatuses(['After Pay', null, 'Entregue']), false)
})

test('returns null when no status was received', () => {
  assert.equal(cancellationFromStatuses([null, undefined, '']), null)
})
