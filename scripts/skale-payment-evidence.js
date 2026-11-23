function moneyInCents(value) {
  if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(value)) {
    throw new Error('Invalid Brazilian monetary amount in Skale response');
  }
  const cents = Number(value.replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(cents)) throw new Error('Skale monetary amount exceeds safe precision');
  return cents;
}

function paymentDate(line) {
  const match = line.match(/\bpago (\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/i);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== iso) {
    throw new Error('Invalid payment date in Skale response');
  }
  return iso;
}

/** Keep only financial evidence; customer details from the MCP response are discarded. */
export function parseSkalePaymentEvidence(orderId, detailText, paymentText, observedAt) {
  const header = new RegExp(`^Pedido #${String(orderId).replace(/[^0-9]/g, '')}(?:\\s|$)`, 'm');
  if (!/^\d+$/.test(String(orderId)) || !header.test(detailText) || !header.test(paymentText)) {
    throw new Error('Mismatched or missing Skale order');
  }
  const status = detailText.match(/^Status Pagamento:\s*(.+)$/m)?.[1].trim();
  if (!['Pago','Pago Parcial','Parcial'].includes(status)) {
    throw new Error('Skale order does not have a confirmed payment status');
  }
  const total = paymentText.match(/Total pago \(confirmado\): R\$\s*([\d.,]+)/)?.[1];
  const orderPaid = detailText.match(/^Valor:.*?\bPago:\s*R\$\s*([\d.,]+)/m)?.[1];
  const count = paymentText.match(/(\d+) pagamento\(s\)\/cobrança\(s\)/)?.[1];
  if (!total || !orderPaid || !count) throw new Error('Missing Skale payment totals or count');
  const payments = paymentText.split('\n').filter(line => /^#\d+/.test(line)).map(line => {
    const match = line.match(/^#(\d+)\s+·\s+.*?\s+·\s+([^·]+)\s+·\s+R\$\s*([\d.,]+)/);
    if (!match) throw new Error('Unrecognized Skale payment row');
    return { id:match[1],status:match[2].trim(),amount:moneyInCents(match[3])/100,paid_at:paymentDate(line) };
  });
  if (payments.length !== Number(count)) throw new Error('Incomplete Skale payment evidence');
  if (new Set(payments.map(p => p.id)).size !== payments.length) throw new Error('Duplicate Skale payment id');
  const confirmed = payments.filter(p => p.status === 'Pago');
  const confirmedCents = confirmed.reduce((sum,p) => sum+Math.round(p.amount*100),0);
  if (!confirmed.length || confirmedCents !== moneyInCents(total) || confirmedCents !== moneyInCents(orderPaid)) {
    throw new Error('Skale paid legs and order totals do not match');
  }
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation timestamp');
  return { p_order_id:String(orderId),p_payment_status:status,p_received_amount:confirmedCents/100,
    p_payments:payments,p_observed_at:observedAt };
}
