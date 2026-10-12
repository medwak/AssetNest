import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { seedDemo } from '../src/demo.js';

let server;
let base;

before(async () => {
  server = createApp(openDatabase(':memory:')).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api`;
});

after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

test('a landlord can set up a property, lease a unit, bill and collect rent', async () => {
  const org = (await call('POST', '/organizations', { name: 'Test Landlord', currency: 'USD', vat_rate: 10, plan: 'growth', late_fee_type: 'flat', late_fee_value: 2500, late_fee_grace_days: 3 })).data;
  const prop = (await call('POST', '/properties', { org_id: org.id, name: 'Elm Plaza', type: 'mixed_use' })).data;
  const shop = (await call('POST', '/units', { property_id: prop.id, label: 'S1', type: 'shop', area: 500 })).data;
  const tenant = (await call('POST', '/tenants', { org_id: org.id, name: 'Corner Bakery', kind: 'business' })).data;

  const lease = await call('POST', '/leases', {
    unit_id: shop.id, tenant_id: tenant.id, start_date: '2026-09-16', rent_amount: 300_000, deposit_amount: 600_000,
    vat_applicable: true, due_day: 1,
    charges: [{ charge_type: 'service_charge', method: 'per_area', rate: 100 }],
  });
  assert.equal(lease.status, 201);
  assert.equal(lease.data.charges.length, 1);

  const clash = await call('POST', '/leases', { unit_id: shop.id, tenant_id: tenant.id, start_date: '2026-12-01', rent_amount: 1 });
  assert.equal(clash.status, 409);

  const sep = (await call('POST', '/billing/run', { org_id: org.id, year: 2026, month: 9 })).data;
  assert.equal(sep.created.length, 1);
  const again = (await call('POST', '/billing/run', { org_id: org.id, year: 2026, month: 9 })).data;
  assert.equal(again.created.length, 0);

  const inv = (await call('GET', `/invoices/${sep.created[0].invoice_id}`)).data;
  // 15 of 30 days: rent 150,000 + service charge 25,000 (taxable) + deposit 600,000
  assert.equal(inv.subtotal, 775_000);
  assert.equal(inv.tax, 17_500);
  assert.equal(inv.due_date, '2026-09-16'); // due day already passed on issue, so due on issue

  // Overpay: the excess becomes credit and is applied to October's invoice.
  const pay = await call('POST', '/payments', { tenant_id: tenant.id, amount: 900_000, method: 'card', paid_on: '2026-09-20' });
  assert.equal(pay.status, 201);
  assert.equal(pay.data.platform_fee, 22_500 + 30);
  assert.equal(pay.data.unallocated, 900_000 - 792_500);

  const oct = (await call('POST', '/billing/run', { org_id: org.id, year: 2026, month: 10 })).data;
  const octInv = (await call('GET', `/invoices/${oct.created[0].invoice_id}`)).data;
  assert.equal(octInv.total, 385_000); // 300,000 + 50,000 per-area + 10% VAT
  assert.equal(octInv.amount_paid, 107_500);
  assert.equal(octInv.status, 'partial');

  const fees = (await call('POST', '/billing/late-fees', { org_id: org.id, as_of: '2026-10-10' })).data;
  assert.equal(fees.assessed.length, 1);
  assert.equal(fees.assessed[0].amount, 2500);
  const feesAgain = (await call('POST', '/billing/late-fees', { org_id: org.id, as_of: '2026-10-20' })).data;
  assert.equal(feesAgain.assessed.length, 0);

  const statement = (await call('GET', `/tenants/${tenant.id}/statement`)).data;
  assert.equal(statement.balance, 792_500 + 385_000 - 900_000);
  assert.equal(statement.entries.at(-1).balance, statement.balance);
});

test('plan limits are enforced', async () => {
  const org = (await call('POST', '/organizations', { name: 'Small Landlord' })).data;
  assert.equal(org.plan, 'starter');
  const prop = (await call('POST', '/properties', { org_id: org.id, name: 'Flat block', type: 'apartment_building' })).data;
  for (let i = 1; i <= 5; i++) {
    assert.equal((await call('POST', '/units', { property_id: prop.id, label: `F${i}`, type: 'apartment' })).status, 201);
  }
  const sixth = await call('POST', '/units', { property_id: prop.id, label: 'F6', type: 'apartment' });
  assert.equal(sixth.status, 402);
  assert.match(sixth.data.error, /Upgrade/);

  await call('PATCH', `/organizations/${org.id}`, { plan: 'growth' });
  assert.equal((await call('POST', '/units', { property_id: prop.id, label: 'F6', type: 'apartment' })).status, 201);
  const downgrade = await call('PATCH', `/organizations/${org.id}`, { plan: 'starter' });
  assert.equal(downgrade.status, 402);
});

test('validation errors return 400', async () => {
  assert.equal((await call('POST', '/organizations', {})).status, 400);
  assert.equal((await call('POST', '/properties', { org_id: 1, name: 'X', type: 'castle' })).status, 400);
  assert.equal((await call('POST', '/payments', { tenant_id: 1, amount: 10.5, method: 'cash' })).status, 400);
  assert.equal((await call('POST', '/billing/run', { org_id: 1, year: 2026, month: 13 })).status, 400);
  assert.equal((await call('GET', '/invoices/99999')).status, 404);
});

test('pricing endpoints', async () => {
  const pricing = (await call('GET', '/pricing')).data;
  assert.deepEqual(Object.keys(pricing.plans), ['starter', 'growth', 'business', 'enterprise']);
  const quote = (await call('POST', '/pricing/quote', { units: 120 })).data;
  assert.equal(quote.plan, 'growth');
  assert.equal(quote.monthlyTotal, 2900 + 70 * 75);
});

test('the demo portfolio seeds and produces a dashboard', async () => {
  const db = openDatabase(':memory:');
  const org = seedDemo(db, '2026-10-12');
  const app = createApp(db).listen(0);
  await new Promise((resolve) => app.once('listening', resolve));
  try {
    const res = await fetch(`http://localhost:${app.address().port}/api/organizations/${org.id}/dashboard?as_of=2026-10-12`);
    const d = await res.json();
    assert.equal(d.units, 15);
    assert.equal(d.occupied_units, 9);
    assert.ok(d.arrears > 0);
    assert.ok(d.collected_this_month > 0);
  } finally {
    app.close();
  }
});
