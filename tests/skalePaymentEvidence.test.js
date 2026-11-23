import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSkalePaymentEvidence } from '../scripts/skale-payment-evidence.js'

const details = 'Pedido #42\nValor: R$ 497,00 · Pago: R$ 200,00 · Juros: R$ 0,00\nStatus Pagamento: Pago Parcial'
const evidence = 'Pedido #42 — 3 pagamento(s)/cobrança(s):\nTotal pago (confirmado): R$ 200,00\n#101 · Pagamento 1 de 2 · Pago · R$ 200,00 · PagarMe/Pix · pago 05/11/2026\n#102 · Pagamento 2 de 2 · Aguardando Pagamento · R$ 297,00 · PagarMe/Pix\n#103 · Pagamento Total · Cancelado · R$ 497,00 · PagarMe/Boleto'
const parse = (d=details,p=evidence) => parseSkalePaymentEvidence('42',d,p,'2026-11-23T12:00:00Z')

test('extracts confirmed and pending legs with exact cents and no customer data', () => {
  const result=parse(details+'\nCliente: Sensitive name\nE-mail: private@example.invalid')
  assert.equal(result.p_received_amount,200)
  assert.equal(result.p_payment_status,'Pago Parcial')
  assert.deepEqual(result.p_payments,[
    {id:'101',status:'Pago',amount:200,paid_at:'2026-11-05'},
    {id:'102',status:'Aguardando Pagamento',amount:297,paid_at:null},
    {id:'103',status:'Cancelado',amount:497,paid_at:null},
  ])
  assert.equal(JSON.stringify(result).includes('Sensitive'),false)
})

test('rejects wrong orders, incomplete evidence, duplicate legs and inconsistent source totals', () => {
  assert.throws(()=>parse(details.replace('#42','#43')),/order/)
  assert.throws(()=>parse(details,evidence.replace('3 pagamento','4 pagamento')),/Incomplete/)
  assert.throws(()=>parse(details,evidence.replace('#102','#101')),/Duplicate/)
  assert.throws(()=>parse(details.replace('Pago: R$ 200,00','Pago: R$ 497,00')),/do not match/)
  assert.throws(()=>parse(details,evidence.replace('R$ 200,00\n#101','R$ 201,00\n#101')),/do not match/)
  assert.throws(()=>parse(details.replace('Pago Parcial','After Pay')),/status/)
  assert.throws(()=>parse(details,evidence.replace('05/11/2026','31/02/2026')),/date/)
})

test('supports full payments with actual receipts below the quoted order value', () => {
  const result=parse('Pedido #42\nValor: R$ 397,00 · Pago: R$ 100,00\nStatus Pagamento: Pago',
    'Pedido #42 — 1 pagamento(s)/cobrança(s):\nTotal pago (confirmado): R$ 100,00\n#101 · Pagamento Total · Pago · R$ 100,00 · Pagamento Interno/Pix · pago 15/09/2026')
  assert.equal(result.p_received_amount,100)
})
