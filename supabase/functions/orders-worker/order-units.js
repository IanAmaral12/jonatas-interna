/** @param {unknown} products @returns {number | null} */
export function sumProductUnits(products) {
  if (!Array.isArray(products) || products.length === 0) return null;

  let total = 0;
  for (const product of products) {
    const quantity = product && typeof product === 'object' ? product.quantity : undefined;
    if (!/^[1-9][0-9]{0,8}$/.test(String(quantity))) return null;
    total += Number(quantity);
    if (total > 2147483647) return null;
  }
  return total;
}
