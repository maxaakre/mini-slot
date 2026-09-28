export const formatMoney = (cents: number): string =>
  (cents / 100).toLocaleString('sv-SE', { style: 'currency', currency: 'EUR' });
