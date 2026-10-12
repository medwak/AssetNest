// Builds the lines of a tenant's monthly invoice. Pure: no database access,
// so every rule here is covered directly by tests.

import { CHARGE_TYPES } from '../config/chargeTypes.js';
import { daysBetweenInclusive, maxDate, minDate, wholeMonthsBetween } from './dates.js';
import { percentOf, round, sum } from './money.js';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function periodLabel(period) {
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
}

export function previousPeriodKey(period) {
  const year = period.month === 1 ? period.year - 1 : period.year;
  const month = period.month === 1 ? 12 : period.month - 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Monthly rent in force on `onDate`, after compounding escalations.
export function rentAt(lease, onDate) {
  let rent = lease.rent_amount;
  const rate = lease.escalation_rate ?? 0;
  const interval = lease.escalation_interval_months || 12;
  if (rate === 0 || onDate <= lease.start_date) return rent;
  const steps = Math.floor(wholeMonthsBetween(lease.start_date, onDate) / interval);
  for (let i = 0; i < steps; i++) rent = round(rent * (1 + rate / 100));
  return rent;
}

export function leaseEndDate(lease) {
  return minDate(lease.end_date, lease.terminated_on);
}

// Days of `period` covered by the lease, and the dates they run between.
export function occupancy(lease, period) {
  const start = maxDate(lease.start_date, period.start);
  const end = minDate(leaseEndDate(lease) ?? period.end, period.end);
  const days = start <= end ? daysBetweenInclusive(start, end) : 0;
  return { start, end, days };
}

function isTaxable(chargeType, override) {
  if (override === 0 || override === 1 || typeof override === 'boolean') return Boolean(override);
  return CHARGE_TYPES[chargeType]?.taxable ?? true;
}

function chargeName(chargeType, description) {
  return description || CHARGE_TYPES[chargeType]?.name || chargeType;
}

/**
 * @param {object} input
 * @param {object} input.lease            lease row
 * @param {object} input.unit             unit row (area is used by per_area charges)
 * @param {object[]} input.charges        recurring lease_charges rows
 * @param {object} input.period           from monthPeriod()
 * @param {object} [input.meterReadings]  { [leaseChargeId]: { previous_reading, current_reading } }
 * @param {object} [input.salesReport]    previous month's { period, gross_sales } for turnover rent
 * @param {object[]} [input.oneTimeCharges] unbilled one_time_charges rows
 * @param {boolean} [input.isFirstInvoice] bills the deposit when true
 * @param {number} [input.vatRate]        percent
 * @returns {null | {lines, subtotal, taxableAmount, tax, total, occupiedDays, prorated, warnings}}
 */
export function buildInvoice({
  lease,
  unit,
  charges = [],
  period,
  meterReadings = {},
  salesReport = null,
  oneTimeCharges = [],
  isFirstInvoice = false,
  vatRate = 0,
}) {
  const occ = occupancy(lease, period);
  if (occ.days === 0) return null;

  const factor = occ.days / period.days;
  const prorated = occ.days < period.days;
  const prorateNote = prorated ? ` (prorated ${occ.days}/${period.days} days)` : '';
  const label = periodLabel(period);
  const currentRent = rentAt(lease, occ.start);
  const lines = [];
  const warnings = [];

  const addLine = (line) => {
    lines.push({
      quantity: 1,
      unit_price: line.amount,
      source: null,
      source_id: null,
      ...line,
      taxable: line.taxable ? 1 : 0,
    });
  };

  addLine({
    charge_type: 'rent',
    description: `Rent, ${label}${prorateNote}`,
    unit_price: currentRent,
    amount: round(currentRent * factor),
    taxable: isTaxable('rent'),
  });

  for (const charge of charges) {
    const type = charge.charge_type;
    const name = chargeName(type, charge.description);
    const taxable = isTaxable(type, charge.taxable);
    const prorate = charge.prorate !== 0 && charge.prorate !== false;
    const f = prorate ? factor : 1;
    const note = prorate ? prorateNote : '';
    const base = { charge_type: type, taxable, source: 'lease_charge', source_id: charge.id };

    switch (charge.method) {
      case 'fixed':
        addLine({
          ...base,
          description: `${name}, ${label}${note}`,
          unit_price: charge.amount,
          amount: round(charge.amount * f),
        });
        break;

      case 'per_area': {
        if (!unit?.area) {
          warnings.push(`${name}: unit has no area set, charge skipped`);
          break;
        }
        addLine({
          ...base,
          description: `${name}, ${unit.area} @ ${charge.rate}/area unit, ${label}${note}`,
          quantity: unit.area,
          unit_price: charge.rate,
          amount: round(unit.area * charge.rate * f),
        });
        break;
      }

      case 'percent_of_rent':
        addLine({
          ...base,
          description: `${name}, ${charge.rate}% of rent, ${label}${note}`,
          unit_price: percentOf(currentRent, charge.rate),
          amount: round((currentRent * charge.rate * f) / 100),
        });
        break;

      case 'metered': {
        const reading = meterReadings[charge.id];
        if (!reading) {
          warnings.push(`${name}: no meter reading for ${label}, charge skipped`);
          break;
        }
        const consumption = reading.current_reading - reading.previous_reading;
        if (consumption < 0) {
          warnings.push(`${name}: meter reading went backwards, charge skipped`);
          break;
        }
        addLine({
          ...base,
          description: `${name}, ${reading.previous_reading} to ${reading.current_reading} (${consumption} units)`,
          quantity: consumption,
          unit_price: charge.rate,
          amount: round(consumption * charge.rate),
        });
        break;
      }

      case 'turnover': {
        // Billed in arrears on the previous month's reported sales.
        if (!salesReport) {
          warnings.push(`${name}: no sales report for ${previousPeriodKey(period)}, charge skipped`);
          break;
        }
        const sales = salesReport.gross_sales;
        let amount;
        let basis;
        if (charge.breakpoint != null) {
          amount = percentOf(Math.max(0, sales - charge.breakpoint), charge.rate);
          basis = `${charge.rate}% of sales above ${charge.breakpoint}`;
        } else {
          // Natural breakpoint: tenant pays the higher of base rent or
          // the percentage of sales, so only the excess is billed here.
          amount = Math.max(0, percentOf(sales, charge.rate) - currentRent);
          basis = `${charge.rate}% of sales less base rent`;
        }
        if (amount > 0) {
          addLine({
            ...base,
            description: `${name} on ${salesReport.period} sales of ${sales} (${basis})`,
            unit_price: amount,
            amount,
          });
        }
        break;
      }

      default:
        warnings.push(`${name}: unknown calculation method "${charge.method}", charge skipped`);
    }
  }

  if (isFirstInvoice && lease.deposit_amount > 0) {
    addLine({
      charge_type: 'security_deposit',
      description: 'Security deposit (refundable)',
      amount: lease.deposit_amount,
      taxable: false,
    });
  }

  for (const c of oneTimeCharges) {
    addLine({
      charge_type: c.charge_type,
      description: chargeName(c.charge_type, c.description),
      amount: c.amount,
      taxable: isTaxable(c.charge_type, c.taxable),
      source: 'one_time_charge',
      source_id: c.id,
    });
  }

  const subtotal = sum(lines.map((l) => l.amount));
  const taxableAmount = lease.vat_applicable
    ? sum(lines.filter((l) => l.taxable).map((l) => l.amount))
    : 0;
  const tax = percentOf(taxableAmount, vatRate);

  return {
    lines,
    subtotal,
    taxableAmount,
    tax,
    total: subtotal + tax,
    occupiedDays: occ.days,
    prorated,
    warnings,
  };
}
