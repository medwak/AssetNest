import assert from 'node:assert/strict';
import { test } from 'node:test';

import { monthPeriod } from '../src/billing/dates.js';
import { buildInvoice, rentAt } from '../src/billing/invoiceEngine.js';

const oct = monthPeriod(2026, 10); // 31 days

const lease = (over = {}) => ({
  start_date: '2026-01-01',
  end_date: null,
  terminated_on: null,
  rent_amount: 100_000,
  deposit_amount: 0,
  escalation_rate: 0,
  escalation_interval_months: 12,
  vat_applicable: 0,
  ...over,
});

const amounts = (inv) => Object.fromEntries(inv.lines.map((l) => [l.charge_type, l.amount]));

test('full month bills the whole rent', () => {
  const inv = buildInvoice({ lease: lease(), period: oct });
  assert.equal(inv.total, 100_000);
  assert.equal(inv.prorated, false);
});

test('move-in mid-month is prorated by days', () => {
  const inv = buildInvoice({ lease: lease({ start_date: '2026-10-16' }), period: oct });
  assert.equal(inv.occupiedDays, 16);
  assert.equal(inv.total, Math.round((100_000 * 16) / 31));
  assert.match(inv.lines[0].description, /prorated 16\/31/);
});

test('termination mid-month is prorated', () => {
  const inv = buildInvoice({ lease: lease({ terminated_on: '2026-10-10' }), period: oct });
  assert.equal(inv.occupiedDays, 10);
});

test('lease outside the period produces no invoice', () => {
  assert.equal(buildInvoice({ lease: lease({ start_date: '2026-11-01' }), period: oct }), null);
  assert.equal(buildInvoice({ lease: lease({ end_date: '2026-09-30' }), period: oct }), null);
});

test('rent escalates and compounds on each anniversary', () => {
  const l = lease({ start_date: '2024-03-15', escalation_rate: 10 });
  assert.equal(rentAt(l, '2025-03-14'), 100_000);
  assert.equal(rentAt(l, '2025-03-15'), 110_000);
  assert.equal(rentAt(l, '2026-03-15'), 121_000);
  const inv = buildInvoice({ lease: l, period: oct });
  assert.equal(amounts(inv).rent, 121_000);
});

test('deposit is billed on the first invoice only, without VAT', () => {
  const l = lease({ deposit_amount: 200_000, vat_applicable: 1 });
  const first = buildInvoice({ lease: l, period: oct, isFirstInvoice: true, vatRate: 16 });
  assert.equal(amounts(first).security_deposit, 200_000);
  assert.equal(first.tax, 16_000);
  const later = buildInvoice({ lease: l, period: oct, isFirstInvoice: false, vatRate: 16 });
  assert.equal(amounts(later).security_deposit, undefined);
});

test('VAT only applies to taxable lines on VAT-registered leases', () => {
  const charges = [
    { id: 1, charge_type: 'water', method: 'fixed', amount: 5_000 }, // not taxable by default
    { id: 2, charge_type: 'parking', method: 'fixed', amount: 10_000 },
    { id: 3, charge_type: 'water', method: 'fixed', amount: 1_000, taxable: 1 }, // override
  ];
  const withVat = buildInvoice({ lease: lease({ vat_applicable: 1 }), charges, period: oct, vatRate: 16 });
  assert.equal(withVat.taxableAmount, 111_000);
  assert.equal(withVat.tax, 17_760);
  assert.equal(withVat.total, 116_000 + 17_760);
  const residential = buildInvoice({ lease: lease(), charges, period: oct, vatRate: 16 });
  assert.equal(residential.tax, 0);
});

test('per-area, percent-of-rent and fixed charges are prorated with rent', () => {
  const charges = [
    { id: 1, charge_type: 'service_charge', method: 'per_area', rate: 50 },
    { id: 2, charge_type: 'marketing_levy', method: 'percent_of_rent', rate: 2 },
    { id: 3, charge_type: 'garbage', method: 'fixed', amount: 3_100 },
    { id: 4, charge_type: 'internet', method: 'fixed', amount: 3_100, prorate: 0 },
  ];
  const full = amounts(buildInvoice({ lease: lease(), unit: { area: 1000 }, charges, period: oct }));
  assert.equal(full.service_charge, 50_000);
  assert.equal(full.marketing_levy, 2_000);
  assert.equal(full.garbage, 3_100);

  const half = buildInvoice({ lease: lease({ start_date: '2026-10-17' }), unit: { area: 1000 }, charges, period: oct });
  const lines = Object.fromEntries(half.lines.map((l) => [l.source_id ?? l.charge_type, l.amount]));
  assert.equal(lines[1], Math.round((50_000 * 15) / 31));
  assert.equal(lines[3], 1_500);
  assert.equal(lines[4], 3_100); // prorate disabled
});

test('per-area charge is skipped with a warning when the unit has no area', () => {
  const inv = buildInvoice({
    lease: lease(), unit: {}, period: oct,
    charges: [{ id: 1, charge_type: 'service_charge', method: 'per_area', rate: 50 }],
  });
  assert.equal(inv.lines.length, 1);
  assert.match(inv.warnings[0], /no area/);
});

test('metered charges bill consumption times rate', () => {
  const charges = [{ id: 7, charge_type: 'water', method: 'metered', rate: 15_000 }];
  const inv = buildInvoice({
    lease: lease(), charges, period: oct,
    meterReadings: { 7: { previous_reading: 100, current_reading: 112.5 } },
  });
  assert.equal(amounts(inv).water, 187_500);
  const missing = buildInvoice({ lease: lease(), charges, period: oct });
  assert.equal(amounts(missing).water, undefined);
  assert.match(missing.warnings[0], /no meter reading/);
});

test('turnover rent with a natural breakpoint bills only the excess over base rent', () => {
  const charges = [{ id: 1, charge_type: 'turnover_rent', method: 'turnover', rate: 8 }];
  const busy = buildInvoice({ lease: lease(), charges, period: oct, salesReport: { period: '2026-09', gross_sales: 2_000_000 } });
  assert.equal(amounts(busy).turnover_rent, 60_000); // 8% of 2,000,000 = 160,000 less 100,000 rent
  const quiet = buildInvoice({ lease: lease(), charges, period: oct, salesReport: { period: '2026-09', gross_sales: 1_000_000 } });
  assert.equal(amounts(quiet).turnover_rent, undefined);
});

test('turnover rent with an explicit breakpoint', () => {
  const charges = [{ id: 1, charge_type: 'turnover_rent', method: 'turnover', rate: 5, breakpoint: 1_000_000 }];
  const inv = buildInvoice({ lease: lease(), charges, period: oct, salesReport: { period: '2026-09', gross_sales: 1_500_000 } });
  assert.equal(amounts(inv).turnover_rent, 25_000);
});

test('one-time charges are added as lines', () => {
  const inv = buildInvoice({
    lease: lease({ vat_applicable: 1 }), period: oct, vatRate: 10,
    oneTimeCharges: [
      { id: 9, charge_type: 'late_fee', amount: 5_000, description: 'Late payment fee on INV-1' },
      { id: 10, charge_type: 'maintenance_recharge', amount: 20_000 },
    ],
  });
  assert.equal(inv.subtotal, 125_000);
  assert.equal(inv.tax, 12_000); // late fee is not taxable
  assert.equal(inv.lines.find((l) => l.source_id === 9).source, 'one_time_charge');
});
