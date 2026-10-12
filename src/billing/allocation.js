// Payment allocation and late-fee rules. Pure functions.

import { addDays } from './dates.js';
import { percentOf } from './money.js';

/**
 * Spreads `amount` across open invoices, oldest due date first.
 * @param {number} amount
 * @param {{id:number, due_date:string, total:number, amount_paid:number}[]} invoices
 * @returns {{allocations: {invoice_id:number, amount:number}[], remaining:number}}
 */
export function allocatePayment(amount, invoices) {
  const open = invoices
    .filter((inv) => inv.total - inv.amount_paid > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
  const allocations = [];
  let remaining = amount;
  for (const inv of open) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, inv.total - inv.amount_paid);
    allocations.push({ invoice_id: inv.id, amount: applied });
    remaining -= applied;
  }
  return { allocations, remaining };
}

export function invoiceStatus(invoice) {
  if (invoice.status === 'void') return 'void';
  if (invoice.amount_paid >= invoice.total) return 'paid';
  if (invoice.amount_paid > 0) return 'partial';
  return 'open';
}

/**
 * Late fee due on an invoice as of `asOf`, or 0.
 * settings: { late_fee_type: 'none'|'flat'|'percent', late_fee_value, late_fee_grace_days }
 * Percent fees apply to the unpaid balance; flat fees are minor units.
 */
export function lateFeeFor(invoice, asOf, settings) {
  const type = settings.late_fee_type ?? 'none';
  if (type === 'none' || invoice.status === 'void') return 0;
  const balance = invoice.total - invoice.amount_paid;
  if (balance <= 0) return 0;
  const lateAfter = addDays(invoice.due_date, settings.late_fee_grace_days ?? 0);
  if (asOf <= lateAfter) return 0;
  if (type === 'flat') return settings.late_fee_value;
  if (type === 'percent') return percentOf(balance, settings.late_fee_value);
  throw new Error(`Unknown late fee type "${type}"`);
}
