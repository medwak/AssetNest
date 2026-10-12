// Demo portfolio: a mall, an office park and an apartment block with
// billing history for the last two months and the current month.

import { monthPeriod, today } from './billing/dates.js';
import { assessLateFees, payments, runBilling } from './services/billing.js';
import {
  leases,
  maintenance,
  meterReadings,
  organizations,
  properties,
  salesReports,
  tenants,
  units,
} from './services/portfolio.js';

const KES = (shillings) => Math.round(shillings * 100);

function monthsBack(asOf, n) {
  let year = Number(asOf.slice(0, 4));
  let month = Number(asOf.slice(5, 7)) - n;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return monthPeriod(year, month);
}

const key = (p) => p.start.slice(0, 7);

export function seedDemo(db, asOf = today()) {
  const [m2, m1, m0] = [2, 1, 0].map((n) => monthsBack(asOf, n));

  const org = organizations.create(db, {
    name: 'Nest Demo Properties',
    email: 'accounts@nestdemo.example',
    currency: 'KES',
    vat_rate: 16,
    late_fee_type: 'percent',
    late_fee_value: 5,
    late_fee_grace_days: 5,
    plan: 'business',
    billing_cycle: 'annual',
  });

  // ---- properties and units
  const mall = properties.create(db, { org_id: org.id, name: 'Riverside Mall', type: 'shopping_mall', city: 'Nairobi', country: 'Kenya', area_unit: 'sqft' });
  const offices = properties.create(db, { org_id: org.id, name: 'Kilimani Office Park', type: 'office_building', city: 'Nairobi', country: 'Kenya', area_unit: 'm2' });
  const flats = properties.create(db, { org_id: org.id, name: 'Palm Court Apartments', type: 'apartment_building', city: 'Nairobi', country: 'Kenya', area_unit: 'sqft' });

  const u = {};
  for (const [id, label, type, area, rent] of [
    [mall.id, 'A1 Anchor', 'shop', 8000, 1_200_000],
    [mall.id, 'G01', 'shop', 1200, 250_000],
    [mall.id, 'G02', 'restaurant', 800, 180_000],
    [mall.id, 'K1 Food court', 'kiosk', 150, 40_000],
    [mall.id, 'Rooftop billboard', 'billboard', null, 50_000],
    [offices.id, '3A', 'office', 220, 330_000],
    [offices.id, '3B', 'office', 180, 270_000],
    [offices.id, 'P1', 'parking_bay', null, 5_000],
    [offices.id, 'P2', 'parking_bay', null, 5_000],
  ]) {
    u[label] = units.create(db, { property_id: id, label, type, area, market_rent: KES(rent) });
  }
  for (const n of [1, 2, 3, 4, 5, 6]) {
    u[`Apt ${n}`] = units.create(db, { property_id: flats.id, label: `Apt ${n}`, type: 'apartment', floor: String(Math.ceil(n / 2)), bedrooms: n <= 2 ? 1 : 2, bathrooms: 1, area: n <= 2 ? 550 : 800, market_rent: KES(n <= 2 ? 45_000 : 60_000) });
  }

  // ---- tenants
  const t = {};
  for (const [name, kind, extra] of [
    ['FreshMart Supermarkets Ltd', 'business', { contact_person: 'Peter Mwangi', tax_id: 'P051234567A' }],
    ['Amani Pharmacy', 'business', { contact_person: 'Grace Akinyi' }],
    ['Bean There Café', 'business', { contact_person: 'Sam Kiprono' }],
    ['Skyline Outdoor Ads', 'business', {}],
    ['Lakeview Consulting', 'business', { contact_person: 'Ruth Njeri', tax_id: 'P059876543B' }],
    ['Jane Wanjiru', 'individual', { phone: '+254700000001' }],
    ['Brian Otieno', 'individual', { phone: '+254700000002' }],
    ['Mary Chebet', 'individual', { phone: '+254700000003' }],
  ]) {
    t[name] = tenants.create(db, { org_id: org.id, name, kind, email: `${name.split(' ')[0].toLowerCase()}@tenant.example`, ...extra });
  }

  // ---- leases with their charges
  const start = m2.start;
  const l = {};
  l.freshmart = leases.create(db, {
    unit_id: u['A1 Anchor'].id, tenant_id: t['FreshMart Supermarkets Ltd'].id,
    start_date: start, end_date: monthsBack(asOf, -57).end, rent_amount: KES(1_200_000), deposit_amount: KES(3_600_000),
    escalation_rate: 5, vat_applicable: true,
    charges: [
      { charge_type: 'service_charge', method: 'per_area', rate: KES(45) },
      { charge_type: 'marketing_levy', method: 'percent_of_rent', rate: 2 },
      { charge_type: 'turnover_rent', method: 'turnover', rate: 3 },
      { charge_type: 'electricity', method: 'metered', rate: KES(25) },
    ],
  });
  l.pharmacy = leases.create(db, {
    unit_id: u.G01.id, tenant_id: t['Amani Pharmacy'].id,
    start_date: start, end_date: monthsBack(asOf, -33).end, rent_amount: KES(250_000), deposit_amount: KES(500_000),
    escalation_rate: 7.5, vat_applicable: true,
    charges: [
      { charge_type: 'service_charge', method: 'per_area', rate: KES(45) },
      { charge_type: 'signage', method: 'fixed', amount: KES(5_000) },
    ],
  });
  l.cafe = leases.create(db, {
    unit_id: u.G02.id, tenant_id: t['Bean There Café'].id,
    start_date: start, end_date: monthsBack(asOf, -21).end, rent_amount: KES(180_000), deposit_amount: KES(360_000),
    vat_applicable: true,
    charges: [
      { charge_type: 'service_charge', method: 'per_area', rate: KES(45) },
      { charge_type: 'turnover_rent', method: 'turnover', rate: 8 },
      { charge_type: 'water', method: 'metered', rate: KES(150) },
    ],
  });
  l.billboard = leases.create(db, {
    unit_id: u['Rooftop billboard'].id, tenant_id: t['Skyline Outdoor Ads'].id,
    start_date: start, rent_amount: KES(50_000), vat_applicable: true,
  });
  l.lakeview = leases.create(db, {
    unit_id: u['3A'].id, tenant_id: t['Lakeview Consulting'].id,
    start_date: start, end_date: m0.end, rent_amount: KES(330_000), deposit_amount: KES(660_000), vat_applicable: true,
    charges: [
      { charge_type: 'service_charge', method: 'per_area', rate: KES(300) },
      { charge_type: 'internet', method: 'fixed', amount: KES(8_000) },
    ],
  });
  l.parking = leases.create(db, {
    unit_id: u.P1.id, tenant_id: t['Lakeview Consulting'].id,
    start_date: start, rent_amount: KES(5_000), vat_applicable: true,
  });
  l.jane = leases.create(db, {
    unit_id: u['Apt 1'].id, tenant_id: t['Jane Wanjiru'].id,
    start_date: start, end_date: monthsBack(asOf, -9).end, rent_amount: KES(45_000), deposit_amount: KES(45_000), due_day: 5,
    charges: [
      { charge_type: 'garbage', method: 'fixed', amount: KES(500) },
      { charge_type: 'water', method: 'metered', rate: KES(150) },
    ],
  });
  // Moves in mid-month, so the first month is prorated.
  l.brian = leases.create(db, {
    unit_id: u['Apt 3'].id, tenant_id: t['Brian Otieno'].id,
    start_date: `${key(m1)}-15`, rent_amount: KES(60_000), deposit_amount: KES(60_000),
    charges: [
      { charge_type: 'garbage', method: 'fixed', amount: KES(500) },
      { charge_type: 'parking', method: 'fixed', amount: KES(2_000) },
    ],
  });
  l.mary = leases.create(db, {
    unit_id: u['Apt 4'].id, tenant_id: t['Mary Chebet'].id,
    start_date: start, rent_amount: KES(60_000), deposit_amount: KES(60_000),
    charges: [{ charge_type: 'garbage', method: 'fixed', amount: KES(500) }],
  });

  const chargeId = (lease, type) => lease.charges.find((c) => c.charge_type === type).id;
  const meters = [
    [chargeId(l.freshmart, 'electricity'), 41_000, 5_200],
    [chargeId(l.cafe, 'water'), 1_200, 38],
    [chargeId(l.jane, 'water'), 310, 9],
  ];
  const sales = [
    [l.freshmart.id, 52_000_000],
    [l.cafe.id, 2_900_000],
  ];

  // ---- two months of history plus the current month
  const months = [m2, m1, m0];
  months.forEach((period, i) => {
    meters.forEach(([id, startReading, perMonth]) => {
      meterReadings.create(db, {
        lease_charge_id: id, period: key(period),
        previous_reading: startReading + perMonth * i, current_reading: startReading + perMonth * (i + 1),
        read_on: period.start,
      });
    });
    runBilling(db, { org_id: org.id, year: period.year, month: period.month });
    if (period !== m0) {
      sales.forEach(([leaseId, amount], j) => salesReports.create(db, {
        lease_id: leaseId, period: key(period), gross_sales: KES(amount * (1 + 0.04 * (i + j))),
      }));
    }
  });

  // ---- payments: most tenants pay in full, a couple fall behind
  const invoicesFor = (leaseId) => db.prepare(`SELECT * FROM invoices WHERE lease_id = ? ORDER BY period`).all(leaseId);
  const payInFull = (lease, method, inv, day = 3) => payments.record(db, {
    tenant_id: lease.tenant_id, amount: inv.total, method, reference: `${method.toUpperCase()}-${inv.number}`,
    paid_on: `${inv.period}-${String(day).padStart(2, '0')}`,
  });

  for (const lease of [l.freshmart, l.pharmacy, l.billboard, l.lakeview, l.parking, l.jane]) {
    const method = lease === l.jane ? 'mobile_money' : 'bank_transfer';
    for (const inv of invoicesFor(lease.id)) {
      if (inv.period === key(m0) && lease === l.lakeview) continue; // not paid yet this month
      payInFull(lease, method, inv);
    }
  }
  // Café pays late and short.
  const [cafeFirst] = invoicesFor(l.cafe.id);
  payInFull(l.cafe, 'card', cafeFirst, 9);
  payments.record(db, { tenant_id: l.cafe.tenant_id, amount: KES(150_000), method: 'card', paid_on: `${key(m1)}-20` });
  // Mary pays cash, a month behind.
  const [maryFirst] = invoicesFor(l.mary.id);
  payInFull(l.mary, 'cash', maryFirst, 4);
  // Brian paid his deposit and first prorated month on move-in.
  const [brianFirst] = invoicesFor(l.brian.id);
  payInFull(l.brian, 'mobile_money', brianFirst, 15);

  assessLateFees(db, { org_id: org.id, as_of: asOf });

  // ---- maintenance
  maintenance.create(db, { org_id: org.id, unit_id: u['Apt 4'].id, tenant_id: t['Mary Chebet'].id, lease_id: l.mary.id, title: 'Leaking kitchen tap', priority: 'normal' });
  maintenance.create(db, { org_id: org.id, unit_id: u['A1 Anchor'].id, title: 'Loading bay roller door jammed', priority: 'urgent' });
  const glass = maintenance.create(db, {
    org_id: org.id, unit_id: u.G02.id, tenant_id: t['Bean There Café'].id, lease_id: l.cafe.id,
    title: 'Shopfront glass broken by tenant contractor', priority: 'high', cost: KES(42_000), recharge_to_tenant: true,
  });
  maintenance.update(db, glass.id, { status: 'completed' });

  return org;
}
