import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allocatePayment, invoiceStatus, lateFeeFor } from '../src/billing/allocation.js';
import { platformFee, quoteSubscription, recommendPlan } from '../src/billing/subscription.js';

test('starter plan is free within its limits', () => {
  const q = quoteSubscription({ plan: 'starter', units: 5 });
  assert.equal(q.monthlyTotal, 0);
  assert.deepEqual(q.warnings, []);
});

test('over the plan limit warns and recommends an upgrade', () => {
  const q = quoteSubscription({ plan: 'starter', units: 12 });
  assert.match(q.warnings[0], /Growth/);
});

test('extra units, users and SMS are charged above the allowance', () => {
  const q = quoteSubscription({ plan: 'growth', units: 80, users: 5, smsPerMonth: 300 });
  // 2900 base + 30 units x 75 + 2 users x 500 + 100 SMS x 3
  assert.equal(q.monthlyTotal, 2900 + 2250 + 1000 + 300);
});

test('annual billing charges 10 months', () => {
  const q = quoteSubscription({ plan: 'business', units: 200, cycle: 'annual' });
  assert.equal(q.recurringTotal, 99_000);
  assert.equal(q.annualSavings, 19_800);
  assert.equal(q.monthlyEquivalent, 8250);
});

test('add-ons included in Enterprise are free there', () => {
  const ent = quoteSubscription({ plan: 'enterprise', units: 1000, premiumSupport: true, whiteLabel: true, dataMigration: true });
  assert.equal(ent.monthlyTotal, 39_900);
  assert.equal(ent.oneTimeTotal, 0);
  const biz = quoteSubscription({ plan: 'business', units: 100, premiumSupport: true, dataMigration: true });
  assert.equal(biz.monthlyTotal, 9900 + 4900);
  assert.equal(biz.oneTimeTotal, 19_900);
});

test('recommendPlan picks the cheapest plan that fits', () => {
  assert.equal(recommendPlan(3), 'starter');
  assert.equal(recommendPlan(40), 'growth');
  assert.equal(recommendPlan(500), 'business');
  assert.equal(recommendPlan(5000), 'enterprise');
});

test('platform fees by payment method', () => {
  assert.equal(platformFee('growth', 'card', 100_000), 2_500 + 30);
  assert.equal(platformFee('enterprise', 'card', 100_000), 1_500 + 30);
  assert.equal(platformFee('growth', 'card', 100_000, { includeFixed: false }), 2_500);
  assert.equal(platformFee('growth', 'mobile_money', 100_000), 1_500);
  assert.equal(platformFee('growth', 'bank_transfer', 100_000), 100);
  assert.equal(platformFee('growth', 'cash', 100_000), 0);
  assert.throws(() => platformFee('growth', 'barter', 1));
});

test('payments are allocated oldest due date first', () => {
  const invoices = [
    { id: 2, due_date: '2026-10-05', total: 1000, amount_paid: 0 },
    { id: 1, due_date: '2026-09-05', total: 1000, amount_paid: 400 },
    { id: 3, due_date: '2026-08-05', total: 500, amount_paid: 500 },
  ];
  assert.deepEqual(allocatePayment(1000, invoices), {
    allocations: [{ invoice_id: 1, amount: 600 }, { invoice_id: 2, amount: 400 }],
    remaining: 0,
  });
  assert.equal(allocatePayment(5000, invoices).remaining, 3400);
});

test('invoice status follows amount paid', () => {
  assert.equal(invoiceStatus({ total: 100, amount_paid: 0 }), 'open');
  assert.equal(invoiceStatus({ total: 100, amount_paid: 50 }), 'partial');
  assert.equal(invoiceStatus({ total: 100, amount_paid: 100 }), 'paid');
  assert.equal(invoiceStatus({ total: 100, amount_paid: 0, status: 'void' }), 'void');
});

test('late fees respect the grace period', () => {
  const inv = { due_date: '2026-10-05', total: 100_000, amount_paid: 20_000, status: 'partial' };
  const pct = { late_fee_type: 'percent', late_fee_value: 5, late_fee_grace_days: 5 };
  assert.equal(lateFeeFor(inv, '2026-10-10', pct), 0);
  assert.equal(lateFeeFor(inv, '2026-10-11', pct), 4_000);
  assert.equal(lateFeeFor(inv, '2026-10-11', { late_fee_type: 'flat', late_fee_value: 2_500, late_fee_grace_days: 5 }), 2_500);
  assert.equal(lateFeeFor({ ...inv, amount_paid: 100_000 }, '2026-12-01', pct), 0);
  assert.equal(lateFeeFor(inv, '2026-12-01', { late_fee_type: 'none' }), 0);
});
